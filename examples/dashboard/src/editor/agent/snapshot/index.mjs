import { readCanonicalNodeArtifactRef } from '../../../lib/storage/artifact-contracts.mjs'

const OMIT = Symbol('omit')
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const DASHBOARD_RECT_KEYS = Object.freeze(['height', 'width', 'x', 'y'])
const SENSITIVE_WRITABLE_TOKENS = new Set([
  'apikey',
  'auth',
  'authorization',
  'bearer',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'header',
  'headers',
  'password',
  'privatekey',
  'secret',
  'token',
])
const SENSITIVE_WRITABLE_KEY_PAIRS = new Set(['access:key', 'api:key', 'private:key', 'service:key', 'signing:key'])
const WRITABLE_PROJECTION_WARNING = Object.freeze({
  manifestsUnavailable: 'writable-manifests-unavailable',
  nodeValuesUnavailable: 'writable-node-values-unavailable',
})
const WRITABLE_VALUE_LIMITS = Object.freeze({
  maxArrayLength: 512,
  maxDepth: 16,
  maxFieldsPerNode: 64,
  maxNodes: 4_096,
  maxNodeValues: 2_048,
  maxStringLength: 16_384,
  maxTotalCharacters: 96 * 1_024,
  maxValueCharacters: 48 * 1_024,
})

export const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const isObjectLike = value => (typeof value === 'object' && value !== null) || typeof value === 'function'

const readOwnDataValue = (value, key, fallback = OMIT) => {
  if (!isObjectLike(value)) return fallback
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : fallback
}

const callOwnMethod = (value, key, fallback = OMIT) => {
  const method = readOwnDataValue(value, key)
  return typeof method === 'function' ? method.call(value) : fallback
}

const ownEnumerableDataEntries = value => {
  if (!isObjectLike(value)) return []
  const entries = []
  for (const key of Object.keys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) entries.push([key, descriptor.value])
  }
  return entries
}

const normalizeStringScalar = (value, fallback) => (typeof value === 'string' ? value : fallback)

const normalizeNonEmptyStringScalar = (value, fallback) => (typeof value === 'string' && value ? value : fallback)

const normalizeNonNegativeSafeIntegerScalar = (value, fallback) =>
  Number.isSafeInteger(value) && value >= 0 ? value : fallback

const normalizePositiveSafeIntegerScalar = (value, fallback) =>
  Number.isSafeInteger(value) && value > 0 ? value : fallback

const arrayDataEntries = value => {
  if (!Array.isArray(value)) return []
  const length = readOwnDataValue(value, 'length', 0)
  const entries = []
  for (let index = 0; index < length; index += 1) {
    const item = readOwnDataValue(value, String(index))
    if (item !== OMIT) entries.push([index, item])
  }
  return entries
}

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isSensitiveWritableKey = key => {
  if (typeof key !== 'string' || key.length === 0) return false
  const tokens = key
    .replaceAll(/([a-z\d])([A-Z])/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(token => token.toLocaleLowerCase('en-US'))
  if (tokens.some(token => SENSITIVE_WRITABLE_TOKENS.has(token))) return true
  return tokens.some(
    (token, index) => index + 1 < tokens.length && SENSITIVE_WRITABLE_KEY_PAIRS.has(`${token}:${tokens[index + 1]}`),
  )
}

const isSafeWritableValue = (value, state, depth = 0) => {
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.length <= WRITABLE_VALUE_LIMITS.maxStringLength
  if (typeof value !== 'object' || depth > WRITABLE_VALUE_LIMITS.maxDepth || state.visited.has(value)) return false
  if (++state.nodes > WRITABLE_VALUE_LIMITS.maxNodes) return false

  state.visited.add(value)
  try {
    if (Array.isArray(value)) {
      const length = readOwnDataValue(value, 'length', 0)
      if (!Number.isSafeInteger(length) || length < 0 || length > WRITABLE_VALUE_LIMITS.maxArrayLength) return false
      return arrayDataEntries(value).every(([, item]) => isSafeWritableValue(item, state, depth + 1))
    }
    if (!isPlainRecord(value)) return false
    return ownEnumerableDataEntries(value).every(
      ([key, item]) =>
        !PROTOTYPE_KEYS.has(key) && !isSensitiveWritableKey(key) && isSafeWritableValue(item, state, depth + 1),
    )
  } finally {
    state.visited.delete(value)
  }
}

const projectWritableNodeValues = value => {
  if (!isPlainRecord(value)) return {}
  const projected = Object.create(null)
  let projectedNodeCount = 0
  let totalCharacters = 0

  for (const [nodeId, rawValues] of ownEnumerableDataEntries(value).sort(([left], [right]) =>
    compareCodeUnits(left, right),
  )) {
    if (
      projectedNodeCount >= WRITABLE_VALUE_LIMITS.maxNodeValues ||
      !nodeId ||
      PROTOTYPE_KEYS.has(nodeId) ||
      !isPlainRecord(rawValues)
    ) {
      continue
    }
    const nodeValues = Object.create(null)
    let fieldCount = 0
    for (const [fieldId, rawValue] of ownEnumerableDataEntries(rawValues).sort(([left], [right]) =>
      compareCodeUnits(left, right),
    )) {
      if (
        fieldCount >= WRITABLE_VALUE_LIMITS.maxFieldsPerNode ||
        !fieldId.startsWith('props.') ||
        PROTOTYPE_KEYS.has(fieldId) ||
        isSensitiveWritableKey(fieldId) ||
        !isSafeWritableValue(rawValue, { nodes: 0, visited: new WeakSet() })
      ) {
        continue
      }
      const sanitized = sanitizeJsonValue(rawValue, {
        maxArrayLength: WRITABLE_VALUE_LIMITS.maxArrayLength,
        maxDepth: WRITABLE_VALUE_LIMITS.maxDepth,
        maxNodes: WRITABLE_VALUE_LIMITS.maxNodes,
        maxStringLength: WRITABLE_VALUE_LIMITS.maxStringLength,
      })
      const serialized = JSON.stringify(sanitized)
      if (
        serialized.length > WRITABLE_VALUE_LIMITS.maxValueCharacters ||
        totalCharacters + serialized.length > WRITABLE_VALUE_LIMITS.maxTotalCharacters
      ) {
        continue
      }
      nodeValues[fieldId] = sanitized
      totalCharacters += serialized.length
      fieldCount += 1
    }
    if (Object.keys(nodeValues).length > 0) {
      projected[nodeId] = nodeValues
      projectedNodeCount += 1
    }
  }
  return projected
}

const sanitizeValue = (value, state, depth) => {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : OMIT
  if (typeof value === 'string') {
    return value.length <= state.maxStringLength ? value : value.slice(0, state.maxStringLength)
  }
  if (typeof value !== 'object' || depth > state.maxDepth || state.visited.has(value)) return OMIT
  if (++state.nodes > state.maxNodes) return OMIT

  state.visited.add(value)
  try {
    if (Array.isArray(value)) {
      const length = readOwnDataValue(value, 'length', 0)
      if (length > state.maxArrayLength) return OMIT
      const result = Array.from({ length }, () => null)
      for (const [index, item] of arrayDataEntries(value)) {
        const sanitized = sanitizeValue(item, state, depth + 1)
        result[index] = sanitized === OMIT ? null : sanitized
      }
      return result
    }
    if (!isPlainRecord(value)) return OMIT

    const result = Object.create(null)
    for (const [key, item] of ownEnumerableDataEntries(value).sort(([left], [right]) =>
      compareCodeUnits(left, right),
    )) {
      const sanitized = sanitizeValue(item, state, depth + 1)
      if (sanitized !== OMIT) result[key] = sanitized
    }
    return result
  } finally {
    state.visited.delete(value)
  }
}

export const sanitizeJsonValue = (value, options = {}) => {
  const result = sanitizeValue(
    value,
    {
      maxDepth: readOwnDataValue(options, 'maxDepth', null) ?? 32,
      maxNodes: readOwnDataValue(options, 'maxNodes', null) ?? 25_000,
      maxArrayLength: readOwnDataValue(options, 'maxArrayLength', null) ?? 5_000,
      maxStringLength: readOwnDataValue(options, 'maxStringLength', null) ?? 100_000,
      nodes: 0,
      visited: new WeakSet(),
    },
    0,
  )
  return result === OMIT ? null : result
}

export const stableStringify = value => JSON.stringify(sanitizeJsonValue(value))

export const hashStableValue = value => {
  const input = stableStringify(value)
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ (code + index), 0x85ebca6b)
  }
  return `v1-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

const jsonEqual = (left, right) => stableStringify(left) === stableStringify(right)

const assertSafePathSegment = segment => {
  if (typeof segment !== 'string' || segment.length === 0 || PROTOTYPE_KEYS.has(segment)) {
    throw new TypeError(`Unsafe projection path segment: ${String(segment)}`)
  }
}

const diffInto = (base, next, path, changes) => {
  if (jsonEqual(base, next)) return
  if (!isPlainRecord(base) || !isPlainRecord(next)) {
    if (path.length === 0) throw new TypeError('Projection root replacement requires a full snapshot')
    changes.push({ op: 'set', path, value: sanitizeJsonValue(next) })
    return
  }

  const keys = [...new Set([...Object.keys(base), ...Object.keys(next)])].sort(compareCodeUnits)
  for (const key of keys) {
    assertSafePathSegment(key)
    if (!Object.hasOwn(next, key)) {
      changes.push({ op: 'remove', path: [...path, key] })
      continue
    }
    if (!Object.hasOwn(base, key)) {
      changes.push({ op: 'set', path: [...path, key], value: sanitizeJsonValue(readOwnDataValue(next, key)) })
      continue
    }
    diffInto(readOwnDataValue(base, key), readOwnDataValue(next, key), [...path, key], changes)
  }
}

/** Arrays are atomic: an array difference emits one set patch at the array path. */
export const createProjectionChanges = (base, next) => {
  const sanitizedBase = sanitizeJsonValue(base)
  const sanitizedNext = sanitizeJsonValue(next)
  if (!isPlainRecord(sanitizedBase) || !isPlainRecord(sanitizedNext)) {
    throw new TypeError('Projection delta inputs must be JSON objects')
  }
  const changes = []
  diffInto(sanitizedBase, sanitizedNext, [], changes)
  return changes
}

const hasOwnPath = (value, path) => {
  let current = value
  for (const segment of path) {
    if (!isPlainRecord(current) || !Object.hasOwn(current, segment)) return false
    current = readOwnDataValue(current, segment)
    if (current === OMIT) return false
  }
  return true
}

const isAncestorPath = (left, right) =>
  left.length < right.length && left.every((segment, index) => segment === right[index])

export const validateProjectionChanges = (base, changes) => {
  const paths = []
  for (const change of changes) {
    if (!change || !['remove', 'set'].includes(change.op) || !Array.isArray(change.path) || !change.path.length) {
      return false
    }
    try {
      change.path.forEach(assertSafePathSegment)
    } catch {
      return false
    }
    if (change.op === 'remove' && !hasOwnPath(base, change.path)) return false
    if (
      paths.some(
        path => jsonEqual(path, change.path) || isAncestorPath(path, change.path) || isAncestorPath(change.path, path),
      )
    ) {
      return false
    }
    paths.push(change.path)
  }
  return true
}

export const createHostRevision = input =>
  hashStableValue({
    adapterGeneration: normalizePositiveSafeIntegerScalar(readOwnDataValue(input, 'adapterGeneration'), 0),
    documentId: normalizeNonEmptyStringScalar(readOwnDataValue(input, 'documentId'), 'none'),
    documentMutationVersion: normalizeNonNegativeSafeIntegerScalar(
      readOwnDataValue(input, 'documentMutationVersion'),
      -1,
    ),
    materialRegistryVersion: normalizeNonNegativeSafeIntegerScalar(
      readOwnDataValue(input, 'materialRegistryVersion'),
      -1,
    ),
    providerVersions: Object.fromEntries(
      ownEnumerableDataEntries(readOwnDataValue(input, 'providerVersions')).sort(([left], [right]) =>
        compareCodeUnits(left, right),
      ),
    ),
  })

const projectStringArray = value => {
  if (!Array.isArray(value)) return []
  const result = []
  for (const [, item] of arrayDataEntries(value)) {
    if (typeof item === 'string') result.push(item)
  }
  return result
}

const copyOwnDescriptor = (source, key, target) => {
  const descriptor = isObjectLike(source) ? Reflect.getOwnPropertyDescriptor(source, key) : undefined
  if (descriptor) Reflect.defineProperty(target, key, descriptor)
  return descriptor
}

const createArtifactBindingView = node => {
  const binding = {}
  copyOwnDescriptor(node, '$agent', binding)
  copyOwnDescriptor(node, 'artifactRef', binding)

  const extraDescriptor = isObjectLike(node) ? Reflect.getOwnPropertyDescriptor(node, 'extra') : undefined
  if (!extraDescriptor) return binding
  if (!('value' in extraDescriptor)) {
    Reflect.defineProperty(binding, 'extra', extraDescriptor)
    return binding
  }
  const extra = extraDescriptor.value
  const artifactRefDescriptor = isObjectLike(extra) ? Reflect.getOwnPropertyDescriptor(extra, 'artifactRef') : undefined
  if (!artifactRefDescriptor) return binding
  const literalNestedExtra = {}
  Reflect.defineProperty(literalNestedExtra, 'artifactRef', artifactRefDescriptor)
  Reflect.defineProperty(binding, 'extra', { ...extraDescriptor, value: literalNestedExtra })
  return binding
}

const projectDashboardState = value => {
  if (!isPlainRecord(value)) return null
  const rect = readOwnDataValue(value, 'rect')
  if (!isPlainRecord(rect)) return null
  const projectedRect = Object.create(null)
  for (const key of DASHBOARD_RECT_KEYS) {
    const item = readOwnDataValue(rect, key)
    if (typeof item === 'number' && Number.isFinite(item)) projectedRect[key] = item
  }
  return Object.keys(projectedRect).length ? { rect: projectedRect } : null
}

const projectNodeExtra = node => {
  const result = Object.create(null)
  const title = readOwnDataValue(node, 'title')
  if (typeof title === 'string') result.title = title
  const dashboard = projectDashboardState(readOwnDataValue(node, '$dashboard'))
  if (dashboard) result.$dashboard = dashboard
  const artifactRef = readCanonicalNodeArtifactRef(createArtifactBindingView(node))
  if (artifactRef) result.artifactRef = artifactRef
  return result
}

const flattenDocument = root => {
  const nodes = Object.create(null)
  const visit = (node, parentId = null, index = 0) => {
    if (!isPlainRecord(node)) return
    const rawId = readOwnDataValue(node, 'id')
    const id = typeof rawId === 'string' && rawId ? rawId : null
    if (!id) return
    const children = readOwnDataValue(node, 'children')
    const componentName = readOwnDataValue(node, 'componentName')
    const normalizedComponentName = typeof componentName === 'string' ? componentName : 'Unknown'
    const childrenEntries = arrayDataEntries(children)
    const childIds = childrenEntries.flatMap(([, child]) => {
      const childId = readOwnDataValue(child, 'id')
      return typeof childId === 'string' && childId ? [childId] : []
    })
    const projection = {
      id,
      componentName: normalizedComponentName,
      parentId,
      index,
      childIds,
      extra: projectNodeExtra(node),
    }
    nodes[id] = sanitizeJsonValue(projection)
    for (const [childIndex, child] of childrenEntries) visit(child, id, childIndex)
  }
  visit(root)
  return Object.fromEntries(Object.entries(nodes).sort(([left], [right]) => compareCodeUnits(left, right)))
}

const summarizeMaterial = material => {
  try {
    const componentName = readOwnDataValue(material, 'componentName')
    if (typeof componentName !== 'string' || !componentName) return null
    const tags = readOwnDataValue(material, 'tags')
    return sanitizeJsonValue({
      componentName,
      title: normalizeStringScalar(readOwnDataValue(material, 'title'), componentName),
      description: normalizeStringScalar(readOwnDataValue(material, 'description'), ''),
      group: normalizeStringScalar(readOwnDataValue(material, 'group'), ''),
      category: normalizeStringScalar(readOwnDataValue(material, 'category'), ''),
      tags: projectStringArray(tags),
    })
  } catch {
    return null
  }
}

const resolveMaterialMetadata = (resolver, material) => {
  try {
    return resolver(material)
  } catch {
    return null
  }
}

const structureFingerprint = projection =>
  hashStableValue({
    documentId: readOwnDataValue(readOwnDataValue(projection, 'document'), 'id', null) ?? null,
    nodes: Object.fromEntries(
      ownEnumerableDataEntries(readOwnDataValue(projection, 'nodes', {}))
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([id, node]) => [
          id,
          {
            parentId: readOwnDataValue(node, 'parentId'),
            index: readOwnDataValue(node, 'index'),
            childIds: readOwnDataValue(node, 'childIds'),
          },
        ]),
    ),
  })

const projectMaterials = registry => {
  const entries = readOwnDataValue(registry, 'entries')
  const resolveEntry = readOwnDataValue(registry, 'resolveEntry')
  const values =
    entries instanceof Map
      ? [...Map.prototype.values.call(entries)]
      : arrayDataEntries(entries).map(([, value]) => value)
  const materialRegistryVersion = normalizeNonNegativeSafeIntegerScalar(readOwnDataValue(registry, 'version'), -1)
  const summaries = []
  for (const material of values) {
    const metadata = typeof resolveEntry === 'function' ? resolveMaterialMetadata(resolveEntry, material) : material
    const summary = summarizeMaterial(metadata)
    if (summary) summaries.push(summary)
  }
  summaries.sort((left, right) => compareCodeUnits(left.componentName, right.componentName))
  return {
    registryVersion: materialRegistryVersion,
    summaries,
  }
}

const projectWritableManifests = value => {
  const manifests = []
  for (const [, rawManifest] of arrayDataEntries(value)) {
    const componentName = readOwnDataValue(rawManifest, 'componentName')
    if (typeof componentName !== 'string' || componentName.length === 0 || PROTOTYPE_KEYS.has(componentName)) continue
    const fields = []
    for (const [, rawField] of arrayDataEntries(readOwnDataValue(rawManifest, 'fields'))) {
      const fieldId = readOwnDataValue(rawField, 'fieldId')
      const access = readOwnDataValue(rawField, 'access')
      if (typeof fieldId !== 'string' || fieldId.length === 0 || PROTOTYPE_KEYS.has(fieldId)) continue
      if (access !== 'read-write') continue
      if (isSensitiveWritableKey(fieldId)) continue
      const rawValueSchema = readOwnDataValue(rawField, 'valueSchema', {})
      if (!isSafeWritableValue(rawValueSchema, { nodes: 0, visited: new WeakSet() })) continue
      const valueSchema = sanitizeJsonValue(rawValueSchema, {
        maxArrayLength: 256,
        maxDepth: 16,
        maxNodes: 2_048,
        maxStringLength: 1_024,
      })
      fields.push({
        access,
        fieldId,
        ...(isPlainRecord(valueSchema) ? { valueSchema } : {}),
      })
    }
    fields.sort((left, right) => compareCodeUnits(left.fieldId, right.fieldId))
    if (fields.length > 0) manifests.push({ componentName, fields })
  }
  manifests.sort((left, right) => compareCodeUnits(left.componentName, right.componentName))
  return manifests
}

export const createCoreProjectionProvider = adapter => {
  const readWritableManifests = async () => {
    try {
      return {
        value: projectWritableManifests(await callOwnMethod(adapter, 'readWritableMaterialManifests', [])),
      }
    } catch {
      return {
        unavailable: WRITABLE_PROJECTION_WARNING.manifestsUnavailable,
        value: [],
      }
    }
  }
  const readWritableNodeValues = async () => {
    try {
      return {
        value: projectWritableNodeValues(await callOwnMethod(adapter, 'readWritableNodeValues', {})),
      }
    } catch {
      return {
        unavailable: WRITABLE_PROJECTION_WARNING.nodeValuesUnavailable,
        value: {},
      }
    }
  }

  return {
    id: 'dashboard.core',
    readFence() {
      const document = callOwnMethod(adapter, 'readDocument', null)
      const materials = callOwnMethod(adapter, 'readMaterials', null)
      const adapterGeneration = normalizePositiveSafeIntegerScalar(
        callOwnMethod(adapter, 'readAdapterGeneration', null),
        0,
      )
      return {
        adapterGeneration,
        documentId: normalizeNonEmptyStringScalar(readOwnDataValue(document, 'id'), 'none'),
        documentMutationVersion: normalizeNonNegativeSafeIntegerScalar(
          readOwnDataValue(document, 'mutationVersion'),
          -1,
        ),
        materialRegistryVersion: normalizeNonNegativeSafeIntegerScalar(readOwnDataValue(materials, 'version'), -1),
      }
    },
    getVersion() {
      return hashStableValue(this.readFence())
    },
    async capture() {
      const document = callOwnMethod(adapter, 'readDocument', null)
      const materials = callOwnMethod(adapter, 'readMaterials', null)
      const schema = readOwnDataValue(document, 'schema')
      const nodes = document ? flattenDocument(schema) : {}
      const materialProjection = projectMaterials(materials)
      const writableManifestsResult = await readWritableManifests()
      const writableNodeValuesResult = await readWritableNodeValues()
      const projectionWarnings = [writableManifestsResult.unavailable, writableNodeValuesResult.unavailable].filter(
        warning => typeof warning === 'string',
      )
      for (const [nodeId, values] of ownEnumerableDataEntries(writableNodeValuesResult.value)) {
        if (Object.hasOwn(nodes, nodeId)) nodes[nodeId].writableValues = values
      }
      return sanitizeJsonValue({
        document: document
          ? {
              id: normalizeNonEmptyStringScalar(readOwnDataValue(document, 'id'), 'none'),
              mutationVersion: normalizeNonNegativeSafeIntegerScalar(readOwnDataValue(document, 'mutationVersion'), -1),
              rootNodeId: typeof readOwnDataValue(schema, 'id') === 'string' ? readOwnDataValue(schema, 'id') : null,
            }
          : null,
        nodes,
        materials: {
          ...materialProjection,
          ...(writableManifestsResult.value.length > 0 ? { writableManifests: writableManifestsResult.value } : {}),
        },
        ...(projectionWarnings.length > 0 ? { projectionWarnings } : {}),
      })
    },
    isDeltaCompatible(base, next) {
      return structureFingerprint(base) === structureFingerprint(next)
    },
  }
}

export class SnapshotProviderRegistry {
  #records = new Map()
  #clock = 0

  get generation() {
    return this.#clock
  }

  register(provider) {
    if (!provider || typeof provider.id !== 'string' || !provider.id || PROTOTYPE_KEYS.has(provider.id)) {
      throw new TypeError('Snapshot provider requires a safe id')
    }
    if (this.#records.has(provider.id)) throw new Error(`Snapshot provider "${provider.id}" is already registered`)
    const record = { provider, generation: ++this.#clock }
    this.#records.set(provider.id, record)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.#records.get(provider.id) !== record) return
      this.#records.delete(provider.id)
      this.#clock += 1
    }
  }

  snapshot() {
    return [...this.#records.values()]
      .sort((left, right) => compareCodeUnits(left.provider.id, right.provider.id))
      .map(record => ({ ...record, version: record.provider.getVersion() }))
  }

  isCurrent(record) {
    const current = this.#records.get(record.provider.id)
    return current?.provider === record.provider && current?.generation === record.generation
  }
}

const sameRecordFence = (before, after) =>
  before.length === after.length &&
  before.every((record, index) => {
    const candidate = after[index]
    return (
      candidate &&
      record.provider === candidate.provider &&
      record.provider.id === candidate.provider.id &&
      record.generation === candidate.generation &&
      record.version === candidate.version
    )
  })

const sameCoreFence = (left, right) =>
  left.adapterGeneration === right.adapterGeneration &&
  left.documentId === right.documentId &&
  left.documentMutationVersion === right.documentMutationVersion &&
  left.materialRegistryVersion === right.materialRegistryVersion

const projectionMap = captures => {
  const providers = Object.create(null)
  // Providers own their finite capture DTOs; this utility only normalizes descriptor-safe JSON.
  for (const capture of captures) providers[capture.record.provider.id] = sanitizeJsonValue(capture.projection)
  return providers
}

const providerGenerationMap = records =>
  Object.fromEntries(records.map(record => [record.provider.id, record.generation]))

const createCursor = (revision, records) =>
  `snapshot-${hashStableValue({
    revision,
    providers: records.map(record => ({ id: record.provider.id, generation: record.generation })),
  })}`

export class DashboardSnapshotService {
  #registry
  #coreProvider
  #history = new Map()
  #latestCursor

  constructor(options) {
    this.#registry = options.registry
    this.#coreProvider = options.coreProvider
    this.maxCaptureAttempts = options.maxCaptureAttempts ?? 3
    this.historyLimit = options.historyLimit ?? 16
    this.disposed = false
  }

  async #captureStable() {
    for (let attempt = 1; attempt <= this.maxCaptureAttempts; attempt += 1) {
      const registryGeneration = this.#registry.generation
      const records = this.#registry.snapshot()
      const coreFence = this.#coreProvider.readFence()
      const captures = await Promise.all(
        records.map(async record => ({ record, projection: await record.provider.capture() })),
      )
      const nextRecords = this.#registry.snapshot()
      const nextCoreFence = this.#coreProvider.readFence()
      const stable =
        registryGeneration === this.#registry.generation &&
        records.every(record => this.#registry.isCurrent(record)) &&
        sameRecordFence(records, nextRecords) &&
        sameCoreFence(coreFence, nextCoreFence)
      if (!stable) continue

      const revision = createHostRevision({
        ...coreFence,
        providerVersions: Object.fromEntries(records.map(record => [record.provider.id, record.version])),
      })
      const projection = sanitizeJsonValue(projectionMap(captures))
      return {
        attempt,
        coreFence,
        records,
        captures,
        revision,
        cursor: createCursor(revision, records),
        projection,
      }
    }
    const error = new Error(`Snapshot capture tore across ${this.maxCaptureAttempts} attempts`)
    error.name = 'SnapshotTearingError'
    throw error
  }

  #remember(capture) {
    this.#history.set(capture.cursor, capture)
    this.#latestCursor = capture.cursor
    while (this.#history.size > this.historyLimit) this.#history.delete(this.#history.keys().next().value)
  }

  #full(capture) {
    this.#remember(capture)
    return {
      schemaVersion: 1,
      revision: capture.revision,
      cursor: capture.cursor,
      providerGenerations: providerGenerationMap(capture.records),
      projection: capture.projection,
    }
  }

  async observe(request = { mode: 'full' }) {
    if (this.disposed) throw new Error('DashboardSnapshotService is disposed')
    const capture = await this.#captureStable()
    if (request.mode !== 'delta' || capture.attempt > 1 || !request.cursor || request.cursor !== this.#latestCursor) {
      return this.#full(capture)
    }
    const base = this.#history.get(request.cursor)
    if (!base) return this.#full(capture)
    if (base.coreFence.documentId !== capture.coreFence.documentId) return this.#full(capture)
    if (
      base.records.length !== capture.records.length ||
      base.records.some(record => {
        const current = capture.records.find(candidate => candidate.provider.id === record.provider.id)
        return !current || current.generation !== record.generation
      })
    ) {
      return this.#full(capture)
    }

    const changed = capture.captures.filter(current => {
      const previous = base.captures.find(candidate => candidate.record.provider.id === current.record.provider.id)
      return !previous || !jsonEqual(previous.projection, current.projection)
    })
    if (changed.length > 1) return this.#full(capture)

    const current = changed[0] ?? capture.captures[0]
    if (!current) return this.#full(capture)
    const previous = base.captures.find(candidate => candidate.record.provider.id === current.record.provider.id)
    if (
      !previous ||
      previous.record.generation !== current.record.generation ||
      !this.#registry.isCurrent(current.record) ||
      current.record.provider.isDeltaCompatible?.(previous.projection, current.projection) === false
    ) {
      return this.#full(capture)
    }

    let changes
    try {
      changes = createProjectionChanges(previous.projection, current.projection)
      if (!validateProjectionChanges(previous.projection, changes)) return this.#full(capture)
    } catch {
      return this.#full(capture)
    }
    if (capture.cursor === base.cursor || (changes.length > 0 && capture.revision === base.revision)) {
      return this.#full(capture)
    }
    this.#remember(capture)
    return {
      schemaVersion: 1,
      baseRevision: base.revision,
      newRevision: capture.revision,
      providerId: current.record.provider.id,
      providerGeneration: current.record.generation,
      baseCursor: base.cursor,
      newCursor: capture.cursor,
      changes,
    }
  }

  dispose() {
    this.#history.clear()
    this.#latestCursor = undefined
    this.disposed = true
  }
}

export const createDashboardSnapshotService = options => new DashboardSnapshotService(options)
