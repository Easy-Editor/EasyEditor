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
const { createAgentSessionContext } = await import(
  pathToFileURL(join(compiledRoot, 'internal/session-context/index.js'))
)
const { createSafeWorkerTelemetryEmitter, createWorkerTelemetryEvent, createWorkerTelemetryLedger } = await import(
  pathToFileURL(join(compiledRoot, 'internal/telemetry.js'))
)
const { createAgentTelemetryChangeSetId } = await import(
  pathToFileURL(join(compiledRoot, 'internal/telemetry-change-set-id.js'))
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
  invocationContexts = []
  invocationContextFrozen = []
  receiptQueries = []
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

  async invoke(call, context) {
    this.invocations.push(structuredClone(call))
    this.invocationContexts.push(structuredClone(context))
    this.invocationContextFrozen.push(
      Object.isFrozen(context) &&
        (!context.compensationTarget ||
          (Object.isFrozen(context.compensationTarget) && Object.isFrozen(context.compensationTarget.callIndex))),
    )
    const behavior = this.behaviors.shift() ?? {}
    if (behavior.wait) await behavior.wait
    this.revision = behavior.observedRevision ?? `r${this.invocations.length}`
    return {
      schemaVersion: 1,
      callId: call.callId,
      status: behavior.status ?? 'applied',
      ...(behavior.resultRevision === null ? {} : { revision: behavior.resultRevision ?? this.revision }),
      ...(behavior.failure ? { failure: structuredClone(behavior.failure) } : {}),
      ...(Object.hasOwn(behavior, 'output') ? { output: structuredClone(behavior.output) } : {}),
    }
  }

  async queryReceipt(request) {
    this.receiptQueries.push(structuredClone(request))
    return this.receipts.get(request.callId) ?? null
  }
}

const call = ({
  task = 1,
  step = 1,
  callId = 1,
  revision = 'r0',
  capability = 'set-title',
  args = { title: 'City overview' },
} = {}) => ({
  schemaVersion: 1,
  projectId: binding.projectId,
  branchId: binding.branchId,
  sessionId: 'session-1',
  taskId: `task-${task}`,
  stepId: `step-${step}`,
  callId: `call-${callId}`,
  capability,
  arguments: args,
  expectedRevision: revision,
})

const scopedCallId = (localId = 'call-1', sessionId = 'session-1') => `call:${sessionId.length}:${sessionId}:${localId}`

const runtimeCall = options => {
  const value = call(options)
  return { ...value, callId: scopedCallId(value.callId, value.sessionId) }
}

const blueprint = { schemaVersion: 1, kind: 'blueprint', summary: 'Update the dashboard' }
const complete = { schemaVersion: 1, kind: 'complete', summary: 'Done' }
const toolCall = value => ({
  schemaVersion: 1,
  kind: 'tool-call',
  call: {
    schemaVersion: 1,
    capability: value.capability,
    arguments: value.arguments,
    expectedRevision: value.expectedRevision,
  },
})

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
  const model = overrides.model ?? new ScriptedModelAdapter(steps)
  const host = overrides.host ?? new TestHost()
  const persistence = overrides.persistence ?? new TestPersistence()
  const phases = []
  const machine = createWorkerStateMachine({
    binding: overrides.binding ?? binding,
    model,
    host,
    persistence,
    clock: overrides.clock ?? createClock(),
    idFactory: overrides.idFactory ?? createIds(),
    modelTokenBudget: overrides.modelTokenBudget,
    repairBudget: overrides.repairBudget,
    sessionContextBudget: overrides.sessionContextBudget,
    telemetrySink: overrides.telemetrySink,
    onTelemetryStepRetentionChange: overrides.onTelemetryStepRetentionChange,
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

const pendingTaskRecord = ({
  callValue = call(),
  completeAfterTool = true,
  phase = 'EXECUTE',
  updatedAt = 2,
} = {}) => ({
  recordId: `task:${callValue.taskId}`,
  kind: 'agent-runtime-task',
  value: {
    taskId: callValue.taskId,
    sessionId: callValue.sessionId,
    phase,
    createdAt: 1,
    updatedAt,
    repairAttempts: 0,
    consecutiveYields: 0,
    intent: { text: 'Recover the pending semantic call' },
    callIds: [callValue.callId],
    callIndex: [{ callId: callValue.callId, capability: callValue.capability }],
    callIndexComplete: true,
    pendingInvocation: {
      schemaVersion: 1,
      state: 'invoked',
      completeAfterTool,
      call: structuredClone(callValue),
    },
  },
})

const terminalTaskRecord = ({
  taskId = 'target-task',
  sessionId = 'session-1',
  phase = 'COMPLETED',
  callIds = ['target-call-1'],
  callIndex = [{ callId: 'target-call-1', capability: 'screen.applyChangeSet' }],
  callIndexComplete = true,
  updatedAt = 2,
} = {}) => ({
  recordId: `task:${taskId}`,
  kind: 'agent-runtime-task',
  value: {
    taskId,
    sessionId,
    phase,
    createdAt: 1,
    updatedAt,
    repairAttempts: 0,
    consecutiveYields: 0,
    intent: { text: 'Durable target task' },
    callIds,
    ...(callIndex === undefined ? {} : { callIndex }),
    ...(callIndexComplete === undefined ? {} : { callIndexComplete }),
  },
})

const runRecoveredCompensation = async ({ target = terminalTaskRecord(), args } = {}) => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [target]
  const host = new TestHost()
  const compensation = call({
    capability: 'task.compensate',
    args: args ?? { schemaVersion: 1, targetTaskId: target.value.taskId },
  })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(compensation), complete] },
    ],
    { host, persistence },
  )
  await fixture.machine.recover()
  await fixture.machine.submit({ text: 'Compensate the prior task' })
  await fixture.machine.waitForIdle()
  return { ...fixture, compensation }
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
  assert.equal(fixture.persistence.commits.length, 2)
  assert.deepEqual(
    fixture.persistence.commits.map(commit => commit.records[0].value.phase),
    ['EXECUTE', 'COMPLETED'],
  )
  assert.deepEqual(fixture.persistence.commits[0].records[0].value.callIds, [scopedCallId()])
  assert.deepEqual(fixture.persistence.commits[0].records[0].value.callIndex, [
    { callId: scopedCallId(), capability: 'set-title' },
  ])
  assert.equal(fixture.persistence.commits[0].records[0].value.pendingInvocation.call.callId, scopedCallId())
  assert.equal(Object.hasOwn(fixture.persistence.commits[1].records[0].value, 'pendingInvocation'), false)
  assert.deepEqual(fixture.persistence.commits[1].records[0].value.callIds, [scopedCallId()])
  assert.deepEqual(fixture.persistence.commits[1].records[0].value.callIndex, [
    { callId: scopedCallId(), capability: 'set-title' },
  ])
  assert.equal(fixture.persistence.records[0].value.phase, 'COMPLETED')
  assert.deepEqual(
    fixture.host.observations.map(observation => observation.mode),
    ['full', 'full'],
  )
  assert.deepEqual(fixture.host.invocationContexts, [{ schemaVersion: 1 }])
  assertOrdered(fixture.phases, ['OBSERVE', 'BLUEPRINT', 'PLAN_STEP', 'EXECUTE', 'VERIFY', 'CHECKPOINT', 'COMPLETED'])
  fixture.model.assertFullyConsumed()
})

test('emits bounded Worker-only telemetry with queryable task, step, model request, and call lineage', async () => {
  const secret = 'RAW_PROMPT_CREDENTIAL_SOURCE_MUST_NOT_APPEAR'
  const ledger = createWorkerTelemetryLedger({ capacity: 64 })
  const screenCall = call({
    capability: 'screen.applyChangeSet',
    args: { schemaVersion: 1, operations: [] },
  })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(screenCall), complete] },
    ],
    { modelTokenBudget: 4_096, telemetrySink: { emit: event => ledger.append(event) } },
  )

  const ref = await fixture.machine.submit({ text: secret, metadata: { credential: secret } })
  await fixture.machine.waitForIdle()

  const events = ledger.query({ sessionId: ref.sessionId, taskId: ref.taskId })
  assert.ok(events.length > 0)
  assert.deepEqual(events[0], {
    schemaVersion: 1,
    eventType: 'task.started',
    timestampMs: 2,
    status: 'started',
    sessionId: ref.sessionId,
    taskId: ref.taskId,
  })
  assert.ok(
    events.some(
      event =>
        event.eventType === 'model-request.started' &&
        event.modelRequestId === 'request-1' &&
        event.phase === 'BLUEPRINT' &&
        event.tokenBudget === 4_096,
    ),
  )
  assert.ok(
    events.some(
      event => event.eventType === 'phase.started' && event.stepId === 'step-2' && event.phase === 'PLAN_STEP',
    ),
  )
  const toolCompleted = events.find(
    event => event.eventType === 'tool-call.completed' && event.callId === scopedCallId(),
  )
  assert.ok(toolCompleted)
  assert.equal(toolCompleted.resultRevision, 'r1')
  assert.equal(toolCompleted.changeSetId, createAgentTelemetryChangeSetId(scopedCallId()))
  assert.deepEqual(ledger.query({ taskId: ref.taskId }), events)
  assert.deepEqual(ledger.query({ stepId: 'step-2' }), events)
  assert.deepEqual(ledger.query({ callId: scopedCallId() }), events)
  assert.deepEqual(ledger.query({ changeSetId: toolCompleted.changeSetId }), events)
  assert.deepEqual(ledger.query({ modelRequestId: 'request-2' }), events)
  assert.deepEqual(ledger.query({ sessionId: 'wrong-session', callId: scopedCallId() }), [])
  assert.deepEqual(ledger.query({ callId: 'unknown-call' }), [])
  assert.equal(events.at(-1).eventType, 'runtime.terminal')
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(events[index].timestampMs > events[index - 1].timestampMs)
  }
  for (const end of events.filter(event =>
    /^(phase|model-request|tool-call)\.(completed|failed)$/u.test(event.eventType),
  )) {
    const prefix = end.eventType.split('.')[0]
    const start = events.find(
      event =>
        event.eventType === `${prefix}.started` &&
        (!('stepId' in end) || event.stepId === end.stepId) &&
        (!('modelRequestId' in end) || event.modelRequestId === end.modelRequestId) &&
        (!('callId' in end) || event.callId === end.callId),
    )
    assert.ok(start)
    assert.equal(end.durationMs, end.timestampMs - start.timestampMs)
  }
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret))
  for (const event of events) {
    for (const forbidden of ['metadata', 'message', 'prompt', 'input', 'output', 'source', 'error', 'credential']) {
      assert.equal(Object.hasOwn(event, forbidden), false)
    }
  }
})

test('releases completed and terminal telemetry steps from internal retention', async () => {
  const retainedCounts = []
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    {
      telemetrySink: { emit() {} },
      onTelemetryStepRetentionChange: count => retainedCounts.push(count),
    },
  )

  await fixture.machine.submit({ text: 'Retain only active telemetry steps' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.deepEqual(retainedCounts, [1, 0, 1, 0, 1, 0])
  fixture.model.assertFullyConsumed()
})

test('canonical telemetry changeSet IDs are stable, collision-free for bounded call IDs, and byte-bijective', () => {
  const callIds = [
    'call:1:a:b',
    'call:3:a:b',
    'call:scope:雪:一',
    'call:scope:雪:二',
    ...Array.from({ length: 512 }, (_, index) => `call:session-${index}:local-${index * 17}`),
  ]
  const changeSetIds = callIds.map(createAgentTelemetryChangeSetId)
  assert.equal(new Set(changeSetIds).size, callIds.length)
  assert.equal(createAgentTelemetryChangeSetId(callIds[0]), changeSetIds[0])
  for (const [index, changeSetId] of changeSetIds.entries()) {
    assert.match(changeSetId, /^change-set-v1-[a-f0-9]+$/u)
    assert.equal(changeSetId.includes(callIds[index]), false)
    const hex = changeSetId.slice('change-set-v1-'.length)
    const bytes = Uint8Array.from(hex.match(/.{2}/gu) ?? [], value => Number.parseInt(value, 16))
    assert.equal(new TextDecoder().decode(bytes), callIds[index])
  }
  for (const invalid of ['', 'contains whitespace', 'contains\u0000control', 'x'.repeat(257)]) {
    assert.throws(() => createAgentTelemetryChangeSetId(invalid), /callId is invalid/i)
  }
})

test('telemetry sink failures and bounded pending emissions never break task execution', async () => {
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [complete] },
    ],
    { telemetrySink: { emit: () => Promise.reject(new Error('sensitive sink failure')) } },
  )
  await fixture.machine.submit({ text: 'Complete without exposing sink failures' })
  await fixture.machine.waitForIdle()
  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')

  const emitter = createSafeWorkerTelemetryEmitter({ emit: () => new Promise(() => {}) }, { maxPending: 2 })
  for (let index = 0; index < 3; index += 1) {
    emitter.emit({
      schemaVersion: 1,
      eventType: 'task.started',
      timestampMs: index,
      status: 'started',
      sessionId: 'session-1',
      taskId: `task-${index}`,
    })
  }
  assert.deepEqual(emitter.stats(), { pending: 2, dropped: 1, failed: 0 })
})

test('artifact telemetry extracts only the real artifact and source revision lineage from the Host result', async () => {
  const secret = 'RAW_ARTIFACT_SOURCE_MUST_NOT_APPEAR'
  const ledger = createWorkerTelemetryLedger({ capacity: 64 })
  const host = new TestHost()
  host.behaviors.push({
    output: {
      artifactRef: {
        artifactId: 'artifact-1',
        sourceRevision: 'source-revision-1',
        source: secret,
      },
      source: secret,
    },
  })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      {
        expectedPhase: 'PLAN_STEP',
        events: [
          toolCall(
            call({
              capability: 'artifact.createOnline',
              args: { schemaVersion: 1, source: secret },
            }),
          ),
          complete,
        ],
      },
    ],
    { host, telemetrySink: { emit: event => ledger.append(event) } },
  )

  const ref = await fixture.machine.submit({ text: 'Create an online artifact' })
  await fixture.machine.waitForIdle()
  const events = ledger.query({ artifactId: 'artifact-1', artifactRevision: 'source-revision-1' })
  assert.ok(events.length > 0)
  assert.ok(
    events.some(
      event =>
        event.eventType === 'tool-call.completed' &&
        event.artifactId === 'artifact-1' &&
        event.artifactRevision === 'source-revision-1' &&
        event.resultRevision === 'r1',
    ),
  )
  assert.deepEqual(events, ledger.query({ taskId: ref.taskId }))
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret))
  assert.throws(() => ledger.query({ artifactId: 'artifact-1' }), /telemetry event is invalid/i)
})

test('telemetry reduces arbitrary model error text to a finite error code', async () => {
  const secret = 'RAW_MODEL_ERROR_TEXT_AND_CREDENTIAL'
  const ledger = createWorkerTelemetryLedger({ capacity: 32 })
  const model = {
    async *run() {
      if (secret.length === 0) yield complete
      throw new Error(secret)
    },
  }
  const fixture = createMachine([], {
    model,
    telemetrySink: { emit: event => ledger.append(event) },
  })
  const ref = await fixture.machine.submit({ text: 'Trigger a safe failure event' })
  await fixture.machine.waitForIdle()

  const events = ledger.query({ sessionId: ref.sessionId, taskId: ref.taskId })
  assert.ok(
    events.some(event => event.eventType === 'model-request.failed' && event.errorCode === 'model-request-failed'),
  )
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret))
})

test('public compensation telemetry preserves its Runtime-owned step and call correlation', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [terminalTaskRecord()]
  const ledger = createWorkerTelemetryLedger({ capacity: 64 })
  const fixture = createMachine([], {
    persistence,
    telemetrySink: { emit: event => ledger.append(event) },
  })
  await fixture.machine.recover()
  await fixture.machine.compensate('target-task')

  const task = fixture.machine.getSnapshot().activeTask
  const events = ledger.query({ sessionId: task.sessionId, taskId: task.taskId })
  const started = events.find(event => event.eventType === 'compensation.started')
  const completed = events.find(event => event.eventType === 'compensation.completed')
  assert.ok(started)
  assert.ok(completed)
  assert.equal(completed.stepId, started.stepId)
  assert.equal(completed.callId, started.callId)
  assert.equal(completed.durationMs, completed.timestampMs - started.timestampMs)
  assert.ok(events.some(event => event.eventType === 'runtime.terminal' && event.status === 'completed'))
})

test('telemetry ledger rejects capacity overflow without changing accepted records and rejects orphan correlations', () => {
  const ledger = createWorkerTelemetryLedger({ capacity: 3 })
  assert.throws(
    () =>
      ledger.append({
        schemaVersion: 1,
        eventType: 'phase.started',
        timestampMs: 0,
        status: 'started',
        sessionId: 'session-1',
        taskId: 'orphan-task',
        stepId: 'step-1',
        phase: 'PLAN_STEP',
      }),
    /telemetry event is invalid/i,
  )
  ledger.append({
    schemaVersion: 1,
    eventType: 'task.started',
    timestampMs: 1,
    status: 'started',
    sessionId: 'session-1',
    taskId: 'task-1',
  })
  ledger.append({
    schemaVersion: 1,
    eventType: 'phase.started',
    timestampMs: 2,
    status: 'started',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    phase: 'PLAN_STEP',
  })
  assert.throws(
    () =>
      ledger.append({
        schemaVersion: 1,
        eventType: 'tool-call.completed',
        timestampMs: 3,
        durationMs: 1,
        status: 'completed',
        sessionId: 'session-1',
        taskId: 'task-1',
        stepId: 'step-1',
        callId: 'orphan-call',
        artifactId: 'orphan-artifact',
        artifactRevision: 'orphan-revision',
      }),
    /telemetry event is invalid/i,
  )
  ledger.append({
    schemaVersion: 1,
    eventType: 'phase.completed',
    timestampMs: 3,
    durationMs: 1,
    status: 'completed',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    phase: 'PLAN_STEP',
  })
  const accepted = ledger.query({ sessionId: 'session-1', taskId: 'task-1' })
  assert.throws(
    () =>
      ledger.append({
        schemaVersion: 1,
        eventType: 'tool-call.started',
        timestampMs: 4,
        status: 'started',
        sessionId: 'session-1',
        taskId: 'task-1',
        stepId: 'step-1',
        callId: 'capacity-rejected-call',
      }),
    /telemetry event is invalid/i,
  )
  assert.equal(ledger.size, 3)
  assert.deepEqual(ledger.query({ sessionId: 'session-1', taskId: 'task-1' }), accepted)
  assert.deepEqual(
    accepted.map(event => event.timestampMs),
    [1, 2, 3],
  )
})

test('telemetry event validation rejects raw payload fields, invalid enums, identifiers, and numbers', () => {
  const base = {
    schemaVersion: 1,
    eventType: 'task.started',
    timestampMs: 1,
    status: 'started',
    sessionId: 'session-1',
    taskId: 'task-1',
  }
  for (const invalid of [
    { ...base, prompt: 'raw prompt' },
    { ...base, metadata: {} },
    { ...base, message: 'raw error text' },
    { ...base, error: 'raw error text' },
    { ...base, source: 'generated source' },
    { ...base, eventType: 'custom.event' },
    { ...base, timestampMs: -1 },
    { ...base, taskId: 'contains whitespace' },
    {
      ...base,
      eventType: 'task.failed',
      status: 'failed',
      errorCode: 'sk-live-secret',
    },
    Object.defineProperty({ ...base }, 'taskId', { get: () => 'task-1', enumerable: true }),
  ]) {
    assert.throws(() => createWorkerTelemetryEvent(invalid), /telemetry event is invalid/i)
  }
})

test('telemetry event validation rejects discriminant accessors without evaluating them', () => {
  const base = {
    schemaVersion: 1,
    eventType: 'task.started',
    timestampMs: 1,
    status: 'started',
    sessionId: 'session-1',
    taskId: 'task-1',
  }
  for (const field of ['schemaVersion', 'eventType']) {
    let reads = 0
    const hostile = { ...base }
    Object.defineProperty(hostile, field, {
      enumerable: true,
      get() {
        reads += 1
        return base[field]
      },
    })
    assert.throws(() => createWorkerTelemetryEvent(hostile), /telemetry event is invalid/i)
    assert.equal(reads, 0)
  }
})

test('telemetry ledger rejects duplicate and reparented task, step, model, call, change-set, and artifact lineage', () => {
  const ledger = createWorkerTelemetryLedger({ capacity: 32 })
  const taskStarted = taskId => ({
    schemaVersion: 1,
    eventType: 'task.started',
    timestampMs: 1,
    status: 'started',
    sessionId: 'session-1',
    taskId,
  })
  const phaseStarted = (taskId, stepId) => ({
    schemaVersion: 1,
    eventType: 'phase.started',
    timestampMs: 2,
    status: 'started',
    sessionId: 'session-1',
    taskId,
    stepId,
    phase: 'PLAN_STEP',
  })
  const modelStarted = (taskId, stepId, modelRequestId) => ({
    schemaVersion: 1,
    eventType: 'model-request.started',
    timestampMs: 3,
    status: 'started',
    sessionId: 'session-1',
    taskId,
    stepId,
    modelRequestId,
    phase: 'PLAN_STEP',
  })
  const toolStarted = (taskId, stepId, callId) => ({
    schemaVersion: 1,
    eventType: 'tool-call.started',
    timestampMs: 4,
    status: 'started',
    sessionId: 'session-1',
    taskId,
    stepId,
    callId,
  })

  ledger.append(taskStarted('task-1'))
  ledger.append(taskStarted('task-2'))
  assert.throws(() => ledger.append(taskStarted('task-1')), /telemetry event is invalid/i)
  ledger.append(phaseStarted('task-1', 'step-1'))
  ledger.append(phaseStarted('task-2', 'step-2'))
  assert.throws(() => ledger.append(phaseStarted('task-1', 'step-1')), /telemetry event is invalid/i)
  assert.throws(() => ledger.append(phaseStarted('task-2', 'step-1')), /telemetry event is invalid/i)
  ledger.append(modelStarted('task-1', 'step-1', 'request-1'))
  assert.throws(() => ledger.append(modelStarted('task-1', 'step-1', 'request-1')), /telemetry event is invalid/i)
  assert.throws(() => ledger.append(modelStarted('task-2', 'step-2', 'request-1')), /telemetry event is invalid/i)
  ledger.append(toolStarted('task-1', 'step-1', 'call-1'))
  ledger.append(toolStarted('task-1', 'step-1', 'call-2'))
  assert.throws(() => ledger.append(toolStarted('task-1', 'step-1', 'call-1')), /telemetry event is invalid/i)
  assert.throws(() => ledger.append(toolStarted('task-2', 'step-2', 'call-1')), /telemetry event is invalid/i)
  ledger.append({
    schemaVersion: 1,
    eventType: 'tool-call.completed',
    timestampMs: 5,
    durationMs: 1,
    status: 'completed',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
    changeSetId: 'change-set-1',
    artifactId: 'artifact-1',
    artifactRevision: 'revision-1',
  })
  assert.throws(
    () =>
      ledger.append({
        schemaVersion: 1,
        eventType: 'tool-call.completed',
        timestampMs: 6,
        durationMs: 1,
        status: 'completed',
        sessionId: 'session-1',
        taskId: 'task-1',
        stepId: 'step-1',
        callId: 'call-2',
        changeSetId: 'change-set-1',
      }),
    /telemetry event is invalid/i,
  )
  assert.throws(
    () =>
      ledger.append({
        schemaVersion: 1,
        eventType: 'tool-call.completed',
        timestampMs: 6,
        durationMs: 1,
        status: 'completed',
        sessionId: 'session-1',
        taskId: 'task-1',
        stepId: 'step-1',
        callId: 'call-2',
        artifactId: 'artifact-1',
        artifactRevision: 'revision-1',
      }),
    /telemetry event is invalid/i,
  )
  assert.deepEqual(ledger.query({ changeSetId: 'change-set-1' }), ledger.query({ taskId: 'task-1' }))
})

test('projects and recovers the submitted intent, accepted blueprint, completion summary, and model context', async () => {
  const acceptedBlueprint = {
    schemaVersion: 1,
    kind: 'blueprint',
    summary: 'Build a revenue overview',
    unresolvedConstraints: ['Confirm the production datasource before publishing'],
  }
  const completion = { schemaVersion: 1, kind: 'complete', summary: 'Revenue overview is ready' }
  let blueprintContext
  let planContext
  const persistence = new TestPersistence()
  const fixture = createMachine(
    [
      {
        expectedPhase: 'BLUEPRINT',
        matchRequest(request) {
          blueprintContext = structuredClone(request.sessionContext)
          return request.sessionContext !== undefined
        },
        events: [acceptedBlueprint],
      },
      {
        expectedPhase: 'PLAN_STEP',
        matchRequest(request) {
          planContext = structuredClone(request.sessionContext)
          return request.sessionContext?.excerpts[0]?.acceptedBlueprintSummary === acceptedBlueprint.summary
        },
        events: [completion],
      },
    ],
    { persistence },
  )

  const intent = { text: 'Create the revenue overview', metadata: { requestedBy: 'workspace' } }
  const task = await fixture.machine.submit(intent)
  await fixture.machine.waitForIdle()

  const projected = fixture.machine.getSnapshot().activeTask
  assert.deepEqual(projected.intent, intent)
  assert.deepEqual(projected.acceptedBlueprint, {
    schemaVersion: 1,
    summary: acceptedBlueprint.summary,
    unresolvedConstraints: acceptedBlueprint.unresolvedConstraints,
  })
  assert.equal(projected.completionSummary, completion.summary)
  assert.deepEqual(projected.sessionContext, planContext)
  assert.deepEqual(blueprintContext.includedTaskIds, [task.taskId])
  assert.deepEqual(planContext.includedTaskIds, [task.taskId])
  assert.deepEqual(planContext.unresolvedConstraints, [
    {
      taskId: task.taskId,
      kind: 'blueprint',
      summary: acceptedBlueprint.unresolvedConstraints[0],
    },
  ])

  const durable = persistence.records.find(record => record.recordId === `task:${task.taskId}`)?.value
  assert.deepEqual(durable.intent, intent)
  assert.deepEqual(durable.acceptedBlueprint, projected.acceptedBlueprint)
  assert.equal(durable.completionSummary, completion.summary)
  assert.deepEqual(durable.sessionContext, planContext)

  const recovered = createMachine([], { persistence })
  await recovered.machine.recover()
  const recoveredTask = recovered.machine.getSnapshot().activeTask
  assert.deepEqual(recoveredTask.intent, projected.intent)
  assert.deepEqual(recoveredTask.acceptedBlueprint, projected.acceptedBlueprint)
  assert.equal(recoveredTask.completionSummary, projected.completionSummary)
  assert.deepEqual(recoveredTask.sessionContext, projected.sessionContext)
  recovered.model.assertFullyConsumed()
  fixture.model.assertFullyConsumed()
})

test('compacts session context deterministically with source lineage and explicit unresolved omissions', async () => {
  const runScenario = async () => {
    let context
    const fixture = createMachine(
      [
        { expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' },
        { expectedPhase: 'BLUEPRINT', events: [blueprint] },
        { expectedPhase: 'PLAN_STEP', events: [complete] },
        {
          expectedPhase: 'BLUEPRINT',
          matchRequest(request) {
            context = structuredClone(request.sessionContext)
            return request.sessionContext?.omittedTaskCount === 1
          },
          events: [blueprint],
        },
        { expectedPhase: 'PLAN_STEP', events: [complete] },
      ],
      {
        sessionContextBudget: {
          maxTurns: 2,
          maxTextBytes: 512,
          maxUnresolvedConstraints: 1,
        },
      },
    )

    const cancelled = await fixture.machine.submit({
      text: 'Keep the cancelled task constraint visible even when its excerpt is compacted out',
    })
    await waitForPhase(fixture.machine, 'BLUEPRINT')
    const completed = await fixture.machine.submit({ text: 'Complete the replacement task' })
    await fixture.machine.waitForIdle()
    const current = await fixture.machine.submit({ text: 'Create a deterministic follow-up' })
    await fixture.machine.waitForIdle()

    assert.deepEqual(context.includedTaskIds, [completed.taskId, current.taskId])
    assert.deepEqual(context.sourceJournalRange, { startPosition: 0, endPosition: 2 })
    assert.equal(context.sourceTaskCount, 3)
    assert.equal(context.omittedTaskCount, 1)
    assert.equal(context.omittedUnresolvedConstraintCount, 0)
    assert.ok(context.textBytes <= context.budget.maxTextBytes)
    assert.match(context.sourceHash, /^fnv1a32:[0-9a-f]{8}$/)
    assert.deepEqual(context.unresolvedConstraints, [
      {
        taskId: cancelled.taskId,
        kind: 'cancelled',
        summary: 'Keep the cancelled task constraint visible even when its excerpt is compacted out',
      },
    ])
    fixture.model.assertFullyConsumed()
    return context
  }

  assert.deepEqual(await runScenario(), await runScenario())
})

test('a zero unresolved-constraint budget reports every omitted constraint instead of retaining them accidentally', () => {
  const context = createAgentSessionContext(
    [
      {
        taskId: 'cancelled-task',
        sessionId: 'session-1',
        phase: 'CANCELLED',
        createdAt: 1,
        intent: { text: 'This intent remains unresolved' },
      },
    ],
    { maxTurns: 1, maxTextBytes: 64, maxUnresolvedConstraints: 0 },
  )

  assert.deepEqual(context.unresolvedConstraints, [])
  assert.equal(context.omittedUnresolvedConstraintCount, 1)
})

test('a terminal tool result clears pending state in the same durable COMPLETED checkpoint', async () => {
  const persistence = new TestPersistence()
  const first = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    { persistence },
  )
  await first.machine.submit({ text: 'Commit atomically after the final tool' })
  await first.machine.waitForIdle()

  assert.deepEqual(
    persistence.commits.map(commit => commit.records[0].value.phase),
    ['EXECUTE', 'COMPLETED'],
  )
  assert.equal(Object.hasOwn(persistence.records[0].value, 'pendingInvocation'), false)

  const restartedHost = new TestHost()
  const restarted = createMachine([], { persistence, host: restartedHost })
  await restarted.machine.recover()
  await restarted.machine.waitForIdle()

  assert.equal(restarted.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(restartedHost.invocations.length, 0)
  assert.equal(restartedHost.receiptQueries.length, 0)
  restarted.model.assertFullyConsumed()
})

test('persists the full pending invocation and append-only call index before entering the Host', async () => {
  const persistence = new TestPersistence()
  let observedPending
  class InspectingHost extends TestHost {
    async invoke(value, context) {
      const durableTask = persistence.records.find(record => record.recordId === `task:${value.taskId}`)
      observedPending = structuredClone(durableTask?.value)
      return super.invoke(value, context)
    }
  }
  const host = new InspectingHost()
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    { host, persistence },
  )

  await fixture.machine.submit({ text: 'Persist before invoking' })
  await fixture.machine.waitForIdle()

  assert.equal(observedPending.phase, 'EXECUTE')
  assert.equal(observedPending.pendingInvocation.state, 'invoked')
  assert.deepEqual(observedPending.pendingInvocation.call, runtimeCall({ step: 2 }))
  assert.deepEqual(observedPending.callIds, [scopedCallId()])
  assert.deepEqual(observedPending.callIndex, [{ callId: scopedCallId(), capability: 'set-title' }])
  assert.equal(Object.hasOwn(persistence.records[0].value, 'pendingInvocation'), false)
  assert.deepEqual(persistence.records[0].value.callIds, [scopedCallId()])
  assert.deepEqual(persistence.records[0].value.callIndex, [{ callId: scopedCallId(), capability: 'set-title' }])
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
    invocationSteps: [{ result: { schemaVersion: 1, callId: scopedCallId(), status: 'applied', revision: 'r1' } }],
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
  assert.deepEqual(host.invocationContexts, [{ schemaVersion: 1 }])
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
      invocationSteps: [{ result: { schemaVersion: 1, callId: scopedCallId(), status: 'applied', revision: 'r2' } }],
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
      { result: { schemaVersion: 1, callId: scopedCallId(), status: 'applied', revision: 'r1' } },
      { result: { schemaVersion: 1, callId: scopedCallId('call-2'), status: 'applied', revision: 'r3' } },
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
    invocationSteps: [{ result: { schemaVersion: 1, callId: scopedCallId(), status: 'applied', revision: 'r2' } }],
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

test('correlates BLUEPRINT, PLAN_STEP, and REPAIR requests with their originating tool calls', async () => {
  const host = new TestHost()
  const ledger = createWorkerTelemetryLedger({ capacity: 96 })
  const correlations = []
  const matchCorrelation = request => {
    correlations.push({
      phase: request.phase,
      stepId: request.stepId,
      modelRequestId: request.modelRequestId,
    })
    return true
  }
  host.behaviors.push(
    { observedRevision: 'r2', resultRevision: 'r1' },
    { observedRevision: 'r3', resultRevision: 'r3' },
  )
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', matchRequest: matchCorrelation, events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', matchRequest: matchCorrelation, events: [toolCall(call())] },
      {
        expectedPhase: 'REPAIR',
        matchRequest: matchCorrelation,
        events: [toolCall(call({ step: 2, callId: 2, revision: 'r2' })), complete],
      },
    ],
    { host, repairBudget: 1, telemetrySink: { emit: event => ledger.append(event) } },
  )

  await fixture.machine.submit({ text: 'Repair stale output' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(fixture.machine.getSnapshot().activeTask.repairAttempts, 1)
  assert.equal(host.invocations.length, 2)
  assert.deepEqual(correlations, [
    { phase: 'BLUEPRINT', stepId: 'step-1', modelRequestId: 'request-1' },
    { phase: 'PLAN_STEP', stepId: 'step-2', modelRequestId: 'request-2' },
    { phase: 'REPAIR', stepId: 'step-3', modelRequestId: 'request-3' },
  ])
  assert.deepEqual(
    host.invocations.map(({ stepId }) => stepId),
    ['step-2', 'step-3'],
  )
  assert.deepEqual(
    fixture.persistence.commits.map(commit => commit.records[0].value.phase),
    ['EXECUTE', 'REPAIR', 'EXECUTE', 'COMPLETED'],
  )
  assert.deepEqual(
    fixture.persistence.commits
      .filter(commit => commit.records[0].value.phase === 'EXECUTE')
      .map(commit => commit.records[0].value.pendingInvocation.call.stepId),
    ['step-2', 'step-3'],
  )
  assert.equal(fixture.persistence.commits[1].records[0].value.repairAttempts, 1)
  assert.equal(Object.hasOwn(fixture.persistence.commits[1].records[0].value, 'pendingInvocation'), false)
  assertOrdered(fixture.phases, ['VERIFY', 'REPAIR', 'EXECUTE', 'VERIFY', 'CHECKPOINT'])
  assert.ok(
    ledger
      .query({ taskId: 'task-1' })
      .some(
        event =>
          event.eventType === 'execution.disposition' &&
          event.disposition === 'repair' &&
          event.reason === 'RESULT_REVISION_MISMATCH',
      ),
  )
  fixture.model.assertFullyConsumed()
})

test('persists a pre-invocation repair attempt before asking the model to repair', async () => {
  const ledger = createWorkerTelemetryLedger({ capacity: 96 })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call({ revision: 'stale-r0' }))] },
      {
        expectedPhase: 'REPAIR',
        matchRequest: request => request.repairAttempts === 1,
        events: [toolCall(call({ step: 2, callId: 2 })), complete],
      },
    ],
    { repairBudget: 1, telemetrySink: { emit: event => ledger.append(event) } },
  )

  await fixture.machine.submit({ text: 'Persist a stale precondition repair' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(fixture.host.invocations.length, 1)
  assert.deepEqual(
    fixture.persistence.commits.map(commit => commit.records[0].value.phase),
    ['REPAIR', 'EXECUTE', 'COMPLETED'],
  )
  assert.equal(fixture.persistence.commits[0].records[0].value.repairAttempts, 1)
  assert.deepEqual(fixture.persistence.commits[0].records[0].value.callIds, [])
  assert.equal(Object.hasOwn(fixture.persistence.commits[0].records[0].value, 'pendingInvocation'), false)
  assert.ok(
    ledger
      .query({ taskId: 'task-1' })
      .some(
        event =>
          event.eventType === 'execution.disposition' &&
          event.disposition === 'repair' &&
          event.reason === 'SNAPSHOT_REVISION_MISMATCH',
      ),
  )
  fixture.model.assertFullyConsumed()
})

test('pauses after exhausting the repair budget', async () => {
  const host = new TestHost()
  const ledger = createWorkerTelemetryLedger({ capacity: 64 })
  host.behaviors.push({ observedRevision: 'r2', resultRevision: 'r1' })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call())] },
    ],
    { host, repairBudget: 0, telemetrySink: { emit: event => ledger.append(event) } },
  )

  await fixture.machine.submit({ text: 'Do not repair forever' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'PAUSED')
  assert.equal(fixture.machine.getSnapshot().activeTask.failure.code, 'repair-budget-exhausted')
  assert.equal(fixture.persistence.records[0].value.phase, 'PAUSED')
  assert.equal(fixture.persistence.records[0].value.repairAttempts, 0)
  assert.equal(fixture.persistence.records[0].value.failure.code, 'repair-budget-exhausted')
  assert.equal(Object.hasOwn(fixture.persistence.records[0].value, 'pendingInvocation'), false)
  assert.deepEqual(
    fixture.persistence.commits.map(commit => commit.records[0].value.phase),
    ['EXECUTE', 'PAUSED'],
  )
  assert.ok(
    ledger
      .query({ taskId: 'task-1' })
      .some(
        event =>
          event.eventType === 'execution.disposition' &&
          event.disposition === 'paused' &&
          event.reason === 'REPAIR_BUDGET_EXHAUSTED',
      ),
  )

  const restarted = createMachine([], { persistence: fixture.persistence, repairBudget: 0 })
  await restarted.machine.recover()
  await restarted.machine.waitForIdle()

  assert.equal(restarted.machine.getSnapshot().phase, 'PAUSED')
  assert.equal(restarted.machine.getSnapshot().activeTask.failure.code, 'repair-budget-exhausted')
  assert.equal(restarted.host.invocations.length, 0)
  fixture.model.assertFullyConsumed()
  restarted.model.assertFullyConsumed()
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
  const ledger = createWorkerTelemetryLedger({ capacity: 32 })
  const fixture = createMachine([{ expectedPhase: 'BLUEPRINT', events: [], fault: 'timeout' }], {
    telemetrySink: { emit: event => ledger.append(event) },
  })
  const ref = await fixture.machine.submit({ text: 'Cancel me' })
  await waitForPhase(fixture.machine, 'BLUEPRINT')

  await fixture.machine.cancel(ref.taskId)
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'CANCELLED')
  assert.equal(fixture.host.invocations.length, 0)
  assert.ok(
    ledger
      .query({ taskId: ref.taskId })
      .some(event => event.eventType === 'runtime.terminal' && event.status === 'cancelled'),
  )
  fixture.model.assertFullyConsumed()
})

test('recovery queries a durable pending call and invokes the same callId once when lineage is missing', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [pendingTaskRecord()]
  const host = new TestHost()
  const ledger = createWorkerTelemetryLedger({ capacity: 32 })
  const fixture = createMachine([], { host, persistence, telemetrySink: { emit: event => ledger.append(event) } })

  await fixture.machine.recover()
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.deepEqual(host.receiptQueries, [
    {
      schemaVersion: 1,
      projectId: 'project-1',
      branchId: 'branch-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      callId: 'call-1',
    },
  ])
  assert.deepEqual(
    host.invocations.map(invocation => invocation.callId),
    ['call-1'],
  )
  assert.equal(Object.hasOwn(persistence.records[0].value, 'pendingInvocation'), false)
  assert.deepEqual(persistence.records[0].value.callIds, ['call-1'])
  const events = ledger.query({ callId: 'call-1' })
  assert.equal(events[0].eventType, 'task.recovered')
  assert.ok(events.some(event => event.eventType === 'phase.started' && event.phase === 'RECOVERY'))
  assert.ok(
    events.some(event => event.eventType === 'receipt-recovery.disposition' && event.receiptDisposition === 'missing'),
  )
  fixture.model.assertFullyConsumed()
})

test('ACK-loss recovery fills a legacy task-call index before accepting an applied receipt', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  const pendingLegacy = pendingTaskRecord()
  const {
    callIndex: _legacyCallIndex,
    callIndexComplete: _legacyCallIndexComplete,
    ...legacyValue
  } = pendingLegacy.value
  const legacy = { ...pendingLegacy, value: { ...legacyValue, callIds: [] } }
  persistence.records = [legacy]
  let indexedBeforeReceiptQuery = false
  class AppliedReceiptHost extends TestHost {
    async queryReceipt(request) {
      indexedBeforeReceiptQuery =
        persistence.records[0].value.callIds.includes(request.callId) &&
        persistence.records[0].value.callIndex.some(
          entry => entry.callId === request.callId && entry.capability === 'set-title',
        )
      return super.queryReceipt(request)
    }
  }
  const host = new AppliedReceiptHost()
  host.receipts.set('call-1', {
    schemaVersion: 1,
    projectId: binding.projectId,
    branchId: binding.branchId,
    callId: 'call-1',
    status: 'applied',
    revision: 'r0',
  })
  const ledger = createWorkerTelemetryLedger({ capacity: 32 })
  const fixture = createMachine([], { host, persistence, telemetrySink: { emit: event => ledger.append(event) } })

  await fixture.machine.recover()
  await fixture.machine.waitForIdle()

  assert.equal(indexedBeforeReceiptQuery, true)
  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(host.invocations.length, 0)
  assert.deepEqual(persistence.records[0].value.callIds, ['call-1'])
  assert.deepEqual(persistence.records[0].value.callIndex, [{ callId: 'call-1', capability: 'set-title' }])
  assert.equal(persistence.records[0].value.callIndexComplete, false)
  assert.equal(Object.hasOwn(persistence.records[0].value, 'pendingInvocation'), false)
  assert.ok(
    ledger
      .query({ callId: 'call-1' })
      .some(
        event =>
          event.eventType === 'receipt-recovery.disposition' &&
          event.receiptDisposition === 'applied' &&
          event.resultRevision === 'r0',
      ),
  )
  fixture.model.assertFullyConsumed()
})

test('task.compensate receives a Runtime-owned terminal target projection for both eligible phases', async () => {
  for (const phase of ['COMPLETED', 'CANCELLED']) {
    const target = terminalTaskRecord({
      phase,
      callIds: ['target-call-1', 'target-call-2'],
      callIndex: [
        { callId: 'target-call-1', capability: 'screen.applyChangeSet' },
        { callId: 'target-call-2', capability: 'data.upsert' },
      ],
    })
    const fixture = await runRecoveredCompensation({ target })

    assert.equal(fixture.host.invocations.length, 1)
    assert.deepEqual(fixture.host.invocationContexts, [
      {
        schemaVersion: 1,
        compensationTarget: {
          schemaVersion: 1,
          taskId: 'target-task',
          sessionId: 'session-1',
          phase,
          callIndexComplete: true,
          callIndex: [
            { callId: 'target-call-1', capability: 'screen.applyChangeSet' },
            { callId: 'target-call-2', capability: 'data.upsert' },
          ],
        },
      },
    ])
    assert.deepEqual(fixture.host.invocations[0].arguments, { schemaVersion: 1, targetTaskId: 'target-task' })
    assert.deepEqual(fixture.host.invocationContextFrozen, [true])
    fixture.model.assertFullyConsumed()
  }
})

test('public compensate creates a Runtime-owned task and bypasses the model and direct Host access', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [terminalTaskRecord()]
  const fixture = createMachine([], { persistence })

  await fixture.machine.recover()
  await fixture.machine.compensate('target-task')

  const snapshot = fixture.machine.getSnapshot()
  assert.equal(snapshot.phase, 'COMPLETED')
  assert.equal(snapshot.activeTask.parentTaskId, 'target-task')
  assert.equal(snapshot.activeTask.compensatesTaskId, 'target-task')
  assert.equal(snapshot.activeTask.compensationEligible, false)
  assert.equal(snapshot.tasks.find(task => task.taskId === 'target-task')?.compensationEligible, false)
  assert.equal(snapshot.activeTask.intent.metadata.runtimeCommand, 'task.compensate')
  assert.deepEqual(fixture.host.invocations, [
    {
      schemaVersion: 1,
      projectId: 'project-1',
      branchId: 'branch-1',
      sessionId: 'session-1',
      taskId: snapshot.activeTask.taskId,
      stepId: 'step-1',
      callId: scopedCallId(),
      capability: 'task.compensate',
      arguments: { schemaVersion: 1, targetTaskId: 'target-task' },
      expectedRevision: 'r0',
    },
  ])
  assert.deepEqual(fixture.host.invocationContexts, [
    {
      schemaVersion: 1,
      compensationTarget: {
        schemaVersion: 1,
        taskId: 'target-task',
        sessionId: 'session-1',
        phase: 'COMPLETED',
        callIndexComplete: true,
        callIndex: [{ callId: 'target-call-1', capability: 'screen.applyChangeSet' }],
      },
    },
  ])
  assert.deepEqual(
    persistence.records.find(record => record.recordId === `task:${snapshot.activeTask.taskId}`).value
      .compensatesTaskId,
    'target-task',
  )
  assert.deepEqual(fixture.host.invocationContextFrozen, [true])
  fixture.model.assertFullyConsumed()
})

test('public compensate rejects unknown, active, failed, incomplete, nested, and already compensated targets', async () => {
  const cases = [
    { label: 'unknown', records: [], targetTaskId: 'missing-task' },
    {
      label: 'foreign session',
      records: [terminalTaskRecord({ sessionId: 'session-foreign' })],
      targetTaskId: 'target-task',
    },
    { label: 'active', records: [terminalTaskRecord({ phase: 'PAUSED' })], targetTaskId: 'target-task' },
    { label: 'failed', records: [terminalTaskRecord({ phase: 'FAILED' })], targetTaskId: 'target-task' },
    {
      label: 'incomplete',
      records: [terminalTaskRecord({ callIndexComplete: false })],
      targetTaskId: 'target-task',
    },
    {
      label: 'nested',
      records: [terminalTaskRecord({ callIndex: [{ callId: 'target-call-1', capability: 'task.compensate' }] })],
      targetTaskId: 'target-task',
    },
    {
      label: 'already compensated',
      records: [
        terminalTaskRecord(),
        terminalTaskRecord({
          taskId: 'compensation-task',
          callIds: ['compensation-call'],
          callIndex: [{ callId: 'compensation-call', capability: 'task.compensate' }],
          updatedAt: 3,
        }),
      ].map(record =>
        record.value.taskId === 'compensation-task'
          ? { ...record, value: { ...record.value, compensatesTaskId: 'target-task' } }
          : record,
      ),
      targetTaskId: 'target-task',
    },
  ]

  for (const entry of cases) {
    const persistence = new TestPersistence()
    persistence.generation = 1
    persistence.records = entry.records
    const fixture = createMachine([], { persistence })
    await fixture.machine.recover()

    await assert.rejects(fixture.machine.compensate(entry.targetTaskId), WorkerStateMachineError, entry.label)
    assert.equal(fixture.host.invocations.length, 0, entry.label)
    fixture.model.assertFullyConsumed()
  }
})

test('snapshots expose only Runtime-owned compensation eligibility for durable terminal targets', async () => {
  const cases = [
    {
      label: 'durable eligible',
      records: [terminalTaskRecord()],
      expected: true,
    },
    {
      label: 'incomplete lineage',
      records: [terminalTaskRecord({ callIndexComplete: false })],
      expected: false,
    },
    {
      label: 'nested compensation capability',
      records: [
        terminalTaskRecord({
          callIndex: [{ callId: 'target-call-1', capability: 'task.compensate' }],
        }),
      ],
      expected: false,
    },
    {
      label: 'already claimed by a compensation task',
      records: [
        terminalTaskRecord(),
        (() => {
          const record = terminalTaskRecord({
            taskId: 'compensation-task',
            callIds: ['compensation-call'],
            callIndex: [{ callId: 'compensation-call', capability: 'task.compensate' }],
            updatedAt: 3,
          })
          return { ...record, value: { ...record.value, compensatesTaskId: 'target-task' } }
        })(),
      ],
      expected: false,
    },
  ]

  for (const entry of cases) {
    const persistence = new TestPersistence()
    persistence.generation = 1
    persistence.records = entry.records
    const fixture = createMachine([], { persistence })

    await fixture.machine.recover()

    const target = fixture.machine.getSnapshot().tasks.find(task => task.taskId === 'target-task')
    assert.equal(target?.compensationEligible, entry.expected, entry.label)
    assert.equal(Object.hasOwn(target ?? {}, 'callIds'), false, entry.label)
    assert.equal(Object.hasOwn(target ?? {}, 'callIndex'), false, entry.label)
    fixture.model.assertFullyConsumed()
  }
})

test('compensation recovery rejects persistence results outside the bound project, branch, or session', async () => {
  for (const authority of [
    { projectId: 'project-foreign', branchId: 'branch-1', sessionId: 'session-1' },
    { projectId: 'project-1', branchId: 'branch-foreign', sessionId: 'session-1' },
    { projectId: 'project-1', branchId: 'branch-1', sessionId: 'session-foreign' },
  ]) {
    const persistence = new TestPersistence()
    persistence.generation = 1
    persistence.records = [terminalTaskRecord()]
    persistence.read = async request => ({
      schemaVersion: 1,
      ...authority,
      persistenceGeneration: persistence.generation,
      records: structuredClone(persistence.records),
    })
    const fixture = createMachine([], { persistence })

    await assert.rejects(
      fixture.machine.recover(),
      error =>
        error instanceof WorkerStateMachineError &&
        error.code === 'invalid-tool-call-context' &&
        /bound project, branch, and session/.test(error.message),
    )
    assert.equal(fixture.host.invocations.length, 0)
    fixture.model.assertFullyConsumed()
  }
})

test('cancelling a public compensation preserves the durable CANCELLED phase', async () => {
  let releaseInvocation
  const invocationGate = new Promise(resolve => {
    releaseInvocation = resolve
  })
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [terminalTaskRecord()]
  const host = new TestHost()
  host.behaviors.push({ wait: invocationGate })
  const fixture = createMachine([], { host, persistence })
  await fixture.machine.recover()

  const compensation = fixture.machine.compensate('target-task')
  await waitForPhase(fixture.machine, 'EXECUTE')
  while (host.invocations.length === 0) await new Promise(resolve => setTimeout(resolve, 0))
  const compensationTaskId = fixture.machine.getSnapshot().activeTask.taskId
  const compensationRejected = assert.rejects(compensation, error => error?.name === 'AbortError')
  const cancellation = fixture.machine.cancel(compensationTaskId)
  releaseInvocation()

  await compensationRejected
  await cancellation
  assert.equal(fixture.machine.getSnapshot().phase, 'CANCELLED')
  assert.equal(
    persistence.records.find(record => record.recordId === `task:${compensationTaskId}`).value.phase,
    'CANCELLED',
  )
  fixture.model.assertFullyConsumed()
})

test('restart hydrates every task before resuming a pending compensation invoke', async () => {
  const target = terminalTaskRecord({ updatedAt: 2 })
  const compensation = call({
    task: 2,
    capability: 'task.compensate',
    args: { schemaVersion: 1, targetTaskId: target.value.taskId },
  })
  const pending = pendingTaskRecord({ callValue: compensation, updatedAt: 3 })
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [target, pending]
  const host = new TestHost()
  const fixture = createMachine([], { host, persistence })

  await fixture.machine.recover()
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.deepEqual(
    fixture.machine.getSnapshot().tasks.map(task => task.taskId),
    ['target-task', 'task-2'],
  )
  assert.deepEqual(host.invocationContexts, [
    {
      schemaVersion: 1,
      compensationTarget: {
        schemaVersion: 1,
        taskId: 'target-task',
        sessionId: 'session-1',
        phase: 'COMPLETED',
        callIndexComplete: true,
        callIndex: [{ callId: 'target-call-1', capability: 'screen.applyChangeSet' }],
      },
    },
  ])
  fixture.model.assertFullyConsumed()
})

test('task.compensate fails closed before Host invocation for forged, incomplete, foreign, current, failed, or nested targets', async () => {
  const cases = [
    {
      label: 'model-forged context argument',
      target: terminalTaskRecord(),
      args: {
        schemaVersion: 1,
        targetTaskId: 'target-task',
        compensationTarget: { taskId: 'target-task', phase: 'COMPLETED' },
      },
    },
    {
      label: 'non-v1 compensation arguments',
      target: terminalTaskRecord(),
      args: { schemaVersion: 2, targetTaskId: 'target-task' },
    },
    {
      label: 'legacy incomplete call index',
      target: terminalTaskRecord({
        callIds: ['target-call-1', 'target-call-2'],
        callIndex: undefined,
        callIndexComplete: undefined,
      }),
    },
    {
      label: 'legacy missing call id lineage',
      target: (() => {
        const record = terminalTaskRecord({ callIndex: undefined, callIndexComplete: undefined })
        const { callIds: _legacyCallIds, ...value } = record.value
        return { ...record, value }
      })(),
    },
    {
      label: 'compensation of compensation',
      target: terminalTaskRecord({
        callIds: ['target-call-1', 'target-call-2'],
        callIndex: [
          { callId: 'target-call-1', capability: 'screen.applyChangeSet' },
          { callId: 'target-call-2', capability: 'task.compensate' },
        ],
      }),
    },
    {
      label: 'reordered call index',
      target: terminalTaskRecord({
        callIds: ['target-call-1', 'target-call-2'],
        callIndex: [
          { callId: 'target-call-2', capability: 'data.upsert' },
          { callId: 'target-call-1', capability: 'screen.applyChangeSet' },
        ],
      }),
    },
    { label: 'foreign session', target: terminalTaskRecord({ sessionId: 'session-foreign' }) },
    { label: 'current task', target: terminalTaskRecord(), args: { schemaVersion: 1, targetTaskId: 'task-1' } },
    { label: 'failed target', target: terminalTaskRecord({ phase: 'FAILED' }) },
  ]

  for (const entry of cases) {
    const fixture = await runRecoveredCompensation({ target: entry.target, args: entry.args })
    assert.deepEqual(fixture.host.invocationContexts, [], entry.label)
    assert.equal(fixture.host.invocations.length, 0, entry.label)
    assert.equal(fixture.machine.getSnapshot().phase, 'FAILED', entry.label)
    assert.equal(fixture.machine.getSnapshot().activeTask.failure.code, 'invalid-model-turn', entry.label)
    fixture.model.assertFullyConsumed()
  }
})

test('legacy task-call completeness can never be laundered into compensation eligibility across restarts', async () => {
  const legacyCall = call({ task: 7 })
  const legacyPending = pendingTaskRecord({ callValue: legacyCall })
  const taskCallIndexFields = new Set(['callIds', 'callIndex', 'callIndexComplete'])
  legacyPending.value = Object.fromEntries(
    Object.entries(legacyPending.value).filter(([key]) => !taskCallIndexFields.has(key)),
  )
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [legacyPending]
  const recoveryHost = new TestHost()
  recoveryHost.receipts.set(legacyCall.callId, {
    schemaVersion: 1,
    projectId: binding.projectId,
    branchId: binding.branchId,
    callId: legacyCall.callId,
    status: 'applied',
    revision: 'r0',
  })
  const recovered = createMachine([], { persistence, host: recoveryHost })

  await recovered.machine.recover()
  await recovered.machine.waitForIdle()

  const recoveredRecord = persistence.records.find(record => record.recordId === 'task:task-7')
  assert.equal(recoveredRecord.value.phase, 'COMPLETED')
  assert.deepEqual(recoveredRecord.value.callIds, [legacyCall.callId])
  assert.deepEqual(recoveredRecord.value.callIndex, [{ callId: legacyCall.callId, capability: legacyCall.capability }])
  assert.equal(recoveredRecord.value.callIndexComplete, false)

  const compensation = call({
    capability: 'task.compensate',
    args: { schemaVersion: 1, targetTaskId: 'task-7' },
  })
  const compensationHost = new TestHost()
  const restarted = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(compensation), complete] },
    ],
    { persistence, host: compensationHost },
  )
  await restarted.machine.recover()
  await restarted.machine.submit({ text: 'Do not compensate unproven legacy lineage' })
  await restarted.machine.waitForIdle()

  assert.equal(restarted.machine.getSnapshot().phase, 'FAILED')
  assert.equal(restarted.machine.getSnapshot().activeTask.failure.code, 'invalid-model-turn')
  assert.equal(compensationHost.invocations.length, 0)
  restarted.model.assertFullyConsumed()
})

test('Runtime owns unique step and call identities across model turns', async () => {
  const host = new TestHost()
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call())] },
      {
        expectedPhase: 'PLAN_STEP',
        events: [toolCall(call({ step: 2, callId: 1, revision: 'r1' })), complete],
      },
    ],
    { host },
  )

  await fixture.machine.submit({ text: 'Use Runtime-owned call identity' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.deepEqual(
    host.invocations.map(({ stepId, callId }) => ({ stepId, callId })),
    [
      { stepId: 'step-2', callId: scopedCallId() },
      { stepId: 'step-3', callId: scopedCallId('call-2') },
    ],
  )
  assert.deepEqual(fixture.persistence.records[0].value.callIds, [scopedCallId(), scopedCallId('call-2')])
  fixture.model.assertFullyConsumed()
})

test('model tool proposals cannot inject Runtime-owned authority or call identity', async () => {
  const host = new TestHost()
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [{ schemaVersion: 1, kind: 'tool-call', call: call() }] },
    ],
    { host },
  )

  await fixture.machine.submit({ text: 'Reject model-owned identity' })
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'FAILED')
  assert.equal(fixture.machine.getSnapshot().activeTask.failure.code, 'worker-task-failed')
  assert.equal(host.invocations.length, 0)
})

test('Runtime allocates distinct callIds for independent tasks in one session', async () => {
  const host = new TestHost()
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call({ revision: 'r1' })), complete] },
    ],
    { host },
  )

  await fixture.machine.submit({ text: 'First task' })
  await fixture.machine.waitForIdle()
  await fixture.machine.submit({ text: 'Second task' })
  await fixture.machine.waitForIdle()

  assert.deepEqual(
    host.invocations.map(({ taskId, stepId, callId }) => ({ taskId, stepId, callId })),
    [
      { taskId: 'task-1', stepId: 'step-2', callId: scopedCallId() },
      { taskId: 'task-2', stepId: 'step-4', callId: scopedCallId('call-2') },
    ],
  )
  fixture.model.assertFullyConsumed()
})

test('recovery skips callIds already owned by prior tasks when the deterministic factory restarts', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [
    terminalTaskRecord({
      taskId: 'task-7',
      callIds: [scopedCallId()],
      callIndex: [{ callId: scopedCallId(), capability: 'set-title' }],
    }),
  ]
  const host = new TestHost()
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    { host, persistence },
  )

  await fixture.machine.recover()
  await fixture.machine.submit({ text: 'Allocate after recovery' })
  await fixture.machine.waitForIdle()

  assert.equal(host.invocations.length, 1)
  assert.equal(host.invocations[0].callId, scopedCallId('call-2'))
  assert.equal(host.invocations[0].taskId, 'task-1')
  fixture.model.assertFullyConsumed()
})

test('recovery skips taskIds already owned by durable tasks without overwriting their records', async () => {
  const persistence = new TestPersistence()
  const durable = terminalTaskRecord({
    taskId: 'task-1',
    callIds: ['legacy-call'],
    callIndex: [{ callId: 'legacy-call', capability: 'set-title' }],
  })
  const durableValue = structuredClone(durable.value)
  persistence.generation = 1
  persistence.records = [durable]
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    { persistence },
  )

  await fixture.machine.recover()
  const submitted = await fixture.machine.submit({ text: 'Allocate a task after recovery' })
  await fixture.machine.waitForIdle()

  assert.equal(submitted.taskId, 'task-2')
  assert.equal(fixture.host.invocations[0].taskId, 'task-2')
  assert.deepEqual(
    fixture.machine
      .getSnapshot()
      .tasks.map(task => task.taskId)
      .sort(),
    ['task-1', 'task-2'],
  )
  assert.deepEqual(persistence.records.map(record => record.recordId).sort(), ['task:task-1', 'task:task-2'])
  assert.deepEqual(persistence.records.find(record => record.recordId === 'task:task-1').value, durableValue)
  fixture.model.assertFullyConsumed()
})

test('a reset constant task factory fails closed after recovery instead of overwriting durable state', async () => {
  const persistence = new TestPersistence()
  const durable = terminalTaskRecord({ taskId: 'task-1' })
  const durableValue = structuredClone(durable.value)
  persistence.generation = 1
  persistence.records = [durable]
  const fixture = createMachine([], {
    persistence,
    idFactory: { next: kind => (kind === 'task' ? 'task-1' : `${kind}-1`) },
  })

  await fixture.machine.recover()
  await assert.rejects(
    fixture.machine.submit({ text: 'Must not overwrite task-1' }),
    error => error instanceof WorkerStateMachineError && error.code === 'invalid-tool-call-context',
  )

  assert.deepEqual(
    fixture.machine.getSnapshot().tasks.map(task => task.taskId),
    ['task-1'],
  )
  assert.deepEqual(persistence.records, [{ ...durable, value: durableValue }])
})

test('scoped call identities are injective for delimiter and Unicode sessions and reject oversized inputs before Host', async () => {
  const sessions = ['scope:雪:一', 'scope:雪:二']
  const calls = []
  for (const sessionId of sessions) {
    const fixture = createMachine(
      [
        { expectedPhase: 'BLUEPRINT', events: [blueprint] },
        { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
      ],
      { binding: { ...binding, sessionId } },
    )
    await fixture.machine.submit({ text: `Write in ${sessionId}` })
    await fixture.machine.waitForIdle()
    assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
    calls.push(fixture.host.invocations[0].callId)
  }
  assert.equal(new Set(calls).size, sessions.length)
  calls.forEach((callId, index) => {
    assert.ok(callId.startsWith(`call:${sessions[index].length}:${sessions[index]}:`))
    assert.ok(callId.length <= 256)
  })

  assert.throws(
    () =>
      createWorkerStateMachine({
        binding: { ...binding, sessionId: 's'.repeat(97) },
        model: new ScriptedModelAdapter([]),
        host: new TestHost(),
        persistence: new TestPersistence(),
        clock: createClock(),
        idFactory: createIds(),
      }),
    error => error instanceof WorkerStateMachineError && error.code === 'invalid-tool-call-context',
  )

  const host = new TestHost()
  const oversizedLocal = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    {
      host,
      idFactory: { next: kind => (kind === 'call' ? 'c'.repeat(97) : `${kind}-1`) },
    },
  )
  await oversizedLocal.machine.submit({ text: 'Reject oversized call identity' })
  await oversizedLocal.machine.waitForIdle()
  assert.equal(oversizedLocal.machine.getSnapshot().phase, 'FAILED')
  assert.equal(oversizedLocal.machine.getSnapshot().activeTask.failure.code, 'invalid-tool-call-context')
  assert.equal(host.invocations.length, 0)
})

test('model turn correlation IDs fail closed at the Runtime ID boundary before model.run', async () => {
  for (const oversizedKind of ['step', 'request']) {
    const fixture = createMachine([{ expectedPhase: 'BLUEPRINT', events: [blueprint] }], {
      idFactory: {
        next: kind => (kind === oversizedKind ? 'x'.repeat(97) : `${kind}-1`),
      },
    })

    await fixture.machine.submit({ text: `Reject oversized ${oversizedKind} identity` })
    await fixture.machine.waitForIdle()

    assert.equal(fixture.machine.getSnapshot().phase, 'FAILED', oversizedKind)
    assert.equal(fixture.machine.getSnapshot().activeTask.failure.code, 'invalid-tool-call-context', oversizedKind)
    assert.equal(fixture.model.consumedSteps, 0, oversizedKind)
    assert.equal(fixture.host.invocations.length, 0, oversizedKind)
  }
})

test('recovery rejects duplicate call ownership across persisted tasks', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [
    terminalTaskRecord({
      taskId: 'task-a',
      callIds: ['shared-call'],
      callIndex: [{ callId: 'shared-call', capability: 'set-title' }],
    }),
    terminalTaskRecord({
      taskId: 'task-b',
      callIds: ['shared-call'],
      callIndex: [{ callId: 'shared-call', capability: 'screen.applyChangeSet' }],
      updatedAt: 3,
    }),
  ]
  const fixture = createMachine([], { persistence })

  await assert.rejects(
    fixture.machine.recover(),
    error => error instanceof WorkerStateMachineError && error.code === 'invalid-tool-call-context',
  )
  assert.equal(fixture.machine.getSnapshot().tasks.length, 0)
})

test('an explicit APPLIED_UNDURABLE result pauses and never retries even when receipt lineage is missing', async () => {
  const host = new TestHost()
  host.behaviors.push({
    status: 'indeterminate',
    resultRevision: null,
    failure: {
      code: 'APPLIED_UNDURABLE',
      message: 'Core applied but the durable commit failed',
      retryable: false,
      details: { requiredAction: 'pause' },
    },
  })
  const fixture = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    { host },
  )

  await fixture.machine.submit({ text: 'Never replay an applied-undurable write' })
  await fixture.machine.waitForIdle()

  const snapshot = fixture.machine.getSnapshot()
  assert.equal(snapshot.phase, 'PAUSED')
  assert.equal(snapshot.activeTask.failure.code, 'APPLIED_UNDURABLE')
  assert.deepEqual(snapshot.recoveries, [
    {
      schemaVersion: 1,
      kind: 'applied-undurable',
      recoveryId: `applied-undurable-v1:session-1:${snapshot.activeTask.taskId}:${encodeURIComponent(scopedCallId())}`,
      taskId: snapshot.activeTask.taskId,
      callId: scopedCallId(),
      occurredAt: snapshot.activeTask.updatedAt,
    },
  ])
  assert.deepEqual(Object.keys(snapshot.recoveries[0]).sort(), [
    'callId',
    'kind',
    'occurredAt',
    'recoveryId',
    'schemaVersion',
    'taskId',
  ])
  assert.equal(host.invocations.length, 1)
  assert.deepEqual(
    host.receiptQueries.map(query => query.callId),
    [scopedCallId()],
  )
  assert.equal(fixture.persistence.records[0].value.pendingInvocation.call.callId, scopedCallId())
  assert.equal(fixture.persistence.records[0].value.failure.code, 'APPLIED_UNDURABLE')

  const restarted = createMachine([], { persistence: fixture.persistence })
  await restarted.machine.recover()
  await restarted.machine.waitForIdle()
  assert.equal(restarted.machine.getSnapshot().phase, 'PAUSED')
  assert.equal(restarted.machine.getSnapshot().activeTask.failure.code, 'APPLIED_UNDURABLE')
  assert.deepEqual(restarted.machine.getSnapshot().recoveries, snapshot.recoveries)
  assert.equal(restarted.host.invocations.length, 0)
  fixture.model.assertFullyConsumed()
  restarted.model.assertFullyConsumed()
})

for (const receiptState of ['missing', 'indeterminate']) {
  test(`APPLIED_UNDURABLE is a byte-stable recovery lock for resume, cancel, submit, and compensate with ${receiptState} receipt evidence`, async () => {
    const host = new TestHost()
    host.behaviors.push({
      status: 'indeterminate',
      resultRevision: null,
      failure: {
        code: 'APPLIED_UNDURABLE',
        message: 'Core applied but the durable commit failed',
        retryable: false,
        details: { requiredAction: 'pause' },
      },
    })
    const fixture = createMachine(
      [
        { expectedPhase: 'BLUEPRINT', events: [blueprint] },
        { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
      ],
      { host },
    )

    const task = await fixture.machine.submit({ text: 'Keep the applied-undurable task locked' })
    await fixture.machine.waitForIdle()
    if (receiptState === 'indeterminate') {
      host.receipts.set(scopedCallId(), {
        schemaVersion: 1,
        projectId: binding.projectId,
        branchId: binding.branchId,
        callId: scopedCallId(),
        status: 'indeterminate',
        failure: {
          code: 'INDETERMINATE_RECEIPT',
          message: 'Receipt witnesses remain contradictory',
          retryable: false,
        },
      })
    }

    const lockedSnapshot = fixture.machine.getSnapshot()
    const lockedBytes = JSON.stringify(lockedSnapshot)
    const persistedBytes = JSON.stringify(fixture.persistence.records)
    const invokeCount = host.invocations.length
    const operations = [
      ['resume', () => fixture.machine.resume(task.taskId)],
      ['cancel', () => fixture.machine.cancel(task.taskId)],
      ['submit', () => fixture.machine.submit({ text: 'Must not supersede the recovery lock' })],
      ['compensate', () => fixture.machine.compensate(task.taskId)],
    ]

    for (const [label, operation] of operations) {
      await assert.rejects(
        operation(),
        error =>
          error instanceof WorkerStateMachineError &&
          error.code === 'applied-undurable-recovery-locked' &&
          error.message.includes(task.taskId),
        label,
      )
      assert.strictEqual(fixture.machine.getSnapshot(), lockedSnapshot, `${label} replaced the snapshot`)
      assert.equal(JSON.stringify(fixture.machine.getSnapshot()), lockedBytes, `${label} mutated the snapshot`)
      assert.equal(JSON.stringify(fixture.persistence.records), persistedBytes, `${label} mutated persistence`)
      assert.equal(host.invocations.length, invokeCount, `${label} invoked Host authority`)
    }

    assert.equal(host.receiptQueries.length, 2)
    assert.deepEqual(
      host.receiptQueries.map(query => query.callId),
      [scopedCallId(), scopedCallId()],
    )
    fixture.model.assertFullyConsumed()
  })
}

for (const terminalReceipt of [
  {
    label: 'applied',
    receipt: {
      schemaVersion: 1,
      projectId: binding.projectId,
      branchId: binding.branchId,
      callId: scopedCallId(),
      status: 'applied',
      revision: 'r1',
    },
    recoverySteps: [],
  },
  {
    label: 'rejected',
    receipt: {
      schemaVersion: 1,
      projectId: binding.projectId,
      branchId: binding.branchId,
      callId: scopedCallId(),
      status: 'rejected',
      failure: {
        code: 'POLICY_REJECTED',
        message: 'The exact durable receipt proves the call failed',
        retryable: false,
      },
    },
    recoverySteps: [{ expectedPhase: 'REPAIR', events: [complete] }],
  },
]) {
  test(`APPLIED_UNDURABLE resumes from an exact terminal ${terminalReceipt.label} receipt without replaying the call`, async () => {
    const host = new TestHost()
    host.behaviors.push({
      status: 'indeterminate',
      resultRevision: null,
      failure: {
        code: 'APPLIED_UNDURABLE',
        message: 'Core applied but the durable commit failed',
        retryable: false,
      },
    })
    const fixture = createMachine(
      [
        { expectedPhase: 'BLUEPRINT', events: [blueprint] },
        { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
        ...terminalReceipt.recoverySteps,
      ],
      { host },
    )

    const task = await fixture.machine.submit({ text: 'Resume only from exact terminal evidence' })
    await fixture.machine.waitForIdle()
    assert.equal(fixture.machine.getSnapshot().phase, 'PAUSED')
    const lockedSnapshot = fixture.machine.getSnapshot()
    host.receipts.set(scopedCallId(), { ...terminalReceipt.receipt, projectId: 'foreign-project' })
    await assert.rejects(
      fixture.machine.resume(task.taskId),
      error => error instanceof WorkerStateMachineError && error.code === 'invalid-tool-call-context',
    )
    assert.strictEqual(fixture.machine.getSnapshot(), lockedSnapshot)
    assert.equal(host.invocations.length, 1)
    host.receipts.set(scopedCallId(), terminalReceipt.receipt)

    const resumeResults = await Promise.allSettled([
      fixture.machine.resume(task.taskId),
      fixture.machine.resume(task.taskId),
    ])
    assert.deepEqual(
      resumeResults.map(result => result.status),
      ['fulfilled', 'fulfilled'],
    )
    await fixture.machine.waitForIdle()

    assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
    assert.deepEqual(fixture.machine.getSnapshot().recoveries, [])
    assert.equal(host.invocations.length, 1)
    assert.deepEqual(
      host.receiptQueries.map(query => query.callId),
      [scopedCallId(), scopedCallId(), scopedCallId()],
    )
    fixture.model.assertFullyConsumed()
  })
}

test('a recovered APPLIED_UNDURABLE task locks ordinary mutations targeting every hydrated task', async () => {
  const host = new TestHost()
  host.behaviors.push({
    status: 'indeterminate',
    resultRevision: null,
    failure: {
      code: 'APPLIED_UNDURABLE',
      message: 'Core applied but the durable commit failed',
      retryable: false,
    },
  })
  const original = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    { host },
  )
  const lockedTask = await original.machine.submit({ text: 'Persist a non-active recovery lock' })
  await original.machine.waitForIdle()
  original.persistence.records.push(
    terminalTaskRecord({
      taskId: 'newer-paused-task',
      phase: 'PAUSED',
      callIds: [],
      callIndex: [],
      updatedAt: 999,
    }),
  )

  const restarted = createMachine([], { persistence: original.persistence })
  await restarted.machine.recover()
  const ordinaryTaskId = 'newer-paused-task'
  assert.equal(restarted.machine.getSnapshot().activeTask.taskId, lockedTask.taskId)
  assert.equal(restarted.machine.getSnapshot().recoveries[0].taskId, lockedTask.taskId)
  const lockedSnapshot = restarted.machine.getSnapshot()
  const operations = [
    () => restarted.machine.resume(ordinaryTaskId),
    () => restarted.machine.cancel(ordinaryTaskId),
    () => restarted.machine.submit({ text: 'Must not bypass a hydrated recovery lock' }),
    () => restarted.machine.compensate(ordinaryTaskId),
  ]

  for (const operation of operations) {
    await assert.rejects(
      operation(),
      error => error instanceof WorkerStateMachineError && error.code === 'applied-undurable-recovery-locked',
    )
    assert.strictEqual(restarted.machine.getSnapshot(), lockedSnapshot)
  }
  assert.equal(restarted.host.invocations.length, 0)
  assert.equal(restarted.host.receiptQueries.length, 0)
  original.model.assertFullyConsumed()
  restarted.model.assertFullyConsumed()
})

test('recovery gives an older APPLIED_UNDURABLE lock precedence over newer executable legacy work', async () => {
  const host = new TestHost()
  host.behaviors.push({
    status: 'indeterminate',
    resultRevision: null,
    failure: {
      code: 'APPLIED_UNDURABLE',
      message: 'Core applied but the durable commit failed',
      retryable: false,
    },
  })
  const original = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    { host },
  )
  const lockedTask = await original.machine.submit({ text: 'Persist an older recovery lock' })
  await original.machine.waitForIdle()
  original.persistence.records.push(
    pendingTaskRecord({
      callValue: call({ task: 2, callId: 2, revision: 'r1' }),
      phase: 'EXECUTE',
      updatedAt: 999,
    }),
  )
  const commitCount = original.persistence.commits.length

  const restarted = createMachine([], { persistence: original.persistence })
  await restarted.machine.recover()
  await restarted.machine.waitForIdle()

  const snapshot = restarted.machine.getSnapshot()
  assert.equal(snapshot.phase, 'PAUSED')
  assert.equal(snapshot.activeTask.taskId, lockedTask.taskId)
  assert.equal(snapshot.activeTask.failure.code, 'APPLIED_UNDURABLE')
  assert.equal(snapshot.recoveries[0].taskId, lockedTask.taskId)
  assert.equal(restarted.host.observations.length, 0)
  assert.equal(restarted.host.receiptQueries.length, 0)
  assert.equal(restarted.host.invocations.length, 0)
  assert.equal(restarted.model.consumedSteps, 0)
  assert.equal(original.persistence.commits.length, commitCount)
  original.model.assertFullyConsumed()
  restarted.model.assertFullyConsumed()
})

test('intent-only recovery pauses without invoking, repairing, or clearing the pending call', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [pendingTaskRecord()]
  const host = new TestHost()
  host.receipts.set('call-1', {
    schemaVersion: 1,
    projectId: binding.projectId,
    branchId: binding.branchId,
    callId: 'call-1',
    status: 'indeterminate',
    failure: {
      code: 'INDETERMINATE_RECEIPT',
      message: 'Only the durable intent exists',
      retryable: false,
    },
  })
  const fixture = createMachine([], { host, persistence })

  await fixture.machine.recover()
  await fixture.machine.waitForIdle()

  const snapshot = fixture.machine.getSnapshot()
  assert.equal(snapshot.phase, 'PAUSED')
  assert.equal(snapshot.activeTask.failure.code, 'INDETERMINATE_RECEIPT')
  assert.equal(snapshot.activeTask.repairAttempts, 0)
  assert.equal(host.invocations.length, 0)
  assert.equal(persistence.records[0].value.pendingInvocation.call.callId, 'call-1')
  assert.deepEqual(persistence.records[0].value.callIds, ['call-1'])
  fixture.model.assertFullyConsumed()
})

test('direct and recovered NO_CHANGE outcomes verify and complete without consuming repair budget', async () => {
  const noChangeFailure = {
    code: 'NO_CHANGE',
    message: 'The semantic change is already satisfied',
    retryable: false,
  }
  const directHost = new TestHost()
  directHost.behaviors.push({
    status: 'not-applied',
    observedRevision: 'r0',
    resultRevision: 'r0',
    failure: noChangeFailure,
  })
  const direct = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
    ],
    { host: directHost },
  )

  await direct.machine.submit({ text: 'Accept a direct no-op' })
  await direct.machine.waitForIdle()

  assert.equal(direct.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(direct.machine.getSnapshot().activeTask.repairAttempts, 0)
  assertOrdered(direct.phases, ['EXECUTE', 'VERIFY', 'CHECKPOINT', 'COMPLETED'])
  direct.model.assertFullyConsumed()

  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [pendingTaskRecord()]
  const recoveredHost = new TestHost()
  recoveredHost.receipts.set('call-1', {
    schemaVersion: 1,
    projectId: binding.projectId,
    branchId: binding.branchId,
    callId: 'call-1',
    status: 'not-applied',
    revision: 'r0',
    failure: noChangeFailure,
  })
  const recovered = createMachine([], { host: recoveredHost, persistence })

  await recovered.machine.recover()
  await recovered.machine.waitForIdle()

  assert.equal(recovered.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(recovered.machine.getSnapshot().activeTask.repairAttempts, 0)
  assert.equal(recoveredHost.invocations.length, 0)
  assert.equal(Object.hasOwn(persistence.records[0].value, 'pendingInvocation'), false)
  assert.deepEqual(persistence.records[0].value.callIds, ['call-1'])
  recovered.model.assertFullyConsumed()
})

test('stale and human activity outcomes yield once, re-observe, and pause on a second consecutive yield', async () => {
  const staleFailure = { code: 'STALE_REVISION', message: 'A human edit won the race', retryable: true }
  const activityFailure = { code: 'HUMAN_ACTIVITY', message: 'The activity lease renewed', retryable: true }

  const completingHost = new TestHost()
  const completingLedger = createWorkerTelemetryLedger({ capacity: 96 })
  completingHost.behaviors.push(
    { status: 'not-applied', observedRevision: 'r1', resultRevision: 'r1', failure: activityFailure },
    { status: 'applied', observedRevision: 'r2', resultRevision: 'r2' },
  )
  const completing = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call()), complete] },
      {
        expectedPhase: 'PLAN_STEP',
        matchRequest: request => request.snapshot.revision === 'r1' && request.repairAttempts === 0,
        events: [toolCall(call({ step: 2, callId: 2, revision: 'r1' })), complete],
      },
    ],
    { host: completingHost, telemetrySink: { emit: event => completingLedger.append(event) } },
  )

  await completing.machine.submit({ text: 'Yield to a human once' })
  await completing.machine.waitForIdle()

  assert.equal(completing.machine.getSnapshot().phase, 'COMPLETED')
  assert.equal(completing.machine.getSnapshot().activeTask.repairAttempts, 0)
  assert.equal(completingHost.invocations.length, 2)
  assertOrdered(completing.phases, ['YIELDED', 'PLAN_STEP', 'EXECUTE', 'VERIFY'])
  assert.deepEqual(
    completingHost.observations.map(observation => observation.mode),
    ['full', 'full', 'full'],
  )
  assert.ok(
    completingLedger
      .query({ taskId: 'task-1' })
      .some(
        event =>
          event.eventType === 'execution.disposition' &&
          event.disposition === 'yielded' &&
          event.reason === 'HUMAN_ACTIVITY',
      ),
  )
  assert.equal(
    completingLedger
      .query({ taskId: 'task-1' })
      .some(event => event.eventType === 'execution.disposition' && event.disposition === 'repair'),
    false,
  )
  completing.model.assertFullyConsumed()

  const pausingHost = new TestHost()
  const pausingLedger = createWorkerTelemetryLedger({ capacity: 96 })
  pausingHost.behaviors.push(
    { status: 'not-applied', observedRevision: 'r1', resultRevision: 'r1', failure: staleFailure },
    { status: 'not-applied', observedRevision: 'r2', resultRevision: 'r2', failure: activityFailure },
  )
  const pausing = createMachine(
    [
      { expectedPhase: 'BLUEPRINT', events: [blueprint] },
      { expectedPhase: 'PLAN_STEP', events: [toolCall(call())] },
      {
        expectedPhase: 'PLAN_STEP',
        matchRequest: request => request.snapshot.revision === 'r1' && request.repairAttempts === 0,
        events: [toolCall(call({ step: 2, callId: 2, revision: 'r1' }))],
      },
    ],
    { host: pausingHost, telemetrySink: { emit: event => pausingLedger.append(event) } },
  )

  await pausing.machine.submit({ text: 'Do not loop against continuous human activity' })
  await pausing.machine.waitForIdle()

  const paused = pausing.machine.getSnapshot()
  assert.equal(paused.phase, 'PAUSED')
  assert.equal(paused.activeTask.failure.code, 'human-priority-yield-limit')
  assert.equal(paused.activeTask.repairAttempts, 0)
  assert.equal(Object.hasOwn(pausing.persistence.records[0].value, 'pendingInvocation'), false)
  assert.deepEqual(pausing.persistence.records[0].value.callIds, [scopedCallId(), scopedCallId('call-2')])
  assert.deepEqual(pausing.persistence.records[0].value.callIndex, [
    { callId: scopedCallId(), capability: 'set-title' },
    { callId: scopedCallId('call-2'), capability: 'set-title' },
  ])
  const dispositions = pausingLedger
    .query({ taskId: 'task-1' })
    .filter(event => event.eventType === 'execution.disposition')
    .map(event => [event.disposition, event.reason])
  assert.deepEqual(dispositions, [
    ['yielded', 'STALE_REVISION'],
    ['paused', 'YIELD_LIMIT'],
  ])
  pausing.model.assertFullyConsumed()
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
    {
      recordId: 'task:task-foreign',
      kind: 'agent-runtime-task',
      value: {
        taskId: 'task-foreign',
        sessionId: 'session-foreign',
        phase: 'COMPLETED',
        createdAt: 100,
        updatedAt: 100,
        repairAttempts: 0,
        intent: { text: 'must not enter this session' },
      },
    },
  ]
  const fixture = createMachine([], { persistence })

  await fixture.machine.recover()

  assert.equal(fixture.machine.getSnapshot().activeTask.taskId, 'task-newer')
  assert.deepEqual(
    fixture.machine.getSnapshot().tasks.map(task => task.taskId),
    ['task-newer', 'task-older'],
  )
})

test('recover resumes the newest nonterminal task instead of being masked by a newer terminal record', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [
    pendingTaskRecord({ updatedAt: 2 }),
    terminalTaskRecord({ taskId: 'newer-terminal', updatedAt: 3 }),
  ]
  const host = new TestHost()
  host.receipts.set('call-1', {
    schemaVersion: 1,
    projectId: binding.projectId,
    branchId: binding.branchId,
    callId: 'call-1',
    status: 'applied',
    revision: 'r0',
  })
  const fixture = createMachine([], { host, persistence })

  await fixture.machine.recover()
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().activeTask.taskId, 'task-1')
  assert.equal(fixture.machine.getSnapshot().phase, 'COMPLETED')
  assert.deepEqual(
    host.receiptQueries.map(query => query.callId),
    ['call-1'],
  )
  assert.equal(host.invocations.length, 0)
  fixture.model.assertFullyConsumed()
})

test('recover restores a durable PAUSED task without silently resuming model execution', async () => {
  const persistence = new TestPersistence()
  persistence.generation = 1
  persistence.records = [
    {
      recordId: 'task:task-paused',
      kind: 'agent-runtime-task',
      value: {
        taskId: 'task-paused',
        sessionId: 'session-1',
        phase: 'PAUSED',
        createdAt: 1,
        updatedAt: 2,
        repairAttempts: 0,
        consecutiveYields: 2,
        intent: { text: 'Wait for explicit resume' },
        callIds: [],
        callIndex: [],
        callIndexComplete: true,
      },
    },
  ]
  const host = new TestHost()
  const fixture = createMachine([], { persistence, host })

  await fixture.machine.recover()
  await fixture.machine.waitForIdle()

  assert.equal(fixture.machine.getSnapshot().phase, 'PAUSED')
  assert.equal(host.observations.length, 0)
  assert.equal(host.invocations.length, 0)
  fixture.model.assertFullyConsumed()
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
    stepId: 'step-1',
    modelRequestId: 'request-1',
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
