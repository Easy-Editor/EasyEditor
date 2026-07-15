import { dashboardConfigureAnnotations } from '../phase-0-contracts.mjs'

export const SAFE_MATERIAL_MANIFEST_SCHEMA_VERSION = 1

export const DEFAULT_SAFE_MATERIAL_MANIFEST_LIMITS = Object.freeze({
  maxConfigureDepth: 24,
  maxFields: 512,
  maxJsonNodes: 4096,
  maxManifestBytes: 256 * 1024,
  maxStringLength: 4096,
})

export const DASHBOARD_CONFIGURE_ANNOTATION_BINDINGS = Object.freeze({
  '*': Object.freeze({
    condition: 'shared.visibility',
    id: 'shared.id',
    rect: 'shared.rect',
    title: 'shared.title',
  }),
  Image: Object.freeze({
    __image: 'image.source',
  }),
  Root: Object.freeze({
    __image: 'root.image',
  }),
})

export const DASHBOARD_MATERIAL_READINESS_REQUIREMENTS = Object.freeze({
  BarChart: Object.freeze(['props.data']),
  LineChart: Object.freeze(['props.data']),
  Text: Object.freeze(['props.text']),
})

const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const CALLBACK_KEYS = Object.freeze(['getValue', 'setValue', 'condition', 'autorun', 'onChange'])
const DASHBOARD_SHARED_CONFIG_COMPONENTS = new Set([
  'AreaChart',
  'BarChart',
  'Image',
  'LineChart',
  'PieChart',
  'RadarChart',
  'RadialChart',
  'Root',
  'Text',
])
const PROJECTION_ROOTS = new Set(['extra', 'node', 'props'])
const WRITE_ROOTS = new Set(['extra', 'props'])
const SETTER_SCHEMAS = Object.freeze({
  ColorSetter: Object.freeze({ type: 'string' }),
  NodeIdSetter: Object.freeze({ type: 'string' }),
  NumberSetter: Object.freeze({ type: 'number' }),
  RectSetter: Object.freeze({
    properties: Object.freeze({
      height: Object.freeze({ minimum: 0, type: 'number' }),
      width: Object.freeze({ minimum: 0, type: 'number' }),
      x: Object.freeze({ type: 'number' }),
      y: Object.freeze({ type: 'number' }),
    }),
    required: Object.freeze(['x', 'y', 'width', 'height']),
    type: 'object',
  }),
  StringSetter: Object.freeze({ type: 'string' }),
  SwitchSetter: Object.freeze({ type: 'boolean' }),
  UploadSetter: Object.freeze({ type: 'object' }),
})

class ManifestCompileIssue extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const isObjectLike = value => (typeof value === 'object' && value !== null) || typeof value === 'function'

const isPlainRecord = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const readOwnDataProperty = (value, key, label) => {
  if (!isObjectLike(value)) return undefined
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor)) {
    throw new ManifestCompileIssue('accessor-rejected', `${label}.${String(key)} must be a data property`)
  }
  return descriptor.value
}

const compareUtf16 = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const readArrayDataProperty = (value, index, label) => {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index))
  if (!descriptor) return undefined
  if (!('value' in descriptor)) {
    throw new ManifestCompileIssue('accessor-rejected', `${label}[${index}] must be a data property`)
  }
  return descriptor.value
}

const readArrayLength = (value, label) => {
  const length = readOwnDataProperty(value, 'length', label)
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new ManifestCompileIssue('invalid-configure', `${label}.length must be a non-negative safe integer`)
  }
  return length
}

const normalizeLimits = input => {
  if (input === undefined) return DEFAULT_SAFE_MATERIAL_MANIFEST_LIMITS
  if (!isPlainRecord(input)) throw new TypeError('limits must be a plain object')
  const limits = { ...DEFAULT_SAFE_MATERIAL_MANIFEST_LIMITS }
  for (const key of Object.keys(limits)) {
    const value = readOwnDataProperty(input, key, 'limits')
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`limits.${key} must be a positive integer`)
    limits[key] = value
  }
  return Object.freeze(limits)
}

const normalizeRegistryVersion = value => {
  if (typeof value === 'string' && value.length > 0) return value
  if (Number.isSafeInteger(value) && value >= 0) return value
  throw new TypeError('materialRegistryVersion must be a non-empty string or non-negative safe integer')
}

const normalizeComponentName = metadata => {
  if (!isPlainRecord(metadata)) throw new TypeError('metadata must be a plain object')
  const componentName = readOwnDataProperty(metadata, 'componentName', 'metadata')
  if (typeof componentName !== 'string' || componentName.length === 0) {
    throw new TypeError('metadata.componentName must be a non-empty string')
  }
  return componentName
}

const safeString = (value, limits) => {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.slice(0, limits.maxStringLength)
}

const createJsonCloneState = limits => ({
  ancestors: new Set(),
  limits,
  nodes: 0,
})

const cloneJsonValue = (value, state, path = '$', depth = 0) => {
  state.nodes += 1
  if (state.nodes > state.limits.maxJsonNodes) {
    throw new ManifestCompileIssue('json-limit-exceeded', `${path} exceeds the JSON node limit`)
  }
  if (depth > state.limits.maxConfigureDepth) {
    throw new ManifestCompileIssue('json-limit-exceeded', `${path} exceeds the JSON depth limit`)
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.length > state.limits.maxStringLength) {
      throw new ManifestCompileIssue('json-limit-exceeded', `${path} exceeds the string length limit`)
    }
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ManifestCompileIssue('invalid-json', `${path} must be finite`)
    return value
  }
  if (typeof value !== 'object' || value === null) {
    throw new ManifestCompileIssue('invalid-json', `${path} is not JSON data`)
  }
  if (state.ancestors.has(value)) throw new ManifestCompileIssue('cycle-detected', `${path} contains a cycle`)
  state.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const result = []
      const length = readArrayLength(value, path)
      for (let index = 0; index < length; index += 1) {
        const item = readArrayDataProperty(value, index, path)
        result.push(cloneJsonValue(item, state, `${path}[${index}]`, depth + 1))
      }
      return result
    }
    if (!isPlainRecord(value)) throw new ManifestCompileIssue('invalid-json', `${path} must be a plain object`)
    const result = {}
    for (const key of Object.keys(value).sort(compareUtf16)) {
      if (DANGEROUS_PATH_SEGMENTS.has(key)) {
        throw new ManifestCompileIssue('invalid-json', `${path}.${key} is not allowed`)
      }
      const item = readOwnDataProperty(value, key, path)
      result[key] = cloneJsonValue(item, state, `${path}.${key}`, depth + 1)
    }
    return result
  } finally {
    state.ancestors.delete(value)
  }
}

const cloneJson = (value, limits, path) => cloneJsonValue(value, createJsonCloneState(limits), path)

const deepFreezeJson = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.keys(value)) deepFreezeJson(readOwnDataProperty(value, key, 'manifest'))
  return Object.freeze(value)
}

const createDiagnostic = (code, message, options = {}) => {
  const diagnostic = { code, message }
  if (options.fieldId) diagnostic.fieldId = options.fieldId
  if (options.sourcePath) diagnostic.sourcePath = options.sourcePath
  return diagnostic
}

const addIssueDiagnostic = (diagnostics, error, options = {}) => {
  const code = error instanceof ManifestCompileIssue ? error.code : 'invalid-configure'
  const message = error instanceof ManifestCompileIssue ? error.message : 'Configure data could not be inspected safely'
  diagnostics.push(createDiagnostic(code, message, options))
}

const normalizePathSegments = (value, label, allowedRoots) => {
  if (!Array.isArray(value)) {
    throw new ManifestCompileIssue('invalid-annotation', `${label} must be a non-empty path`)
  }
  const length = readArrayLength(value, label)
  if (length === 0) throw new ManifestCompileIssue('invalid-annotation', `${label} must be a non-empty path`)
  const segments = []
  for (let index = 0; index < length; index += 1) {
    const segment = readArrayDataProperty(value, index, label)
    if (typeof segment !== 'string' || segment.length === 0 || DANGEROUS_PATH_SEGMENTS.has(segment)) {
      throw new ManifestCompileIssue('invalid-annotation', `${label}[${index}] is not a safe path segment`)
    }
    segments.push(segment)
  }
  if (!allowedRoots.has(segments[0])) {
    throw new ManifestCompileIssue('invalid-annotation', `${label} has an unsupported projection root`)
  }
  return segments
}

const normalizeValuePath = (value, label) => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new ManifestCompileIssue('invalid-annotation', `${label} must be an array`)
  const segments = []
  const length = readArrayLength(value, label)
  for (let index = 0; index < length; index += 1) {
    const segment = readArrayDataProperty(value, index, label)
    if (typeof segment !== 'string' || segment.length === 0 || DANGEROUS_PATH_SEGMENTS.has(segment)) {
      throw new ManifestCompileIssue('invalid-annotation', `${label}[${index}] is not a safe path segment`)
    }
    segments.push(segment)
  }
  return segments
}

const normalizeTargets = (value, label) => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new ManifestCompileIssue('invalid-annotation', `${label} must be an array`)
  const targets = []
  const length = readArrayLength(value, label)
  for (let index = 0; index < length; index += 1) {
    const target = readArrayDataProperty(value, index, label)
    if (!isPlainRecord(target)) {
      throw new ManifestCompileIssue('invalid-annotation', `${label}[${index}] must be a plain object`)
    }
    const path = normalizePathSegments(
      readOwnDataProperty(target, 'path', `${label}[${index}]`),
      `${label}[${index}].path`,
      WRITE_ROOTS,
    )
    const valuePath = normalizeValuePath(
      readOwnDataProperty(target, 'valuePath', `${label}[${index}]`),
      `${label}[${index}].valuePath`,
    )
    targets.push(valuePath === undefined ? { path } : { path, valuePath })
  }
  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
      const leftPath = targets[leftIndex].path
      const rightPath = targets[rightIndex].path
      const commonLength = Math.min(leftPath.length, rightPath.length)
      const overlaps = leftPath.slice(0, commonLength).every((segment, index) => segment === rightPath[index])
      if (overlaps) {
        throw new ManifestCompileIssue('overlapping-write-targets', `${label} contains overlapping projection paths`)
      }
    }
  }
  return targets
}

const normalizeVerifyPaths = value => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new ManifestCompileIssue('invalid-annotation', 'verifyPaths must be an array')
  const paths = []
  const length = readArrayLength(value, 'verifyPaths')
  for (let index = 0; index < length; index += 1) {
    const path = readArrayDataProperty(value, index, 'verifyPaths')
    paths.push(normalizePathSegments(path, `verifyPaths[${index}]`, PROJECTION_ROOTS))
  }
  return paths
}

const compileAnnotation = ({ annotation, annotationKey, field, limits }) => {
  if (!isPlainRecord(annotation)) {
    throw new ManifestCompileIssue('invalid-annotation', `Annotation ${annotationKey} must be a plain object`)
  }
  const fieldId = readOwnDataProperty(annotation, 'fieldId', `annotation.${annotationKey}`)
  const access = readOwnDataProperty(annotation, 'access', `annotation.${annotationKey}`)
  if (typeof fieldId !== 'string' || fieldId.length === 0 || fieldId !== annotationKey) {
    throw new ManifestCompileIssue('invalid-annotation', `Annotation ${annotationKey} must use its key as fieldId`)
  }
  if (!['read-only', 'read-write', 'unsupported'].includes(access)) {
    throw new ManifestCompileIssue('invalid-annotation', `Annotation ${annotationKey} has invalid access`)
  }
  if (access === 'unsupported') return { access, fieldId }

  const readPath = normalizePathSegments(
    readOwnDataProperty(annotation, 'readPath', `annotation.${annotationKey}`),
    'readPath',
    PROJECTION_ROOTS,
  )
  const verifyPaths = normalizeVerifyPaths(
    readOwnDataProperty(annotation, 'verifyPaths', `annotation.${annotationKey}`),
  )
  if (!verifyPaths?.length) {
    throw new ManifestCompileIssue('invalid-annotation', `Annotation ${annotationKey} requires verifyPaths`)
  }

  const result = {
    access,
    fieldId,
    readPath,
    verifyPaths,
  }
  if (field.title) result.title = field.title
  const valueSchema = readOwnDataProperty(annotation, 'valueSchema', `annotation.${annotationKey}`)
  if (valueSchema !== undefined)
    result.valueSchema = cloneJson(valueSchema, limits, `annotation.${annotationKey}.valueSchema`)

  if (access === 'read-write') {
    const writeTargets = normalizeTargets(
      readOwnDataProperty(annotation, 'writeTargets', `annotation.${annotationKey}`),
      'writeTargets',
    )
    if (!writeTargets?.length) {
      throw new ManifestCompileIssue('invalid-annotation', `Annotation ${annotationKey} requires writeTargets`)
    }
    result.writeTargets = writeTargets
    const unsetTargets = normalizeTargets(
      readOwnDataProperty(annotation, 'unsetTargets', `annotation.${annotationKey}`),
      'unsetTargets',
    )
    if (unsetTargets?.length) result.unsetTargets = unsetTargets
  }
  return result
}

const getSetterInfo = field => {
  const setter = readOwnDataProperty(field, 'setter', 'field')
  if (typeof setter === 'function') return { dynamic: true }
  if (typeof setter === 'string') return { componentName: setter, dynamic: false }
  if (setter === undefined) return { dynamic: false }
  if (!isPlainRecord(setter)) return { dynamic: true }
  const componentName = readOwnDataProperty(setter, 'componentName', 'field.setter')
  const props = readOwnDataProperty(setter, 'props', 'field.setter')
  if (typeof props === 'function') return { componentName, dynamic: true }
  if (props !== undefined && !isPlainRecord(props)) return { componentName, dynamic: true }
  return {
    componentName: typeof componentName === 'string' ? componentName : undefined,
    defaultValue: readOwnDataProperty(setter, 'defaultValue', 'field.setter'),
    dynamic: false,
    isRequired: readOwnDataProperty(setter, 'isRequired', 'field.setter') === true,
    props,
  }
}

const getExtraPropsInfo = field => {
  const extraProps = readOwnDataProperty(field, 'extraProps', 'field')
  if (extraProps === undefined) return { dynamic: false }
  if (!isPlainRecord(extraProps)) return { dynamic: true }
  for (const key of CALLBACK_KEYS) {
    if (typeof readOwnDataProperty(extraProps, key, 'field.extraProps') === 'function')
      return { dynamic: true, extraProps }
  }
  return {
    defaultValue: readOwnDataProperty(extraProps, 'defaultValue', 'field.extraProps'),
    dynamic: false,
    extraProps,
    isRequired: readOwnDataProperty(extraProps, 'isRequired', 'field.extraProps') === true,
  }
}

const hasDirectCallbackSemantics = field => {
  for (const key of CALLBACK_KEYS) {
    if (typeof readOwnDataProperty(field, key, 'field') === 'function') return true
  }
  return false
}

const readConstraint = (props, key) => (props ? readOwnDataProperty(props, key, 'field.setter.props') : undefined)

const enumValuesFromOptions = options => {
  if (!Array.isArray(options)) return undefined
  const values = []
  const length = readArrayLength(options, 'field.setter.props.options')
  for (let index = 0; index < length; index += 1) {
    const option = readArrayDataProperty(options, index, 'field.setter.props.options')
    let value = option
    if (isPlainRecord(option)) value = readOwnDataProperty(option, 'value', 'field.setter.props.options')
    if (!['boolean', 'number', 'string'].includes(typeof value) && value !== null) return undefined
    if (typeof value === 'number' && !Number.isFinite(value)) return undefined
    values.push(value)
  }
  return values.length ? values : undefined
}

const compileSetterSchema = (setterInfo, extraPropsInfo, limits, diagnostics, field) => {
  const baseSchema = setterInfo.componentName ? SETTER_SCHEMAS[setterInfo.componentName] : undefined
  const schema = baseSchema ? cloneJson(baseSchema, limits, `setter.${setterInfo.componentName}`) : {}
  const props = setterInfo.props
  const options = enumValuesFromOptions(readConstraint(props, 'options'))
  if (options) schema.enum = options

  if (schema.type === 'number') {
    const minimum = readConstraint(props, 'min')
    const maximum = readConstraint(props, 'max')
    const multipleOf = readConstraint(props, 'step')
    if (typeof minimum === 'number' && Number.isFinite(minimum)) schema.minimum = minimum
    if (typeof maximum === 'number' && Number.isFinite(maximum)) schema.maximum = maximum
    if (typeof multipleOf === 'number' && Number.isFinite(multipleOf) && multipleOf > 0) schema.multipleOf = multipleOf
  }
  if (schema.type === 'string') {
    const minLength = readConstraint(props, 'minLength')
    const maxLength = readConstraint(props, 'maxLength')
    const pattern = readConstraint(props, 'pattern')
    if (Number.isSafeInteger(minLength) && minLength >= 0) schema.minLength = minLength
    if (Number.isSafeInteger(maxLength) && maxLength >= 0) schema.maxLength = maxLength
    if (typeof pattern === 'string' && pattern.length <= limits.maxStringLength) schema.pattern = pattern
  }

  const defaultValue = extraPropsInfo.defaultValue ?? setterInfo.defaultValue
  if (defaultValue !== undefined) {
    try {
      schema.default = cloneJson(defaultValue, limits, `${field.sourcePath}.defaultValue`)
      if (!schema.type) {
        if (Array.isArray(defaultValue)) schema.type = 'array'
        else if (defaultValue !== null && typeof defaultValue === 'object') schema.type = 'object'
        else if (['boolean', 'number', 'string'].includes(typeof defaultValue)) schema.type = typeof defaultValue
      }
    } catch (error) {
      addIssueDiagnostic(diagnostics, error, { fieldId: field.fieldId, sourcePath: field.sourcePath })
    }
  }
  if (!baseSchema && !options) {
    diagnostics.push(
      createDiagnostic('setter-constraints-unsupported', 'No safe constraints are defined for this static setter', {
        fieldId: field.fieldId,
        sourcePath: field.sourcePath,
      }),
    )
  }
  return schema
}

const normalizePropPath = name => {
  if (typeof name !== 'string' || name.length === 0) return undefined
  const segments = name.split('.')
  if (segments.some(segment => segment.length === 0 || DANGEROUS_PATH_SEGMENTS.has(segment))) return undefined
  return ['props', ...segments]
}

const createUnsupportedField = field => {
  const result = {
    access: 'unsupported',
    fieldId: field.unsupportedFieldId || field.fieldId,
  }
  if (field.title) result.title = field.title
  return result
}

const compileFallbackField = ({ diagnostics, extraPropsInfo, field, limits, setterInfo }) => {
  const path = normalizePropPath(field.name)
  if (!path) {
    diagnostics.push(
      createDiagnostic(
        'unsafe-or-anonymous-field',
        'Field has no safe annotation and cannot fall back to props.<name>',
        {
          fieldId: field.fieldId,
          sourcePath: field.sourcePath,
        },
      ),
    )
    return createUnsupportedField(field)
  }
  const result = {
    access: 'read-write',
    fieldId: `props.${field.name}`,
    readPath: path,
    unsetTargets: [{ path }],
    valueSchema: compileSetterSchema(setterInfo, extraPropsInfo, limits, diagnostics, field),
    verifyPaths: [path],
    writeTargets: [{ path }],
  }
  if (field.title) result.title = field.title
  if (setterInfo.isRequired || extraPropsInfo.isRequired) result.required = true
  return result
}

const normalizeBindingMap = (value, label) => {
  if (value === undefined) return {}
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a plain object`)
  const result = {}
  for (const fieldName of Object.keys(value)) {
    if (!fieldName || DANGEROUS_PATH_SEGMENTS.has(fieldName)) {
      throw new TypeError(`${label} contains an unsafe field name`)
    }
    const annotationKey = readOwnDataProperty(value, fieldName, label)
    if (typeof annotationKey !== 'string' || annotationKey.length === 0) {
      throw new TypeError(`${label}.${fieldName} must be a non-empty string`)
    }
    result[fieldName] = annotationKey
  }
  return result
}

const buildAnnotationBindings = (componentName, overrides) => {
  if (overrides !== undefined && !isPlainRecord(overrides)) {
    throw new TypeError('annotationBindings must be a plain component binding table')
  }
  const allowWildcard = DASHBOARD_SHARED_CONFIG_COMPONENTS.has(componentName)
  const defaultWildcard = allowWildcard
    ? normalizeBindingMap(DASHBOARD_CONFIGURE_ANNOTATION_BINDINGS['*'], 'bindings.*')
    : {}
  const defaultSpecific = normalizeBindingMap(
    readOwnDataProperty(DASHBOARD_CONFIGURE_ANNOTATION_BINDINGS, componentName, 'bindings'),
    `bindings.${componentName}`,
  )
  const overrideWildcard = allowWildcard
    ? normalizeBindingMap(
        overrides ? readOwnDataProperty(overrides, '*', 'annotationBindings') : undefined,
        'annotationBindings.*',
      )
    : {}
  const overrideSpecific = normalizeBindingMap(
    overrides ? readOwnDataProperty(overrides, componentName, 'annotationBindings') : undefined,
    `annotationBindings.${componentName}`,
  )
  return { ...defaultWildcard, ...overrideWildcard, ...defaultSpecific, ...overrideSpecific }
}

const resolveAnnotationKey = (field, bindings) =>
  field.bindingKey ? readOwnDataProperty(bindings, field.bindingKey, 'bindings') : undefined

const readAnnotation = (annotations, annotationKey) => {
  if (!isPlainRecord(annotations)) throw new TypeError('annotations must be a plain object')
  return readOwnDataProperty(annotations, annotationKey, 'annotations')
}

const collectFields = ({ configure, diagnostics, limits }) => {
  const fields = []
  const ancestors = new Set()
  let limitReached = false
  let visitedNodes = 0

  const visitItems = (items, sourcePath, depth) => {
    if (limitReached) return
    if (depth > limits.maxConfigureDepth) {
      diagnostics.push(
        createDiagnostic('configure-limit-exceeded', 'Configure nesting exceeds the safe depth limit', { sourcePath }),
      )
      limitReached = true
      return
    }
    if (!Array.isArray(items)) {
      diagnostics.push(createDiagnostic('invalid-configure', 'Configure items must be an array', { sourcePath }))
      return
    }
    if (ancestors.has(items)) {
      diagnostics.push(createDiagnostic('cycle-detected', 'Configure items contain a cycle', { sourcePath }))
      return
    }
    ancestors.add(items)
    try {
      const length = readArrayLength(items, sourcePath)
      for (let index = 0; index < length; index += 1) {
        visitedNodes += 1
        if (visitedNodes > limits.maxJsonNodes) {
          diagnostics.push(createDiagnostic('configure-limit-exceeded', 'Configure node count exceeds the safe limit'))
          limitReached = true
          return
        }
        if (fields.length >= limits.maxFields) {
          diagnostics.push(createDiagnostic('configure-limit-exceeded', 'Configure field count exceeds the safe limit'))
          limitReached = true
          return
        }
        const fieldPath = `${sourcePath}[${index}]`
        let fieldValue
        try {
          fieldValue = readArrayDataProperty(items, index, sourcePath)
        } catch (error) {
          addIssueDiagnostic(diagnostics, error, { sourcePath: fieldPath })
          continue
        }
        if (!isPlainRecord(fieldValue)) {
          diagnostics.push(
            createDiagnostic('invalid-configure', 'Configure field must be a plain object', { sourcePath: fieldPath }),
          )
          continue
        }
        if (ancestors.has(fieldValue)) {
          diagnostics.push(
            createDiagnostic('cycle-detected', 'Configure field contains a cycle', { sourcePath: fieldPath }),
          )
          continue
        }
        ancestors.add(fieldValue)
        try {
          const name = readOwnDataProperty(fieldValue, 'name', fieldPath)
          const title = safeString(readOwnDataProperty(fieldValue, 'title', fieldPath), limits)
          const itemsValue = readOwnDataProperty(fieldValue, 'items', fieldPath)
          if (itemsValue !== undefined) {
            visitItems(itemsValue, `${fieldPath}.items`, depth + 1)
            continue
          }
          const normalizedName = typeof name === 'string' && name.length > 0 ? name : undefined
          const key = normalizedName === undefined ? readOwnDataProperty(fieldValue, 'key', fieldPath) : undefined
          const normalizedKey = typeof key === 'string' && key.length > 0 ? key : undefined
          const bindingKey = normalizedName || normalizedKey
          const ordinal = fields.length
          fields.push({
            bindingKey,
            fieldId: bindingKey ? `configure.${bindingKey}` : `configure.${fieldPath}`,
            name: normalizedName,
            ordinal,
            source: fieldValue,
            sourcePath: fieldPath,
            title,
            unsupportedFieldId: bindingKey ? `unsupported:${bindingKey}:binding` : `unsupported:anonymous:${ordinal}`,
          })
        } catch (error) {
          addIssueDiagnostic(diagnostics, error, { sourcePath: fieldPath })
        } finally {
          ancestors.delete(fieldValue)
        }
      }
    } finally {
      ancestors.delete(items)
    }
  }

  if (configure === undefined) return fields
  if (!isPlainRecord(configure)) {
    diagnostics.push(createDiagnostic('invalid-configure', 'metadata.configure must be a plain object'))
    return fields
  }
  try {
    const props = readOwnDataProperty(configure, 'props', 'metadata.configure')
    if (props !== undefined) visitItems(props, 'props', 0)
  } catch (error) {
    addIssueDiagnostic(diagnostics, error)
  }
  return fields
}

const compileFields = ({ annotations, bindings, diagnostics, fields, limits }) => {
  const compiled = []
  const seenFieldIds = new Set()
  const bindingKeyCounts = new Map()
  const bindingKeyOccurrences = new Map()
  for (const field of fields) {
    if (field.bindingKey) {
      bindingKeyCounts.set(field.bindingKey, (bindingKeyCounts.get(field.bindingKey) || 0) + 1)
    }
  }
  for (const field of fields) {
    let setterInfo
    let extraPropsInfo
    try {
      setterInfo = getSetterInfo(field.source)
      extraPropsInfo = getExtraPropsInfo(field.source)
    } catch (error) {
      addIssueDiagnostic(diagnostics, error, { fieldId: field.fieldId, sourcePath: field.sourcePath })
      compiled.push(createUnsupportedField(field))
      continue
    }

    const duplicateBindingKey = field.bindingKey && bindingKeyCounts.get(field.bindingKey) > 1
    const bindingKeyOccurrence = field.bindingKey ? (bindingKeyOccurrences.get(field.bindingKey) || 0) + 1 : undefined
    if (field.bindingKey) bindingKeyOccurrences.set(field.bindingKey, bindingKeyOccurrence)
    const annotationKey = resolveAnnotationKey(field, bindings)
    let result
    try {
      if (duplicateBindingKey) {
        diagnostics.push(
          createDiagnostic(
            'ambiguous-field-binding',
            'Duplicate same-material field binding keys cannot be bound safely',
            {
              fieldId: field.fieldId,
              sourcePath: field.sourcePath,
            },
          ),
        )
        result = createUnsupportedField({
          ...field,
          unsupportedFieldId: `${field.unsupportedFieldId}:${bindingKeyOccurrence}`,
        })
      } else if (annotationKey) {
        const annotation = readAnnotation(annotations, annotationKey)
        if (annotation === undefined) {
          throw new ManifestCompileIssue('missing-annotation', `Annotation ${annotationKey} is not defined`)
        }
        result = compileAnnotation({ annotation, annotationKey, field, limits })
      } else if (setterInfo.dynamic || extraPropsInfo.dynamic || hasDirectCallbackSemantics(field.source)) {
        diagnostics.push(
          createDiagnostic(
            'callback-annotation-required',
            'Callback-backed or dynamic field requires an explicit annotation',
            {
              fieldId: field.fieldId,
              sourcePath: field.sourcePath,
            },
          ),
        )
        result = createUnsupportedField(field)
      } else {
        result = compileFallbackField({ diagnostics, extraPropsInfo, field, limits, setterInfo })
      }
    } catch (error) {
      addIssueDiagnostic(diagnostics, error, {
        fieldId: annotationKey || field.fieldId,
        sourcePath: field.sourcePath,
      })
      result = createUnsupportedField(
        annotationKey ? { ...field, fieldId: annotationKey, unsupportedFieldId: annotationKey } : field,
      )
    }

    if (seenFieldIds.has(result.fieldId)) {
      diagnostics.push(
        createDiagnostic('duplicate-field-id', 'Duplicate safe manifest field id was rejected', {
          fieldId: result.fieldId,
          sourcePath: field.sourcePath,
        }),
      )
      continue
    }
    seenFieldIds.add(result.fieldId)
    compiled.push(result)
  }
  return compiled.sort((left, right) => compareUtf16(left.fieldId, right.fieldId))
}

const compareDiagnostics = (left, right) =>
  compareUtf16(left.code, right.code) ||
  compareUtf16(left.fieldId || '', right.fieldId || '') ||
  compareUtf16(left.sourcePath || '', right.sourcePath || '') ||
  compareUtf16(left.message, right.message)

const manifestByteLength = value => new TextEncoder().encode(JSON.stringify(value)).byteLength

const createReadiness = (componentName, fields) => {
  const emittedFieldIds = new Set(fields.map(field => field.fieldId))
  const requirements = readOwnDataProperty(DASHBOARD_MATERIAL_READINESS_REQUIREMENTS, componentName, 'readiness') || []
  const missingFieldIds = requirements.filter(fieldId => !emittedFieldIds.has(fieldId))
  const unsupportedFieldIds = fields.filter(field => field.access === 'unsupported').map(field => field.fieldId)
  return {
    missingFieldIds,
    status: missingFieldIds.length || unsupportedFieldIds.length ? 'not-ready' : 'ready',
    unsupportedFieldIds,
  }
}

const createFailureManifest = (componentName, materialRegistryVersion, code, message) =>
  deepFreezeJson({
    componentName,
    diagnostics: [createDiagnostic(code, message)],
    fields: [],
    materialRegistryVersion,
    readiness: {
      missingFieldIds: readOwnDataProperty(DASHBOARD_MATERIAL_READINESS_REQUIREMENTS, componentName, 'readiness') || [],
      status: 'not-ready',
      unsupportedFieldIds: [],
    },
    schemaVersion: SAFE_MATERIAL_MANIFEST_SCHEMA_VERSION,
  })

export const compileSafeMaterialManifest = ({
  annotationBindings,
  annotations = dashboardConfigureAnnotations,
  limits: limitOverrides,
  materialRegistryVersion,
  metadata,
}) => {
  const limits = normalizeLimits(limitOverrides)
  const componentName = normalizeComponentName(metadata)
  const normalizedRegistryVersion = normalizeRegistryVersion(materialRegistryVersion)
  const diagnostics = []
  let bindings = {}
  try {
    bindings = buildAnnotationBindings(componentName, annotationBindings)
  } catch (error) {
    addIssueDiagnostic(diagnostics, error)
  }
  let configure
  try {
    configure = readOwnDataProperty(metadata, 'configure', 'metadata')
  } catch (error) {
    addIssueDiagnostic(diagnostics, error)
  }
  const sourceFields = collectFields({ configure, diagnostics, limits })
  const fields = compileFields({ annotations, bindings, diagnostics, fields: sourceFields, limits })
  const metadataLabels = {}
  for (const key of ['category', 'group', 'title']) {
    try {
      const value = safeString(readOwnDataProperty(metadata, key, 'metadata'), limits)
      if (value) metadataLabels[key] = value
    } catch (error) {
      addIssueDiagnostic(diagnostics, error)
    }
  }
  const manifest = {
    componentName,
    diagnostics: diagnostics.sort(compareDiagnostics),
    fields,
    materialRegistryVersion: normalizedRegistryVersion,
    readiness: createReadiness(componentName, fields),
    schemaVersion: SAFE_MATERIAL_MANIFEST_SCHEMA_VERSION,
    ...metadataLabels,
  }

  if (manifestByteLength(manifest) > limits.maxManifestBytes) {
    manifest.fields = []
    manifest.diagnostics = [
      createDiagnostic('manifest-limit-exceeded', 'Compiled manifest exceeds the safe byte limit and was discarded'),
    ]
    manifest.readiness = createReadiness(componentName, manifest.fields)
  }
  return deepFreezeJson(manifest)
}

export class SafeMaterialManifestCache {
  #entries = new Map()
  #generation = 0
  #limits
  #loadAnnotationBindings
  #loadAnnotations
  #loadMetadata
  #materialRegistryVersion
  #readMaterialRegistryVersion

  constructor({ loadAnnotationBindings, loadAnnotations, loadMetadata, limits, readMaterialRegistryVersion } = {}) {
    if (typeof loadMetadata !== 'function') throw new TypeError('loadMetadata must be a function')
    if (typeof readMaterialRegistryVersion !== 'function') {
      throw new TypeError('readMaterialRegistryVersion must be a function')
    }
    if (loadAnnotations !== undefined && typeof loadAnnotations !== 'function') {
      throw new TypeError('loadAnnotations must be a function')
    }
    if (loadAnnotationBindings !== undefined && typeof loadAnnotationBindings !== 'function') {
      throw new TypeError('loadAnnotationBindings must be a function')
    }
    this.#loadMetadata = loadMetadata
    this.#readMaterialRegistryVersion = readMaterialRegistryVersion
    this.#loadAnnotations = loadAnnotations
    this.#loadAnnotationBindings = loadAnnotationBindings
    this.#limits = normalizeLimits(limits)
  }

  get size() {
    return this.#entries.size
  }

  get materialRegistryVersion() {
    return this.#materialRegistryVersion
  }

  async get(componentName, materialRegistryVersion) {
    if (typeof componentName !== 'string' || componentName.length === 0) {
      throw new TypeError('componentName must be a non-empty string')
    }
    const requestedVersion = normalizeRegistryVersion(materialRegistryVersion)
    const observedVersion = normalizeRegistryVersion(await this.#readMaterialRegistryVersion())
    if (!Object.is(requestedVersion, observedVersion)) {
      return createFailureManifest(
        componentName,
        requestedVersion,
        'stale-material-registry-version',
        'Requested material registry version is stale',
      )
    }
    if (!Object.is(observedVersion, this.#materialRegistryVersion)) {
      this.#entries.clear()
      this.#generation += 1
      this.#materialRegistryVersion = observedVersion
    }
    const cached = this.#entries.get(componentName)
    if (cached) return cached
    const generation = this.#generation
    const pending = (async () => {
      let manifest
      try {
        const metadata = await this.#loadMetadata(componentName)
        if (normalizeComponentName(metadata) !== componentName) {
          manifest = createFailureManifest(
            componentName,
            observedVersion,
            'material-component-name-mismatch',
            'Loaded material metadata did not match the requested component',
          )
        } else {
          manifest = compileSafeMaterialManifest({
            annotationBindings: await this.#loadAnnotationBindings?.(componentName),
            annotations: (await this.#loadAnnotations?.(componentName)) ?? dashboardConfigureAnnotations,
            limits: this.#limits,
            materialRegistryVersion: observedVersion,
            metadata,
          })
        }
      } catch {
        manifest = createFailureManifest(
          componentName,
          observedVersion,
          'material-load-failed',
          'Material metadata could not be loaded safely',
        )
      }

      let observedAfterCompile
      try {
        observedAfterCompile = normalizeRegistryVersion(await this.#readMaterialRegistryVersion())
      } catch {
        observedAfterCompile = undefined
      }
      if (
        generation !== this.#generation ||
        !Object.is(observedVersion, this.#materialRegistryVersion) ||
        !Object.is(observedVersion, observedAfterCompile)
      ) {
        return createFailureManifest(
          componentName,
          observedVersion,
          'stale-material-registry-version',
          'Material registry changed while the manifest was compiling',
        )
      }
      return manifest
    })()
    this.#entries.set(componentName, pending)
    return pending
  }

  invalidate(materialRegistryVersion) {
    this.#entries.clear()
    this.#generation += 1
    this.#materialRegistryVersion =
      materialRegistryVersion === undefined ? undefined : normalizeRegistryVersion(materialRegistryVersion)
  }
}

export const createSafeMaterialManifestCache = options => new SafeMaterialManifestCache(options)
