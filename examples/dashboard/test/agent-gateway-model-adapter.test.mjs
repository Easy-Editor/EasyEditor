import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_GATEWAY_MODEL_PATH,
  GATEWAY_MODEL_TOKEN_BUDGET,
  GatewayModelAdapter,
  GatewayModelAdapterError,
} from '../src/agent-runtime/gateway-model-adapter.mjs'

const encoder = new TextEncoder()
const correlation = {
  sessionId: 'session-1',
  taskId: 'task-1',
  stepId: 'step-1',
  modelRequestId: 'request-1',
}
const request = {
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  ...correlation,
  phase: 'PLAN_STEP',
  intent: { text: 'Build the dashboard' },
  snapshot: {
    schemaVersion: 1,
    revision: 'revision-1',
    providerGenerations: { dashboard: 1 },
    projection: { dashboard: { title: '城市概览' } },
  },
  sessionContext: {
    schemaVersion: 1,
    budget: { maxTurns: 4, maxTextBytes: 4_096, maxUnresolvedConstraints: 8 },
    sourceJournalRange: { startPosition: 0, endPosition: 0 },
    sourceTaskCount: 1,
    includedTaskIds: ['task-1'],
    omittedTaskCount: 0,
    omittedUnresolvedConstraintCount: 0,
    sourceHash: 'fnv1a32:00000000',
    textBytes: 19,
    excerpts: [],
    unresolvedConstraints: [],
  },
  repairAttempts: 0,
}

const frame = (kind, fields = {}) => ({ schemaVersion: 1, kind, ...correlation, ...fields })
const ndjson = frames => `${frames.map(value => JSON.stringify(value)).join('\n')}\n`

const responseFromChunks = (chunks, options = {}) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
        controller.close()
      },
    }),
    {
      status: options.status ?? 200,
      headers: { 'content-type': options.contentType ?? 'application/x-ndjson; charset=utf-8' },
    },
  )

const collect = async (adapter, signal = new AbortController().signal) => {
  const events = []
  for await (const event of adapter.run(request, signal)) events.push(event)
  return events
}

const completedFrames = output => [
  frame('started'),
  frame('delta', { delta: output }),
  frame('completed', { finishReason: 'stop' }),
]

const adapterFor = (fetch, overrides = {}) =>
  new GatewayModelAdapter({
    providerId: 'provider-1',
    model: 'model-1',
    fetch,
    ...overrides,
  })

test('maps the exact ModelTurnRequest into the same-origin Gateway DTO and parses fragmented NDJSON', async () => {
  const expected = [{ schemaVersion: 1, kind: 'complete', summary: '完成世界大屏' }]
  const bytes = encoder.encode(ndjson(completedFrames(JSON.stringify(expected))))
  const calls = []
  const adapter = adapterFor(async (...input) => {
    calls.push(input)
    return responseFromChunks([bytes.subarray(0, 3), bytes.subarray(3, 31), bytes.subarray(31, 79), bytes.subarray(79)])
  })

  assert.deepEqual(await collect(adapter), expected)
  assert.equal(calls.length, 1)
  const [path, init] = calls[0]
  assert.equal(path, DEFAULT_GATEWAY_MODEL_PATH)
  assert.equal(init.method, 'POST')
  assert.equal(init.credentials, 'same-origin')
  assert.equal(init.cache, 'no-store')
  assert.equal(init.redirect, 'error')
  assert.equal(init.headers.accept, 'application/x-ndjson')
  assert.equal(init.headers['content-type'], 'application/json')
  assert.ok(init.signal instanceof AbortSignal)

  const body = JSON.parse(init.body)
  assert.equal(body.maxOutputTokens, GATEWAY_MODEL_TOKEN_BUDGET)
  assert.deepEqual(Object.keys(body).sort(), [
    'branchId',
    'maxOutputTokens',
    'messages',
    'model',
    'modelRequestId',
    'phase',
    'projectId',
    'providerId',
    'schemaVersion',
    'sessionId',
    'stepId',
    'taskId',
  ])
  assert.deepEqual(
    {
      schemaVersion: body.schemaVersion,
      projectId: body.projectId,
      branchId: body.branchId,
      sessionId: body.sessionId,
      taskId: body.taskId,
      stepId: body.stepId,
      modelRequestId: body.modelRequestId,
      providerId: body.providerId,
      model: body.model,
      phase: body.phase,
    },
    {
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      ...correlation,
      providerId: 'provider-1',
      model: 'model-1',
      phase: request.phase,
    },
  )
  assert.equal(body.messages[0].role, 'system')
  assert.equal(
    body.messages
      .slice(1)
      .map(message => message.content)
      .join(''),
    JSON.stringify(request),
  )
  assert.doesNotMatch(init.body, /apiKey|authorization|secret/iu)
})

test('fails closed for malformed, mis-correlated, or non-terminal Gateway streams', async t => {
  const output = JSON.stringify([{ schemaVersion: 1, kind: 'complete' }])
  const cases = [
    ['malformed JSON line', '{not-json}\n', 'invalid-gateway-stream'],
    [
      'started is not first',
      ndjson([frame('delta', { delta: output }), frame('completed', { finishReason: 'stop' })]),
      'invalid-gateway-stream',
    ],
    [
      'correlation mismatch',
      ndjson([{ ...frame('started'), stepId: 'step-attacker' }, frame('completed', { finishReason: 'stop' })]),
      'invalid-correlation',
    ],
    ['missing terminal', ndjson([frame('started'), frame('delta', { delta: output })]), 'invalid-gateway-stream'],
    [
      'multiple terminals',
      ndjson([
        frame('started'),
        frame('delta', { delta: output }),
        frame('completed', { finishReason: 'stop' }),
        frame('completed', { finishReason: 'stop' }),
      ]),
      'invalid-gateway-stream',
    ],
    ['unterminated line', ndjson(completedFrames(output)).slice(0, -1), 'invalid-gateway-stream'],
    ['invalid model JSON', ndjson(completedFrames('{not-json')), 'invalid-model-output'],
  ]

  for (const [name, body, code] of cases) {
    await t.test(name, async () => {
      const adapter = adapterFor(async () => responseFromChunks([body]))
      await assert.rejects(
        collect(adapter),
        error => error instanceof GatewayModelAdapterError && error.code === code && !error.message.includes(body),
      )
    })
  }
})

test('maps HTTP and remote error failures to fixed non-reflective errors', async t => {
  const secret = 'provider-secret-response-body'
  const cases = [
    [429, 'gateway-rate-limited'],
    [503, 'gateway-unavailable'],
  ]
  for (const [status, code] of cases) {
    await t.test(String(status), async () => {
      const adapter = adapterFor(async () => responseFromChunks([secret], { status, contentType: 'text/plain' }))
      await assert.rejects(
        collect(adapter),
        error =>
          error instanceof GatewayModelAdapterError &&
          error.code === code &&
          !error.message.includes(secret) &&
          !String(error.cause ?? '').includes(secret),
      )
    })
  }

  const adapter = adapterFor(async () =>
    responseFromChunks([
      ndjson([
        frame('started'),
        frame('error', {
          error: { code: 'PROVIDER_FAILED', message: secret, retryable: true },
        }),
      ]),
    ]),
  )
  await assert.rejects(
    collect(adapter),
    error => error.code === 'gateway-unavailable' && !error.message.includes(secret) && error.cause === undefined,
  )
})

test('enforces response byte, line, event, and accumulated output budgets', async t => {
  const output = JSON.stringify([{ schemaVersion: 1, kind: 'complete' }])
  const cases = [
    ['bytes', { maxResponseBytes: 8 }, completedFrames(output)],
    ['lines', { maxResponseLines: 2 }, completedFrames(output)],
    ['events', { maxEvents: 1 }, completedFrames(output)],
    ['output', { maxOutputBytes: 4 }, completedFrames(output)],
  ]
  for (const [name, budgets, frames] of cases) {
    await t.test(name, async () => {
      const adapter = adapterFor(async () => responseFromChunks([ndjson(frames)]), budgets)
      await assert.rejects(collect(adapter), error => error.code === 'response-budget-exceeded')
    })
  }
})

const pendingResponse = cancelCalls =>
  new Response(
    new ReadableStream({
      pull() {
        return new Promise(() => undefined)
      },
      cancel() {
        cancelCalls.push('cancel')
      },
    }),
    { headers: { 'content-type': 'application/x-ndjson' } },
  )

test('AbortSignal aborts the reader and surfaces AbortError without server text', async () => {
  const cancelCalls = []
  const controller = new AbortController()
  const adapter = adapterFor(async () => pendingResponse(cancelCalls))
  const operation = collect(adapter, controller.signal)
  setTimeout(() => controller.abort(new Error('private caller reason')), 0)

  await assert.rejects(operation, error => error.name === 'AbortError' && !error.message.includes('private'))
  assert.deepEqual(cancelCalls, ['cancel'])
})

test('deadline cancels a pending reader and returns a fixed deadline failure', async () => {
  const cancelCalls = []
  const adapter = adapterFor(async () => pendingResponse(cancelCalls), { deadlineMs: 5 })

  await assert.rejects(
    collect(adapter),
    error => error instanceof GatewayModelAdapterError && error.code === 'gateway-deadline',
  )
  assert.deepEqual(cancelCalls, ['cancel'])
})

test('removes each abort listener after many successful chunk reads', async () => {
  const output = JSON.stringify([{ schemaVersion: 1, kind: 'complete' }])
  const bytes = encoder.encode(ndjson(completedFrames(output)))
  const chunks = Array.from(bytes, byte => Uint8Array.of(byte))
  let activeListeners = 0
  let maximumListeners = 0
  const adapter = adapterFor(async (_path, init) => {
    const signal = init.signal
    const addEventListener = signal.addEventListener.bind(signal)
    const removeEventListener = signal.removeEventListener.bind(signal)
    signal.addEventListener = (type, listener, options) => {
      if (type === 'abort') {
        activeListeners += 1
        maximumListeners = Math.max(maximumListeners, activeListeners)
      }
      return addEventListener(type, listener, options)
    }
    signal.removeEventListener = (type, listener, options) => {
      if (type === 'abort') activeListeners -= 1
      return removeEventListener(type, listener, options)
    }
    return responseFromChunks(chunks)
  })

  assert.deepEqual(await collect(adapter), [{ schemaVersion: 1, kind: 'complete' }])
  assert.equal(activeListeners, 0)
  assert.equal(maximumListeners, 1)
})

test('configuration rejects cross-origin paths and secret-bearing option shapes fail type-independent validation', () => {
  for (const path of ['https://attacker.example/api', '//attacker.example/api', '/api?secret=value']) {
    assert.throws(
      () => adapterFor(async () => responseFromChunks([]), { path }),
      error => error instanceof GatewayModelAdapterError && error.code === 'invalid-config',
    )
  }
})
