import { hashCanonicalJson } from '../../../../lib/storage/canonical-json.mjs'
import {
  validateArtifactRecord,
  validateArtifactRef,
  verifyArtifactRecordIntegrity,
} from '../../online-components/artifact-contracts.mjs'
import { cloneJsonValue, freezeDto, jsonDataEqual, requireNonNegativeInteger } from '../../persistence/contract.mjs'
import { createMutationProvenanceBatch } from '../../persistence/provenance.mjs'
import {
  createApplyWitness,
  createFailureWitness,
  createReceiptIntent,
  createToolReceipt,
  createToolReceiptWitness,
} from '../../persistence/receipt-ledger.mjs'
import { classifyOnlineArtifactCoreFailure } from '../artifact/service.mjs'
import {
  GENERATED_MATERIAL_HOST_COMPONENT_NAME,
  createStoredLocalMaterialPromotionServerResult,
  normalizeLocalMaterialPromotionArtifactIdentity,
  normalizeLocalMaterialPromotionCall,
  normalizeLocalMaterialPromotionCoreResult,
  normalizeLocalMaterialPromotionFinalPostImages,
  normalizeLocalMaterialPromotionJournalRecord,
  normalizeLocalMaterialPromotionJournalValue,
  normalizeLocalMaterialPromotionPlannedPostImages,
  normalizeLocalMaterialPromotionPreImages,
  normalizeLocalMaterialPromotionPrepareResult,
  normalizeLocalMaterialPromotionProjectCapture,
  normalizeLocalMaterialPromotionServerResult,
} from './contract.mjs'

export const LOCAL_MATERIAL_PROMOTION_FAILURE_CODE = Object.freeze({
  appliedUndurable: 'APPLIED_UNDURABLE',
  coreTransactionFailed: 'CORE_TRANSACTION_FAILED',
  idempotencyConflict: 'IDEMPOTENCY_CONFLICT',
  indeterminateCoreOutcome: 'INDETERMINATE_CORE_OUTCOME',
  indeterminateReceipt: 'INDETERMINATE_RECEIPT',
  indeterminateServerOutcome: 'INDETERMINATE_SERVER_OUTCOME',
  materialAdmissionFailed: 'MATERIAL_ADMISSION_FAILED',
  persistenceFailure: 'PERSISTENCE_FAILURE',
  serverPromotionFailed: 'SERVER_PROMOTION_FAILED',
})

class IndeterminateServerPromotionOutcomeError extends Error {
  constructor(cause) {
    super('The trusted server promotion outcome could not be determined', { cause })
    this.name = 'IndeterminateServerPromotionOutcomeError'
  }
}

const requireMethod = (value, key, label) => {
  if (!value || typeof value[key] !== 'function') throw new TypeError(`${label}.${key} is required`)
  return value[key].bind(value)
}

const invocationFailure = (callId, status, code, message, details = {}) =>
  freezeDto({
    schemaVersion: 1,
    callId,
    status,
    failure: {
      code,
      message,
      retryable: false,
      details: cloneJsonValue(details, 'LocalMaterialPromotion.failure.details'),
    },
  })

const invocationFromReceipt = (receipt, output) =>
  freezeDto({
    schemaVersion: 1,
    callId: receipt.callId,
    status: receipt.status,
    ...(receipt.revision === undefined ? {} : { revision: receipt.revision }),
    ...(receipt.status === 'applied' ? { output } : { failure: receipt.failure }),
  })

const sourceRevisionOf = value => ({
  artifactId: value.artifactId,
  sourceRevision: value.sourceRevision,
  logicalComponentId: value.logicalComponentId,
  sourceIntegrity: value.sourceIntegrity,
})

const artifactIdentityOf = artifact =>
  normalizeLocalMaterialPromotionArtifactIdentity({
    ...sourceRevisionOf(artifact),
    dependencyLockDigest: artifact.dependencyLockDigest,
  })

const materialRefsOf = artifactRef => [
  {
    materialId: artifactRef.target.materialId,
    materialVersion: artifactRef.target.materialVersion,
    buildIntegrity: artifactRef.target.buildIntegrity,
  },
]

const artifactRoot = (ownerType, ownerId, artifact, artifactRef) => ({
  ownerType,
  ownerId,
  artifactId: artifact.artifactId,
  sourceRevision: artifact.sourceRevision,
  materialRefs: materialRefsOf(artifactRef),
})

const journalRecordId = callId => `promotion:${callId}`

const journalRecord = ({ call, value }) => ({
  schemaVersion: 1,
  projectId: call.projectId,
  branchId: call.branchId,
  sessionId: call.sessionId,
  taskId: call.taskId,
  callId: call.callId,
  recordId: journalRecordId(call.callId),
  kind: 'local-material-promotion',
  value,
})

const baseJournalValue = state => ({
  schemaVersion: 1,
  call: state.call,
  callDigest: state.callDigest,
  promotionId: state.promotionId,
  prepare: state.prepare,
  artifactIdentity: state.artifactIdentity,
})

const preparedJournalValue = state => ({ ...baseJournalValue(state), stage: 'prepared' })
const activeJournalValue = state => ({
  ...baseJournalValue(state),
  stage: 'registry-active',
  server: state.server,
})
const committedJournalValue = (state, output) => ({
  ...baseJournalValue(state),
  stage: 'committed',
  server: state.server,
  output,
})
const failedJournalValue = (state, failureCode) => ({
  ...baseJournalValue(state),
  stage: 'failed',
  server: state.server,
  failureCode,
})

const plannedPostImages = state =>
  normalizeLocalMaterialPromotionPlannedPostImages({
    schemaVersion: 1,
    kind: 'local-material-promotion-post-images',
    componentName: GENERATED_MATERIAL_HOST_COMPONENT_NAME,
    nodeId: state.call.arguments.nodeId,
    promotionId: state.promotionId,
    sourceRevision: sourceRevisionOf(state.artifactIdentity),
  })

const finalPostImages = ({ call, artifactRef }) =>
  normalizeLocalMaterialPromotionFinalPostImages({
    schemaVersion: 1,
    kind: 'local-material-promotion-post-images',
    componentName: GENERATED_MATERIAL_HOST_COMPONENT_NAME,
    nodeId: call.arguments.nodeId,
    artifactRef,
  })

const findNode = (projectSchema, nodeId) => {
  const stack = Array.isArray(projectSchema?.componentsTree) ? [...projectSchema.componentsTree] : []
  let result = null
  while (stack.length > 0) {
    const candidate = stack.pop()
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    if (candidate.id === nodeId) {
      if (result !== null) return null
      result = candidate
    }
    if (Array.isArray(candidate.children)) stack.push(...candidate.children)
  }
  return result
}

const captureArtifactRef = (capture, nodeId) => {
  const node = findNode(capture.projectSchema, nodeId)
  try {
    return node?.$agent?.artifactRef ? validateArtifactRef(node.$agent.artifactRef) : null
  } catch {
    return null
  }
}

const preparedHashInput = ({ call, prepare, preImages, expectedPostImages }) => ({
  schemaVersion: 1,
  kind: 'local-material-promotion-prepared-hash',
  projectId: call.projectId,
  branchId: call.branchId,
  callId: call.callId,
  baseRevision: prepare.baseRevision,
  preImages,
  expectedPostImages,
})

const transactionFingerprintInput = ({ call, prepare, artifactRef, promotionId }) => ({
  schemaVersion: 1,
  kind: 'local-material-promotion-transaction-fingerprint',
  projectId: call.projectId,
  branchId: call.branchId,
  callId: call.callId,
  promotionId,
  documentId: prepare.documentId,
  nodeId: prepare.nodeId,
  baseMutationVersion: prepare.baseMutationVersion,
  previousArtifactRef: prepare.previousArtifactRef,
  artifactRef,
})

const promotionIdentityInput = ({ call, callDigest, artifactIdentity }) => ({
  schemaVersion: 1,
  kind: 'local-material-promotion-identity',
  authority: {
    projectId: call.projectId,
    branchId: call.branchId,
    sessionId: call.sessionId,
    taskId: call.taskId,
  },
  callId: call.callId,
  callDigest,
  artifact: artifactIdentity,
})

const terminalJournal = value => ({
  recordId: journalRecordId(value.call.callId),
  kind: 'local-material-promotion',
  value,
})

const terminalCheckpoint = ({ call, promotionId, status, failureCode }) => ({
  checkpointId: `promotion:${call.callId}`,
  value: {
    schemaVersion: 1,
    capability: call.capability,
    taskId: call.taskId,
    stepId: call.stepId,
    promotionId,
    status,
    ...(failureCode === undefined ? {} : { failureCode }),
  },
})

const durableRoots = ({ call, artifact, artifactRef, promotionId, journal, checkpoint, applied }) => [
  artifactRoot('durable-registry', promotionId, artifact, artifactRef),
  ...(applied ? [artifactRoot('promotion-rollback', promotionId, artifact, artifactRef)] : []),
  ...(applied ? [artifactRoot('working-draft', call.branchId, artifact, artifactRef)] : []),
  artifactRoot('receipt-intent', call.callId, artifact, artifactRef),
  artifactRoot('tool-receipt', call.callId, artifact, artifactRef),
  artifactRoot(
    'task-journal',
    `task-journal-v1:${encodeURIComponent(call.sessionId)}:${encodeURIComponent(journal.recordId)}`,
    artifact,
    artifactRef,
  ),
  artifactRoot('checkpoint', checkpoint.checkpointId, artifact, artifactRef),
]

const createService = options => {
  const authority = Object.freeze({ ...options.authority })
  const core = Object.freeze({
    prepareSwitch: requireMethod(options.core, 'prepareSwitch', 'core'),
    switchRef: requireMethod(options.core, 'switchRef', 'core'),
    restoreOnline: requireMethod(options.core, 'restoreOnline', 'core'),
    captureProject: requireMethod(options.core, 'captureProject', 'core'),
  })
  const persistence = Object.freeze({
    readArtifact: requireMethod(options.persistence, 'readArtifact', 'persistence'),
    recoverDurableAgentReceipt: requireMethod(options.persistence, 'recoverDurableAgentReceipt', 'persistence'),
    readPromotionJournal: requireMethod(options.persistence, 'readPromotionJournal', 'persistence'),
    listPromotionJournals: requireMethod(options.persistence, 'listPromotionJournals', 'persistence'),
    writePromotionJournal: requireMethod(options.persistence, 'writePromotionJournal', 'persistence'),
    runDurableAgentWrite: requireMethod(options.persistence, 'runDurableAgentWrite', 'persistence'),
  })
  const client = Object.freeze({
    promote: requireMethod(options.client, 'promote', 'client'),
    queryPromotion: requireMethod(options.client, 'queryPromotion', 'client'),
  })
  const admitMaterialRefsUnderSharedMutation =
    options.admitMaterialRefsUnderSharedMutation === undefined
      ? null
      : requireMethod(options, 'admitMaterialRefsUnderSharedMutation', 'options')
  const now = typeof options.now === 'function' ? options.now : Date.now
  const crypto = options.crypto ?? globalThis.crypto
  if (!crypto?.subtle || typeof crypto.subtle.digest !== 'function') {
    throw new TypeError('local material promotion requires WebCrypto SHA-256')
  }
  const hashJson = value => hashCanonicalJson(value, { crypto })
  const hashBytes = bytes => crypto.subtle.digest('SHA-256', bytes)
  const coreFailureClassifiers = Object.freeze({
    ...(typeof options.isTransactionCommittedError === 'function'
      ? { isTransactionCommittedError: options.isTransactionCommittedError }
      : {}),
    ...(typeof options.isTransactionRollbackIncompleteError === 'function'
      ? { isTransactionRollbackIncompleteError: options.isTransactionRollbackIncompleteError }
      : {}),
  })

  const readRawJournal = call =>
    persistence.readPromotionJournal({
      schemaVersion: 1,
      projectId: call.projectId,
      branchId: call.branchId,
      sessionId: call.sessionId,
      callId: call.callId,
    })

  const writeJournal = async (call, value) => {
    const stored = await persistence.writePromotionJournal(journalRecord({ call, value }))
    return normalizeLocalMaterialPromotionJournalRecord(stored, authority)
  }

  const readVerifiedArtifact = async (call, artifactIdentity) => {
    const artifact = validateArtifactRecord(
      await persistence.readArtifact({
        schemaVersion: 1,
        projectId: call.projectId,
        artifactId: artifactIdentity.artifactId,
        sourceRevision: artifactIdentity.sourceRevision,
      }),
    )
    if (artifact.projectId !== call.projectId || !jsonDataEqual(artifactIdentityOf(artifact), artifactIdentity)) {
      throw new Error('Promotion artifact authority or identity does not match the journal')
    }
    await verifyArtifactRecordIntegrity(artifact, { hashBytes })
    return artifact
  }

  const createDeterministicIntent = async state => {
    const preImages = normalizeLocalMaterialPromotionPreImages({
      schemaVersion: 1,
      kind: 'local-material-promotion-pre-images',
      capability: state.call.capability,
      documentId: state.prepare.documentId,
      nodeId: state.prepare.nodeId,
      previousArtifactRef: state.prepare.previousArtifactRef,
      artifactIdentity: state.artifactIdentity,
      promotionId: state.promotionId,
      callDigest: state.callDigest,
      expectedRevision: state.call.expectedRevision,
    })
    const expectedPostImages = plannedPostImages(state)
    return createReceiptIntent({
      schemaVersion: 1,
      projectId: state.call.projectId,
      branchId: state.call.branchId,
      callId: state.call.callId,
      preparedHash: await hashJson(
        preparedHashInput({ call: state.call, prepare: state.prepare, preImages, expectedPostImages }),
      ),
      baseRevision: state.prepare.baseRevision,
      preImages,
      expectedPostImages,
      status: 'pending',
    })
  }

  const hydrateJournal = async rawJournal => {
    const journal = normalizeLocalMaterialPromotionJournalRecord(rawJournal, authority)
    const state = journal.value
    const expectedCallDigest = await hashJson(state.call)
    if (expectedCallDigest !== state.callDigest) {
      throw new Error('Persisted callDigest does not match the canonical promotion call')
    }
    const artifact = await readVerifiedArtifact(state.call, state.artifactIdentity)
    const expectedPromotionId = await hashJson(
      promotionIdentityInput({
        call: state.call,
        callDigest: state.callDigest,
        artifactIdentity: state.artifactIdentity,
      }),
    )
    if (expectedPromotionId !== state.promotionId) {
      throw new Error('Persisted promotionId does not match the canonical call and artifact identity')
    }
    const intent = await createDeterministicIntent(state)
    let server = null
    let artifactRef = null
    if (state.stage !== 'prepared') {
      server = normalizeLocalMaterialPromotionServerResult(state.server, {
        promotionId: state.promotionId,
        sourceRevision: sourceRevisionOf(state.artifactIdentity),
      })
      artifactRef = server.artifactRef
    }
    if (state.stage === 'committed') {
      const output = normalizeLocalMaterialPromotionFinalPostImages(state.output)
      if (output.nodeId !== state.call.arguments.nodeId || !jsonDataEqual(output.artifactRef, artifactRef)) {
        throw new Error('Persisted promotion output does not match the normalized server activation')
      }
    }
    return Object.freeze({ journal, state, artifact, intent, server, artifactRef })
  }

  const invalidRecovery = callId =>
    invocationFailure(
      callId,
      'indeterminate',
      LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateReceipt,
      'The durable promotion lineage failed canonical integrity verification',
      { requiredPause: true },
    )

  const validateRecovery = async (recovery, hydrated) => {
    if (recovery?.classification !== 'committed' && recovery?.classification !== 'failed') return null
    try {
      const intent = createReceiptIntent(recovery.receiptIntent)
      const receipt = createToolReceipt(recovery.receipt)
      if (!jsonDataEqual(intent, hydrated.intent)) throw new Error('receipt intent mismatch')
      normalizeLocalMaterialPromotionPreImages(intent.preImages)
      normalizeLocalMaterialPromotionPlannedPostImages(intent.expectedPostImages)
      if (
        receipt.projectId !== hydrated.state.call.projectId ||
        receipt.branchId !== hydrated.state.call.branchId ||
        receipt.callId !== hydrated.state.call.callId
      ) {
        throw new Error('receipt authority mismatch')
      }
      if (recovery.classification === 'committed') {
        if (receipt.status !== 'applied' || hydrated.state.stage !== 'committed') {
          throw new Error('committed lineage does not match journal stage')
        }
        const output = normalizeLocalMaterialPromotionFinalPostImages(hydrated.state.output)
        if (!jsonDataEqual(output.artifactRef, hydrated.artifactRef)) throw new Error('receipt output mismatch')
        return Object.freeze({ receipt, output })
      }
      if (
        hydrated.state.stage !== 'failed' ||
        (receipt.status !== 'not-applied' && receipt.status !== 'rejected') ||
        receipt.failure?.code !== hydrated.state.failureCode
      ) {
        throw new Error('failed lineage does not match journal stage')
      }
      return Object.freeze({ receipt, output: null })
    } catch {
      return Object.freeze({ invalid: true })
    }
  }

  const initializeState = async (call, callDigest) => {
    const prepare = normalizeLocalMaterialPromotionPrepareResult(
      await core.prepareSwitch({
        schemaVersion: 1,
        projectId: call.projectId,
        branchId: call.branchId,
        callId: call.callId,
        expectedRevision: call.expectedRevision,
        nodeId: call.arguments.nodeId,
      }),
      { expectedRevision: call.expectedRevision, nodeId: call.arguments.nodeId },
    )
    const artifact = validateArtifactRecord(
      await persistence.readArtifact({
        schemaVersion: 1,
        projectId: call.projectId,
        artifactId: prepare.previousArtifactRef.artifactId,
        sourceRevision: prepare.previousArtifactRef.sourceRevision,
      }),
    )
    const artifactIdentity = artifactIdentityOf(artifact)
    if (
      artifact.projectId !== call.projectId ||
      !jsonDataEqual(sourceRevisionOf(artifactIdentity), sourceRevisionOf(prepare.previousArtifactRef))
    ) {
      throw new Error('Promotion artifact authority does not match the canonical online ref')
    }
    await verifyArtifactRecordIntegrity(artifact, { hashBytes })
    const promotionId = await hashJson(promotionIdentityInput({ call, callDigest, artifactIdentity }))
    const value = normalizeLocalMaterialPromotionJournalValue(
      preparedJournalValue({ call, callDigest, promotionId, prepare, artifactIdentity }),
      authority,
    )
    const journal = await writeJournal(call, value)
    const state = journal.value
    return Object.freeze({
      journal,
      state,
      artifact,
      intent: await createDeterministicIntent(state),
      server: null,
      artifactRef: null,
    })
  }

  const commitFailure = async ({ hydrated, session, transactionFingerprint, failureCode, message }) => {
    const { state, call } = { state: hydrated.state, call: hydrated.state.call }
    const project = normalizeLocalMaterialPromotionProjectCapture(await core.captureProject())
    const expectedDraftGeneration = requireNonNegativeInteger(
      session.draft.draftGeneration,
      'LocalMaterialPromotion.writeSession.draftGeneration',
    )
    const draftGeneration = expectedDraftGeneration + 1
    const witness = createFailureWitness({
      schemaVersion: 1,
      projectId: call.projectId,
      branchId: call.branchId,
      callId: call.callId,
      draftGeneration,
      transactionFingerprint,
      receiptStatus: 'not-applied',
      failureCode,
    })
    const receipt = createToolReceipt({
      schemaVersion: 1,
      projectId: call.projectId,
      branchId: call.branchId,
      callId: call.callId,
      status: 'not-applied',
      revision: project.revision,
      witness: createToolReceiptWitness(witness),
      failure: { code: failureCode, message, retryable: false, details: { stage: 'core' } },
    })
    const journal = terminalJournal(failedJournalValue(state, failureCode))
    const checkpoint = terminalCheckpoint({ call, promotionId: state.promotionId, status: 'not-applied', failureCode })
    const committed = await session.commitBatch({
      schemaVersion: 1,
      projectId: call.projectId,
      branchId: call.branchId,
      callId: call.callId,
      expectedDraftGeneration,
      activeDocument: project.activeDocument,
      projectSchema: project.projectSchema,
      updatedAt: requireNonNegativeInteger(now(), 'LocalMaterialPromotion.updatedAt'),
      receiptIntent: hydrated.intent,
      receipt,
      witness,
      provenance: [],
      sessionId: call.sessionId,
      journal,
      checkpoint,
      artifactRefs: durableRoots({
        call,
        artifact: hydrated.artifact,
        artifactRef: hydrated.artifactRef,
        promotionId: state.promotionId,
        journal,
        checkpoint,
        applied: false,
      }),
      artifactRefDeletes: [],
    })
    return invocationFromReceipt(createToolReceipt(committed.receipt), null)
  }

  const activateServer = async hydrated => {
    const { state, artifact } = hydrated
    if (state.stage !== 'prepared') return hydrated
    const request = {
      schemaVersion: 1,
      projectId: state.call.projectId,
      branchId: state.call.branchId,
      sessionId: state.call.sessionId,
      taskId: state.call.taskId,
      stepId: state.call.stepId,
      callId: state.call.callId,
      callDigest: state.callDigest,
      promotionId: state.promotionId,
      artifact,
    }
    let server
    try {
      const rawServer = await client.promote(request)
      server = normalizeLocalMaterialPromotionServerResult(rawServer, {
        promotionId: state.promotionId,
        sourceRevision: sourceRevisionOf(state.artifactIdentity),
      })
    } catch (promotionError) {
      try {
        const queriedServer = await client.queryPromotion({ promotionId: state.promotionId })
        server = normalizeLocalMaterialPromotionServerResult(queriedServer, {
          promotionId: state.promotionId,
          sourceRevision: sourceRevisionOf(state.artifactIdentity),
        })
      } catch (queryError) {
        throw new IndeterminateServerPromotionOutcomeError({ promotionError, queryError })
      }
    }
    const value = normalizeLocalMaterialPromotionJournalValue(
      activeJournalValue({ ...state, server: createStoredLocalMaterialPromotionServerResult(server) }),
      authority,
    )
    const journal = await writeJournal(state.call, value)
    return hydrateJournal(journal)
  }

  const applyState = async initial => {
    const hydrated = await activateServer(initial)
    const { state, artifactRef, call } = {
      state: hydrated.state,
      artifactRef: hydrated.artifactRef,
      call: hydrated.state.call,
    }
    const capture = normalizeLocalMaterialPromotionProjectCapture(await core.captureProject())
    const currentRef = captureArtifactRef(capture, call.arguments.nodeId)
    if (jsonDataEqual(currentRef, artifactRef)) {
      return invocationFailure(
        call.callId,
        'indeterminate',
        LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.appliedUndurable,
        'Core already contains the local material ref without a terminal durable receipt',
        { requiredPause: true },
      )
    }
    if (!jsonDataEqual(currentRef, state.prepare.previousArtifactRef)) {
      return invocationFailure(
        call.callId,
        'indeterminate',
        LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateCoreOutcome,
        'The promotion target no longer matches either canonical ref image',
        { requiredPause: true },
      )
    }
    if (admitMaterialRefsUnderSharedMutation !== null) {
      try {
        await admitMaterialRefsUnderSharedMutation(
          freezeDto({
            schemaVersion: 1,
            projectId: call.projectId,
            materialRefs: materialRefsOf(artifactRef),
            unresolvedPromotionIds: [state.promotionId],
            reason: 'promotion-activation',
          }),
        )
      } catch {
        return invocationFailure(
          call.callId,
          'not-applied',
          LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.materialAdmissionFailed,
          'The activated local material could not be admitted before the Core ref switch',
          { stage: 'material-admission' },
        )
      }
    }
    const transactionFingerprint = await hashJson(
      transactionFingerprintInput({ call, prepare: state.prepare, artifactRef, promotionId: state.promotionId }),
    )
    let coreApplied = false
    try {
      return await persistence.runDurableAgentWrite(async session => {
        await session.recordIntent(hydrated.intent)
        let rawPost
        try {
          rawPost = await core.switchRef({
            schemaVersion: 1,
            projectId: call.projectId,
            branchId: call.branchId,
            callId: call.callId,
            documentId: state.prepare.documentId,
            nodeId: state.prepare.nodeId,
            expectedMutationVersion: state.prepare.baseMutationVersion,
            previousArtifactRef: state.prepare.previousArtifactRef,
            artifactRef,
          })
          coreApplied = true
        } catch (error) {
          const outcome = classifyOnlineArtifactCoreFailure(error, coreFailureClassifiers)
          if (outcome !== 'not-applied') {
            coreApplied = outcome === 'applied'
            return invocationFailure(
              call.callId,
              'indeterminate',
              outcome === 'applied'
                ? LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.appliedUndurable
                : LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateCoreOutcome,
              'The trusted Core promotion operation has an indeterminate durable outcome',
              { requiredPause: true },
            )
          }
          return commitFailure({
            hydrated,
            session,
            transactionFingerprint,
            failureCode: LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.coreTransactionFailed,
            message: 'The trusted Core ref switch failed without applying',
          })
        }
        let post
        try {
          post = normalizeLocalMaterialPromotionCoreResult(rawPost, { ...state.prepare, artifactRef })
        } catch {
          return invocationFailure(
            call.callId,
            'indeterminate',
            LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.appliedUndurable,
            'Core changed, but returned a malformed promotion post-state',
            { requiredPause: true },
          )
        }
        const output = finalPostImages({ call, artifactRef })
        const expectedDraftGeneration = requireNonNegativeInteger(
          session.draft.draftGeneration,
          'LocalMaterialPromotion.writeSession.draftGeneration',
        )
        const draftGeneration = expectedDraftGeneration + 1
        const provenance = createMutationProvenanceBatch({
          projectId: call.projectId,
          branchId: call.branchId,
          draftGeneration,
          slotKeys: post.affectedSlotKeys,
          source: 'agent',
          callId: call.callId,
        })
        const witness = createApplyWitness({
          schemaVersion: 1,
          projectId: call.projectId,
          branchId: call.branchId,
          callId: call.callId,
          draftGeneration,
          coreMutationVersion: post.coreMutationVersion,
          transactionFingerprint,
          affectedSlotTokens: provenance.map(({ slotKey, token }) => ({ slotKey, token })),
        })
        const receipt = createToolReceipt({
          schemaVersion: 1,
          projectId: call.projectId,
          branchId: call.branchId,
          callId: call.callId,
          status: 'applied',
          revision: post.revision,
          witness: createToolReceiptWitness(witness),
        })
        const journal = terminalJournal(committedJournalValue(state, output))
        const checkpoint = terminalCheckpoint({ call, promotionId: state.promotionId, status: 'applied' })
        const committed = await session.commitBatch({
          schemaVersion: 1,
          projectId: call.projectId,
          branchId: call.branchId,
          callId: call.callId,
          expectedDraftGeneration,
          activeDocument: post.activeDocument,
          projectSchema: post.projectSchema,
          updatedAt: requireNonNegativeInteger(now(), 'LocalMaterialPromotion.updatedAt'),
          receiptIntent: hydrated.intent,
          receipt,
          witness,
          provenance,
          sessionId: call.sessionId,
          journal,
          checkpoint,
          artifactRefs: durableRoots({
            call,
            artifact: hydrated.artifact,
            artifactRef,
            promotionId: state.promotionId,
            journal,
            checkpoint,
            applied: true,
          }),
          artifactRefDeletes: [],
        })
        return invocationFromReceipt(createToolReceipt(committed.receipt), output)
      })
    } catch {
      return invocationFailure(
        call.callId,
        'indeterminate',
        coreApplied
          ? LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.appliedUndurable
          : LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.persistenceFailure,
        coreApplied
          ? 'Core changed, but the promotion durable batch did not commit'
          : 'The promotion durable write did not reach a terminal commit',
        { requiredPause: true },
      )
    }
  }

  const invoke = async value => {
    const call = normalizeLocalMaterialPromotionCall(value, authority)
    const callDigest = await hashJson(call)
    const recovery = await persistence.recoverDurableAgentReceipt({
      projectId: call.projectId,
      branchId: call.branchId,
      callId: call.callId,
    })
    const rawJournal = await readRawJournal(call)
    if (!rawJournal && (recovery?.classification === 'committed' || recovery?.classification === 'failed')) {
      return invalidRecovery(call.callId)
    }
    let hydrated
    if (rawJournal) {
      try {
        hydrated = await hydrateJournal(rawJournal)
      } catch {
        return invalidRecovery(call.callId)
      }
      if (hydrated.state.callDigest !== callDigest) {
        return invocationFailure(
          call.callId,
          'rejected',
          LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.idempotencyConflict,
          'The promotion callId was already bound to different semantics',
          { stage: 'idempotency' },
        )
      }
    } else {
      try {
        hydrated = await initializeState(call, callDigest)
      } catch {
        return invocationFailure(
          call.callId,
          'not-applied',
          LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.persistenceFailure,
          'The canonical online artifact could not be frozen for promotion',
          { stage: 'prepare' },
        )
      }
    }
    const recovered = await validateRecovery(recovery, hydrated)
    if (recovered?.invalid) return invalidRecovery(call.callId)
    if (recovered) return invocationFromReceipt(recovered.receipt, recovered.output)
    if (hydrated.state.stage === 'committed' || hydrated.state.stage === 'failed') {
      return invalidRecovery(call.callId)
    }
    try {
      await persistence.runDurableAgentWrite(session => session.recordIntent(hydrated.intent))
    } catch {
      return invocationFailure(
        call.callId,
        'indeterminate',
        LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.persistenceFailure,
        'The durable promotion intent could not be recorded before server activation',
        { requiredPause: true },
      )
    }
    if (admitMaterialRefsUnderSharedMutation !== null && hydrated.state.stage === 'prepared') {
      try {
        await admitMaterialRefsUnderSharedMutation(
          freezeDto({
            schemaVersion: 1,
            projectId: call.projectId,
            materialRefs: [],
            unresolvedPromotionIds: [hydrated.state.promotionId],
            reason: 'promotion-stage-retention',
          }),
        )
      } catch {
        return invocationFailure(
          call.callId,
          'not-applied',
          LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.materialAdmissionFailed,
          'The prepared promotion could not be retained before server activation',
          { stage: 'material-admission' },
        )
      }
    }
    try {
      return await applyState(hydrated)
    } catch (error) {
      if (error instanceof IndeterminateServerPromotionOutcomeError) {
        return invocationFailure(
          call.callId,
          'indeterminate',
          LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateServerOutcome,
          'The trusted server may have activated the local material, but its outcome could not be confirmed',
          { requiredPause: true },
        )
      }
      return invocationFailure(
        call.callId,
        'not-applied',
        LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.serverPromotionFailed,
        'The trusted server did not activate the requested local material',
        { stage: 'server' },
      )
    }
  }

  const queryReceipt = async request => {
    if (
      request?.projectId !== authority.projectId ||
      request?.branchId !== authority.branchId ||
      typeof request?.callId !== 'string' ||
      !request.callId
    ) {
      return null
    }
    try {
      const rawJournal = await persistence.readPromotionJournal({
        schemaVersion: 1,
        projectId: authority.projectId,
        branchId: authority.branchId,
        sessionId: authority.sessionId,
        callId: request.callId,
      })
      if (!rawJournal) return null
      const hydrated = await hydrateJournal(rawJournal)
      const recovery = await persistence.recoverDurableAgentReceipt(request)
      const validated = await validateRecovery(recovery, hydrated)
      if (validated?.receipt) return validated.receipt
      if (!validated?.invalid) return null
    } catch {
      // Invalid persisted evidence is surfaced as an indeterminate receipt below.
    }
    return createToolReceipt({
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      callId: request.callId,
      status: 'indeterminate',
      failure: {
        code: LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateReceipt,
        message: 'The durable promotion receipt failed integrity verification',
        retryable: false,
        details: { requiredPause: true },
      },
    })
  }

  const resumePending = async () => {
    const journals = await persistence.listPromotionJournals({
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      sessionId: authority.sessionId,
    })
    const results = []
    for (const rawJournal of journals) {
      try {
        const journal = normalizeLocalMaterialPromotionJournalRecord(rawJournal, authority)
        if (journal.value.stage === 'committed' || journal.value.stage === 'failed') continue
        results.push(await invoke(journal.value.call))
      } catch {
        const callId = typeof rawJournal?.callId === 'string' && rawJournal.callId ? rawJournal.callId : 'unknown'
        results.push(invalidRecovery(callId))
      }
    }
    return freezeDto({ schemaVersion: 1, results })
  }

  return Object.freeze({ promoteLocal: invoke, queryReceipt, resumePending })
}

export const createDashboardLocalMaterialPromotionCapabilityService = options => {
  if (!options || typeof options !== 'object') {
    throw new TypeError('local material promotion capability options are required')
  }
  return createService(options)
}
