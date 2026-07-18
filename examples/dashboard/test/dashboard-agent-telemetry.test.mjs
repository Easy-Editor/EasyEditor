import assert from 'node:assert/strict'
import test from 'node:test'

import { createDashboardAgentTelemetryLedger } from '../src/editor/agent/telemetry/index.mjs'
import { createDashboardTelemetryChannel } from '../src/runtime/telemetry-channel.mjs'

const CHANGE_SET_1 = `change-set-v1-${Buffer.from('call-1', 'utf8').toString('hex')}`
const CHANGE_SET_2 = `change-set-v1-${Buffer.from('call-2', 'utf8').toString('hex')}`

const workerChain = ledger => {
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
    phase: 'PLAN_STEP',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
  })
  ledger.append({
    schemaVersion: 1,
    eventType: 'model-request.started',
    timestampMs: 3,
    status: 'started',
    phase: 'PLAN_STEP',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    modelRequestId: 'model-1',
  })
  ledger.append({
    schemaVersion: 1,
    eventType: 'tool-call.started',
    timestampMs: 4,
    status: 'started',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
  })
}

test('Dashboard telemetry returns the complete task lineage from every correlation key', () => {
  const ledger = createDashboardAgentTelemetryLedger({ capacity: 32 })
  workerChain(ledger)
  ledger.append({
    schemaVersion: 1,
    eventType: 'dashboard.screen.prepare',
    timestampMs: 5,
    durationMs: 2,
    status: 'completed',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
    changeSetId: CHANGE_SET_1,
    projectRevision: 'project-revision-1',
  })
  ledger.append({
    schemaVersion: 1,
    eventType: 'dashboard.artifact.revision',
    timestampMs: 6,
    status: 'applied',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
    artifactId: 'artifact-1',
    sourceRevision: 'source-revision-1',
    artifactRevision: 'artifact-revision-1',
    dependencyLockDigest: `sha256:${'a'.repeat(64)}`,
  })
  ledger.append({
    schemaVersion: 1,
    eventType: 'tool-call.completed',
    timestampMs: 7,
    durationMs: 3,
    status: 'completed',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
    changeSetId: CHANGE_SET_1,
    artifactId: 'artifact-1',
    artifactRevision: 'artifact-revision-1',
    resultRevision: 'project-revision-2',
  })

  const expected = ledger.query({ taskId: 'task-1' })
  for (const filter of [
    { sessionId: 'session-1' },
    { stepId: 'step-1' },
    { callId: 'call-1' },
    { changeSetId: CHANGE_SET_1 },
    { modelRequestId: 'model-1' },
    { artifactId: 'artifact-1', sourceRevision: 'source-revision-1' },
    { artifactId: 'artifact-1', artifactRevision: 'artifact-revision-1' },
  ]) {
    assert.deepEqual(ledger.query(filter), expected)
  }
  assert.equal(expected.length, 7)
  assert.equal(Object.isFrozen(expected), true)
  assert.equal(Object.isFrozen(expected[0]), true)
  assert.equal(Object.hasOwn(expected[6], 'resultRevision'), false)
  assert.equal(expected[6].projectRevision, 'project-revision-2')
  assert.equal(expected[5].sourceRevision, 'source-revision-1')
  assert.equal(expected[5].artifactRevision, 'artifact-revision-1')
  assert.deepEqual(ledger.stats(), { capacity: 32, size: 7, accepted: 7, dropped: 0, failed: 0 })
})

test('Dashboard telemetry rejects orphan and reparented lineage without mutating the ledger', () => {
  const ledger = createDashboardAgentTelemetryLedger()
  assert.throws(
    () =>
      ledger.append({
        schemaVersion: 1,
        eventType: 'phase.started',
        timestampMs: 1,
        status: 'started',
        phase: 'PLAN_STEP',
        sessionId: 'session-1',
        taskId: 'missing-task',
        stepId: 'orphan-step',
      }),
    /Dashboard telemetry event is invalid/u,
  )
  workerChain(ledger)
  ledger.append({
    schemaVersion: 1,
    eventType: 'task.started',
    timestampMs: 5,
    status: 'started',
    sessionId: 'session-2',
    taskId: 'task-2',
  })
  assert.deepEqual(ledger.query({ taskId: 'task-2', callId: 'call-1' }), [])
  assert.throws(
    () =>
      ledger.append({
        schemaVersion: 1,
        eventType: 'phase.started',
        timestampMs: 6,
        status: 'started',
        phase: 'PLAN_STEP',
        sessionId: 'session-2',
        taskId: 'task-2',
        stepId: 'step-1',
      }),
    /Dashboard telemetry event is invalid/u,
  )
  assert.throws(
    () =>
      ledger.append({
        schemaVersion: 1,
        eventType: 'dashboard.screen.commit',
        timestampMs: 7,
        status: 'completed',
        sessionId: 'session-1',
        taskId: 'task-1',
        stepId: 'step-1',
        callId: 'unknown-call',
        changeSetId: CHANGE_SET_1,
        projectRevision: 'project-revision-2',
      }),
    /Dashboard telemetry event is invalid/u,
  )
  ledger.append({
    schemaVersion: 1,
    eventType: 'dashboard.screen.prepare',
    timestampMs: 8,
    status: 'completed',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
    changeSetId: CHANGE_SET_1,
    projectRevision: 'project-revision-1',
  })
  assert.throws(
    () =>
      ledger.append({
        schemaVersion: 1,
        eventType: 'dashboard.screen.commit',
        timestampMs: 9,
        status: 'completed',
        sessionId: 'session-1',
        taskId: 'task-1',
        stepId: 'step-1',
        callId: 'call-1',
        changeSetId: CHANGE_SET_2,
        projectRevision: 'project-revision-2',
      }),
    /Dashboard telemetry event is invalid/u,
  )
  assert.deepEqual(ledger.stats(), { capacity: 2048, size: 6, accepted: 6, dropped: 0, failed: 4 })
})

test('Dashboard telemetry accepts RECOVERY control phases and canonical long change-set identifiers', () => {
  const ledger = createDashboardAgentTelemetryLedger()
  ledger.append({
    schemaVersion: 1,
    eventType: 'task.recovered',
    timestampMs: 1,
    status: 'recovered',
    sessionId: 'session-recovery',
    taskId: 'task-recovery',
  })
  ledger.append({
    schemaVersion: 1,
    eventType: 'phase.started',
    timestampMs: 2,
    status: 'started',
    phase: 'RECOVERY',
    sessionId: 'session-recovery',
    taskId: 'task-recovery',
    stepId: 'step-recovery',
  })
  ledger.append({
    schemaVersion: 1,
    eventType: 'phase.completed',
    timestampMs: 3,
    durationMs: 1,
    status: 'completed',
    phase: 'RECOVERY',
    sessionId: 'session-recovery',
    taskId: 'task-recovery',
    stepId: 'step-recovery',
  })
  assert.deepEqual(
    ledger.query({ taskId: 'task-recovery' }).map(event => [event.eventType, event.phase]),
    [
      ['task.recovered', undefined],
      ['phase.started', 'RECOVERY'],
      ['phase.completed', 'RECOVERY'],
    ],
  )

  const longCallId = 'x'.repeat(256)
  const longChangeSetId = `change-set-v1-${Buffer.from(longCallId, 'utf8').toString('hex')}`
  assert.equal(longChangeSetId.length > 256, true)
  assert.deepEqual(ledger.query({ changeSetId: longChangeSetId }), [])
  assert.throws(() => ledger.query({ changeSetId: `${longChangeSetId}z` }), /Dashboard telemetry event is invalid/u)
})

test('Dashboard Host boundary atomically establishes lineage when control-channel telemetry arrives later', () => {
  const ledger = createDashboardAgentTelemetryLedger()
  ledger.append({
    schemaVersion: 1,
    eventType: 'dashboard.call.observed',
    timestampMs: 1,
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
    projectRevision: 'project-revision-1',
  })
  workerChain(ledger)

  const events = ledger.query({ callId: 'call-1' })
  assert.equal(events.length, 5)
  assert.equal(events[0].eventType, 'dashboard.call.observed')
  assert.equal(events[4].eventType, 'tool-call.started')
  assert.deepEqual(ledger.stats(), { capacity: 2048, size: 5, accepted: 5, dropped: 0, failed: 0 })
})

test('Dashboard telemetry is fail-closed, bounded, privacy-whitelisted, and nonfatal through its sink', () => {
  const ledger = createDashboardAgentTelemetryLedger({ capacity: 1 })
  const secret = 'raw-provider-secret'
  const unsafe = {
    schemaVersion: 1,
    eventType: 'task.started',
    timestampMs: 1,
    status: 'started',
    sessionId: 'session-1',
    taskId: 'task-1',
    prompt: secret,
  }
  assert.throws(() => ledger.append(unsafe), /Dashboard telemetry event is invalid/u)
  assert.equal(ledger.sink.emit(unsafe), undefined)
  ledger.append({
    schemaVersion: 1,
    eventType: 'task.started',
    timestampMs: 2,
    status: 'started',
    sessionId: 'session-1',
    taskId: 'task-1',
  })
  assert.equal(
    ledger.record({
      schemaVersion: 1,
      eventType: 'task.completed',
      timestampMs: 3,
      status: 'completed',
      sessionId: 'session-1',
      taskId: 'task-1',
    }),
    null,
  )
  assert.deepEqual(ledger.query({ sessionId: 'session-1' }), [
    {
      schemaVersion: 1,
      eventType: 'task.started',
      timestampMs: 2,
      status: 'started',
      sessionId: 'session-1',
      taskId: 'task-1',
    },
  ])
  assert.doesNotMatch(JSON.stringify(ledger.query({ sessionId: 'session-1' })), new RegExp(secret, 'u'))
  assert.deepEqual(ledger.stats(), { capacity: 1, size: 1, accepted: 1, dropped: 1, failed: 2 })

  const accessor = {}
  Object.defineProperty(accessor, 'schemaVersion', { enumerable: true, get: () => 1 })
  assert.throws(() => createDashboardAgentTelemetryLedger().append(accessor), /Dashboard telemetry event is invalid/u)
})

test('Dashboard telemetry accepts finite failure codes and rejects secret-shaped codes', () => {
  const accepted = createDashboardAgentTelemetryLedger()
  workerChain(accepted)
  accepted.append({
    schemaVersion: 1,
    eventType: 'tool-call.failed',
    timestampMs: 5,
    durationMs: 1,
    status: 'failed',
    errorCode: 'HUMAN_ACTIVITY',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
    changeSetId: CHANGE_SET_1,
  })
  assert.equal(accepted.query({ callId: 'call-1' }).at(-1)?.errorCode, 'HUMAN_ACTIVITY')

  const rejected = createDashboardAgentTelemetryLedger()
  rejected.append({
    schemaVersion: 1,
    eventType: 'task.started',
    timestampMs: 1,
    status: 'started',
    sessionId: 'session-1',
    taskId: 'task-1',
  })
  assert.throws(
    () =>
      rejected.append({
        schemaVersion: 1,
        eventType: 'task.failed',
        timestampMs: 2,
        status: 'failed',
        errorCode: 'sk-live-secret',
        sessionId: 'session-1',
        taskId: 'task-1',
      }),
    /Dashboard telemetry event is invalid/u,
  )
  assert.doesNotMatch(JSON.stringify(rejected.query({ taskId: 'task-1' })), /sk-live-secret/u)
})

test('passive telemetry channels ignore clocks when disabled and consume sink failures when enabled', async () => {
  let disabledClockCalls = 0
  const disabled = createDashboardTelemetryChannel(undefined, () => {
    disabledClockCalls += 1
    throw new Error('disabled clock must stay dormant')
  })
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.start(), null)
  assert.equal(disabled.emit({ eventType: 'unused' }), undefined)
  assert.equal(disabledClockCalls, 0)
  assert.doesNotThrow(() => createDashboardTelemetryChannel(undefined, null))

  let timestamp = 10
  const rejected = createDashboardTelemetryChannel(
    { record: () => Promise.reject(new Error('private async telemetry failure')) },
    () => timestamp++,
  )
  const startedAt = rejected.start()
  assert.doesNotThrow(() => rejected.emit({ eventType: 'safe' }, startedAt))
  await new Promise(resolve => setImmediate(resolve))

  const throwingClock = createDashboardTelemetryChannel(
    {
      record: () => {
        throw new Error('private synchronous telemetry failure')
      },
    },
    () => {
      throw new Error('private telemetry clock failure')
    },
  )
  assert.equal(throwingClock.start(), null)
  assert.doesNotThrow(() => throwingClock.emit({ eventType: 'safe' }))
})
