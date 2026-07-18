import { canonicalJsonStringify, hashCanonicalJson } from '../../../../lib/storage/index.mjs'
import {
  validateArtifactRecord,
  validateArtifactRef,
  validateLockedArtifactDependency,
  verifyArtifactRecordIntegrity,
} from '../../online-components/artifact-contracts.mjs'
import { scanArtifactSource } from '../../online-components/artifact-source.mjs'
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
} from '../../persistence/contract.mjs'
import { createMutationProvenanceBatch } from '../../persistence/provenance.mjs'
import {
  createApplyWitness,
  createFailureWitness,
  createReceiptIntent,
  createToolReceipt,
  createToolReceiptWitness,
} from '../../persistence/receipt-ledger.mjs'
import {
  GENERATED_MATERIAL_HOST_COMPONENT_NAME,
  normalizeOnlineArtifactCall,
  normalizeOnlineArtifactCoreResult,
  normalizeOnlineArtifactPrepareResult,
  normalizeOnlineArtifactProjectCapture,
} from './contract.mjs'

export const ONLINE_ARTIFACT_FAILURE_CODE = Object.freeze({
  appliedUndurable: 'APPLIED_UNDURABLE',
  coreTransactionFailed: 'CORE_TRANSACTION_FAILED',
  indeterminateCoreOutcome: 'INDETERMINATE_CORE_OUTCOME',
  indeterminateReceipt: 'INDETERMINATE_RECEIPT',
  persistenceFailure: 'PERSISTENCE_FAILURE',
})

export class OnlineArtifactCoreOutcomeError extends Error {
  constructor(outcome, message, options = {}) {
    super(message, options)
    this.name = 'OnlineArtifactCoreOutcomeError'
    this.outcome = requireLiteral(
      outcome,
      ['applied', 'indeterminate', 'not-applied'],
      'OnlineArtifactCoreOutcomeError.outcome',
    )
  }
}

const defaultIsTransactionCommittedError = error =>
  error?.name === 'TransactionCommittedError' && error?.committed === true

const defaultIsTransactionRollbackIncompleteError = error =>
  error?.name === 'TransactionRollbackIncompleteError' && error?.rollbackComplete === false

export const classifyOnlineArtifactCoreFailure = (error, options = {}) => {
  if (error instanceof OnlineArtifactCoreOutcomeError) return error.outcome
  const isCommitted =
    typeof options.isTransactionCommittedError === 'function'
      ? options.isTransactionCommittedError
      : defaultIsTransactionCommittedError
  const isRollbackIncomplete =
    typeof options.isTransactionRollbackIncompleteError === 'function'
      ? options.isTransactionRollbackIncompleteError
      : defaultIsTransactionRollbackIncompleteError
  if (isRollbackIncomplete(error)) return 'indeterminate'
  if (isCommitted(error)) return 'applied'
  return 'not-applied'
}

const requireMethod = (value, key, label) => {
  const descriptor =
    value && (typeof value === 'object' || typeof value === 'function')
      ? Reflect.getOwnPropertyDescriptor(value, key)
      : null
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new TypeError(`${label}.${key} is required`)
  }
  return descriptor.value.bind(value)
}

const requireDigest = (value, path) => {
  if (typeof value !== 'string' || !/^sha256:[\da-f]{64}$/u.test(value)) {
    return failContract('must-be-a-sha256-digest', path)
  }
  return value
}

const bytesToHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

const bytesToBase64 = bytes => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const base64ToBytes = value => {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

const createHasher = crypto => {
  if (!crypto?.subtle || typeof crypto.subtle.digest !== 'function') {
    throw new TypeError('online artifact capability requires WebCrypto SHA-256')
  }
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', value))
  return Object.freeze({
    hashBytes: digest,
    bytes: async value => `sha256:${bytesToHex(await digest(value))}`,
    sri: async value => `sha256-${bytesToBase64(await digest(value))}`,
  })
}

const invocationFailure = (callId, status, code, message, details = {}) =>
  freezeDto({
    schemaVersion: 1,
    callId,
    status,
    failure: { code, message, retryable: false, details: cloneJsonValue(details, 'OnlineArtifact.failure.details') },
  })

const invocationFromReceipt = (receipt, output) =>
  freezeDto({
    schemaVersion: 1,
    callId: receipt.callId,
    status: receipt.status,
    ...(receipt.revision === undefined ? {} : { revision: receipt.revision }),
    ...(receipt.status === 'applied' ? { output } : { failure: receipt.failure }),
  })

const artifactSourceRevision = artifactRef => ({
  artifactId: artifactRef.artifactId,
  sourceRevision: artifactRef.sourceRevision,
  logicalComponentId: artifactRef.logicalComponentId,
  sourceIntegrity: artifactRef.sourceIntegrity,
})

const artifactRoot = (ownerType, ownerId, artifactRef) => ({
  ownerType,
  ownerId,
  artifactId: artifactRef.artifactId,
  sourceRevision: artifactRef.sourceRevision,
})

const durableArtifactRoots = ({ call, artifactRef, previousArtifactRef, journal, checkpoint, includeWorkingDraft }) => {
  const lineageRefs = [artifactRef, ...(previousArtifactRef === null ? [] : [previousArtifactRef])].filter(
    (candidate, index, values) =>
      values.findIndex(
        value => value.artifactId === candidate.artifactId && value.sourceRevision === candidate.sourceRevision,
      ) === index,
  )
  return [
    ...(includeWorkingDraft ? [artifactRoot('working-draft', call.branchId, artifactRef)] : []),
    ...lineageRefs.flatMap(lineageRef => [
      artifactRoot('receipt-intent', call.callId, lineageRef),
      artifactRoot('tool-receipt', call.callId, lineageRef),
      artifactRoot(
        'task-journal',
        `task-journal-v1:${encodeURIComponent(call.sessionId)}:${encodeURIComponent(journal.recordId)}`,
        lineageRef,
      ),
      artifactRoot('checkpoint', checkpoint.checkpointId, lineageRef),
    ]),
  ]
}

const normalizeRecoveryPostImages = value => {
  assertExactRecord(
    value,
    ['schemaVersion', 'kind', 'componentName', 'nodeId', 'artifactRef'],
    [],
    'OnlineArtifact.recovery.expectedPostImages',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'OnlineArtifact.recovery.expectedPostImages'),
    'OnlineArtifact.recovery.expectedPostImages.schemaVersion',
  )
  requireLiteral(
    ownDataValue(value, 'kind', 'OnlineArtifact.recovery.expectedPostImages'),
    ['online-artifact-post-images'],
    'OnlineArtifact.recovery.expectedPostImages.kind',
  )
  return freezeDto({
    schemaVersion: 1,
    kind: 'online-artifact-post-images',
    componentName: requireLiteral(
      ownDataValue(value, 'componentName', 'OnlineArtifact.recovery.expectedPostImages'),
      [GENERATED_MATERIAL_HOST_COMPONENT_NAME],
      'OnlineArtifact.recovery.expectedPostImages.componentName',
    ),
    nodeId: requireNonEmptyString(
      ownDataValue(value, 'nodeId', 'OnlineArtifact.recovery.expectedPostImages'),
      'OnlineArtifact.recovery.expectedPostImages.nodeId',
    ),
    artifactRef: validateArtifactRef(ownDataValue(value, 'artifactRef', 'OnlineArtifact.recovery.expectedPostImages')),
  })
}

const normalizeRecoveryPreImages = value => {
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
      'callDigest',
      'expectedRevision',
    ],
    [],
    'OnlineArtifact.recovery.preImages',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'OnlineArtifact.recovery.preImages'),
    'OnlineArtifact.recovery.preImages.schemaVersion',
  )
  requireLiteral(
    ownDataValue(value, 'kind', 'OnlineArtifact.recovery.preImages'),
    ['online-artifact-pre-images'],
    'OnlineArtifact.recovery.preImages.kind',
  )
  const previous = ownDataValue(value, 'previousArtifactRef', 'OnlineArtifact.recovery.preImages')
  const artifactIdentity = ownDataValue(value, 'artifactIdentity', 'OnlineArtifact.recovery.preImages')
  assertExactRecord(
    artifactIdentity,
    ['artifactId', 'sourceRevision', 'sourceIntegrity', 'dependencyLockDigest'],
    [],
    'OnlineArtifact.recovery.preImages.artifactIdentity',
  )
  return freezeDto({
    schemaVersion: 1,
    kind: 'online-artifact-pre-images',
    capability: requireLiteral(
      ownDataValue(value, 'capability', 'OnlineArtifact.recovery.preImages'),
      ['artifact.createOnline', 'artifact.reviseOnline'],
      'OnlineArtifact.recovery.preImages.capability',
    ),
    documentId: requireNonEmptyString(
      ownDataValue(value, 'documentId', 'OnlineArtifact.recovery.preImages'),
      'OnlineArtifact.recovery.preImages.documentId',
    ),
    nodeId: requireNonEmptyString(
      ownDataValue(value, 'nodeId', 'OnlineArtifact.recovery.preImages'),
      'OnlineArtifact.recovery.preImages.nodeId',
    ),
    previousArtifactRef: previous === null ? null : validateArtifactRef(previous),
    artifactIdentity: cloneJsonValue(artifactIdentity, 'OnlineArtifact.recovery.preImages.artifactIdentity'),
    callDigest: requireDigest(
      ownDataValue(value, 'callDigest', 'OnlineArtifact.recovery.preImages'),
      'OnlineArtifact.recovery.preImages.callDigest',
    ),
    expectedRevision: requireNonEmptyString(
      ownDataValue(value, 'expectedRevision', 'OnlineArtifact.recovery.preImages'),
      'OnlineArtifact.recovery.preImages.expectedRevision',
    ),
  })
}

const preparedHashInput = ({ authority, callId, baseRevision, preImages, expectedPostImages }) => ({
  schemaVersion: 1,
  kind: 'online-artifact-prepared-hash',
  projectId: authority.projectId,
  branchId: authority.branchId,
  callId,
  baseRevision,
  preImages,
  expectedPostImages,
})

const transactionFingerprintInput = ({ call, prepare, artifactRef }) => ({
  schemaVersion: 1,
  kind: 'online-artifact-transaction-fingerprint',
  capability: call.capability,
  projectId: call.projectId,
  branchId: call.branchId,
  callId: call.callId,
  documentId: prepare.documentId,
  nodeId: prepare.nodeId,
  baseMutationVersion: prepare.baseMutationVersion,
  previousArtifactRef: prepare.previousArtifactRef,
  artifactRef,
})

const recoverInvocation = async ({ recovery, call, hashJson }) => {
  if (recovery?.classification === 'missing') return null
  if (recovery?.classification === 'indeterminate') {
    return invocationFailure(
      call.callId,
      'indeterminate',
      ONLINE_ARTIFACT_FAILURE_CODE.indeterminateReceipt,
      'The durable online artifact receipt lineage is incomplete or ambiguous',
      { reason: typeof recovery.reason === 'string' ? recovery.reason : 'invalid-recovery' },
    )
  }
  if (recovery?.classification !== 'committed' && recovery?.classification !== 'failed') {
    return failContract('classification-is-invalid', 'OnlineArtifact.recovery')
  }
  try {
    const intent = createReceiptIntent(recovery.receiptIntent)
    if (intent.projectId !== call.projectId || intent.branchId !== call.branchId || intent.callId !== call.callId) {
      return failContract('authority-mismatch', 'OnlineArtifact.recovery')
    }
    const preImages = normalizeRecoveryPreImages(intent.preImages)
    const output = normalizeRecoveryPostImages(intent.expectedPostImages)
    if (preImages.capability !== call.capability || preImages.nodeId !== output.nodeId) {
      return failContract('capability-or-node-mismatch', 'OnlineArtifact.recovery')
    }
    if (preImages.expectedRevision !== call.expectedRevision) {
      return failContract('expected-revision-mismatch', 'OnlineArtifact.recovery')
    }
    if (preImages.callDigest !== (await hashJson(call))) {
      return failContract('call-semantics-mismatch', 'OnlineArtifact.recovery')
    }
    const expectedHash = await hashJson(
      preparedHashInput({
        authority: call,
        callId: call.callId,
        baseRevision: intent.baseRevision,
        preImages: intent.preImages,
        expectedPostImages: intent.expectedPostImages,
      }),
    )
    if (expectedHash !== intent.preparedHash) return failContract('prepared-hash-mismatch', 'OnlineArtifact.recovery')
    const receipt = createToolReceipt(recovery.receipt)
    return invocationFromReceipt(receipt, output)
  } catch {
    return invocationFailure(
      call.callId,
      'indeterminate',
      ONLINE_ARTIFACT_FAILURE_CODE.indeterminateReceipt,
      'The durable online artifact receipt failed integrity verification',
      { reason: 'invalid-artifact-recovery-evidence' },
    )
  }
}

const validateResolverResult = async ({ request, value, hasher }) => {
  const dependency = validateLockedArtifactDependency(value)
  if (dependency.package !== request.package || dependency.range !== request.range) {
    return failContract('resolver-authority-mismatch', 'OnlineArtifact.resolver')
  }
  const bytes = base64ToBytes(dependency.module.bytes)
  const integrity = await hasher.sri(bytes)
  if (integrity !== dependency.integrity)
    return failContract('dependency-integrity-mismatch', 'OnlineArtifact.resolver')
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return failContract('dependency-module-is-not-valid-utf8', 'OnlineArtifact.resolver')
  }
  return dependency
}

const artifactIdentityDigest = async (hashJson, call) =>
  hashJson({
    schemaVersion: 1,
    kind: 'online-artifact-call-identity',
    projectId: call.projectId,
    branchId: call.branchId,
    callId: call.callId,
  })

const identitySuffix = digest => digest.slice('sha256:'.length)

const createArtifactIdentity = async ({ call, prepare, hashJson }) => {
  const suffix = identitySuffix(await artifactIdentityDigest(hashJson, call))
  if (call.capability === 'artifact.createOnline') {
    return freezeDto({
      artifactId: `online-artifact-${suffix}`,
      sourceRevision: `online-revision-${suffix}`,
      logicalComponentId: `generated-component-${suffix}`,
    })
  }
  return freezeDto({
    artifactId: prepare.previousArtifactRef.artifactId,
    sourceRevision: `online-revision-${suffix}`,
    logicalComponentId: prepare.previousArtifactRef.logicalComponentId,
  })
}

const assertArtifactMatchesCall = async ({ artifact, call, prepare, identity, sourceIntegrity, hasher }) => {
  const validated = await verifyArtifactRecordIntegrity(artifact, { hashBytes: hasher.hashBytes })
  if (
    validated.artifactId !== identity.artifactId ||
    validated.sourceRevision !== identity.sourceRevision ||
    validated.logicalComponentId !== identity.logicalComponentId
  ) {
    return failContract('existing-artifact-identity-mismatch', 'OnlineArtifact.artifact')
  }
  if (validated.source !== call.arguments.source || validated.css !== call.arguments.css) {
    return failContract('existing-artifact-content-mismatch', 'OnlineArtifact.artifact')
  }
  if (!jsonDataEqual(validated.safeManifest, call.arguments.safeManifest)) {
    return failContract('existing-artifact-manifest-mismatch', 'OnlineArtifact.artifact')
  }
  if (validated.sourceIntegrity !== sourceIntegrity) {
    return failContract('existing-artifact-source-integrity-mismatch', 'OnlineArtifact.artifact')
  }
  const actualRequests = validated.lockedDependencies.map(({ package: packageName, range }) => ({
    package: packageName,
    range,
  }))
  if (!jsonDataEqual(actualRequests, call.arguments.dependencies)) {
    return failContract('existing-artifact-dependency-request-mismatch', 'OnlineArtifact.artifact')
  }
  const expectedSupersedes =
    call.capability === 'artifact.createOnline' ? null : artifactSourceRevision(prepare.previousArtifactRef)
  if (!jsonDataEqual(validated.supersedes, expectedSupersedes)) {
    return failContract('existing-artifact-supersedes-mismatch', 'OnlineArtifact.artifact')
  }
  if (!jsonDataEqual(validated.provenance, artifactProvenance(call))) {
    return failContract('existing-artifact-provenance-mismatch', 'OnlineArtifact.artifact')
  }
  return validated
}

const normalizeArtifactCreateResult = (value, expected) => {
  assertExactRecord(value, ['schemaVersion', 'status', 'artifact'], [], 'OnlineArtifact.artifactCreateResult')
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'OnlineArtifact.artifactCreateResult'),
    'OnlineArtifact.artifactCreateResult.schemaVersion',
  )
  requireLiteral(
    ownDataValue(value, 'status', 'OnlineArtifact.artifactCreateResult'),
    ['created', 'reconciled'],
    'OnlineArtifact.artifactCreateResult.status',
  )
  const artifact = validateArtifactRecord(ownDataValue(value, 'artifact', 'OnlineArtifact.artifactCreateResult'))
  if (canonicalJsonStringify(artifact) !== canonicalJsonStringify(expected)) {
    return failContract('persistence-returned-different-artifact', 'OnlineArtifact.artifactCreateResult')
  }
  return artifact
}

const artifactProvenance = call => ({
  schemaVersion: 1,
  capability: call.capability,
  projectId: call.projectId,
  branchId: call.branchId,
  sessionId: call.sessionId,
  taskId: call.taskId,
  stepId: call.stepId,
  callId: call.callId,
})

const createOrRecoverArtifact = async ({
  call,
  prepare,
  identity,
  persistence,
  resolveDependency,
  hasher,
  hashJson,
  now,
}) => {
  scanArtifactSource(call.arguments.source)
  const sourceIntegrity = await hasher.bytes(new TextEncoder().encode(call.arguments.source))
  const readRequest = {
    schemaVersion: 1,
    projectId: call.projectId,
    artifactId: identity.artifactId,
    sourceRevision: identity.sourceRevision,
  }
  const existing = await persistence.readArtifact(readRequest)
  if (existing !== null) {
    return assertArtifactMatchesCall({ artifact: existing, call, prepare, identity, sourceIntegrity, hasher })
  }
  const lockedDependencies = []
  for (const request of call.arguments.dependencies) {
    lockedDependencies.push(await validateResolverResult({ request, value: await resolveDependency(request), hasher }))
  }
  const dependencyLockDigest = await hashJson(lockedDependencies)
  const record = validateArtifactRecord({
    schemaVersion: 1,
    projectId: call.projectId,
    ...identity,
    sourceIntegrity,
    source: call.arguments.source,
    css: call.arguments.css,
    safeManifest: call.arguments.safeManifest,
    lockedDependencies,
    dependencyLockDigest,
    diagnostics: [],
    provenance: artifactProvenance(call),
    createdAt: requireNonNegativeInteger(now(), 'OnlineArtifact.createdAt'),
    supersedes:
      call.capability === 'artifact.createOnline' ? null : artifactSourceRevision(prepare.previousArtifactRef),
  })
  return normalizeArtifactCreateResult(await persistence.createArtifact(record), record)
}

const preparedPayloads = ({ call, prepare, artifact, artifactRef, callDigest }) => ({
  preImages: freezeDto({
    schemaVersion: 1,
    kind: 'online-artifact-pre-images',
    capability: call.capability,
    documentId: prepare.documentId,
    nodeId: prepare.nodeId,
    previousArtifactRef: prepare.previousArtifactRef,
    artifactIdentity: {
      artifactId: artifact.artifactId,
      sourceRevision: artifact.sourceRevision,
      sourceIntegrity: artifact.sourceIntegrity,
      dependencyLockDigest: artifact.dependencyLockDigest,
    },
    callDigest,
    expectedRevision: call.expectedRevision,
  }),
  expectedPostImages: freezeDto({
    schemaVersion: 1,
    kind: 'online-artifact-post-images',
    componentName: GENERATED_MATERIAL_HOST_COMPONENT_NAME,
    nodeId: prepare.nodeId,
    artifactRef,
  }),
})

const terminalJournal = ({ call, prepare, artifactRef, status, failureCode }) => ({
  recordId: `call:${call.callId}`,
  kind: 'online-artifact',
  value: {
    schemaVersion: 1,
    capability: call.capability,
    taskId: call.taskId,
    stepId: call.stepId,
    documentId: prepare.documentId,
    nodeId: prepare.nodeId,
    artifactRef,
    status,
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

const createService = options => {
  const authority = Object.freeze({ ...options.authority })
  const core = Object.freeze({
    prepareCreate: requireMethod(options.core, 'prepareCreate', 'core'),
    prepareRevise: requireMethod(options.core, 'prepareRevise', 'core'),
    createOnline: requireMethod(options.core, 'createOnline', 'core'),
    reviseOnline: requireMethod(options.core, 'reviseOnline', 'core'),
    captureProject: requireMethod(options.core, 'captureProject', 'core'),
  })
  const persistence = Object.freeze({
    createArtifact: requireMethod(options.persistence, 'createArtifact', 'persistence'),
    readArtifact: requireMethod(options.persistence, 'readArtifact', 'persistence'),
    recoverDurableAgentReceipt: requireMethod(options.persistence, 'recoverDurableAgentReceipt', 'persistence'),
    runDurableAgentWrite: requireMethod(options.persistence, 'runDurableAgentWrite', 'persistence'),
  })
  const resolveDependency = requireMethod(options.resolver, 'resolve', 'resolver')
  const now = typeof options.now === 'function' ? options.now : Date.now
  const crypto = options.crypto ?? globalThis.crypto
  const hasher = createHasher(crypto)
  const hashJson = value => hashCanonicalJson(value, { crypto })
  const coreFailureClassifiers = Object.freeze({
    ...(typeof options.isTransactionCommittedError === 'function'
      ? { isTransactionCommittedError: options.isTransactionCommittedError }
      : {}),
    ...(typeof options.isTransactionRollbackIncompleteError === 'function'
      ? { isTransactionRollbackIncompleteError: options.isTransactionRollbackIncompleteError }
      : {}),
  })

  const invoke = async (value, capability) => {
    const call = normalizeOnlineArtifactCall(value, authority, capability)
    const recoveryAuthority = { projectId: call.projectId, branchId: call.branchId, callId: call.callId }
    const recovered = await recoverInvocation({
      recovery: await persistence.recoverDurableAgentReceipt(recoveryAuthority),
      call,
      hashJson,
    })
    if (recovered) return recovered

    const identityDigest = identitySuffix(await artifactIdentityDigest(hashJson, call))
    const nodeId =
      call.capability === 'artifact.createOnline' ? `generated-node-${identityDigest}` : call.arguments.nodeId
    const rawPrepare =
      call.capability === 'artifact.createOnline'
        ? await core.prepareCreate({
            schemaVersion: 1,
            projectId: call.projectId,
            branchId: call.branchId,
            callId: call.callId,
            expectedRevision: call.expectedRevision,
            documentId: call.arguments.documentId,
            parentId: call.arguments.parentId,
            position: call.arguments.position,
            ...(call.arguments.props === undefined ? {} : { props: call.arguments.props }),
            ...(call.arguments.rect === undefined ? {} : { rect: call.arguments.rect }),
            nodeId,
          })
        : await core.prepareRevise({
            schemaVersion: 1,
            projectId: call.projectId,
            branchId: call.branchId,
            callId: call.callId,
            expectedRevision: call.expectedRevision,
            nodeId,
          })
    const prepare = normalizeOnlineArtifactPrepareResult(rawPrepare, {
      capability: call.capability,
      expectedRevision: call.expectedRevision,
      nodeId,
      ...(call.capability === 'artifact.createOnline' ? { documentId: call.arguments.documentId } : {}),
    })
    const identity = await createArtifactIdentity({ call, prepare, hashJson })
    const artifact = await createOrRecoverArtifact({
      call,
      prepare,
      identity,
      persistence,
      resolveDependency,
      hasher,
      hashJson,
      now,
    })
    const artifactRef = validateArtifactRef({
      ...artifactSourceRevision(artifact),
      target: { kind: 'online' },
    })
    const payloads = preparedPayloads({
      call,
      prepare,
      artifact,
      artifactRef,
      callDigest: await hashJson(call),
    })
    const transactionFingerprint = await hashJson(transactionFingerprintInput({ call, prepare, artifactRef }))
    const preparedHash = await hashJson(
      preparedHashInput({
        authority: call,
        callId: call.callId,
        baseRevision: prepare.baseRevision,
        preImages: payloads.preImages,
        expectedPostImages: payloads.expectedPostImages,
      }),
    )
    const intent = createReceiptIntent({
      schemaVersion: 1,
      ...recoveryAuthority,
      preparedHash,
      baseRevision: prepare.baseRevision,
      preImages: payloads.preImages,
      expectedPostImages: payloads.expectedPostImages,
      status: 'pending',
    })

    let coreApplied = false
    try {
      return await persistence.runDurableAgentWrite(async session => {
        const expectedDraftGeneration = requireNonNegativeInteger(
          session?.draft?.draftGeneration,
          'OnlineArtifact.writeSession.draftGeneration',
        )
        await session.recordIntent(intent)
        let rawPost
        try {
          rawPost = await core[call.capability === 'artifact.createOnline' ? 'createOnline' : 'reviseOnline']({
            schemaVersion: 1,
            projectId: call.projectId,
            branchId: call.branchId,
            callId: call.callId,
            documentId: prepare.documentId,
            nodeId: prepare.nodeId,
            expectedMutationVersion: prepare.baseMutationVersion,
            artifactRef,
            ...(call.capability === 'artifact.createOnline'
              ? {
                  parentId: call.arguments.parentId,
                  position: call.arguments.position,
                  ...(call.arguments.props === undefined ? {} : { props: call.arguments.props }),
                  ...(call.arguments.rect === undefined ? {} : { rect: call.arguments.rect }),
                }
              : { previousArtifactRef: prepare.previousArtifactRef }),
          })
        } catch (error) {
          const outcome = classifyOnlineArtifactCoreFailure(error, coreFailureClassifiers)
          if (outcome !== 'not-applied') {
            if (outcome === 'applied') coreApplied = true
            return invocationFailure(
              call.callId,
              'indeterminate',
              outcome === 'applied'
                ? ONLINE_ARTIFACT_FAILURE_CODE.appliedUndurable
                : ONLINE_ARTIFACT_FAILURE_CODE.indeterminateCoreOutcome,
              'The trusted Core online artifact operation has an indeterminate durable outcome',
              { requiredPause: true },
            )
          }
          const project = normalizeOnlineArtifactProjectCapture(await core.captureProject())
          const draftGeneration = expectedDraftGeneration + 1
          const failureCode = ONLINE_ARTIFACT_FAILURE_CODE.coreTransactionFailed
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
            revision: project.revision,
            witness: createToolReceiptWitness(witness),
            failure: {
              code: failureCode,
              message: 'The trusted Core online artifact operation failed without applying',
              retryable: false,
              details: { stage: 'core' },
            },
          })
          const committed = await session.commitBatch({
            schemaVersion: 1,
            ...recoveryAuthority,
            expectedDraftGeneration,
            activeDocument: project.activeDocument,
            projectSchema: project.projectSchema,
            updatedAt: requireNonNegativeInteger(now(), 'OnlineArtifact.updatedAt'),
            receiptIntent: intent,
            receipt,
            witness,
            provenance: [],
            sessionId: call.sessionId,
            journal: terminalJournal({ call, prepare, artifactRef, status: 'not-applied', failureCode }),
            checkpoint: terminalCheckpoint({ call, status: 'not-applied', failureCode }),
            artifactRefs: [],
            artifactRefDeletes: [],
          })
          return invocationFromReceipt(createToolReceipt(committed.receipt), payloads.expectedPostImages)
        }

        let post
        try {
          post = normalizeOnlineArtifactCoreResult(rawPost, { ...prepare, artifactRef })
          coreApplied = true
        } catch {
          coreApplied = true
          return invocationFailure(
            call.callId,
            'indeterminate',
            ONLINE_ARTIFACT_FAILURE_CODE.appliedUndurable,
            'Core returned after mutation, but its canonical online artifact post-state was invalid',
            { requiredPause: true },
          )
        }

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
          ...recoveryAuthority,
          draftGeneration,
          coreMutationVersion: post.coreMutationVersion,
          transactionFingerprint,
          affectedSlotTokens: provenance.map(({ slotKey, token }) => ({ slotKey, token })),
        })
        const receipt = createToolReceipt({
          schemaVersion: 1,
          ...recoveryAuthority,
          status: 'applied',
          revision: post.revision,
          witness: createToolReceiptWitness(witness),
        })
        const journal = terminalJournal({ call, prepare, artifactRef, status: 'applied' })
        const checkpoint = terminalCheckpoint({ call, status: 'applied' })
        const committed = await session.commitBatch({
          schemaVersion: 1,
          ...recoveryAuthority,
          expectedDraftGeneration,
          activeDocument: post.activeDocument,
          projectSchema: post.projectSchema,
          updatedAt: requireNonNegativeInteger(now(), 'OnlineArtifact.updatedAt'),
          receiptIntent: intent,
          receipt,
          witness,
          provenance,
          sessionId: call.sessionId,
          journal,
          checkpoint,
          artifactRefs: durableArtifactRoots({
            call,
            artifactRef,
            previousArtifactRef: prepare.previousArtifactRef,
            journal,
            checkpoint,
            includeWorkingDraft: true,
          }),
          artifactRefDeletes:
            prepare.previousArtifactRef === null
              ? []
              : [artifactRoot('working-draft', call.branchId, prepare.previousArtifactRef)],
        })
        return invocationFromReceipt(createToolReceipt(committed.receipt), payloads.expectedPostImages)
      })
    } catch {
      return invocationFailure(
        call.callId,
        'indeterminate',
        coreApplied ? ONLINE_ARTIFACT_FAILURE_CODE.appliedUndurable : ONLINE_ARTIFACT_FAILURE_CODE.persistenceFailure,
        coreApplied
          ? 'Core changed, but the online artifact durable batch did not commit'
          : 'The online artifact durable write did not reach a terminal commit',
        { requiredPause: true },
      )
    }
  }

  const queryReceipt = async request => {
    const recovery = await persistence.recoverDurableAgentReceipt(request)
    if (recovery?.classification === 'missing' || recovery?.classification === 'indeterminate') return null
    if (recovery?.classification !== 'committed' && recovery?.classification !== 'failed') return null
    const rawPreImages = recovery?.receiptIntent?.preImages
    if (
      optionalOwnDataValue(rawPreImages, 'kind', 'OnlineArtifact.receiptQuery.preImages') !==
      'online-artifact-pre-images'
    ) {
      return null
    }
    try {
      const intent = createReceiptIntent(recovery.receiptIntent)
      if (
        intent.projectId !== request.projectId ||
        intent.branchId !== request.branchId ||
        intent.callId !== request.callId
      ) {
        return failContract('authority-mismatch', 'OnlineArtifact.receiptQuery')
      }
      const preImages = normalizeRecoveryPreImages(intent.preImages)
      const output = normalizeRecoveryPostImages(intent.expectedPostImages)
      if (preImages.nodeId !== output.nodeId) return failContract('node-mismatch', 'OnlineArtifact.receiptQuery')
      const expectedHash = await hashJson(
        preparedHashInput({
          authority: request,
          callId: request.callId,
          baseRevision: intent.baseRevision,
          preImages: intent.preImages,
          expectedPostImages: intent.expectedPostImages,
        }),
      )
      if (expectedHash !== intent.preparedHash) {
        return failContract('prepared-hash-mismatch', 'OnlineArtifact.receiptQuery')
      }
      const receipt = createToolReceipt(recovery.receipt)
      if (
        receipt.projectId !== request.projectId ||
        receipt.branchId !== request.branchId ||
        receipt.callId !== request.callId
      ) {
        return failContract('receipt-authority-mismatch', 'OnlineArtifact.receiptQuery')
      }
      return receipt
    } catch {
      return createToolReceipt({
        schemaVersion: 1,
        projectId: request.projectId,
        branchId: request.branchId,
        callId: request.callId,
        status: 'indeterminate',
        failure: {
          code: ONLINE_ARTIFACT_FAILURE_CODE.indeterminateReceipt,
          message: 'The durable online artifact receipt failed integrity verification',
          retryable: false,
          details: { reason: 'invalid-artifact-recovery-evidence' },
        },
      })
    }
  }

  return Object.freeze({
    createOnline: value => invoke(value, 'artifact.createOnline'),
    queryReceipt,
    reviseOnline: value => invoke(value, 'artifact.reviseOnline'),
  })
}

export const createDashboardOnlineArtifactCapabilityService = options => {
  if (!options || typeof options !== 'object') throw new TypeError('online artifact capability options are required')
  return createService(options)
}
