import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MODEL_GATEWAY_MAX_BODY_BYTES,
  MODEL_GATEWAY_MAX_MESSAGES,
  MODEL_GATEWAY_PATH,
  createModelGatewayHandler,
} from '../server/gateway/index.mjs'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const prompt = 'private-business-prompt'
const secret = 'provider-secret-never-reflect'

const gatewayRequest = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  stepId: 'step-1',
  modelRequestId: 'model-request-1',
  providerId: 'provider-1',
  model: 'model-1',
  phase: 'PLAN_STEP',
  messages: [{ role: 'user', content: prompt }],
  maxOutputTokens: 512,
  ...overrides,
})

const transportRequest = (body = gatewayRequest(), overrides = {}) => ({
  method: 'POST',
  path: MODEL_GATEWAY_PATH,
  headers: { 'content-type': 'application/json' },
  body: encoder.encode(JSON.stringify(body)),
  signal: new AbortController().signal,
  ...overrides,
})

const collectFrames = async result => {
  let serialized = ''
  for await (const chunk of result.body) {
    assert.ok(chunk instanceof Uint8Array)
    serialized += decoder.decode(chunk)
  }
  return {
    frames: serialized
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line)),
    serialized,
  }
}

const completedEvents = async function* () {
  yield { kind: 'delta', delta: 'hello ' }
  yield {
    kind: 'completed',
    finishReason: 'stop',
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  }
}

const createHarness = ({ authorizePrincipal, providerTransport, ...handlerOptions } = {}) => {
  const authorizationCalls = []
  const providerCalls = []
  const principal = Object.freeze({ tenantId: 'tenant-1', userId: 'user-1' })
  const handler = createModelGatewayHandler({
    authorizePrincipal:
      authorizePrincipal ??
      (async input => {
        authorizationCalls.push(input)
        return principal
      }),
    providerTransport:
      providerTransport ??
      Object.freeze({
        stream(input) {
          providerCalls.push(input)
          return completedEvents()
        },
      }),
    ...handlerOptions,
  })
  return { authorizationCalls, handler, principal, providerCalls }
}

const errorCode = frames => frames.at(-1)?.error?.code

test('handler streams provider-neutral frames with exact runtime correlation', async () => {
  const harness = createHarness()
  const result = await harness.handler.handle(transportRequest())
  const { frames } = await collectFrames(result)
  const ids = {
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    modelRequestId: 'model-request-1',
  }

  assert.equal(result.status, 200)
  assert.equal(result.headers['content-type'], 'application/x-ndjson; charset=utf-8')
  assert.deepEqual(frames, [
    { schemaVersion: 1, kind: 'started', ...ids },
    { schemaVersion: 1, kind: 'delta', delta: 'hello ', ...ids },
    {
      schemaVersion: 1,
      kind: 'completed',
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      ...ids,
    },
  ])
  assert.equal(harness.authorizationCalls.length, 1)
  assert.equal(harness.authorizationCalls[0].projectId, 'project-1')
  assert.equal(harness.providerCalls.length, 1)
  assert.equal(harness.providerCalls[0].principal, harness.principal)
  assert.deepEqual(harness.providerCalls[0].request, gatewayRequest())
  assert.ok(harness.providerCalls[0].signal instanceof AbortSignal)
})

test('handler applies canonical body limits and rejects unknown request fields', async () => {
  const harness = createHarness()
  const tooManyMessages = Array.from({ length: MODEL_GATEWAY_MAX_MESSAGES + 1 }, () => ({
    role: 'user',
    content: 'bounded',
  }))
  for (const body of [
    { ...gatewayRequest(), browserGrant: 'indexeddb-is-not-authority' },
    gatewayRequest({ messages: tooManyMessages }),
  ]) {
    const result = await harness.handler.handle(transportRequest(body))
    const { frames } = await collectFrames(result)
    assert.equal(result.status, 400)
    assert.equal(errorCode(frames), 'INVALID_REQUEST')
  }

  const oversized = new Uint8Array(MODEL_GATEWAY_MAX_BODY_BYTES + 1)
  const result = await harness.handler.handle(transportRequest(undefined, { body: oversized }))
  const { frames } = await collectFrames(result)
  assert.equal(result.status, 413)
  assert.equal(errorCode(frames), 'INVALID_REQUEST')
  assert.equal(harness.authorizationCalls.length, 0)
  assert.equal(harness.providerCalls.length, 0)
})

test('handler rejects malformed transport, method, path, and content type before authorization', async () => {
  const harness = createHarness()
  const base = transportRequest()
  const { signal: _signal, ...missingSignal } = base
  const cases = [
    { expectedStatus: 400, request: missingSignal },
    { expectedStatus: 400, request: { ...base, localGrant: true } },
    { expectedStatus: 405, request: { ...base, method: 'GET' } },
    { expectedStatus: 404, request: { ...base, path: '/api/not-the-gateway' } },
    { expectedStatus: 415, request: { ...base, headers: { 'content-type': 'text/plain' } } },
  ]
  for (const { expectedStatus, request } of cases) {
    const result = await harness.handler.handle(request)
    const { frames } = await collectFrames(result)
    assert.equal(result.status, expectedStatus)
    assert.equal(errorCode(frames), 'INVALID_REQUEST')
  }
  assert.equal(harness.authorizationCalls.length, 0)
})

test('handler rejects subject/project mismatch before provider invocation', async () => {
  let providerCalls = 0
  const handler = createModelGatewayHandler({
    authorizePrincipal: async () => {
      throw Object.assign(new Error(`forged ${prompt}`), { status: 403 })
    },
    providerTransport: {
      stream() {
        providerCalls += 1
        return completedEvents()
      },
    },
  })

  const result = await handler.handle(transportRequest())
  const { frames, serialized } = await collectFrames(result)
  assert.equal(result.status, 403)
  assert.equal(errorCode(frames), 'UNAUTHORIZED')
  assert.equal(providerCalls, 0)
  assert.doesNotMatch(serialized, new RegExp(prompt))
})

test('handler maps provider 429 and 5xx setup failures to fixed safe errors', async () => {
  for (const [status, expectedStatus, expectedCode] of [
    [429, 429, 'PROVIDER_RATE_LIMITED'],
    [503, 502, 'PROVIDER_UNAVAILABLE'],
  ]) {
    const harness = createHarness({
      providerTransport: {
        async stream() {
          throw Object.assign(new Error(`${prompt} ${secret}`), { status })
        },
      },
    })
    const result = await harness.handler.handle(transportRequest())
    const { frames, serialized } = await collectFrames(result)
    assert.equal(result.status, expectedStatus)
    assert.equal(errorCode(frames), expectedCode)
    assert.doesNotMatch(serialized, new RegExp(`${prompt}|${secret}`))
  }
})

test('handler maps malformed events and invalid usage without reflecting provider values', async () => {
  for (const event of [
    { kind: 'delta', delta: 'ignored', secret },
    { kind: 'completed', finishReason: 'stop', usage: { inputTokens: Number.NaN } },
  ]) {
    const logs = []
    const harness = createHarness({
      logger: { warn: value => logs.push(value) },
      providerTransport: {
        stream: async function* () {
          yield event
        },
      },
    })
    const result = await harness.handler.handle(transportRequest())
    const { frames, serialized } = await collectFrames(result)
    assert.equal(result.status, 200)
    assert.equal(errorCode(frames), 'PROVIDER_RESPONSE_INVALID')
    assert.doesNotMatch(serialized, new RegExp(`${prompt}|${secret}|ignored`))
    assert.doesNotMatch(JSON.stringify(logs), new RegExp(`${prompt}|${secret}|ignored`))
  }
})

test('handler maps a provider stream ending without completion to disconnect', async () => {
  const harness = createHarness({
    providerTransport: {
      stream: async function* () {
        yield { kind: 'delta', delta: 'partial' }
      },
    },
  })
  const result = await harness.handler.handle(transportRequest())
  const { frames } = await collectFrames(result)
  assert.equal(errorCode(frames), 'PROVIDER_DISCONNECTED')
})

const rejectWhenAborted = signal =>
  new Promise((_, reject) => {
    const rejectAbort = () => reject(signal.reason)
    signal.addEventListener('abort', rejectAbort, { once: true })
    if (signal.aborted) rejectAbort()
  })

test('handler maps caller cancellation and forwards abort to the provider', async () => {
  const controller = new AbortController()
  let providerSignal
  const harness = createHarness({
    providerTransport: {
      stream: async function* ({ signal }) {
        providerSignal = signal
        await rejectWhenAborted(signal)
        yield { kind: 'completed', finishReason: 'cancelled' }
      },
    },
  })
  const result = await harness.handler.handle(transportRequest(undefined, { signal: controller.signal }))
  const iterator = result.body[Symbol.asyncIterator]()
  assert.equal(JSON.parse(decoder.decode((await iterator.next()).value)).kind, 'started')
  const pending = iterator.next()
  controller.abort(new Error(`${prompt} ${secret}`))
  const aborted = JSON.parse(decoder.decode((await pending).value))
  assert.equal(aborted.error.code, 'REQUEST_ABORTED')
  assert.equal(providerSignal.aborted, true)
  assert.doesNotMatch(JSON.stringify(aborted), new RegExp(`${prompt}|${secret}`))
  await iterator.next()
})

test('handler preserves the injected deadline failure through the combined signal', async () => {
  const harness = createHarness({
    timeoutMs: 10,
    providerTransport: {
      stream: async function* ({ signal }) {
        await rejectWhenAborted(signal)
        yield { kind: 'completed', finishReason: 'cancelled' }
      },
    },
  })
  const result = await harness.handler.handle(transportRequest())
  const { frames } = await collectFrames(result)
  assert.equal(errorCode(frames), 'GATEWAY_DEADLINE_EXCEEDED')
})

test('handler enforces provider event and encoded output byte budgets', async () => {
  const eventLimit = createHarness({
    providerTransport: {
      stream: async function* () {
        for (let index = 0; index < 256; index += 1) yield { kind: 'delta', delta: '' }
        yield { kind: 'completed', finishReason: 'stop' }
      },
    },
  })
  const eventResult = await eventLimit.handler.handle(transportRequest())
  assert.equal(errorCode((await collectFrames(eventResult)).frames), 'PROVIDER_BUDGET_EXCEEDED')

  const outputLimit = createHarness({
    providerTransport: {
      stream: async function* () {
        yield { kind: 'delta', delta: 'x'.repeat(1024 * 1024) }
      },
    },
  })
  const outputResult = await outputLimit.handler.handle(transportRequest())
  const { frames, serialized } = await collectFrames(outputResult)
  assert.equal(errorCode(frames), 'PROVIDER_BUDGET_EXCEEDED')
  assert.ok(serialized.length < 4096, 'rejected provider output must not be reflected')
})

test('handler enforces max concurrency and releases the slot when a consumer closes', async () => {
  const harness = createHarness({ maxConcurrent: 1 })
  const first = await harness.handler.handle(transportRequest(gatewayRequest({ modelRequestId: 'model-request-held' })))
  const firstIterator = first.body[Symbol.asyncIterator]()
  assert.equal(JSON.parse(decoder.decode((await firstIterator.next()).value)).kind, 'started')

  const busy = await harness.handler.handle(transportRequest(gatewayRequest({ modelRequestId: 'model-request-busy' })))
  assert.equal(busy.status, 429)
  assert.equal(errorCode((await collectFrames(busy)).frames), 'GATEWAY_BUSY')
  await firstIterator.return()

  const afterRelease = await harness.handler.handle(
    transportRequest(gatewayRequest({ modelRequestId: 'model-request-after-release' })),
  )
  assert.equal(errorCode((await collectFrames(afterRelease)).frames), undefined)
})

test('handler releases its concurrency slot after a streamed provider error', async () => {
  let calls = 0
  const harness = createHarness({
    maxConcurrent: 1,
    providerTransport: {
      stream() {
        calls += 1
        if (calls === 1) {
          return (async function* () {
            yield { kind: 'delta', delta: 'invalid', unexpected: true }
          })()
        }
        return completedEvents()
      },
    },
  })

  const failed = await harness.handler.handle(transportRequest())
  assert.equal(errorCode((await collectFrames(failed)).frames), 'PROVIDER_RESPONSE_INVALID')
  const recovered = await harness.handler.handle(
    transportRequest(gatewayRequest({ modelRequestId: 'model-request-recovered' })),
  )
  assert.equal(errorCode((await collectFrames(recovered)).frames), undefined)
})
