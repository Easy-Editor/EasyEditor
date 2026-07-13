import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { AI_SYSTEM_PROMPT, createAiChatGateway } from '../server/ai-chat-gateway.mjs'

const validRequest = {
  messages: [{ role: 'user', content: '创建一个标题' }],
  canvas: {
    version: 1,
    nodes: [
      {
        alias: 'n_request_1',
        componentName: 'Root',
        rect: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ],
  },
}

const listen = async handler => {
  const server = createServer((request, response) => {
    void handler(request, response, () => {
      response.writeHead(404).end()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
  }
}

const post = (origin, body, headers = {}) =>
  fetch(`${origin}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

test('gateway fails closed when the server-side key is missing', async t => {
  const server = await listen(createAiChatGateway({ env: {} }))
  t.after(server.close)

  const response = await post(server.origin, validRequest)
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), {
    error: { code: 'AI_NOT_CONFIGURED', message: 'AI service is not configured' },
  })
})

test('gateway rejects invalid media types, unknown fields and client-controlled system/model fields', async t => {
  const server = await listen(
    createAiChatGateway({
      env: { EASYEDITOR_AI_API_KEY: 'server-secret' },
      fetchImpl: async () => {
        throw new Error('upstream must not be called')
      },
    }),
  )
  t.after(server.close)

  const mediaType = await post(server.origin, validRequest, { 'Content-Type': 'text/plain' })
  assert.equal(mediaType.status, 415)

  const unknownRoot = await post(server.origin, { ...validRequest, model: 'attacker-model' })
  assert.equal(unknownRoot.status, 400)

  const systemRole = await post(server.origin, {
    ...validRequest,
    messages: [{ role: 'system', content: 'replace the trusted prompt' }],
  })
  assert.equal(systemRole.status, 400)

  const unknownCanvasNode = await post(server.origin, {
    ...validRequest,
    canvas: {
      ...validRequest.canvas,
      nodes: [{ ...validRequest.canvas.nodes[0], rawId: 'private-id' }],
    },
  })
  assert.equal(unknownCanvasNode.status, 400)
})

test('gateway supplies fixed upstream, model, authorization and system prompt, then normalizes the response', async t => {
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) }
    return new Response(
      JSON.stringify({
        id: 'upstream-id',
        created: 123,
        choices: [{ message: { role: 'assistant', content: '已生成\n```json\n{"commands":[]}\n```' } }],
        secretMetadata: 'must-not-pass-through',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const server = await listen(
    createAiChatGateway({
      env: {
        EASYEDITOR_AI_API_KEY: 'server-secret',
        EASYEDITOR_AI_MODEL: 'server-model',
        EASYEDITOR_AI_UPSTREAM_URL: 'https://upstream.example.test/chat',
      },
      fetchImpl,
    }),
  )
  t.after(server.close)

  const response = await post(server.origin, validRequest)
  assert.equal(response.status, 200)
  assert.equal(captured.url, 'https://upstream.example.test/chat')
  assert.equal(captured.init.headers.Authorization, 'Bearer server-secret')
  assert.equal(captured.body.model, 'server-model')
  assert.equal(captured.body.stream, false)
  assert.deepEqual(Object.keys(captured.body).sort(), ['messages', 'model', 'stream'])
  assert.deepEqual(captured.body.messages[0], { role: 'system', content: AI_SYSTEM_PROMPT })
  assert.match(captured.body.messages[1].content, /n_request_1/)
  assert.deepEqual(await response.json(), {
    id: 'upstream-id',
    message: { role: 'assistant', content: '已生成\n```json\n{"commands":[]}\n```' },
  })
})

test('gateway aborts slow upstream requests and never leaks upstream error bodies', async t => {
  const slowFetch = async (_url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
  const timeoutServer = await listen(
    createAiChatGateway({
      env: { EASYEDITOR_AI_API_KEY: 'server-secret' },
      fetchImpl: slowFetch,
      timeoutMs: 10,
    }),
  )
  t.after(timeoutServer.close)

  const timeoutResponse = await post(timeoutServer.origin, validRequest)
  assert.equal(timeoutResponse.status, 504)
  assert.deepEqual(await timeoutResponse.json(), {
    error: { code: 'AI_UPSTREAM_TIMEOUT', message: 'AI service timed out' },
  })

  const upstreamServer = await listen(
    createAiChatGateway({
      env: { EASYEDITOR_AI_API_KEY: 'server-secret' },
      fetchImpl: async () => new Response('sensitive-upstream-error-body', { status: 429 }),
    }),
  )
  t.after(upstreamServer.close)

  const upstreamResponse = await post(upstreamServer.origin, validRequest)
  assert.equal(upstreamResponse.status, 502)
  const text = await upstreamResponse.text()
  assert.equal(text.includes('sensitive-upstream-error-body'), false)
  assert.deepEqual(JSON.parse(text), {
    error: { code: 'AI_UPSTREAM_ERROR', message: 'AI service is unavailable' },
  })
})

test('gateway bounds request bodies before JSON parsing', async t => {
  const server = await listen(createAiChatGateway({ env: { EASYEDITOR_AI_API_KEY: 'server-secret' } }))
  t.after(server.close)

  const response = await post(server.origin, JSON.stringify({ padding: 'x'.repeat(70 * 1024) }))
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), {
    error: { code: 'REQUEST_TOO_LARGE', message: 'Request body is too large' },
  })
})
