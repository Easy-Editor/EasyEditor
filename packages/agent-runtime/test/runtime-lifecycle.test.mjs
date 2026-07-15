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
  return {
    workers,
    factory() {
      const { port1, port2 } = new MessageChannel()
      const worker = new Worker(workerScript, {
        workerData: { emittedRoot, port: port2, steps: scripts.shift() ?? [] },
        transferList: [port2],
      })
      workers.push(worker)
      return { port: port1, terminate: () => void worker.terminate() }
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
