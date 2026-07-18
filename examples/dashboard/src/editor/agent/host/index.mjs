import { hashCanonicalJson } from '../../../lib/storage/index.mjs'
import { isDashboardOnlineArtifactCapability } from '../capabilities/artifact/index.mjs'
import {
  DashboardDataCapabilityError,
  createDashboardDataCapabilityService,
  createDashboardDataManifestCache,
  isDashboardDataCapability,
} from '../capabilities/data/index.mjs'
import { DashboardCapabilityRegistryError, dashboardCapabilityRegistry } from '../capabilities/index.mjs'
import {
  createDashboardScreenApplyChangeSetHandler,
  verifyScreenReceiptIntentRecovery,
} from '../capabilities/screen/index.mjs'
import { createDashboardTaskCompensationService } from '../compensation/index.mjs'
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
const SAFE_ACTIVE_TARGET_NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u

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
  const expected = [...required, ...optional].sort(compareCodeUnits)
  const actual = []
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        `${label}-symbol-properties-are-not-allowed`,
      )
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        `${label}-properties-must-be-enumerable-data-properties`,
      )
    }
    actual.push(key)
  }
  actual.sort(compareCodeUnits)
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

const freezeDto = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.keys(value)) freezeDto(readOwnDataValue(value, key))
  return Object.freeze(value)
}

const invocationTargetNodeIds = (capability, args) => {
  if (capability === 'data.bind') {
    const nodeId = readOwnDataValue(args, 'nodeId', undefined)
    return typeof nodeId === 'string' && nodeId.length <= 128 && SAFE_ACTIVE_TARGET_NODE_ID_PATTERN.test(nodeId)
      ? [nodeId]
      : []
  }
  if (capability !== 'screen.applyChangeSet') return []
  const operations = readOwnDataValue(args, 'operations', undefined)
  if (!Array.isArray(operations)) return []
  const targetNodeIds = new Set()
  for (let index = 0; index < Math.min(operations.length, 100); index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(operations, String(index))
    if (!descriptor || !('value' in descriptor) || !isPlainRecord(descriptor.value)) continue
    for (const field of ['nodeId', 'parentId']) {
      const value = readOwnDataValue(descriptor.value, field, undefined)
      if (typeof value === 'string' && value.length > 0) targetNodeIds.add(value)
    }
  }
  return [...targetNodeIds].sort(compareCodeUnits)
}

const invocationTargets = (engine, targetNodeIds) => {
  const document = engine.project.currentDocument
  if (!document) return []
  const targets = []
  for (const nodeId of targetNodeIds) {
    const node = document.getNode(nodeId)
    if (!node) continue
    let rect
    try {
      rect =
        typeof node.getDashboardRect === 'function'
          ? node.getDashboardRect()
          : node.getExtraPropValue('$dashboard.rect')
    } catch {
      continue
    }
    const values = [rect?.x, rect?.y, rect?.width, rect?.height]
    if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) continue
    if (rect.width < 0 || rect.height < 0) continue
    const title = node.title
    targets.push({
      nodeId,
      label: typeof title === 'string' && title.length > 0 ? title : nodeId,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    })
  }
  return targets
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

const normalizeCompensationTarget = (value, call) => {
  assertExactKeys(
    value,
    ['callIndex', 'callIndexComplete', 'phase', 'schemaVersion', 'sessionId', 'taskId'],
    [],
    'invoke-context.compensationTarget',
  )
  if (readOwnDataValue(value, 'schemaVersion') !== 1) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'compensation-target-schema-version-is-unsupported',
    )
  }
  const taskId = requireNonEmptyString(readOwnDataValue(value, 'taskId'), 'invoke-context.compensationTarget.taskId')
  const sessionId = requireNonEmptyString(
    readOwnDataValue(value, 'sessionId'),
    'invoke-context.compensationTarget.sessionId',
  )
  const phase = readOwnDataValue(value, 'phase')
  if (phase !== 'COMPLETED' && phase !== 'CANCELLED') {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'compensation-target-phase-is-not-terminal-and-eligible',
    )
  }
  if (readOwnDataValue(value, 'callIndexComplete') !== true) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'compensation-target-call-index-is-incomplete',
    )
  }
  if (sessionId !== readOwnDataValue(call, 'sessionId')) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.authorityMismatch,
      'compensation-target-session-does-not-match-call',
      { field: 'sessionId' },
    )
  }
  if (taskId === readOwnDataValue(call, 'taskId')) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'compensation-target-cannot-be-the-current-task',
    )
  }

  const callIndex = readOwnDataValue(value, 'callIndex')
  if (
    !Array.isArray(callIndex) ||
    Reflect.ownKeys(callIndex).some(key => key !== 'length' && !/^\d+$/u.test(String(key)))
  ) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'compensation-target-call-index-must-be-a-dense-array',
    )
  }
  const normalizedIndex = []
  const seenCallIds = new Set()
  for (let index = 0; index < callIndex.length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(callIndex, String(index))
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        'compensation-target-call-index-must-be-a-dense-data-array',
      )
    }
    const entry = descriptor.value
    assertExactKeys(entry, ['callId', 'capability'], [], `invoke-context.compensationTarget.callIndex[${index}]`)
    const callId = requireNonEmptyString(
      readOwnDataValue(entry, 'callId'),
      `invoke-context.compensationTarget.callIndex[${index}].callId`,
    )
    const capability = requireNonEmptyString(
      readOwnDataValue(entry, 'capability'),
      `invoke-context.compensationTarget.callIndex[${index}].capability`,
    )
    if (seenCallIds.has(callId)) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        'compensation-target-call-index-has-duplicate-call-id',
      )
    }
    if (capability === 'task.compensate') {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        'compensation-target-cannot-contain-nested-compensation',
      )
    }
    seenCallIds.add(callId)
    normalizedIndex.push({ callId, capability })
  }

  return freezeDto({ schemaVersion: 1, taskId, sessionId, phase, callIndexComplete: true, callIndex: normalizedIndex })
}

const normalizeInvokeContext = (value, call) => {
  assertExactKeys(value, ['schemaVersion'], ['compensationTarget'], 'invoke-context')
  if (readOwnDataValue(value, 'schemaVersion') !== 1) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'invoke-context-schema-version-is-unsupported',
    )
  }
  const capability = readOwnDataValue(call, 'capability')
  const targetValue = readOwnDataValue(value, 'compensationTarget', undefined)
  if (capability !== 'task.compensate') {
    if (targetValue !== undefined) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        'compensation-target-is-forbidden-for-this-capability',
      )
    }
    return freezeDto({ schemaVersion: 1 })
  }
  if (targetValue === undefined) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'task-compensate-requires-a-runtime-owned-target',
    )
  }
  assertExactKeys(
    readOwnDataValue(call, 'arguments'),
    ['schemaVersion', 'targetTaskId'],
    [],
    'task.compensate.arguments',
  )
  if (readOwnDataValue(call.arguments, 'schemaVersion') !== 1) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'task-compensate-arguments-schema-version-is-unsupported',
    )
  }
  const targetTaskId = requireNonEmptyString(
    readOwnDataValue(call.arguments, 'targetTaskId'),
    'task.compensate.arguments.targetTaskId',
  )
  const compensationTarget = normalizeCompensationTarget(targetValue, call)
  if (compensationTarget.taskId !== targetTaskId) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.authorityMismatch,
      'compensation-target-id-does-not-match-call-arguments',
      { field: 'taskId' },
    )
  }
  return freezeDto({ schemaVersion: 1, compensationTarget })
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
  if (error instanceof DashboardDataCapabilityError) return error.code
  if (error instanceof DashboardCapabilityRegistryError) {
    if (error.code === 'CAPABILITY_UNAVAILABLE') return DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable
    if (error.code === 'UNKNOWN_CAPABILITY') return DASHBOARD_AGENT_HOST_ERROR_CODE.unknownCapability
  }
  return DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest
}

const toFailureReason = error => {
  if (
    error instanceof DashboardAgentHostError ||
    error instanceof DashboardCapabilityRegistryError ||
    error instanceof DashboardDataCapabilityError
  ) {
    return error.reason
  }
  return 'request-rejected'
}

const toFailureDetails = (error, capability) => ({
  ...(capability ? { capability } : {}),
  reason: toFailureReason(error),
})

const invocationFromReceipt = receipt => ({
  schemaVersion: 1,
  callId: readOwnDataValue(receipt, 'callId'),
  status: readOwnDataValue(receipt, 'status'),
  ...(readOwnDataValue(receipt, 'revision', undefined) === undefined
    ? {}
    : { revision: readOwnDataValue(receipt, 'revision') }),
  ...(readOwnDataValue(receipt, 'status') === 'applied' ? {} : { failure: readOwnDataValue(receipt, 'failure') }),
})

const indeterminateReceipt = (authority, reason) => ({
  schemaVersion: 1,
  ...authority,
  status: 'indeterminate',
  failure: { code: 'INDETERMINATE_RECEIPT', message: reason, retryable: false, details: { reason } },
})

const normalizeToolReceipt = (receipt, authority, label) => {
  assertExactKeys(
    receipt,
    ['schemaVersion', 'projectId', 'branchId', 'callId', 'status'],
    ['revision', 'witness', 'failure'],
    label,
  )
  if (readOwnDataValue(receipt, 'schemaVersion') !== 1) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      `${label}-schema-version-is-unsupported`,
    )
  }
  assertAuthority(authority, receipt, ['projectId', 'branchId'])
  if (readOwnDataValue(receipt, 'callId') !== authority.callId) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.authorityMismatch,
      `${label}-callId-does-not-match-authority`,
      { field: 'callId' },
    )
  }
  const revision = readOwnDataValue(receipt, 'revision', undefined)
  if (revision !== undefined) requireNonEmptyString(revision, `${label}.revision`)
  const witness = readOwnDataValue(receipt, 'witness', undefined)
  if (witness !== undefined) assertPlainRecord(witness, `${label}.witness`)
  const status = readOwnDataValue(receipt, 'status')
  if (!['applied', 'not-applied', 'indeterminate', 'rejected'].includes(status)) {
    throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest, `${label}-status-is-invalid`)
  }
  const receiptFailure = readOwnDataValue(receipt, 'failure', undefined)
  if (status === 'applied') {
    if (receiptFailure !== undefined) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        `${label}-applied-status-forbids-failure`,
      )
    }
    return receipt
  }
  assertExactKeys(receiptFailure, ['code', 'message', 'retryable'], ['details'], `${label}.failure`)
  requireNonEmptyString(readOwnDataValue(receiptFailure, 'code'), `${label}.failure.code`)
  requireNonEmptyString(readOwnDataValue(receiptFailure, 'message'), `${label}.failure.message`)
  if (typeof readOwnDataValue(receiptFailure, 'retryable') !== 'boolean') {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      `${label}.failure.retryable-must-be-a-boolean`,
    )
  }
  const details = readOwnDataValue(receiptFailure, 'details', undefined)
  if (details !== undefined) assertPlainRecord(details, `${label}.failure.details`)
  return receipt
}

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

const recoverDurableScreenReceipt = async (persistence, authority) => {
  const recovery = await persistence.recoverDurableAgentReceipt(authority)
  assertPlainRecord(recovery, 'receipt-recovery')
  const classification = readOwnDataValue(recovery, 'classification')
  if (classification === 'missing') {
    assertExactKeys(recovery, ['classification'], [], 'receipt-recovery')
    return null
  }
  if (classification === 'indeterminate') {
    assertExactKeys(recovery, ['classification', 'reason'], [], 'receipt-recovery')
    const reason = requireNonEmptyString(readOwnDataValue(recovery, 'reason'), 'receipt-recovery.reason')
    return indeterminateReceipt(authority, reason)
  }
  if (classification !== 'committed' && classification !== 'failed') {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'receipt-recovery-classification-is-invalid',
    )
  }
  assertExactKeys(recovery, ['classification', 'receipt', 'receiptIntent'], [], 'receipt-recovery')
  const receipt = normalizeToolReceipt(readOwnDataValue(recovery, 'receipt'), authority, 'receipt-recovery.receipt')
  const verification = await verifyScreenReceiptIntentRecovery({
    receiptIntent: readOwnDataValue(recovery, 'receiptIntent'),
    receipt,
    hashCanonicalJson,
  })
  if (verification.classification === 'indeterminate') {
    return indeterminateReceipt(authority, verification.reason)
  }
  const status = readOwnDataValue(receipt, 'status')
  if (
    (classification === 'committed' && status !== 'applied') ||
    (classification === 'failed' && status !== 'not-applied' && status !== 'rejected')
  ) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'receipt-recovery-status-does-not-match-classification',
    )
  }
  return receipt
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
  #activityLease
  #authority
  #artifactService
  #compensationService
  #dataService
  #disposed = false
  #engine
  #manifestCache
  #invocationActivity
  #persistence
  #promotionAvailability
  #promotionRecoveryBarrier
  #promotionService
  #screenApplyChangeSet
  #snapshotService
  #unregisterCoreProvider

  constructor({
    activityLease,
    adapterGeneration = 1,
    authority,
    artifactService,
    compensationService,
    dataResolver,
    dataService,
    engine,
    invocationActivity,
    isTransactionCommittedError,
    isTransactionRollbackIncompleteError,
    now = Date.now,
    persistence,
    promotionAvailability,
    promotionService,
  }) {
    if (!Number.isSafeInteger(adapterGeneration) || adapterGeneration < 1) {
      throw new TypeError('adapterGeneration must be a positive safe integer')
    }
    if (!engine || !engine.project || !engine.materials) throw new TypeError('engine is required')
    if (
      typeof persistence?.recoverDurableAgentReceipt !== 'function' ||
      typeof persistence?.runDurableAgentWrite !== 'function'
    ) {
      throw new TypeError('persistence must expose recoverDurableAgentReceipt and runDurableAgentWrite')
    }
    if (
      typeof activityLease?.waitUntilIdle !== 'function' ||
      typeof activityLease?.isActive !== 'function' ||
      !Number.isSafeInteger(activityLease?.generation)
    ) {
      throw new TypeError('activityLease must expose waitUntilIdle, isActive, and a generation')
    }
    if (typeof now !== 'function') throw new TypeError('now must be a function')
    if (
      typeof isTransactionCommittedError !== 'function' ||
      typeof isTransactionRollbackIncompleteError !== 'function'
    ) {
      throw new TypeError('screen writes require both Core transaction error predicates')
    }
    this.#activityLease = activityLease
    if (invocationActivity !== undefined && typeof invocationActivity?.begin !== 'function') {
      throw new TypeError('invocationActivity must expose begin')
    }
    this.#invocationActivity = invocationActivity
    this.#authority = normalizeAuthority(authority)
    if (artifactService !== undefined) {
      for (const method of ['createOnline', 'queryReceipt', 'reviseOnline']) {
        if (typeof artifactService?.[method] !== 'function') {
          throw new TypeError(`artifactService must expose ${method}`)
        }
      }
      this.#artifactService = artifactService
    } else this.#artifactService = null
    if (promotionAvailability !== undefined && typeof promotionAvailability !== 'function') {
      throw new TypeError('promotionAvailability must be a function')
    }
    if (promotionService !== undefined) {
      for (const method of ['promoteLocal', 'queryReceipt', 'resumePending']) {
        if (typeof promotionService?.[method] !== 'function') {
          throw new TypeError(`promotionService must expose ${method}`)
        }
      }
      if (typeof promotionAvailability !== 'function') {
        throw new TypeError('promotionAvailability must be a function when promotionService is configured')
      }
      this.#promotionService = promotionService
    } else this.#promotionService = null
    this.#promotionAvailability = promotionAvailability ?? null
    this.#promotionRecoveryBarrier = this.#promotionService
      ? Promise.resolve()
          .then(() => this.#promotionService.resumePending())
          .then(result => {
            assertPlainRecord(result, 'promotion-recovery')
            assertExactKeys(result, ['results', 'schemaVersion'], [], 'promotion-recovery')
            const results = readOwnDataValue(result, 'results')
            if (readOwnDataValue(result, 'schemaVersion') !== 1 || !Array.isArray(results)) {
              throw new TypeError('promotion recovery result is invalid')
            }
            if (results.some(entry => readOwnDataValue(entry, 'status', undefined) === 'indeterminate')) {
              throw new TypeError('promotion recovery remains indeterminate')
            }
            return null
          })
          .catch(
            () =>
              new DashboardAgentHostError(
                DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
                'promotion-recovery-indeterminate',
                { stage: 'resume-pending' },
              ),
          )
      : Promise.resolve(null)
    this.#engine = engine
    this.#persistence = persistence
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
    this.#screenApplyChangeSet = createDashboardScreenApplyChangeSetHandler({
      authority: this.#authority,
      activityLease: this.#activityLease,
      engine,
      persistence: this.#persistence,
      captureFullSnapshot: () => this.#captureFull(),
      manifestCache: this.#manifestCache,
      hashCanonicalJson,
      now,
      isTransactionCommittedError,
      isTransactionRollbackIncompleteError,
    })
    if (dataService !== undefined) {
      for (const method of ['bind', 'inspect', 'preview', 'upsert']) {
        if (typeof dataService?.[method] !== 'function') {
          throw new TypeError(`dataService must expose ${method}`)
        }
      }
      this.#dataService = dataService
    } else if (dataResolver !== undefined) {
      const dataScreenApplyChangeSet = createDashboardScreenApplyChangeSetHandler({
        authority: this.#authority,
        activityLease: this.#activityLease,
        engine,
        persistence: this.#persistence,
        captureFullSnapshot: () => this.#captureFull(),
        manifestCache: createDashboardDataManifestCache(this.#manifestCache),
        hashCanonicalJson,
        now,
        isTransactionCommittedError,
        isTransactionRollbackIncompleteError,
      })
      this.#dataService = createDashboardDataCapabilityService({
        authority: this.#authority,
        engine,
        recoverInvocation: async recoveryAuthority => {
          assertExactKeys(recoveryAuthority, ['branchId', 'callId', 'projectId'], [], 'data-recovery-authority')
          assertAuthority(this.#authority, recoveryAuthority, ['projectId', 'branchId'])
          requireNonEmptyString(readOwnDataValue(recoveryAuthority, 'callId'), 'data-recovery-authority.callId')
          const receipt = await recoverDurableScreenReceipt(this.#persistence, recoveryAuthority)
          return receipt === null ? null : invocationFromReceipt(receipt)
        },
        resolver: dataResolver,
        screenApplyChangeSet: dataScreenApplyChangeSet,
      })
    } else this.#dataService = null
    this.#compensationService =
      compensationService ??
      createDashboardTaskCompensationService({
        authority: this.#authority,
        activityLease: this.#activityLease,
        engine,
        persistence: this.#persistence,
        captureFullSnapshot: () => this.#captureFull(),
        manifestCache: this.#manifestCache,
        hashCanonicalJson,
        now,
        isTransactionCommittedError,
        isTransactionRollbackIncompleteError,
      })
    if (
      typeof this.#compensationService?.compensate !== 'function' ||
      typeof this.#compensationService?.query !== 'function'
    ) {
      throw new TypeError('compensationService must expose compensate and query')
    }
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
    const capability = readOwnDataValue(request, 'capability')
    dashboardCapabilityRegistry.assertAvailable(capability)
    await this.#assertPromotionAvailable(capability)
    if (isDashboardDataCapability(capability) && !this.#dataService) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
        'data-service-is-unavailable',
      )
    }
    if (isDashboardOnlineArtifactCapability(capability) && !this.#artifactService) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
        'artifact-service-is-unavailable',
      )
    }
    return boundaryClone(await dashboardCapabilityRegistry.describeCapability(request))
  }

  async #assertPromotionAvailable(capability) {
    if (capability !== 'artifact.promoteLocal') return
    await this.#awaitPromotionRecovery()
    if (!this.#promotionAvailability) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
        'promotion-feature-disabled',
      )
    }
    const availability = await this.#promotionAvailability()
    assertPlainRecord(availability, 'promotion-availability')
    assertExactKeys(availability, ['available'], ['reason'], 'promotion-availability')
    if (readOwnDataValue(availability, 'available') !== true) {
      const reason = requireNonEmptyString(readOwnDataValue(availability, 'reason'), 'promotion-availability.reason')
      throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable, reason)
    }
    if (!this.#promotionService) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
        'promotion-service-is-unavailable',
      )
    }
  }

  async #awaitPromotionRecovery() {
    const failure = await this.#promotionRecoveryBarrier
    if (failure) throw failure
  }

  #rejected(call, error) {
    const capability = readOwnDataValue(call, 'capability', undefined)
    return boundaryClone({
      schemaVersion: 1,
      callId: readOwnDataValue(call, 'callId'),
      status: 'rejected',
      failure: {
        code: toFailureCode(error),
        message: 'Dashboard capability call was rejected',
        retryable: false,
        details: toFailureDetails(error, capability),
      },
    })
  }

  #beginInvocationActivity(call, args) {
    if (!this.#invocationActivity) return () => undefined
    try {
      const targetNodeIds = invocationTargetNodeIds(readOwnDataValue(call, 'capability'), args)
      const finish = this.#invocationActivity.begin(
        freezeDto({
          callId: readOwnDataValue(call, 'callId'),
          capability: readOwnDataValue(call, 'capability'),
          taskId: readOwnDataValue(call, 'taskId'),
          targetNodeIds,
          targets: invocationTargets(this.#engine, targetNodeIds),
        }),
      )
      if (typeof finish !== 'function') return () => undefined
      return () => {
        try {
          finish()
        } catch {
          // UI activity observers cannot affect Host invocation authority.
        }
      }
    } catch {
      return () => undefined
    }
  }

  async invoke(call, context) {
    let finishInvocationActivity = () => undefined
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
      const invocationContext = normalizeInvokeContext(context, call)
      const capability = readOwnDataValue(call, 'capability')
      dashboardCapabilityRegistry.assertAvailable(capability)
      await this.#assertPromotionAvailable(capability)
      if (isDashboardDataCapability(capability) && !this.#dataService) {
        throw new DashboardAgentHostError(
          DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
          'data-service-is-unavailable',
        )
      }
      if (isDashboardOnlineArtifactCapability(capability) && !this.#artifactService) {
        throw new DashboardAgentHostError(
          DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
          'artifact-service-is-unavailable',
        )
      }
      const args = readOwnDataValue(call, 'arguments')
      assertPlainRecord(args, 'semantic-call.arguments')
      finishInvocationActivity = this.#beginInvocationActivity(call, args)
      if (capability === 'artifact.createOnline') {
        return boundaryClone(await this.#artifactService.createOnline(call))
      }
      if (capability === 'artifact.reviseOnline') {
        return boundaryClone(await this.#artifactService.reviseOnline(call))
      }
      if (capability === 'artifact.promoteLocal') {
        return boundaryClone(await this.#promotionService.promoteLocal(call))
      }
      if (capability === 'screen.applyChangeSet') {
        return boundaryClone(await this.#screenApplyChangeSet(call))
      }
      if (capability === 'data.upsert') return boundaryClone(await this.#dataService.upsert(call))
      if (capability === 'data.bind') return boundaryClone(await this.#dataService.bind(call))
      if (capability === 'task.compensate') {
        const receipt = await this.#compensationService.compensate({
          schemaVersion: 1,
          outerCallId: readOwnDataValue(call, 'callId'),
          target: invocationContext.compensationTarget,
        })
        return boundaryClone(
          invocationFromReceipt(
            normalizeToolReceipt(
              receipt,
              { projectId: this.#authority.projectId, branchId: this.#authority.branchId, callId: call.callId },
              'task-compensation-receipt',
            ),
          ),
        )
      }
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
      else if (capability === 'data.inspect') output = await this.#dataService.inspect(call)
      else if (capability === 'data.preview') output = await this.#dataService.preview(call)
      else {
        throw new DashboardAgentHostError(
          DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
          'capability-has-no-host-handler',
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
    } finally {
      finishInvocationActivity()
    }
  }

  async queryReceipt(request) {
    this.#assertActive()
    assertExactKeys(
      request,
      ['branchId', 'callId', 'projectId', 'schemaVersion', 'sessionId', 'taskId'],
      [],
      'receipt-query',
    )
    if (readOwnDataValue(request, 'schemaVersion') !== 1) {
      throw new DashboardAgentHostError(
        DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
        'receipt-query-schema-version-is-unsupported',
      )
    }
    requireNonEmptyString(readOwnDataValue(request, 'callId'), 'receipt-query.callId')
    assertAuthority(this.#authority, request, AUTHORITY_FIELDS)
    const authority = {
      projectId: readOwnDataValue(request, 'projectId'),
      branchId: readOwnDataValue(request, 'branchId'),
      callId: readOwnDataValue(request, 'callId'),
    }
    const compensationReceipt = await this.#compensationService.query({
      schemaVersion: 1,
      outerCallId: authority.callId,
    })
    if (compensationReceipt !== null) {
      return boundaryClone(normalizeToolReceipt(compensationReceipt, authority, 'task-compensation-recovery'))
    }
    if (this.#promotionService) {
      await this.#awaitPromotionRecovery()
      const promotionReceipt = await this.#promotionService.queryReceipt(authority)
      if (promotionReceipt !== null) {
        return boundaryClone(normalizeToolReceipt(promotionReceipt, authority, 'local-material-promotion-recovery'))
      }
    }
    if (this.#artifactService) {
      const artifactReceipt = await this.#artifactService.queryReceipt(authority)
      if (artifactReceipt !== null) {
        return boundaryClone(normalizeToolReceipt(artifactReceipt, authority, 'online-artifact-recovery'))
      }
    }
    return boundaryClone(await recoverDurableScreenReceipt(this.#persistence, authority))
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
    activityLease: readOwnDataValue(options, 'activityLease', undefined),
    adapterGeneration: readOwnDataValue(options, 'adapterGeneration', 1),
    artifactService: readOwnDataValue(options, 'artifactService', undefined),
    authority: readOwnDataValue(options, 'authority'),
    compensationService: readOwnDataValue(options, 'compensationService', undefined),
    dataResolver: readOwnDataValue(options, 'dataResolver', undefined),
    dataService: readOwnDataValue(options, 'dataService', undefined),
    engine: readOwnDataValue(options, 'engine'),
    invocationActivity: readOwnDataValue(options, 'invocationActivity', undefined),
    isTransactionCommittedError: readOwnDataValue(options, 'isTransactionCommittedError', undefined),
    isTransactionRollbackIncompleteError: readOwnDataValue(options, 'isTransactionRollbackIncompleteError', undefined),
    now: readOwnDataValue(options, 'now', Date.now),
    persistence: readOwnDataValue(options, 'persistence', undefined),
    promotionAvailability: readOwnDataValue(options, 'promotionAvailability', undefined),
    promotionService: readOwnDataValue(options, 'promotionService', undefined),
  })
}
