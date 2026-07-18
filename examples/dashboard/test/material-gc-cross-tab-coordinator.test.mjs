import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE,
  DASHBOARD_MATERIAL_GC_LOCK_ORDER,
  createDashboardMaterialGcCrossTabCoordinator,
  createDashboardMaterialGcCrossTabLockNames,
} from '../src/editor/agent/capabilities/promotion/material-gc-cross-tab-coordinator.mjs'

const projectId = 'project/customer:a'
const replicaId = '11111111-1111-4111-8111-111111111111'
const scope = Object.freeze({ projectId, replicaId })
const otherReplicaScope = Object.freeze({ projectId, replicaId: '22222222-2222-4222-8222-222222222222' })

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const abortError = () => {
  if (typeof DOMException === 'function') return new DOMException('The operation was aborted', 'AbortError')
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

class WebLockManagerHarness {
  #states = new Map()
  requests = []

  #state(name) {
    const state = this.#states.get(name) ?? { holders: new Set(), queue: [] }
    this.#states.set(name, state)
    return state
  }

  #canGrant(state, mode) {
    if (mode === 'exclusive') return state.holders.size === 0
    return ![...state.holders].some(holder => holder.mode === 'exclusive')
  }

  #finish(name, state, holder) {
    state.holders.delete(holder)
    this.#drain(name, state)
  }

  #grant(name, state, entry) {
    entry.signal?.removeEventListener('abort', entry.onAbort)
    const holder = { mode: entry.mode }
    state.holders.add(holder)
    Promise.resolve()
      .then(() => entry.operation(Object.freeze({ name, mode: entry.mode })))
      .then(entry.resolve, entry.reject)
      .finally(() => this.#finish(name, state, holder))
  }

  #drain(name, state) {
    if (state.queue.length === 0) {
      if (state.holders.size === 0) this.#states.delete(name)
      return
    }
    const first = state.queue[0]
    if (!this.#canGrant(state, first.mode)) return
    if (first.mode === 'exclusive') {
      state.queue.shift()
      this.#grant(name, state, first)
      return
    }
    while (state.queue[0]?.mode === 'shared' && this.#canGrant(state, 'shared')) {
      this.#grant(name, state, state.queue.shift())
    }
  }

  request(name, options, operation) {
    const mode = options?.mode ?? 'exclusive'
    const signal = options?.signal
    this.requests.push(Object.freeze({ name, mode, ifAvailable: options?.ifAvailable === true }))
    if (signal?.aborted) return Promise.reject(abortError())
    const state = this.#state(name)

    if (options?.ifAvailable === true && !this.#canGrant(state, mode)) {
      return Promise.resolve().then(() => operation(null))
    }

    return new Promise((resolve, reject) => {
      const entry = { mode, operation, reject, resolve, signal, onAbort: undefined }
      entry.onAbort = () => {
        const index = state.queue.indexOf(entry)
        if (index === -1) return
        state.queue.splice(index, 1)
        signal.removeEventListener('abort', entry.onAbort)
        reject(abortError())
        this.#drain(name, state)
      }
      if (signal) signal.addEventListener('abort', entry.onAbort, { once: true })
      state.queue.push(entry)
      this.#drain(name, state)
    })
  }

  active(name) {
    return this.#states.get(name)?.holders.size ?? 0
  }

  queued(name) {
    return this.#states.get(name)?.queue.length ?? 0
  }

  crash(name) {
    const state = this.#states.get(name)
    if (!state) return 0
    const count = state.holders.size
    state.holders.clear()
    this.#drain(name, state)
    return count
  }
}

test('default-off coordinator reads only enabled and creates no lock or callback side effects', async () => {
  let dependencyReads = 0
  let callbacks = 0
  const coordinator = createDashboardMaterialGcCrossTabCoordinator({
    enabled: false,
    get lockManager() {
      dependencyReads += 1
      throw new Error('must stay untouched')
    },
    get storage() {
      dependencyReads += 1
      throw new Error('must stay untouched')
    },
    get schedule() {
      dependencyReads += 1
      throw new Error('must stay untouched')
    },
  })

  assert.equal(coordinator.enabled, false)
  assert.deepEqual(
    await coordinator.tryWithProjectPresenceExclusive(scope, () => {
      callbacks += 1
    }),
    { status: 'unavailable', reason: 'disabled' },
  )
  await assert.rejects(
    coordinator.withIdentityExclusive(() => {
      callbacks += 1
    }),
    error => error.code === DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.disabled,
  )
  assert.equal(await coordinator.dispose(), false)
  assert.equal(dependencyReads, 0)
  assert.equal(callbacks, 0)
})

test('lock names are strict, origin-scoped, encoded, and expose the required lock order', () => {
  const names = createDashboardMaterialGcCrossTabLockNames(scope)
  assert.equal(names.identity, 'easy-editor:agent-runtime:material-gc-cross-tab:v1:identity')
  assert.match(names.projectPresence, /project-presence:project%2Fcustomer%3Aa:11111111-1111-4111-8111-111111111111$/u)
  assert.match(names.projectReplica, /project-replica:project%2Fcustomer%3Aa:11111111-1111-4111-8111-111111111111$/u)
  assert.notEqual(
    names.projectReplica,
    createDashboardMaterialGcCrossTabLockNames({ ...scope, replicaId: 'replica-b' }).projectReplica,
  )
  assert.deepEqual(DASHBOARD_MATERIAL_GC_LOCK_ORDER.normalGcOrAdmission, [
    'local-mutation-quiescence',
    'project-material-fence',
    'project-replica-exclusive',
    'server-authority',
  ])
  assert.deepEqual(DASHBOARD_MATERIAL_GC_LOCK_ORDER.terminalRelease, [
    'local-mutation-terminal-close',
    'drop-own-shared-presence',
    'project-presence-exclusive',
    'project-material-fence',
    'project-replica-exclusive',
    'server-authority',
  ])
  assert.throws(
    () => createDashboardMaterialGcCrossTabLockNames({ projectId: ' project-a', replicaId }),
    error => error.code === DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.invalidInput,
  )
})

test('two tabs serialize identity and matching project-replica transactions', async () => {
  const lockManager = new WebLockManagerHarness()
  const tabA = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const tabB = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const releaseIdentity = deferred()
  const identityEntered = deferred()
  const events = []

  const firstIdentity = tabA.withIdentityExclusive(async () => {
    events.push('identity-a-enter')
    identityEntered.resolve()
    await releaseIdentity.promise
    events.push('identity-a-exit')
  })
  await identityEntered.promise
  const secondIdentity = tabB.withIdentityExclusive(() => events.push('identity-b'))
  await Promise.resolve()
  assert.deepEqual(events, ['identity-a-enter'])
  releaseIdentity.resolve()
  await Promise.all([firstIdentity, secondIdentity])
  assert.deepEqual(events, ['identity-a-enter', 'identity-a-exit', 'identity-b'])

  const releaseReplica = deferred()
  const replicaEntered = deferred()
  let secondReplicaEntered = false
  const firstReplica = tabA.withProjectReplicaExclusive(scope, async () => {
    replicaEntered.resolve()
    await releaseReplica.promise
  })
  await replicaEntered.promise
  const secondReplica = tabB.withProjectReplicaExclusive(scope, () => {
    secondReplicaEntered = true
  })
  await Promise.resolve()
  assert.equal(secondReplicaEntered, false)
  releaseReplica.resolve()
  await Promise.all([firstReplica, secondReplica])
  assert.equal(secondReplicaEntered, true)

  await Promise.all([tabA.dispose(), tabB.dispose()])
})

test('shared project-replica presence blocks the same replica without blocking another replica', async () => {
  const lockManager = new WebLockManagerHarness()
  const tabA = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const tabB = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const releaser = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const otherReplica = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const leaseA = await tabA.acquireProjectPresenceLease(scope)
  const leaseB = await tabB.acquireProjectPresenceLease(scope)
  let authorityCalls = 0

  assert.equal(leaseA.projectId, projectId)
  assert.equal(leaseA.replicaId, replicaId)
  assert.equal(leaseB.lockName, leaseA.lockName)

  const blocked = await releaser.tryWithProjectPresenceExclusive(scope, () => {
    authorityCalls += 1
    return 'must-not-run'
  })
  assert.equal(blocked.status, 'in-use')
  assert.equal(authorityCalls, 0)
  assert.equal(lockManager.queued(leaseA.lockName), 0)
  assert.equal(lockManager.requests.at(-1).ifAvailable, true)

  const independentReplica = await otherReplica.tryWithProjectPresenceExclusive(otherReplicaScope, () => {
    authorityCalls += 1
    return 'other-replica-authority'
  })
  assert.deepEqual(independentReplica, {
    status: 'acquired',
    projectId,
    replicaId: otherReplicaScope.replicaId,
    lockName: createDashboardMaterialGcCrossTabLockNames(otherReplicaScope).projectPresence,
    value: 'other-replica-authority',
  })

  assert.equal(leaseA.release(), true)
  assert.equal(leaseA.release(), false)
  await leaseA.closed
  assert.equal((await releaser.tryWithProjectPresenceExclusive(scope, () => 'still-blocked')).status, 'in-use')

  assert.equal(leaseB.release(), true)
  await leaseB.closed
  const acquired = await releaser.tryWithProjectPresenceExclusive(scope, () => {
    authorityCalls += 1
    return 'server-authority-result'
  })
  assert.deepEqual(acquired, {
    status: 'acquired',
    projectId,
    replicaId,
    lockName: leaseA.lockName,
    value: 'server-authority-result',
  })
  assert.equal(authorityCalls, 2)

  await Promise.all([tabA.dispose(), tabB.dispose(), releaser.dispose(), otherReplica.dispose()])
})

test('transaction callback failure and queued abort both release authority for the next tab', async () => {
  const lockManager = new WebLockManagerHarness()
  const tabA = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const tabB = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })

  await assert.rejects(
    tabA.withProjectReplicaExclusive(scope, () => {
      throw new Error('callback-failed')
    }),
    /callback-failed/u,
  )
  assert.equal(await tabB.withProjectReplicaExclusive(scope, () => 'after-error'), 'after-error')

  const releaseFirst = deferred()
  const firstEntered = deferred()
  const first = tabA.withProjectReplicaExclusive(scope, async () => {
    firstEntered.resolve()
    await releaseFirst.promise
  })
  await firstEntered.promise
  const controller = new AbortController()
  let abortedCallbackCalls = 0
  const aborted = tabB.withProjectReplicaExclusive(
    scope,
    () => {
      abortedCallbackCalls += 1
    },
    { signal: controller.signal },
  )
  controller.abort()
  await assert.rejects(aborted, error => error.name === 'AbortError')
  assert.equal(abortedCallbackCalls, 0)
  releaseFirst.resolve()
  await first
  assert.equal(await tabB.withProjectReplicaExclusive(scope, () => 'after-abort'), 'after-abort')

  await Promise.all([tabA.dispose(), tabB.dispose()])
})

test('presence callback errors release exclusive authority', async () => {
  const lockManager = new WebLockManagerHarness()
  const first = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const second = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })

  await assert.rejects(
    first.tryWithProjectPresenceExclusive(scope, () => {
      throw new Error('terminal-release-failed')
    }),
    /terminal-release-failed/u,
  )
  assert.equal((await second.tryWithProjectPresenceExclusive(scope, () => 'recovered')).status, 'acquired')

  await Promise.all([first.dispose(), second.dispose()])
})

test('dispose is idempotent and orderly teardown releases every owned presence lease', async () => {
  const lockManager = new WebLockManagerHarness()
  const tab = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const contender = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const firstLease = await tab.acquireProjectPresenceLease(scope)
  const secondLease = await tab.acquireProjectPresenceLease(scope)

  assert.equal(lockManager.active(firstLease.lockName), 2)
  assert.equal(await tab.dispose(), true)
  assert.equal(await tab.dispose(), false)
  assert.equal(firstLease.released, true)
  assert.equal(secondLease.released, true)
  assert.equal(lockManager.active(firstLease.lockName), 0)
  assert.equal((await contender.tryWithProjectPresenceExclusive(scope, () => 'released')).status, 'acquired')
  await contender.dispose()
})

test('browser crash semantics rely on Web Locks authority instead of heartbeat or BroadcastChannel', async () => {
  const lockManager = new WebLockManagerHarness()
  const crashedTab = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const liveTab = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager })
  const lease = await crashedTab.acquireProjectPresenceLease(scope)

  assert.equal(lockManager.crash(lease.lockName), 1)
  assert.equal(lease.released, false)
  assert.equal(
    (await liveTab.tryWithProjectPresenceExclusive(scope, () => 'browser-released-crashed-context')).status,
    'acquired',
  )

  lease.release()
  await lease.closed
  await Promise.all([crashedTab.dispose(), liveTab.dispose()])
})

test('unavailable Web Locks fail closed without invoking local or server-authority callbacks', async () => {
  const coordinator = createDashboardMaterialGcCrossTabCoordinator({ enabled: true, lockManager: {} })
  let callbacks = 0

  await assert.rejects(
    coordinator.withIdentityExclusive(() => {
      callbacks += 1
    }),
    error => error.code === DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.locksUnavailable,
  )
  await assert.rejects(
    coordinator.withProjectReplicaExclusive(scope, () => {
      callbacks += 1
    }),
    error => error.code === DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.locksUnavailable,
  )
  await assert.rejects(
    coordinator.acquireProjectPresenceLease(scope),
    error => error.code === DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.locksUnavailable,
  )
  assert.deepEqual(
    await coordinator.tryWithProjectPresenceExclusive(scope, () => {
      callbacks += 1
    }),
    { status: 'unavailable', reason: 'web-locks-unavailable' },
  )
  assert.equal(callbacks, 0)
  await coordinator.dispose()
})
