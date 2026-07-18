import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DashboardMutationQuiescenceGateDisposedError,
  createDashboardMutationQuiescenceGate,
} from '../src/editor/agent/activity/mutation-quiescence-gate.mjs'

test('shared acquisition reserves its count synchronously before returning a resolved promise', async () => {
  const gate = createDashboardMutationQuiescenceGate()
  const pendingLease = gate.acquireShared()
  assert.deepEqual(gate.getSnapshot(), {
    schemaVersion: 1,
    disposed: false,
    exclusiveActive: false,
    inputBlocked: false,
    sharedCount: 1,
    waitingSharedCount: 0,
  })
  assert.equal(gate.tryAcquireExclusive(), null)
  const lease = await pendingLease
  assert.equal(lease.release(), true)
  assert.equal(lease.release(), false)
  assert.equal(gate.getSnapshot().sharedCount, 0)
  gate.dispose()
})

test('exclusive release reserves every queued shared entrant before resolving any waiter', async () => {
  const gate = createDashboardMutationQuiescenceGate()
  const exclusive = gate.tryAcquireExclusive()
  assert.ok(exclusive)
  const firstPending = gate.acquireShared()
  const secondPending = gate.acquireShared()
  assert.equal(gate.getSnapshot().waitingSharedCount, 2)
  assert.equal(exclusive.release(), true)
  assert.equal(gate.getSnapshot().sharedCount, 2)
  assert.equal(gate.getSnapshot().waitingSharedCount, 0)
  assert.equal(gate.tryAcquireExclusive(), null)
  const [first, second] = await Promise.all([firstPending, secondPending])
  assert.equal(first.release(), true)
  assert.equal(second.release(), true)
  const nextExclusive = gate.tryAcquireExclusive()
  assert.ok(nextExclusive)
  assert.equal(nextExclusive.release(), true)
  gate.dispose()
})

test('capture input blocking is active only during an exclusive hold and normal behavior is restored', async () => {
  const target = new EventTarget()
  const gate = createDashboardMutationQuiescenceGate({ inputTarget: target })
  let editorEvents = 0
  target.addEventListener('pointerdown', () => {
    editorEvents += 1
  })

  assert.equal(target.dispatchEvent(new Event('pointerdown', { cancelable: true })), true)
  assert.equal(editorEvents, 1)
  const exclusive = gate.tryAcquireExclusive()
  assert.ok(exclusive)
  const blocked = new Event('pointerdown', { cancelable: true })
  assert.equal(target.dispatchEvent(blocked), false)
  assert.equal(blocked.defaultPrevented, true)
  assert.equal(editorEvents, 1)

  let sharedSettled = false
  const sharedPending = gate.acquireShared().then(lease => {
    sharedSettled = true
    return lease
  })
  await Promise.resolve()
  assert.equal(sharedSettled, false)
  exclusive.release()
  assert.equal(gate.getSnapshot().sharedCount, 1)
  const shared = await sharedPending
  assert.equal(target.dispatchEvent(new Event('pointerdown', { cancelable: true })), true)
  assert.equal(editorEvents, 2)
  shared.release()
  gate.dispose()
})

test('dispose keeps an in-flight exclusive blocker until the owner settles and then rejects queued entrants', async () => {
  const target = new EventTarget()
  const gate = createDashboardMutationQuiescenceGate({ inputTarget: target })
  let editorEvents = 0
  target.addEventListener('keydown', () => {
    editorEvents += 1
  })
  const exclusive = gate.tryAcquireExclusive()
  assert.ok(exclusive)
  const queuedOutcome = gate.acquireShared().then(
    () => 'entered',
    error => error,
  )

  gate.dispose()
  assert.equal(gate.getSnapshot().disposed, true)
  assert.equal(gate.getSnapshot().exclusiveActive, true)
  assert.equal(target.dispatchEvent(new Event('keydown', { cancelable: true })), false)
  assert.equal(editorEvents, 0)
  assert.equal(exclusive.release(), true)
  const outcome = await queuedOutcome
  assert.ok(outcome instanceof DashboardMutationQuiescenceGateDisposedError)
  assert.deepEqual(gate.getSnapshot(), {
    schemaVersion: 1,
    disposed: true,
    exclusiveActive: false,
    inputBlocked: false,
    sharedCount: 0,
    waitingSharedCount: 0,
  })
  assert.equal(target.dispatchEvent(new Event('keydown', { cancelable: true })), true)
  assert.equal(editorEvents, 1)
  assert.equal(gate.dispose(), undefined)
})
