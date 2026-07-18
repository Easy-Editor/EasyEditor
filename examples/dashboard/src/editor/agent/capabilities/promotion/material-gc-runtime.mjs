import {
  MATERIAL_GC_SCHEMA_VERSION,
  createMaterialGcPlanHashInput,
  createMaterialGcPlanRequestDigestInput,
  createMaterialGcReleaseRequestDigestInput,
  validateMaterialGcPlanRequest,
} from '../../../../../shared/material-gc-contract.mjs'
import { validateMaterialIdentity } from '../../../../../shared/material-promotion-contract.mjs'
import { canonicalJsonStringify } from '../../../../lib/storage/canonical-json.mjs'
import { DashboardMaterialGcClientError } from './material-gc-client.mjs'

const TRIGGERS = new Set(['manual-save', 'preview-flush', 'promotion-applied', 'retry-once', 'startup'])
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u

const bytesToHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

const hashContractJson = async (value, crypto) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return `sha256:${bytesToHex(new Uint8Array(digest))}`
}

const freezeSnapshot = ({ status, projectId = null, triggers = [], failure = null }) =>
  Object.freeze({
    schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
    status,
    projectId,
    triggers: Object.freeze([...triggers].sort()),
    failure: failure ? Object.freeze({ ...failure }) : null,
  })

const disabledSnapshot = freezeSnapshot({ status: 'disabled' })

const disabledRuntime = Object.freeze({
  enabled: false,
  getSnapshot: () => disabledSnapshot,
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Material GC listener must be a function')
    return () => {}
  },
  trigger() {},
  waitForIdle: async () => disabledSnapshot,
  admitMaterialRefsUnderSharedMutation: async () => Object.freeze({ status: 'disabled' }),
  withMaterialAdmission: async (_input, operation) =>
    typeof operation === 'function' ? operation(Object.freeze({ status: 'disabled' })) : undefined,
  releaseCurrentReplica: async () => Object.freeze({ status: 'disabled' }),
  beginNewProjectLifecycle: async () => Object.freeze({ status: 'disabled' }),
  dispose() {},
})

const requireMethod = (value, name, label) => {
  if (!value || typeof value[name] !== 'function') throw new TypeError(`${label}.${name} must be a function`)
  return value[name].bind(value)
}

const abortError = () => new DOMException('Material GC operation was aborted', 'AbortError')

const throwIfAborted = signal => {
  if (signal?.aborted) throw abortError()
}

const raceAbort = (promise, signal) => {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

const defaultScheduleIdle = callback => {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const handle = globalThis.requestIdleCallback(callback, { timeout: 2000 })
    return () => globalThis.cancelIdleCallback?.(handle)
  }
  const handle = setTimeout(callback, 0)
  return () => clearTimeout(handle)
}

const failureOf = error =>
  Object.freeze({
    code:
      typeof error?.code === 'string' && error.code.length > 0
        ? error.code
        : error?.name === 'AbortError'
          ? 'aborted'
          : 'material-gc-failed',
    message: error instanceof Error && error.message.length > 0 ? error.message : 'Material GC failed closed',
    retryable: error?.retryable === true,
  })

const currentPersistenceScope = getPersistenceSnapshot => {
  const snapshot = getPersistenceSnapshot()
  return Object.freeze({
    ready: snapshot?.state === 'ready',
    projectId: typeof snapshot?.projectId === 'string' && snapshot.projectId.length > 0 ? snapshot.projectId : null,
    branchId: typeof snapshot?.branchId === 'string' && snapshot.branchId.length > 0 ? snapshot.branchId : null,
    draftGeneration: Number.isSafeInteger(snapshot?.draftGeneration) ? snapshot.draftGeneration : -1,
    pendingAutosave: snapshot?.pendingAutosave === true,
  })
}

const invocationIsIdle = snapshot =>
  Number.isSafeInteger(snapshot?.revision) && Array.isArray(snapshot.activeCalls) && snapshot.activeCalls.length === 0

const waitForInvocationIdle = ({ getSnapshot, subscribe }, signal) => {
  const initial = getSnapshot()
  if (invocationIsIdle(initial)) return Promise.resolve(initial)
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    let settled = false
    let release = () => {}
    const cleanup = () => {
      release()
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (operation, value) => {
      if (settled) return
      settled = true
      cleanup()
      operation(value)
    }
    const onAbort = () => finish(reject, abortError())
    const check = () => {
      const snapshot = getSnapshot()
      if (invocationIsIdle(snapshot)) finish(resolve, snapshot)
    }
    release = subscribe(check)
    if (settled) release()
    signal?.addEventListener('abort', onAbort, { once: true })
    check()
  })
}

const captureActivityFence = ({ getHumanGeneration, isHumanActivityActive, getInvocationSnapshot }) => {
  const invocation = getInvocationSnapshot()
  return Object.freeze({
    humanGeneration: getHumanGeneration(),
    humanActive: isHumanActivityActive(),
    invocationRevision: invocation.revision,
    invocationActive: !invocationIsIdle(invocation),
  })
}

const sameActivityFence = (left, right) =>
  left.humanActive === false &&
  right.humanActive === false &&
  left.invocationActive === false &&
  right.invocationActive === false &&
  left.humanGeneration === right.humanGeneration &&
  left.invocationRevision === right.invocationRevision

const samePersistenceFence = (left, right) =>
  left.ready &&
  right.ready &&
  !left.pendingAutosave &&
  !right.pendingAutosave &&
  left.projectId === right.projectId &&
  left.branchId === right.branchId &&
  left.draftGeneration === right.draftGeneration

const assertStorageSnapshot = (value, projectId) => {
  if (
    !value ||
    typeof value !== 'object' ||
    value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION ||
    value.projectId !== projectId ||
    typeof value.snapshotDigest !== 'string' ||
    !/^sha256:[\da-f]{64}$/u.test(value.snapshotDigest) ||
    !Array.isArray(value.materialRefs) ||
    !Array.isArray(value.unresolvedPromotionIds)
  ) {
    throw new TypeError('Material GC storage snapshot is invalid')
  }
  canonicalJsonStringify(value)
  return value
}

const assertPlanBinding = async ({ crypto, plan, request }) => {
  if (
    plan.projectId !== request.projectId ||
    plan.replicaId !== request.replicaId ||
    plan.snapshotDigest !== request.snapshotDigest
  ) {
    throw new TypeError('Material GC plan does not match the exact browser snapshot')
  }
  const requestDigest = await hashContractJson(createMaterialGcPlanRequestDigestInput(request), crypto)
  if (plan.requestDigest !== requestDigest) throw new TypeError('Material GC plan request digest is invalid')
  const planHash = await hashContractJson(createMaterialGcPlanHashInput(plan), crypto)
  if (plan.planHash !== planHash) throw new TypeError('Material GC plan hash is invalid')
}

const assertSweepBinding = (result, plan) => {
  if (
    result.planHash !== plan.planHash ||
    result.replicaGeneration !== plan.replicaGeneration ||
    result.registryGeneration < plan.registryGeneration
  ) {
    throw new TypeError('Material GC sweep acknowledgement does not match its plan')
  }
  const candidates = new Set(
    plan.deletionCandidates.map(ref => `${ref.materialId}\0${ref.materialVersion}\0${ref.buildIntegrity}`),
  )
  for (const ref of result.deletedMaterials) {
    if (!candidates.has(`${ref.materialId}\0${ref.materialVersion}\0${ref.buildIntegrity}`)) {
      throw new TypeError('Material GC sweep deleted a material outside the authorized plan')
    }
  }
}

const assertReleaseBinding = async ({ crypto, request, result }) => {
  if (
    result.projectId !== request.projectId ||
    result.replicaId !== request.replicaId ||
    result.replicaGeneration <= request.expectedReplicaGeneration
  ) {
    throw new TypeError('Material GC release acknowledgement does not match the local replica')
  }
  const requestDigest = await hashContractJson(createMaterialGcReleaseRequestDigestInput(request), crypto)
  if (result.requestDigest !== requestDigest) throw new TypeError('Material GC release request digest is invalid')
}

const materialIdentityKey = ref => `${ref.materialId}\0${ref.materialVersion}\0${ref.buildIntegrity}`
const compareMaterialIdentity = (left, right) => materialIdentityKey(left).localeCompare(materialIdentityKey(right))

const mergeMaterialRefs = (...groups) => {
  const refs = new Map()
  for (const group of groups) {
    for (const value of group) {
      const ref = validateMaterialIdentity(value)
      refs.set(materialIdentityKey(ref), ref)
    }
  }
  if (refs.size > 4096) throw new TypeError('Material GC admission materialRefs exceeded its bound')
  return Object.freeze([...refs.values()].sort(compareMaterialIdentity))
}

const mergePromotionIds = (...groups) => {
  const ids = new Set()
  for (const group of groups) {
    if (!Array.isArray(group)) throw new TypeError('Material GC admission promotion ids must be arrays')
    for (const value of group) {
      if (typeof value !== 'string' || !/^sha256:[\da-f]{64}$/u.test(value)) {
        throw new TypeError('Material GC admission promotion id must be a sha256 digest')
      }
      ids.add(value)
    }
  }
  if (ids.size > 4096) throw new TypeError('Material GC admission promotion ids exceeded their bound')
  return Object.freeze([...ids].sort())
}

const normalizeAdmissionInput = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Material GC admission input must be an object')
  }
  const fields = Object.keys(value).sort()
  const allowed = ['materialRefs', 'projectId', 'reason', 'schemaVersion', 'unresolvedPromotionIds']
  if (
    fields.some(field => !allowed.includes(field)) ||
    !fields.includes('materialRefs') ||
    !fields.includes('reason')
  ) {
    throw new TypeError('Material GC admission input fields are invalid')
  }
  if (typeof value.reason !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(value.reason)) {
    throw new TypeError('Material GC admission reason is invalid')
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION) {
    throw new TypeError('Material GC admission schemaVersion is unsupported')
  }
  if (value.projectId !== undefined && !PROJECT_ID_PATTERN.test(value.projectId)) {
    throw new TypeError('Material GC admission projectId is invalid')
  }
  return Object.freeze({
    materialRefs: mergeMaterialRefs(value.materialRefs),
    unresolvedPromotionIds: mergePromotionIds(value.unresolvedPromotionIds ?? []),
    projectId: value.projectId ?? null,
    reason: value.reason,
  })
}

export class DashboardMaterialGcAdmissionError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'DashboardMaterialGcAdmissionError'
    this.code = code
  }
}

const admissionError = (code, message, cause) =>
  new DashboardMaterialGcAdmissionError(code, message, cause === undefined ? undefined : { cause })

export const createDashboardMaterialGcRuntime = options => {
  if (options?.enabled !== true) return disabledRuntime

  const crypto = options.crypto
  if (!crypto?.subtle || typeof crypto.subtle.digest !== 'function') {
    throw new TypeError('Material GC runtime requires WebCrypto SHA-256')
  }
  const client = options.client
  const planGc = requireMethod(client, 'planGc', 'client')
  const sweepGc = requireMethod(client, 'sweepGc', 'client')
  const releaseGc = requireMethod(client, 'releaseGc', 'client')
  const replicaState = options.replicaState
  const getProjectIdentity = requireMethod(replicaState, 'getProjectIdentity', 'replicaState')
  const withProjectTransaction = requireMethod(replicaState, 'withProjectTransaction', 'replicaState')
  const beginProjectLifecycle = requireMethod(replicaState, 'beginNewProjectLifecycle', 'replicaState')
  const coordinator = options.coordinator
  const acquireProjectPresenceLease = requireMethod(coordinator, 'acquireProjectPresenceLease', 'coordinator')
  const tryWithProjectPresenceExclusive = requireMethod(coordinator, 'tryWithProjectPresenceExclusive', 'coordinator')
  const disposeCoordinator = requireMethod(coordinator, 'dispose', 'coordinator')
  const persistence = options.persistence
  const getPersistenceSnapshot = requireMethod(persistence, 'getSnapshot', 'persistence')
  const flushPersistence = requireMethod(persistence, 'flush', 'persistence')
  const withMaterialGcFence = requireMethod(persistence, 'withMaterialGcFence', 'persistence')
  const humanActivity = options.humanActivity
  const waitUntilHumanIdle = requireMethod(humanActivity, 'waitUntilIdle', 'humanActivity')
  const isHumanActivityActive = requireMethod(humanActivity, 'isActive', 'humanActivity')
  const getHumanGeneration = () => humanActivity.generation
  if (!Number.isSafeInteger(getHumanGeneration())) {
    throw new TypeError('humanActivity.generation must be a safe integer')
  }
  const invocationActivity = options.invocationActivity
  const getInvocationSnapshot = requireMethod(invocationActivity, 'getSnapshot', 'invocationActivity')
  const subscribeInvocation = requireMethod(invocationActivity, 'subscribe', 'invocationActivity')
  const mutationGate = options.mutationGate
  const acquireMutationShared = requireMethod(mutationGate, 'acquireShared', 'mutationGate')
  const tryAcquireMutationExclusive = requireMethod(mutationGate, 'tryAcquireExclusive', 'mutationGate')
  const disposeMutationGate = requireMethod(mutationGate, 'dispose', 'mutationGate')
  const scheduleIdle = options.scheduleIdle ?? defaultScheduleIdle
  if (typeof scheduleIdle !== 'function') throw new TypeError('scheduleIdle must be a function')
  const onError = options.onError ?? (() => undefined)
  if (typeof onError !== 'function') throw new TypeError('onError must be a function')

  const listeners = new Set()
  const idleWaiters = new Set()
  const queuedTriggers = new Set()
  let snapshot = freezeSnapshot({ status: 'idle' })
  let disposed = false
  let terminal = false
  let idleCancellation = null
  let activeController = null
  let activeRun = null
  let releaseInProgress = false
  let releasePromise = null
  let retryQueued = false
  let retainedMutationLease = null
  let presenceLease = null
  let presenceAcquisition = null

  const publish = next => {
    if (disposed || snapshot === next) return
    snapshot = next
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // Observers cannot affect GC authority or transitions.
      }
    }
  }

  const report = error => {
    try {
      onError(error)
    } catch {
      // Reporting cannot reactivate a failed authority operation.
    }
  }

  const settleIdleWaiters = () => {
    if (activeRun || idleCancellation || queuedTriggers.size > 0) return
    for (const resolve of idleWaiters) resolve(snapshot)
    idleWaiters.clear()
  }

  const waitForActivityIdle = async signal => {
    await raceAbort(waitUntilHumanIdle(), signal)
    await waitForInvocationIdle({ getSnapshot: getInvocationSnapshot, subscribe: subscribeInvocation }, signal)
    throwIfAborted(signal)
  }

  const releasePresence = async () => {
    const lease = presenceLease
    presenceLease = null
    if (!lease) return false
    lease.release()
    await lease.closed
    return true
  }

  const ensurePresence = async (projectId, signal) => {
    if (disposed || terminal) throw admissionError('terminal', 'Material GC project lifecycle is closed')
    const identity = await getProjectIdentity(projectId, signal ? { signal } : undefined)
    if (
      presenceLease &&
      !presenceLease.released &&
      presenceLease.projectId === projectId &&
      presenceLease.replicaId === identity.replicaId
    ) {
      return Object.freeze({ identity, lease: presenceLease })
    }
    const key = `${projectId}\0${identity.replicaId}`
    if (presenceAcquisition?.key === key) return presenceAcquisition.promise
    if (presenceLease) await releasePresence()
    const promise = acquireProjectPresenceLease(
      { projectId, replicaId: identity.replicaId },
      signal ? { signal } : undefined,
    ).then(async lease => {
      if (disposed || terminal) {
        lease.release()
        await lease.closed
        throw admissionError('terminal', 'Material GC project lifecycle closed during presence acquisition')
      }
      presenceLease = lease
      return Object.freeze({ identity, lease })
    })
    presenceAcquisition = { key, promise }
    try {
      return await promise
    } finally {
      if (presenceAcquisition?.promise === promise) presenceAcquisition = null
    }
  }

  const requestPlan = async (transaction, requestValue, signal) => {
    const request = validateMaterialGcPlanRequest(requestValue)
    try {
      const plan = await planGc(request, { signal })
      await assertPlanBinding({ crypto, plan, request })
      const state = await transaction.acknowledgePlan(request, plan)
      return Object.freeze({ plan, state })
    } catch (error) {
      if (error instanceof DashboardMaterialGcClientError && error.ambiguous !== true) {
        transaction.clearPendingPlan(request)
      }
      throw error
    }
  }

  const retainMutationAuthority = lease => {
    if (retainedMutationLease && retainedMutationLease !== lease) {
      throw new Error('Material GC cannot replace retained mutation authority')
    }
    retainedMutationLease = lease
  }

  const requestSweep = async (transaction, request, mutationLease) => {
    let ambiguitySeen = false
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const sweep = await sweepGc(request)
        assertSweepBinding(sweep, request.plan)
        await transaction.acknowledgeSweep(request, sweep)
        if (retainedMutationLease === mutationLease) retainedMutationLease = null
        return sweep
      } catch (error) {
        const definitive = error instanceof DashboardMaterialGcClientError && error.ambiguous !== true
        if (definitive && !ambiguitySeen) {
          transaction.clearPendingSweep(request)
          throw error
        }
        ambiguitySeen = true
        if (attempt === 0) continue
        retainMutationAuthority(mutationLease)
        throw error
      }
    }
    throw new Error('Material GC sweep replay exhausted unexpectedly')
  }

  const releaseMutationAuthority = lease => {
    if (retainedMutationLease === lease) return false
    return lease.release()
  }

  const executeCycle = async (projectId, triggers, signal) => {
    await raceAbort(flushPersistence(), signal)
    await waitForActivityIdle(signal)
    await ensurePresence(projectId, signal)
    throwIfAborted(signal)
    const mutationLease = retainedMutationLease ?? tryAcquireMutationExclusive()
    if (!mutationLease) return Object.freeze({ status: 'retry', projectId, triggers })
    try {
      const persistenceBeforeStorageFence = currentPersistenceScope(getPersistenceSnapshot)
      const activityBeforeStorageFence = captureActivityFence({
        getHumanGeneration,
        isHumanActivityActive,
        getInvocationSnapshot,
      })
      if (
        !persistenceBeforeStorageFence.ready ||
        persistenceBeforeStorageFence.projectId !== projectId ||
        persistenceBeforeStorageFence.pendingAutosave ||
        activityBeforeStorageFence.humanActive ||
        activityBeforeStorageFence.invocationActive
      ) {
        return Object.freeze({ status: 'retry', projectId, triggers })
      }

      const result = await withMaterialGcFence(projectId, async context =>
        withProjectTransaction(
          projectId,
          async transaction => {
            const persistenceFenceA = currentPersistenceScope(getPersistenceSnapshot)
            const activityFenceA = captureActivityFence({
              getHumanGeneration,
              isHumanActivityActive,
              getInvocationSnapshot,
            })
            if (
              !samePersistenceFence(persistenceBeforeStorageFence, persistenceFenceA) ||
              !sameActivityFence(activityBeforeStorageFence, activityFenceA)
            ) {
              return Object.freeze({ status: 'retry', projectId, triggers })
            }

            let localState = transaction.getProjectState()
            if (localState.status === 'released') {
              return Object.freeze({ status: 'released', projectId, triggers })
            }
            if (localState.pendingSweepRequest !== null) {
              const sweep = await requestSweep(transaction, localState.pendingSweepRequest, mutationLease)
              return Object.freeze({ status: 'swept', projectId, triggers, sweep, replayed: true })
            }
            if (localState.pendingPlanRequest !== null) {
              const pending = localState.pendingPlanRequest
              await requestPlan(transaction, pending, signal)
              return Object.freeze({ status: 'replayed-plan', projectId, triggers })
            }

            const snapshotA = assertStorageSnapshot(await context.readSnapshot(), projectId)
            const request = validateMaterialGcPlanRequest({
              schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
              projectId,
              replicaId: localState.replicaId,
              expectedReplicaGeneration: localState.replicaGeneration,
              snapshotDigest: snapshotA.snapshotDigest,
              materialRefs: mergeMaterialRefs(localState.acceptedMaterialRefs, snapshotA.materialRefs),
              unresolvedPromotionIds: snapshotA.unresolvedPromotionIds,
            })
            transaction.stagePlanRequest(request)
            const acknowledged = await requestPlan(transaction, request, signal)
            const { plan } = acknowledged
            localState = acknowledged.state
            if (
              localState.replicaGeneration !== plan.replicaGeneration ||
              localState.snapshotDigest !== snapshotA.snapshotDigest
            ) {
              throw new TypeError('Material GC acknowledgement was not persisted exactly')
            }

            const snapshotB = assertStorageSnapshot(await context.readSnapshot(), projectId)
            const persistenceFenceB = currentPersistenceScope(getPersistenceSnapshot)
            const activityFenceB = captureActivityFence({
              getHumanGeneration,
              isHumanActivityActive,
              getInvocationSnapshot,
            })
            const stableStorageSnapshot =
              snapshotA.snapshotDigest === snapshotB.snapshotDigest &&
              canonicalJsonStringify(snapshotA) === canonicalJsonStringify(snapshotB)
            if (
              !stableStorageSnapshot ||
              !samePersistenceFence(persistenceFenceA, persistenceFenceB) ||
              !sameActivityFence(activityFenceA, activityFenceB)
            ) {
              return Object.freeze({ status: 'retry', projectId, triggers })
            }

            throwIfAborted(signal)
            const sweepRequest = Object.freeze({ schemaVersion: MATERIAL_GC_SCHEMA_VERSION, plan })
            transaction.stageSweepRequest(sweepRequest)
            const sweep = await requestSweep(transaction, sweepRequest, mutationLease)
            return Object.freeze({ status: 'swept', projectId, triggers, sweep })
          },
          { signal },
        ),
      )
      if (result.status === 'released') {
        terminal = true
        disposeMutationGate()
        await releasePresence()
        if (retainedMutationLease === mutationLease) retainedMutationLease = null
      }
      return result
    } finally {
      releaseMutationAuthority(mutationLease)
    }
  }

  const admitMaterialRefsUnderSharedMutation = async inputValue => {
    const input = normalizeAdmissionInput(inputValue)
    if (disposed || terminal) throw admissionError('terminal', 'Material GC admission is terminally closed')
    const scope = currentPersistenceScope(getPersistenceSnapshot)
    if (!scope.ready || scope.projectId === null || scope.pendingAutosave) {
      throw admissionError('persistence-unavailable', 'Material GC admission requires a ready durable project')
    }
    if (input.projectId !== null && input.projectId !== scope.projectId) {
      throw admissionError('project-mismatch', 'Material GC admission project does not match the durable project')
    }
    await ensurePresence(scope.projectId)
    return withMaterialGcFence(scope.projectId, async context => {
      const durableSnapshot = assertStorageSnapshot(await context.readSnapshot(), scope.projectId)
      return withProjectTransaction(scope.projectId, async transaction => {
        let state = transaction.getProjectState()
        if (state.status === 'released') throw admissionError('replica-released', 'Material GC replica was released')
        if (state.pendingSweepRequest !== null) {
          throw admissionError('pending-sweep', 'Material GC admission is blocked by an unresolved sweep')
        }
        if (state.pendingPlanRequest !== null) {
          await requestPlan(transaction, state.pendingPlanRequest)
          state = transaction.getProjectState()
        }
        const materialRefs = mergeMaterialRefs(
          state.acceptedMaterialRefs,
          durableSnapshot.materialRefs,
          input.materialRefs,
        )
        const request = validateMaterialGcPlanRequest({
          schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
          projectId: scope.projectId,
          replicaId: state.replicaId,
          expectedReplicaGeneration: state.replicaGeneration,
          snapshotDigest: durableSnapshot.snapshotDigest,
          materialRefs,
          unresolvedPromotionIds: mergePromotionIds(
            durableSnapshot.unresolvedPromotionIds,
            input.unresolvedPromotionIds,
          ),
        })
        transaction.stagePlanRequest(request)
        const { plan, state: acknowledged } = await requestPlan(transaction, request)
        const retainedKeys = new Set(plan.globalRetainedMaterialRefs.map(materialIdentityKey))
        const deletionKeys = new Set(plan.deletionCandidates.map(materialIdentityKey))
        for (const ref of input.materialRefs) {
          const key = materialIdentityKey(ref)
          if (!retainedKeys.has(key) || deletionKeys.has(key)) {
            throw admissionError('admission-rejected', 'Material GC plan did not retain the admitted material')
          }
        }
        return Object.freeze({
          schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
          status: 'admitted',
          reason: input.reason,
          projectId: scope.projectId,
          replicaId: acknowledged.replicaId,
          replicaGeneration: acknowledged.replicaGeneration,
          snapshotDigest: acknowledged.snapshotDigest,
          materialRefs: input.materialRefs,
        })
      })
    })
  }

  const withMaterialAdmission = async (input, operation) => {
    if (typeof operation !== 'function') throw new TypeError('Material GC admission operation must be a function')
    const lease = await acquireMutationShared()
    try {
      const receipt = await admitMaterialRefsUnderSharedMutation(input)
      return await operation(receipt)
    } finally {
      lease.release()
    }
  }

  const schedule = () => {
    if (disposed || terminal || idleCancellation || activeRun || queuedTriggers.size === 0) return
    publish(
      freezeSnapshot({
        status: 'scheduled',
        projectId: currentPersistenceScope(getPersistenceSnapshot).projectId,
        triggers: queuedTriggers,
      }),
    )
    idleCancellation = scheduleIdle(() => {
      idleCancellation = null
      const triggers = Object.freeze([...queuedTriggers])
      queuedTriggers.clear()
      retryQueued = triggers.includes('retry-once')
      const scope = currentPersistenceScope(getPersistenceSnapshot)
      if (!scope.ready || scope.projectId === null) {
        publish(freezeSnapshot({ status: 'idle', triggers }))
        settleIdleWaiters()
        return
      }

      const controller = new AbortController()
      activeController = controller
      publish(freezeSnapshot({ status: 'running', projectId: scope.projectId, triggers }))
      const run = executeCycle(scope.projectId, triggers, controller.signal)
      activeRun = run
      void run
        .then(result => {
          if (disposed) return
          if (result.status === 'retry' || result.status === 'replayed-plan') {
            if (!retryQueued) queuedTriggers.add('retry-once')
          }
          publish(freezeSnapshot({ status: result.status, projectId: result.projectId, triggers }))
        })
        .catch(error => {
          if (disposed || error?.name === 'AbortError') return
          const failure = failureOf(error)
          publish(freezeSnapshot({ status: 'fail-closed', projectId: scope.projectId, triggers, failure }))
          report(error)
        })
        .finally(() => {
          if (activeController === controller) activeController = null
          if (activeRun === run) activeRun = null
          retryQueued = false
          if (queuedTriggers.size > 0) schedule()
          else settleIdleWaiters()
        })
    })
  }

  const stopScheduled = () => {
    idleCancellation?.()
    idleCancellation = null
  }

  const performRelease = async () => {
    if (disposed) return Object.freeze({ status: 'disposed' })
    releaseInProgress = true
    try {
      stopScheduled()
      queuedTriggers.clear()
      activeController?.abort()
      if (activeRun) {
        try {
          await activeRun
        } catch {
          // The explicit terminal release owns the next serialized authority attempt.
        }
      }
      const scope = currentPersistenceScope(getPersistenceSnapshot)
      if (!scope.ready || scope.projectId === null) return Object.freeze({ status: 'unavailable' })
      const identity = terminal
        ? await getProjectIdentity(scope.projectId)
        : (await ensurePresence(scope.projectId)).identity
      const controller = new AbortController()
      activeController = controller
      publish(freezeSnapshot({ status: 'running', projectId: scope.projectId, triggers: ['explicit-release'] }))
      const run = async () => {
        await raceAbort(flushPersistence(), controller.signal)
        await waitForActivityIdle(controller.signal)
        throwIfAborted(controller.signal)
        const mutationLease = retainedMutationLease ?? tryAcquireMutationExclusive()
        if (!mutationLease) return Object.freeze({ status: 'retry' })
        terminal = true
        retainMutationAuthority(mutationLease)
        disposeMutationGate()
        await releasePresence()
        try {
          const persistenceBeforeStorageFence = currentPersistenceScope(getPersistenceSnapshot)
          const activityBeforeStorageFence = captureActivityFence({
            getHumanGeneration,
            isHumanActivityActive,
            getInvocationSnapshot,
          })
          if (
            !persistenceBeforeStorageFence.ready ||
            persistenceBeforeStorageFence.projectId !== scope.projectId ||
            persistenceBeforeStorageFence.pendingAutosave ||
            activityBeforeStorageFence.humanActive ||
            activityBeforeStorageFence.invocationActive
          ) {
            return Object.freeze({ status: 'retry' })
          }
          const exclusive = await tryWithProjectPresenceExclusive(
            { projectId: scope.projectId, replicaId: identity.replicaId },
            () =>
              withMaterialGcFence(scope.projectId, () =>
                withProjectTransaction(scope.projectId, async transaction => {
                  const persistenceFence = currentPersistenceScope(getPersistenceSnapshot)
                  const activityFence = captureActivityFence({
                    getHumanGeneration,
                    isHumanActivityActive,
                    getInvocationSnapshot,
                  })
                  if (
                    !samePersistenceFence(persistenceBeforeStorageFence, persistenceFence) ||
                    !sameActivityFence(activityBeforeStorageFence, activityFence)
                  ) {
                    return Object.freeze({ status: 'retry' })
                  }
                  let state = transaction.getProjectState()
                  if (state.status === 'released') return Object.freeze({ status: 'already-released' })
                  if (state.pendingSweepRequest !== null) {
                    await requestSweep(transaction, state.pendingSweepRequest, mutationLease)
                    state = transaction.getProjectState()
                  }
                  if (state.pendingPlanRequest !== null) {
                    await requestPlan(transaction, state.pendingPlanRequest, controller.signal)
                    state = transaction.getProjectState()
                  }
                  if (state.replicaGeneration <= 0 || state.snapshotDigest === null) {
                    return Object.freeze({ status: 'not-registered' })
                  }
                  const request = Object.freeze({
                    schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
                    projectId: state.projectId,
                    replicaId: state.replicaId,
                    expectedReplicaGeneration: state.replicaGeneration,
                    snapshotDigest: state.snapshotDigest,
                  })
                  const releaseResult = await releaseGc(request)
                  await assertReleaseBinding({ crypto, request, result: releaseResult })
                  await transaction.commitRelease(request, releaseResult)
                  return Object.freeze({ status: 'released', result: releaseResult })
                }),
              ),
          )
          if (exclusive.status === 'acquired') return exclusive.value
          if (exclusive.status === 'in-use') return Object.freeze({ status: 'in-use' })
          return Object.freeze({ status: 'unavailable', reason: exclusive.reason })
        } finally {
          releaseMutationAuthority(mutationLease)
        }
      }
      const operation = run()
      activeRun = operation
      try {
        const result = await operation
        if ((result.status === 'released' || result.status === 'already-released') && retainedMutationLease !== null) {
          const lease = retainedMutationLease
          retainedMutationLease = null
          lease.release()
        }
        publish(freezeSnapshot({ status: result.status, projectId: scope.projectId, triggers: ['explicit-release'] }))
        return result
      } catch (error) {
        if (error?.name !== 'AbortError') {
          const failure = failureOf(error)
          publish(
            freezeSnapshot({
              status: 'fail-closed',
              projectId: scope.projectId,
              triggers: ['explicit-release'],
              failure,
            }),
          )
          report(error)
        }
        throw error
      } finally {
        if (activeController === controller) activeController = null
        if (activeRun === operation) activeRun = null
      }
    } finally {
      releaseInProgress = false
      settleIdleWaiters()
    }
  }

  const releaseCurrentReplica = () => {
    if (releasePromise) return releasePromise
    const operation = performRelease()
    releasePromise = operation
    const clear = () => {
      if (releasePromise === operation) releasePromise = null
    }
    void operation.then(clear, clear)
    return operation
  }

  const beginNewProjectLifecycle = async () => {
    if (disposed) return Object.freeze({ status: 'disposed' })
    if (!terminal) throw admissionError('not-terminal', 'A new Material GC lifecycle requires terminal release')
    const scope = currentPersistenceScope(getPersistenceSnapshot)
    if (!scope.ready || scope.projectId === null) return Object.freeze({ status: 'unavailable' })
    const state = await beginProjectLifecycle(scope.projectId)
    return Object.freeze({ status: 'reload-required', state })
  }

  return Object.freeze({
    enabled: true,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Material GC listener must be a function')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    trigger(trigger) {
      if (disposed || terminal || releaseInProgress) return
      if (!TRIGGERS.has(trigger)) throw new TypeError('Material GC trigger is invalid')
      queuedTriggers.add(trigger)
      schedule()
    },
    waitForIdle() {
      if (!activeRun && !idleCancellation && queuedTriggers.size === 0) return Promise.resolve(snapshot)
      return new Promise(resolve => idleWaiters.add(resolve))
    },
    admitMaterialRefsUnderSharedMutation,
    withMaterialAdmission,
    releaseCurrentReplica,
    beginNewProjectLifecycle,
    dispose() {
      if (disposed) return
      disposed = true
      stopScheduled()
      queuedTriggers.clear()
      activeController?.abort()
      activeController = null
      snapshot = freezeSnapshot({ status: 'disposed' })
      listeners.clear()
      for (const resolve of idleWaiters) resolve(snapshot)
      idleWaiters.clear()
      void releasePresence().finally(() => disposeCoordinator())
    },
  })
}
