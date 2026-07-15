const OMIT = Symbol('omit')
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const SECRET_KEY = /(?:password|secret|credential|accessToken|refreshToken|apiKey|authorization)/i
const SOURCE_KEYS = new Set(['artifactSource', 'rawSource', 'sourceCode', 'cssText'])

export const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const isObjectLike = value => (typeof value === 'object' && value !== null) || typeof value === 'function'

const readOwnDataValue = (value, key, fallback = OMIT) => {
  if (!isObjectLike(value)) return fallback
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : fallback
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

const forbiddenProjectionKey = (key, path) =>
  SECRET_KEY.test(key) || SOURCE_KEYS.has(key) || (key === 'source' && path.includes('artifactRef'))

const sanitizeValue = (value, state, depth, path) => {
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
        const sanitized = sanitizeValue(item, state, depth + 1, [...path, String(index)])
        result[index] = sanitized === OMIT ? null : sanitized
      }
      return result
    }
    if (!isPlainRecord(value)) return OMIT

    const result = Object.create(null)
    for (const [key, item] of ownEnumerableDataEntries(value).sort(([left], [right]) =>
      compareCodeUnits(left, right),
    )) {
      if (forbiddenProjectionKey(key, path)) continue
      const sanitized = sanitizeValue(item, state, depth + 1, [...path, key])
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
    [],
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
    adapterGeneration: readOwnDataValue(input, 'adapterGeneration'),
    documentId: readOwnDataValue(input, 'documentId'),
    documentMutationVersion: readOwnDataValue(input, 'documentMutationVersion'),
    materialRegistryVersion: readOwnDataValue(input, 'materialRegistryVersion'),
    providerVersions: Object.fromEntries(
      ownEnumerableDataEntries(readOwnDataValue(input, 'providerVersions')).sort(([left], [right]) =>
        compareCodeUnits(left, right),
      ),
    ),
  })

const flattenDocument = root => {
  const nodes = Object.create(null)
  const visit = (node, parentId = null, index = 0) => {
    if (!isPlainRecord(node)) return
    const rawId = readOwnDataValue(node, 'id')
    const id = typeof rawId === 'string' && rawId ? rawId : null
    if (!id) return
    const children = readOwnDataValue(node, 'children')
    const componentName = readOwnDataValue(node, 'componentName')
    const props = readOwnDataValue(node, 'props')
    const extra = Object.create(null)
    for (const [key, value] of ownEnumerableDataEntries(node)) {
      if (!['children', 'componentName', 'props'].includes(key)) extra[key] = value
    }
    const childrenEntries = arrayDataEntries(children)
    const childIds = childrenEntries.flatMap(([, child]) => {
      const childId = readOwnDataValue(child, 'id')
      return typeof childId === 'string' && childId ? [childId] : []
    })
    nodes[id] = sanitizeJsonValue({
      id,
      componentName: typeof componentName === 'string' ? componentName : 'Unknown',
      parentId,
      index,
      childIds,
      props: props ?? {},
      extra,
    })
    for (const [childIndex, child] of childrenEntries) visit(child, id, childIndex)
  }
  visit(root)
  return Object.fromEntries(Object.entries(nodes).sort(([left], [right]) => compareCodeUnits(left, right)))
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

const materialSummaries = registry => {
  const entries = readOwnDataValue(registry, 'entries')
  const values =
    entries instanceof Map
      ? [...Map.prototype.values.call(entries)]
      : arrayDataEntries(entries).map(([, value]) => value)
  return values
    .map(material => {
      const componentName = readOwnDataValue(material, 'componentName', null) ?? ''
      const title = readOwnDataValue(material, 'title', null) ?? componentName
      const tags = readOwnDataValue(material, 'tags')
      return sanitizeJsonValue({
        componentName,
        title,
        description: readOwnDataValue(material, 'description', null) ?? '',
        group: readOwnDataValue(material, 'group', null) ?? '',
        category: readOwnDataValue(material, 'category', null) ?? '',
        tags: Array.isArray(tags) ? tags : [],
      })
    })
    .sort((left, right) => compareCodeUnits(left.componentName, right.componentName))
}

export const createCoreProjectionProvider = adapter => ({
  id: 'dashboard.core',
  readFence() {
    const document = adapter.readDocument()
    const materials = adapter.readMaterials()
    return {
      adapterGeneration: adapter.readAdapterGeneration(),
      documentId: readOwnDataValue(document, 'id', null) ?? 'none',
      documentMutationVersion: readOwnDataValue(document, 'mutationVersion', null) ?? -1,
      materialRegistryVersion: readOwnDataValue(materials, 'version', null) ?? -1,
    }
  },
  getVersion() {
    return hashStableValue(this.readFence())
  },
  capture() {
    const document = adapter.readDocument()
    const materials = adapter.readMaterials()
    const schema = readOwnDataValue(document, 'schema')
    const nodes = document ? flattenDocument(schema) : {}
    return sanitizeJsonValue({
      document: document
        ? {
            id: readOwnDataValue(document, 'id'),
            mutationVersion: readOwnDataValue(document, 'mutationVersion'),
            rootNodeId: typeof readOwnDataValue(schema, 'id') === 'string' ? readOwnDataValue(schema, 'id') : null,
          }
        : null,
      nodes,
      materials: {
        registryVersion: readOwnDataValue(materials, 'version'),
        summaries: materialSummaries(materials),
      },
    })
  },
  isDeltaCompatible(base, next) {
    return structureFingerprint(base) === structureFingerprint(next)
  },
})

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
  for (const capture of captures) providers[capture.record.provider.id] = sanitizeJsonValue(capture.projection)
  return providers
}

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
