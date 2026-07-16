import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  HumanActivityLeaseDisposedError,
  createHumanActivityLease,
  installHumanActivityTracking,
} from '../src/editor/agent/activity/index.mjs'
import { AGENT_RUNTIME_FEATURE_FLAG_ENV, resolveAgentRuntimeFeatureFlags } from '../src/editor/agent/feature-flags.mjs'

const createClock = () => {
  let now = 0
  let nextId = 1
  const timers = new Map()
  const clock = {
    now: () => now,
    setTimer(callback, delay) {
      const id = nextId++
      timers.set(id, { callback, due: now + delay })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    advance(ms) {
      now += ms
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.due <= now)
          .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0]
        if (!due) break
        timers.delete(due[0])
        due[1].callback()
      }
    },
  }
  return clock
}

test('recordActivity coalesces renewals and resolves idle waiters once', async () => {
  const clock = createClock()
  const lease = createHumanActivityLease({
    idleMs: 100,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  assert.equal(lease.recordActivity('pointer'), 1)
  const waiting = lease.waitUntilIdle()
  clock.advance(90)
  assert.equal(lease.isActive(), true)
  assert.equal(lease.recordActivity('pointer'), 2)
  clock.advance(99)
  assert.equal(lease.isActive(), true)
  clock.advance(1)

  assert.deepEqual(await waiting, { generation: 2 })
  assert.equal(lease.isActive(), false)
})

test('an acquired drag hold prevents idle until release and one quiet window', async () => {
  const clock = createClock()
  const lease = createHumanActivityLease({
    idleMs: 50,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  const hold = lease.acquire('pointer')
  const waiting = lease.waitUntilIdle()

  clock.advance(500)
  assert.equal(lease.isActive(), true)
  assert.equal(hold.renew(), 2)
  assert.equal(hold.release(), true)
  assert.equal(hold.release(), false)
  clock.advance(49)
  assert.equal(lease.isActive(), true)
  clock.advance(1)

  assert.deepEqual(await waiting, { generation: 3 })
  assert.equal(lease.isActive(), false)
})

test('invalid activity kinds and released hold renewal fail closed', () => {
  const lease = createHumanActivityLease()
  assert.throws(() => lease.recordActivity('hover'), TypeError)
  const hold = lease.acquire('keyboard')
  assert.equal(hold.release(), true)
  assert.throws(() => hold.renew(), /released/)
  lease.dispose()
})

test('dispose rejects waiters and future operations without leaving the lease active', async () => {
  const clock = createClock()
  const lease = createHumanActivityLease({
    idleMs: 100,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  lease.recordActivity('keyboard')
  const waiting = lease.waitUntilIdle()
  lease.dispose()

  await assert.rejects(waiting, HumanActivityLeaseDisposedError)
  await assert.rejects(lease.waitUntilIdle(), HumanActivityLeaseDisposedError)
  assert.equal(lease.isActive(), false)
  assert.equal(lease.disposed, true)
})

test('event tracking holds pointer drags, renews motion, and records keyboard activity', async () => {
  const clock = createClock()
  const lease = createHumanActivityLease({
    idleMs: 20,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  const target = new EventTarget()
  const dispatchPointer = (type, pointerId) => {
    const event = new Event(type)
    Object.defineProperty(event, 'pointerId', { value: pointerId })
    target.dispatchEvent(event)
  }
  const uninstall = installHumanActivityTracking({ lease, target })

  dispatchPointer('pointerdown', 7)
  clock.advance(100)
  assert.equal(lease.isActive(), true)
  dispatchPointer('pointermove', 7)
  dispatchPointer('pointerup', 7)
  clock.advance(19)
  assert.equal(lease.isActive(), true)
  clock.advance(1)
  assert.equal(lease.isActive(), false)

  target.dispatchEvent(new Event('keydown'))
  assert.equal(lease.isActive(), true)
  uninstall()
  uninstall()
  clock.advance(20)
  assert.equal(lease.isActive(), false)
})

test('Dashboard runtime installs no activity listeners by default and enabled tracking remains active', async () => {
  const runtimeSource = await readFile(new URL('../src/editor/runtime.ts', import.meta.url), 'utf8')
  assert.match(runtimeSource, /dashboardAgentRuntimeFeatureFlags\.runtime === true\s*\? installHumanActivityTracking\(/)

  const clock = createClock()
  const lease = createHumanActivityLease({
    idleMs: 20,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  const target = new EventTarget()
  const listeners = []
  const addEventListener = target.addEventListener.bind(target)
  target.addEventListener = (type, listener, options) => {
    listeners.push([type, listener, options])
    addEventListener(type, listener, options)
  }

  const defaultFlags = resolveAgentRuntimeFeatureFlags()
  const disabledRelease = defaultFlags.runtime === true ? installHumanActivityTracking({ lease, target }) : null
  assert.equal(disabledRelease, null)
  assert.equal(listeners.length, 0)
  assert.equal(lease.isActive(), false)

  const enabledFlags = resolveAgentRuntimeFeatureFlags({
    [AGENT_RUNTIME_FEATURE_FLAG_ENV.runtime]: 'true',
  })
  const enabledRelease = enabledFlags.runtime === true ? installHumanActivityTracking({ lease, target }) : null
  assert.equal(typeof enabledRelease, 'function')
  assert.equal(listeners.length, 6)

  target.dispatchEvent(new Event('keydown'))
  assert.equal(lease.isActive(), true)
  enabledRelease?.()
  clock.advance(20)
  assert.equal(lease.isActive(), false)
})
