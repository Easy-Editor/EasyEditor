import {
  PersistenceLineageContractError,
  assertExactRecord,
  cloneJsonObject,
  cloneJsonValue,
  compareCodeUnits,
  failContract,
  freezeDto,
  jsonDataEqual,
  optionalOwnDataValue,
  ownDataValue,
  requireLiteral,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireSchemaVersion,
} from '../persistence/contract.mjs'
import { parseMutationProvenance } from '../persistence/provenance.mjs'
import {
  createReceiptIntent,
  createToolReceipt,
  parseApplyWitness,
  parseFailureWitness,
} from '../persistence/receipt-ledger.mjs'

export const TASK_COMPENSATION_SCHEMA_VERSION = 1
export const TASK_COMPENSATE_CAPABILITY = 'task.compensate'
export const SCREEN_APPLY_CHANGESET_CAPABILITY = 'screen.applyChangeSet'

const RUN_STATUSES = ['running', 'paused', 'completed', 'completed-with-conflicts']
const PAUSE_CODES = ['APPLIED_UNDURABLE', 'AMBIGUOUS_RECEIPT', 'PROVENANCE_UNCERTAIN', 'PERSISTENCE_FAILURE']
const CONFLICT_CODES = ['POST_IMAGE_CHANGED', 'PROVENANCE_CHANGED', 'ANCHOR_INVALID', 'IDENTITY_REUSED', 'AMBIGUOUS']
const IMAGE_KINDS = ['field', 'node', 'placement']
const IDENTITY_STATES = ['matches', 'missing', 'reused', 'ambiguous']
const ANCHOR_STATES = ['valid', 'invalid', 'ambiguous']
const INVERSE_OPERATION_TYPES = ['insert', 'move', 'remove', 'reorder', 'resize', 'set', 'unset']

const requireBoolean = (value, path) => {
  if (typeof value !== 'boolean') return failContract('must-be-a-boolean', path)
  return value
}

const requireFiniteNumber = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return failContract('must-be-a-finite-number', path)
  return value
}

const parseStringArray = (value, path, { unique = false, sort = false } = {}) => {
  if (!Array.isArray(value)) return failContract('must-be-an-array', path)
  const parsed = cloneJsonValue(value, path).map((item, index) => requireNonEmptyString(item, `${path}[${index}]`))
  if (unique && new Set(parsed).size !== parsed.length) return failContract('must-not-contain-duplicates', path)
  if (sort) parsed.sort(compareCodeUnits)
  return parsed
}

const parsePath = (value, path) => {
  if (!Array.isArray(value)) return failContract('must-be-an-array', path)
  return cloneJsonValue(value, path).map((segment, index) => {
    if (typeof segment !== 'string') return failContract('segments-must-be-strings', `${path}[${index}]`)
    return segment
  })
}

const parseFailure = (value, path, { requireResumeSafe } = {}) => {
  assertExactRecord(value, ['code', 'message', 'retryable'], ['details'], path)
  const rawDetails = optionalOwnDataValue(value, 'details', path)
  const details = rawDetails === undefined ? undefined : cloneJsonObject(rawDetails, `${path}.details`)
  if (requireResumeSafe !== undefined && details?.resumeSafe !== requireResumeSafe) {
    return failContract(`details.resumeSafe-must-be-${String(requireResumeSafe)}`, path)
  }
  return freezeDto({
    code: requireNonEmptyString(ownDataValue(value, 'code', path), `${path}.code`),
    message: requireNonEmptyString(ownDataValue(value, 'message', path), `${path}.message`),
    retryable: requireBoolean(ownDataValue(value, 'retryable', path), `${path}.retryable`),
    ...(details === undefined ? {} : { details }),
  })
}

const parseCallIndexEntry = (value, index) => {
  const path = `RuntimeTaskCompensationTarget.callIndex[${index}]`
  assertExactRecord(value, ['callId', 'capability'], [], path)
  return freezeDto({
    callId: requireNonEmptyString(ownDataValue(value, 'callId', path), `${path}.callId`),
    capability: requireNonEmptyString(ownDataValue(value, 'capability', path), `${path}.capability`),
  })
}

export const parseTaskCompensateArguments = value => {
  assertExactRecord(value, ['schemaVersion', 'targetTaskId'], [], 'TaskCompensateArguments')
  return freezeDto({
    schemaVersion: requireSchemaVersion(
      ownDataValue(value, 'schemaVersion', 'TaskCompensateArguments'),
      'TaskCompensateArguments.schemaVersion',
    ),
    targetTaskId: requireNonEmptyString(
      ownDataValue(value, 'targetTaskId', 'TaskCompensateArguments'),
      'TaskCompensateArguments.targetTaskId',
    ),
  })
}

export const parseRuntimeTaskCompensationTarget = value => {
  assertExactRecord(
    value,
    ['schemaVersion', 'taskId', 'sessionId', 'phase', 'callIndexComplete', 'callIndex'],
    [],
    'RuntimeTaskCompensationTarget',
  )
  const rawIndex = ownDataValue(value, 'callIndex', 'RuntimeTaskCompensationTarget')
  if (!Array.isArray(rawIndex)) return failContract('must-be-an-array', 'RuntimeTaskCompensationTarget.callIndex')
  const callIndex = rawIndex.map(parseCallIndexEntry)
  const ids = new Set()
  for (const [index, entry] of callIndex.entries()) {
    if (ids.has(entry.callId)) {
      return failContract('call-ids-must-be-unique', `RuntimeTaskCompensationTarget.callIndex[${index}].callId`)
    }
    ids.add(entry.callId)
    if (entry.capability === TASK_COMPENSATE_CAPABILITY) {
      return failContract(
        'compensation-of-compensation-is-forbidden',
        `RuntimeTaskCompensationTarget.callIndex[${index}]`,
      )
    }
  }
  if (ownDataValue(value, 'callIndexComplete', 'RuntimeTaskCompensationTarget') !== true) {
    return failContract('must-be-literal-true', 'RuntimeTaskCompensationTarget.callIndexComplete')
  }
  return freezeDto({
    schemaVersion: requireSchemaVersion(
      ownDataValue(value, 'schemaVersion', 'RuntimeTaskCompensationTarget'),
      'RuntimeTaskCompensationTarget.schemaVersion',
    ),
    taskId: requireNonEmptyString(
      ownDataValue(value, 'taskId', 'RuntimeTaskCompensationTarget'),
      'RuntimeTaskCompensationTarget.taskId',
    ),
    sessionId: requireNonEmptyString(
      ownDataValue(value, 'sessionId', 'RuntimeTaskCompensationTarget'),
      'RuntimeTaskCompensationTarget.sessionId',
    ),
    phase: requireLiteral(
      ownDataValue(value, 'phase', 'RuntimeTaskCompensationTarget'),
      ['COMPLETED', 'CANCELLED'],
      'RuntimeTaskCompensationTarget.phase',
    ),
    callIndexComplete: true,
    callIndex,
  })
}

export const deriveCompensationRunId = value => {
  assertExactRecord(value, ['projectId', 'branchId', 'outerCallId'], [], 'CompensationRunIdentity')
  const parts = ['projectId', 'branchId', 'outerCallId'].map(key =>
    encodeURIComponent(
      requireNonEmptyString(ownDataValue(value, key, 'CompensationRunIdentity'), `CompensationRunIdentity.${key}`),
    ),
  )
  return `compensation-run-v1:${parts.join(':')}`
}

export const deriveInverseCompensationCallId = value => {
  assertExactRecord(
    value,
    ['projectId', 'branchId', 'outerCompensationCallId', 'originalCallId'],
    [],
    'InverseCompensationIdentity',
  )
  const parts = ['projectId', 'branchId', 'outerCompensationCallId', 'originalCallId'].map(key =>
    encodeURIComponent(
      requireNonEmptyString(
        ownDataValue(value, key, 'InverseCompensationIdentity'),
        `InverseCompensationIdentity.${key}`,
      ),
    ),
  )
  return `compensation-inverse-v1:${parts.join(':')}`
}

export const deriveEmptyCompensationCallId = value => {
  assertExactRecord(value, ['projectId', 'branchId', 'outerCompensationCallId'], [], 'EmptyCompensationIdentity')
  return deriveInverseCompensationCallId({ ...value, originalCallId: '$empty' })
}

export const compensationRunRecordId = outerCallId =>
  `compensation-run:${requireNonEmptyString(outerCallId, 'outerCallId')}`

export const compensationTargetClaimRecordId = targetTaskId =>
  `compensation-target:${requireNonEmptyString(targetTaskId, 'targetTaskId')}`

export const compensationCursorCheckpointId = (compensationRunId, cursor, inverseCallId) => {
  requireNonEmptyString(compensationRunId, 'compensationRunId')
  requireNonNegativeInteger(cursor, 'cursor')
  requireNonEmptyString(inverseCallId, 'inverseCallId')
  return `compensation-cursor-v1:${encodeURIComponent(compensationRunId)}:${cursor}:${encodeURIComponent(inverseCallId)}`
}

const parseConflict = (value, index) => {
  const path = `CompensationRun.conflicts[${index}]`
  assertExactRecord(value, ['originalCallId', 'inverseCallId', 'code', 'slotKeys'], [], path)
  return freezeDto({
    originalCallId: requireNonEmptyString(ownDataValue(value, 'originalCallId', path), `${path}.originalCallId`),
    inverseCallId: requireNonEmptyString(ownDataValue(value, 'inverseCallId', path), `${path}.inverseCallId`),
    code: requireLiteral(ownDataValue(value, 'code', path), CONFLICT_CODES, `${path}.code`),
    slotKeys: parseStringArray(ownDataValue(value, 'slotKeys', path), `${path}.slotKeys`, {
      unique: true,
      sort: true,
    }),
  })
}

export const parseCompensationRun = value => {
  assertExactRecord(
    value,
    [
      'schemaVersion',
      'compensationRunId',
      'outerCallId',
      'sessionId',
      'taskId',
      'cursor',
      'originalCallIds',
      'conflicts',
      'status',
    ],
    ['pause'],
    'CompensationRun',
  )
  const status = requireLiteral(
    ownDataValue(value, 'status', 'CompensationRun'),
    RUN_STATUSES,
    'CompensationRun.status',
  )
  const cursor = requireNonNegativeInteger(ownDataValue(value, 'cursor', 'CompensationRun'), 'CompensationRun.cursor')
  const originalCallIds = parseStringArray(
    ownDataValue(value, 'originalCallIds', 'CompensationRun'),
    'CompensationRun.originalCallIds',
    { unique: true },
  )
  if (cursor > originalCallIds.length)
    return failContract('cursor-must-not-exceed-plan-length', 'CompensationRun.cursor')
  if (status === 'running' && originalCallIds.length > 0 && cursor === originalCallIds.length) {
    return failContract('exhausted-run-must-be-terminal', 'CompensationRun.status')
  }
  if ((status === 'completed' || status === 'completed-with-conflicts') && cursor !== originalCallIds.length) {
    return failContract('terminal-run-must-exhaust-plan', 'CompensationRun.cursor')
  }
  const rawConflicts = ownDataValue(value, 'conflicts', 'CompensationRun')
  if (!Array.isArray(rawConflicts)) return failContract('must-be-an-array', 'CompensationRun.conflicts')
  const conflicts = rawConflicts.map(parseConflict)
  const pauseValue = optionalOwnDataValue(value, 'pause', 'CompensationRun')
  let pause
  if (status === 'paused') {
    if (pauseValue === undefined) return failContract('pause-is-required', 'CompensationRun.pause')
    assertExactRecord(pauseValue, ['code', 'resumeSafe', 'failure'], [], 'CompensationRun.pause')
    if (ownDataValue(pauseValue, 'resumeSafe', 'CompensationRun.pause') !== false) {
      return failContract('must-be-literal-false', 'CompensationRun.pause.resumeSafe')
    }
    pause = freezeDto({
      code: requireLiteral(
        ownDataValue(pauseValue, 'code', 'CompensationRun.pause'),
        PAUSE_CODES,
        'CompensationRun.pause.code',
      ),
      resumeSafe: false,
      failure: parseFailure(
        ownDataValue(pauseValue, 'failure', 'CompensationRun.pause'),
        'CompensationRun.pause.failure',
        {
          requireResumeSafe: false,
        },
      ),
    })
    if (pause.failure.code !== pause.code) {
      return failContract('failure-code-must-match-pause-code', 'CompensationRun.pause.failure.code')
    }
  } else if (pauseValue !== undefined) {
    return failContract('pause-is-forbidden', 'CompensationRun.pause')
  }
  if (status === 'completed' && conflicts.length > 0) {
    return failContract('completed-run-must-not-have-conflicts', 'CompensationRun.status')
  }
  if (status === 'completed-with-conflicts' && conflicts.length === 0) {
    return failContract('completed-with-conflicts-requires-a-conflict', 'CompensationRun.conflicts')
  }
  return freezeDto({
    schemaVersion: requireSchemaVersion(
      ownDataValue(value, 'schemaVersion', 'CompensationRun'),
      'CompensationRun.schemaVersion',
    ),
    compensationRunId: requireNonEmptyString(
      ownDataValue(value, 'compensationRunId', 'CompensationRun'),
      'CompensationRun.compensationRunId',
    ),
    outerCallId: requireNonEmptyString(
      ownDataValue(value, 'outerCallId', 'CompensationRun'),
      'CompensationRun.outerCallId',
    ),
    sessionId: requireNonEmptyString(ownDataValue(value, 'sessionId', 'CompensationRun'), 'CompensationRun.sessionId'),
    taskId: requireNonEmptyString(ownDataValue(value, 'taskId', 'CompensationRun'), 'CompensationRun.taskId'),
    cursor,
    originalCallIds,
    conflicts,
    status,
    ...(pause === undefined ? {} : { pause }),
  })
}

export const createCompensationRun = parseCompensationRun

export const parseCompensationTargetClaim = value => {
  assertExactRecord(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'sessionId', 'targetTaskId', 'outerCallId', 'status'],
    [],
    'CompensationTargetClaim',
  )
  return freezeDto({
    schemaVersion: requireSchemaVersion(
      ownDataValue(value, 'schemaVersion', 'CompensationTargetClaim'),
      'CompensationTargetClaim.schemaVersion',
    ),
    projectId: requireNonEmptyString(
      ownDataValue(value, 'projectId', 'CompensationTargetClaim'),
      'CompensationTargetClaim.projectId',
    ),
    branchId: requireNonEmptyString(
      ownDataValue(value, 'branchId', 'CompensationTargetClaim'),
      'CompensationTargetClaim.branchId',
    ),
    sessionId: requireNonEmptyString(
      ownDataValue(value, 'sessionId', 'CompensationTargetClaim'),
      'CompensationTargetClaim.sessionId',
    ),
    targetTaskId: requireNonEmptyString(
      ownDataValue(value, 'targetTaskId', 'CompensationTargetClaim'),
      'CompensationTargetClaim.targetTaskId',
    ),
    outerCallId: requireNonEmptyString(
      ownDataValue(value, 'outerCallId', 'CompensationTargetClaim'),
      'CompensationTargetClaim.outerCallId',
    ),
    status: requireLiteral(
      ownDataValue(value, 'status', 'CompensationTargetClaim'),
      ['active'],
      'CompensationTargetClaim.status',
    ),
  })
}

const parseMaterialRegistryVersion = (value, path) => {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return failContract('must-be-a-non-empty-string-or-finite-number', path)
}

const parseImage = (value, index, label) => {
  const path = `${label}[${index}]`
  const kind = requireLiteral(ownDataValue(value, 'kind', path), IMAGE_KINDS, `${path}.kind`)
  if (kind === 'field') {
    assertExactRecord(
      value,
      ['operationIndex', 'kind', 'nodeId', 'fieldId', 'root', 'path', 'existed', 'value'],
      [],
      path,
    )
    return freezeDto({
      operationIndex: requireNonNegativeInteger(ownDataValue(value, 'operationIndex', path), `${path}.operationIndex`),
      kind,
      nodeId: requireNonEmptyString(ownDataValue(value, 'nodeId', path), `${path}.nodeId`),
      fieldId: requireNonEmptyString(ownDataValue(value, 'fieldId', path), `${path}.fieldId`),
      root: requireLiteral(ownDataValue(value, 'root', path), ['props', 'extras'], `${path}.root`),
      path: parsePath(ownDataValue(value, 'path', path), `${path}.path`),
      existed: requireBoolean(ownDataValue(value, 'existed', path), `${path}.existed`),
      value: cloneJsonValue(ownDataValue(value, 'value', path), `${path}.value`),
    })
  }
  if (kind === 'node') {
    assertExactRecord(value, ['operationIndex', 'kind', 'nodeId', 'existed', 'node'], [], path)
    const existed = requireBoolean(ownDataValue(value, 'existed', path), `${path}.existed`)
    const rawNode = ownDataValue(value, 'node', path)
    if (
      (existed && (typeof rawNode !== 'object' || rawNode === null || Array.isArray(rawNode))) ||
      (!existed && rawNode !== null)
    ) {
      return failContract('node-must-match-existed', `${path}.node`)
    }
    return freezeDto({
      operationIndex: requireNonNegativeInteger(ownDataValue(value, 'operationIndex', path), `${path}.operationIndex`),
      kind,
      nodeId: requireNonEmptyString(ownDataValue(value, 'nodeId', path), `${path}.nodeId`),
      existed,
      node: existed ? cloneJsonObject(rawNode, `${path}.node`) : null,
    })
  }
  assertExactRecord(
    value,
    ['operationIndex', 'kind', 'nodeId', 'existed', 'parentId', 'index', 'beforeId', 'afterId'],
    [],
    path,
  )
  const existed = requireBoolean(ownDataValue(value, 'existed', path), `${path}.existed`)
  const nullableString = key => {
    const item = ownDataValue(value, key, path)
    if (item === null) return null
    return requireNonEmptyString(item, `${path}.${key}`)
  }
  const rawIndex = ownDataValue(value, 'index', path)
  if ((!existed && rawIndex !== null) || (existed && (!Number.isSafeInteger(rawIndex) || rawIndex < 0))) {
    return failContract('index-must-match-existed', `${path}.index`)
  }
  const parentId = nullableString('parentId')
  if ((existed && parentId === null) || (!existed && parentId !== null)) {
    return failContract('parentId-must-match-existed', `${path}.parentId`)
  }
  return freezeDto({
    operationIndex: requireNonNegativeInteger(ownDataValue(value, 'operationIndex', path), `${path}.operationIndex`),
    kind,
    nodeId: requireNonEmptyString(ownDataValue(value, 'nodeId', path), `${path}.nodeId`),
    existed,
    parentId,
    index: rawIndex,
    beforeId: nullableString('beforeId'),
    afterId: nullableString('afterId'),
  })
}

const imageIdentity = image => {
  const path = image.kind === 'field' ? JSON.stringify(image.path) : ''
  const field = image.kind === 'field' ? `${image.root}:${image.fieldId}` : ''
  return `${image.operationIndex}:${image.kind}:${image.nodeId}:${field}:${path}`
}

const parseImageArray = (value, path) => {
  if (!Array.isArray(value)) return failContract('must-be-an-array', path)
  const images = value.map((image, index) => parseImage(image, index, path))
  const identities = images.map(imageIdentity)
  if (new Set(identities).size !== identities.length) return failContract('images-must-have-unique-identities', path)
  return images
}

const parsePosition = (value, path) => {
  const place = requireLiteral(
    ownDataValue(value, 'place', path),
    ['first', 'last', 'before', 'after'],
    `${path}.place`,
  )
  if (place === 'first' || place === 'last') {
    assertExactRecord(value, ['place'], [], path)
    return freezeDto({ place })
  }
  assertExactRecord(value, ['place', 'siblingId'], [], path)
  return freezeDto({
    place,
    siblingId: requireNonEmptyString(ownDataValue(value, 'siblingId', path), `${path}.siblingId`),
  })
}

const parseInverseOperation = (value, path) => {
  const type = requireLiteral(ownDataValue(value, 'type', path), INVERSE_OPERATION_TYPES, `${path}.type`)
  const opId = requireNonEmptyString(ownDataValue(value, 'opId', path), `${path}.opId`)
  const nodeId =
    type === 'insert' ? undefined : requireNonEmptyString(ownDataValue(value, 'nodeId', path), `${path}.nodeId`)
  if (type === 'set') {
    assertExactRecord(value, ['opId', 'type', 'nodeId', 'fieldId', 'value'], [], path)
    return freezeDto({
      opId,
      type,
      nodeId,
      fieldId: requireNonEmptyString(value.fieldId, `${path}.fieldId`),
      value: cloneJsonValue(value.value, `${path}.value`),
    })
  }
  if (type === 'unset') {
    assertExactRecord(value, ['opId', 'type', 'nodeId', 'fieldId'], [], path)
    return freezeDto({ opId, type, nodeId, fieldId: requireNonEmptyString(value.fieldId, `${path}.fieldId`) })
  }
  if (type === 'resize') {
    assertExactRecord(value, ['opId', 'type', 'nodeId', 'rect'], [], path)
    assertExactRecord(value.rect, ['x', 'y', 'width', 'height'], [], `${path}.rect`)
    return freezeDto({
      opId,
      type,
      nodeId,
      rect: freezeDto({
        x: requireFiniteNumber(value.rect.x, `${path}.rect.x`),
        y: requireFiniteNumber(value.rect.y, `${path}.rect.y`),
        width: requireFiniteNumber(value.rect.width, `${path}.rect.width`),
        height: requireFiniteNumber(value.rect.height, `${path}.rect.height`),
      }),
    })
  }
  if (type === 'remove') {
    assertExactRecord(value, ['opId', 'type', 'nodeId'], [], path)
    return freezeDto({ opId, type, nodeId })
  }
  if (type === 'insert') {
    assertExactRecord(value, ['opId', 'type', 'parentId', 'position', 'node'], [], path)
    return freezeDto({
      opId,
      type,
      parentId: requireNonEmptyString(value.parentId, `${path}.parentId`),
      position: parsePosition(value.position, `${path}.position`),
      node: cloneJsonObject(value.node, `${path}.node`),
    })
  }
  if (type === 'move') {
    assertExactRecord(value, ['opId', 'type', 'nodeId', 'parentId', 'position'], [], path)
    return freezeDto({
      opId,
      type,
      nodeId,
      parentId: requireNonEmptyString(value.parentId, `${path}.parentId`),
      position: parsePosition(value.position, `${path}.position`),
    })
  }
  assertExactRecord(value, ['opId', 'type', 'nodeId', 'position'], [], path)
  return freezeDto({ opId, type, nodeId, position: parsePosition(value.position, `${path}.position`) })
}

const parseInverseRecord = (value, index) => {
  const path = `ScreenCompensationPreImages.inverseOperations[${index}]`
  assertExactRecord(value, ['sourceOperationId', 'sourceOperationIndex', 'operation'], ['anchors'], path)
  const rawAnchors = optionalOwnDataValue(value, 'anchors', path)
  let anchors
  if (rawAnchors !== undefined) {
    assertExactRecord(rawAnchors, ['beforeId', 'afterId'], [], `${path}.anchors`)
    const parseNullable = key => {
      const item = ownDataValue(rawAnchors, key, `${path}.anchors`)
      return item === null ? null : requireNonEmptyString(item, `${path}.anchors.${key}`)
    }
    anchors = freezeDto({ beforeId: parseNullable('beforeId'), afterId: parseNullable('afterId') })
  }
  return freezeDto({
    sourceOperationId: requireNonEmptyString(
      ownDataValue(value, 'sourceOperationId', path),
      `${path}.sourceOperationId`,
    ),
    sourceOperationIndex: requireNonNegativeInteger(
      ownDataValue(value, 'sourceOperationIndex', path),
      `${path}.sourceOperationIndex`,
    ),
    ...(anchors === undefined ? {} : { anchors }),
    operation: parseInverseOperation(ownDataValue(value, 'operation', path), `${path}.operation`),
  })
}

const parseAffectedFieldSlot = (value, index, label) => {
  const path = `${label}[${index}]`
  assertExactRecord(value, ['nodeId', 'fieldId', 'root', 'path', 'slotKey', 'aliases'], [], path)
  const aliases = parseStringArray(ownDataValue(value, 'aliases', path), `${path}.aliases`, {
    unique: true,
    sort: true,
  })
  const slotKey = requireNonEmptyString(ownDataValue(value, 'slotKey', path), `${path}.slotKey`)
  if (!aliases.includes(slotKey)) return failContract('aliases-must-include-exact-slot', `${path}.aliases`)
  return freezeDto({
    nodeId: requireNonEmptyString(ownDataValue(value, 'nodeId', path), `${path}.nodeId`),
    fieldId: requireNonEmptyString(ownDataValue(value, 'fieldId', path), `${path}.fieldId`),
    root: requireLiteral(ownDataValue(value, 'root', path), ['props', 'extras'], `${path}.root`),
    path: parsePath(ownDataValue(value, 'path', path), `${path}.path`),
    slotKey,
    aliases,
  })
}

const parseAffectedStructuralSlot = (value, index, label) => {
  const path = `${label}[${index}]`
  const kind = requireLiteral(
    ownDataValue(value, 'kind', path),
    ['children-order', 'node-existence', 'node-parent', 'node-subtree'],
    `${path}.kind`,
  )
  const requiredIdentity = kind === 'children-order' ? 'parentId' : 'nodeId'
  assertExactRecord(value, ['kind', requiredIdentity, 'slotKey'], [], path)
  return freezeDto({
    kind,
    [requiredIdentity]: requireNonEmptyString(
      ownDataValue(value, requiredIdentity, path),
      `${path}.${requiredIdentity}`,
    ),
    slotKey: requireNonEmptyString(ownDataValue(value, 'slotKey', path), `${path}.slotKey`),
  })
}

const parseAffectedSlots = (value, label, parser) => {
  if (!Array.isArray(value)) return failContract('must-be-an-array', label)
  return value.map((item, index) => parser(item, index, label))
}

const validateAffectedSlotClosure = (fieldSlots, structuralSlots, affectedSlotKeys, label) => {
  const closure = [...fieldSlots.flatMap(slot => slot.aliases), ...structuralSlots.map(slot => slot.slotKey)]
  const canonical = [...new Set(closure)].sort(compareCodeUnits)
  if (!jsonDataEqual(canonical, affectedSlotKeys)) return failContract('affected-slot-closure-mismatch', label)
}

const parseInsertedIdentities = value => {
  if (!Array.isArray(value))
    return failContract('must-be-an-array', 'ScreenCompensationPreImages.insertedNodeIdentities')
  const parsed = value.map((entry, index) => {
    const path = `ScreenCompensationPreImages.insertedNodeIdentities[${index}]`
    assertExactRecord(entry, ['opId', 'nodeId'], [], path)
    return freezeDto({
      opId: requireNonEmptyString(ownDataValue(entry, 'opId', path), `${path}.opId`),
      nodeId: requireNonEmptyString(ownDataValue(entry, 'nodeId', path), `${path}.nodeId`),
    })
  })
  if (
    new Set(parsed.map(entry => entry.opId)).size !== parsed.length ||
    new Set(parsed.map(entry => entry.nodeId)).size !== parsed.length
  ) {
    return failContract('inserted-identities-must-be-unique', 'ScreenCompensationPreImages.insertedNodeIdentities')
  }
  return parsed
}

export const parseScreenCompensationPlan = value => {
  assertExactRecord(value, ['preImages', 'expectedPostImages'], [], 'ScreenCompensationPlanInput')
  const pre = ownDataValue(value, 'preImages', 'ScreenCompensationPlanInput')
  const post = ownDataValue(value, 'expectedPostImages', 'ScreenCompensationPlanInput')
  assertExactRecord(
    pre,
    [
      'schemaVersion',
      'kind',
      'documentId',
      'baseMutationVersion',
      'materialRegistryVersion',
      'insertedNodeIdentities',
      'images',
      'inverseOperations',
      'affectedFieldSlots',
      'affectedStructuralSlots',
      'affectedSlotKeys',
    ],
    [],
    'ScreenCompensationPreImages',
  )
  assertExactRecord(
    post,
    [
      'schemaVersion',
      'kind',
      'documentId',
      'images',
      'affectedFieldSlots',
      'affectedStructuralSlots',
      'affectedSlotKeys',
    ],
    [],
    'ScreenCompensationPostImages',
  )
  requireSchemaVersion(pre.schemaVersion, 'ScreenCompensationPreImages.schemaVersion')
  requireSchemaVersion(post.schemaVersion, 'ScreenCompensationPostImages.schemaVersion')
  requireLiteral(pre.kind, ['screen-change-set-pre-images'], 'ScreenCompensationPreImages.kind')
  requireLiteral(post.kind, ['screen-change-set-post-images'], 'ScreenCompensationPostImages.kind')
  const documentId = requireNonEmptyString(pre.documentId, 'ScreenCompensationPreImages.documentId')
  if (post.documentId !== documentId)
    return failContract('document-id-mismatch', 'ScreenCompensationPostImages.documentId')
  const fieldSlots = parseAffectedSlots(
    pre.affectedFieldSlots,
    'ScreenCompensationPreImages.affectedFieldSlots',
    parseAffectedFieldSlot,
  )
  const structuralSlots = parseAffectedSlots(
    pre.affectedStructuralSlots,
    'ScreenCompensationPreImages.affectedStructuralSlots',
    parseAffectedStructuralSlot,
  )
  const affectedSlotKeys = parseStringArray(pre.affectedSlotKeys, 'ScreenCompensationPreImages.affectedSlotKeys', {
    unique: true,
    sort: true,
  })
  validateAffectedSlotClosure(
    fieldSlots,
    structuralSlots,
    affectedSlotKeys,
    'ScreenCompensationPreImages.affectedSlotKeys',
  )
  const postFieldSlots = parseAffectedSlots(
    post.affectedFieldSlots,
    'ScreenCompensationPostImages.affectedFieldSlots',
    parseAffectedFieldSlot,
  )
  const postStructuralSlots = parseAffectedSlots(
    post.affectedStructuralSlots,
    'ScreenCompensationPostImages.affectedStructuralSlots',
    parseAffectedStructuralSlot,
  )
  const postAffectedSlotKeys = parseStringArray(
    post.affectedSlotKeys,
    'ScreenCompensationPostImages.affectedSlotKeys',
    {
      unique: true,
      sort: true,
    },
  )
  if (
    !jsonDataEqual(fieldSlots, postFieldSlots) ||
    !jsonDataEqual(structuralSlots, postStructuralSlots) ||
    !jsonDataEqual(affectedSlotKeys, postAffectedSlotKeys)
  ) {
    return failContract('affected-slot-metadata-mismatch', 'ScreenCompensationPostImages')
  }
  const inverseOperations = (() => {
    if (!Array.isArray(pre.inverseOperations))
      return failContract('must-be-an-array', 'ScreenCompensationPreImages.inverseOperations')
    return pre.inverseOperations.map(parseInverseRecord)
  })()
  return freezeDto({
    schemaVersion: 1,
    documentId,
    baseMutationVersion: requireNonNegativeInteger(
      pre.baseMutationVersion,
      'ScreenCompensationPreImages.baseMutationVersion',
    ),
    materialRegistryVersion: parseMaterialRegistryVersion(
      pre.materialRegistryVersion,
      'ScreenCompensationPreImages.materialRegistryVersion',
    ),
    insertedNodeIdentities: parseInsertedIdentities(pre.insertedNodeIdentities),
    preImages: parseImageArray(pre.images, 'ScreenCompensationPreImages.images'),
    expectedPostImages: parseImageArray(post.images, 'ScreenCompensationPostImages.images'),
    inverseOperations,
    affectedFieldSlots: fieldSlots,
    affectedStructuralSlots: structuralSlots,
    affectedSlotKeys,
  })
}

export const parseScreenCompensationObservation = value => {
  assertExactRecord(
    value,
    ['schemaVersion', 'documentId', 'images', 'identityStates', 'anchorStates', 'ambiguous'],
    [],
    'ScreenCompensationObservation',
  )
  const rawIdentityStates = ownDataValue(value, 'identityStates', 'ScreenCompensationObservation')
  if (!Array.isArray(rawIdentityStates))
    return failContract('must-be-an-array', 'ScreenCompensationObservation.identityStates')
  const identityStates = rawIdentityStates.map((entry, index) => {
    const path = `ScreenCompensationObservation.identityStates[${index}]`
    assertExactRecord(entry, ['nodeId', 'state'], [], path)
    return freezeDto({
      nodeId: requireNonEmptyString(entry.nodeId, `${path}.nodeId`),
      state: requireLiteral(entry.state, IDENTITY_STATES, `${path}.state`),
    })
  })
  if (new Set(identityStates.map(entry => entry.nodeId)).size !== identityStates.length) {
    return failContract('node-ids-must-be-unique', 'ScreenCompensationObservation.identityStates')
  }
  const rawAnchorStates = ownDataValue(value, 'anchorStates', 'ScreenCompensationObservation')
  if (!Array.isArray(rawAnchorStates))
    return failContract('must-be-an-array', 'ScreenCompensationObservation.anchorStates')
  const anchorStates = rawAnchorStates.map((entry, index) => {
    const path = `ScreenCompensationObservation.anchorStates[${index}]`
    assertExactRecord(entry, ['sourceOperationId', 'state'], [], path)
    return freezeDto({
      sourceOperationId: requireNonEmptyString(entry.sourceOperationId, `${path}.sourceOperationId`),
      state: requireLiteral(entry.state, ANCHOR_STATES, `${path}.state`),
    })
  })
  if (new Set(anchorStates.map(entry => entry.sourceOperationId)).size !== anchorStates.length) {
    return failContract('source-operation-ids-must-be-unique', 'ScreenCompensationObservation.anchorStates')
  }
  return freezeDto({
    schemaVersion: requireSchemaVersion(value.schemaVersion, 'ScreenCompensationObservation.schemaVersion'),
    documentId: requireNonEmptyString(value.documentId, 'ScreenCompensationObservation.documentId'),
    images: parseImageArray(value.images, 'ScreenCompensationObservation.images'),
    identityStates,
    anchorStates,
    ambiguous: requireBoolean(value.ambiguous, 'ScreenCompensationObservation.ambiguous'),
  })
}

const conflictResult = (originalCallId, inverseCallId, code, slotKeys) =>
  freezeDto({
    status: 'conflict',
    conflict: parseConflict({ originalCallId, inverseCallId, code, slotKeys }, 0),
  })

export const inspectScreenCompensationSafety = value => {
  assertExactRecord(
    value,
    ['originalCallId', 'inverseCallId', 'plan', 'observation', 'provenanceRecords'],
    [],
    'ScreenCompensationSafetyInput',
  )
  const originalCallId = requireNonEmptyString(value.originalCallId, 'ScreenCompensationSafetyInput.originalCallId')
  const inverseCallId = requireNonEmptyString(value.inverseCallId, 'ScreenCompensationSafetyInput.inverseCallId')
  const plan = parseScreenCompensationPlan({
    preImages: value.plan.preImagesPayload ?? value.plan.preImages,
    expectedPostImages: value.plan.expectedPostImagesPayload ?? value.plan.expectedPostImages,
  })
  const observation = parseScreenCompensationObservation(value.observation)
  const allSlots = plan.affectedSlotKeys
  if (observation.documentId !== plan.documentId || observation.ambiguous) {
    return conflictResult(originalCallId, inverseCallId, 'AMBIGUOUS', allSlots)
  }
  const expectedIdentityIds = plan.insertedNodeIdentities.map(entry => entry.nodeId).sort(compareCodeUnits)
  const actualIdentityIds = observation.identityStates.map(entry => entry.nodeId).sort(compareCodeUnits)
  if (!jsonDataEqual(expectedIdentityIds, actualIdentityIds)) {
    return conflictResult(originalCallId, inverseCallId, 'AMBIGUOUS', allSlots)
  }
  if (observation.identityStates.some(entry => entry.state === 'reused')) {
    return conflictResult(originalCallId, inverseCallId, 'IDENTITY_REUSED', allSlots)
  }
  if (observation.identityStates.some(entry => entry.state === 'missing')) {
    return conflictResult(originalCallId, inverseCallId, 'POST_IMAGE_CHANGED', allSlots)
  }
  if (observation.identityStates.some(entry => entry.state === 'ambiguous')) {
    return conflictResult(originalCallId, inverseCallId, 'AMBIGUOUS', allSlots)
  }
  const expectedAnchorIds = plan.inverseOperations
    .filter(entry => entry.anchors !== undefined)
    .map(entry => entry.sourceOperationId)
    .sort(compareCodeUnits)
  const actualAnchorIds = observation.anchorStates.map(entry => entry.sourceOperationId).sort(compareCodeUnits)
  if (!jsonDataEqual(expectedAnchorIds, actualAnchorIds)) {
    return conflictResult(originalCallId, inverseCallId, 'AMBIGUOUS', allSlots)
  }
  if (observation.anchorStates.some(entry => entry.state === 'ambiguous')) {
    return conflictResult(originalCallId, inverseCallId, 'AMBIGUOUS', allSlots)
  }
  if (observation.anchorStates.some(entry => entry.state === 'invalid')) {
    return conflictResult(originalCallId, inverseCallId, 'ANCHOR_INVALID', allSlots)
  }
  const expectedImages = new Map(plan.expectedPostImages.map(image => [imageIdentity(image), image]))
  const actualImages = new Map(observation.images.map(image => [imageIdentity(image), image]))
  if (
    expectedImages.size !== actualImages.size ||
    [...expectedImages].some(([key, image]) => !jsonDataEqual(image, actualImages.get(key)))
  ) {
    return conflictResult(originalCallId, inverseCallId, 'POST_IMAGE_CHANGED', allSlots)
  }
  if (!Array.isArray(value.provenanceRecords) || value.provenanceRecords.length !== allSlots.length) {
    return conflictResult(originalCallId, inverseCallId, 'PROVENANCE_CHANGED', allSlots)
  }
  const expectedToken = `agent:${originalCallId}`
  for (const [index, slotKey] of allSlots.entries()) {
    const rawRecord = value.provenanceRecords[index]
    if (rawRecord === null) return conflictResult(originalCallId, inverseCallId, 'PROVENANCE_CHANGED', allSlots)
    let record
    try {
      record = parseMutationProvenance(rawRecord)
    } catch {
      return conflictResult(originalCallId, inverseCallId, 'PROVENANCE_CHANGED', allSlots)
    }
    if (record.slotKey !== slotKey || record.token !== expectedToken) {
      return conflictResult(originalCallId, inverseCallId, 'PROVENANCE_CHANGED', allSlots)
    }
  }
  return freezeDto({ status: 'safe' })
}

const runWitness = run => ({
  schemaVersion: 1,
  kind: 'compensation-run',
  compensationRunId: run.compensationRunId,
  taskId: run.taskId,
  cursor: run.cursor,
  total: run.originalCallIds.length,
  conflictCount: run.conflicts.length,
  status: run.status,
})

export const projectCompensationRunReceipt = value => {
  assertExactRecord(value, ['projectId', 'branchId', 'run'], [], 'CompensationRunProjection')
  const projectId = requireNonEmptyString(value.projectId, 'CompensationRunProjection.projectId')
  const branchId = requireNonEmptyString(value.branchId, 'CompensationRunProjection.branchId')
  const run = parseCompensationRun(value.run)
  if (run.status === 'running') {
    return createToolReceipt({
      schemaVersion: 1,
      projectId,
      branchId,
      callId: run.outerCallId,
      status: 'indeterminate',
      failure: {
        code: 'COMPENSATION_IN_PROGRESS',
        message: 'Task compensation is durably in progress',
        retryable: true,
        details: {
          resumeSafe: true,
          compensationRunId: run.compensationRunId,
          cursor: run.cursor,
          total: run.originalCallIds.length,
          conflictCount: run.conflicts.length,
        },
      },
    })
  }
  if (run.status === 'paused') {
    return createToolReceipt({
      schemaVersion: 1,
      projectId,
      branchId,
      callId: run.outerCallId,
      status: 'indeterminate',
      failure: run.pause.failure,
    })
  }
  return createToolReceipt({
    schemaVersion: 1,
    projectId,
    branchId,
    callId: run.outerCallId,
    status: 'applied',
    // Runtime compares receipt revisions with the post-invocation Host
    // observation. Compensation progress is a different revision domain and
    // therefore belongs in the witness, not in InvocationResult.revision.
    witness: runWitness(run),
  })
}

const createPausedRun = (run, code, cause) => {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : code
  return createCompensationRun({
    ...run,
    status: 'paused',
    pause: {
      code,
      resumeSafe: false,
      failure: {
        code,
        message,
        retryable: false,
        details: {
          resumeSafe: false,
          compensationRunId: run.compensationRunId,
          cursor: run.cursor,
        },
      },
    },
  })
}

const nextRunAfterInverse = (run, conflict) => {
  const cursor = run.cursor + 1
  const conflicts = conflict === null ? run.conflicts : [...run.conflicts, conflict]
  const terminal = cursor === run.originalCallIds.length
  return createCompensationRun({
    ...run,
    cursor,
    conflicts,
    status: terminal ? (conflicts.length === 0 ? 'completed' : 'completed-with-conflicts') : 'running',
  })
}

const completeEmptyRun = run =>
  createCompensationRun({
    ...run,
    status: run.conflicts.length === 0 ? 'completed' : 'completed-with-conflicts',
  })

const requireMethod = (value, method, label) => {
  if (!value || typeof value[method] !== 'function') return failContract(`${method}-is-required`, label)
  return value[method].bind(value)
}

const parsePreparedInverse = (value, expected) => {
  assertExactRecord(value, ['receiptIntent', 'execute'], [], 'PreparedCompensationInverse')
  const receiptIntent = createReceiptIntent(value.receiptIntent)
  if (
    receiptIntent.projectId !== expected.projectId ||
    receiptIntent.branchId !== expected.branchId ||
    receiptIntent.callId !== expected.inverseCallId
  ) {
    return failContract('receipt-intent-authority-mismatch', 'PreparedCompensationInverse.receiptIntent')
  }
  const execute = ownDataValue(value, 'execute', 'PreparedCompensationInverse')
  if (typeof execute !== 'function') return failContract('must-be-a-function', 'PreparedCompensationInverse.execute')
  return { receiptIntent, execute }
}

const parseInverseOutcome = (value, expected) => {
  assertExactRecord(
    value,
    ['activeDocument', 'projectSchema', 'receipt', 'witness', 'provenance', 'updatedAt'],
    ['artifactRefs'],
    'CompensationInverseOutcome',
  )
  const receipt = createToolReceipt(value.receipt)
  if (
    receipt.projectId !== expected.projectId ||
    receipt.branchId !== expected.branchId ||
    receipt.callId !== expected.inverseCallId
  ) {
    return failContract('receipt-authority-mismatch', 'CompensationInverseOutcome.receipt')
  }
  const witness = receipt.status === 'applied' ? parseApplyWitness(value.witness) : parseFailureWitness(value.witness)
  const provenance = (() => {
    if (!Array.isArray(value.provenance))
      return failContract('must-be-an-array', 'CompensationInverseOutcome.provenance')
    return value.provenance.map(parseMutationProvenance)
  })()
  const rawArtifactRefs = optionalOwnDataValue(value, 'artifactRefs', 'CompensationInverseOutcome')
  return freezeDto({
    activeDocument:
      value.activeDocument === null
        ? null
        : cloneJsonObject(value.activeDocument, 'CompensationInverseOutcome.activeDocument'),
    projectSchema: cloneJsonObject(value.projectSchema, 'CompensationInverseOutcome.projectSchema'),
    receipt,
    witness,
    provenance,
    updatedAt: requireNonNegativeInteger(value.updatedAt, 'CompensationInverseOutcome.updatedAt'),
    ...(rawArtifactRefs === undefined
      ? {}
      : { artifactRefs: cloneJsonValue(rawArtifactRefs, 'CompensationInverseOutcome.artifactRefs') }),
  })
}

const validateServiceInput = value => {
  assertExactRecord(value, ['schemaVersion', 'outerCallId', 'target'], [], 'TaskCompensationRequest')
  return freezeDto({
    schemaVersion: requireSchemaVersion(value.schemaVersion, 'TaskCompensationRequest.schemaVersion'),
    outerCallId: requireNonEmptyString(value.outerCallId, 'TaskCompensationRequest.outerCallId'),
    target: parseRuntimeTaskCompensationTarget(value.target),
  })
}

export const createTaskCompensationService = options => {
  assertExactRecord(
    options,
    ['projectId', 'branchId', 'sessionId', 'persistence', 'observer', 'inverseExecutor'],
    ['beforeInverse', 'now'],
    'TaskCompensationServiceOptions',
  )
  const projectId = requireNonEmptyString(options.projectId, 'TaskCompensationServiceOptions.projectId')
  const branchId = requireNonEmptyString(options.branchId, 'TaskCompensationServiceOptions.branchId')
  const sessionId = requireNonEmptyString(options.sessionId, 'TaskCompensationServiceOptions.sessionId')
  const persistence = options.persistence
  const readRun = requireMethod(persistence, 'readCompensationRun', 'TaskCompensationServiceOptions.persistence')
  const readClaim = requireMethod(
    persistence,
    'readCompensationTargetClaim',
    'TaskCompensationServiceOptions.persistence',
  )
  const commitRunState = requireMethod(
    persistence,
    'commitCompensationRunState',
    'TaskCompensationServiceOptions.persistence',
  )
  const recoverReceipt = requireMethod(
    persistence,
    'recoverDurableAgentReceipt',
    'TaskCompensationServiceOptions.persistence',
  )
  const runWrite = requireMethod(persistence, 'runDurableAgentWrite', 'TaskCompensationServiceOptions.persistence')
  const observe = requireMethod(options.observer, 'observe', 'TaskCompensationServiceOptions.observer')
  const prepareInverse = requireMethod(
    options.inverseExecutor,
    'prepare',
    'TaskCompensationServiceOptions.inverseExecutor',
  )
  const beforeInverseValue = optionalOwnDataValue(options, 'beforeInverse', 'TaskCompensationServiceOptions')
  if (beforeInverseValue !== undefined && typeof beforeInverseValue !== 'function') {
    return failContract('must-be-a-function', 'TaskCompensationServiceOptions.beforeInverse')
  }
  const beforeInverse = beforeInverseValue ?? (async () => undefined)
  const now = optionalOwnDataValue(options, 'now', 'TaskCompensationServiceOptions') ?? Date.now
  if (typeof now !== 'function') return failContract('must-be-a-function', 'TaskCompensationServiceOptions.now')
  const volatilePauses = new Map()

  const runRequest = outerCallId => ({ schemaVersion: 1, projectId, branchId, sessionId, outerCallId })
  const targetRequest = targetTaskId => ({ schemaVersion: 1, projectId, branchId, sessionId, targetTaskId })
  const isTerminalRun = run => run.status === 'completed' || run.status === 'completed-with-conflicts'

  const validateRunAuthority = (run, request) => {
    const expectedRunId = deriveCompensationRunId({ projectId, branchId, outerCallId: request.outerCallId })
    if (
      run.compensationRunId !== expectedRunId ||
      run.outerCallId !== request.outerCallId ||
      run.sessionId !== sessionId ||
      run.taskId !== request.target.taskId
    ) {
      return failContract('stored-run-authority-mismatch', 'TaskCompensationRequest')
    }
    return run
  }

  const inspectRunClaim = async run => {
    try {
      const rawClaim = await readClaim(targetRequest(run.taskId))
      if (isTerminalRun(run)) {
        return rawClaim === null ? null : new Error('terminal compensation run must not retain its target claim')
      }
      if (rawClaim === null) return new Error('active compensation run is missing its target claim')
      const claim = parseCompensationTargetClaim(rawClaim)
      const expectedClaim = {
        schemaVersion: 1,
        projectId,
        branchId,
        sessionId,
        targetTaskId: run.taskId,
        outerCallId: run.outerCallId,
        status: 'active',
      }
      return jsonDataEqual(claim, expectedClaim)
        ? null
        : new Error('active compensation run target claim authority does not match')
    } catch (error) {
      return error instanceof Error ? error : new Error('compensation target claim could not be verified')
    }
  }

  const persistPause = async (run, code, cause) => {
    const paused = createPausedRun(run, code, cause)
    volatilePauses.set(run.outerCallId, paused)
    try {
      const result = await commitRunState({
        schemaVersion: 1,
        action: 'retain',
        projectId,
        branchId,
        sessionId,
        outerCallId: run.outerCallId,
        targetTaskId: run.taskId,
        updatedAt: now(),
        run: paused,
      })
      const stored = parseCompensationRun(result.run)
      volatilePauses.delete(run.outerCallId)
      return stored
    } catch {
      return paused
    }
  }

  const query = async value => {
    assertExactRecord(value, ['schemaVersion', 'outerCallId'], [], 'TaskCompensationQuery')
    requireSchemaVersion(value.schemaVersion, 'TaskCompensationQuery.schemaVersion')
    const outerCallId = requireNonEmptyString(value.outerCallId, 'TaskCompensationQuery.outerCallId')
    const volatile = volatilePauses.get(outerCallId)
    if (volatile) return projectCompensationRunReceipt({ projectId, branchId, run: volatile })
    const stored = await readRun(runRequest(outerCallId))
    return stored === null
      ? null
      : projectCompensationRunReceipt({ projectId, branchId, run: parseCompensationRun(stored) })
  }

  const commitInverse = async ({ run, originalCallId, inverseCallId, plan, conflict, kind }) => {
    let effectApplied = false
    try {
      return await runWrite(async session => {
        let safety = conflict === undefined ? null : { status: 'conflict', conflict }
        let observation = null
        if (kind === 'inverse') {
          const lineage = await session.readReceiptLineage({ projectId, branchId, callId: originalCallId })
          if (lineage.receiptIntent === null) return failContract('missing-original-receipt-intent', 'TaskCompensation')
          plan = parseScreenCompensationPlan({
            preImages: lineage.receiptIntent.preImages,
            expectedPostImages: lineage.receiptIntent.expectedPostImages,
          })
          observation = parseScreenCompensationObservation(
            await observe({
              schemaVersion: 1,
              projectId,
              branchId,
              sessionId,
              originalCallId,
              inverseCallId,
              plan,
            }),
          )
          const provenance = await session.readMutationProvenance({
            schemaVersion: 1,
            projectId,
            branchId,
            slotKeys: plan.affectedSlotKeys,
          })
          safety = inspectScreenCompensationSafety({
            originalCallId,
            inverseCallId,
            plan: {
              preImages: lineage.receiptIntent.preImages,
              expectedPostImages: lineage.receiptIntent.expectedPostImages,
            },
            observation,
            provenanceRecords: provenance.records,
          })
        }
        const actualConflict = safety?.status === 'conflict' ? safety.conflict : null
        const prepared = parsePreparedInverse(
          await prepareInverse({
            schemaVersion: 1,
            kind: kind === 'empty' ? 'empty' : actualConflict === null ? 'inverse' : 'conflict',
            projectId,
            branchId,
            sessionId,
            originalCallId,
            inverseCallId,
            plan,
            observation,
            conflict: actualConflict,
            draft: session.draft,
          }),
          { projectId, branchId, inverseCallId },
        )
        await session.recordIntent(prepared.receiptIntent)
        const outcome = parseInverseOutcome(await prepared.execute(), { projectId, branchId, inverseCallId })
        effectApplied = outcome.receipt.status === 'applied'
        const outcomeConflict =
          kind === 'inverse' && actualConflict === null && outcome.receipt.status !== 'applied'
            ? conflictResult(originalCallId, inverseCallId, 'AMBIGUOUS', plan.affectedSlotKeys).conflict
            : null
        const nextRun =
          kind === 'empty' ? completeEmptyRun(run) : nextRunAfterInverse(run, actualConflict ?? outcomeConflict)
        const terminal = nextRun.status === 'completed' || nextRun.status === 'completed-with-conflicts'
        await session.commitBatch({
          schemaVersion: 1,
          projectId,
          branchId,
          callId: inverseCallId,
          expectedDraftGeneration: session.draft.draftGeneration,
          activeDocument: outcome.activeDocument,
          projectSchema: outcome.projectSchema,
          updatedAt: outcome.updatedAt,
          receiptIntent: prepared.receiptIntent,
          receipt: outcome.receipt,
          witness: outcome.witness,
          provenance: outcome.provenance,
          sessionId,
          journal: {
            recordId: compensationRunRecordId(run.outerCallId),
            kind: 'compensation-run',
            value: nextRun,
          },
          checkpoint: {
            checkpointId: compensationCursorCheckpointId(nextRun.compensationRunId, nextRun.cursor, inverseCallId),
            value: {
              schemaVersion: 1,
              compensationRunId: nextRun.compensationRunId,
              cursor: nextRun.cursor,
              inverseCallId,
              originalCallId,
            },
          },
          ...(terminal ? { journalDeletes: [compensationTargetClaimRecordId(run.taskId)] } : {}),
          ...(outcome.artifactRefs === undefined ? {} : { artifactRefs: outcome.artifactRefs }),
        })
        return nextRun
      })
    } catch (error) {
      let ambiguousRecovery = null
      let pauseBaseRun = run
      try {
        const recovery = await recoverReceipt({ projectId, branchId, callId: inverseCallId })
        if (recovery.classification === 'committed' || recovery.classification === 'failed') {
          const stored = await readRun(runRequest(run.outerCallId))
          if (stored !== null) {
            const recoveredRun = parseCompensationRun(stored)
            pauseBaseRun = recoveredRun
            const expectedCursor = kind === 'empty' ? run.cursor : run.cursor + 1
            const exactProgress =
              recoveredRun.compensationRunId === run.compensationRunId &&
              recoveredRun.outerCallId === run.outerCallId &&
              recoveredRun.sessionId === run.sessionId &&
              recoveredRun.taskId === run.taskId &&
              recoveredRun.cursor === expectedCursor &&
              jsonDataEqual(recoveredRun.originalCallIds, run.originalCallIds) &&
              (kind !== 'empty' || isTerminalRun(recoveredRun))
            if (exactProgress && (await inspectRunClaim(recoveredRun)) === null) return recoveredRun
          }
          ambiguousRecovery = new Error('terminal inverse receipt does not have its exact atomic run advance')
        } else if (recovery.classification === 'indeterminate') {
          const stored = await readRun(runRequest(run.outerCallId))
          if (stored !== null) {
            const recoveredRun = parseCompensationRun(stored)
            if (
              recoveredRun.compensationRunId === run.compensationRunId &&
              recoveredRun.outerCallId === run.outerCallId &&
              recoveredRun.sessionId === run.sessionId &&
              recoveredRun.taskId === run.taskId &&
              recoveredRun.cursor >= run.cursor &&
              jsonDataEqual(recoveredRun.originalCallIds, run.originalCallIds)
            ) {
              pauseBaseRun = recoveredRun
            }
          }
          ambiguousRecovery = new Error(recovery.reason ?? 'inverse receipt recovery is indeterminate')
        }
      } catch (recoveryError) {
        ambiguousRecovery =
          recoveryError instanceof Error ? recoveryError : new Error('inverse receipt recovery failed')
      }
      const pauseCode =
        ambiguousRecovery !== null
          ? 'AMBIGUOUS_RECEIPT'
          : effectApplied
            ? 'APPLIED_UNDURABLE'
            : error instanceof PersistenceLineageContractError
              ? 'PROVENANCE_UNCERTAIN'
              : 'PERSISTENCE_FAILURE'
      return persistPause(pauseBaseRun, pauseCode, ambiguousRecovery ?? error)
    }
  }

  const compensate = async rawValue => {
    const request = validateServiceInput(rawValue)
    const target = request.target
    if (target.sessionId !== sessionId) return failContract('target-session-mismatch', 'TaskCompensationRequest.target')
    const volatile = volatilePauses.get(request.outerCallId)
    if (volatile) return projectCompensationRunReceipt({ projectId, branchId, run: volatile })

    const runValue = await readRun(runRequest(request.outerCallId))
    let run
    if (runValue === null) {
      const existingClaim = await readClaim(targetRequest(target.taskId))
      if (existingClaim !== null) {
        const claim = parseCompensationTargetClaim(existingClaim)
        if (claim.outerCallId !== request.outerCallId) {
          return failContract('target-is-owned-by-another-compensation-call', 'TaskCompensationRequest.target')
        }
        return failContract('target-claim-exists-without-run', 'TaskCompensationRequest.target')
      }
      const originalCallIds = []
      let ambiguousReason = null
      for (const entry of target.callIndex) {
        if (entry.capability !== SCREEN_APPLY_CHANGESET_CAPABILITY) continue
        const recovery = await recoverReceipt({ projectId, branchId, callId: entry.callId })
        if (recovery.classification === 'committed') originalCallIds.push(entry.callId)
        else if (recovery.classification === 'indeterminate') ambiguousReason = recovery.reason
      }
      originalCallIds.reverse()
      const compensationRunId = deriveCompensationRunId({
        projectId,
        branchId,
        outerCallId: request.outerCallId,
      })
      run = createCompensationRun({
        schemaVersion: 1,
        compensationRunId,
        outerCallId: request.outerCallId,
        sessionId,
        taskId: target.taskId,
        cursor: 0,
        originalCallIds,
        conflicts: [],
        status: ambiguousReason === null ? 'running' : 'paused',
        ...(ambiguousReason === null
          ? {}
          : {
              pause: {
                code: 'AMBIGUOUS_RECEIPT',
                resumeSafe: false,
                failure: {
                  code: 'AMBIGUOUS_RECEIPT',
                  message: ambiguousReason,
                  retryable: false,
                  details: { resumeSafe: false, compensationRunId, cursor: 0 },
                },
              },
            }),
      })
      const acquired = await commitRunState({
        schemaVersion: 1,
        action: 'acquire',
        projectId,
        branchId,
        sessionId,
        outerCallId: request.outerCallId,
        targetTaskId: target.taskId,
        updatedAt: now(),
        run,
      })
      run = parseCompensationRun(acquired.run)
    } else {
      run = parseCompensationRun(runValue)
    }
    validateRunAuthority(run, request)
    const initialClaimFailure = await inspectRunClaim(run)
    if (initialClaimFailure !== null) {
      run = await persistPause(run, 'PERSISTENCE_FAILURE', initialClaimFailure)
    }
    if (run.status !== 'running') return projectCompensationRunReceipt({ projectId, branchId, run })

    if (run.originalCallIds.length === 0) {
      const inverseCallId = deriveEmptyCompensationCallId({
        projectId,
        branchId,
        outerCompensationCallId: run.outerCallId,
      })
      const recovered = await recoverReceipt({ projectId, branchId, callId: inverseCallId })
      if (recovered.classification !== 'missing') {
        run = await persistPause(run, 'AMBIGUOUS_RECEIPT', 'empty-run receipt exists without a terminal run')
      } else {
        run = await commitInverse({
          run,
          originalCallId: '$empty',
          inverseCallId,
          plan: null,
          kind: 'empty',
        })
      }
      return projectCompensationRunReceipt({ projectId, branchId, run })
    }

    while (run.status === 'running') {
      const claimFailure = await inspectRunClaim(run)
      if (claimFailure !== null) {
        run = await persistPause(run, 'PERSISTENCE_FAILURE', claimFailure)
        break
      }
      const originalCallId = run.originalCallIds[run.cursor]
      const inverseCallId = deriveInverseCompensationCallId({
        projectId,
        branchId,
        outerCompensationCallId: run.outerCallId,
        originalCallId,
      })
      const recovered = await recoverReceipt({ projectId, branchId, callId: inverseCallId })
      if (recovered.classification !== 'missing') {
        run = await persistPause(run, 'AMBIGUOUS_RECEIPT', 'inverse receipt exists without its atomic cursor advance')
        break
      }
      await beforeInverse({
        schemaVersion: 1,
        projectId,
        branchId,
        sessionId,
        outerCallId: run.outerCallId,
        originalCallId,
        inverseCallId,
      })
      run = await commitInverse({ run, originalCallId, inverseCallId, plan: null, kind: 'inverse' })
    }
    return projectCompensationRunReceipt({ projectId, branchId, run })
  }

  return freezeDto({ compensate, query })
}

export { createDashboardTaskCompensationService } from './runtime-adapter.mjs'
