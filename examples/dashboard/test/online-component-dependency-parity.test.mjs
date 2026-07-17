import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDashboardServer } from '../server/index.mjs'
import {
  ONLINE_COMPONENT_DEPENDENCY_ROUTE,
  createEnvironmentOnlineComponentDependencyMiddleware,
} from '../server/online-components/index.mjs'

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const close = server => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
const originFor = server => {
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}
const requestDependency = origin =>
  fetch(`${origin}${ONLINE_COMPONENT_DEPENDENCY_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'private-session=do-not-forward' },
    body: JSON.stringify({ package: 'open-customer-package', range: '^1.0.0' }),
  })

test('environment middleware reserves the dependency route and returns explicit 503 while default-off', async t => {
  let nextCalls = 0
  const middleware = createEnvironmentOnlineComponentDependencyMiddleware({ env: {} })
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      nextCalls += 1
      response.writeHead(404).end()
    })
  })
  await listen(server)
  t.after(() => close(server))

  const response = await requestDependency(originFor(server))
  assert.equal(response.status, 503)
  assert.equal(nextCalls, 0)
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    error: {
      code: 'dependency-unavailable',
      message: 'Online component dependency resolver is unavailable',
      retryable: true,
    },
  })

  const oversized = await fetch(`${originFor(server)}${ONLINE_COMPONENT_DEPENDENCY_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: originFor(server) },
    body: 'x'.repeat(16 * 1024 + 1),
  })
  assert.equal(oversized.status, 413)
  assert.deepEqual(await oversized.json(), {
    schemaVersion: 1,
    error: { code: 'invalid-request', message: 'Request is invalid', retryable: false },
  })
})

test('invalid enabled configuration remains fail-closed in both Vite and production adapters', async t => {
  const root = await mkdtemp(join(tmpdir(), 'easy-editor-dependency-invalid-env-'))
  const distDir = join(root, 'dist')
  await mkdir(distDir, { recursive: true })
  await writeFile(join(distDir, 'index.html'), '<main>dashboard</main>')
  t.after(() => rm(root, { recursive: true, force: true }))

  const env = {
    EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_ENABLED: '1',
    EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_CONFIG_JSON: '{',
  }
  let nextCalls = 0
  const middleware = createEnvironmentOnlineComponentDependencyMiddleware({ env })
  const viteContractServer = createServer((request, response) => {
    void middleware(request, response, () => {
      nextCalls += 1
      response.writeHead(404).end()
    })
  })
  const productionServer = createDashboardServer({ distDir, env })
  await Promise.all([listen(viteContractServer), listen(productionServer)])
  t.after(async () => {
    await Promise.all([close(viteContractServer), close(productionServer)])
  })

  for (const server of [viteContractServer, productionServer]) {
    const response = await requestDependency(originFor(server))
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'dependency-unavailable')
  }
  assert.equal(nextCalls, 0)
})

test('Vite middleware contract and production server use the same resolver, validation, hash, and cache path', async t => {
  const root = await mkdtemp(join(tmpdir(), 'easy-editor-dependency-parity-'))
  const distDir = join(root, 'dist')
  const cacheDir = join(root, 'cache')
  await mkdir(distDir, { recursive: true })
  await writeFile(join(distDir, 'index.html'), '<main>dashboard</main>')
  t.after(() => rm(root, { recursive: true, force: true }))

  const env = {
    EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_ENABLED: '1',
    EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_CONFIG_JSON: JSON.stringify({
      registryOrigins: ['https://registry.example.test'],
      cdnOrigins: ['https://cdn.example.test'],
      cacheDir,
      limits: { maxMetadataBytes: 4096, maxBundleBytes: 8192, maxRedirects: 1, timeoutMs: 1000 },
    }),
  }
  const source = 'export default function OnlineComponent() { return null }'
  const calls = []
  const transport = async request => {
    calls.push(request)
    assert.equal(request.headers.authorization, undefined)
    assert.equal(request.headers.cookie, undefined)
    const response =
      request.kind === 'registry'
        ? {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: Buffer.from(
              JSON.stringify({
                exactVersion: '1.4.2',
                bundleUrl: 'https://cdn.example.test/open-customer-package@1.4.2/index.mjs',
                format: 'bundled-esm',
                installScripts: false,
              }),
            ),
          }
        : {
            status: 200,
            headers: { 'content-type': 'text/javascript' },
            body: Buffer.from(source),
          }
    return { url: request.url.href, remoteAddress: '93.184.216.34', ...response }
  }
  const options = {
    env,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    transport,
  }
  const viteContractMiddleware = createEnvironmentOnlineComponentDependencyMiddleware(options)
  const viteContractServer = createServer((request, response) => {
    void viteContractMiddleware(request, response, () => response.writeHead(404).end())
  })
  const productionServer = createDashboardServer({
    distDir,
    env,
    onlineComponentDependencyOptions: { lookup: options.lookup, transport },
  })
  await Promise.all([listen(viteContractServer), listen(productionServer)])
  t.after(async () => {
    await Promise.all([close(viteContractServer), close(productionServer)])
  })

  const responses = await Promise.all(
    [viteContractServer, productionServer].map(async server => {
      const response = await requestDependency(originFor(server))
      return { status: response.status, body: await response.json() }
    }),
  )
  assert.deepEqual(responses[0], responses[1])
  assert.equal(responses[0].status, 200)
  assert.equal(responses[0].body.dependency.exactVersion, '1.4.2')
  assert.equal(responses[0].body.dependency.module.bytes, Buffer.from(source).toString('base64'))
  assert.equal(calls.length, 4)

  const [viteConfig, productionSource] = await Promise.all([
    readFile(new URL('../vite.config.mts', import.meta.url), 'utf8'),
    readFile(new URL('../server/index.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(viteConfig, /createEnvironmentOnlineComponentDependencyMiddleware/)
  assert.match(viteConfig, /easy-editor-online-component-dependency/)
  assert.match(viteConfig, /onlineComponentDependencyOptions\.lookup/)
  assert.match(viteConfig, /onlineComponentDependencyOptions\.transport/)
  assert.match(productionSource, /createEnvironmentOnlineComponentDependencyMiddleware/)
  assert.match(productionSource, /onlineComponentDependencyOptions\.lookup/)
  assert.match(productionSource, /onlineComponentDependencyOptions\.transport/)
})
