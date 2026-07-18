import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MessageChannel } from 'node:worker_threads'
import { createAgentRuntimeE2EWorkerEndpointForPlatform } from '../src/editor/agent/runtime-e2e/endpoint.mjs'
import { AgentRuntimeE2EWorkerError, cloneAgentRuntimeE2ESteps } from '../src/editor/agent/runtime-e2e/protocol.mjs'
import { startAgentRuntimeE2EWorkerRuntime } from '../src/editor/agent/runtime-e2e/worker-runtime.mjs'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const readRepositoryFile = relativePath => readFile(new URL(relativePath, `file://${repositoryRoot}/`), 'utf8')

const steps = [
  {
    expectedPhase: 'BLUEPRINT',
    events: [{ schemaVersion: 1, kind: 'blueprint', summary: 'Build the requested screen' }],
  },
]

class FakeModuleWorker extends EventTarget {
  messages = []
  terminateCount = 0

  postMessage(message, transfer) {
    this.messages.push({ message, transfer })
  }

  terminate() {
    this.terminateCount += 1
  }

  dispatchMessage(data) {
    const event = new Event('message')
    Object.defineProperty(event, 'data', { value: data })
    this.dispatchEvent(event)
  }

  dispatchWorkerError(error) {
    const event = new Event('error')
    Object.defineProperties(event, {
      error: { value: error },
      message: { value: error.message },
    })
    this.dispatchEvent(event)
  }
}

const createHarness = (inputSteps, telemetry) => {
  const worker = new FakeModuleWorker()
  const channel = new MessageChannel()
  const workerCreations = []
  const queuedMicrotasks = []
  const endpoint = createAgentRuntimeE2EWorkerEndpointForPlatform(
    { steps: inputSteps, ...(telemetry ? { telemetry } : {}) },
    {
      createMessageChannel: () => channel,
      createWorker: generation => {
        workerCreations.push({ generation })
        return worker
      },
      queueMicrotask: callback => queuedMicrotasks.push(callback),
    },
  )
  return { channel, endpoint, queuedMicrotasks, worker, workerCreations }
}

const telemetryEvent = (taskId = 'task-1') => ({
  schemaVersion: 1,
  eventType: 'task.started',
  timestampMs: 1,
  status: 'started',
  sessionId: 'session-1',
  taskId,
})

test('pure endpoint factory transfers one MessagePort and completes the Worker ready handshake', async t => {
  const harness = createHarness(steps)
  t.after(() => {
    harness.endpoint.terminate()
    harness.channel.port2.close()
  })

  assert.equal(harness.endpoint.port, harness.channel.port1)
  assert.equal(typeof harness.endpoint.onFault, 'function')
  assert.equal(typeof harness.endpoint.terminate, 'function')
  assert.equal(typeof harness.endpoint.ready, 'function')
  assert.equal(Object.isFrozen(harness.endpoint), true)
  assert.equal(harness.workerCreations.length, 1)
  assert.equal(Number.isSafeInteger(harness.workerCreations[0].generation), true)
  assert.ok(harness.workerCreations[0].generation > 0)

  assert.equal(harness.worker.messages.length, 1)
  const [{ message, transfer }] = harness.worker.messages
  assert.equal(message.schemaVersion, 1)
  assert.equal(message.kind, 'start')
  assert.equal(message.port, harness.channel.port2)
  assert.deepEqual(transfer, [harness.channel.port2])
  assert.deepEqual(message.steps, steps)
  assert.notEqual(message.steps, steps)
  assert.equal(Object.isFrozen(message.steps), true)

  harness.worker.dispatchMessage({
    schemaVersion: 1,
    kind: 'ready',
    generation: message.generation,
  })
  await harness.endpoint.ready()

  harness.endpoint.terminate()
  harness.endpoint.terminate()
  assert.equal(harness.worker.terminateCount, 1, 'terminate must be idempotent')
})

test('fault listeners receive Worker failures and can unsubscribe', () => {
  const harness = createHarness(steps)
  const faults = []
  const unsubscribe = harness.endpoint.onFault(error => faults.push(error))
  const failure = new Error('intentional browser Worker crash')

  harness.worker.dispatchWorkerError(failure)
  assert.deepEqual(faults, [failure])
  unsubscribe()
  harness.worker.dispatchWorkerError(new Error('ignored after unsubscribe'))
  assert.equal(faults.length, 1)

  harness.endpoint.terminate()
  harness.channel.port2.close()
})

test('faults raised before subscription are replayed without racing Runtime listener attachment', () => {
  const harness = createHarness(steps)
  const start = harness.worker.messages[0].message
  harness.worker.dispatchMessage({
    schemaVersion: 1,
    kind: 'fault',
    generation: start.generation,
    message: 'bootstrap failed',
  })

  const faults = []
  harness.endpoint.onFault(error => faults.push(error))
  assert.equal(faults.length, 0)
  assert.equal(harness.queuedMicrotasks.length, 1)
  harness.queuedMicrotasks[0]()
  assert.equal(faults.length, 1)
  assert.equal(faults[0].code, 'worker-fault')
  assert.match(faults[0].message, /bootstrap failed/)

  harness.endpoint.terminate()
  harness.channel.port2.close()
})

test('Worker telemetry crosses the real control protocol without cloning a main-thread sink into the Worker', () => {
  const received = []
  const harness = createHarness(steps, { emit: event => received.push(event) })
  const start = harness.worker.messages[0].message
  assert.deepEqual(Object.keys(start).sort(), ['generation', 'kind', 'port', 'schemaVersion', 'steps'])

  harness.worker.dispatchMessage({
    schemaVersion: 1,
    kind: 'telemetry',
    generation: start.generation,
    event: telemetryEvent(),
  })
  assert.deepEqual(received, [telemetryEvent()])
  assert.equal(Object.isFrozen(received[0]), true)

  harness.endpoint.terminate()
  harness.channel.port2.close()
})

test('telemetry control messages fail closed for sensitive fields and wrong generations', () => {
  const secret = 'RAW_PROMPT_CREDENTIAL_MUST_NOT_REFLECT'
  for (const messageFor of [
    generation => ({
      schemaVersion: 1,
      kind: 'telemetry',
      generation,
      event: { ...telemetryEvent(), prompt: secret },
    }),
    generation => ({
      schemaVersion: 1,
      kind: 'telemetry',
      generation: generation + 1,
      event: telemetryEvent(),
    }),
    generation => ({
      schemaVersion: 1,
      kind: 'telemetry',
      generation,
      event: {
        ...telemetryEvent(),
        eventType: 'task.failed',
        status: 'failed',
        errorCode: 'sk-live-secret',
      },
    }),
  ]) {
    const received = []
    const faults = []
    const harness = createHarness(steps, { emit: event => received.push(event) })
    harness.endpoint.onFault(error => faults.push(error))
    const generation = harness.worker.messages[0].message.generation
    harness.worker.dispatchMessage(messageFor(generation))
    assert.deepEqual(received, [])
    assert.equal(faults.length, 1)
    assert.doesNotMatch(faults[0].message, new RegExp(secret))
    harness.endpoint.terminate()
    harness.channel.port2.close()
  }
})

test('E2E telemetry rejects discriminant accessors without evaluating them', () => {
  for (const field of ['schemaVersion', 'eventType']) {
    let reads = 0
    const event = telemetryEvent()
    Object.defineProperty(event, field, {
      enumerable: true,
      get() {
        reads += 1
        return telemetryEvent()[field]
      },
    })
    const received = []
    const faults = []
    const harness = createHarness(steps, { emit: value => received.push(value) })
    harness.endpoint.onFault(error => faults.push(error))
    const generation = harness.worker.messages[0].message.generation
    harness.worker.dispatchMessage({ schemaVersion: 1, kind: 'telemetry', generation, event })
    assert.equal(reads, 0)
    assert.deepEqual(received, [])
    assert.equal(faults.length, 1)
    harness.endpoint.terminate()
    harness.channel.port2.close()
  }
})

test('main-thread telemetry delivery is bounded and sink failures never gate the Worker handshake', async () => {
  let calls = 0
  const harness = createHarness(steps, {
    emit: () => {
      calls += 1
      return new Promise(() => {})
    },
  })
  const generation = harness.worker.messages[0].message.generation
  for (let index = 0; index < 33; index += 1) {
    harness.worker.dispatchMessage({
      schemaVersion: 1,
      kind: 'telemetry',
      generation,
      event: telemetryEvent(`task-${index}`),
    })
  }
  assert.equal(calls, 32)
  harness.worker.dispatchMessage({ schemaVersion: 1, kind: 'ready', generation })
  await harness.endpoint.ready()
  harness.endpoint.terminate()
  harness.channel.port2.close()

  const throwing = createHarness(steps, {
    emit: () => {
      throw new Error('private sink failure')
    },
  })
  const throwingGeneration = throwing.worker.messages[0].message.generation
  throwing.worker.dispatchMessage({
    schemaVersion: 1,
    kind: 'telemetry',
    generation: throwingGeneration,
    event: telemetryEvent(),
  })
  throwing.worker.dispatchMessage({ schemaVersion: 1, kind: 'ready', generation: throwingGeneration })
  await throwing.endpoint.ready()
  throwing.endpoint.terminate()
  throwing.channel.port2.close()
})

test('the E2E Worker runtime bootstrap functionally requires and relays startAgentWorker telemetry', async () => {
  let capturedOptions
  const controls = []
  await startAgentRuntimeE2EWorkerRuntime({
    start: options => {
      capturedOptions = options
      return Promise.resolve()
    },
    port: {},
    model: {},
    clock: {},
    idFactory: {},
    generation: 7,
    postControl: control => controls.push(control),
  })
  assert.equal(typeof capturedOptions.telemetry.emit, 'function')
  capturedOptions.telemetry.emit(telemetryEvent())
  assert.deepEqual(controls, [{ schemaVersion: 1, kind: 'telemetry', generation: 7, event: telemetryEvent() }])
})

test('script input is cloned, immutable, and rejects callbacks or other non-DTO values before Worker creation', () => {
  const cloned = cloneAgentRuntimeE2ESteps(steps)
  assert.deepEqual(cloned, steps)
  assert.notEqual(cloned, steps)
  assert.notEqual(cloned[0], steps[0])
  assert.equal(Object.isFrozen(cloned), true)
  assert.equal(Object.isFrozen(cloned[0]), true)

  for (const invalidSteps of [
    [{ ...steps[0], matchRequest: () => true }],
    [{ ...steps[0], events: [{ ...steps[0].events[0], callback: () => {} }] }],
    [{ ...steps[0], events: [{ ...steps[0].events[0], payload: new Map() }] }],
  ]) {
    assert.throws(
      () => cloneAgentRuntimeE2ESteps(invalidSteps),
      error => error instanceof AgentRuntimeE2EWorkerError && error.code === 'invalid-steps',
    )
  }
})

test('entry is VITE_E2E-gated and dynamically loads an isolated Worker-local scripted adapter', async () => {
  const { loadAgentRuntimeE2EWorkerEndpointFactory } = await import('../src/editor/agent/runtime-e2e/index.mjs')
  await assert.rejects(loadAgentRuntimeE2EWorkerEndpointFactory(), /only when VITE_E2E=1/)

  const [entrySource, endpointSource, workerSource, workerRuntimeSource] = await Promise.all([
    readRepositoryFile('examples/dashboard/src/editor/agent/runtime-e2e/index.mjs'),
    readRepositoryFile('examples/dashboard/src/editor/agent/runtime-e2e/endpoint.mjs'),
    readRepositoryFile('examples/dashboard/src/editor/agent/runtime-e2e/worker.mjs'),
    readRepositoryFile('examples/dashboard/src/editor/agent/runtime-e2e/worker-runtime.mjs'),
  ])

  assert.match(entrySource, /import\.meta\.env\?\.VITE_E2E === '1'/)
  assert.match(entrySource, /await import\('\.\/endpoint\.mjs'\)/)
  assert.match(endpointSource, /new Worker\(new URL\('\.\/worker\.mjs', import\.meta\.url\)/)
  assert.match(endpointSource, /type: 'module'/)
  assert.match(workerSource, /from '@easy-editor\/agent-runtime\/testing'/)
  assert.match(workerSource, /from '@easy-editor\/agent-runtime\/worker'/)
  assert.match(workerSource, /class DashboardE2EScriptedModelAdapter/)
  assert.match(workerSource, /event\.call\.expectedRevision = request\.snapshot\.revision/)
  assert.match(workerSource, /new ScriptedModelAdapter\(\[resolved\]\)/)
  assert.match(workerSource, /model: new DashboardE2EScriptedModelAdapter\(start\.steps\)/)
  assert.match(workerSource, /startAgentRuntimeE2EWorkerRuntime\(/)
  assert.match(workerSource, /start: startAgentWorker/)
  assert.match(workerRuntimeSource, /start\(\{ port, model, clock, idFactory, telemetry \}\)/)
  assert.doesNotMatch(workerSource, /from '@easy-editor\/agent-runtime'/)
})
