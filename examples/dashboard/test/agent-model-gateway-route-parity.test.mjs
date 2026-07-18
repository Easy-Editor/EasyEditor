import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as createHttpRequest, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  MODEL_GATEWAY_PATH,
  MODEL_GATEWAY_VITE_PLUGIN_NAME,
  createEnvironmentModelGatewayMiddleware,
  createModelGatewayVitePlugin,
} from '../server/gateway/index.mjs'
import { createDashboardServer } from '../server/index.mjs'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const secret = 'route-parity-secret-never-reflect'
const prompt = 'private-route-parity-prompt'
const enabledEnv = { EASY_EDITOR_AGENT_GATEWAY_ENABLED: '1' }

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const close = server => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
const originFor = server => {
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}

const registerViteGatewayMiddleware = ({ env, handler }) => {
  const gatewayMiddleware = createEnvironmentModelGatewayMiddleware({ env, handler })
  const plugin = createModelGatewayVitePlugin(gatewayMiddleware)
  assert.equal(plugin.name, MODEL_GATEWAY_VITE_PLUGIN_NAME)
  assert.equal(typeof plugin.configureServer, 'function')
  let registeredMiddleware
  plugin.configureServer({
    middlewares: {
      use(value) {
        registeredMiddleware = value
      },
    },
  })
  assert.equal(typeof registeredMiddleware, 'function')
  return registeredMiddleware
}

const createViteServer = ({ env, handler }) => {
  const middleware = registerViteGatewayMiddleware({ env, handler })
  return createServer((request, response) => {
    middleware(request, response, () => {
      response.writeHead(418, { 'Content-Type': 'text/plain' })
      response.end('vite-fallback')
    })
  })
}

const createVectorHandler = ({ onAbort } = {}) => ({
  path: MODEL_GATEWAY_PATH,
  async handle({ body, signal }) {
    const value = JSON.parse(decoder.decode(body))
    if (value.mode === 'error') {
      return {
        status: 403,
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'x-vector': 'error' },
        body: {
          async *[Symbol.asyncIterator]() {
            yield encoder.encode(
              `${JSON.stringify({
                schemaVersion: 1,
                kind: 'error',
                error: { code: 'UNAUTHORIZED', message: 'Gateway request is not authorized', retryable: false },
              })}\n`,
            )
          },
        },
      }
    }
    if (value.mode === 'abort') {
      return {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'x-vector': 'abort' },
        body: {
          async *[Symbol.asyncIterator]() {
            yield encoder.encode('{"schemaVersion":1,"kind":"started"}\n')
            await new Promise((_, reject) => {
              const abort = () => {
                onAbort?.(signal)
                reject(signal.reason)
              }
              signal.addEventListener('abort', abort, { once: true })
              if (signal.aborted) abort()
            })
            yield encoder.encode('unreachable')
          },
        },
      }
    }
    return {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'x-vector': 'normal' },
      body: {
        async *[Symbol.asyncIterator]() {
          yield encoder.encode('{"schemaVersion":1,"kind":"started"}\n')
          yield encoder.encode('{"schemaVersion":1,"kind":"completed","finishReason":"stop"}\n')
        },
      },
    }
  },
})

const requestVector = async (origin, value) => {
  const response = await fetch(`${origin}${MODEL_GATEWAY_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(value),
  })
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    vector: response.headers.get('x-vector'),
    body: await response.text(),
  }
}

const createProductionFixture = async (t, options) => {
  const distDir = await mkdtemp(join(tmpdir(), 'easy-editor-gateway-parity-'))
  await writeFile(join(distDir, 'index.html'), '<!doctype html><main>gateway parity</main>')
  const server = createDashboardServer({ distDir, ...options })
  await listen(server)
  t.after(async () => {
    await close(server)
    await rm(distDir, { recursive: true, force: true })
  })
  return server
}

test('Vite and production gateway routes produce identical success and safe error streams', async t => {
  const handler = createVectorHandler()
  const viteServer = createViteServer({ env: enabledEnv, handler })
  await listen(viteServer)
  t.after(() => close(viteServer))
  const productionServer = await createProductionFixture(t, {
    env: enabledEnv,
    agentModelGatewayHandler: handler,
  })

  for (const vector of [{ mode: 'normal' }, { mode: 'error', prompt, secret }]) {
    const vite = await requestVector(originFor(viteServer), vector)
    const production = await requestVector(originFor(productionServer), vector)
    assert.deepEqual(production, vite)
    assert.doesNotMatch(vite.body, new RegExp(`${secret}|${prompt}`))
  }
})

test('default-off Vite and production paths fall through without invoking an injected handler', async t => {
  let calls = 0
  const handler = {
    async handle() {
      calls += 1
      return createVectorHandler().handle({ body: encoder.encode('{"mode":"normal"}') })
    },
  }
  const viteServer = createViteServer({ env: {}, handler })
  await listen(viteServer)
  t.after(() => close(viteServer))
  const productionServer = await createProductionFixture(t, { env: {}, agentModelGatewayHandler: handler })

  const vite = await requestVector(originFor(viteServer), { mode: 'normal' })
  const production = await requestVector(originFor(productionServer), { mode: 'normal' })
  assert.equal(vite.status, 418)
  assert.equal(vite.body, 'vite-fallback')
  assert.equal(production.status, 405)
  assert.equal(production.contentType, null)
  assert.equal(calls, 0)
})

const disconnectAfterFirstChunk = origin =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify({ mode: 'abort' })
    const request = createHttpRequest(
      `${origin}${MODEL_GATEWAY_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Origin: origin,
        },
      },
      response => {
        response.once('data', () => {
          response.destroy()
          resolve()
        })
      },
    )
    request.once('error', error => {
      if (error.code === 'ECONNRESET') resolve()
      else reject(error)
    })
    request.end(body)
  })

test('Vite and production client disconnects abort the same injected handler signal', async t => {
  const aborted = []
  const makeHandler = surface =>
    createVectorHandler({
      onAbort(signal) {
        aborted.push({ surface, aborted: signal.aborted })
      },
    })
  const viteServer = createViteServer({ env: enabledEnv, handler: makeHandler('vite') })
  await listen(viteServer)
  t.after(() => close(viteServer))
  const productionServer = await createProductionFixture(t, {
    env: enabledEnv,
    agentModelGatewayHandler: makeHandler('production'),
  })

  await disconnectAfterFirstChunk(originFor(viteServer))
  await disconnectAfterFirstChunk(originFor(productionServer))
  const timeoutAt = Date.now() + 1_000
  while (aborted.length < 2 && Date.now() < timeoutAt) await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(
    aborted.sort((left, right) => left.surface.localeCompare(right.surface)),
    [
      { surface: 'production', aborted: true },
      { surface: 'vite', aborted: true },
    ],
  )
})
