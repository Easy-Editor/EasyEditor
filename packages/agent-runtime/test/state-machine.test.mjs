import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceRoot = join(packageRoot, 'src')
const compiledRoot = await mkdtemp(join(tmpdir(), 'easy-editor-agent-runtime-'))

const compileDirectory = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const inputPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      await compileDirectory(inputPath)
      continue
    }
    if (!entry.name.endsWith('.ts')) continue
    const outputPath = join(compiledRoot, relative(sourceRoot, inputPath).replace(/\.ts$/, '.js'))
    await mkdir(dirname(outputPath), { recursive: true })
    const result = ts.transpileModule(await readFile(inputPath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: inputPath,
    })
    await writeFile(outputPath, result.outputText)
  }
}

await writeFile(join(compiledRoot, 'package.json'), '{"type":"module"}\n')
await compileDirectory(sourceRoot)
after(() => rm(compiledRoot, { recursive: true, force: true }))

const { createWorkerStateMachine, WorkerStateMachineError } = await import(
  pathToFileURL(join(compiledRoot, 'internal/state-machine/index.js'))
)
const { ScriptedModelAdapter, ScriptedModelError } = await import(
  pathToFileURL(join(compiledRoot, 'internal/testing/scripted-model.js'))
)
const { FakeAgentHost } = await import(pathToFileURL(join(compiledRoot, 'internal/testing/fake-agent-host.js')))
const { MemoryAgentPersistence } = await import(
  pathToFileURL(join(compiledRoot, 'internal/testing/memory-agent-persistence.js'))
)
const { HostSnapshotDeltaApplyError, applyHostSnapshotDelta } = await import(
  pathToFileURL(join(compiledRoot, 'internal/snapshot/index.js'))
)

const binding = { projectId: 'project-1', branchId: 'branch-1' }

const createClock = () => {
  let current = 0
  return { now: () => ++current }
}

const createIds = () => {
  const counts = new Map()
  return {
    next(kind) {
      const next = (counts.get(kind) ?? 0) + 1
      counts.set(kind, next)
      return `${kind}-${next}`
    },
  }
}

class TestPersistence {
  generation = 0
  records = []
  commits = []

  async read(request) {
    return {
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      sessionId: request.sessionId,
      persistenceGeneration: this.generation,
      records: structuredClone(this.records),
    }
  }

  async commit(batch) {
    const clone = structuredClone(batch)
    this.commits.push(clone)
    assert.equal(batch.expectedPersistenceGeneration, this.generation)
    this.generation += 1
    const records = new Map(this.records.map(record => [record.recordId, record]))
    for (const record of clone.records) records.set(record.recordId, record)
    this.records = [...records.values()]
    return {
      schemaVersion: 1,
      batchId: batch.batchId,
      status: 'committed',
      persistenceGeneration: this.generation,
    }
  }
}

class TestHost {
  revision = 'r0'
  observations = []
  invocations = []
  receipts = new Map()
  behaviors = []

  async observe(request) {
    this.observations.push(structuredClone(request))
    return {
      schemaVersion: 1,
      revision: this.revision,
      providerGenerations: { stable: 1 },
      projection: { stable: true },
    }
  }

  async describeCapability(request) {
    return { schemaVersion: 1, capability: request.capability, revision: 'schema-1', input: {} }
  }

  async invoke(call) {
    this.invocations.push(structuredClone(call))
    const behavior = this.behaviors.shift() ?? {}
    if (behavior.wait) await behavior.wait
    this.revision = behavior.observedRevision ?? `r${this.invocations.length}`
    return {
      schemaVersion: 1,
      callId: call.callId,
      status: behavior.status ?? 'applied',
      ...(behavior.resultRevision === null ? {} : { revision: behavior.resultRevision ?? this.revision }),
    }
  }

  async queryReceipt(request) {
    return this.receipts.get(request.callId) ?? null
  }
}

const call = ({ task = 1, step = 1, callId = 1, revision = 'r0' } = {}) => ({
  schemaVersion: 1,
  projectId: binding.projectId,
  branchId: binding.branchId,
  sessionId: 'session-1',
  taskId: `task-${task}`,
  stepId: `step-${step}`,
  callId: `call-${callId}`,
  capability: 'set-title',
  arguments: { title: 'City overview' },
  expectedRevision: revision,
})

const blueprint = { schemaVersion: 1, kind: 'blueprint', summary: 'Update the dashboard' }
const complete = { schemaVersion: 1, kind: 'complete', summary: 'Done' }
const toolCall = value => ({ schemaVersion: 1, kind: 'tool-call', call: value })

const hostSnapshot = (revision = 'r0', cursor = 'cursor-0', value = 'before', providerGeneration = 1) => ({
  schemaVersion: 1,
  revision,
  cursor,
  providerGenerations: { 'dashboard.core': providerGeneration },
  projection: {
    'dashboard.core': {
      nodes: { 'node-1': { props: { title: value, values: [1, 2] } } },
    },
  },
})

const hostDelta = (overrides = {}) => ({
  schemaVersion: 1,
  baseRevision: 'r0',
  newRevision: 'r1',
  providerId: 'dashboard.core',
  providerGeneration: 1,
  baseCursor: 'cursor-0',
  newCursor: 'cursor-1',
  changes: [{ op: 'set', path: ['nodes', 'node-1', 'props', 'title'], value: 'after' }],
  ...overrides,
})

const createMachine = (steps, overrides = {}) => {
  const model = new ScriptedModelAdapter(steps)
  const host = overrides.host ?? new TestHost()
  const persistence = overrides.persistence ?? new TestPersistence()
  const phases = []
  const machine = createWorkerStateMachine({
    binding,
    model,
    host,
    persistence,
    clock: createClock(),
    idFactory: createIds(),
    repairBudget: overrides.repairBudget,
    onSnapshot: snapshot => phases.push(snapshot.phase),
  })
  return { machine, model, host, persistence, phases }
}

const waitForPhase = async (machine, phase) => {
  if (machine.getSnapshot().phase === phase) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out waiting for ${phase}`))
    }, 1_000)
    const unsubscribe = machine.subscribe(snapshot => {
      if (snapshot.phase !== phase) return
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}

const assertOrdered = (actual, expected) => {
  let cursor = 0
  for (const value of actual) {
    if (value === expected[cursor]) cursor += 1
  }
  assert.equal(cursor, expected.length, `missing ordered phases: ${expected.slice(cursor).join(', ')}`)
}

test('runs the deterministic happy path and commits a serializable checkpoint', async () => {
  const fixture = createMachine([
    { expectedPhase: 'BLUEPRINT', events: [blueprint] },
    { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
  ])

  const ref = await fixture.machine.submit({ text: 'Update the dashboard' })
  await fixture.machine.waitForIdle()

  assert.deepEqual(ref, { taskId: 'task-1', sessionId: 'session-1' })
  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(fixture.persistence.commits.length, 1)
  assert.equal(fixture.persistence.records[0].value.phase, 'COMPLETED')
  assert.deepEqual(
    fixture.host.observations.map(observation => observation.mode),
    ['full', 'full'],
  )
  assertOrdered(fixture.phases, ['OBSERVE', 'BLUEPRINT', 'PLAN_STEP', 'EXECUTE', 'VERIFY', 'CHECKPOINT', 'COMPLETED'])
  fixture.model.assertFullyConsumed()
})

for (const code of ['quota-exceeded', 'transaction-aborted']) {
  test(`pauses with an unsaved retryable failure when persistence throws ${code}`, async () => {
    const persistence = new TestPersistence()
    persistence.commit = async () => {
      const error = new Error(`injected ${code}`)
      error.code = code
      throw error
    }
    const fixture = createMachine(
      [
        { expectedPhase: 'BLUEPRINT', events: [blueprint] },
        { expectedPhase: 'PLAN_STEP', events: [complete] },
      ],
      { persistence },
    )

    await fixture.machine.submit({ text: `Pause after ${code}` })
    await fixture.machine.waitForIdle()

    const snapshot = fixture.machine.getSnapshot()
    assert.equal(snapshot.status, 'ready')
    assert.equal(snapshot.phase, 'PAUSED')
    assert.deepEqual(snapshot.activeTask.failure, {
      code,
      message: `injected ${code}`,
      retryable: true,
    })
    assertOrdered(fixture.phases, ['CHECKPOINT', 'PAUSED'])
    fixture.model.assertFullyConsumed()
  })
}

test('generation-conflict refreshes the persistence clock before an explicit resume', async () => {
  const commits = []
  const persistence = {
    generation: 1,
    async read(request) {
      return {
        schemaVersion: 1,
        projectId: request.projectId,
        branchId: request.branchId,
        sessionId: request.sessionId,
        persistenceGeneration: this.generation,
        records: [],
      }
    },
    async commit(batch) {
      commits.push(structuredClone(batch))
      if (batch.expectedPersistenceGeneration !== this.generation) {
        return {
          schemaVersion: 1,
          batchId: batch.batchId,
          status: 'generation-conflict',
          persistenceGeneration: this.generation,
        }
      }
      this.generation += 1
      return {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'committed',
        persistenceGeneration: this.generation,
      }
    },
  }
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [complete] },
      { expectedPhase: 'PLAN_STEP', events: [complete] },
    ],
    { persistence },
  )

  const task = await fixture.machine.submit({ text: 'Recover the persistence clock' })
  await fixture.machine.waitForIdle()
  assert.equal(fixture.machine.getSnapshot().phase, 'PAUSED')
  assert.equal(fixture.machine.getSnapshot().activeTask.failure.code, 'generation-conflict')

  await fixture.machine.resume(task.taskId)
  await fixture.machine.waitForIdle()
  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.deepEqual(
    commits.map(batch => batch.expectedPersistenceGeneration),
    [0, 1],
  )
  fixture.model.assertFullyConsumed()
})

test('cancel during a pending checkpoint appends a durable cancellation that survives restart', async () => {
  let releaseCommit
  let checkpointStarted
  const durable = new MemoryAgentPersistence()
  const started = new Promise(resolve => {
    checkpointStarted = resolve
  })
  let gateCompletion = true
  const persistence = {
    read: request => durable.read(request),
    async commit(batch) {
      const phase = batch.records.find(record => record.kind === 'agent-runtime-task')?.value?.phase
      if (phase === 'COMPLETED' && gateCompletion) {
        gateCompletion = false
        checkpointStarted()
        await new Promise(resolve => {
          releaseCommit = resolve
        })
      }
      return durable.commit(batch)
    },
  }
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [complete] },
    ],
    { persistence },
  )

  const task = await fixture.machine.submit({ text: 'Cancel while checkpointing' })
  await waitForPhase(fixture.machine, 'CHECKPOINT')
  await started
  const cancellation = fixture.machine.cancel(task.taskId)
  releaseCommit()
  await cancellation

  assert.equal(fixture.machine.getSnapshot().phase, 'CANCELLED')
  assert.equal(fixture.machine.getSnapshot().activeTask.phase, 'CANCELLED')
  assert.deepEqual(
    (
      await durable.read({
        schemaVersion: 1,
        projectId: binding.projectId,
        branchId: binding.branchId,
        sessionId: task.sessionId,
        expectedPersistenceGeneration: 2,
      })
    ).records.map(record => [record.recordId, record.value.phase]),
    [[`task:${task.taskId}`, 'CANCELLED']],
  )

  const recovered = createMachine([], { persistence: durable })
  await recovered.machine.recover()
  assert.equal(recovered.machine.getSnapshot().phase, 'CANCELLED')
  assert.equal(recovered.machine.getSnapshot().activeTask.taskId, task.taskId)
  fixture.model.assertFullyConsumed()
})

test('a failed durable cancellation remains pending and a second cancel retries it', async () => {
  let releaseCheckpoint
  let checkpointStarted
  let cancelConflicts = 1
  const persistence = new TestPersistence()
  const originalCommit = persistence.commit.bind(persistence)
  persistence.commit = async batch => {
    const phase = batch.records.find(record => record.kind === 'agent-runtime-task')?.value?.phase
    if (phase === 'COMPLETED') {
      checkpointStarted?.()
      await new Promise(resolve => {
        releaseCheckpoint = resolve
      })
    }
    if (phase === 'CANCELLED' && cancelConflicts > 0) {
      cancelConflicts -= 1
      persistence.generation += 1
      return {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'generation-conflict',
        persistenceGeneration: persistence.generation,
      }
    }
    return originalCommit(batch)
  }
  const started = new Promise(resolve => {
    checkpointStarted = resolve
  })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [complete] },
    ],
    { persistence },
  )

  const task = await fixture.machine.submit({ text: 'Retry durable cancel' })
  await started
  const firstCancellation = fixture.machine.cancel(task.taskId)
  releaseCheckpoint()
  await assert.rejects(
    firstCancellation,
    error => error instanceof WorkerStateMachineError && error.code === 'persistence-failed',
  )
  assert.equal(persistence.records.find(record => record.recordId === `task:${task.taskId}`)?.value.phase, 'COMPLETED')

  await fixture.machine.cancel(task.taskId)
  assert.equal(persistence.records.find(record => record.recordId === `task:${task.taskId}`)?.value.phase, 'CANCELLED')
  assert.equal(fixture.machine.getSnapshot().activeTask.failure, undefined)

  const recovered = createMachine([], { persistence })
  await recovered.machine.recover()
  assert.equal(recovered.machine.getSnapshot().phase, 'CANCELLED')
})

test('a failed durable pause remains pending and a second pause retries it', async () => {
  let pauseConflicts = 1
  const persistence = new TestPersistence()
  const originalCommit = persistence.commit.bind(persistence)
  persistence.commit = async batch => {
    const phase = batch.records.find(record => record.kind === 'agent-runtime-task')?.value?.phase
    if (phase === 'PAUSED' && pauseConflicts > 0) {
      pauseConflicts -= 1
      persistence.generation += 1
      return {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'generation-conflict',
        persistenceGeneration: persistence.generation,
      }
    }
    return originalCommit(batch)
  }
  const fixture = createMachine([{ expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' }], { persistence })
  const task = await fixture.machine.submit({ text: 'Retry durable pause' })
  await waitForPhase(fixture.machine, 'BLUEPRINT')

  await assert.rejects(
    fixture.machine.pause(task.taskId),
    error => error instanceof WorkerStateMachineError && error.code === 'persistence-failed',
  )
  assert.equal(fixture.machine.getSnapshot().activeTask.failure.code, 'generation-conflict')

  await fixture.machine.pause(task.taskId)
  assert.equal(persistence.records.find(record => record.recordId === `task:${task.taskId}`)?.value.phase, 'PAUSED')
  assert.equal(fixture.machine.getSnapshot().activeTask.failure, undefined)
})

test('a failed disposal can retry pending durable control state without reporting a false success', async () => {
  let cancelConflicts = 2
  const persistence = new TestPersistence()
  const originalCommit = persistence.commit.bind(persistence)
  persistence.commit = async batch => {
    const phase = batch.records.find(record => record.kind === 'agent-runtime-task')?.value?.phase
    if (phase === 'CANCELLED' && cancelConflicts > 0) {
      cancelConflicts -= 1
      persistence.generation += 1
      return {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'generation-conflict',
        persistenceGeneration: persistence.generation,
      }
    }
    return originalCommit(batch)
  }
  const fixture = createMachine([{ expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' }], { persistence })
  const task = await fixture.machine.submit({ text: 'Retry disposal durability' })
  await waitForPhase(fixture.machine, 'BLUEPRINT')

  await assert.rejects(
    fixture.machine.cancel(task.taskId),
    error => error instanceof WorkerStateMachineError && error.code === 'persistence-failed',
  )
  await assert.rejects(
    fixture.machine.dispose(),
    error => error instanceof WorkerStateMachineError && error.code === 'persistence-failed',
  )
  assert.equal(
    persistence.records.find(record => record.recordId === `task:${task.taskId}`),
    undefined,
  )

  await fixture.machine.dispose()
  await fixture.machine.dispose()
  assert.equal(persistence.records.find(record => record.recordId === `task:${task.taskId}`)?.value.phase, 'CANCELLED')
  assert.equal(fixture.machine.getSnapshot().status, 'disposed')
})

test('a new task drains a failed explicit cancellation without claiming supersession', async () => {
  let cancelConflicts = 1
  const persistence = new TestPersistence()
  const originalCommit = persistence.commit.bind(persistence)
  persistence.commit = async batch => {
    const phase = batch.records.find(record => record.kind === 'agent-runtime-task')?.value?.phase
    if (phase === 'CANCELLED' && cancelConflicts > 0) {
      cancelConflicts -= 1
      persistence.generation += 1
      return {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'generation-conflict',
        persistenceGeneration: persistence.generation,
      }
    }
    return originalCommit(batch)
  }
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' },
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [complete] },
    ],
    { persistence },
  )
  const first = await fixture.machine.submit({ text: 'Cancel explicitly' })
  await waitForPhase(fixture.machine, 'BLUEPRINT')
  await assert.rejects(
    fixture.machine.cancel(first.taskId),
    error => error instanceof WorkerStateMachineError && error.code === 'persistence-failed',
  )

  const second = await fixture.machine.submit({ text: 'Start an unrelated task' })
  await fixture.machine.waitForIdle()
  assert.equal(second.parentTaskId, first.taskId)
  assert.equal(second.supersedesTaskId, undefined)
  assert.deepEqual(
    persistence.records.map(record => [record.recordId, record.value.phase]),
    [
      [`task:${first.taskId}`, 'CANCELLED'],
      [`task:${second.taskId}`, 'COMPLETED'],
    ],
  )
})

test('a failed supersession cancellation must become durable before retry creates the next task', async () => {
  let releaseCheckpoint
  let checkpointStarted
  let cancelConflicts = 1
  const persistence = new TestPersistence()
  const originalCommit = persistence.commit.bind(persistence)
  persistence.commit = async batch => {
    const phase = batch.records.find(record => record.kind === 'agent-runtime-task')?.value?.phase
    if (phase === 'COMPLETED' && releaseCheckpoint === undefined) {
      checkpointStarted?.()
      await new Promise(resolve => {
        releaseCheckpoint = resolve
      })
    }
    if (phase === 'CANCELLED' && cancelConflicts > 0) {
      cancelConflicts -= 1
      persistence.generation += 1
      return {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'generation-conflict',
        persistenceGeneration: persistence.generation,
      }
    }
    return originalCommit(batch)
  }
  const started = new Promise(resolve => {
    checkpointStarted = resolve
  })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [complete] },
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [complete] },
    ],
    { persistence },
  )

  const first = await fixture.machine.submit({ text: 'First task' })
  await started
  const failedSupersession = fixture.machine.submit({ text: 'Refine it' })
  releaseCheckpoint()
  await assert.rejects(
    failedSupersession,
    error => error instanceof WorkerStateMachineError && error.code === 'persistence-failed',
  )

  const second = await fixture.machine.submit({ text: 'Refine it' })
  await fixture.machine.waitForIdle()
  assert.equal(second.supersedesTaskId, first.taskId)
  assert.deepEqual(
    persistence.records.map(record => [record.recordId, record.value.phase]),
    [
      [`task:${first.taskId}`, 'CANCELLED'],
      [`task:${second.taskId}`, 'COMPLETED'],
    ],
  )
})

test('waitForIdle and dispose drain a gated durable cancellation', async () => {
  let releaseCancellation
  let cancellationStarted
  const persistence = new TestPersistence()
  const originalCommit = persistence.commit.bind(persistence)
  const started = new Promise(resolve => {
    cancellationStarted = resolve
  })
  persistence.commit = async batch => {
    const phase = batch.records.find(record => record.kind === 'agent-runtime-task')?.value?.phase
    if (phase === 'CANCELLED') {
      cancellationStarted()
      await new Promise(resolve => {
        releaseCancellation = resolve
      })
    }
    return originalCommit(batch)
  }
  const fixture = createMachine([{ expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' }], { persistence })
  const task = await fixture.machine.submit({ text: 'Drain cancellation' })
  await waitForPhase(fixture.machine, 'BLUEPRINT')

  const cancellation = fixture.machine.cancel(task.taskId)
  await started
  let idleResolved = false
  let disposeResolved = false
  const idle = fixture.machine.waitForIdle().then(() => {
    idleResolved = true
  })
  const disposal = fixture.machine.dispose().then(() => {
    disposeResolved = true
  })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(idleResolved, false)
  assert.equal(disposeResolved, false)

  releaseCancellation()
  await Promise.all([cancellation, idle, disposal])
  assert.equal(persistence.records.find(record => record.recordId === `task:${task.taskId}`)?.value.phase, 'CANCELLED')
})

test('immutable host delta application preserves ordered equivalence without aliases', () => {
  const base = hostSnapshot()
  const arrayValue = [7, 8, 9]
  const first = applyHostSnapshotDelta(
    base,
    hostDelta({
      changes: [
        { op: 'set', path: ['nodes', 'node-1', 'props', 'title'], value: 'middle' },
        { op: 'set', path: ['nodes', 'node-1', 'props', 'values'], value: arrayValue },
      ],
    }),
  )
  const second = applyHostSnapshotDelta(
    first,
    hostDelta({
      baseRevision: 'r1',
      newRevision: 'r2',
      baseCursor: 'cursor-1',
      newCursor: 'cursor-2',
      changes: [
        { op: 'set', path: ['nodes', 'node-1', 'props', 'title'], value: 'after' },
        { op: 'remove', path: ['nodes', 'node-1', 'props', 'values'] },
      ],
    }),
  )

  arrayValue.push(10)
  assert.equal(base.projection['dashboard.core'].nodes['node-1'].props.title, 'before')
  assert.deepEqual(first.projection['dashboard.core'].nodes['node-1'].props.values, [7, 8, 9])
  assert.deepEqual(second, {
    schemaVersion: 1,
    revision: 'r2',
    cursor: 'cursor-2',
    providerGenerations: { 'dashboard.core': 1 },
    projection: { 'dashboard.core': { nodes: { 'node-1': { props: { title: 'after' } } } } },
  })
  assert.ok(Object.isFrozen(second))
  assert.ok(Object.isFrozen(second.providerGenerations))
  assert.ok(Object.isFrozen(second.projection['dashboard.core']))

  const noOp = applyHostSnapshotDelta(
    base,
    hostDelta({ newRevision: base.revision, newCursor: 'cursor-no-op', changes: [] }),
  )
  assert.deepEqual(noOp.projection, base.projection)
  assert.deepEqual(noOp.providerGenerations, base.providerGenerations)
  assert.notEqual(noOp.projection, base.projection)
  assert.equal(noOp.revision, base.revision)
  assert.equal(noOp.cursor, 'cursor-no-op')
})

test('host delta application rejects fence, path, remove, overlap, prototype, and array traversal errors', () => {
  const base = hostSnapshot()
  const invalid = [
    hostDelta({ baseRevision: 'stale' }),
    hostDelta({ baseCursor: 'stale-cursor' }),
    hostDelta({ providerGeneration: 2 }),
    hostDelta({ newCursor: 'cursor-0' }),
    hostDelta({ newRevision: 'r0' }),
    hostDelta({ providerId: 'missing' }),
    hostDelta({ providerId: '__proto__' }),
    hostDelta({ changes: [{ op: 'remove', path: ['nodes', 'missing'] }] }),
    hostDelta({ changes: [{ op: 'set', path: ['nodes', 'node-1', 'props', 'values', '0'], value: 7 }] }),
    hostDelta({
      changes: [
        { op: 'set', path: ['nodes', 'node-1'], value: {} },
        { op: 'remove', path: ['nodes', 'node-1', 'props'] },
      ],
    }),
    hostDelta({
      changes: [
        { op: 'set', path: ['nodes', 'node-1', 'props', 'title'], value: 'first' },
        { op: 'set', path: ['nodes', 'node-1', 'props', 'title'], value: 'second' },
      ],
    }),
    hostDelta({ changes: [{ op: 'set', path: ['nodes', '__proto__'], value: {} }] }),
  ]

  for (const delta of invalid) {
    assert.throws(
      () => applyHostSnapshotDelta(base, delta),
      error => error instanceof HostSnapshotDeltaApplyError || error.code === 'invalid-field',
    )
  }
})

test('FakeAgentHost scripts deltas and advances its full mirror only for valid patches', async () => {
  const base = hostSnapshot()
  const delta = hostDelta()
  const host = new FakeAgentHost({ snapshot: base, observationSteps: [delta] })
  const request = {
    schemaVersion: 1,
    projectId: binding.projectId,
    branchId: binding.branchId,
    sessionId: 'session-1',
    taskId: 'task-1',
    mode: 'delta',
    cursor: base.cursor,
  }

  assert.deepEqual(await host.observe(request), delta)
  assert.deepEqual(await host.observe({ ...request, mode: 'full' }), applyHostSnapshotDelta(base, delta))
  assert.deepEqual(
    host.observations.map(observation => observation.mode),
    ['delta', 'full'],
  )
})

test('post-invoke verification applies an exact delta before the next model turn', async () => {
  const base = hostSnapshot()
  const delta = hostDelta()
  const host = new FakeAgentHost({
    snapshot: base,
    observationSteps: [base, delta],
    invocationSteps: [{ result: { schemaVersion: 1, callId: 'call-1', status: 'applied', revision: 'r1' } }],
  })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call())] },
      {
        expectedPhase: 'PLAN_STEP',
        matchRequest: request =>
          request.snapshot.revision === 'r1' &&
          request.snapshot.cursor === 'cursor-1' &&
          request.snapshot.projection['dashboard.core'].nodes['node-1'].props.title === 'after',
        events: [complete],
      },
    ],
    { host },
  )

  await fixture.machine.submit({ text: 'Apply a delta' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.deepEqual(
    host.observations.map(observation => [observation.mode, observation.cursor]),
    [
      ['full', undefined],
      ['delta', 'cursor-0'],
    ],
  )
  fixture.model.assertFullyConsumed()
})

test('lost, reordered, cursor-mismatched, and malformed deltas force an immediate full observation', async () => {
  const scenarios = [
    ['lost base revision', hostDelta({ baseRevision: 'r-lost' })],
    ['reordered revision', hostDelta({ baseRevision: 'r-previous', baseCursor: 'cursor-previous' })],
    ['cursor mismatch', hostDelta({ baseCursor: 'cursor-other' })],
    ['stationary cursor', hostDelta({ newCursor: 'cursor-0' })],
    ['stationary revision with changes', hostDelta({ newRevision: 'r0' })],
    ['provider generation mismatch', hostDelta({ providerGeneration: 2 })],
    ['malformed remove', hostDelta({ changes: [{ op: 'remove', path: ['nodes', 'missing'] }] })],
  ]

  for (const [label, invalidDelta] of scenarios) {
    const base = hostSnapshot()
    const recovered = hostSnapshot('r2', 'cursor-2', `full-${label}`, label === 'provider generation mismatch' ? 2 : 1)
    const host = new FakeAgentHost({
      snapshot: base,
      observationSteps: [base, invalidDelta, recovered],
      invocationSteps: [{ result: { schemaVersion: 1, callId: 'call-1', status: 'applied', revision: 'r2' } }],
    })
    const fixture = createMachine(
      [
        { expectedPhase: 'BLUEPRINT', events: [blueprint] },
        { expectedPhase: 'PLAN_STEP', events: [toolCall(call())] },
        {
          expectedPhase: 'PLAN_STEP',
          matchRequest: request =>
            request.snapshot.revision === 'r2' &&
            request.snapshot.projection['dashboard.core'].nodes['node-1'].props.title === `full-${label}`,
          events: [complete],
        },
      ],
      { host },
    )

    await fixture.machine.submit({ text: label })
    await fixture.machine.waitForIdle()

    assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED', label)
    assert.deepEqual(
      host.observations.map(observation => observation.mode),
      ['full', 'delta', 'full'],
      label,
    )
    fixture.model.assertFullyConsumed()
  }
})

test('a later provider generation transition falls back to one full observation', async () => {
  const base = hostSnapshot()
  const firstDelta = hostDelta()
  const generationMismatch = hostDelta({
    baseRevision: 'r1',
    newRevision: 'r2',
    baseCursor: 'cursor-1',
    newCursor: 'cursor-2',
    providerGeneration: 2,
    changes: [{ op: 'set', path: ['nodes', 'node-1', 'props', 'title'], value: 'must-not-apply' }],
  })
  const recovered = hostSnapshot('r3', 'cursor-3', 'full-generation-2', 2)
  const host = new FakeAgentHost({
    snapshot: base,
    observationSteps: [base, firstDelta, generationMismatch, recovered],
    invocationSteps: [
      { result: { schemaVersion: 1, callId: 'call-1', status: 'applied', revision: 'r1' } },
      { result: { schemaVersion: 1, callId: 'call-2', status: 'applied', revision: 'r3' } },
    ],
  })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call())] },
      {
        expectedPhase: 'PLAN_STEP',
        matchRequest: request => request.snapshot.revision === 'r1',
        events: [toolCall(call({ step: 2, callId: 2, revision: 'r1' }))],
      },
      {
        expectedPhase: 'PLAN_STEP',
        matchRequest: request =>
          request.snapshot.revision === 'r3' &&
          request.snapshot.providerGenerations['dashboard.core'] === 2 &&
          request.snapshot.projection['dashboard.core'].nodes['node-1'].props.title === 'full-generation-2',
        events: [complete],
      },
    ],
    { host },
  )

  await fixture.machine.submit({ text: 'Advance provider generation' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.deepEqual(
    host.observations.map(observation => observation.mode),
    ['full', 'delta', 'delta', 'full'],
  )
  fixture.model.assertFullyConsumed()
})

test('a transport or protocol rejection propagates without being hidden by a full resync', async () => {
  const base = hostSnapshot()
  class RejectingDeltaHost extends FakeAgentHost {
    async observe(request) {
      if (request.mode === 'delta') {
        this.observations.push(structuredClone(request))
        throw Object.assign(new Error('malformed delta response'), { code: 'invalid-field' })
      }
      return super.observe(request)
    }
  }
  const host = new RejectingDeltaHost({
    snapshot: base,
    observationSteps: [base],
    invocationSteps: [{ result: { schemaVersion: 1, callId: 'call-1', status: 'applied', revision: 'r2' } }],
  })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call())] },
    ],
    { host },
  )

  await fixture.machine.submit({ text: 'Reject malformed transport delta' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'FAILED')
  assert.deepEqual(
    host.observations.map(observation => observation.mode),
    ['full', 'delta'],
  )
  fixture.model.assertFullyConsumed()
})

test('repairs a verification mismatch within the configured budget', async () => {
  const host = new TestHost()
  host.behaviors.push(
    { observedRevision: 'r2', resultRevision: 'r1' },
    { observedRevision: 'r3', resultRevision: 'r3' },
  )
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call())] },
      {
        expectedPhase: 'REPAIR',
        events: [toolCall(call({ step: 2, callId: 2, revision: 'r2' })), complete],
      },
    ],
    { host, repairBudget: 1 },
  )

  await fixture.machine.submit({ text: 'Repair stale output' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(fixture.machine.getSnapshot().activeTask.repairAttempts, 1)
  assert.equal(host.invocations.length, 2)
  assertOrdered(fixture.phases, ['VERIFY', 'REPAIR', 'EXECUTE', 'VERIFY', 'CHECKPOINT'])
  fixture.model.assertFullyConsumed()
})

test('pauses after exhausting the repair budget', async () => {
  const host = new TestHost()
  host.behaviors.push({ observedRevision: 'r2', resultRevision: 'r1' })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call())] },
    ],
    { host, repairBudget: 0 },
  )

  await fixture.machine.submit({ text: 'Do not repair forever' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'PAUSED')
  assert.equal(fixture.machine.getSnapshot().activeTask.failure.code, 'repair-budget-exhausted')
  fixture.model.assertFullyConsumed()
})

test('pause/resume aborts the current turn and re-observes before replanning', async () => {
  const fixture = createMachine([
    { expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' },
    { expectedPhase: 'BLUEPRINT', events: [blueprint] },
    { expectedPhase: 'PLAN_STEP', events: [complete] },
  ])
  const ref = await fixture.machine.submit({ text: 'Pause me' })
  await waitForPhase(fixture.machine, 'BLUEPRINT')

  await fixture.machine.pause(ref.taskId)
  assert.equal(fixture.machine.getSnapshot().phase, 'PAUSED')
  await fixture.machine.resume(ref.taskId)
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(fixture.host.observations.length, 2)
  assert.ok(fixture.host.observations.every(observation => observation.mode === 'full'))
  assertOrdered(fixture.phases, ['PAUSED', 'OBSERVE', 'BLUEPRINT', 'PLAN_STEP', 'CHECKPOINT'])
  fixture.model.assertFullyConsumed()
})

test('respond accepts only the matching WAITING_USER question and keeps the task', async () => {
  const question = {
    schemaVersion: 1,
    kind: 'question',
    question: { questionId: 'question-1', prompt: 'Which KPI?' },
  }
  const fixture = createMachine([
    { expectedPhase: 'BLUEPRINT', events: [question] },
    {
      expectedPhase: 'BLUEPRINT',
      matchRequest: request => request.response?.questionId === 'question-1',
      events: [blueprint],
    },
    { expectedPhase: 'PLAN_STEP', events: [complete] },
  ])
  const ref = await fixture.machine.submit({ text: 'Ask first' })
  await waitForPhase(fixture.machine, 'WAITING_USER')

  await assert.rejects(
    fixture.machine.respond(ref.taskId, { questionId: 'wrong', value: 'revenue' }),
    error => error instanceof WorkerStateMachineError && error.code === 'invalid-task-phase',
  )
  await fixture.machine.respond(ref.taskId, { questionId: 'question-1', value: 'revenue' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().activeTask.taskId, ref.taskId)
  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(fixture.host.observations.length, 2)
  assert.ok(fixture.host.observations.every(observation => observation.mode === 'full'))
  fixture.model.assertFullyConsumed()
})

test('cancel stops future work and active submit records ancestry and supersession', async () => {
  const fixture = createMachine([
    { expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' },
    { expectedPhase: 'BLUEPRINT', events: [blueprint] },
    { expectedPhase: 'PLAN_STEP', events: [complete] },
  ])
  const first = await fixture.machine.submit({ text: 'First task' })
  await waitForPhase(fixture.machine, 'BLUEPRINT')
  const second = await fixture.machine.submit({ text: 'Refine it' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.host.invocations.length, 0)
  assert.deepEqual(second, {
    taskId: 'task-2',
    sessionId: 'session-1',
    parentTaskId: first.taskId,
    supersedesTaskId: first.taskId,
  })
  assert.deepEqual(
    fixture.machine.getSnapshot().tasks.map(task => [task.taskId, task.phase]),
    [
      ['task-1', 'CANCELLED'],
      ['task-2', 'COMPLETED'],
    ],
  )
  assert.deepEqual(
    fixture.persistence.records.map(record => [record.recordId, record.value.phase]),
    [
      ['task:task-1', 'CANCELLED'],
      ['task:task-2', 'COMPLETED'],
    ],
  )

  const recovered = createMachine([], { persistence: fixture.persistence })
  await recovered.machine.recover()
  assert.equal(recovered.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(recovered.machine.getSnapshot().activeTask.taskId, second.taskId)
  fixture.model.assertFullyConsumed()
})

test('cancel aborts a pending model turn without executing tools', async () => {
  const fixture = createMachine([{ expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' }])
  const ref = await fixture.machine.submit({ text: 'Cancel me' })
  await waitForPhase(fixture.machine, 'BLUEPRINT')

  await fixture.machine.cancel(ref.taskId)
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'CANCELLED')
  assert.equal(fixture.host.invocations.length, 0)
  fixture.model.assertFullyConsumed()
})

test('recover selects the newest durable task independently of backend record ordering', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 4
  persistence.records = [
    {
      recordId: 'task:task-newer',
      kind: 'agent-runtime-task',
      value: {
        taskId: 'task-newer',
        sessionId: 'session-1',
        phase: 'COMPLETED',
        createdAt: 20,
        updatedAt: 30,
        repairAttempts: 0,
        intent: { text: 'newer durable task' },
      },
    },
    {
      recordId: 'task:task-older',
      kind: 'agent-runtime-task',
      value: {
        taskId: 'task-older',
        sessionId: 'session-1',
        phase: 'COMPLETED',
        createdAt: 10,
        updatedAt: 15,
        repairAttempts: 0,
        intent: { text: 'older durable task' },
      },
    },
  ]
  const fixture = createMachine([], { persistence })

  await fixture.machine.recover()

  assert.equal(fixture.machine.getSnapshot().activeTask.taskId, 'task-newer')
  assert.deepEqual(
    fixture.machine.getSnapshot().tasks.map(task => task.taskId),
    ['task-newer'],
  )
})

test('strict model validation fails malformed events before invoking the host', async () => {
  const fixture = createMachine([
    { expectedPhase: 'BLUEPRINT', events: [blueprint] },
    { expectedPhase: 'PLAN_STEP', events: [], fault: 'malformed' },
  ])

  await fixture.machine.submit({ text: 'Reject malformed output' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'FAILED')
  assert.equal(fixture.machine.getSnapshot().activeTask.failure.code, 'worker-task-failed')
  assert.equal(fixture.host.invocations.length, 0)
  fixture.model.assertFullyConsumed()
})

test('ScriptedModelAdapter rejects phase mismatches and unconsumed steps', async () => {
  const model = new ScriptedModelAdapter([{ expectedPhase: 'BLUEPRINT', events: [blueprint] }])
  assert.throws(
    () => model.assertFullyConsumed(),
    error => error instanceof ScriptedModelError && error.code === 'script-not-consumed',
  )

  const request = {
    schemaVersion: 1,
    projectId: binding.projectId,
    branchId: binding.branchId,
    sessionId: 'session-1',
    taskId: 'task-1',
    phase: 'PLAN_STEP',
    intent: { text: 'Mismatch' },
    snapshot: { schemaVersion: 1, revision: 'r0', providerGenerations: {}, projection: {} },
    repairAttempts: 0,
  }
  await assert.rejects(
    async () => {
      for await (const _event of model.run(request, new AbortController().signal)) {
        // The adapter rejects before yielding.
      }
    },
    error => error instanceof ScriptedModelError && error.code === 'unexpected-phase',
  )
})
