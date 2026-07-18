import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'

import {
  createMaterialGcPlanHashInput,
  createMaterialGcPlanRequestDigestInput,
  createMaterialGcReleaseRequestDigestInput,
} from '../shared/material-gc-contract.mjs'
import { createDashboardMaterialGcCrossTabCoordinator } from '../src/editor/agent/capabilities/promotion/material-gc-cross-tab-coordinator.mjs'
import {
  DASHBOARD_MATERIAL_GC_PROJECT_STORAGE_PREFIX,
  DASHBOARD_MATERIAL_GC_REPLICA_STORAGE_KEY,
  DashboardMaterialGcReplicaStateError,
  createDashboardMaterialGcReplicaState,
  resolveDashboardMaterialGcEnabled,
} from '../src/editor/agent/capabilities/promotion/material-gc-replica-state.mjs'

const digest = character => `sha256:${character.repeat(64)}`
const replicaId = '11111111-1111-4111-8111-111111111111'
const rotatedReplicaId = '22222222-2222-4222-8222-222222222222'
const otherProjectReplicaId = '33333333-3333-4333-8333-333333333333'
const projectId = 'project-a'
const material = Object.freeze({
  materialId: 'material-a',
  materialVersion: '1.0.0',
  buildIntegrity: digest('9'),
})
const otherMaterial = Object.freeze({
  materialId: 'material-b',
  materialVersion: '1.0.0',
  buildIntegrity: digest('8'),
})

const createStorage = entries => {
  const values = new Map(entries)
  const calls = []
  return {
    calls,
    values,
    getItem(key) {
      calls.push(['get', key])
      return values.get(key) ?? null
    },
    setItem(key, value) {
      calls.push(['set', key, value])
      values.set(key, value)
    },
  }
}

class LockManagerHarness {
  #tails = new Map()

  request(name, _options, operation) {
    const previous = this.#tails.get(name) ?? Promise.resolve()
    let release
    const tail = new Promise(resolve => {
      release = resolve
    })
    this.#tails.set(name, tail)
    return previous
      .then(() => operation(Object.freeze({ name, mode: 'exclusive' })))
      .finally(() => {
        release()
        if (this.#tails.get(name) === tail) this.#tails.delete(name)
      })
  }
}

const createCoordinator = lockManager =>
  createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager: lockManager ?? new LockManagerHarness() })

const createState = (storage, coordinator = createCoordinator(), randomUUID = () => replicaId) =>
  createDashboardMaterialGcReplicaState({
    storage,
    coordinator,
    crypto: { randomUUID, subtle: webcrypto.subtle },
  })

const planRequest = (expectedReplicaGeneration = 0, snapshotDigest = digest('a'), materialRefs = []) => ({
  schemaVersion: 1,
  projectId,
  replicaId,
  expectedReplicaGeneration,
  snapshotDigest,
  materialRefs,
  unresolvedPromotionIds: [],
})

const hashContractJson = async value => {
  const bytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return `sha256:${Buffer.from(bytes).toString('hex')}`
}

const planFor = async request => {
  const placeholder = {
    schemaVersion: 1,
    kind: 'material-gc-plan',
    registryId: digest('b'),
    registryGeneration: 1,
    rootKeyDigest: digest('c'),
    projectId: request.projectId,
    replicaId: request.replicaId,
    replicaGeneration: request.expectedReplicaGeneration + 1,
    requestDigest: await hashContractJson(createMaterialGcPlanRequestDigestInput(request)),
    snapshotDigest: request.snapshotDigest,
    globalRetainedMaterialRefs: request.materialRefs,
    deletionCandidates: [],
    planHash: digest('0'),
  }
  return Object.freeze({
    ...placeholder,
    planHash: await hashContractJson(createMaterialGcPlanHashInput(placeholder)),
  })
}

const sweepRequestFor = plan => ({ schemaVersion: 1, plan })

const sweepResultFor = plan => ({
  schemaVersion: 1,
  deletedMaterials: [],
  registryGeneration: plan.registryGeneration,
  replicaGeneration: plan.replicaGeneration,
  planHash: plan.planHash,
})

test('Material GC flag is independent and strict', () => {
  assert.equal(resolveDashboardMaterialGcEnabled({}), false)
  assert.equal(resolveDashboardMaterialGcEnabled({ VITE_DASHBOARD_AGENT_RUNTIME: '1' }), false)
  assert.equal(resolveDashboardMaterialGcEnabled({ VITE_DASHBOARD_MATERIAL_GC: '1' }), true)
  assert.equal(resolveDashboardMaterialGcEnabled({ VITE_DASHBOARD_MATERIAL_GC: 'true' }), true)
  assert.equal(resolveDashboardMaterialGcEnabled({ VITE_DASHBOARD_MATERIAL_GC: true }), true)
  assert.equal(resolveDashboardMaterialGcEnabled({ VITE_DASHBOARD_MATERIAL_GC: 'yes' }), false)
})

test('replica identity and v2 project state are durable through coordinator-owned async transactions', async () => {
  const storage = createStorage()
  const coordinator = createCoordinator()
  const first = createState(storage, coordinator)
  const initial = await first.getProjectState(projectId)
  assert.equal(initial.stateVersion, 2)
  assert.equal(initial.replicaId, replicaId)
  assert.equal(initial.replicaGeneration, 0)
  assert.deepEqual(initial.acceptedMaterialRefs, [])
  assert.equal(initial.pendingPlanRequest, null)
  assert.equal(initial.pendingSweepRequest, null)

  const request = planRequest(0, digest('a'), [material])
  await first.stagePlanRequest(request)
  const acknowledged = await first.acknowledgePlan(request, await planFor(request))
  assert.equal(acknowledged.replicaGeneration, 1)
  assert.equal(acknowledged.snapshotDigest, request.snapshotDigest)
  assert.deepEqual(acknowledged.acceptedMaterialRefs, [material])

  const second = createState(storage, coordinator)
  assert.equal((await second.getProjectIdentity(projectId)).replicaId, replicaId)
  assert.deepEqual(await second.getProjectState(projectId), acknowledged)
  assert.ok(!storage.values.has(DASHBOARD_MATERIAL_GC_REPLICA_STORAGE_KEY))
  assert.ok(storage.values.has(`${DASHBOARD_MATERIAL_GC_PROJECT_STORAGE_PREFIX}${projectId}`))
  await coordinator.dispose()
})

test('legacy v1 project state migrates in place under the project-replica lock', async () => {
  const key = `${DASHBOARD_MATERIAL_GC_PROJECT_STORAGE_PREFIX}${projectId}`
  const storage = createStorage([
    [DASHBOARD_MATERIAL_GC_REPLICA_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, replicaId })],
    [
      key,
      JSON.stringify({
        schemaVersion: 1,
        projectId,
        replicaId,
        replicaGeneration: 1,
        snapshotDigest: digest('a'),
        pendingPlanRequest: null,
        status: 'active',
      }),
    ],
  ])
  const coordinator = createCoordinator()
  const state = createState(storage, coordinator)
  const migrated = await state.getProjectState(projectId)
  assert.equal(migrated.stateVersion, 2)
  assert.deepEqual(migrated.acceptedMaterialRefs, [])
  assert.equal(migrated.pendingSweepRequest, null)
  assert.deepEqual(JSON.parse(storage.values.get(key)), migrated)
  await coordinator.dispose()
})

test('one project transaction holds the cross-tab lock across async authority and prevents lost updates', async () => {
  const storage = createStorage()
  const lockManager = new LockManagerHarness()
  const coordinatorA = createCoordinator(lockManager)
  const coordinatorB = createCoordinator(lockManager)
  const stateA = createState(storage, coordinatorA)
  const stateB = createState(storage, coordinatorB)
  let releaseFirst
  let firstEntered
  const entered = new Promise(resolve => {
    firstEntered = resolve
  })
  const blocked = new Promise(resolve => {
    releaseFirst = resolve
  })
  const events = []

  const first = stateA.withProjectTransaction(projectId, async transaction => {
    events.push('a-enter')
    firstEntered()
    await blocked
    events.push('a-exit')
    return transaction.getProjectState()
  })
  await entered
  const second = stateB.withProjectTransaction(projectId, transaction => {
    events.push('b-enter')
    return transaction.getProjectState()
  })
  await Promise.resolve()
  assert.deepEqual(events, ['a-enter'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['a-enter', 'a-exit', 'b-enter'])
  await Promise.all([coordinatorA.dispose(), coordinatorB.dispose()])
})

test('pending plan is exact-idempotent and accepted refs can only advance monotonically', async () => {
  const storage = createStorage()
  const coordinator = createCoordinator()
  const state = createState(storage, coordinator)
  const request = planRequest(0, digest('a'), [material])
  const staged = await state.stagePlanRequest(request)
  assert.deepEqual(staged.pendingPlanRequest, request)
  assert.deepEqual(await state.stagePlanRequest(structuredClone(request)), staged)
  await assert.rejects(
    state.stagePlanRequest({ ...request, snapshotDigest: digest('f') }),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'state-conflict',
  )
  const acknowledged = await state.acknowledgePlan(request, await planFor(request))
  const omittingAccepted = planRequest(1, digest('2'), [])
  await assert.rejects(
    state.stagePlanRequest(omittingAccepted),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'state-conflict',
  )
  assert.deepEqual((await state.getProjectState(projectId)).acceptedMaterialRefs, acknowledged.acceptedMaterialRefs)
  await coordinator.dispose()
})

test('plan ACK is cryptographically bound to the exact pending request and preserves mismatches for recovery', async () => {
  const storage = createStorage()
  const coordinator = createCoordinator()
  const state = createState(storage, coordinator)
  const pending = planRequest(0, digest('a'), [material])
  const crossed = planRequest(0, digest('a'), [otherMaterial])
  await state.stagePlanRequest(pending)
  await assert.rejects(
    state.acknowledgePlan(pending, await planFor(crossed)),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'state-conflict',
  )
  assert.deepEqual((await state.getProjectState(projectId)).pendingPlanRequest, pending)
  await coordinator.dispose()
})

test('pending sweep is synchronously durable inside the transaction and exact replay clears only on ACK', async () => {
  const storage = createStorage()
  const coordinator = createCoordinator()
  const state = createState(storage, coordinator)
  const request = planRequest(0, digest('a'), [material])
  const plan = await planFor(request)
  await state.stagePlanRequest(request)
  await state.acknowledgePlan(request, plan)
  const sweepRequest = sweepRequestFor(plan)

  const staged = await state.stageSweepRequest(sweepRequest)
  assert.deepEqual(staged.pendingSweepRequest, sweepRequest)
  assert.deepEqual(await state.stageSweepRequest(structuredClone(sweepRequest)), staged)
  await assert.rejects(
    state.stageSweepRequest(sweepRequestFor({ ...plan, planHash: digest('f') })),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'state-conflict',
  )
  const restored = createState(storage, coordinator)
  assert.deepEqual((await restored.getProjectState(projectId)).pendingSweepRequest, sweepRequest)

  const cleared = await restored.acknowledgeSweep(sweepRequest, sweepResultFor(plan))
  assert.equal(cleared.pendingSweepRequest, null)
  await coordinator.dispose()
})

test('definitive sweep rejection clears only the exact pending request', async () => {
  const storage = createStorage()
  const coordinator = createCoordinator()
  const state = createState(storage, coordinator)
  const request = planRequest()
  const plan = await planFor(request)
  const sweepRequest = sweepRequestFor(plan)
  await state.stagePlanRequest(request)
  await state.acknowledgePlan(request, plan)
  await state.stageSweepRequest(sweepRequest)
  await assert.rejects(
    state.clearPendingSweep(sweepRequestFor({ ...plan, planHash: digest('f') })),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'state-conflict',
  )
  assert.ok((await state.getProjectState(projectId)).pendingSweepRequest)
  assert.equal((await state.clearPendingSweep(sweepRequest)).pendingSweepRequest, null)
  await coordinator.dispose()
})

test('storage failures and corrupted project identity fail closed without regeneration or memory fallback', async () => {
  let randomCalls = 0
  const corruptStorage = createStorage([[`${DASHBOARD_MATERIAL_GC_PROJECT_STORAGE_PREFIX}${projectId}`, '{broken']])
  const corruptCoordinator = createCoordinator()
  const corrupt = createDashboardMaterialGcReplicaState({
    storage: corruptStorage,
    coordinator: corruptCoordinator,
    crypto: {
      randomUUID() {
        randomCalls += 1
        return replicaId
      },
      subtle: webcrypto.subtle,
    },
  })
  await assert.rejects(
    corrupt.getProjectState(projectId),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'corrupt-state',
  )
  assert.equal(randomCalls, 0)
  assert.equal(corruptStorage.calls.filter(call => call[0] === 'set').length, 0)

  const failingStorage = {
    getItem: () => null,
    setItem() {
      throw new DOMException('quota', 'QuotaExceededError')
    },
  }
  const unavailableCoordinator = createCoordinator()
  const unavailable = createState(failingStorage, unavailableCoordinator)
  await assert.rejects(
    unavailable.getProjectState(projectId),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'storage-unavailable',
  )
  await Promise.all([corruptCoordinator.dispose(), unavailableCoordinator.dispose()])
})

test('explicit release persists a terminal tombstone and forbids root recreation', async () => {
  const storage = createStorage()
  const coordinator = createCoordinator()
  const state = createState(storage, coordinator)
  const request = planRequest(0, digest('a'), [material])
  const plan = await planFor(request)
  await state.stagePlanRequest(request)
  await state.acknowledgePlan(request, plan)
  const releaseRequest = {
    schemaVersion: 1,
    projectId: request.projectId,
    replicaId,
    expectedReplicaGeneration: plan.replicaGeneration,
    snapshotDigest: request.snapshotDigest,
  }
  await assert.rejects(
    state.commitRelease(releaseRequest, {
      schemaVersion: 1,
      status: 'released',
      projectId: request.projectId,
      replicaId,
      replicaGeneration: plan.replicaGeneration + 1,
      requestDigest: digest('f'),
      registryGeneration: 2,
    }),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'state-conflict',
  )
  assert.equal((await state.getProjectState(projectId)).status, 'active')
  const released = await state.commitRelease(releaseRequest, {
    schemaVersion: 1,
    status: 'released',
    projectId: request.projectId,
    replicaId,
    replicaGeneration: plan.replicaGeneration + 1,
    requestDigest: await hashContractJson(createMaterialGcReleaseRequestDigestInput(releaseRequest)),
    registryGeneration: 2,
  })
  assert.equal(released.status, 'released')
  assert.equal(released.replicaGeneration, 2)
  assert.deepEqual(released.acceptedMaterialRefs, [])
  assert.equal(released.pendingSweepRequest, null)

  const restored = await createState(storage, coordinator).getProjectState(request.projectId)
  assert.deepEqual(restored, released)
  await assert.rejects(
    state.stagePlanRequest(planRequest(2, digest('6'), [material])),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'replica-released',
  )
  await coordinator.dispose()
})

test('project lifecycle identities isolate projects and explicit rotation cannot revive old replica tabs', async () => {
  const storage = createStorage()
  const lockManager = new LockManagerHarness()
  const coordinatorA = createCoordinator(lockManager)
  const coordinatorB = createCoordinator(lockManager)
  const generated = [replicaId, otherProjectReplicaId, rotatedReplicaId]
  const oldTabA = createState(storage, coordinatorA, () => generated.shift())
  const oldTabB = createState(storage, coordinatorB, () => {
    throw new Error('the second tab must adopt durable project identities')
  })

  const projectAInitial = await oldTabA.getProjectState(projectId)
  const projectBInitial = await oldTabA.getProjectState('project-b')
  assert.equal(projectAInitial.replicaId, replicaId)
  assert.equal(projectBInitial.replicaId, otherProjectReplicaId)
  await oldTabB.getProjectState(projectId)
  await oldTabB.getProjectState('project-b')

  const request = planRequest()
  const plan = await planFor(request)
  await oldTabA.stagePlanRequest(request)
  await oldTabA.acknowledgePlan(request, plan)
  const releaseRequest = {
    schemaVersion: 1,
    projectId,
    replicaId,
    expectedReplicaGeneration: plan.replicaGeneration,
    snapshotDigest: plan.snapshotDigest,
  }
  await oldTabA.commitRelease(releaseRequest, {
    schemaVersion: 1,
    status: 'released',
    projectId,
    replicaId,
    replicaGeneration: plan.replicaGeneration + 1,
    requestDigest: await hashContractJson(createMaterialGcReleaseRequestDigestInput(releaseRequest)),
    registryGeneration: 2,
  })

  const rotated = await oldTabA.beginNewProjectLifecycle(projectId)
  assert.equal(rotated.replicaId, rotatedReplicaId)
  assert.equal(rotated.status, 'active')
  assert.equal(rotated.replicaGeneration, 0)
  await assert.rejects(
    oldTabB.getProjectState(projectId),
    error => error instanceof DashboardMaterialGcReplicaStateError && error.code === 'replica-rotated',
  )
  assert.equal((await oldTabB.getProjectState('project-b')).replicaId, otherProjectReplicaId)

  const freshTab = createState(storage, createCoordinator(lockManager), () => {
    throw new Error('fresh tab must adopt the rotated lifecycle')
  })
  assert.equal((await freshTab.getProjectState(projectId)).replicaId, rotatedReplicaId)
  assert.equal((await freshTab.getProjectState('project-b')).replicaId, otherProjectReplicaId)
  await Promise.all([coordinatorA.dispose(), coordinatorB.dispose()])
})
