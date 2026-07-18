import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createMaterialGcPlanHashInput,
  createMaterialGcPlanRequestDigestInput,
  createMaterialGcReleaseRequestDigestInput,
  validateMaterialGcPlanRequest,
} from '../shared/material-gc-contract.mjs'
import { createDashboardMutationQuiescenceGate } from '../src/editor/agent/activity/mutation-quiescence-gate.mjs'
import { DashboardMaterialGcClientError } from '../src/editor/agent/capabilities/promotion/material-gc-client.mjs'
import { createDashboardMaterialGcReplicaState } from '../src/editor/agent/capabilities/promotion/material-gc-replica-state.mjs'
import { createDashboardMaterialGcRuntime } from '../src/editor/agent/capabilities/promotion/material-gc-runtime.mjs'

const digest = character => `sha256:${character.repeat(64)}`
const projectId = 'project-a'
const replicaId = '11111111-1111-4111-8111-111111111111'
const rotatedReplicaId = '22222222-2222-4222-8222-222222222222'
const material = Object.freeze({
  materialId: 'material-a',
  materialVersion: '1.0.0',
  buildIntegrity: digest('9'),
})

const hashContractJson = async value => {
  const bytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return `sha256:${Buffer.from(bytes).toString('hex')}`
}

const createStorage = () => {
  const values = new Map()
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

const storageSnapshot = ({ snapshotDigest = digest('a'), generation = 1 } = {}) =>
  Object.freeze({
    schemaVersion: 1,
    projectId,
    generationFence: Object.freeze([{ branchId: 'branch-a', draftGeneration: generation }]),
    sessionGenerationFence: Object.freeze([]),
    rootFence: Object.freeze([]),
    storeFence: Object.freeze([]),
    materialRefs: Object.freeze([]),
    unresolvedPromotionIds: Object.freeze([]),
    snapshotDigest,
  })

const createPlan = async (request, { candidate = null, registryGeneration = 1 } = {}) => {
  const requestDigest = await hashContractJson(createMaterialGcPlanRequestDigestInput(request))
  const placeholder = Object.freeze({
    schemaVersion: 1,
    kind: 'material-gc-plan',
    registryId: digest('b'),
    registryGeneration,
    rootKeyDigest: digest('c'),
    projectId: request.projectId,
    replicaId: request.replicaId,
    replicaGeneration: request.expectedReplicaGeneration + 1,
    requestDigest,
    snapshotDigest: request.snapshotDigest,
    globalRetainedMaterialRefs: Object.freeze([...request.materialRefs]),
    deletionCandidates: Object.freeze(candidate ? [candidate] : []),
    planHash: digest('0'),
  })
  const planHash = await hashContractJson(createMaterialGcPlanHashInput(placeholder))
  return Object.freeze({ ...placeholder, planHash })
}

const createReleaseResult = async request => ({
  schemaVersion: 1,
  status: 'released',
  projectId: request.projectId,
  replicaId: request.replicaId,
  replicaGeneration: request.expectedReplicaGeneration + 1,
  requestDigest: await hashContractJson(createMaterialGcReleaseRequestDigestInput(request)),
  registryGeneration: 2,
})

const createIdleScheduler = () => {
  const queue = []
  return Object.freeze({
    schedule(callback) {
      const entry = { active: true, callback }
      queue.push(entry)
      return () => {
        entry.active = false
      }
    },
    get size() {
      return queue.filter(entry => entry.active).length
    },
    runNext() {
      while (queue.length > 0) {
        const entry = queue.shift()
        if (!entry.active) continue
        entry.active = false
        entry.callback()
        return true
      }
      return false
    },
  })
}

const eventually = async predicate => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('condition was not reached')
}

const createCoordinatorHarness = () => {
  const leases = new Set()
  let externalPresenceCount = 0
  let disposed = false
  return {
    setExternalPresenceCount(value) {
      externalPresenceCount = value
    },
    get activePresenceCount() {
      return leases.size
    },
    async withIdentityExclusive(operation) {
      if (disposed) throw new Error('coordinator disposed')
      return operation(Object.freeze({ name: 'identity', mode: 'exclusive' }))
    },
    async withProjectReplicaExclusive(_scope, operation) {
      if (disposed) throw new Error('coordinator disposed')
      return operation(Object.freeze({ name: 'replica', mode: 'exclusive' }))
    },
    async acquireProjectPresenceLease(scope) {
      if (disposed) throw new Error('coordinator disposed')
      let released = false
      let close
      const closed = new Promise(resolve => {
        close = resolve
      })
      const lease = Object.freeze({
        kind: 'dashboard-material-gc-project-presence-lease',
        projectId: scope.projectId,
        replicaId: scope.replicaId,
        lockName: 'presence',
        get released() {
          return released
        },
        release() {
          if (released) return false
          released = true
          leases.delete(lease)
          close({ status: 'released' })
          return true
        },
        closed,
      })
      leases.add(lease)
      return lease
    },
    async tryWithProjectPresenceExclusive(scope, operation) {
      if (disposed) return { status: 'unavailable', reason: 'coordinator-disposed' }
      if (externalPresenceCount > 0 || leases.size > 0) {
        return { status: 'in-use', projectId: scope.projectId, replicaId: scope.replicaId, lockName: 'presence' }
      }
      return {
        status: 'acquired',
        projectId: scope.projectId,
        replicaId: scope.replicaId,
        lockName: 'presence',
        value: await operation(Object.freeze({ name: 'presence', mode: 'exclusive' })),
      }
    },
    async dispose() {
      if (disposed) return false
      disposed = true
      for (const lease of [...leases]) lease.release()
      return true
    },
  }
}

const createHarness = ({
  snapshots,
  clientOverrides = {},
  mutationGate,
  onPlan,
  persistenceState,
  coordinator,
  randomUUID,
} = {}) => {
  const order = []
  const scheduler = createIdleScheduler()
  const storage = createStorage()
  const crossTabCoordinator = coordinator ?? createCoordinatorHarness()
  let randomUuidCalls = 0
  const replicaState = createDashboardMaterialGcReplicaState({
    storage,
    coordinator: crossTabCoordinator,
    crypto: {
      randomUUID: () => {
        const call = randomUuidCalls
        randomUuidCalls += 1
        return randomUUID ? randomUUID(call) : call === 0 ? replicaId : rotatedReplicaId
      },
      subtle: webcrypto.subtle,
    },
  })
  const state = persistenceState ?? {
    state: 'ready',
    projectId,
    branchId: 'branch-a',
    draftGeneration: 1,
    pendingAutosave: false,
  }
  const snapshotValues = snapshots ?? [storageSnapshot(), storageSnapshot()]
  let snapshotIndex = 0
  let fenceCalls = 0
  let sweepCalls = 0
  let releaseCalls = 0
  const planRequests = []
  const sweepRequests = []
  const humanActivity = {
    generation: 0,
    active: false,
    waitUntilIdle: async () => ({ generation: humanActivity.generation }),
    isActive: () => humanActivity.active,
  }
  const invocationActivity = {
    snapshot: { revision: 0, activeCalls: [] },
    getSnapshot: () => invocationActivity.snapshot,
    subscribe: () => () => {},
  }
  const persistence = {
    getSnapshot: () => ({ ...state }),
    async flush() {
      order.push('flush')
    },
    async withMaterialGcFence(requestProjectId, operation) {
      assert.equal(requestProjectId, projectId)
      fenceCalls += 1
      order.push('fence')
      return operation({
        async readSnapshot() {
          order.push(snapshotIndex % 2 === 0 ? 'snapshot-a' : 'snapshot-b')
          const value = snapshotValues[Math.min(snapshotIndex, snapshotValues.length - 1)]
          snapshotIndex += 1
          return structuredClone(value)
        },
      })
    },
  }
  const client = {
    async planGc(request, options) {
      order.push('plan')
      planRequests.push(structuredClone(request))
      await onPlan?.({ request, options, state, humanActivity, invocationActivity })
      return createPlan(request)
    },
    async sweepGc(request) {
      order.push('sweep')
      sweepCalls += 1
      sweepRequests.push(structuredClone(request))
      return {
        schemaVersion: 1,
        deletedMaterials: [],
        registryGeneration: request.plan.registryGeneration,
        replicaGeneration: request.plan.replicaGeneration,
        planHash: request.plan.planHash,
      }
    },
    async releaseGc(request) {
      order.push('release')
      releaseCalls += 1
      return createReleaseResult(request)
    },
    ...clientOverrides,
  }
  const errors = []
  const gate = mutationGate ?? createDashboardMutationQuiescenceGate()
  const runtime = createDashboardMaterialGcRuntime({
    enabled: true,
    crypto: webcrypto,
    client,
    replicaState,
    coordinator: crossTabCoordinator,
    persistence,
    humanActivity,
    invocationActivity,
    mutationGate: gate,
    scheduleIdle: callback => scheduler.schedule(callback),
    onError: error => errors.push(error),
  })
  return {
    client,
    coordinator: crossTabCoordinator,
    errors,
    get fenceCalls() {
      return fenceCalls
    },
    humanActivity,
    invocationActivity,
    mutationGate: gate,
    order,
    persistenceState: state,
    planRequests,
    replicaState,
    get releaseCalls() {
      return releaseCalls
    },
    runtime,
    scheduler,
    storage,
    sweepRequests,
    get sweepCalls() {
      return sweepCalls
    },
  }
}

test('default-off Material GC has no dependency, storage, network, idle, or timer side effects', async () => {
  let touched = 0
  const options = {
    enabled: false,
    get client() {
      touched += 1
      throw new Error('must stay untouched')
    },
    get persistence() {
      touched += 1
      throw new Error('must stay untouched')
    },
    get scheduleIdle() {
      touched += 1
      throw new Error('must stay untouched')
    },
    get mutationGate() {
      touched += 1
      throw new Error('must stay untouched')
    },
    get coordinator() {
      touched += 1
      throw new Error('must stay untouched')
    },
  }
  const runtime = createDashboardMaterialGcRuntime(options)
  runtime.trigger('startup')
  assert.deepEqual(await runtime.releaseCurrentReplica(), { status: 'disabled' })
  runtime.dispose()
  assert.equal(touched, 0)
  assert.equal(runtime.getSnapshot().status, 'disabled')
})

test('one exclusive cycle preserves flush/A/plan/B/sweep order and uses complete canonical equality', async () => {
  const harness = createHarness()
  harness.runtime.trigger('startup')
  assert.equal(harness.scheduler.size, 1)
  harness.scheduler.runNext()
  const result = await harness.runtime.waitForIdle()
  assert.equal(result.status, 'swept')
  assert.equal(harness.fenceCalls, 1)
  assert.equal(harness.sweepCalls, 1)
  assert.deepEqual(harness.order, ['flush', 'fence', 'snapshot-a', 'plan', 'snapshot-b', 'sweep'])
  assert.equal(harness.mutationGate.getSnapshot().exclusiveActive, false)
})

test('a shared mutation entrant forces retry before the storage fence and cannot form a lock cycle', async () => {
  const mutationGate = createDashboardMutationQuiescenceGate()
  const sharedPending = mutationGate.acquireShared()
  const harness = createHarness({ mutationGate })
  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  await eventually(() => harness.scheduler.size === 1)
  assert.equal(harness.fenceCalls, 0)
  assert.equal(harness.planRequests.length, 0)
  assert.equal(harness.sweepCalls, 0)

  const shared = await sharedPending
  shared.release()
  harness.scheduler.runNext()
  assert.equal((await harness.runtime.waitForIdle()).status, 'swept')
  assert.equal(harness.fenceCalls, 1)
  assert.equal(harness.sweepCalls, 1)
  mutationGate.dispose()
})

test('dispose during an in-flight sweep retains exclusive input and shared blocking until the response settles', async () => {
  const inputTarget = new EventTarget()
  const mutationGate = createDashboardMutationQuiescenceGate({ inputTarget })
  let editorInputCalls = 0
  inputTarget.addEventListener('pointerdown', () => {
    editorInputCalls += 1
  })
  let resolveSweep
  let sweepCalls = 0
  const harness = createHarness({
    mutationGate,
    clientOverrides: {
      sweepGc(request) {
        sweepCalls += 1
        return new Promise(resolve => {
          resolveSweep = () =>
            resolve({
              schemaVersion: 1,
              deletedMaterials: [],
              registryGeneration: request.plan.registryGeneration,
              replicaGeneration: request.plan.replicaGeneration,
              planHash: request.plan.planHash,
            })
        })
      },
    },
  })
  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  await eventually(() => typeof resolveSweep === 'function' && mutationGate.isExclusive())
  assert.equal(sweepCalls, 1)
  assert.equal(inputTarget.dispatchEvent(new Event('pointerdown', { cancelable: true })), false)
  assert.equal(editorInputCalls, 0)
  const queuedSharedOutcome = mutationGate.acquireShared().then(
    () => 'entered',
    error => error,
  )

  harness.runtime.dispose()
  mutationGate.dispose()
  await Promise.resolve()
  assert.equal(mutationGate.getSnapshot().exclusiveActive, true)
  assert.equal(mutationGate.getSnapshot().waitingSharedCount, 1)
  assert.equal(inputTarget.dispatchEvent(new Event('pointerdown', { cancelable: true })), false)
  assert.equal(editorInputCalls, 0)

  resolveSweep()
  const queuedOutcome = await queuedSharedOutcome
  assert.ok(queuedOutcome instanceof Error)
  await eventually(() => mutationGate.getSnapshot().exclusiveActive === false)
  assert.deepEqual(mutationGate.getSnapshot(), {
    schemaVersion: 1,
    disposed: true,
    exclusiveActive: false,
    inputBlocked: false,
    sharedCount: 0,
    waitingSharedCount: 0,
  })
  assert.equal(inputTarget.dispatchEvent(new Event('pointerdown', { cancelable: true })), true)
  assert.equal(editorInputCalls, 1)
})

test('503/retryable sweep preserves and replays one exact durable request until recovery', async () => {
  const requests = []
  let sweepCall = 0
  const mutationGate = createDashboardMutationQuiescenceGate()
  const harness = createHarness({
    mutationGate,
    clientOverrides: {
      async sweepGc(request) {
        requests.push(structuredClone(request))
        sweepCall += 1
        if (sweepCall <= 2) {
          throw new DashboardMaterialGcClientError('gc-unavailable', {
            status: 503,
            retryable: true,
            ambiguous: true,
          })
        }
        return {
          schemaVersion: 1,
          deletedMaterials: [],
          registryGeneration: request.plan.registryGeneration,
          replicaGeneration: request.plan.replicaGeneration,
          planHash: request.plan.planHash,
        }
      },
    },
  })

  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  assert.equal((await harness.runtime.waitForIdle()).status, 'fail-closed')
  assert.equal(sweepCall, 2, 'one cycle performs one exact authoritative replay')
  assert.deepEqual(requests[1], requests[0])
  assert.ok((await harness.replicaState.getProjectState(projectId)).pendingSweepRequest)
  assert.equal(mutationGate.getSnapshot().exclusiveActive, true)
  const queuedShared = mutationGate.acquireShared()

  harness.runtime.trigger('manual-save')
  harness.scheduler.runNext()
  assert.equal((await harness.runtime.waitForIdle()).status, 'swept')
  assert.equal(sweepCall, 3)
  assert.deepEqual(requests[2], requests[0], 'recovery replays the durable exact sweep request')
  assert.equal((await harness.replicaState.getProjectState(projectId)).pendingSweepRequest, null)
  const lease = await queuedShared
  assert.equal(mutationGate.getSnapshot().exclusiveActive, false)
  lease.release()
  harness.runtime.dispose()
  mutationGate.dispose()
})

test('dispose after unresolved ambiguous sweep preserves the terminal exclusive input hold', async () => {
  const inputTarget = new EventTarget()
  const mutationGate = createDashboardMutationQuiescenceGate({ inputTarget })
  let editorInputCalls = 0
  inputTarget.addEventListener('click', () => {
    editorInputCalls += 1
  })
  const harness = createHarness({
    mutationGate,
    clientOverrides: {
      async sweepGc() {
        throw new DashboardMaterialGcClientError('transport-failed', {
          retryable: true,
          ambiguous: true,
        })
      },
    },
  })
  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  assert.equal((await harness.runtime.waitForIdle()).status, 'fail-closed')
  assert.ok((await harness.replicaState.getProjectState(projectId)).pendingSweepRequest)
  assert.equal(mutationGate.getSnapshot().exclusiveActive, true)

  harness.runtime.dispose()
  mutationGate.dispose()
  await Promise.resolve()
  assert.deepEqual(mutationGate.getSnapshot(), {
    schemaVersion: 1,
    disposed: true,
    exclusiveActive: true,
    inputBlocked: true,
    sharedCount: 0,
    waitingSharedCount: 0,
  })
  assert.equal(inputTarget.dispatchEvent(new Event('click', { cancelable: true })), false)
  assert.equal(editorInputCalls, 0)
})

test('restart replays a durable pending sweep before planning a newer snapshot', async () => {
  const harness = createHarness()
  const identity = await harness.replicaState.getProjectIdentity(projectId)
  const request = validateMaterialGcPlanRequest({
    schemaVersion: 1,
    projectId,
    replicaId: identity.replicaId,
    expectedReplicaGeneration: 0,
    snapshotDigest: digest('a'),
    materialRefs: [],
    unresolvedPromotionIds: [],
  })
  const plan = await createPlan(request)
  const sweepRequest = Object.freeze({ schemaVersion: 1, plan })
  await harness.replicaState.stagePlanRequest(request)
  await harness.replicaState.acknowledgePlan(request, plan)
  await harness.replicaState.stageSweepRequest(sweepRequest)

  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  assert.equal((await harness.runtime.waitForIdle()).status, 'swept')
  assert.equal(harness.planRequests.length, 0)
  assert.deepEqual(harness.sweepRequests, [sweepRequest])
  assert.equal((await harness.replicaState.getProjectState(projectId)).pendingSweepRequest, null)
  harness.runtime.dispose()
})

test('503/retryable plan preserves and replays the exact pending request before any newer plan', async () => {
  let planCall = 0
  const harness = createHarness({
    clientOverrides: {
      async planGc(request) {
        harness.order.push('plan')
        harness.planRequests.push(structuredClone(request))
        planCall += 1
        if (planCall === 1) {
          throw new DashboardMaterialGcClientError('gc-unavailable', {
            status: 503,
            retryable: true,
            ambiguous: true,
          })
        }
        return createPlan(request)
      },
    },
  })

  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  assert.equal((await harness.runtime.waitForIdle()).status, 'fail-closed')
  const pending = (await harness.replicaState.getProjectState(projectId)).pendingPlanRequest
  assert.ok(pending)
  assert.deepEqual(pending, harness.planRequests[0], 'the durable pending request must preserve its exact identity')

  harness.runtime.trigger('manual-save')
  harness.scheduler.runNext()
  await eventually(() => planCall === 2 && harness.scheduler.size === 1)
  assert.equal(harness.sweepCalls, 0, 'the ACK replay plan must not be swept')
  assert.deepEqual(harness.planRequests[1], harness.planRequests[0], 'ACK replay must be byte-equivalent JSON')

  harness.scheduler.runNext()
  assert.equal((await harness.runtime.waitForIdle()).status, 'swept')
  assert.equal(harness.sweepCalls, 1)
  assert.equal(harness.planRequests[2].expectedReplicaGeneration, 1)
})

test('same digest with a canonically different B snapshot never sweeps and only schedules one bounded retry', async () => {
  const snapshotA = storageSnapshot({ generation: 1 })
  const snapshotB = storageSnapshot({ generation: 2 })
  const harness = createHarness({ snapshots: [snapshotA, snapshotB] })
  harness.runtime.trigger('manual-save')
  harness.scheduler.runNext()
  await eventually(
    async () =>
      harness.fenceCalls === 1 &&
      (await harness.replicaState.getProjectState(projectId)).replicaGeneration === 1 &&
      harness.scheduler.size === 1,
  )
  assert.equal(harness.sweepCalls, 0)
  assert.equal(harness.fenceCalls, 1)
  harness.runtime.dispose()
  assert.equal(harness.scheduler.size, 0)
})

for (const kind of ['human', 'invocation', 'autosave']) {
  test(`${kind} activity changing across A/plan/B prevents sweep`, async () => {
    const harness = createHarness({
      onPlan: ({ state, humanActivity, invocationActivity }) => {
        if (kind === 'human') {
          humanActivity.generation += 1
          humanActivity.active = true
        } else if (kind === 'invocation') {
          invocationActivity.snapshot = { revision: 1, activeCalls: [{ callId: 'call-a' }] }
        } else {
          state.pendingAutosave = true
        }
      },
    })
    harness.runtime.trigger('promotion-applied')
    harness.scheduler.runNext()
    await eventually(
      async () =>
        harness.fenceCalls === 1 &&
        (await harness.replicaState.getProjectState(projectId)).replicaGeneration === 1 &&
        harness.scheduler.size === 1,
    )
    assert.equal(harness.sweepCalls, 0)
    harness.runtime.dispose()
  })
}

test('definitive server conflict clears only the exact pending request and fails closed without sweep', async () => {
  const harness = createHarness({
    clientOverrides: {
      async planGc() {
        throw new DashboardMaterialGcClientError('gc-replica-generation-conflict', {
          status: 409,
          ambiguous: false,
        })
      },
    },
  })
  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  assert.equal((await harness.runtime.waitForIdle()).status, 'fail-closed')
  assert.equal((await harness.replicaState.getProjectState(projectId)).pendingPlanRequest, null)
  assert.equal(harness.sweepCalls, 0)
})

test('material admission holds one shared mutation lease through plan ACK and invokes Core only afterwards', async () => {
  const harness = createHarness()
  const events = []
  const result = await harness.runtime.withMaterialAdmission(
    { schemaVersion: 1, projectId, materialRefs: [material], unresolvedPromotionIds: [], reason: 'palette-link' },
    receipt => {
      events.push('core')
      assert.equal(receipt.status, 'admitted')
      assert.equal(receipt.materialRefs[0].materialId, material.materialId)
      assert.equal(harness.mutationGate.getSnapshot().sharedCount, 1)
      assert.equal(harness.planRequests.length, 1, 'server ACK must precede Core')
      return 'linked'
    },
  )
  assert.equal(result, 'linked')
  assert.deepEqual(events, ['core'])
  assert.deepEqual(harness.planRequests[0].materialRefs, [material])
  assert.equal(harness.mutationGate.getSnapshot().sharedCount, 0)
  assert.equal(harness.sweepCalls, 0)
  harness.runtime.dispose()
})

test('material admission rejects a crossed project before presence, storage fence, or server authority', async () => {
  const harness = createHarness()
  await assert.rejects(
    harness.runtime.admitMaterialRefsUnderSharedMutation({
      schemaVersion: 1,
      projectId: 'project-b',
      materialRefs: [material],
      reason: 'screen-apply',
    }),
    error => error.code === 'project-mismatch',
  )
  assert.equal(harness.coordinator.activePresenceCount, 0)
  assert.equal(harness.fenceCalls, 0)
  assert.equal(harness.planRequests.length, 0)
  harness.runtime.dispose()
})

test('Host-owned shared mutation authority can call nested admission without local exclusive re-entry', async () => {
  const harness = createHarness()
  const hostLease = await harness.mutationGate.acquireShared()
  assert.equal(harness.mutationGate.getSnapshot().sharedCount, 1)
  const receipt = await harness.runtime.admitMaterialRefsUnderSharedMutation({
    materialRefs: [material],
    reason: 'host-promotion',
  })
  assert.equal(receipt.status, 'admitted')
  assert.equal(harness.mutationGate.getSnapshot().sharedCount, 1)
  assert.equal(harness.mutationGate.getSnapshot().exclusiveActive, false)
  hostLease.release()
  harness.runtime.dispose()
})

test('crossed plan response fails closed with the exact pending admission request still durable', async () => {
  const harness = createHarness({
    clientOverrides: {
      async planGc(request) {
        const crossed = { ...request, materialRefs: [] }
        return createPlan(crossed)
      },
    },
  })
  await assert.rejects(
    harness.runtime.withMaterialAdmission({ materialRefs: [material], reason: 'palette-link' }, () =>
      assert.fail('Core must not run for a crossed plan response'),
    ),
    /digest|exact pending request/u,
  )
  const state = await harness.replicaState.getProjectState(projectId)
  assert.deepEqual(state.pendingPlanRequest.materialRefs, [material])
  assert.deepEqual(state.acceptedMaterialRefs, [])
  harness.runtime.dispose()
})

test('triggers merge into single-flight cycles and disposal aborts in-flight transport without release', async () => {
  let resolvePlan
  let activePlans = 0
  let maximumActivePlans = 0
  const harness = createHarness({
    clientOverrides: {
      async planGc(request, { signal }) {
        activePlans += 1
        maximumActivePlans = Math.max(maximumActivePlans, activePlans)
        try {
          await new Promise((resolve, reject) => {
            resolvePlan = resolve
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
          })
          return createPlan(request)
        } finally {
          activePlans -= 1
        }
      },
    },
  })
  harness.runtime.trigger('startup')
  harness.runtime.trigger('manual-save')
  harness.runtime.trigger('preview-flush')
  assert.equal(harness.scheduler.size, 1)
  harness.scheduler.runNext()
  await eventually(() => typeof resolvePlan === 'function')
  harness.runtime.trigger('promotion-applied')
  assert.equal(harness.scheduler.size, 0)
  harness.runtime.dispose()
  await eventually(() => activePlans === 0)
  assert.equal(maximumActivePlans, 1)
  assert.equal(harness.sweepCalls, 0)
  assert.equal(harness.releaseCalls, 0)
})

test('release is explicit-only, authenticated through the server client, and persists its tombstone', async () => {
  const harness = createHarness()
  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  await harness.runtime.waitForIdle()
  assert.equal(harness.releaseCalls, 0)

  const released = await harness.runtime.releaseCurrentReplica()
  assert.equal(released.status, 'released')
  assert.equal(harness.releaseCalls, 1)
  assert.equal((await harness.replicaState.getProjectState(projectId)).status, 'released')
  const lifecycle = await harness.runtime.beginNewProjectLifecycle()
  assert.equal(lifecycle.status, 'reload-required')
  assert.equal(lifecycle.state.replicaId, rotatedReplicaId)
  await assert.rejects(
    harness.runtime.withMaterialAdmission({ materialRefs: [material], reason: 'terminal-check' }, () => undefined),
    /disposed|terminal/u,
  )
  harness.runtime.trigger('manual-save')
  harness.scheduler.runNext()
  await harness.runtime.waitForIdle()
  assert.equal(harness.releaseCalls, 1)
  harness.runtime.dispose()
  assert.equal(harness.releaseCalls, 1)
})

test('terminal release drops this Tab presence and fails in-use without any server release or mutation reopening', async () => {
  const harness = createHarness()
  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  await harness.runtime.waitForIdle()
  assert.equal(harness.coordinator.activePresenceCount, 1)
  harness.coordinator.setExternalPresenceCount(1)

  const result = await harness.runtime.releaseCurrentReplica()
  assert.deepEqual(result, { status: 'in-use' })
  assert.equal(harness.coordinator.activePresenceCount, 0)
  assert.equal(harness.releaseCalls, 0)
  assert.equal(harness.mutationGate.getSnapshot().disposed, true)
  assert.equal((await harness.replicaState.getProjectState(projectId)).status, 'active')
  await assert.rejects(
    harness.runtime.withMaterialAdmission({ materialRefs: [material], reason: 'terminal-check' }, () => undefined),
    /disposed|terminal/u,
  )
  await assert.rejects(harness.runtime.beginNewProjectLifecycle(), /released project tombstone/u)
  harness.coordinator.setExternalPresenceCount(0)
  const retried = await harness.runtime.releaseCurrentReplica()
  assert.equal(retried.status, 'released')
  assert.equal(harness.releaseCalls, 1)
  assert.equal((await harness.replicaState.getProjectState(projectId)).status, 'released')
  harness.runtime.dispose()
})

test('unavailable Web Locks fail GC and material admission closed without blocking ordinary editor mutation', async () => {
  const unavailable = {
    async withIdentityExclusive() {
      const error = new Error('web-locks-unavailable')
      error.code = 'web-locks-unavailable'
      throw error
    },
    async withProjectReplicaExclusive() {
      throw new Error('must not reach project state lock')
    },
    async acquireProjectPresenceLease() {
      throw new Error('must not acquire presence')
    },
    async tryWithProjectPresenceExclusive() {
      return { status: 'unavailable', reason: 'web-locks-unavailable' }
    },
    async dispose() {
      return true
    },
  }
  const harness = createHarness({ coordinator: unavailable })
  harness.runtime.trigger('startup')
  harness.scheduler.runNext()
  assert.equal((await harness.runtime.waitForIdle()).status, 'fail-closed')
  assert.equal(harness.fenceCalls, 0)
  assert.equal(harness.planRequests.length, 0)
  assert.equal(harness.mutationGate.getSnapshot().exclusiveActive, false)
  const ordinaryEditorLease = await harness.mutationGate.acquireShared()
  ordinaryEditorLease.release()
  await assert.rejects(
    harness.runtime.withMaterialAdmission({ materialRefs: [material], reason: 'palette-link' }, () => undefined),
    /web-locks-unavailable/u,
  )
  harness.runtime.dispose()
})

test('production wiring keeps GC independent/default-off and exposes release only behind explicit confirmation', async () => {
  const [runtimeSource, editorSource, headerSource, featureFlagsSource] = await Promise.all([
    readFile(new URL('../src/editor/runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/editor/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/editor/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/editor/agent/feature-flags.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(runtimeSource, /resolveDashboardMaterialGcEnabled\(import\.meta\.env\)/u)
  assert.match(runtimeSource, /dashboardMaterialGcEnabled\s*\?\s*createDashboardMaterialGcRuntime/u)
  assert.match(runtimeSource, /dashboardMaterialGcEnabled\s*\?\s*createDashboardMutationQuiescenceGate/u)
  assert.match(
    runtimeSource,
    /\.\.\.\(dashboardMaterialGcEnabled[\s\S]+?getMaterialGcState:[\s\S]+?triggerMaterialGc:/u,
  )
  assert.match(editorSource, /dashboardMaterialGcRuntime\.trigger\('startup'\)/u)
  assert.match(runtimeSource, /dashboardMaterialGcRuntime\.trigger\('promotion-applied'\)/u)
  assert.match(headerSource, /dashboardMaterialGcRuntime\.trigger\('manual-save'\)/u)
  assert.match(headerSource, /dashboardMaterialGcRuntime\.trigger\('preview-flush'\)/u)
  assert.match(headerSource, /dashboardMaterialGcEnabled\s*\?/u)
  assert.match(headerSource, /window\.confirm\(/u)
  assert.match(headerSource, /dashboardMaterialGcRuntime\.releaseCurrentReplica\(\)/u)
  assert.doesNotMatch(runtimeSource, /unload.*releaseCurrentReplica|pagehide.*releaseCurrentReplica/su)
  assert.deepEqual(
    [...featureFlagsSource.matchAll(/VITE_DASHBOARD_AGENT_[A-Z]+/gu)].map(match => match[0]),
    [
      'VITE_DASHBOARD_AGENT_RUNTIME',
      'VITE_DASHBOARD_AGENT_DATA',
      'VITE_DASHBOARD_AGENT_ONLINE',
      'VITE_DASHBOARD_AGENT_PROMOTION',
    ],
  )
})
