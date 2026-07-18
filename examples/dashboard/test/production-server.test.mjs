import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDashboardServer } from '../server/index.mjs'

test('production server serves static assets and falls back to the SPA document', async t => {
  const distDir = await mkdtemp(join(tmpdir(), 'easy-editor-dashboard-'))
  await writeFile(join(distDir, 'index.html'), '<!doctype html><main>dashboard shell</main>')
  await writeFile(join(distDir, 'app.js'), 'console.log("asset")')

  const server = createDashboardServer({ distDir })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    await rm(distDir, { recursive: true, force: true })
  })

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`

  for (const method of ['GET', 'HEAD']) {
    const asset = await fetch(`${origin}/app.js`, { method })
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type'), /text\/javascript/)
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(asset.headers.get('content-security-policy'), null)
    assert.equal(await asset.text(), method === 'GET' ? 'console.log("asset")' : '')
  }

  for (const pathname of ['/', '/editor/project/page', '/index.html']) {
    for (const method of ['GET', 'HEAD']) {
      const document = await fetch(`${origin}${pathname}`, { method })
      assert.equal(document.status, 200)
      assert.match(document.headers.get('content-type'), /text\/html/)
      assert.equal(document.headers.get('cache-control'), 'no-store')
      assert.equal(document.headers.get('content-security-policy'), "frame-src 'none'")
      assert.equal(await document.text(), method === 'GET' ? '<!doctype html><main>dashboard shell</main>' : '')
    }
  }

  const missingAsset = await fetch(`${origin}/missing.js`)
  assert.equal(missingAsset.status, 404)

  const proxy = await fetch(`${origin}/api/data/credentialed-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      schemaVersion: 1,
      projectId: 'project-1',
      providerId: 'provider-1',
      credentialRef: 'credential-1',
      url: 'https://api.example.test/v1/metrics',
      method: 'GET',
    }),
  })
  assert.equal(proxy.status, 405)
  assert.equal(proxy.headers.get('allow'), 'GET, HEAD')
})

test('production server enables the stock cookie-session proxy only through environment configuration', async t => {
  const distDir = await mkdtemp(join(tmpdir(), 'easy-editor-dashboard-proxy-'))
  await writeFile(join(distDir, 'index.html'), '<!doctype html><main>dashboard proxy shell</main>')
  const secret = 'production-only-provider-secret'
  const sessionToken = 'production-external-session-token'
  const env = {
    EASY_EDITOR_DATA_PROXY_ENABLED: '1',
    EASY_EDITOR_DATA_PROXY_CONFIG_JSON: JSON.stringify({
      auth: {
        mode: 'cookie-session',
        cookieName: '__Host-easy-editor-session',
        sessions: [
          {
            token: sessionToken,
            tenantId: 'tenant-1',
            userId: 'user-1',
            projectIds: ['project-1'],
          },
        ],
      },
      credentials: [
        {
          tenantId: 'tenant-1',
          userId: 'user-1',
          projectId: 'project-1',
          providerId: 'provider-1',
          credentialRef: 'credential-1',
          secret,
          policy: {
            scheme: 'https:',
            origin: 'https://api.example.test',
            port: 443,
            pathPrefix: '/v1',
            methods: ['GET'],
            headerTemplate: { Authorization: 'Bearer {{secret}}' },
            redirect: { enabled: false, maxHops: 0 },
            limits: {
              maxRequestBytes: 1024,
              maxResponseBytes: 1024,
              maxRows: 10,
              timeoutMs: 1000,
            },
          },
        },
      ],
    }),
  }
  let transportCalls = 0
  const server = createDashboardServer({
    distDir,
    env,
    dataProxyOptions: {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: async options => {
        transportCalls += 1
        assert.equal(options.headers.authorization, `Bearer ${secret}`)
        assert.equal(options.headers.cookie, undefined)
        return {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: Buffer.from(JSON.stringify({ message: 'PRODUCTION_COOKIE_PROXY_OK' })),
        }
      },
    },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    await rm(distDir, { recursive: true, force: true })
  })

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  const body = {
    schemaVersion: 1,
    projectId: 'project-1',
    providerId: 'provider-1',
    credentialRef: 'credential-1',
    url: 'https://api.example.test/v1/metrics',
    method: 'GET',
  }
  const authorized = await fetch(`${origin}/api/data/credentialed-json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `__Host-easy-editor-session=${sessionToken}`,
      Origin: origin,
    },
    body: JSON.stringify(body),
  })
  assert.equal(authorized.status, 200)
  assert.equal(authorized.headers.get('set-cookie'), null)
  const serialized = JSON.stringify(await authorized.json())
  assert.match(serialized, /PRODUCTION_COOKIE_PROXY_OK/)
  assert.doesNotMatch(serialized, new RegExp(`${secret}|${sessionToken}`))
  assert.equal(transportCalls, 1)

  const missingSession = await fetch(`${origin}/api/data/credentialed-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  })
  assert.equal(missingSession.status, 401)
  assert.equal(transportCalls, 1)
})
