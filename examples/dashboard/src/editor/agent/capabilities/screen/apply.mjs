import { createDashboardTelemetryChannel } from '../../../../runtime/telemetry-channel.mjs'
import { validateArtifactRef } from '../../online-components/artifact-contracts.mjs'
import { createMutationProvenanceBatch } from '../../persistence/provenance.mjs'
import {
  createApplyWitness,
  createFailureWitness,
  createReceiptIntent,
  createToolReceipt,
  createToolReceiptWitness,
} from '../../persistence/receipt-ledger.mjs'
import {
  DEFAULT_SCREEN_CHANGESET_LIMITS,
  ScreenChangeSetCompileError,
  assertExactRecord,
  cloneJsonValue,
  freezeDto,
  isPlainRecord,
  jsonEqual,
  ownDataValue,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireSchemaVersion,
} from './contract.mjs'
import {
  createScreenPreparedHashInput,
  createScreenTransactionFingerprintInput,
  verifyScreenReceiptIntentRecovery,
} from './receipt-intent.mjs'

const CAPABILITY = 'screen.applyChangeSet'
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
const cloneScreenJson = (value, path) => cloneJsonValue(value, path, DEFAULT_SCREEN_CHANGESET_LIMITS)

export const SCREEN_APPLY_CHANGESET_FAILURE_CODE = Object.freeze({
  appliedUndurable: 'APPLIED_UNDURABLE',
  coreTransactionFailed: 'CORE_TRANSACTION_FAILED',
  humanActivity: 'HUMAN_ACTIVITY',
  indeterminateCoreOutcome: 'INDETERMINATE_CORE_OUTCOME',
  indeterminateReceipt: 'INDETERMINATE_RECEIPT',
  invalidMaterialRef: 'INVALID_MATERIAL_REF',
  materialAdmissionFailed: 'MATERIAL_ADMISSION_FAILED',
  noChange: 'NO_CHANGE',
  persistenceFailure: 'PERSISTENCE_FAILURE',
  rollbackIncomplete: 'TRANSACTION_ROLLBACK_INCOMPLETE',
  staleRevision: 'STALE_REVISION',
})

export class ScreenApplyChangeSetError extends TypeError {
  constructor(code, reason, details = {}) {
    super(`screen.applyChangeSet rejected: ${reason}`)
    this.name = 'ScreenApplyChangeSetError'
    this.code = code
    this.reason = reason
    this.details = freezeDto(cloneScreenJson(details, 'ScreenApplyChangeSetError.details'))
  }

  toJSON() {
    return { schemaVersion: 1, code: this.code, reason: this.reason, details: this.details }
  }
}

const failApply = (code, reason, details) => {
  throw new ScreenApplyChangeSetError(code, reason, details)
}

const requireMethod = (value, key, label) => {
  const method = value?.[key]
  if (typeof method !== 'function') throw new TypeError(`${label}.${key} is required`)
  return method.bind(value)
}

const normalizeAuthority = value => {
  try {
    assertExactRecord(value, AUTHORITY_FIELDS, [], 'screenApply.authority', 'INVALID_CALL')
    return freezeDto(
      Object.fromEntries(
        AUTHORITY_FIELDS.map(field => [
          field,
          requireNonEmptyString(
            ownDataValue(value, field, 'screenApply.authority', 'INVALID_CALL'),
            `authority.${field}`,
            {
              code: 'INVALID_CALL',
            },
          ),
        ]),
      ),
    )
  } catch (error) {
    if (error instanceof ScreenChangeSetCompileError) {
      return failApply('INVALID_CALL', error.reason, { path: error.path })
    }
    throw error
  }
}

const normalizeCall = (value, authority) => {
  try {
    assertExactRecord(value, CALL_FIELDS, [], 'screenApply.call', 'INVALID_CALL')
    requireSchemaVersion(
      ownDataValue(value, 'schemaVersion', 'screenApply.call', 'INVALID_CALL'),
      'screenApply.call.schemaVersion',
    )
    const normalized = {
      schemaVersion: 1,
      projectId: requireNonEmptyString(
        ownDataValue(value, 'projectId', 'screenApply.call', 'INVALID_CALL'),
        'screenApply.call.projectId',
        { code: 'INVALID_CALL' },
      ),
      branchId: requireNonEmptyString(
        ownDataValue(value, 'branchId', 'screenApply.call', 'INVALID_CALL'),
        'screenApply.call.branchId',
        { code: 'INVALID_CALL' },
      ),
      sessionId: requireNonEmptyString(
        ownDataValue(value, 'sessionId', 'screenApply.call', 'INVALID_CALL'),
        'screenApply.call.sessionId',
        { code: 'INVALID_CALL' },
      ),
      taskId: requireNonEmptyString(
        ownDataValue(value, 'taskId', 'screenApply.call', 'INVALID_CALL'),
        'screenApply.call.taskId',
        { code: 'INVALID_CALL' },
      ),
      stepId: requireNonEmptyString(
        ownDataValue(value, 'stepId', 'screenApply.call', 'INVALID_CALL'),
        'screenApply.call.stepId',
        { code: 'INVALID_CALL' },
      ),
      callId: requireNonEmptyString(
        ownDataValue(value, 'callId', 'screenApply.call', 'INVALID_CALL'),
        'screenApply.call.callId',
        { code: 'INVALID_CALL' },
      ),
      capability: requireNonEmptyString(
        ownDataValue(value, 'capability', 'screenApply.call', 'INVALID_CALL'),
        'screenApply.call.capability',
        { code: 'INVALID_CALL' },
      ),
      expectedRevision: requireNonEmptyString(
        ownDataValue(value, 'expectedRevision', 'screenApply.call', 'INVALID_CALL'),
        'screenApply.call.expectedRevision',
        { code: 'INVALID_CALL' },
      ),
      arguments: cloneScreenJson(
        ownDataValue(value, 'arguments', 'screenApply.call', 'INVALID_CALL'),
        'screenApply.call.arguments',
      ),
    }
    if (normalized.capability !== CAPABILITY) {
      return failApply('INVALID_CALL', 'capability-must-be-screen-apply-change-set')
    }
    for (const field of AUTHORITY_FIELDS) {
      if (normalized[field] !== authority[field]) {
        return failApply('AUTHORITY_MISMATCH', `${field}-does-not-match-bound-authority`, { field })
      }
    }
    return freezeDto(normalized)
  } catch (error) {
    if (error instanceof ScreenApplyChangeSetError) throw error
    if (error instanceof ScreenChangeSetCompileError) {
      return failApply('INVALID_CALL', error.reason, { path: error.path })
    }
    throw error
  }
}

const normalizeSnapshot = value => {
  if (typeof value !== 'object' || value === null) return failApply('INVALID_SNAPSHOT', 'full-snapshot-is-unavailable')
  const descriptor = Reflect.getOwnPropertyDescriptor(value, 'revision')
  if (!descriptor || !('value' in descriptor))
    return failApply('INVALID_SNAPSHOT', 'full-snapshot-revision-is-unavailable')
  return { value, revision: requireNonEmptyString(descriptor.value, 'screenApply.snapshot.revision') }
}

const normalizePrepareContext = value => {
  try {
    assertExactRecord(
      value,
      ['documentHandle', 'document', 'materialRegistryVersion', 'manifests', 'fence'],
      [],
      'screenApply.prepareContext',
      'INVALID_PREPARE_CONTEXT',
    )
    const documentHandle = ownDataValue(
      value,
      'documentHandle',
      'screenApply.prepareContext',
      'INVALID_PREPARE_CONTEXT',
    )
    if (documentHandle === null || documentHandle === undefined) {
      return failApply('INVALID_PREPARE_CONTEXT', 'document-handle-is-required')
    }
    const document = ownDataValue(value, 'document', 'screenApply.prepareContext', 'INVALID_PREPARE_CONTEXT')
    assertExactRecord(
      document,
      ['id', 'mutationVersion', 'schema'],
      [],
      'screenApply.prepareContext.document',
      'INVALID_PREPARE_CONTEXT',
    )
    const normalizedDocument = freezeDto({
      id: requireNonEmptyString(
        ownDataValue(document, 'id', 'screenApply.prepareContext.document', 'INVALID_PREPARE_CONTEXT'),
        'screenApply.prepareContext.document.id',
      ),
      mutationVersion: requireNonNegativeInteger(
        ownDataValue(document, 'mutationVersion', 'screenApply.prepareContext.document', 'INVALID_PREPARE_CONTEXT'),
        'screenApply.prepareContext.document.mutationVersion',
      ),
      schema: cloneScreenJson(
        ownDataValue(document, 'schema', 'screenApply.prepareContext.document', 'INVALID_PREPARE_CONTEXT'),
        'screenApply.prepareContext.document.schema',
      ),
    })
    const manifests = ownDataValue(value, 'manifests', 'screenApply.prepareContext', 'INVALID_PREPARE_CONTEXT')
    if (!Array.isArray(manifests)) return failApply('INVALID_PREPARE_CONTEXT', 'manifests-must-be-an-array')
    const materialRegistryVersion = ownDataValue(
      value,
      'materialRegistryVersion',
      'screenApply.prepareContext',
      'INVALID_PREPARE_CONTEXT',
    )
    if (
      !(
        (typeof materialRegistryVersion === 'string' && materialRegistryVersion.length > 0) ||
        (Number.isSafeInteger(materialRegistryVersion) && materialRegistryVersion >= 0)
      )
    ) {
      return failApply('INVALID_PREPARE_CONTEXT', 'material-registry-version-is-invalid')
    }
    return {
      documentHandle,
      document: normalizedDocument,
      materialRegistryVersion,
      manifests,
      fence: freezeDto(
        cloneScreenJson(
          ownDataValue(value, 'fence', 'screenApply.prepareContext', 'INVALID_PREPARE_CONTEXT'),
          'screenApply.prepareContext.fence',
        ),
      ),
    }
  } catch (error) {
    if (error instanceof ScreenApplyChangeSetError) throw error
    if (error instanceof ScreenChangeSetCompileError) {
      return failApply('INVALID_PREPARE_CONTEXT', error.reason, { path: error.path })
    }
    throw error
  }
}

const normalizeDocumentState = (value, expectedDocumentId) => {
  try {
    assertExactRecord(
      value,
      ['id', 'mutationVersion', 'schema'],
      [],
      'screenApply.documentState',
      'INVALID_DOCUMENT_STATE',
    )
    const id = requireNonEmptyString(
      ownDataValue(value, 'id', 'screenApply.documentState', 'INVALID_DOCUMENT_STATE'),
      'screenApply.documentState.id',
    )
    if (id !== expectedDocumentId) return failApply('INVALID_DOCUMENT_STATE', 'bound-document-identity-changed')
    return freezeDto({
      id,
      mutationVersion: requireNonNegativeInteger(
        ownDataValue(value, 'mutationVersion', 'screenApply.documentState', 'INVALID_DOCUMENT_STATE'),
        'screenApply.documentState.mutationVersion',
      ),
      schema: cloneScreenJson(
        ownDataValue(value, 'schema', 'screenApply.documentState', 'INVALID_DOCUMENT_STATE'),
        'screenApply.documentState.schema',
      ),
    })
  } catch (error) {
    if (error instanceof ScreenApplyChangeSetError) throw error
    if (error instanceof ScreenChangeSetCompileError) {
      return failApply('INVALID_DOCUMENT_STATE', error.reason, { path: error.path })
    }
    throw error
  }
}

const normalizeProject = value => {
  try {
    assertExactRecord(value, ['activeDocument', 'projectSchema'], [], 'screenApply.project', 'INVALID_PROJECT_STATE')
    const activeDocument = ownDataValue(value, 'activeDocument', 'screenApply.project', 'INVALID_PROJECT_STATE')
    if (activeDocument !== null) {
      assertExactRecord(
        activeDocument,
        ['documentId', 'fileName', 'index'],
        [],
        'screenApply.project.activeDocument',
        'INVALID_PROJECT_STATE',
      )
    }
    return freezeDto({
      activeDocument:
        activeDocument === null
          ? null
          : {
              documentId: requireNonEmptyString(
                ownDataValue(activeDocument, 'documentId', 'screenApply.project.activeDocument'),
                'screenApply.project.activeDocument.documentId',
              ),
              fileName: requireNonEmptyString(
                ownDataValue(activeDocument, 'fileName', 'screenApply.project.activeDocument'),
                'screenApply.project.activeDocument.fileName',
              ),
              index: requireNonNegativeInteger(
                ownDataValue(activeDocument, 'index', 'screenApply.project.activeDocument'),
                'screenApply.project.activeDocument.index',
              ),
            },
      projectSchema: cloneScreenJson(
        ownDataValue(value, 'projectSchema', 'screenApply.project', 'INVALID_PROJECT_STATE'),
        'screenApply.project.projectSchema',
      ),
    })
  } catch (error) {
    if (error instanceof ScreenApplyChangeSetError) throw error
    if (error instanceof ScreenChangeSetCompileError) {
      return failApply('INVALID_PROJECT_STATE', error.reason, { path: error.path })
    }
    throw error
  }
}

const failure = (code, message, details) =>
  freezeDto({ code, message, retryable: false, ...(details === undefined ? {} : { details }) })

const invocationFailure = (callId, status, code, message, details, revision) =>
  freezeDto({
    schemaVersion: 1,
    callId,
    status,
    ...(revision === undefined ? {} : { revision }),
    failure: failure(code, message, details),
  })

const invocationFromReceipt = receipt =>
  freezeDto({
    schemaVersion: 1,
    callId: receipt.callId,
    status: receipt.status,
    ...(receipt.revision === undefined ? {} : { revision: receipt.revision }),
    ...(receipt.status === 'applied' ? {} : { failure: receipt.failure }),
  })

const recoverInvocation = async (recovery, callId, hashCanonicalJson) => {
  if (recovery?.classification === 'missing') return null
  if (
    recovery?.classification === 'indeterminate' &&
    typeof recovery.reason === 'string' &&
    recovery.reason.length > 0
  ) {
    return invocationFailure(
      callId,
      'indeterminate',
      SCREEN_APPLY_CHANGESET_FAILURE_CODE.indeterminateReceipt,
      'The durable receipt lineage is incomplete or ambiguous',
      { reason: recovery.reason },
    )
  }
  if (recovery?.classification === 'committed' || recovery?.classification === 'failed') {
    const integrity = await verifyScreenReceiptIntentRecovery({
      receiptIntent: recovery.receiptIntent,
      receipt: recovery.receipt,
      hashCanonicalJson,
    })
    if (integrity.classification === 'indeterminate') {
      return invocationFailure(
        callId,
        'indeterminate',
        SCREEN_APPLY_CHANGESET_FAILURE_CODE.indeterminateReceipt,
        'The durable Screen receipt lineage failed integrity verification',
        { reason: integrity.reason },
      )
    }
    return invocationFromReceipt(createToolReceipt(recovery.receipt))
  }
  return failApply('INVALID_RECOVERY', 'receipt-recovery-result-is-invalid')
}

const createPreparedPayloads = compiled => ({
  preImages: freezeDto({
    schemaVersion: 1,
    kind: 'screen-change-set-pre-images',
    documentId: compiled.documentId,
    baseMutationVersion: compiled.baseMutationVersion,
    materialRegistryVersion: compiled.materialRegistryVersion,
    manifestFingerprints: compiled.manifestFingerprints,
    insertedNodeIdentities: compiled.insertedNodeIdentities,
    operations: compiled.operations,
    commands: compiled.commands,
    images: compiled.preImages,
    inverseOperations: compiled.inverseOperations,
    affectedFieldSlots: compiled.affectedFieldSlots,
    affectedStructuralSlots: compiled.affectedStructuralSlots,
    affectedSlotKeys: compiled.affectedSlotKeys,
  }),
  expectedPostImages: freezeDto({
    schemaVersion: 1,
    kind: 'screen-change-set-post-images',
    documentId: compiled.documentId,
    images: compiled.expectedPostImages,
    affectedFieldSlots: compiled.affectedFieldSlots,
    affectedStructuralSlots: compiled.affectedStructuralSlots,
    affectedSlotKeys: compiled.affectedSlotKeys,
  }),
})

const materialIdentityKey = value =>
  [value.materialId, value.materialVersion, value.buildIntegrity].map(encodeURIComponent).join('@')

const compareMaterialIdentity = (left, right) => {
  const leftKey = materialIdentityKey(left)
  const rightKey = materialIdentityKey(right)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

const collectExpectedLocalMaterialRefs = expectedPostImages => {
  const refs = new Map()
  const visitNode = node => {
    if (!isPlainRecord(node)) return
    if (Object.hasOwn(node, '$agent')) {
      const binding = node.$agent
      if (
        !isPlainRecord(binding) ||
        binding.schemaVersion !== 1 ||
        Object.keys(binding).length !== 2 ||
        !Object.hasOwn(binding, 'artifactRef')
      ) {
        throw new TypeError('compiled node has a malformed canonical ArtifactRef binding')
      }
      const artifactRef = validateArtifactRef(binding.artifactRef)
      if (artifactRef.target.kind === 'local-material') {
        const materialRef = freezeDto({
          materialId: artifactRef.target.materialId,
          materialVersion: artifactRef.target.materialVersion,
          buildIntegrity: artifactRef.target.buildIntegrity,
        })
        refs.set(materialIdentityKey(materialRef), materialRef)
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(visitNode)
  }
  for (const image of expectedPostImages) {
    if (image?.kind === 'node' && image.existed === true) visitNode(image.node)
  }
  return freezeDto([...refs.values()].sort(compareMaterialIdentity))
}

const terminalJournal = ({ call, compiled, preparedHash, transactionFingerprint, status, failureCode }) => ({
  recordId: `call:${call.callId}`,
  kind: 'screen-change-set',
  value: {
    schemaVersion: 1,
    capability: CAPABILITY,
    taskId: call.taskId,
    stepId: call.stepId,
    documentId: compiled.documentId,
    status,
    preparedHash,
    transactionFingerprint,
    ...(failureCode === undefined ? {} : { failureCode }),
  },
})

const terminalCheckpoint = ({ call, status, failureCode }) => ({
  checkpointId: `call:${call.callId}`,
  value: {
    schemaVersion: 1,
    taskId: call.taskId,
    stepId: call.stepId,
    status,
    ...(failureCode === undefined ? {} : { failureCode }),
  },
})

export const createScreenApplyChangeSetHandler = dependencies => {
  if (!dependencies || typeof dependencies !== 'object') throw new TypeError('screen apply dependencies are required')
  const authority = normalizeAuthority(dependencies.authority)
  const activityLease = dependencies.activityLease
  const waitUntilIdle = requireMethod(activityLease, 'waitUntilIdle', 'activityLease')
  const isActive = requireMethod(activityLease, 'isActive', 'activityLease')
  const persistence = dependencies.persistence
  const recoverDurableAgentReceipt = requireMethod(persistence, 'recoverDurableAgentReceipt', 'persistence')
  const runDurableAgentWrite = requireMethod(persistence, 'runDurableAgentWrite', 'persistence')
  const captureFullSnapshot = requireMethod(dependencies, 'captureFullSnapshot', 'dependencies')
  const capturePrepareContext = requireMethod(dependencies, 'capturePrepareContext', 'dependencies')
  const captureCurrentFence = requireMethod(dependencies, 'captureCurrentFence', 'dependencies')
  const captureDocumentState = requireMethod(dependencies, 'captureDocumentState', 'dependencies')
  const captureProject = requireMethod(dependencies, 'captureProject', 'dependencies')
  const compileChangeSet = requireMethod(dependencies, 'compileChangeSet', 'dependencies')
  const admitMaterialRefsUnderSharedMutation =
    dependencies.admitMaterialRefsUnderSharedMutation === undefined
      ? null
      : requireMethod(dependencies, 'admitMaterialRefsUnderSharedMutation', 'dependencies')
  const hashCanonicalJson = requireMethod(dependencies, 'hashCanonicalJson', 'dependencies')
  const runOnDocument = requireMethod(dependencies, 'runOnDocument', 'dependencies')
  const isTransactionCommittedError = requireMethod(dependencies, 'isTransactionCommittedError', 'dependencies')
  const isTransactionRollbackIncompleteError = requireMethod(
    dependencies,
    'isTransactionRollbackIncompleteError',
    'dependencies',
  )
  const now = requireMethod(dependencies, 'now', 'dependencies')
  const telemetryNow = typeof dependencies.telemetryNow === 'function' ? dependencies.telemetryNow : Date.now
  const telemetry = createDashboardTelemetryChannel(dependencies.telemetry, telemetryNow)
  const createTelemetryChangeSetId = telemetry.enabled
    ? requireMethod(dependencies, 'createTelemetryChangeSetId', 'dependencies')
    : null
  const emitTelemetry = (event, startedAt) => {
    if (event.changeSetId === null) return
    telemetry.emit(event, startedAt)
  }

  return async value => {
    const call = normalizeCall(value, authority)
    let changeSetId = null
    if (createTelemetryChangeSetId) {
      try {
        changeSetId = createTelemetryChangeSetId(call.callId)
      } catch {
        // A telemetry correlation helper cannot gate the Screen capability.
      }
    }
    const prepareStartedAt = telemetry.start()
    const recoveryAuthority = { projectId: call.projectId, branchId: call.branchId, callId: call.callId }
    const recovered = await recoverInvocation(
      await recoverDurableAgentReceipt(recoveryAuthority),
      call.callId,
      hashCanonicalJson,
    )
    if (recovered) return recovered

    const idle = await waitUntilIdle()
    const idleGeneration = requireNonNegativeInteger(idle?.generation, 'screenApply.idle.generation')
    const initialSnapshot = normalizeSnapshot(await captureFullSnapshot())
    if (initialSnapshot.revision !== call.expectedRevision) {
      emitTelemetry({
        eventType: 'dashboard.screen.stale',
        sessionId: call.sessionId,
        taskId: call.taskId,
        stepId: call.stepId,
        callId: call.callId,
        changeSetId,
        expectedProjectRevision: call.expectedRevision,
        currentProjectRevision: initialSnapshot.revision,
        diagnosticCode: 'initial-revision-mismatch',
      })
      return invocationFailure(
        call.callId,
        'not-applied',
        SCREEN_APPLY_CHANGESET_FAILURE_CODE.staleRevision,
        'The expected revision is no longer current',
        { stage: 'prepare' },
        initialSnapshot.revision,
      )
    }

    const prepared = normalizePrepareContext(
      await capturePrepareContext({ call, changeSet: call.arguments, snapshot: initialSnapshot.value }),
    )
    let compiled
    try {
      compiled = compileChangeSet({
        schemaVersion: 1,
        projectId: call.projectId,
        branchId: call.branchId,
        callId: call.callId,
        materialRegistryVersion: prepared.materialRegistryVersion,
        expectedMutationVersion: prepared.document.mutationVersion,
        document: prepared.document,
        manifests: prepared.manifests,
        changeSet: call.arguments,
      })
    } catch (error) {
      if (!(error instanceof ScreenChangeSetCompileError)) throw error
      return invocationFailure(
        call.callId,
        'rejected',
        error.code,
        'The semantic ChangeSet was rejected during pure compilation',
        { path: error.path, reason: error.reason },
        initialSnapshot.revision,
      )
    }

    if (admitMaterialRefsUnderSharedMutation !== null) {
      let materialRefs
      try {
        materialRefs = collectExpectedLocalMaterialRefs(compiled.expectedPostImages)
      } catch {
        return invocationFailure(
          call.callId,
          'rejected',
          SCREEN_APPLY_CHANGESET_FAILURE_CODE.invalidMaterialRef,
          'The compiled Screen post-images contain an invalid canonical ArtifactRef',
          { stage: 'material-ref-validation' },
          initialSnapshot.revision,
        )
      }
      if (materialRefs.length > 0) {
        try {
          await admitMaterialRefsUnderSharedMutation(
            freezeDto({
              schemaVersion: 1,
              projectId: call.projectId,
              materialRefs,
              reason: 'screen-apply',
            }),
          )
        } catch {
          return invocationFailure(
            call.callId,
            'not-applied',
            SCREEN_APPLY_CHANGESET_FAILURE_CODE.materialAdmissionFailed,
            'The Screen local materials could not be admitted before mutation',
            { stage: 'material-admission' },
            initialSnapshot.revision,
          )
        }
      }
    }

    const payloads = createPreparedPayloads(compiled)
    const transactionFingerprint = await hashCanonicalJson(
      createScreenTransactionFingerprintInput({
        callId: call.callId,
        documentId: compiled.documentId,
        baseMutationVersion: compiled.baseMutationVersion,
        materialRegistryVersion: compiled.materialRegistryVersion,
        manifestFingerprints: compiled.manifestFingerprints,
        insertedNodeIdentities: compiled.insertedNodeIdentities,
        commands: compiled.commands,
      }),
    )
    const preparedHash = await hashCanonicalJson(
      createScreenPreparedHashInput({
        projectId: call.projectId,
        branchId: call.branchId,
        callId: call.callId,
        baseRevision: initialSnapshot.revision,
        preImages: payloads.preImages,
        expectedPostImages: payloads.expectedPostImages,
      }),
    )
    const intent = createReceiptIntent({
      schemaVersion: 1,
      projectId: call.projectId,
      branchId: call.branchId,
      callId: call.callId,
      preparedHash,
      baseRevision: initialSnapshot.revision,
      preImages: payloads.preImages,
      expectedPostImages: payloads.expectedPostImages,
      status: 'pending',
    })
    emitTelemetry(
      {
        eventType: 'dashboard.screen.prepare',
        sessionId: call.sessionId,
        taskId: call.taskId,
        stepId: call.stepId,
        callId: call.callId,
        changeSetId,
        projectRevision: initialSnapshot.revision,
        status: 'completed',
      },
      prepareStartedAt,
    )

    if (activityLease.generation !== idleGeneration || isActive()) {
      return invocationFailure(
        call.callId,
        'not-applied',
        SCREEN_APPLY_CHANGESET_FAILURE_CODE.humanActivity,
        'Human activity changed during preparation',
        { stage: 'before-intent' },
        initialSnapshot.revision,
      )
    }

    let coreOutcome = 'not-started'
    try {
      return await runDurableAgentWrite(async session => {
        const expectedDraftGeneration = requireNonNegativeInteger(
          session?.draft?.draftGeneration,
          'screenApply.writeSession.draft.draftGeneration',
        )
        await session.recordIntent(intent)

        const commitTerminalFailure = async (failureCode, message, details) => {
          const postSnapshot = normalizeSnapshot(await captureFullSnapshot())
          if (failureCode === SCREEN_APPLY_CHANGESET_FAILURE_CODE.staleRevision) {
            emitTelemetry({
              eventType: 'dashboard.screen.stale',
              sessionId: call.sessionId,
              taskId: call.taskId,
              stepId: call.stepId,
              callId: call.callId,
              changeSetId,
              expectedProjectRevision: call.expectedRevision,
              currentProjectRevision: postSnapshot.revision,
              diagnosticCode: 'prepared-fence-mismatch',
            })
          }
          const project = normalizeProject(await captureProject())
          const draftGeneration = expectedDraftGeneration + 1
          const witness = createFailureWitness({
            schemaVersion: 1,
            ...recoveryAuthority,
            draftGeneration,
            transactionFingerprint,
            receiptStatus: 'not-applied',
            failureCode,
          })
          const receipt = createToolReceipt({
            schemaVersion: 1,
            ...recoveryAuthority,
            status: 'not-applied',
            revision: postSnapshot.revision,
            witness: createToolReceiptWitness(witness),
            failure: failure(failureCode, message, details),
          })
          const batch = {
            schemaVersion: 1,
            ...recoveryAuthority,
            expectedDraftGeneration,
            activeDocument: project.activeDocument,
            projectSchema: project.projectSchema,
            updatedAt: requireNonNegativeInteger(now(), 'screenApply.updatedAt'),
            receiptIntent: intent,
            receipt,
            witness,
            provenance: [],
            sessionId: call.sessionId,
            journal: terminalJournal({
              call,
              compiled,
              preparedHash,
              transactionFingerprint,
              status: 'not-applied',
              failureCode,
            }),
            checkpoint: terminalCheckpoint({ call, status: 'not-applied', failureCode }),
          }
          const committed = await session.commitBatch(batch)
          return invocationFromReceipt(createToolReceipt(committed.receipt))
        }

        if (activityLease.generation !== idleGeneration || isActive()) {
          return commitTerminalFailure(
            SCREEN_APPLY_CHANGESET_FAILURE_CODE.humanActivity,
            'Human activity took priority before Core execution',
            { stage: 'after-intent' },
          )
        }

        const currentFence = cloneScreenJson(await captureCurrentFence({ call, prepared }), 'screenApply.currentFence')
        if (!jsonEqual(prepared.fence, currentFence)) {
          return commitTerminalFailure(
            SCREEN_APPLY_CHANGESET_FAILURE_CODE.staleRevision,
            'The prepared document or material fence changed before Core execution',
            { stage: 'after-intent' },
          )
        }

        if (activityLease.generation !== idleGeneration || isActive()) {
          return commitTerminalFailure(
            SCREEN_APPLY_CHANGESET_FAILURE_CODE.humanActivity,
            'Human activity took priority immediately before Core execution',
            { stage: 'after-fence' },
          )
        }

        let transactionError = null
        let transactionReturned = false
        const commitStartedAt = telemetry.start()
        try {
          await runOnDocument(prepared.documentHandle, compiled.commands, {
            agentCallId: call.callId,
            expectedMutationVersion: compiled.baseMutationVersion,
          })
          transactionReturned = true
        } catch (error) {
          transactionError = error
        }

        const committedError = transactionError !== null && isTransactionCommittedError(transactionError)
        const rollbackIncomplete = transactionError !== null && isTransactionRollbackIncompleteError(transactionError)
        if (transactionReturned || committedError) coreOutcome = 'applied'
        emitTelemetry(
          {
            eventType: 'dashboard.screen.commit',
            sessionId: call.sessionId,
            taskId: call.taskId,
            stepId: call.stepId,
            callId: call.callId,
            changeSetId,
            projectRevision: initialSnapshot.revision,
            status: transactionReturned || committedError ? 'completed' : 'failed',
            ...(transactionReturned || committedError ? {} : { errorCode: 'core-transaction-failed' }),
          },
          commitStartedAt,
        )

        if (rollbackIncomplete) {
          try {
            await captureFullSnapshot()
          } catch {}
          return invocationFailure(
            call.callId,
            'indeterminate',
            SCREEN_APPLY_CHANGESET_FAILURE_CODE.rollbackIncomplete,
            'The Core transaction rollback was incomplete',
            { requiredPause: true },
          )
        }

        let postDocument
        const verifyStartedAt = telemetry.start()
        try {
          postDocument = normalizeDocumentState(
            await captureDocumentState(prepared.documentHandle),
            compiled.documentId,
          )
        } catch {
          try {
            await captureFullSnapshot()
          } catch {}
          return invocationFailure(
            call.callId,
            'indeterminate',
            coreOutcome === 'applied'
              ? SCREEN_APPLY_CHANGESET_FAILURE_CODE.appliedUndurable
              : SCREEN_APPLY_CHANGESET_FAILURE_CODE.indeterminateCoreOutcome,
            coreOutcome === 'applied'
              ? 'Core committed, but its canonical post-state could not be captured durably'
              : 'The Core outcome could not be classified from a canonical post-state',
            { requiredPause: true },
          )
        }
        const schemaChanged = !jsonEqual(prepared.document.schema, postDocument.schema)

        if (transactionError !== null && !committedError && schemaChanged) {
          try {
            await captureFullSnapshot()
          } catch {}
          return invocationFailure(
            call.callId,
            'indeterminate',
            SCREEN_APPLY_CHANGESET_FAILURE_CODE.indeterminateCoreOutcome,
            'The Core transaction reported rollback but the canonical schema changed',
            { requiredPause: true },
          )
        }

        if (transactionError !== null && !committedError) {
          coreOutcome = 'not-applied'
          return commitTerminalFailure(
            SCREEN_APPLY_CHANGESET_FAILURE_CODE.coreTransactionFailed,
            'The Core transaction failed and rolled back completely',
            { stage: 'core' },
          )
        }

        if (!schemaChanged) {
          coreOutcome = 'not-applied'
          return commitTerminalFailure(
            SCREEN_APPLY_CHANGESET_FAILURE_CODE.noChange,
            'The semantic ChangeSet produced no canonical schema change',
            { stage: 'core' },
          )
        }

        emitTelemetry(
          {
            eventType: 'dashboard.screen.verify',
            sessionId: call.sessionId,
            taskId: call.taskId,
            stepId: call.stepId,
            callId: call.callId,
            changeSetId,
            projectRevision: initialSnapshot.revision,
            status: 'completed',
          },
          verifyStartedAt,
        )

        coreOutcome = 'applied'
        const postSnapshot = normalizeSnapshot(await captureFullSnapshot())
        const project = normalizeProject(await captureProject())
        const draftGeneration = expectedDraftGeneration + 1
        const provenance = createMutationProvenanceBatch({
          projectId: call.projectId,
          branchId: call.branchId,
          draftGeneration,
          slotKeys: compiled.affectedSlotKeys,
          source: 'agent',
          callId: call.callId,
        })
        const witness = createApplyWitness({
          schemaVersion: 1,
          ...recoveryAuthority,
          draftGeneration,
          coreMutationVersion: postDocument.mutationVersion,
          transactionFingerprint,
          affectedSlotTokens: provenance.map(({ slotKey, token }) => ({ slotKey, token })),
        })
        const receipt = createToolReceipt({
          schemaVersion: 1,
          ...recoveryAuthority,
          status: 'applied',
          revision: postSnapshot.revision,
          witness: createToolReceiptWitness(witness),
        })
        const batch = {
          schemaVersion: 1,
          ...recoveryAuthority,
          expectedDraftGeneration,
          activeDocument: project.activeDocument,
          projectSchema: project.projectSchema,
          updatedAt: requireNonNegativeInteger(now(), 'screenApply.updatedAt'),
          receiptIntent: intent,
          receipt,
          witness,
          provenance,
          sessionId: call.sessionId,
          journal: terminalJournal({
            call,
            compiled,
            preparedHash,
            transactionFingerprint,
            status: 'applied',
          }),
          checkpoint: terminalCheckpoint({ call, status: 'applied' }),
        }
        const committed = await session.commitBatch(batch)
        return invocationFromReceipt(createToolReceipt(committed.receipt))
      })
    } catch {
      return invocationFailure(
        call.callId,
        'indeterminate',
        coreOutcome === 'applied'
          ? SCREEN_APPLY_CHANGESET_FAILURE_CODE.appliedUndurable
          : SCREEN_APPLY_CHANGESET_FAILURE_CODE.persistenceFailure,
        coreOutcome === 'applied'
          ? 'Core changed, but the durable Agent batch did not commit'
          : 'The durable Agent write did not reach a terminal commit',
        { requiredPause: true },
      )
    }
  }
}
