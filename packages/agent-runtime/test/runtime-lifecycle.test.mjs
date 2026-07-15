import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MessageChannel, Worker } from 'node:worker_threads'
import ts from 'typescript'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const workerScript = fileURLToPath(new URL('./fixtures/module-worker.mjs', import.meta.url))
let emittedRoot
let runtimeModule
let hostModule
let persistenceModule
let fixturesModule

before(async () => {
  emittedRoot = await mkdtemp(path.join(tmpdir(), 'easy-editor-agent-runtime-'))
  await writeFile(path.join(emittedRoot, 'package.json'), '{"type":"module"}\n')
  const config = ts.readConfigFile(path.join(packageRoot, 'tsconfig.build.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: {
      ...parsed.options,
      declaration: false,
      emitDeclarationOnly: false,
      noEmit: false,
      outDir: emittedRoot,
      rootDir: path.join(packageRoot, 'src'),
    },
  })
  const emitted = program.emit()
  assert.deepEqual(
    [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].map(diagnostic =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    ),
    [],
  )
  runtimeModule = await import(pathToFileURL(path.join(emittedRoot, 'internal/runtime/index.js')).href)
  hostModule = await import(pathToFileURL(path.join(emittedRoot, 'internal/testing/fake-agent-host.js')).href)
  persistenceModule = await import(
    pathToFileURL(path.join(emittedRoot, 'internal/testing/memory-agent-persistence.js')).href
  )
  fixturesModule = await import(
    pathToFileURL(path.join(emittedRoot, 'internal/testing/deterministic-fixtures.js')).href
  )
})

after(async () => {
  if (emittedRoot) await rm(emittedRoot, { recursive: true, force: true })
})

const binding = { projectId: 'project-1', branchId: 'branch-1', sessionId: 'session-1' }
const blueprint = { schemaVersion: 1, kind: 'blueprint', summary: 'Update dashboard' }
const complete = { schemaVersion: 1, kind: 'complete', summary: 'Done' }
const call = {
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  stepId: 'step-1',
  callId: 'call-1',
  capability: 'set-title',
  arguments: { title: 'City overview' },
  expectedRevision: 'revision-0',
}

const createEndpointFactory = scripts => {
  const workers = []
  let faultSubscriptions = 0
  return {
    workers,
    get faultSubscriptions() {
      return faultSubscriptions
    },
    factory() {
      const { port1, port2 } = new MessageChannel()
      const worker = new Worker(workerScript, {
        workerData: { emittedRoot, port: port2, steps: scripts.shift() ?? [] },
        transferList: [port2],
      })
      workers.push(worker)
      const faultListeners = new Set()
      const publishFault = error => {
        for (const listener of [...faultListeners]) listener(error)
      }
      worker.on('error', publishFault)
      worker.on('exit', code => publishFault(new Error(`agent worker exited with code ${code}`)))
      return {
        port: port1,
        terminate: () => void worker.terminate(),
        onFault(listener) {
          faultListeners.add(listener)
          faultSubscriptions += 1
          let subscribed = true
          return () => {
            if (!subscribed) return
            subscribed = false
            if (faultListeners.delete(listener)) faultSubscriptions -= 1
          }
        },
      }
    },
  }
}

const waitForPhase = async (runtime, phase) => {
  if (runtime.getSnapshot().phase === phase) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out waiting for ${phase}`))
    }, 2_000)
    const unsubscribe = runtime.subscribe(snapshot => {
      if (snapshot.phase !== phase) return
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}

test('real module Worker runs happy lifecycle and disposes ports/listeners', async () => {
  const endpoints = createEndpointFactory([
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [{ schemaVersion: 1, kind: 'tool-call', call }, complete] },
    ],
  ])
  const host = new hostModule.FakeAgentHost({
    invocationSteps: [
      {
        result: { schemaVersion: 1, callId: 'call-1', status: 'applied', revision: 'revision-1' },
        nextSnapshot: { schemaVersion: 1, revision: 'revision-1', projection: { title: 'City overview' } },
      },
    ],
  })
  const persistence = new persistenceModule.MemoryAgentPersistence()
  const phases = []
  const runtime = runtimeModule.createAgentRuntimeInternal({
    binding,
    worker: endpoints.factory,
    host,
    persistence,
    clock: fixturesModule.createDeterministicClock(),
    idFactory: fixturesModule.createDeterministicIdFactory('main-'),
  })
  runtime.subscribe(snapshot => phases.push(snapshot.phase))

  const task = await runtime.submit({ text: 'Update the dashboard' })
  await runtime.waitForIdle()
  assert.equal(task.taskId, 'task-1')
  assert.equal(runtime.getSnapshot().phase, 'COMPLETED')
  assert.equal(host.invocations.length, 1)
  assert.ok(Object.isFrozen(runtime.getSnapshot()))
  await runtime.dispose()
  assert.equal(runtime.getSnapshot().status, 'disposed')
  assert.ok(phases.includes('EXECUTE') && phases.includes('CHECKPOINT'))
})

test('real module Worker repairs a verification mismatch before completing', async () => {
  const repairCall = {
    ...call,
    stepId: 'step-2',
    callId: 'call-2',
    expectedRevision: 'revision-2',
  }
  const endpoints = createEndpointFactory([
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [{ schemaVersion: 1, kind: 'tool-call', call }] },
      {
        expectedPhase: 'REPAIR',
        events: [{ schemaVersion: 1, kind: 'tool-call', call: repairCall }, complete],
      },
    ],
  ])
  const host = new hostModule.FakeAgentHost({
    invocationSteps: [
      {
        result: { schemaVersion: 1, callId: 'call-1', status: 'applied', revision: 'revision-1' },
        nextSnapshot: { schemaVersion: 1, revision: 'revision-2', projection: { stale: true } },
      },
      {
        result: { schemaVersion: 1, callId: 'call-2', status: 'applied', revision: 'revision-3' },
        nextSnapshot: { schemaVersion: 1, revision: 'revision-3', projection: { repaired: true } },
      },
    ],
  })
  const runtime = runtimeModule.createAgentRuntimeInternal({
    binding,
    worker: endpoints.factory,
    host,
    persistence: new persistenceModule.MemoryAgentPersistence(),
    clock: fixturesModule.createDeterministicClock(),
    idFactory: fixturesModule.createDeterministicIdFactory('main-repair-'),
  })

  await runtime.submit({ text: 'Repair mismatch' })
  await runtime.waitForIdle()
  assert.equal(runtime.getSnapshot().phase, 'COMPLETED')
  assert.equal(runtime.getSnapshot().activeTask.repairAttempts, 1)
  assert.equal(host.invocations.length, 2)
  await runtime.dispose()
})

test('real module Worker cancel prevents future calls', async () => {
  const endpoints = createEndpointFactory([[{ expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' }]])
  const host = new hostModule.FakeAgentHost()
  const runtime = runtimeModule.createAgentRuntimeInternal({
    binding,
    worker: endpoints.factory,
    host,
    persistence: new persistenceModule.MemoryAgentPersistence(),
    clock: fixturesModule.createDeterministicClock(),
    idFactory: fixturesModule.createDeterministicIdFactory('main-cancel-'),
  })
  const task = await runtime.submit({ text: 'Cancel this task' })
  await waitForPhase(runtime, 'BLUEPRINT')
  await runtime.cancel(task.taskId)
  assert.equal(runtime.getSnapshot().phase, 'CANCELLED')
  assert.equal(host.invocations.length, 0)
  await runtime.dispose()
})

test('restart recovers persisted work and forces a full observation', async () => {
  const endpoints = createEndpointFactory([
    [{ expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' }],
    [{ expectedPhase: 'PLAN_STEP', events: [complete] }],
  ])
  const host = new hostModule.FakeAgentHost()
  const persistence = new persistenceModule.MemoryAgentPersistence()
  const statuses = []
  const runtime = runtimeModule.createAgentRuntimeInternal({
    binding,
    worker: endpoints.factory,
    host,
    persistence,
    clock: fixturesModule.createDeterministicClock(),
    idFactory: fixturesModule.createDeterministicIdFactory('main-restart-'),
  })
  runtime.subscribe(snapshot => statuses.push(snapshot.status))
  const task = await runtime.submit({ text: 'Recover me' })
  await waitForPhase(runtime, 'BLUEPRINT')
  await persistence.commit({
    schemaVersion: 1,
    ...binding,
    batchId: 'seed-1',
    expectedDraftGeneration: 0,
    records: [
      {
        recordId: `task:${task.taskId}`,
        kind: 'agent-runtime-task',
        value: {
          taskId: task.taskId,
          sessionId: task.sessionId,
          phase: 'PAUSED',
          createdAt: 1,
          updatedAt: 2,
          repairAttempts: 0,
          intent: { text: 'Recover me' },
        },
      },
    ],
  })

  await runtime.restart()
  assert.equal(runtime.getSnapshot().phase, 'COMPLETED')
  assert.ok(statuses.includes('recovering'))
  assert.ok(host.observations.some(request => request.mode === 'full' && request.taskId === task.taskId))
  assert.equal(endpoints.workers.length, 2)
  await runtime.dispose()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(endpoints.workers.length, 2)
  assert.equal(endpoints.faultSubscriptions, 0)
})

test('unexpected Worker exit automatically recovers persisted work without transport leaks', async () => {
  const endpoints = createEndpointFactory([
    [{ expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' }],
    [{ expectedPhase: 'PLAN_STEP', events: [complete] }],
  ])
  const host = new hostModule.FakeAgentHost()
  const persistence = new persistenceModule.MemoryAgentPersistence()
  const statuses = []
  const runtime = runtimeModule.createAgentRuntimeInternal({
    binding,
    worker: endpoints.factory,
    host,
    persistence,
    clock: fixturesModule.createDeterministicClock(),
    idFactory: fixturesModule.createDeterministicIdFactory('main-crash-'),
  })
  runtime.subscribe(snapshot => statuses.push(snapshot.status))
  const task = await runtime.submit({ text: 'Recover after crash' })
  await waitForPhase(runtime, 'BLUEPRINT')
  await persistence.commit({
    schemaVersion: 1,
    ...binding,
    batchId: 'seed-crash',
    expectedDraftGeneration: 0,
    records: [
      {
        recordId: `task:${task.taskId}`,
        kind: 'agent-runtime-task',
        value: {
          taskId: task.taskId,
          sessionId: task.sessionId,
          phase: 'PAUSED',
          createdAt: 1,
          updatedAt: 2,
          repairAttempts: 0,
          intent: { text: 'Recover after crash' },
        },
      },
    ],
  })

  const interruptedWait = assert.rejects(runtime.waitForIdle())
  await endpoints.workers[0].terminate()
  await interruptedWait
  await waitForPhase(runtime, 'COMPLETED')

  assert.ok(statuses.includes('recovering'))
  assert.equal(endpoints.workers.length, 2)
  assert.equal(endpoints.faultSubscriptions, 1)
  assert.ok(host.observations.some(request => request.mode === 'full' && request.taskId === task.taskId))
  assert.equal((await runtime.diagnostics()).pendingRequests, 0)
  await runtime.dispose()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(endpoints.faultSubscriptions, 0)
  assert.equal(endpoints.workers.length, 2)
})

test('automatic crash replacement failure transitions to FAILED once', async () => {
  const endpoints = createEndpointFactory([[]])
  let attempts = 0
  const phases = []
  const runtime = runtimeModule.createAgentRuntimeInternal({
    binding,
    worker() {
      attempts += 1
      if (attempts > 1) throw new Error('replacement worker failed')
      return endpoints.factory()
    },
    host: new hostModule.FakeAgentHost(),
    persistence: new persistenceModule.MemoryAgentPersistence(),
    clock: fixturesModule.createDeterministicClock(),
    idFactory: fixturesModule.createDeterministicIdFactory('main-crash-failure-'),
  })
  runtime.subscribe(snapshot => phases.push(snapshot.phase))
  await runtime.ready()

  await endpoints.workers[0].terminate()
  await waitForPhase(runtime, 'FAILED')
  assert.equal(runtime.getSnapshot().status, 'failed')
  assert.equal(runtime.getSnapshot().failure.code, 'worker-initialization-failed')
  assert.equal(phases.filter(phase => phase === 'RECOVERING').length, 1)
  assert.equal(phases.filter(phase => phase === 'FAILED').length, 1)
  assert.equal(endpoints.faultSubscriptions, 0)
  await assert.rejects(runtime.dispose(), /replacement worker failed/)
})

test('one-shot endpoint crash fails without reusing the dead transport', async () => {
  const endpoints = createEndpointFactory([[]])
  const endpoint = endpoints.factory()
  const runtime = runtimeModule.createAgentRuntimeInternal({
    binding,
    worker: endpoint,
    host: new hostModule.FakeAgentHost(),
    persistence: new persistenceModule.MemoryAgentPersistence(),
    clock: fixturesModule.createDeterministicClock(),
    idFactory: fixturesModule.createDeterministicIdFactory('main-one-shot-crash-'),
  })
  await runtime.ready()

  await endpoints.workers[0].terminate()
  await waitForPhase(runtime, 'FAILED')
  assert.equal(runtime.getSnapshot().status, 'failed')
  assert.equal(runtime.getSnapshot().failure.code, 'worker-restart-unavailable')
  assert.equal(runtime.getSnapshot().failure.retryable, false)
  assert.equal(endpoints.workers.length, 1)
  assert.equal(endpoints.faultSubscriptions, 0)
  await assert.rejects(runtime.dispose(), /worker endpoint factory/)
})

test('runtime snapshot validation rejects malformed nested DTOs before mirroring', () => {
  const failure = {
    code: 'validation-failed',
    message: 'The task failed validation',
    retryable: true,
    details: { attempt: 1 },
  }
  const task = {
    taskId: 'task-1',
    sessionId: 'session-1',
    parentTaskId: 'task-parent',
    supersedesTaskId: 'task-old',
    phase: 'WAITING_USER',
    createdAt: 1,
    updatedAt: 2,
    repairAttempts: 1,
    question: {
      questionId: 'question-1',
      prompt: 'Continue?',
      responseSchema: { type: 'boolean' },
    },
    failure,
  }
  const snapshot = {
    schemaVersion: 1,
    binding,
    status: 'ready',
    phase: 'WAITING_USER',
    revision: 3,
    activeTask: task,
    tasks: [task],
    failure,
  }

  assert.deepEqual(runtimeModule.parseRuntimeSnapshot(structuredClone(snapshot)), snapshot)

  const invalidSnapshots = [
    { ...snapshot, binding: { ...binding, unknown: true } },
    { ...snapshot, status: 'running' },
    { ...snapshot, phase: 'UNKNOWN' },
    { ...snapshot, revision: Number.POSITIVE_INFINITY },
    { ...snapshot, tasks: {} },
    { ...snapshot, activeTask: { ...task, unknown: true } },
    { ...snapshot, activeTask: { ...task, phase: 'UNKNOWN' } },
    { ...snapshot, activeTask: { ...task, createdAt: 'now' } },
    { ...snapshot, activeTask: { ...task, updatedAt: Number.NaN } },
    { ...snapshot, activeTask: { ...task, repairAttempts: 'one' } },
    { ...snapshot, activeTask: { ...task, parentTaskId: '' } },
    { ...snapshot, activeTask: { ...task, question: { ...task.question, unknown: true } } },
    { ...snapshot, activeTask: { ...task, question: { ...task.question, prompt: '' } } },
    { ...snapshot, activeTask: { ...task, question: { ...task.question, responseSchema: [] } } },
    { ...snapshot, failure: { ...failure, unknown: true } },
    { ...snapshot, failure: { ...failure, retryable: 'yes' } },
    { ...snapshot, failure: { ...failure, details: [] } },
  ]
  for (const invalid of invalidSnapshots) assert.throws(() => runtimeModule.parseRuntimeSnapshot(invalid))
})

test('restart initialization failure transitions to FAILED and cleans up the failed transport', async () => {
  const endpoints = createEndpointFactory([[]])
  let terminations = 0
  let attempts = 0
  const runtime = runtimeModule.createAgentRuntimeInternal({
    binding,
    worker() {
      attempts += 1
      if (attempts > 1) throw new Error('restart worker failed')
      const endpoint = endpoints.factory()
      return {
        port: endpoint.port,
        onFault: listener => endpoint.onFault(listener),
        terminate() {
          terminations += 1
          endpoint.terminate()
        },
      }
    },
    host: new hostModule.FakeAgentHost(),
    persistence: new persistenceModule.MemoryAgentPersistence(),
    clock: fixturesModule.createDeterministicClock(),
    idFactory: fixturesModule.createDeterministicIdFactory('main-restart-failure-'),
  })
  await runtime.ready()

  await assert.rejects(runtime.restart(), /restart worker failed/)
  assert.equal(runtime.getSnapshot().status, 'failed')
  assert.equal(runtime.getSnapshot().phase, 'FAILED')
  assert.equal(runtime.getSnapshot().failure.code, 'worker-initialization-failed')
  assert.equal(terminations, 1)
  await assert.rejects(runtime.ready(), /restart worker failed/)
  await assert.rejects(runtime.dispose(), /restart worker failed/)
})

test('testing fakes preserve serializable generations and deterministic values', async () => {
  const clock = fixturesModule.createDeterministicClock(10, 2)
  const ids = fixturesModule.createDeterministicIdFactory()
  assert.deepEqual([clock.now(), clock.now()], [12, 14])
  assert.deepEqual([ids.next('task'), ids.next('task')], ['task-1', 'task-2'])

  const persistence = new persistenceModule.MemoryAgentPersistence()
  const committed = await persistence.commit({
    schemaVersion: 1,
    ...binding,
    batchId: 'batch-1',
    expectedDraftGeneration: 0,
    records: [{ recordId: 'record-1', kind: 'test', value: { stable: true } }],
  })
  assert.equal(committed.status, 'committed')
  assert.equal(
    (await persistence.read({ schemaVersion: 1, ...binding, expectedDraftGeneration: 1 })).draftGeneration,
    1,
  )
})
