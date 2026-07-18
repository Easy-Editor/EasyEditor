import { validateArtifactRef, validateArtifactSourceRevision } from '../../online-components/artifact-contracts.mjs'
import {
  assertExactRecord,
  cloneJsonValue,
  failContract,
  freezeDto,
  jsonDataEqual,
  optionalOwnDataValue,
  ownDataValue,
  requireLiteral,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireSchemaVersion,
  requireSha256,
} from '../../persistence/contract.mjs'
import {
  GENERATED_MATERIAL_HOST_COMPONENT_NAME,
  normalizeOnlineArtifactCoreResult,
  normalizeOnlineArtifactPrepareResult,
  normalizeOnlineArtifactProjectCapture,
} from '../artifact/contract.mjs'

export { GENERATED_MATERIAL_HOST_COMPONENT_NAME }

export const LOCAL_MATERIAL_PROMOTION_CAPABILITY = 'artifact.promoteLocal'

const CALL_FIELDS = Object.freeze([
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
])
const AUTHORITY_FIELDS = Object.freeze(['branchId', 'projectId', 'sessionId', 'taskId'])

const boundedString = (value, path, maximum = 256) => {
  const normalized = requireNonEmptyString(value, path)
  if (new TextEncoder().encode(normalized).byteLength > maximum) return failContract('exceeds-byte-budget', path)
  return normalized
}

export const normalizeLocalMaterialPromotionAuthority = value => {
  assertExactRecord(value, AUTHORITY_FIELDS, [], 'LocalMaterialPromotion.authority')
  return freezeDto(
    Object.fromEntries(
      AUTHORITY_FIELDS.map(field => [
        field,
        boundedString(
          ownDataValue(value, field, 'LocalMaterialPromotion.authority'),
          `LocalMaterialPromotion.authority.${field}`,
        ),
      ]),
    ),
  )
}

export const normalizeLocalMaterialPromotionCall = (value, boundAuthority) => {
  const authority = normalizeLocalMaterialPromotionAuthority(boundAuthority)
  assertExactRecord(value, CALL_FIELDS, [], 'LocalMaterialPromotion.call')
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'LocalMaterialPromotion.call'),
    'LocalMaterialPromotion.call.schemaVersion',
  )
  const argumentsValue = ownDataValue(value, 'arguments', 'LocalMaterialPromotion.call')
  assertExactRecord(argumentsValue, ['schemaVersion', 'nodeId'], [], 'LocalMaterialPromotion.call.arguments')
  requireSchemaVersion(
    ownDataValue(argumentsValue, 'schemaVersion', 'LocalMaterialPromotion.call.arguments'),
    'LocalMaterialPromotion.call.arguments.schemaVersion',
  )
  const normalized = freezeDto({
    schemaVersion: 1,
    projectId: boundedString(
      ownDataValue(value, 'projectId', 'LocalMaterialPromotion.call'),
      'LocalMaterialPromotion.call.projectId',
    ),
    branchId: boundedString(
      ownDataValue(value, 'branchId', 'LocalMaterialPromotion.call'),
      'LocalMaterialPromotion.call.branchId',
    ),
    sessionId: boundedString(
      ownDataValue(value, 'sessionId', 'LocalMaterialPromotion.call'),
      'LocalMaterialPromotion.call.sessionId',
    ),
    taskId: boundedString(
      ownDataValue(value, 'taskId', 'LocalMaterialPromotion.call'),
      'LocalMaterialPromotion.call.taskId',
    ),
    stepId: boundedString(
      ownDataValue(value, 'stepId', 'LocalMaterialPromotion.call'),
      'LocalMaterialPromotion.call.stepId',
    ),
    callId: boundedString(
      ownDataValue(value, 'callId', 'LocalMaterialPromotion.call'),
      'LocalMaterialPromotion.call.callId',
    ),
    capability: requireLiteral(
      ownDataValue(value, 'capability', 'LocalMaterialPromotion.call'),
      [LOCAL_MATERIAL_PROMOTION_CAPABILITY],
      'LocalMaterialPromotion.call.capability',
    ),
    expectedRevision: boundedString(
      ownDataValue(value, 'expectedRevision', 'LocalMaterialPromotion.call'),
      'LocalMaterialPromotion.call.expectedRevision',
      512,
    ),
    arguments: freezeDto({
      schemaVersion: 1,
      nodeId: boundedString(
        ownDataValue(argumentsValue, 'nodeId', 'LocalMaterialPromotion.call.arguments'),
        'LocalMaterialPromotion.call.arguments.nodeId',
      ),
    }),
  })
  for (const field of AUTHORITY_FIELDS) {
    if (normalized[field] !== authority[field]) {
      return failContract('authority-mismatch', `LocalMaterialPromotion.call.${field}`)
    }
  }
  return normalized
}

export const normalizeLocalMaterialPromotionPrepareResult = (value, expected) =>
  normalizeOnlineArtifactPrepareResult(value, {
    capability: 'artifact.reviseOnline',
    expectedRevision: expected.expectedRevision,
    nodeId: expected.nodeId,
  })

export const normalizeLocalMaterialPromotionCoreResult = (value, expected) =>
  normalizeOnlineArtifactCoreResult(value, expected)

export const normalizeLocalMaterialPromotionProjectCapture = value => normalizeOnlineArtifactProjectCapture(value)

export const normalizeLocalMaterialPromotionArtifactIdentity = value => {
  assertExactRecord(
    value,
    ['artifactId', 'sourceRevision', 'logicalComponentId', 'sourceIntegrity', 'dependencyLockDigest'],
    [],
    'LocalMaterialPromotion.artifactIdentity',
  )
  const sourceRevision = validateArtifactSourceRevision({
    artifactId: ownDataValue(value, 'artifactId', 'LocalMaterialPromotion.artifactIdentity'),
    sourceRevision: ownDataValue(value, 'sourceRevision', 'LocalMaterialPromotion.artifactIdentity'),
    logicalComponentId: ownDataValue(value, 'logicalComponentId', 'LocalMaterialPromotion.artifactIdentity'),
    sourceIntegrity: ownDataValue(value, 'sourceIntegrity', 'LocalMaterialPromotion.artifactIdentity'),
  })
  return freezeDto({
    ...sourceRevision,
    dependencyLockDigest: requireSha256(
      ownDataValue(value, 'dependencyLockDigest', 'LocalMaterialPromotion.artifactIdentity'),
      'LocalMaterialPromotion.artifactIdentity.dependencyLockDigest',
    ),
  })
}

export const normalizeLocalMaterialPromotionPreImages = value => {
  assertExactRecord(
    value,
    [
      'schemaVersion',
      'kind',
      'capability',
      'documentId',
      'nodeId',
      'previousArtifactRef',
      'artifactIdentity',
      'promotionId',
      'callDigest',
      'expectedRevision',
    ],
    [],
    'LocalMaterialPromotion.preImages',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'LocalMaterialPromotion.preImages'),
    'LocalMaterialPromotion.preImages.schemaVersion',
  )
  return freezeDto({
    schemaVersion: 1,
    kind: requireLiteral(
      ownDataValue(value, 'kind', 'LocalMaterialPromotion.preImages'),
      ['local-material-promotion-pre-images'],
      'LocalMaterialPromotion.preImages.kind',
    ),
    capability: requireLiteral(
      ownDataValue(value, 'capability', 'LocalMaterialPromotion.preImages'),
      [LOCAL_MATERIAL_PROMOTION_CAPABILITY],
      'LocalMaterialPromotion.preImages.capability',
    ),
    documentId: boundedString(
      ownDataValue(value, 'documentId', 'LocalMaterialPromotion.preImages'),
      'LocalMaterialPromotion.preImages.documentId',
    ),
    nodeId: boundedString(
      ownDataValue(value, 'nodeId', 'LocalMaterialPromotion.preImages'),
      'LocalMaterialPromotion.preImages.nodeId',
    ),
    previousArtifactRef: validateArtifactRef(
      ownDataValue(value, 'previousArtifactRef', 'LocalMaterialPromotion.preImages'),
    ),
    artifactIdentity: normalizeLocalMaterialPromotionArtifactIdentity(
      ownDataValue(value, 'artifactIdentity', 'LocalMaterialPromotion.preImages'),
    ),
    promotionId: requireSha256(
      ownDataValue(value, 'promotionId', 'LocalMaterialPromotion.preImages'),
      'LocalMaterialPromotion.preImages.promotionId',
    ),
    callDigest: requireSha256(
      ownDataValue(value, 'callDigest', 'LocalMaterialPromotion.preImages'),
      'LocalMaterialPromotion.preImages.callDigest',
    ),
    expectedRevision: boundedString(
      ownDataValue(value, 'expectedRevision', 'LocalMaterialPromotion.preImages'),
      'LocalMaterialPromotion.preImages.expectedRevision',
      512,
    ),
  })
}

export const normalizeLocalMaterialPromotionPlannedPostImages = value => {
  assertExactRecord(
    value,
    ['schemaVersion', 'kind', 'componentName', 'nodeId', 'promotionId', 'sourceRevision'],
    [],
    'LocalMaterialPromotion.plannedPostImages',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'LocalMaterialPromotion.plannedPostImages'),
    'LocalMaterialPromotion.plannedPostImages.schemaVersion',
  )
  return freezeDto({
    schemaVersion: 1,
    kind: requireLiteral(
      ownDataValue(value, 'kind', 'LocalMaterialPromotion.plannedPostImages'),
      ['local-material-promotion-post-images'],
      'LocalMaterialPromotion.plannedPostImages.kind',
    ),
    componentName: requireLiteral(
      ownDataValue(value, 'componentName', 'LocalMaterialPromotion.plannedPostImages'),
      [GENERATED_MATERIAL_HOST_COMPONENT_NAME],
      'LocalMaterialPromotion.plannedPostImages.componentName',
    ),
    nodeId: boundedString(
      ownDataValue(value, 'nodeId', 'LocalMaterialPromotion.plannedPostImages'),
      'LocalMaterialPromotion.plannedPostImages.nodeId',
    ),
    promotionId: requireSha256(
      ownDataValue(value, 'promotionId', 'LocalMaterialPromotion.plannedPostImages'),
      'LocalMaterialPromotion.plannedPostImages.promotionId',
    ),
    sourceRevision: validateArtifactSourceRevision(
      ownDataValue(value, 'sourceRevision', 'LocalMaterialPromotion.plannedPostImages'),
    ),
  })
}

export const normalizeLocalMaterialPromotionFinalPostImages = value => {
  assertExactRecord(
    value,
    ['schemaVersion', 'kind', 'componentName', 'nodeId', 'artifactRef'],
    [],
    'LocalMaterialPromotion.finalPostImages',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'LocalMaterialPromotion.finalPostImages'),
    'LocalMaterialPromotion.finalPostImages.schemaVersion',
  )
  const artifactRef = validateArtifactRef(ownDataValue(value, 'artifactRef', 'LocalMaterialPromotion.finalPostImages'))
  if (artifactRef.target.kind !== 'local-material') {
    return failContract('artifact-ref-must-be-local-material', 'LocalMaterialPromotion.finalPostImages.artifactRef')
  }
  return freezeDto({
    schemaVersion: 1,
    kind: requireLiteral(
      ownDataValue(value, 'kind', 'LocalMaterialPromotion.finalPostImages'),
      ['local-material-promotion-post-images'],
      'LocalMaterialPromotion.finalPostImages.kind',
    ),
    componentName: requireLiteral(
      ownDataValue(value, 'componentName', 'LocalMaterialPromotion.finalPostImages'),
      [GENERATED_MATERIAL_HOST_COMPONENT_NAME],
      'LocalMaterialPromotion.finalPostImages.componentName',
    ),
    nodeId: boundedString(
      ownDataValue(value, 'nodeId', 'LocalMaterialPromotion.finalPostImages'),
      'LocalMaterialPromotion.finalPostImages.nodeId',
    ),
    artifactRef,
  })
}

export const normalizeLocalMaterialPromotionServerResult = (value, expected) => {
  assertExactRecord(
    value,
    ['schemaVersion', 'status', 'promotionId', 'materialId', 'materialVersion', 'buildIntegrity', 'rollbackTo'],
    [],
    'LocalMaterialPromotion.serverResult',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'LocalMaterialPromotion.serverResult'),
    'LocalMaterialPromotion.serverResult.schemaVersion',
  )
  requireLiteral(
    ownDataValue(value, 'status', 'LocalMaterialPromotion.serverResult'),
    ['active'],
    'LocalMaterialPromotion.serverResult.status',
  )
  const promotionId = boundedString(
    ownDataValue(value, 'promotionId', 'LocalMaterialPromotion.serverResult'),
    'LocalMaterialPromotion.serverResult.promotionId',
  )
  if (promotionId !== expected.promotionId) {
    return failContract('promotion-identity-mismatch', 'LocalMaterialPromotion.serverResult.promotionId')
  }
  const rollbackTo = validateArtifactSourceRevision(
    ownDataValue(value, 'rollbackTo', 'LocalMaterialPromotion.serverResult'),
  )
  if (!jsonDataEqual(rollbackTo, expected.sourceRevision)) {
    return failContract('rollback-source-mismatch', 'LocalMaterialPromotion.serverResult.rollbackTo')
  }
  const artifactRef = validateArtifactRef({
    ...expected.sourceRevision,
    target: {
      kind: 'local-material',
      materialId: boundedString(
        ownDataValue(value, 'materialId', 'LocalMaterialPromotion.serverResult'),
        'LocalMaterialPromotion.serverResult.materialId',
      ),
      materialVersion: boundedString(
        ownDataValue(value, 'materialVersion', 'LocalMaterialPromotion.serverResult'),
        'LocalMaterialPromotion.serverResult.materialVersion',
      ),
      buildIntegrity: ownDataValue(value, 'buildIntegrity', 'LocalMaterialPromotion.serverResult'),
    },
    rollbackTo,
  })
  return freezeDto({
    schemaVersion: 1,
    status: 'active',
    promotionId,
    materialId: artifactRef.target.materialId,
    materialVersion: artifactRef.target.materialVersion,
    buildIntegrity: artifactRef.target.buildIntegrity,
    rollbackTo,
    artifactRef,
  })
}

export const createStoredLocalMaterialPromotionServerResult = value => {
  const { artifactRef: _artifactRef, ...stored } = value
  return freezeDto(cloneJsonValue(stored, 'LocalMaterialPromotion.storedServerResult'))
}

const JOURNAL_BASE_FIELDS = Object.freeze([
  'schemaVersion',
  'stage',
  'call',
  'callDigest',
  'promotionId',
  'prepare',
  'artifactIdentity',
])

export const normalizeLocalMaterialPromotionJournalValue = (value, boundAuthority) => {
  const stage = requireLiteral(
    ownDataValue(value, 'stage', 'LocalMaterialPromotion.journal.value'),
    ['prepared', 'registry-active', 'committed', 'failed'],
    'LocalMaterialPromotion.journal.value.stage',
  )
  const stageFields = {
    prepared: [],
    'registry-active': ['server'],
    committed: ['server', 'output'],
    failed: ['server', 'failureCode'],
  }[stage]
  assertExactRecord(value, [...JOURNAL_BASE_FIELDS, ...stageFields], [], 'LocalMaterialPromotion.journal.value')
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'LocalMaterialPromotion.journal.value'),
    'LocalMaterialPromotion.journal.value.schemaVersion',
  )
  const call = normalizeLocalMaterialPromotionCall(
    ownDataValue(value, 'call', 'LocalMaterialPromotion.journal.value'),
    boundAuthority,
  )
  const prepare = normalizeLocalMaterialPromotionPrepareResult(
    ownDataValue(value, 'prepare', 'LocalMaterialPromotion.journal.value'),
    { expectedRevision: call.expectedRevision, nodeId: call.arguments.nodeId },
  )
  const artifactIdentity = normalizeLocalMaterialPromotionArtifactIdentity(
    ownDataValue(value, 'artifactIdentity', 'LocalMaterialPromotion.journal.value'),
  )
  const artifactSourceRevision = validateArtifactSourceRevision({
    artifactId: artifactIdentity.artifactId,
    sourceRevision: artifactIdentity.sourceRevision,
    logicalComponentId: artifactIdentity.logicalComponentId,
    sourceIntegrity: artifactIdentity.sourceIntegrity,
  })
  const previousSourceRevision = validateArtifactSourceRevision({
    artifactId: prepare.previousArtifactRef.artifactId,
    sourceRevision: prepare.previousArtifactRef.sourceRevision,
    logicalComponentId: prepare.previousArtifactRef.logicalComponentId,
    sourceIntegrity: prepare.previousArtifactRef.sourceIntegrity,
  })
  if (
    prepare.previousArtifactRef.target.kind !== 'online' ||
    !jsonDataEqual(previousSourceRevision, artifactSourceRevision)
  ) {
    return failContract('prepare-artifact-identity-mismatch', 'LocalMaterialPromotion.journal.value')
  }
  const promotionId = requireSha256(
    ownDataValue(value, 'promotionId', 'LocalMaterialPromotion.journal.value'),
    'LocalMaterialPromotion.journal.value.promotionId',
  )
  const normalized = {
    schemaVersion: 1,
    stage,
    call,
    callDigest: requireSha256(
      ownDataValue(value, 'callDigest', 'LocalMaterialPromotion.journal.value'),
      'LocalMaterialPromotion.journal.value.callDigest',
    ),
    promotionId,
    prepare,
    artifactIdentity,
  }
  if (stage !== 'prepared') {
    const server = normalizeLocalMaterialPromotionServerResult(
      ownDataValue(value, 'server', 'LocalMaterialPromotion.journal.value'),
      { promotionId, sourceRevision: artifactSourceRevision },
    )
    normalized.server = createStoredLocalMaterialPromotionServerResult(server)
    if (stage === 'committed') {
      const output = normalizeLocalMaterialPromotionFinalPostImages(
        ownDataValue(value, 'output', 'LocalMaterialPromotion.journal.value'),
      )
      if (output.nodeId !== call.arguments.nodeId || !jsonDataEqual(output.artifactRef, server.artifactRef)) {
        return failContract('committed-output-mismatch', 'LocalMaterialPromotion.journal.value.output')
      }
      normalized.output = output
    }
    if (stage === 'failed') {
      normalized.failureCode = boundedString(
        ownDataValue(value, 'failureCode', 'LocalMaterialPromotion.journal.value'),
        'LocalMaterialPromotion.journal.value.failureCode',
      )
    }
  }
  return freezeDto(normalized)
}

export const normalizeLocalMaterialPromotionJournalRecord = (value, boundAuthority) => {
  assertExactRecord(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'sessionId', 'callId', 'recordId', 'kind', 'value'],
    ['taskId', 'draftGeneration', 'updatedAt'],
    'LocalMaterialPromotion.journal',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'LocalMaterialPromotion.journal'),
    'LocalMaterialPromotion.journal.schemaVersion',
  )
  const authority = normalizeLocalMaterialPromotionAuthority(boundAuthority)
  for (const field of ['projectId', 'branchId', 'sessionId']) {
    if (ownDataValue(value, field, 'LocalMaterialPromotion.journal') !== authority[field]) {
      return failContract('authority-mismatch', `LocalMaterialPromotion.journal.${field}`)
    }
  }
  const taskId = optionalOwnDataValue(value, 'taskId', 'LocalMaterialPromotion.journal')
  if (taskId !== undefined && taskId !== authority.taskId) {
    return failContract('authority-mismatch', 'LocalMaterialPromotion.journal.taskId')
  }
  const callId = boundedString(
    ownDataValue(value, 'callId', 'LocalMaterialPromotion.journal'),
    'LocalMaterialPromotion.journal.callId',
  )
  const recordId = boundedString(
    ownDataValue(value, 'recordId', 'LocalMaterialPromotion.journal'),
    'LocalMaterialPromotion.journal.recordId',
  )
  if (recordId !== `promotion:${callId}`) {
    return failContract('record-id-mismatch', 'LocalMaterialPromotion.journal.recordId')
  }
  const journalValue = normalizeLocalMaterialPromotionJournalValue(
    ownDataValue(value, 'value', 'LocalMaterialPromotion.journal'),
    authority,
  )
  if (journalValue.call.callId !== callId) {
    return failContract('call-id-mismatch', 'LocalMaterialPromotion.journal.value.callId')
  }
  const draftGeneration = optionalOwnDataValue(value, 'draftGeneration', 'LocalMaterialPromotion.journal')
  const updatedAt = optionalOwnDataValue(value, 'updatedAt', 'LocalMaterialPromotion.journal')
  return freezeDto({
    schemaVersion: 1,
    ...authority,
    callId,
    recordId,
    kind: requireLiteral(
      ownDataValue(value, 'kind', 'LocalMaterialPromotion.journal'),
      ['local-material-promotion'],
      'LocalMaterialPromotion.journal.kind',
    ),
    value: journalValue,
    ...(draftGeneration === undefined
      ? {}
      : {
          draftGeneration: requireNonNegativeInteger(draftGeneration, 'LocalMaterialPromotion.journal.draftGeneration'),
        }),
    ...(updatedAt === undefined
      ? {}
      : { updatedAt: requireNonNegativeInteger(updatedAt, 'LocalMaterialPromotion.journal.updatedAt') }),
  })
}
