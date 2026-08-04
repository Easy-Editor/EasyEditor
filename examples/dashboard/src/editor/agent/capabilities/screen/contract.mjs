export const SCREEN_CHANGESET_SCHEMA_VERSION = 1

export const DEFAULT_SCREEN_CHANGESET_LIMITS = Object.freeze({
  maxArrayLength: 10_000,
  maxDocumentNodes: 10_000,
  maxFieldsPerManifest: 512,
  maxInputBytes: 1_048_576,
  maxJsonDepth: 32,
  maxJsonNodes: 50_000,
  maxManifests: 512,
  maxOperations: 100,
  maxOutputBytes: 4_194_304,
  maxPathSegmentLength: 128,
  maxPathSegments: 16,
  maxStringLength: 262_144,
})

const LIMIT_KEYS = Object.freeze(Object.keys(DEFAULT_SCREEN_CHANGESET_LIMITS))

export const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

export class ScreenChangeSetCompileError extends TypeError {
  constructor(code, reason, path = 'compileInput') {
    super(`${path}: ${reason}`)
    this.name = 'ScreenChangeSetCompileError'
    this.code = code
    this.reason = reason
    this.path = path
  }

  toJSON() {
    return {
      schemaVersion: SCREEN_CHANGESET_SCHEMA_VERSION,
      code: this.code,
      reason: this.reason,
      path: this.path,
    }
  }
}

export const fail = (code, reason, path) => {
  throw new ScreenChangeSetCompileError(code, reason, path)
}

export const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const descriptorsFor = (value, path) => {
  try {
    return Object.getOwnPropertyDescriptors(value)
  } catch {
    return fail('INVALID_CHANGESET', 'object-could-not-be-inspected-safely', path)
  }
}

export const assertExactRecord = (value, required, optional, path, code = 'INVALID_CHANGESET') => {
  let plain = false
  try {
    plain = isPlainRecord(value)
  } catch {
    return fail(code, 'object-could-not-be-inspected-safely', path)
  }
  if (!plain) return fail(code, 'must-be-a-plain-object', path)

  const descriptors = descriptorsFor(value, path)
  let symbols
  try {
    symbols = Object.getOwnPropertySymbols(value)
  } catch {
    return fail(code, 'object-could-not-be-inspected-safely', path)
  }
  if (symbols.length > 0) return fail(code, 'symbol-fields-are-not-allowed', path)

  const allowed = new Set([...required, ...optional])
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      return fail(code, 'fields-must-be-enumerable-data-properties', `${path}.${key}`)
    }
    if (!allowed.has(key)) return fail(code, 'fields-must-match-contract', `${path}.${key}`)
  }
  for (const key of required) {
    if (!Object.hasOwn(descriptors, key)) return fail(code, `missing-${key}`, path)
  }
  return value
}

export const ownDataValue = (value, key, path, code = 'INVALID_CHANGESET') => {
  let descriptor
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(code, 'object-could-not-be-inspected-safely', path)
  }
  if (!descriptor || !('value' in descriptor)) return fail(code, `missing-${String(key)}`, path)
  return descriptor.value
}

export const optionalOwnDataValue = (value, key, path, code = 'INVALID_CHANGESET') => {
  let descriptor
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(code, 'object-could-not-be-inspected-safely', path)
  }
  if (!descriptor) return undefined
  if (!('value' in descriptor)) return fail(code, 'accessor-properties-are-not-allowed', `${path}.${String(key)}`)
  return descriptor.value
}

export const requireSchemaVersion = (value, path) => {
  if (value !== SCREEN_CHANGESET_SCHEMA_VERSION) {
    return fail('INVALID_CHANGESET', 'unsupported-schema-version', path)
  }
  return value
}

export const requireNonEmptyString = (value, path, { maxLength = 256, code = 'INVALID_CHANGESET' } = {}) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return fail(code, 'must-be-a-bounded-non-empty-string', path)
  }
  return value
}

export const requireNonNegativeInteger = (value, path, code = 'INVALID_CHANGESET') => {
  if (!Number.isSafeInteger(value) || value < 0) return fail(code, 'must-be-a-non-negative-safe-integer', path)
  return value
}

export const requirePositiveInteger = (value, path) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return fail('INVALID_CHANGESET', 'must-be-a-positive-safe-integer', path)
  }
  return value
}

export const normalizeLimits = options => {
  if (options === undefined) return DEFAULT_SCREEN_CHANGESET_LIMITS
  assertExactRecord(options, [], ['limits'], 'compileOptions')
  const override = optionalOwnDataValue(options, 'limits', 'compileOptions')
  if (override === undefined) return DEFAULT_SCREEN_CHANGESET_LIMITS
  assertExactRecord(override, [], LIMIT_KEYS, 'compileOptions.limits')
  const normalized = { ...DEFAULT_SCREEN_CHANGESET_LIMITS }
  for (const key of LIMIT_KEYS) {
    const value = optionalOwnDataValue(override, key, 'compileOptions.limits')
    if (value !== undefined) normalized[key] = requirePositiveInteger(value, `compileOptions.limits.${key}`)
  }
  return Object.freeze(normalized)
}

const cloneJsonArray = (value, path, limits, state, depth) => {
  if (value.length > limits.maxArrayLength) return fail('BUDGET_EXCEEDED', 'array-is-too-large', path)
  let keys
  try {
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('INVALID_JSON', 'array-could-not-be-inspected-safely', path)
  }
  const expected = Array.from({ length: value.length }, (_, index) => String(index))
  const dataKeys = keys.filter(key => key !== 'length')
  if (
    dataKeys.length !== expected.length ||
    dataKeys.some((key, index) => typeof key !== 'string' || key !== expected[index])
  ) {
    return fail('INVALID_JSON', 'must-be-a-dense-json-array', path)
  }
  return expected.map((key, index) => {
    let descriptor
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    } catch {
      return fail('INVALID_JSON', 'array-could-not-be-inspected-safely', `${path}[${index}]`)
    }
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return fail('INVALID_JSON', 'array-items-must-be-enumerable-data-properties', `${path}[${index}]`)
    }
    return cloneJsonInternal(descriptor.value, `${path}[${index}]`, limits, state, depth + 1)
  })
}

const cloneJsonRecord = (value, path, limits, state, depth) => {
  let plain = false
  try {
    plain = isPlainRecord(value)
  } catch {
    return fail('INVALID_JSON', 'object-could-not-be-inspected-safely', path)
  }
  if (!plain) return fail('INVALID_JSON', 'must-be-json-data', path)
  let keys
  try {
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('INVALID_JSON', 'object-could-not-be-inspected-safely', path)
  }
  if (keys.some(key => typeof key !== 'string')) return fail('INVALID_JSON', 'symbol-fields-are-not-json', path)
  return Object.fromEntries(
    keys.sort(compareCodeUnits).map(key => {
      if (key.length > limits.maxStringLength) return fail('BUDGET_EXCEEDED', 'json-key-is-too-large', path)
      let descriptor
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      } catch {
        return fail('INVALID_JSON', 'object-could-not-be-inspected-safely', `${path}.${key}`)
      }
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        return fail('INVALID_JSON', 'json-fields-must-be-enumerable-data-properties', `${path}.${key}`)
      }
      return [key, cloneJsonInternal(descriptor.value, `${path}.${key}`, limits, state, depth + 1)]
    }),
  )
}

const cloneJsonInternal = (value, path, limits, state, depth) => {
  state.nodes += 1
  if (state.nodes > limits.maxJsonNodes) return fail('BUDGET_EXCEEDED', 'json-node-budget-exceeded', path)
  if (depth > limits.maxJsonDepth) return fail('BUDGET_EXCEEDED', 'json-depth-budget-exceeded', path)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.length > limits.maxStringLength) return fail('BUDGET_EXCEEDED', 'json-string-is-too-large', path)
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail('INVALID_JSON', 'numbers-must-be-finite', path)
    return value
  }
  if (typeof value !== 'object') return fail('INVALID_JSON', 'must-be-json-data', path)
  if (state.ancestors.has(value)) return fail('INVALID_JSON', 'cyclic-json-is-not-allowed', path)
  state.ancestors.add(value)
  try {
    return Array.isArray(value)
      ? cloneJsonArray(value, path, limits, state, depth)
      : cloneJsonRecord(value, path, limits, state, depth)
  } finally {
    state.ancestors.delete(value)
  }
}

export const cloneJsonValue = (value, path, limits) =>
  cloneJsonInternal(value, path, limits, { ancestors: new Set(), nodes: 0 }, 0)

export const canonicalJsonString = (value, limits = DEFAULT_SCREEN_CHANGESET_LIMITS) =>
  JSON.stringify(cloneJsonValue(value, 'canonicalValue', limits))

export const jsonEqual = (left, right, limits) => {
  try {
    return canonicalJsonString(left, limits) === canonicalJsonString(right, limits)
  } catch {
    return false
  }
}

export const freezeDto = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const entry of Object.values(value)) freezeDto(entry)
  }
  return value
}

const SCHEMA_KEYS = new Set([
  'additionalProperties',
  'default',
  'description',
  'enum',
  'items',
  'maximum',
  'maxItems',
  'maxLength',
  'minimum',
  'minItems',
  'minLength',
  'multipleOf',
  'properties',
  'required',
  'title',
  'type',
])

const valueTypeMatches = (value, type) => {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isPlainRecord(value)
  if (type === 'integer') return Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'string') return typeof value === 'string'
  return false
}

const requireSchemaNumber = (schema, key, path) => {
  const value = schema[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('UNSUPPORTED_VALUE_SCHEMA', `${key}-must-be-finite`, `${path}.${key}`)
  }
  return value
}

const validateSchemaInternal = (value, schema, path, schemaPath, limits, depth) => {
  if (depth > limits.maxJsonDepth) return fail('BUDGET_EXCEEDED', 'value-schema-depth-exceeded', schemaPath)
  if (!isPlainRecord(schema)) return fail('UNSUPPORTED_VALUE_SCHEMA', 'schema-must-be-a-plain-object', schemaPath)
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_KEYS.has(key))
      return fail('UNSUPPORTED_VALUE_SCHEMA', 'unsupported-schema-keyword', `${schemaPath}.${key}`)
  }

  const type = schema.type
  if (type !== undefined) {
    const allowedTypes = Array.isArray(type) ? type : [type]
    if (
      allowedTypes.length === 0 ||
      allowedTypes.some(item => !['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'].includes(item))
    ) {
      return fail('UNSUPPORTED_VALUE_SCHEMA', 'unsupported-schema-type', `${schemaPath}.type`)
    }
    if (!allowedTypes.some(item => valueTypeMatches(value, item))) {
      return fail('VALUE_CONSTRAINT', 'value-does-not-match-type', path)
    }
  }

  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      return fail('UNSUPPORTED_VALUE_SCHEMA', 'enum-must-be-a-non-empty-array', `${schemaPath}.enum`)
    }
    if (!schema.enum.some(candidate => jsonEqual(candidate, value, limits))) {
      return fail('VALUE_CONSTRAINT', 'value-is-not-in-enum', path)
    }
  }

  if (typeof value === 'number') {
    const minimum = requireSchemaNumber(schema, 'minimum', schemaPath)
    const maximum = requireSchemaNumber(schema, 'maximum', schemaPath)
    const multipleOf = requireSchemaNumber(schema, 'multipleOf', schemaPath)
    if (minimum !== undefined && value < minimum) return fail('VALUE_CONSTRAINT', 'value-is-below-minimum', path)
    if (maximum !== undefined && value > maximum) return fail('VALUE_CONSTRAINT', 'value-is-above-maximum', path)
    if (multipleOf !== undefined) {
      if (multipleOf <= 0)
        return fail('UNSUPPORTED_VALUE_SCHEMA', 'multipleOf-must-be-positive', `${schemaPath}.multipleOf`)
      const quotient = value / multipleOf
      if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * 16) {
        return fail('VALUE_CONSTRAINT', 'value-is-not-a-multiple', path)
      }
    }
  }

  if (typeof value === 'string') {
    const minLength = schema.minLength
    const maxLength = schema.maxLength
    if (minLength !== undefined && (!Number.isSafeInteger(minLength) || minLength < 0)) {
      return fail('UNSUPPORTED_VALUE_SCHEMA', 'minLength-is-invalid', `${schemaPath}.minLength`)
    }
    if (maxLength !== undefined && (!Number.isSafeInteger(maxLength) || maxLength < 0)) {
      return fail('UNSUPPORTED_VALUE_SCHEMA', 'maxLength-is-invalid', `${schemaPath}.maxLength`)
    }
    if (minLength !== undefined && value.length < minLength)
      return fail('VALUE_CONSTRAINT', 'string-is-too-short', path)
    if (maxLength !== undefined && value.length > maxLength) return fail('VALUE_CONSTRAINT', 'string-is-too-long', path)
  }

  if (Array.isArray(value)) {
    for (const keyword of ['minItems', 'maxItems']) {
      if (schema[keyword] !== undefined && (!Number.isSafeInteger(schema[keyword]) || schema[keyword] < 0)) {
        return fail('UNSUPPORTED_VALUE_SCHEMA', `${keyword}-is-invalid`, `${schemaPath}.${keyword}`)
      }
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return fail('VALUE_CONSTRAINT', 'array-has-too-few-items', path)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return fail('VALUE_CONSTRAINT', 'array-has-too-many-items', path)
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) =>
        validateSchemaInternal(item, schema.items, `${path}[${index}]`, `${schemaPath}.items`, limits, depth + 1),
      )
    }
  }

  if (isPlainRecord(value)) {
    const properties = schema.properties
    if (properties !== undefined && !isPlainRecord(properties)) {
      return fail('UNSUPPORTED_VALUE_SCHEMA', 'properties-must-be-an-object', `${schemaPath}.properties`)
    }
    const required = schema.required
    if (required !== undefined) {
      if (!Array.isArray(required) || required.some(key => typeof key !== 'string' || key.length === 0)) {
        return fail('UNSUPPORTED_VALUE_SCHEMA', 'required-must-be-a-string-array', `${schemaPath}.required`)
      }
      for (const key of required) {
        if (!Object.hasOwn(value, key))
          return fail('VALUE_CONSTRAINT', 'required-property-is-missing', `${path}.${key}`)
      }
    }
    if (properties) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (Object.hasOwn(value, key)) {
          validateSchemaInternal(
            value[key],
            childSchema,
            `${path}.${key}`,
            `${schemaPath}.properties.${key}`,
            limits,
            depth + 1,
          )
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key))
            return fail('VALUE_CONSTRAINT', 'additional-property-is-not-allowed', `${path}.${key}`)
        }
      } else if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
        if (!isPlainRecord(schema.additionalProperties)) {
          return fail(
            'UNSUPPORTED_VALUE_SCHEMA',
            'additionalProperties-must-be-boolean-or-schema',
            `${schemaPath}.additionalProperties`,
          )
        }
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) {
            validateSchemaInternal(
              value[key],
              schema.additionalProperties,
              `${path}.${key}`,
              `${schemaPath}.additionalProperties`,
              limits,
              depth + 1,
            )
          }
        }
      }
    }
  }
}

export const validateValueSchema = (value, schema, path, limits) => {
  if (schema === undefined) return
  validateSchemaInternal(value, schema, path, 'manifest.valueSchema', limits, 0)
}
