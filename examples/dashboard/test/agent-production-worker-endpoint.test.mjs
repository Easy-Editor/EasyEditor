import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MessageChannel } from 'node:worker_threads'

import { createProductionAgentWorkerEndpointForPlatform } from '../src/agent-runtime/production/endpoint.mjs'
import {
  PRODUCTION_AGENT_MODEL_ENV,
  ProductionAgentWorkerError,
  createProductionAgentGrantAuthority,
  readProductionAgentModelConfig,
} from '../src/agent-runtime/production/protocol.mjs'
import { startProductionAgentWorkerRuntime } from '../src/agent-runtime/production/worker-runtime.mjs'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const readRepositoryFile = relativePath => readFile(new URL(relativePath, `file://${repositoryRoot}/`), 'utf8')

const config = Object.freeze({
  providerId: 'provider-1',
  model: 'model-1',
  path: '/api/agent/model/stream',
})

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

  dispatchWorkerError(message) {
    const event = new Event('error')
    Object.defineProperty(event, 'message', { value: message })
    this.dispatchEvent(event)
  }
}

const createHarness = telemetry => {
  const worker = new FakeModuleWorker()
  const channel = new MessageChannel()
  const workerCreations = []
  const queuedMicrotasks = []
  const endpoint = createProductionAgentWorkerEndpointForPlatform(
    { config, ...(telemetry ? { telemetry } : {}) },
    {
      createMessageChannel: () => channel,
      createWorker: generation => {
        workerCreations.push(generation)
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

test('production endpoint transfers one safe config and completes the ready lifecycle', async t => {
  const harness = createHarness()
  t.after(() => {
    harness.endpoint.terminate()
    harness.channel.port2.close()
  })

  assert.equal(harness.endpoint.port, harness.channel.port1)
  assert.equal(Object.isFrozen(harness.endpoint), true)
  assert.equal(harness.workerCreations.length, 1)
  assert.ok(harness.workerCreations[0] > 0)
  assert.equal(harness.worker.messages.length, 1)

  const [{ message, transfer }] = harness.worker.messages
  assert.deepEqual(Object.keys(message).sort(), ['config', 'generation', 'kind', 'port', 'schemaVersion'])
  assert.equal(message.schemaVersion, 1)
  assert.equal(message.kind, 'start')
  assert.equal(message.port, harness.channel.port2)
  assert.deepEqual(message.config, config)
  assert.notEqual(message.config, config)
  assert.equal(Object.isFrozen(message.config), true)
  assert.deepEqual(transfer, [harness.channel.port2])

  harness.worker.dispatchMessage({ schemaVersion: 1, kind: 'ready', generation: message.generation })
  await harness.endpoint.ready()
  harness.endpoint.terminate()
  harness.endpoint.terminate()
  assert.equal(harness.worker.terminateCount, 1)
})

test('production endpoint publishes fixed faults, replays early faults, and rejects ready', async () => {
  const harness = createHarness()
  const ready = harness.endpoint.ready()
  const providerSecret = 'provider-secret-must-not-reflect'
  harness.worker.dispatchWorkerError(providerSecret)

  await assert.rejects(
    ready,
    error =>
      error instanceof ProductionAgentWorkerError &&
      error.code === 'worker-fault' &&
      !error.message.includes(providerSecret),
  )
  const faults = []
  harness.endpoint.onFault(error => faults.push(error))
  assert.equal(faults.length, 0)
  assert.equal(harness.queuedMicrotasks.length, 1)
  harness.queuedMicrotasks[0]()
  assert.equal(faults.length, 1)
  assert.equal(faults[0].code, 'worker-fault')
  assert.doesNotMatch(faults[0].message, new RegExp(providerSecret))

  harness.endpoint.terminate()
  harness.channel.port2.close()
})

test('fault control messages and mismatched generations fail closed without reflecting Worker text', async t => {
  await t.test('fault control', async () => {
    const harness = createHarness()
    const start = harness.worker.messages[0].message
    const providerSecret = 'worker-provider-secret'
    harness.worker.dispatchMessage({
      schemaVersion: 1,
      kind: 'fault',
      generation: start.generation,
      message: providerSecret,
    })
    await assert.rejects(
      harness.endpoint.ready(),
      error => error.code === 'worker-fault' && !error.message.includes(providerSecret),
    )
    harness.endpoint.terminate()
    harness.channel.port2.close()
  })

  await t.test('generation mismatch', async () => {
    const harness = createHarness()
    const start = harness.worker.messages[0].message
    harness.worker.dispatchMessage({ schemaVersion: 1, kind: 'ready', generation: start.generation + 1 })
    await assert.rejects(
      harness.endpoint.ready(),
      error => error.code === 'worker-fault' && /generation/u.test(error.message),
    )
    harness.endpoint.terminate()
    harness.channel.port2.close()
  })
})

test('production telemetry crosses the real control protocol without cloning the main-thread sink', () => {
  const received = []
  const harness = createHarness({ emit: event => received.push(event) })
  const start = harness.worker.messages[0].message
  assert.deepEqual(Object.keys(start).sort(), ['config', 'generation', 'kind', 'port', 'schemaVersion'])
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

test('production telemetry fails closed for sensitive fields and wrong generations', () => {
  const secret = 'RAW_PROMPT_CREDENTIAL_MUST_NOT_REFLECT'
  for (const messageFor of [
    generation => ({
      schemaVersion: 1,
      kind: 'telemetry',
      generation,
      event: { ...telemetryEvent(), credential: secret },
    }),
    generation => ({
      schemaVersion: 1,
      kind: 'telemetry',
      generation: generation + 1,
      event: telemetryEvent(),
    }),
  ]) {
    const received = []
    const faults = []
    const harness = createHarness({ emit: event => received.push(event) })
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

test('production telemetry rejects discriminant accessors without evaluating them', () => {
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
    const harness = createHarness({ emit: value => received.push(value) })
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

test('production telemetry delivery is bounded and sink failures remain non-fatal', async () => {
  let calls = 0
  const harness = createHarness({
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

  const throwing = createHarness({
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

test('the production Worker runtime functionally requires telemetry and the actual Gateway token budget', async () => {
  let capturedOptions
  const controls = []
  await startProductionAgentWorkerRuntime({
    start: options => {
      capturedOptions = options
      return Promise.resolve()
    },
    port: {},
    model: {},
    generation: 9,
    postControl: control => controls.push(control),
  })
  assert.equal(capturedOptions.modelTokenBudget, 4_096)
  assert.equal(typeof capturedOptions.telemetry.emit, 'function')
  capturedOptions.telemetry.emit(telemetryEvent())
  assert.deepEqual(controls, [{ schemaVersion: 1, kind: 'telemetry', generation: 9, event: telemetryEvent() }])
})

test('terminate-before-ready rejects once and closes an idempotent endpoint', async () => {
  const harness = createHarness()
  const ready = harness.endpoint.ready()
  harness.endpoint.terminate()
  harness.endpoint.terminate()

  await assert.rejects(
    ready,
    error => error instanceof ProductionAgentWorkerError && error.code === 'terminated-before-ready',
  )
  assert.equal(harness.worker.terminateCount, 1)
  harness.channel.port2.close()
})

test('browser config reads only providerId/model/path and rejects secret-bearing or cross-origin DTOs', () => {
  const providerSecret = 'server-only-provider-secret'
  const reads = []
  const source = new Proxy(
    {
      [PRODUCTION_AGENT_MODEL_ENV.providerId]: 'provider-1',
      [PRODUCTION_AGENT_MODEL_ENV.model]: 'model-1',
      [PRODUCTION_AGENT_MODEL_ENV.path]: '/api/agent/model/stream',
      VITE_DASHBOARD_AGENT_PROVIDER_SECRET: providerSecret,
    },
    {
      get(target, key, receiver) {
        reads.push(key)
        return Reflect.get(target, key, receiver)
      },
    },
  )

  const resolved = readProductionAgentModelConfig(source)
  assert.deepEqual(resolved, config)
  assert.deepEqual(reads, [
    PRODUCTION_AGENT_MODEL_ENV.providerId,
    PRODUCTION_AGENT_MODEL_ENV.model,
    PRODUCTION_AGENT_MODEL_ENV.path,
  ])
  assert.doesNotMatch(JSON.stringify(resolved), new RegExp(providerSecret))
  assert.deepEqual(createProductionAgentGrantAuthority(resolved), {
    userId: 'dashboard-browser-session',
    policyVersion: 'dashboard-agent-gateway/1',
    providerId: 'provider-1',
    providerFingerprint: 'same-origin:["/api/agent/model/stream","provider-1","model-1"]',
    providerLabel: 'provider-1 / model-1',
  })
  assert.notEqual(
    createProductionAgentGrantAuthority({ ...config, path: '/a:b', providerId: 'c' }).providerFingerprint,
    createProductionAgentGrantAuthority({ ...config, path: '/a', providerId: 'b:c' }).providerFingerprint,
  )

  for (const invalid of [
    { ...config, apiKey: providerSecret },
    { ...config, path: 'https://attacker.example/model' },
    { ...config, providerId: '../provider' },
  ]) {
    assert.throws(
      () => createProductionAgentWorkerEndpointForPlatform({ config: invalid }, {}),
      error => error instanceof ProductionAgentWorkerError && error.code === 'invalid-config',
    )
  }
})

test('production Worker modules are isolated from testing/E2E imports and the bundle verifier permits them', async () => {
  const [entrySource, endpointSource, protocolSource, workerSource, workerRuntimeSource, verifierSource] =
    await Promise.all([
      readRepositoryFile('examples/dashboard/src/agent-runtime/production/index.mjs'),
      readRepositoryFile('examples/dashboard/src/agent-runtime/production/endpoint.mjs'),
      readRepositoryFile('examples/dashboard/src/agent-runtime/production/protocol.mjs'),
      readRepositoryFile('examples/dashboard/src/agent-runtime/production/worker.mjs'),
      readRepositoryFile('examples/dashboard/src/agent-runtime/production/worker-runtime.mjs'),
      readRepositoryFile('examples/dashboard/scripts/verify-production-bundle.mjs'),
    ])
  const productionSource = [entrySource, endpointSource, protocolSource, workerSource, workerRuntimeSource].join('\n')

  assert.doesNotMatch(productionSource, /runtime-e2e|agent-runtime\/testing|ScriptedModelAdapter/u)
  assert.doesNotMatch(productionSource, /apiKey|authorization|provider.?secret/iu)
  assert.match(entrySource, /await import\('\.\/endpoint\.mjs'\)/u)
  assert.match(endpointSource, /new Worker\(new URL\('\.\/worker\.mjs', import\.meta\.url\)/u)
  assert.match(endpointSource, /type: 'module'/u)
  assert.match(workerSource, /from '@easy-editor\/agent-runtime\/worker'/u)
  assert.match(workerSource, /new GatewayModelAdapter\(start\.config\)/u)
  assert.match(workerSource, /startProductionAgentWorkerRuntime\(/u)
  assert.match(workerSource, /start: startAgentWorker/u)
  assert.match(workerRuntimeSource, /modelTokenBudget: GATEWAY_MODEL_TOKEN_BUDGET/u)
  assert.match(
    workerRuntimeSource,
    /start\(\{ port, model, modelTokenBudget: GATEWAY_MODEL_TOKEN_BUDGET, telemetry \}\)/u,
  )
  assert.match(verifierSource, /@easy-editor\/agent-runtime\/testing/u)
  assert.match(verifierSource, /ScriptedModelAdapter/u)
  for (const marker of [
    'createDashboardE2EPostIntentGate',
    'armDashboardAgentPostIntentGate',
    'waitForDashboardAgentPostIntent',
    'releaseDashboardAgentPostIntentGate',
  ]) {
    assert.match(verifierSource, new RegExp(marker, 'u'))
  }
  assert.match(verifierSource, /allowing the production Gateway Worker/u)
})
