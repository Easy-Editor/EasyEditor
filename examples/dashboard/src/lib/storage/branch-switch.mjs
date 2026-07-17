import { canonicalJsonStringify } from './canonical-json.mjs'
import { assertStorageCompatibilityWritable } from './compatibility-marker.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'
import { requestLegacyIdentityLock, requestLegacySnapshotLock } from './legacy-snapshot-lock.mjs'
import {
  assertCanonicalWorkingDraftForLegacySnapshot,
  writeVerifiedLegacySnapshotPayload,
} from './legacy-snapshot-writer.mjs'
import { parseLegacyStorageIdentity } from './legacy-storage.mjs'
import { DASHBOARD_STORAGE_IDENTITY_POINTER_KEY } from './schema.mjs'

export const DASHBOARD_STORAGE_BRANCH_SWITCH_KEY = 'easy-editor:storage:branch-switch:v1'
export const DASHBOARD_STORAGE_BRANCH_SWITCH_CRASH_POINTS = Object.freeze([
  'after-transition-intent',
  'after-project-schema',
  'after-page-schema',
  'after-page-info',
  'after-snapshot-metadata',
  'after-verification',
  'after-compatibility-marker',
  'after-active-pointer',
  'after-transition-complete',
])

const hashPattern = /^sha256:[\da-f]{64}$/u
const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
const failure = (code, reason, details, options) => new DashboardStorageError(code, reason, details ?? {}, options)
const restoreRequestFields = Object.freeze([
  'schemaVersion',
  'batchId',
  'projectId',
  'sourceBranchId',
  'versionId',
  'targetBranchId',
  'targetSessionId',
  'forkedFromSessionId',
  'forkedFromTaskId',
  'restoredAt',
])

const isPlainObject = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const exactFields = (value, fields) => {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort(compareCodeUnits)
  const expected = [...fields].sort(compareCodeUnits)
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

const normalizeFence = value => {
  if (
    !exactFields(value, ['projectId', 'branchId', 'draftGeneration', 'projectHash']) ||
    typeof value.projectId !== 'string' ||
    value.projectId.length === 0 ||
    typeof value.branchId !== 'string' ||
    value.branchId.length === 0 ||
    !Number.isSafeInteger(value.draftGeneration) ||
    value.draftGeneration < 1 ||
    !hashPattern.test(value.projectHash)
  ) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-fence-is-malformed')
  }
  return Object.freeze({
    projectId: value.projectId,
    branchId: value.branchId,
    draftGeneration: value.draftGeneration,
    projectHash: value.projectHash,
  })
}

const normalizeRequiredString = (value, field) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, `${field}-is-malformed`)
  }
  return value
}

const normalizeNullableString = (value, field) => (value === null ? null : normalizeRequiredString(value, field))

const normalizeRestoreRequest = value => {
  if (!exactFields(value, restoreRequestFields) || value.schemaVersion !== 1) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-restore-request-is-malformed')
  }
  const request = Object.freeze({
    schemaVersion: 1,
    batchId: normalizeRequiredString(value.batchId, 'branch-switch-restore-request-batch-id'),
    projectId: normalizeRequiredString(value.projectId, 'branch-switch-restore-request-project-id'),
    sourceBranchId: normalizeRequiredString(value.sourceBranchId, 'branch-switch-restore-request-source-branch-id'),
    versionId: normalizeRequiredString(value.versionId, 'branch-switch-restore-request-version-id'),
    targetBranchId: normalizeRequiredString(value.targetBranchId, 'branch-switch-restore-request-target-branch-id'),
    targetSessionId: normalizeRequiredString(value.targetSessionId, 'branch-switch-restore-request-target-session-id'),
    forkedFromSessionId: normalizeNullableString(
      value.forkedFromSessionId,
      'branch-switch-restore-request-source-session-id',
    ),
    forkedFromTaskId: normalizeNullableString(value.forkedFromTaskId, 'branch-switch-restore-request-source-task-id'),
    restoredAt: value.restoredAt,
  })
  if (!Number.isSafeInteger(request.restoredAt) || request.restoredAt < 0) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-restore-request-time-is-malformed')
  }
  if (request.sourceBranchId === request.targetBranchId) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-restore-request-does-not-fork')
  }
  return request
}

const assertRestoreTargetAuthority = (source, target, restoreRequest) => {
  if (
    source.projectId !== target.projectId ||
    target.draftGeneration !== 1 ||
    restoreRequest.projectId !== source.projectId ||
    restoreRequest.targetBranchId !== target.branchId
  ) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-transition-authority-is-invalid')
  }
}

const assertRestoreAuthority = (source, target, restoreRequest) => {
  assertRestoreTargetAuthority(source, target, restoreRequest)
  if (source.branchId === target.branchId) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-transition-authority-is-invalid')
  }
}

const parseTransition = raw => {
  if (raw === null) return null
  let value
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw failure(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'branch-switch-transition-is-malformed',
      {},
      { cause: error },
    )
  }
  if (
    !exactFields(value, ['schemaVersion', 'kind', 'status', 'source', 'target', 'restoreRequest', 'updatedAt']) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'version-restore' ||
    (value.status !== 'pending' && value.status !== 'complete' && value.status !== 'aborted') ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt < 0
  ) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-transition-is-malformed')
  }
  const source = normalizeFence(value.source)
  const target = normalizeFence(value.target)
  const restoreRequest = normalizeRestoreRequest(value.restoreRequest)
  assertRestoreAuthority(source, target, restoreRequest)
  return Object.freeze({
    schemaVersion: 1,
    kind: 'version-restore',
    status: value.status,
    source,
    target,
    restoreRequest,
    updatedAt: value.updatedAt,
  })
}

const fenceFromMarker = marker =>
  normalizeFence({
    projectId: marker.projectId,
    branchId: marker.branchId,
    draftGeneration: marker.draftGeneration,
    projectHash: marker.projectHash,
  })

const fenceFromDraft = draft =>
  normalizeFence({
    projectId: draft.projectId,
    branchId: draft.branchId,
    draftGeneration: draft.draftGeneration,
    projectHash: draft.projectHash,
  })

const sameFence = (left, right) => canonicalJsonStringify(left) === canonicalJsonStringify(right)
const sameRestoreRequest = (left, right) => canonicalJsonStringify(left) === canonicalJsonStringify(right)
const sameTransitionAuthority = (left, right) =>
  left.kind === right.kind &&
  sameFence(left.source, right.source) &&
  sameFence(left.target, right.target) &&
  sameRestoreRequest(left.restoreRequest, right.restoreRequest)

const readIdentity = legacy => {
  const raw = legacy.readValue(DASHBOARD_STORAGE_IDENTITY_POINTER_KEY)
  const identity = parseLegacyStorageIdentity(raw)
  if (!identity) {
    throw failure(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      raw === null ? 'branch-switch-active-pointer-is-missing' : 'branch-switch-active-pointer-is-malformed',
    )
  }
  return identity
}

const identityMatchesFence = (identity, fence) =>
  identity.projectId === fence.projectId && identity.branchId === fence.branchId

const markerMatchesFence = (marker, fence) =>
  marker?.canonicalBackend === 'indexeddb' && sameFence(fenceFromMarker(marker), fence)

const writeIdentity = (legacy, fence) => {
  const identity = Object.freeze({ schemaVersion: 1, projectId: fence.projectId, branchId: fence.branchId })
  legacy.writeValue(DASHBOARD_STORAGE_IDENTITY_POINTER_KEY, JSON.stringify(identity))
  const stored = readIdentity(legacy)
  if (!identityMatchesFence(stored, fence)) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-active-pointer-was-not-retained')
  }
  return stored
}

const writeTransition = (legacy, transition) => {
  legacy.writeValue(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY, JSON.stringify(transition))
  const stored = parseTransition(legacy.readValue(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY))
  if (!stored || canonicalJsonStringify(stored) !== canonicalJsonStringify(transition)) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-transition-was-not-retained')
  }
  return stored
}

const inject = (crashInjector, point, details = {}) => {
  if (typeof crashInjector === 'function') crashInjector(Object.freeze({ point, ...details }))
}

const scopeKey = scope => `${scope.projectId}\u0000${scope.branchId}`

const withSnapshotLocks = (scopes, lockManager, operation) => {
  const ordered = [...new Map(scopes.map(scope => [scopeKey(scope), scope])).values()].sort((left, right) =>
    compareCodeUnits(scopeKey(left), scopeKey(right)),
  )
  const acquire = index =>
    index >= ordered.length
      ? operation()
      : requestLegacySnapshotLock({ scope: ordered[index], lockManager }, () => acquire(index + 1))
  return acquire(0)
}

const inspectMarker = legacy => {
  const inspection = legacy.inspectCompatibilityMarker()
  if (inspection.diagnostic || !inspection.marker) {
    throw failure(
      DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
      inspection.diagnostic
        ? 'branch-switch-compatibility-marker-is-malformed'
        : 'branch-switch-compatibility-marker-is-missing',
    )
  }
  assertStorageCompatibilityWritable(inspection.marker)
  if (inspection.marker.canonicalBackend !== 'indexeddb') {
    throw failure(
      DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
      'branch-switch-requires-indexeddb-canonical-authority',
    )
  }
  return inspection.marker
}

const assertTransitionSurface = (legacy, transition) => {
  const marker = inspectMarker(legacy)
  const identity = readIdentity(legacy)
  const markerAtSource = markerMatchesFence(marker, transition.source)
  const markerAtTarget = markerMatchesFence(marker, transition.target)
  const identityAtSource = identityMatchesFence(identity, transition.source)
  const identityAtTarget = identityMatchesFence(identity, transition.target)
  if ((!markerAtSource && !markerAtTarget) || (!identityAtSource && !identityAtTarget)) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-surface-has-unrelated-authority')
  }
  if (markerAtSource && identityAtTarget) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-surface-order-is-invalid')
  }
  return { markerAtTarget, identityAtTarget }
}

const assertCompletedTransitionStable = (legacy, transition) => {
  const surface = assertTransitionSurface(legacy, transition)
  if (!surface.markerAtTarget || !surface.identityAtTarget) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'completed-branch-switch-surface-is-not-stable')
  }
}

const assertAbortedTransitionStable = (legacy, transition) => {
  const surface = assertTransitionSurface(legacy, transition)
  if (surface.markerAtTarget || surface.identityAtTarget) {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'aborted-branch-switch-surface-is-not-stable')
  }
}

const resumeTransition = async ({ legacy, transition, draft, now, crashInjector, lockManager, status }) =>
  withSnapshotLocks([transition.source, transition.target], lockManager, async () => {
    const current = parseTransition(legacy.readValue(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY))
    if (!current || !sameTransitionAuthority(current, transition)) {
      throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-transition-changed-during-recovery')
    }
    if (current.status === 'complete') {
      assertCompletedTransitionStable(legacy, current)
      return Object.freeze({ schemaVersion: 1, status: 'reconciled', transition: current, draft })
    }
    if (current.status !== 'pending') {
      throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-transition-is-not-pending')
    }
    assertTransitionSurface(legacy, current)
    const metadata = await writeVerifiedLegacySnapshotPayload({ legacy, draft, now, crashInjector })
    const marker = legacy.writeCompatibilityMarker({
      canonicalBackend: 'indexeddb',
      projectId: current.target.projectId,
      branchId: current.target.branchId,
      draftGeneration: current.target.draftGeneration,
      projectHash: current.target.projectHash,
      updatedAt: metadata.updatedAt,
    })
    inject(crashInjector, 'after-compatibility-marker')
    const identity = writeIdentity(legacy, current.target)
    inject(crashInjector, 'after-active-pointer')
    const complete = writeTransition(
      legacy,
      Object.freeze({ ...current, status: 'complete', updatedAt: metadata.updatedAt }),
    )
    inject(crashInjector, 'after-transition-complete')
    return Object.freeze({ schemaVersion: 1, status, transition: complete, marker, identity, metadata, draft })
  })

export const prepareIndexedDbCompatibilityBranchSwitch = async ({
  legacy,
  source,
  target,
  restoreRequest,
  readDraft,
  now = Date.now,
  crashInjector,
  lockManager,
}) => {
  const normalizedSource = normalizeFence(source)
  const normalizedTarget = normalizeFence(target)
  const normalizedRequest = normalizeRestoreRequest(restoreRequest)
  assertRestoreTargetAuthority(normalizedSource, normalizedTarget, normalizedRequest)
  if (typeof readDraft !== 'function') {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, 'branch-switch-prepare-requires-a-draft-reader')
  }

  return requestLegacyIdentityLock({ lockManager }, () =>
    withSnapshotLocks([normalizedSource, normalizedTarget], lockManager, async () => {
      const existing = parseTransition(legacy.readValue(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY))
      if (existing?.status === 'complete') {
        assertCompletedTransitionStable(legacy, existing)
        if (
          sameFence(existing.target, normalizedTarget) &&
          sameRestoreRequest(existing.restoreRequest, normalizedRequest)
        ) {
          return Object.freeze({ schemaVersion: 1, status: 'reconciled', transition: existing })
        }
      }
      assertRestoreAuthority(normalizedSource, normalizedTarget, normalizedRequest)
      const candidate = Object.freeze({
        schemaVersion: 1,
        kind: 'version-restore',
        status: 'pending',
        source: normalizedSource,
        target: normalizedTarget,
        restoreRequest: normalizedRequest,
        updatedAt: now(),
      })
      if (existing?.status === 'pending') {
        if (!sameTransitionAuthority(existing, candidate)) {
          throw failure(DASHBOARD_STORAGE_ERROR_CODE.generationConflict, 'another-branch-switch-is-already-pending')
        }
        assertTransitionSurface(legacy, existing)
        return Object.freeze({ schemaVersion: 1, status: 'reconciled', transition: existing })
      }
      if (existing?.status === 'aborted') {
        assertAbortedTransitionStable(legacy, existing)
        const abandonedTarget = await readDraft({
          projectId: existing.target.projectId,
          branchId: existing.target.branchId,
        })
        if (abandonedTarget) {
          throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'aborted-branch-switch-target-draft-exists')
        }
      }

      const marker = inspectMarker(legacy)
      const identity = readIdentity(legacy)
      if (!markerMatchesFence(marker, normalizedSource) || !identityMatchesFence(identity, normalizedSource)) {
        throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-source-is-not-active')
      }
      const existingTarget = await readDraft({
        projectId: normalizedTarget.projectId,
        branchId: normalizedTarget.branchId,
      })
      if (existingTarget) {
        throw failure(DASHBOARD_STORAGE_ERROR_CODE.generationConflict, 'branch-switch-target-already-exists')
      }
      const transition = writeTransition(legacy, candidate)
      inject(crashInjector, 'after-transition-intent')
      return Object.freeze({ schemaVersion: 1, status: 'prepared', transition })
    }),
  )
}

export const abortPreparedIndexedDbCompatibilityBranchSwitch = async ({
  legacy,
  restoreRequest,
  readDraft,
  now = Date.now,
  lockManager,
}) => {
  const normalizedRequest = normalizeRestoreRequest(restoreRequest)
  if (typeof readDraft !== 'function') {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, 'branch-switch-abort-requires-a-draft-reader')
  }
  return requestLegacyIdentityLock({ lockManager }, async () => {
    const initial = parseTransition(legacy.readValue(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY))
    if (!initial || !sameRestoreRequest(initial.restoreRequest, normalizedRequest)) {
      throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-abort-request-does-not-match')
    }
    return withSnapshotLocks([initial.source, initial.target], lockManager, async () => {
      const current = parseTransition(legacy.readValue(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY))
      if (!current || !sameTransitionAuthority(current, initial)) {
        throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-transition-changed-during-abort')
      }
      if (current.status === 'aborted') {
        assertAbortedTransitionStable(legacy, current)
        return Object.freeze({ schemaVersion: 1, status: 'reconciled', transition: current })
      }
      if (current.status !== 'pending') {
        throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-transition-cannot-be-aborted')
      }
      assertAbortedTransitionStable(legacy, current)
      const targetDraft = await readDraft({ projectId: current.target.projectId, branchId: current.target.branchId })
      if (targetDraft) {
        throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-target-exists-during-abort')
      }
      const aborted = writeTransition(legacy, Object.freeze({ ...current, status: 'aborted', updatedAt: now() }))
      return Object.freeze({ schemaVersion: 1, status: 'aborted', transition: aborted })
    })
  })
}

export const switchIndexedDbCompatibilityBranch = async ({
  legacy,
  draft,
  restoreRequest,
  now = Date.now,
  crashInjector,
  lockManager,
}) => {
  assertCanonicalWorkingDraftForLegacySnapshot(draft)
  const normalizedRequest = normalizeRestoreRequest(restoreRequest)
  return requestLegacyIdentityLock({ lockManager }, async () => {
    const target = fenceFromDraft(draft)
    const existing = parseTransition(legacy.readValue(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY))
    if (existing?.status === 'pending') {
      if (!sameFence(existing.target, target) || !sameRestoreRequest(existing.restoreRequest, normalizedRequest)) {
        throw failure(DASHBOARD_STORAGE_ERROR_CODE.generationConflict, 'another-branch-switch-is-already-pending')
      }
      return resumeTransition({
        legacy,
        transition: existing,
        draft,
        now,
        crashInjector,
        lockManager,
        status: 'switched',
      })
    }
    if (existing?.status === 'complete') {
      assertCompletedTransitionStable(legacy, existing)
      if (sameFence(existing.target, target) && sameRestoreRequest(existing.restoreRequest, normalizedRequest)) {
        return Object.freeze({ schemaVersion: 1, status: 'reconciled', transition: existing, draft })
      }
    }
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'prepared-branch-switch-transition-is-missing')
  })
}

export const recoverIndexedDbCompatibilityBranchSwitch = async ({
  legacy,
  ensureRestoreTarget,
  now = Date.now,
  crashInjector,
  lockManager,
}) => {
  if (typeof ensureRestoreTarget !== 'function') {
    throw failure(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, 'branch-switch-recovery-requires-a-target-ensurer')
  }
  return requestLegacyIdentityLock({ lockManager }, async () => {
    const transition = parseTransition(legacy.readValue(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY))
    if (!transition) return Object.freeze({ schemaVersion: 1, status: 'none' })
    if (transition.status === 'complete') {
      assertCompletedTransitionStable(legacy, transition)
      return Object.freeze({ schemaVersion: 1, status: 'stable', transition })
    }
    if (transition.status === 'aborted') {
      assertAbortedTransitionStable(legacy, transition)
      return Object.freeze({ schemaVersion: 1, status: 'aborted', transition })
    }
    assertTransitionSurface(legacy, transition)
    const ensured = await ensureRestoreTarget(transition.restoreRequest)
    const draft = ensured?.draft
    assertCanonicalWorkingDraftForLegacySnapshot(draft)
    if (!sameFence(fenceFromDraft(draft), transition.target)) {
      throw failure(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'branch-switch-target-draft-does-not-match-intent')
    }
    return resumeTransition({
      legacy,
      transition,
      draft,
      now,
      crashInjector,
      lockManager,
      status: 'recovered',
    })
  })
}
