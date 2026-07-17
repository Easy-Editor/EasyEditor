import {
  DEFAULT_DASHBOARD_DATA_LIMITS,
  DashboardDataCapabilityError,
  parseSafeDataBinding,
  parseSafeDataBindings,
  parseSafeDataCatalog,
  parseSafeDataDescriptor,
  summarizeSafeDataDescriptor,
} from './contract.mjs'

export * from './contract.mjs'

export const DASHBOARD_DATA_CAPABILITIES = Object.freeze(['data.bind', 'data.inspect', 'data.preview', 'data.upsert'])

const BINDING_COMPONENT_FIELDS = Object.freeze({
  BarChart: Object.freeze(['data']),
  LineChart: Object.freeze(['data']),
  Text: Object.freeze(['text']),
})
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u

const DATA_SOURCES_FIELD = Object.freeze({
  fieldId: 'dataSources',
  access: 'read-write',
  readPath: Object.freeze(['props', 'dataSources']),
  writeTargets: Object.freeze([Object.freeze({ path: Object.freeze(['props', 'dataSources']) })]),
  unsetTargets: Object.freeze([Object.freeze({ path: Object.freeze(['props', 'dataSources']) })]),
  verifyPaths: Object.freeze([Object.freeze(['props', 'dataSources'])]),
  valueSchema: Object.freeze({ type: 'object' }),
})

const DATA_BINDINGS_FIELD = Object.freeze({
  fieldId: 'dataBindings',
  access: 'read-write',
  readPath: Object.freeze(['props', 'dataBindings']),
  writeTargets: Object.freeze([Object.freeze({ path: Object.freeze(['props', 'dataBindings']) })]),
  unsetTargets: Object.freeze([Object.freeze({ path: Object.freeze(['props', 'dataBindings']) })]),
  verifyPaths: Object.freeze([Object.freeze(['props', 'dataBindings'])]),
  valueSchema: Object.freeze({ type: 'object' }),
})

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

const ownValue = (value, key, path, optional = false) => {
  let descriptor
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  } catch {
    throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', 'object-could-not-be-inspected-safely', path)
  }
  if (!descriptor) {
    if (optional) return undefined
    throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', `missing-${key}`, path)
  }
  if (!descriptor.enumerable || !('value' in descriptor)) {
    throw new DashboardDataCapabilityError(
      'INVALID_DATA_REQUEST',
      'properties-must-be-enumerable-data-properties',
      `${path}.${key}`,
    )
  }
  return descriptor.value
}

const exactRecord = (value, required, optional, path) => {
  if (!isPlainRecord(value)) {
    throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', 'must-be-a-plain-object', path)
  }
  let descriptors
  let symbols
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
    symbols = Object.getOwnPropertySymbols(value)
  } catch {
    throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', 'object-could-not-be-inspected-safely', path)
  }
  if (symbols.length > 0) {
    throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', 'symbol-properties-are-not-allowed', path)
  }
  const allowed = new Set([...required, ...optional])
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new DashboardDataCapabilityError(
        'INVALID_DATA_REQUEST',
        'properties-must-be-enumerable-data-properties',
        `${path}.${key}`,
      )
    }
    if (!allowed.has(key)) {
      throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', 'fields-must-match-contract', `${path}.${key}`)
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(descriptors, key)) {
      throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', `missing-${key}`, path)
    }
  }
}

const requireSchemaVersion = (value, path) => {
  if (value !== 1) throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', 'unsupported-schema-version', path)
}

const requireString = (value, path, maximum = 256) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', 'must-be-a-bounded-non-empty-string', path)
  }
  return value
}

const requireIdentifier = (value, path, maximum = 256) => {
  const identifier = requireString(value, path, maximum)
  if (!SAFE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new DashboardDataCapabilityError('INVALID_DATA_REQUEST', 'identifier-is-not-safe', path)
  }
  return identifier
}

const freezeDto = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezeDto(child)
  return Object.freeze(value)
}

const augmentManifest = (manifest, componentName) => {
  const field =
    componentName === 'Root' ? DATA_SOURCES_FIELD : BINDING_COMPONENT_FIELDS[componentName] ? DATA_BINDINGS_FIELD : null
  if (!field) return manifest
  const fields = [...manifest.fields.filter(candidate => candidate.fieldId !== field.fieldId), field]
  fields.sort((left, right) => (left.fieldId < right.fieldId ? -1 : left.fieldId > right.fieldId ? 1 : 0))
  const missingFieldIds = manifest.readiness.missingFieldIds.filter(fieldId => fieldId !== field.fieldId)
  const unsupportedFieldIds = manifest.readiness.unsupportedFieldIds.filter(fieldId => fieldId !== field.fieldId)
  return freezeDto({
    ...structuredClone(manifest),
    fields,
    readiness: {
      status: missingFieldIds.length === 0 && unsupportedFieldIds.length === 0 ? 'ready' : 'not-ready',
      missingFieldIds,
      unsupportedFieldIds,
    },
  })
}

export const createDashboardDataManifestCache = baseManifestCache => {
  if (typeof baseManifestCache?.get !== 'function') throw new TypeError('baseManifestCache.get is required')
  return Object.freeze({
    async get(componentName, materialRegistryVersion) {
      return augmentManifest(await baseManifestCache.get(componentName, materialRegistryVersion), componentName)
    },
  })
}

export const isDashboardDataCapability = capability => DASHBOARD_DATA_CAPABILITIES.includes(capability)

const currentSchema = engine => {
  const document = engine?.project?.currentDocument
  if (!document || typeof document.exportRaw !== 'function') {
    throw new DashboardDataCapabilityError('DATA_UNAVAILABLE', 'current-document-is-unavailable', 'data')
  }
  return { document, schema: document.exportRaw() }
}

const pageScope = document =>
  freezeDto({
    kind: 'page',
    documentId: requireString(document.id, 'data.scope.documentId', 256),
  })

const findNode = (schema, nodeId) => {
  const pending = [schema]
  const visited = new Set()
  let count = 0
  while (pending.length > 0) {
    const node = pending.shift()
    count += 1
    if (count > 10_000) {
      throw new DashboardDataCapabilityError('DATA_BUDGET_EXCEEDED', 'document-node-budget-exceeded', 'data.bind')
    }
    if (!isPlainRecord(node) || visited.has(node)) continue
    visited.add(node)
    if (ownValue(node, 'id', 'node', true) === nodeId) return node
    const children = ownValue(node, 'children', 'node', true)
    if (Array.isArray(children)) pending.push(...children)
  }
  return null
}

const readProp = (node, propName) => {
  const props = ownValue(node, 'props', 'node', true)
  if (!isPlainRecord(props)) return undefined
  return ownValue(props, propName, 'node.props', true)
}

const readCatalog = schema => parseSafeDataCatalog(readProp(schema, 'dataSources'))

const legacySourceIds = value => {
  if (!isPlainRecord(value)) return []
  const list = ownValue(value, 'list', 'legacyDataSource', true)
  if (!Array.isArray(list)) return []
  const ids = []
  for (let index = 0; index < list.length; index += 1) {
    const entry = ownValue(list, String(index), `legacyDataSource.list[${index}]`)
    if (!isPlainRecord(entry)) continue
    const id = ownValue(entry, 'id', `legacyDataSource.list[${index}]`, true)
    if (typeof id === 'string' && id.length > 0) ids.push(id)
  }
  return ids
}

const assertNoLegacySourceConflict = (engine, rootSchema, sourceId) => {
  const projectSchema = typeof engine.project.export === 'function' ? engine.project.export() : {}
  const projectDataSource = isPlainRecord(projectSchema)
    ? ownValue(projectSchema, 'dataSource', 'projectSchema', true)
    : undefined
  const rootDataSource = ownValue(rootSchema, 'dataSource', 'rootSchema', true)
  if ([...legacySourceIds(projectDataSource), ...legacySourceIds(rootDataSource)].includes(sourceId)) {
    throw new DashboardDataCapabilityError(
      'DATA_SOURCE_CONFLICT',
      'source-id-conflicts-with-legacy-data-source',
      'data.upsert.arguments.descriptor.id',
    )
  }
}

const screenCall = (call, documentId, operation) =>
  freezeDto({
    ...call,
    capability: 'screen.applyChangeSet',
    arguments: { schemaVersion: 1, documentId, operations: [operation] },
  })

const normalizeInspectArguments = value => {
  exactRecord(value, ['schemaVersion'], ['sourceId'], 'data.inspect.arguments')
  requireSchemaVersion(
    ownValue(value, 'schemaVersion', 'data.inspect.arguments'),
    'data.inspect.arguments.schemaVersion',
  )
  const sourceIdValue = ownValue(value, 'sourceId', 'data.inspect.arguments', true)
  return sourceIdValue === undefined
    ? undefined
    : requireIdentifier(sourceIdValue, 'data.inspect.arguments.sourceId', 128)
}

const normalizePreviewArguments = value => {
  exactRecord(value, ['schemaVersion'], ['descriptor', 'sourceId'], 'data.preview.arguments')
  requireSchemaVersion(
    ownValue(value, 'schemaVersion', 'data.preview.arguments'),
    'data.preview.arguments.schemaVersion',
  )
  const sourceIdValue = ownValue(value, 'sourceId', 'data.preview.arguments', true)
  const descriptorValue = ownValue(value, 'descriptor', 'data.preview.arguments', true)
  if ((sourceIdValue === undefined) === (descriptorValue === undefined)) {
    throw new DashboardDataCapabilityError(
      'INVALID_DATA_REQUEST',
      'exactly-one-of-sourceId-or-descriptor-is-required',
      'data.preview.arguments',
    )
  }
  return sourceIdValue === undefined
    ? { descriptor: parseSafeDataDescriptor(descriptorValue) }
    : { sourceId: requireIdentifier(sourceIdValue, 'data.preview.arguments.sourceId', 128) }
}

const normalizeUpsertArguments = value => {
  exactRecord(value, ['schemaVersion', 'descriptor'], [], 'data.upsert.arguments')
  requireSchemaVersion(ownValue(value, 'schemaVersion', 'data.upsert.arguments'), 'data.upsert.arguments.schemaVersion')
  return parseSafeDataDescriptor(ownValue(value, 'descriptor', 'data.upsert.arguments'))
}

const normalizeBindArguments = value => {
  exactRecord(value, ['schemaVersion', 'nodeId', 'field', 'binding'], [], 'data.bind.arguments')
  requireSchemaVersion(ownValue(value, 'schemaVersion', 'data.bind.arguments'), 'data.bind.arguments.schemaVersion')
  const field = ownValue(value, 'field', 'data.bind.arguments')
  if (field !== 'text' && field !== 'data') {
    throw new DashboardDataCapabilityError(
      'INVALID_DATA_REQUEST',
      'field-must-be-text-or-data',
      'data.bind.arguments.field',
    )
  }
  return {
    nodeId: requireIdentifier(ownValue(value, 'nodeId', 'data.bind.arguments'), 'data.bind.arguments.nodeId', 128),
    field,
    binding: parseSafeDataBinding(ownValue(value, 'binding', 'data.bind.arguments')),
  }
}

const previewSummary = value => {
  if (Array.isArray(value)) {
    if (value.length > DEFAULT_DASHBOARD_DATA_LIMITS.maxRows) {
      throw new DashboardDataCapabilityError('DATA_BUDGET_EXCEEDED', 'preview-row-budget-exceeded', 'data.preview')
    }
    return freezeDto({ kind: 'rows', rowCount: value.length, sample: structuredClone(value.slice(0, 20)) })
  }
  if (isPlainRecord(value)) {
    return freezeDto({ kind: 'object', keys: Object.keys(value).sort().slice(0, 100), sample: structuredClone(value) })
  }
  return freezeDto({ kind: 'scalar', sample: value })
}

export const createDashboardDataCapabilityService = ({
  authority,
  engine,
  recoverInvocation,
  resolver,
  screenApplyChangeSet,
}) => {
  if (!authority || typeof authority.projectId !== 'string') throw new TypeError('data authority is required')
  if (!engine?.project) throw new TypeError('data engine is required')
  if (typeof recoverInvocation !== 'function') throw new TypeError('data recoverInvocation is required')
  if (typeof resolver?.resolve !== 'function') throw new TypeError('data resolver.resolve is required')
  if (typeof screenApplyChangeSet !== 'function') throw new TypeError('data screenApplyChangeSet is required')

  const recoverWrite = async call =>
    recoverInvocation({
      projectId: authority.projectId,
      branchId: authority.branchId,
      callId: requireString(ownValue(call, 'callId', 'data.write'), 'data.write.callId', 256),
    })

  return Object.freeze({
    async inspect(call) {
      const sourceId = normalizeInspectArguments(call.arguments)
      const { document, schema } = currentSchema(engine)
      const sources = readCatalog(schema)
        .sources.filter(source => sourceId === undefined || source.id === sourceId)
        .map(summarizeSafeDataDescriptor)
      if (sourceId !== undefined && sources.length === 0) {
        throw new DashboardDataCapabilityError('DATA_SOURCE_NOT_FOUND', 'source-does-not-exist', 'data.inspect')
      }
      return freezeDto({ schemaVersion: 1, scope: pageScope(document), sources })
    },

    async preview(call) {
      const request = normalizePreviewArguments(call.arguments)
      const { document, schema } = currentSchema(engine)
      let descriptor = request.descriptor
      if (!descriptor) {
        descriptor = readCatalog(schema).sources.find(source => source.id === request.sourceId)
      }
      if (!descriptor) {
        throw new DashboardDataCapabilityError('DATA_SOURCE_NOT_FOUND', 'source-does-not-exist', 'data.preview')
      }
      const resolved = await resolver.resolve(descriptor, {
        projectId: authority.projectId,
        limits: DEFAULT_DASHBOARD_DATA_LIMITS,
      })
      return freezeDto({
        schemaVersion: 1,
        scope: pageScope(document),
        source: summarizeSafeDataDescriptor(descriptor),
        preview: previewSummary(resolved),
      })
    },

    async upsert(call) {
      const recovered = await recoverWrite(call)
      if (recovered !== null) return recovered
      const descriptor = normalizeUpsertArguments(call.arguments)
      const { document, schema } = currentSchema(engine)
      assertNoLegacySourceConflict(engine, schema, descriptor.id)
      const catalog = readCatalog(schema)
      const sources = catalog.sources.filter(source => source.id !== descriptor.id)
      sources.push(descriptor)
      sources.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      const nextCatalog = parseSafeDataCatalog({ schemaVersion: 1, sources })
      return screenApplyChangeSet(
        screenCall(call, document.id, {
          opId: `data-upsert:${descriptor.id}`,
          type: 'set',
          nodeId: schema.id,
          fieldId: 'dataSources',
          value: nextCatalog,
        }),
      )
    },

    async bind(call) {
      const recovered = await recoverWrite(call)
      if (recovered !== null) return recovered
      const request = normalizeBindArguments(call.arguments)
      const { document, schema } = currentSchema(engine)
      const source = readCatalog(schema).sources.find(candidate => candidate.id === request.binding.sourceId)
      if (!source) {
        throw new DashboardDataCapabilityError('DATA_SOURCE_NOT_FOUND', 'source-does-not-exist', 'data.bind')
      }
      const node = findNode(schema, request.nodeId)
      if (!node) throw new DashboardDataCapabilityError('DATA_NODE_NOT_FOUND', 'node-does-not-exist', 'data.bind')
      const componentName = ownValue(node, 'componentName', 'data.bind.node')
      if (!BINDING_COMPONENT_FIELDS[componentName]?.includes(request.field)) {
        throw new DashboardDataCapabilityError(
          'DATA_BINDING_UNSUPPORTED',
          'component-field-is-not-bindable',
          'data.bind.arguments.field',
        )
      }
      const currentBindingsValue = readProp(node, 'dataBindings')
      const fields = currentBindingsValue === undefined ? {} : { ...parseSafeDataBindings(currentBindingsValue).fields }
      const dataBindings = parseSafeDataBindings({
        schemaVersion: 1,
        fields: { ...fields, [request.field]: request.binding },
      })
      return screenApplyChangeSet(
        screenCall(call, document.id, {
          opId: `data-bind:${request.nodeId}:${request.field}`,
          type: 'set',
          nodeId: request.nodeId,
          fieldId: 'dataBindings',
          value: dataBindings,
        }),
      )
    },
  })
}
