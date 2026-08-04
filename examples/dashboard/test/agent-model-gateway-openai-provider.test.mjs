import assert from 'node:assert/strict'
import test from 'node:test'

import { createOpenAICompatibleProviderTransport } from '../server/gateway/openai-provider.mjs'

const encoder = new TextEncoder()
const secret = 'server-only-openai-secret'
const prompt = 'private-dashboard-business-prompt'
const request = (overrides = {}) => ({
  model: 'gateway-model',
  messages: [{ role: 'user', content: prompt }],
  maxOutputTokens: 321,
  ...overrides,
})

const bytesInSlices = (value, widths = [1, 2, 5, 3, 8]) => {
  const bytes = encoder.encode(value)
  return {
    async *[Symbol.asyncIterator]() {
      let offset = 0
      let widthIndex = 0
      while (offset < bytes.byteLength) {
        const width = widths[widthIndex % widths.length]
        yield bytes.slice(offset, offset + width)
        offset += width
        widthIndex += 1
      }
    },
  }
}

const response = (body, overrides = {}) => ({ ok: true, status: 200, body, ...overrides })

const collect = async iterable => {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}

const stream = async (transport, overrides = {}) =>
  transport.stream({ request: request(), signal: new AbortController().signal, ...overrides })

test('OpenAI provider posts the server-owned request and parses fragmented SSE into neutral events', async () => {
  const calls = []
  const sse = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello 世界' }, finish_reason: null }] })}\r\n\r\n`,
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
  const transport = createOpenAICompatibleProviderTransport({
    baseUrl: 'https://gateway.example.test/v1/',
    apiKey: secret,
    defaultModel: 'fallback-model',
    fetchImpl: async (...args) => {
      calls.push(args)
      return response(bytesInSlices(sse))
    },
  })

  const events = await collect(await stream(transport))

  assert.deepEqual(events, [
    { kind: 'delta', delta: 'Hello 世界' },
    {
      kind: 'completed',
      finishReason: 'stop',
      usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
    },
  ])
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'https://gateway.example.test/v1/chat/completions')
  assert.equal(calls[0][1].method, 'POST')
  assert.deepEqual(calls[0][1].headers, {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  })
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    model: 'gateway-model',
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    max_tokens: 321,
  })
  assert.ok(calls[0][1].signal instanceof AbortSignal)
  assert.deepEqual(Object.keys(transport), ['stream'])
  assert.equal(Object.isFrozen(transport), true)
  assert.doesNotMatch(JSON.stringify(transport), new RegExp(secret))
})

test('OpenAI provider ignores relay metadata frames with empty choices before completion', async () => {
  const sse = [
    `data: ${JSON.stringify({
      id: 'chatcmpl-metadata',
      object: 'chat.completion.chunk',
      choices: [],
      latency_checkpoint: { name: 'upstream-ready' },
    })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: '[]' }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 },
    })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
  const transport = createOpenAICompatibleProviderTransport({
    baseUrl: 'https://gateway.example.test/v1',
    apiKey: secret,
    fetchImpl: async () => response(bytesInSlices(sse)),
  })

  assert.deepEqual(await collect(await stream(transport)), [
    { kind: 'delta', delta: '[]' },
    { kind: 'completed', finishReason: 'stop' },
  ])
})

test('OpenAI provider coalesces token-sized relay deltas before the Gateway event budget', async () => {
  const fragment = '低'
  const fragments = Array.from(
    { length: 300 },
    () =>
      `data: ${JSON.stringify({
        choices: [{ delta: { content: fragment }, finish_reason: null }],
      })}\n\n`,
  )
  const sse = [
    ...fragments,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
  const transport = createOpenAICompatibleProviderTransport({
    baseUrl: 'https://gateway.example.test/v1',
    apiKey: secret,
    fetchImpl: async () => response(bytesInSlices(sse)),
  })

  assert.deepEqual(await collect(await stream(transport)), [
    { kind: 'delta', delta: fragment.repeat(fragments.length) },
    { kind: 'completed', finishReason: 'stop' },
  ])
})

test('OpenAI provider falls back to the configured model without exposing configuration', async () => {
  let providerBody
  const transport = createOpenAICompatibleProviderTransport({
    baseUrl: 'https://gateway.example.test/v1',
    apiKey: secret,
    defaultModel: 'fallback-model',
    fetchImpl: async (_url, options) => {
      providerBody = JSON.parse(options.body)
      return response(
        bytesInSlices(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        ),
      )
    },
  })

  await collect(
    await transport.stream({
      request: request({ model: '', maxOutputTokens: undefined }),
      signal: new AbortController().signal,
    }),
  )
  assert.deepEqual(providerBody, {
    model: 'fallback-model',
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  })
})

test('OpenAI provider maps HTTP 429, 5xx, and other non-success statuses without reading bodies', async () => {
  for (const [status, expectedStatus, expectedCode] of [
    [429, 429, 'PROVIDER_RATE_LIMITED'],
    [503, 503, 'PROVIDER_UNAVAILABLE'],
    [401, 502, 'PROVIDER_REJECTED'],
  ]) {
    let bodyReads = 0
    const transport = createOpenAICompatibleProviderTransport({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: secret,
      fetchImpl: async () => ({
        ok: false,
        status,
        body: null,
        async text() {
          bodyReads += 1
          return `${secret} ${prompt}`
        },
      }),
    })

    await assert.rejects(stream(transport), error => {
      assert.equal(error.status, expectedStatus)
      assert.equal(error.code, expectedCode)
      assert.doesNotMatch(`${error.name} ${error.message} ${JSON.stringify(error)}`, new RegExp(`${secret}|${prompt}`))
      return true
    })
    assert.equal(bodyReads, 0)
  }
})

test('OpenAI provider rejects malformed SSE, early DONE, and non-byte chunks safely', async () => {
  const malformedBodies = [
    bytesInSlices(`event: message\ndata: ${secret} ${prompt}\n\n`),
    bytesInSlices('data: [DONE]\n\n'),
    {
      async *[Symbol.asyncIterator]() {
        yield `data: ${secret}`
      },
    },
  ]
  for (const body of malformedBodies) {
    const transport = createOpenAICompatibleProviderTransport({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: secret,
      fetchImpl: async () => response(body),
    })
    const events = await stream(transport)
    await assert.rejects(collect(events), error => {
      assert.equal(error.code, 'PROVIDER_RESPONSE_INVALID')
      assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, new RegExp(`${secret}|${prompt}`))
      return true
    })
  }
})

test('OpenAI provider enforces the 64KiB line and 1MiB stream budgets', async () => {
  const oversizedLine = `data: ${'x'.repeat(64 * 1024)}\n\n`
  const boundedLine = `data: ${JSON.stringify({
    choices: [{ delta: { content: 'x'.repeat(60 * 1024) }, finish_reason: null }],
  })}\n\n`
  for (const body of [
    bytesInSlices(oversizedLine, [oversizedLine.length]),
    {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 18; index += 1) yield encoder.encode(boundedLine)
      },
    },
  ]) {
    const transport = createOpenAICompatibleProviderTransport({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: secret,
      fetchImpl: async () => response(body),
    })
    await assert.rejects(collect(await stream(transport)), error => error.code === 'PROVIDER_RESPONSE_INVALID')
  }
})

test('OpenAI provider requires DONE after a completed or partial stream', async () => {
  for (const sse of [
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
  ]) {
    const transport = createOpenAICompatibleProviderTransport({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: secret,
      fetchImpl: async () => response(bytesInSlices(sse)),
    })
    await assert.rejects(collect(await stream(transport)), error => error.code === 'PROVIDER_DISCONNECTED')
  }
})

const stalledBody = readSignal => ({
  [Symbol.asyncIterator]() {
    return {
      next() {
        const signal = readSignal()
        return new Promise((_, reject) => {
          const rejectAbort = () => reject(signal.reason)
          signal.addEventListener('abort', rejectAbort, { once: true })
          if (signal.aborted) rejectAbort()
        })
      },
      async return() {
        return { done: true }
      },
    }
  },
})

test('OpenAI provider forwards caller cancellation to fetch and maps it safely', async () => {
  const controller = new AbortController()
  let fetchSignal
  const transport = createOpenAICompatibleProviderTransport({
    baseUrl: 'https://gateway.example.test/v1',
    apiKey: secret,
    fetchImpl: async (_url, options) => {
      fetchSignal = options.signal
      return response(stalledBody(() => fetchSignal))
    },
  })
  const pending = collect(await stream(transport, { signal: controller.signal }))
  controller.abort(new Error(`${secret} ${prompt}`))
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'REQUEST_ABORTED')
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, new RegExp(`${secret}|${prompt}`))
    return true
  })
  assert.equal(fetchSignal.aborted, true)
})

test('OpenAI provider applies its injected deadline to the fetch signal and stream', async () => {
  let fetchSignal
  const transport = createOpenAICompatibleProviderTransport({
    baseUrl: 'https://gateway.example.test/v1',
    apiKey: secret,
    timeoutMs: 10,
    fetchImpl: async (_url, options) => {
      fetchSignal = options.signal
      return response(stalledBody(() => fetchSignal))
    },
  })
  await assert.rejects(collect(await stream(transport)), error => {
    assert.equal(error.code, 'PROVIDER_TIMEOUT')
    assert.equal(error.status, 504)
    return true
  })
  assert.equal(fetchSignal.aborted, true)
})

test('OpenAI provider never propagates network error messages or provider response data', async () => {
  const transport = createOpenAICompatibleProviderTransport({
    baseUrl: 'https://gateway.example.test/v1',
    apiKey: secret,
    fetchImpl: async () => {
      throw new Error(`${secret} ${prompt}`)
    },
  })
  await assert.rejects(stream(transport), error => {
    assert.equal(error.code, 'PROVIDER_UNAVAILABLE')
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, new RegExp(`${secret}|${prompt}`))
    return true
  })
})
