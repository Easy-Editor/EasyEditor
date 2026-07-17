import assert from 'node:assert/strict'
import test from 'node:test'

import { DASHBOARD_AGENT_HOST_ERROR_CODE } from '../src/editor/agent/host/index.mjs'
import { DashboardAgentSessionHost, createDashboardAgentSessionHost } from '../src/editor/agent/host/session-host.mjs'

const sessionAuthority = Object.freeze({
  projectId: 'project-session-host',
  branchId: 'branch-main',
  sessionId: 'session-1',
})

const observeRequest = taskId => ({
  schemaVersion: 1,
  ...sessionAuthority,
  taskId,
  mode: 'full',
})

const receiptQuery = taskId => ({
  schemaVersion: 1,
  ...sessionAuthority,
  taskId,
  callId: `call-${taskId}`,
})

const createHostFactory = (overrides = {}) => {
  const created = []
  const factory = authority => {
    const state = { authority, calls: [], disposed: false }
    const host = {
      async observe(request) {
        state.calls.push(['observe', request])
        if (overrides.observe) return overrides.observe({ authority, request, state })
        return {
          schemaVersion: 1,
          revision: `revision-${authority.taskId}`,
          providerGenerations: {},
          projection: {},
        }
      },
      async describeCapability(request) {
        state.calls.push(['describeCapability', request])
        return { schemaVersion: 1, capability: request.capability, revision: '1', input: {} }
      },
      async invoke(call, context) {
        state.calls.push(['invoke', call, context])
        return { schemaVersion: 1, callId: call.callId, status: 'applied' }
      },
      async queryReceipt(request) {
        state.calls.push(['queryReceipt', request])
        return null
      },
      dispose() {
        state.disposed = true
      },
    }
    created.push(state)
    return host
  }
  return { created, factory }
}

test('session Host is default-off and routes every task through one fixed-authority Host', async () => {
  const { created, factory } = createHostFactory()
  assert.equal(createDashboardAgentSessionHost(), null)
  const host = createDashboardAgentSessionHost({
    enabled: true,
    authority: sessionAuthority,
    createHost: factory,
  })
  assert.ok(host)

  const first = await host.observe(observeRequest('task-1'))
  await host.queryReceipt(receiptQuery('task-2'))
  await host.observe(observeRequest('task-1'))

  assert.equal(first.revision, 'revision-task-1')
  assert.deepEqual(
    created.map(entry => entry.authority),
    [
      { ...sessionAuthority, taskId: 'task-1' },
      { ...sessionAuthority, taskId: 'task-2' },
    ],
  )
  assert.deepEqual(
    created.map(entry => entry.calls.map(call => call[0])),
    [['observe', 'observe'], ['queryReceipt']],
  )
})

test('session Host rejects foreign or accessor-backed routing authority before creating a task Host', async () => {
  const { created, factory } = createHostFactory()
  const host = new DashboardAgentSessionHost({ authority: sessionAuthority, createHost: factory })

  await assert.rejects(
    host.observe({ ...observeRequest('task-1'), sessionId: 'foreign-session' }),
    error => error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.authorityMismatch,
  )
  const hostile = { ...observeRequest('task-1') }
  Object.defineProperty(hostile, 'taskId', {
    enumerable: true,
    get() {
      throw new Error('taskId getter must not execute')
    },
  })
  await assert.rejects(host.observe(hostile), error => error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest)
  assert.equal(created.length, 0)
})

test('session Host keeps a finite least-recently-used task cache and disposes evicted Hosts', async () => {
  const { created, factory } = createHostFactory()
  const host = new DashboardAgentSessionHost({ authority: sessionAuthority, createHost: factory, maxTaskHosts: 2 })

  await host.observe(observeRequest('task-1'))
  await host.observe(observeRequest('task-2'))
  await host.observe(observeRequest('task-1'))
  await host.observe(observeRequest('task-3'))

  assert.equal(created.length, 3)
  assert.equal(created.find(entry => entry.authority.taskId === 'task-1').disposed, false)
  assert.equal(created.find(entry => entry.authority.taskId === 'task-2').disposed, true)
  assert.equal(created.find(entry => entry.authority.taskId === 'task-3').disposed, false)
})

test('session Host never evicts an in-flight task Host', async () => {
  let releaseTask1
  const task1Gate = new Promise(resolve => {
    releaseTask1 = resolve
  })
  const { created, factory } = createHostFactory({
    async observe({ authority }) {
      if (authority.taskId === 'task-1') await task1Gate
      return { schemaVersion: 1, revision: authority.taskId, providerGenerations: {}, projection: {} }
    },
  })
  const host = new DashboardAgentSessionHost({ authority: sessionAuthority, createHost: factory, maxTaskHosts: 1 })

  const pending = host.observe(observeRequest('task-1'))
  await Promise.resolve()
  await host.observe(observeRequest('task-2'))
  const task1 = created.find(entry => entry.authority.taskId === 'task-1')
  const task2 = created.find(entry => entry.authority.taskId === 'task-2')
  assert.equal(task1.disposed, false)
  assert.equal(task2.disposed, true)
  releaseTask1()
  await pending
  assert.equal(task1.disposed, false)
})

test('capability descriptions use a separate bound Host and router disposal closes every Host', async () => {
  const { created, factory } = createHostFactory()
  const host = new DashboardAgentSessionHost({ authority: sessionAuthority, createHost: factory })

  const schema = await host.describeCapability({
    schemaVersion: 1,
    projectId: sessionAuthority.projectId,
    branchId: sessionAuthority.branchId,
    capability: 'screen.inspect',
  })
  await host.observe(observeRequest('task-1'))
  host.dispose()
  host.dispose()

  assert.equal(schema.capability, 'screen.inspect')
  assert.equal(created.length, 2)
  assert.ok(created.every(entry => entry.disposed))
  await assert.rejects(
    host.observe(observeRequest('task-2')),
    error => error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.hostDisposed,
  )
})
