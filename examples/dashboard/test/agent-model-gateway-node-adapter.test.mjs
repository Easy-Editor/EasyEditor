import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  MODEL_GATEWAY_MAX_BODY_BYTES,
  MODEL_GATEWAY_PATH,
  createNodeModelGatewayMiddleware,
} from '../server/gateway/index.mjs'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const secret = 'node-adapter-secret-never-reflect'
const prompt = 'private-node-adapter-prompt'

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const close = server => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
const originFor = server => {
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}

const withServer = async (t, middleware) => {
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('fallback')
    })
  })
  await listen(server)
  t.after(() => close(server))
  return originFor(server)
}

const ndjsonResult = (chunks = ['{"kind":"one"}\n', '{"kind":"two"}\n']) => ({
  status: 207,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/x-ndjson; charset=utf-8',
    'x-gateway-test': 'streamed',
  },
  body: {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield encoder.encode(chunk)
    },
  },
})

test('node adapter falls through without touching non-gateway routes', async () => {
  let nextCalls = 0
  let handlerCalls = 0
  const middleware = createNodeModelGatewayMiddleware({
    handler: {
      async handle() {
        handlerCalls += 1
        return ndjsonResult()
      },
    },
  })

  const handled = await middleware({ url: '/other?path=/api/agent/model/stream' }, {}, () => {
    nextCalls += 1
  })
  assert.equal(handled, false)
  assert.equal(nextCalls, 1)
  assert.equal(handlerCalls, 0)
})

test('node adapter streams Uint8Array handler output with status and headers', async t => {
  const handlerCalls = []
  const middleware = createNodeModelGatewayMiddleware({
    handler: {
      async handle(input) {
        handlerCalls.push(input)
        return ndjsonResult()
      },
    },
  })
  const origin = await withServer(t, middleware)

  const response = await fetch(`${origin}${MODEL_GATEWAY_PATH}?trace=ignored`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: '{"safe":true}',
  })

  assert.equal(response.status, 207)
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8')
  assert.equal(response.headers.get('x-gateway-test'), 'streamed')
  assert.equal(await response.text(), '{"kind":"one"}\n{"kind":"two"}\n')
  assert.equal(handlerCalls.length, 1)
  assert.equal(handlerCalls[0].path, MODEL_GATEWAY_PATH)
  assert.ok(handlerCalls[0].body instanceof Uint8Array)
  assert.equal(decoder.decode(handlerCalls[0].body), '{"safe":true}')
  assert.ok(handlerCalls[0].signal instanceof AbortSignal)
})

test('node adapter rejects oversized input with fixed 413 before calling the handler', async t => {
  let handlerCalls = 0
  const middleware = createNodeModelGatewayMiddleware({
    handler: {
      async handle() {
        handlerCalls += 1
        return ndjsonResult()
      },
    },
  })
  const origin = await withServer(t, middleware)
  const body = new Uint8Array(MODEL_GATEWAY_MAX_BODY_BYTES + 1)
  body.set(encoder.encode(`${secret} ${prompt}`))

  const response = await fetch(`${origin}${MODEL_GATEWAY_PATH}`, { method: 'POST', headers: { Origin: origin }, body })
  const serialized = await response.text()

  assert.equal(response.status, 413)
  assert.equal(response.headers.get('connection'), 'close')
  assert.equal(JSON.parse(serialized).error.code, 'INVALID_REQUEST')
  assert.doesNotMatch(serialized, new RegExp(`${secret}|${prompt}`))
  assert.equal(handlerCalls, 0)
})

class FakeRequest extends EventEmitter {
  constructor() {
    super()
    this.url = MODEL_GATEWAY_PATH
    this.method = 'POST'
    this.headers = {
      'content-type': 'application/json',
      host: 'dashboard.test',
      origin: 'http://dashboard.test',
    }
    this.socket = { encrypted: false }
    this.aborted = false
    this.resumeCalls = 0
  }

  resume() {
    this.resumeCalls += 1
  }
}

test('node adapter requires one configured same-origin value before reading request bytes', async t => {
  let handlerCalls = 0
  const middleware = createNodeModelGatewayMiddleware({
    publicOrigins: ['https://dashboard.example.test'],
    handler: {
      async handle() {
        handlerCalls += 1
        return ndjsonResult()
      },
    },
  })
  const origin = await withServer(t, middleware)
  const response = await fetch(`${origin}${MODEL_GATEWAY_PATH}`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example.test' },
    body: `${secret} ${prompt}`,
  })
  const serialized = await response.text()

  assert.equal(response.status, 403)
  assert.equal(JSON.parse(serialized).error.code, 'INVALID_REQUEST')
  assert.doesNotMatch(serialized, new RegExp(`${secret}|${prompt}`))
  assert.equal(handlerCalls, 0)
})

class FakeResponse extends EventEmitter {
  constructor() {
    super()
    this.destroyed = false
    this.writableEnded = false
    this.headersSent = false
    this.shouldKeepAlive = true
    this.status = undefined
    this.headers = undefined
    this.chunks = []
    this.endCalls = 0
  }

  writeHead(status, headers) {
    this.status = status
    this.headers = headers
    this.headersSent = true
    return this
  }

  write(chunk) {
    this.chunks.push(chunk)
    return true
  }

  end(chunk) {
    if (chunk) this.chunks.push(chunk)
    this.endCalls += 1
    this.writableEnded = true
    return this
  }

  serialized() {
    return this.chunks.map(chunk => decoder.decode(chunk)).join('')
  }
}

test('node adapter times out a stalled inbound request and detaches every listener', async () => {
  const request = new FakeRequest()
  const response = new FakeResponse()
  let handlerCalls = 0
  const middleware = createNodeModelGatewayMiddleware({
    inboundTimeoutMs: 10,
    handler: {
      async handle() {
        handlerCalls += 1
        return ndjsonResult()
      },
    },
  })

  assert.equal(await middleware(request, response), true)
  assert.equal(response.status, 408)
  assert.equal(JSON.parse(response.serialized()).error.code, 'REQUEST_ABORTED')
  assert.equal(handlerCalls, 0)
  assert.equal(response.endCalls, 1)
  assert.equal(request.resumeCalls, 1)
  for (const event of ['data', 'end', 'error', 'aborted']) assert.equal(request.listenerCount(event), 0)
  assert.equal(response.listenerCount('close'), 0)
})

const waitForTurn = () => new Promise(resolve => setImmediate(resolve))

test('node adapter propagates request abort and response close into the handler signal', async () => {
  for (const disconnect of ['request-aborted', 'response-close']) {
    const request = new FakeRequest()
    const response = new FakeResponse()
    let handlerSignal
    let handleStarted
    const started = new Promise(resolve => {
      handleStarted = resolve
    })
    const middleware = createNodeModelGatewayMiddleware({
      handler: {
        async handle({ signal }) {
          handlerSignal = signal
          handleStarted()
          return {
            ...ndjsonResult([]),
            body: {
              async *[Symbol.asyncIterator]() {
                await new Promise((_, reject) => {
                  const rejectAbort = () => reject(signal.reason)
                  signal.addEventListener('abort', rejectAbort, { once: true })
                  if (signal.aborted) rejectAbort()
                })
                yield encoder.encode('unreachable')
              },
            },
          }
        },
      },
    })

    const pending = middleware(request, response)
    request.emit('end')
    await started
    await waitForTurn()
    if (disconnect === 'request-aborted') {
      request.aborted = true
      request.emit('aborted')
    } else {
      response.destroyed = true
      response.emit('close')
    }
    assert.equal(await pending, true)
    assert.equal(handlerSignal.aborted, true)
    assert.equal(response.endCalls, disconnect === 'request-aborted' ? 1 : 0)
    assert.equal(request.listenerCount('aborted'), 0)
    assert.equal(response.listenerCount('close'), 0)
  }
})

test('node adapter maps invalid handler results and thrown details to fixed safe responses', async () => {
  for (const [handle, expectedStatus, expectedCode] of [
    [async () => ({}), 502, 'GATEWAY_FAILED'],
    [
      async () => {
        throw new Error(`${secret} ${prompt}`)
      },
      400,
      'INVALID_REQUEST',
    ],
  ]) {
    const request = new FakeRequest()
    const response = new FakeResponse()
    const middleware = createNodeModelGatewayMiddleware({ handler: { handle } })
    const pending = middleware(request, response)
    request.emit('end')
    assert.equal(await pending, true)
    const serialized = response.serialized()
    assert.equal(response.status, expectedStatus)
    assert.equal(JSON.parse(serialized).error.code, expectedCode)
    assert.doesNotMatch(serialized, new RegExp(`${secret}|${prompt}`))
    assert.equal(response.endCalls, 1)
    assert.equal(request.listenerCount('aborted'), 0)
    assert.equal(response.listenerCount('close'), 0)
  }
})
