import { DashboardCapabilityRegistryError, dashboardCapabilityRegistry } from '../capabilities/index.mjs'
import { DASHBOARD_MATERIAL_READINESS_REQUIREMENTS, createSafeMaterialManifestCache } from '../manifest/index.mjs'
import {
  SnapshotProviderRegistry,
  compareCodeUnits,
  createCoreProjectionProvider,
  createDashboardSnapshotService,
} from '../snapshot/index.mjs'

export const DASHBOARD_AGENT_HOST_ERROR_CODE = Object.freeze({
  authorityMismatch: 'AUTHORITY_MISMATCH',
  capabilityUnavailable: 'CAPABILITY_UNAVAILABLE',
  hostDisposed: 'HOST_DISPOSED',
  invalidRequest: 'INVALID_REQUEST',
  materialNotFound: 'MATERIAL_NOT_FOUND',
  staleRevision: 'STALE_REVISION',
  unknownCapability: 'UNKNOWN_CAPABILITY',
})

const CORE_PROVIDER_ID = 'dashboard.core'
const OMIT = Symbol('omit')
const AUTHORITY_FIELDS = Object.freeze(['branchId', 'projectId', 'sessionId', 'taskId'])

const isObjectLike = value => (typeof value === 'object' && value !== null) || typeof value === 'function'

const readOwnDataValue = (value, key, ...fallbackValues) => {
  const fallback = fallbackValues.length ? fallbackValues[0] : OMIT
  if (!isObjectLike(value)) return fallback
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : fallback
}

const ownDataKeys = value => {
  if (!isObjectLike(value)) return []
  return Object.keys(value).filter(key => {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor
  })
}

const assertNoEnumerableAccessors = (value, label) => {
  if (!isObjectLike(value)) return
  for (const key of Object.keys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        `${label}-accessor-properties-are-not-allowed`,
      )
    }
  }
}

const boundaryClone = value => structuredClone(value)

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertPlainRecord = (value, label) => {
  if (!isPlainRecord(value)) {
    throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest, `${label}-must-be-an-object`)
  }
}

const assertExactKeys = (value, required, optional, label) => {
  assertPlainRecord(value, label)
  assertNoEnumerableAccessors(value, label)
  const expected = [...required, ...optional].sort(compareCodeUnits)
  const actual = ownDataKeys(value).sort(compareCodeUnits)
  for (const key of required) {
    if (!actual.includes(key)) {
      throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest, `${label}-missing-${key}`)
    }
  }
  if (actual.some(key => !expected.includes(key))) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      `${label}-fields-must-match-contract`,
    )
  }
}

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      `${label}-must-be-a-non-empty-string`,
    )
  }
  return value
}

const normalizeAuthority = authority => {
  assertExactKeys(authority, AUTHORITY_FIELDS, [], 'authority')
  return Object.freeze(
    Object.fromEntries(
      AUTHORITY_FIELDS.map(field => [
        field,
        requireNonEmptyString(readOwnDataValue(authority, field), `authority.${field}`),
      ]),
    ),
  )
}

const assertAuthority = (expected, request, fields) => {
  for (const field of fields) {
    if (readOwnDataValue(request, field) !== expected[field]) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.authorityMismatch,
        `${field}-does-not-match-host-authority`,
        { field },
      )
    }
  }
}

const toFailureCode = error => {
  if (error instanceof DashboardAgentHostError) return error.code
  if (error instanceof DashboardCapabilityRegistryError) {
    if (error.code === 'CAPABILITY_UNAVAILABLE') return DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable
    if (error.code === 'UNKNOWN_CAPABILITY') return DASHBOARD_AGENT_HOST_ERROR_CODE.unknownCapability
  }
  return DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest
}

const toFailureReason = error => {
  if (error instanceof DashboardAgentHostError || error instanceof DashboardCapabilityRegistryError) {
    return error.reason
  }
  return 'request-rejected'
}

const toFailureDetails = (error, capability) => ({
  ...(capability ? { capability } : {}),
  reason: toFailureReason(error),
})

export class DashboardAgentHostError extends Error {
  constructor(code, reason, details = {}) {
    super(`Dashboard AgentHost rejected request: ${reason}`)
    this.name = 'DashboardAgentHostError'
    this.code = code
    this.reason = reason
    this.details = Object.freeze({ ...details })
  }

  toJSON() {
    return {
      schemaVersion: 1,
      code: this.code,
      reason: this.reason,
      details: this.details,
    }
  }
}

const readCoreProjection = snapshot => {
  const projection = readOwnDataValue(snapshot, 'projection')
  const core = readOwnDataValue(projection, CORE_PROVIDER_ID)
  if (!isPlainRecord(core)) {
    throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest, 'core-projection-is-unavailable')
  }
  return core
}

const readMaterialSummaries = core => {
  const materials = readOwnDataValue(core, 'materials')
  const summaries = readOwnDataValue(materials, 'summaries')
  return Array.isArray(summaries) ? summaries : []
}

const readRegistryVersion = core => {
  const materials = readOwnDataValue(core, 'materials')
  const version = readOwnDataValue(materials, 'registryVersion')
  if ((typeof version !== 'number' && typeof version !== 'string') || String(version).length === 0) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'material-registry-version-is-unavailable',
    )
  }
  return version
}

const normalizedRect = node => {
  const extra = readOwnDataValue(node, 'extra', {})
  const dashboard = readOwnDataValue(extra, '$dashboard', {})
  const rect = readOwnDataValue(dashboard, 'rect', {})
  const number = (key, minimum = Number.NEGATIVE_INFINITY) => {
    const value = readOwnDataValue(rect, key)
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : 0
  }
  return {
    x: number('x'),
    y: number('y'),
    width: number('width', 0),
    height: number('height', 0),
  }
}

const materialTitleMap = summaries =>
  new Map(
    summaries.flatMap(summary => {
      const componentName = readOwnDataValue(summary, 'componentName')
      const title = readOwnDataValue(summary, 'title')
      return typeof componentName === 'string' && componentName
        ? [[componentName, typeof title === 'string' && title ? title : componentName]]
        : []
    }),
  )

const normalizeScreenArguments = value => {
  assertExactKeys(value, [], ['nodeIds'], 'screen.inspect.arguments')
  const nodeIds = readOwnDataValue(value, 'nodeIds', undefined)
  if (nodeIds === undefined) return undefined
  if (!Array.isArray(nodeIds) || nodeIds.length > 200) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'screen.inspect.nodeIds-must-be-a-bounded-array',
    )
  }
  const normalized = []
  for (let index = 0; index < nodeIds.length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(nodeIds, String(index))
    if (!descriptor || !('value' in descriptor)) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        'screen.inspect.nodeIds-must-be-a-dense-data-array',
      )
    }
    normalized.push(requireNonEmptyString(descriptor.value, `screen.inspect.nodeIds[${index}]`))
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'screen.inspect.nodeIds-must-be-unique',
    )
  }
  return new Set(normalized)
}

const inspectScreen = (snapshot, args) => {
  const selectedIds = normalizeScreenArguments(args)
  const core = readCoreProjection(snapshot)
  const nodes = readOwnDataValue(core, 'nodes', {})
  const summaries = readMaterialSummaries(core)
  const titles = materialTitleMap(summaries)
  const result = []
  for (const id of ownDataKeys(nodes).sort(compareCodeUnits)) {
    if (selectedIds && !selectedIds.has(id)) continue
    const node = readOwnDataValue(nodes, id)
    if (!isPlainRecord(node)) continue
    const componentName = readOwnDataValue(node, 'componentName')
    const extra = readOwnDataValue(node, 'extra', {})
    const explicitTitle = readOwnDataValue(extra, 'title')
    result.push({
      id,
      parentId: typeof readOwnDataValue(node, 'parentId') === 'string' ? readOwnDataValue(node, 'parentId') : null,
      index: Number.isInteger(readOwnDataValue(node, 'index')) ? readOwnDataValue(node, 'index') : 0,
      componentName: typeof componentName === 'string' && componentName ? componentName : 'Unknown',
      title:
        typeof explicitTitle === 'string' && explicitTitle
          ? explicitTitle
          : titles.get(componentName) ||
            (typeof componentName === 'string' && componentName ? componentName : 'Unknown'),
      rect: normalizedRect(node),
    })
  }
  return { revision: snapshot.revision, nodes: result }
}

const readinessForSummary = componentName =>
  Object.hasOwn(DASHBOARD_MATERIAL_READINESS_REQUIREMENTS, componentName) ? 'unsupported' : 'ready'

const categoriesForSummary = summary => {
  const categories = []
  for (const key of ['category', 'group']) {
    const value = readOwnDataValue(summary, key)
    if (typeof value === 'string' && value) categories.push(value)
  }
  const tags = readOwnDataValue(summary, 'tags')
  if (Array.isArray(tags)) {
    for (let index = 0; index < tags.length; index += 1) {
      const value = readOwnDataValue(tags, String(index))
      if (typeof value === 'string' && value) categories.push(value)
    }
  }
  return [...new Set(categories)].sort(compareCodeUnits)
}

const normalizeSearchArguments = value => {
  assertExactKeys(value, ['query'], ['limit'], 'material.search.arguments')
  const query = requireNonEmptyString(readOwnDataValue(value, 'query'), 'material.search.query')
  if (query.length > 200) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'material.search.query-is-too-long',
    )
  }
  const limit = readOwnDataValue(value, 'limit', 20)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'material.search.limit-is-out-of-range',
    )
  }
  return { query: query.toLowerCase(), limit }
}

const searchMaterials = (snapshot, args) => {
  const { query, limit } = normalizeSearchArguments(args)
  const core = readCoreProjection(snapshot)
  const matches = readMaterialSummaries(core)
    .flatMap(summary => {
      const componentName = readOwnDataValue(summary, 'componentName')
      if (typeof componentName !== 'string' || !componentName) return []
      const title = readOwnDataValue(summary, 'title')
      const normalizedTitle = typeof title === 'string' && title ? title : componentName
      const categories = categoriesForSummary(summary)
      const description = readOwnDataValue(summary, 'description', '')
      const haystack = [componentName, normalizedTitle, description, ...categories].join('\n').toLowerCase()
      if (!haystack.includes(query)) return []
      return [
        {
          materialId: componentName,
          componentName,
          title: normalizedTitle,
          categories,
          readiness: readinessForSummary(componentName),
        },
      ]
    })
    .sort((left, right) => compareCodeUnits(left.componentName, right.componentName))
    .slice(0, limit)
  return {
    materialRegistryVersion: String(readRegistryVersion(core)),
    matches,
  }
}

const normalizeDescribeArguments = value => {
  assertExactKeys(value, ['componentName'], [], 'material.describe.arguments')
  return requireNonEmptyString(readOwnDataValue(value, 'componentName'), 'material.describe.componentName')
}

const describeMaterial = async (snapshot, args, cache) => {
  const componentName = normalizeDescribeArguments(args)
  const core = readCoreProjection(snapshot)
  const summary = readMaterialSummaries(core).find(
    candidate => readOwnDataValue(candidate, 'componentName') === componentName,
  )
  if (!summary) {
    throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.materialNotFound, 'material-is-not-registered', {
      componentName,
    })
  }
  const manifest = await cache.get(componentName, readRegistryVersion(core))
  return {
    materialRegistryVersion: String(manifest.materialRegistryVersion),
    material: {
      materialId: componentName,
      componentName,
      title: manifest.title || readOwnDataValue(summary, 'title', componentName) || componentName,
      readiness: manifest.readiness.status === 'ready' ? 'ready' : 'unsupported',
      fields: manifest.fields.map(field => ({
        fieldId: field.fieldId,
        access: field.access,
        ...(field.valueSchema ? { valueSchema: field.valueSchema } : {}),
      })),
      diagnostics: manifest.diagnostics.map(diagnostic => diagnostic.code),
    },
  }
}

const createCoreAdapter = (engine, adapterGeneration) => ({
  readAdapterGeneration: () => adapterGeneration,
  readDocument: () => {
    const document = engine.project.currentDocument
    return document
      ? {
          id: document.id,
          mutationVersion: document.mutationVersion,
          schema: document.exportRaw(),
        }
      : null
  },
  readMaterials: () => ({
    version: engine.materials.version,
    entries: engine.materials.getComponentMetasMap(),
    resolveEntry: entry => entry.getMetadata(),
  }),
})

export class DashboardAgentHost {
  #authority
  #disposed = false
  #manifestCache
  #snapshotService
  #unregisterCoreProvider

  constructor({ adapterGeneration = 1, authority, engine }) {
    if (!Number.isSafeInteger(adapterGeneration) || adapterGeneration < 1) {
      throw new TypeError('adapterGeneration must be a positive safe integer')
    }
    if (!engine || !engine.project || !engine.materials) throw new TypeError('engine is required')
    this.#authority = normalizeAuthority(authority)
    const coreProvider = createCoreProjectionProvider(createCoreAdapter(engine, adapterGeneration))
    const registry = new SnapshotProviderRegistry()
    this.#unregisterCoreProvider = registry.register(coreProvider)
    this.#snapshotService = createDashboardSnapshotService({ registry, coreProvider })
    this.#manifestCache = createSafeMaterialManifestCache({
      readMaterialRegistryVersion: () => engine.materials.version,
      loadMetadata: componentName => {
        const entry = engine.materials.registry.get(componentName)
        if (!entry) throw new Error('material is not registered')
        return entry.meta.getMetadata()
      },
    })
  }

  #assertActive() {
    if (this.#disposed) {
      throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.hostDisposed, 'host-is-disposed')
    }
  }

  #validateObserveRequest(request) {
    assertExactKeys(
      request,
      ['branchId', 'mode', 'projectId', 'schemaVersion', 'sessionId', 'taskId'],
      ['cursor'],
      'observe-request',
    )
    if (readOwnDataValue(request, 'schemaVersion') !== 1) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        'observe-request-schema-version-is-unsupported',
      )
    }
    const mode = readOwnDataValue(request, 'mode')
    if (mode !== 'full' && mode !== 'delta') {
      throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest, 'observe-mode-is-invalid')
    }
    const cursor = readOwnDataValue(request, 'cursor', undefined)
    if (cursor !== undefined) requireNonEmptyString(cursor, 'observe-request.cursor')
    assertAuthority(this.#authority, request, AUTHORITY_FIELDS)
  }

  async #captureFull() {
    const snapshot = await this.#snapshotService.observe({ mode: 'full' })
    if (!Object.hasOwn(snapshot, 'projection')) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        'full-observation-did-not-return-a-projection',
      )
    }
    return snapshot
  }

  async observe(request) {
    this.#assertActive()
    this.#validateObserveRequest(request)
    return boundaryClone(
      await this.#snapshotService.observe({
        mode: readOwnDataValue(request, 'mode'),
        ...(readOwnDataValue(request, 'cursor', undefined) ? { cursor: readOwnDataValue(request, 'cursor') } : {}),
      }),
    )
  }

  async describeCapability(request) {
    this.#assertActive()
    assertExactKeys(request, ['branchId', 'capability', 'projectId', 'schemaVersion'], [], 'capability-request')
    assertAuthority(this.#authority, request, ['projectId', 'branchId'])
    dashboardCapabilityRegistry.assertAvailable(readOwnDataValue(request, 'capability'))
    return boundaryClone(await dashboardCapabilityRegistry.describeCapability(request))
  }

  #rejected(call, error) {
    const capability = readOwnDataValue(call, 'capability', undefined)
    return boundaryClone({
      schemaVersion: 1,
      callId: readOwnDataValue(call, 'callId'),
      status: 'rejected',
      failure: {
        code: toFailureCode(error),
        message: 'Dashboard read-only capability call was rejected',
        retryable: false,
        details: toFailureDetails(error, capability),
      },
    })
  }

  async invoke(call) {
    try {
      this.#assertActive()
      assertExactKeys(
        call,
        [
          'arguments',
          'branchId',
          'callId',
          'capability',
          'expectedRevision',
          'projectId',
          'schemaVersion',
          'sessionId',
          'stepId',
          'taskId',
        ],
        [],
        'semantic-call',
      )
      for (const field of ['callId', 'capability', 'expectedRevision', 'stepId']) {
        requireNonEmptyString(readOwnDataValue(call, field), `semantic-call.${field}`)
      }
      if (readOwnDataValue(call, 'schemaVersion') !== 1) {
        throw new DashboardAgentHostError(
          DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
          'semantic-call-schema-version-is-unsupported',
        )
      }
      assertAuthority(this.#authority, call, AUTHORITY_FIELDS)
      const capability = readOwnDataValue(call, 'capability')
      dashboardCapabilityRegistry.assertAvailable(capability)
      const args = readOwnDataValue(call, 'arguments')
      assertPlainRecord(args, 'semantic-call.arguments')
      const snapshot = await this.#captureFull()
      if (readOwnDataValue(call, 'expectedRevision') !== snapshot.revision) {
        throw new DashboardAgentHostError(
          DASHBOARD_AGENT_HOST_ERROR_CODE.staleRevision,
          'expected-revision-does-not-match-current-host-revision',
        )
      }

      let output
      if (capability === 'screen.inspect') output = inspectScreen(snapshot, args)
      else if (capability === 'material.search') output = searchMaterials(snapshot, args)
      else if (capability === 'material.describe') output = await describeMaterial(snapshot, args, this.#manifestCache)
      else {
        throw new DashboardAgentHostError(
          DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
          'capability-has-no-read-only-handler',
        )
      }
      return boundaryClone({
        schemaVersion: 1,
        callId: readOwnDataValue(call, 'callId'),
        status: 'applied',
        revision: snapshot.revision,
        output,
      })
    } catch (error) {
      if (!isPlainRecord(call) || typeof readOwnDataValue(call, 'callId') !== 'string') throw error
      return this.#rejected(call, error)
    }
  }

  async queryReceipt(request) {
    this.#assertActive()
    assertExactKeys(request, ['branchId', 'callId', 'projectId'], [], 'receipt-query')
    requireNonEmptyString(readOwnDataValue(request, 'callId'), 'receipt-query.callId')
    assertAuthority(this.#authority, request, ['projectId', 'branchId'])
    return null
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#unregisterCoreProvider()
    this.#snapshotService.dispose()
    this.#manifestCache.invalidate()
  }

  get disposed() {
    return this.#disposed
  }
}

export const createDashboardAgentHost = (options = {}) => {
  if (readOwnDataValue(options, 'enabled', false) !== true) return null
  return new DashboardAgentHost({
    adapterGeneration: readOwnDataValue(options, 'adapterGeneration', 1),
    authority: readOwnDataValue(options, 'authority'),
    engine: readOwnDataValue(options, 'engine'),
  })
}
