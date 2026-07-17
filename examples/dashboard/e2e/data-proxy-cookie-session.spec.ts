import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Browser, expect, test } from '@playwright/test'
import { type ViteDevServer, createServer as createViteServer } from 'vite'
import { createDashboardServer } from '../server/index.mjs'
import { createDashboardViteConfig } from '../vite.config.mts'

const SESSION_COOKIE = 'easy-editor-session'
const SESSION_TOKEN = 'externally-issued-browser-session-token'
const PROVIDER_SECRET = 'browser-invisible-provider-secret'

const requestBody = (projectId = 'project-1') => ({
  schemaVersion: 1,
  projectId,
  providerId: 'provider-1',
  credentialRef: 'credential-1',
  url: 'https://api.example.test/v1/metrics',
  method: 'GET',
})

const env = {
  EASY_EDITOR_DATA_PROXY_ENABLED: '1',
  EASY_EDITOR_DATA_PROXY_CONFIG_JSON: JSON.stringify({
    auth: {
      mode: 'cookie-session',
      cookieName: SESSION_COOKIE,
      sessions: [
        {
          token: SESSION_TOKEN,
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
        secret: PROVIDER_SECRET,
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
  VITE_E2E: '0',
}

interface Surface {
  name: 'production' | 'vite'
  origin: string
}

const listen = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.closeAllConnections?.()
    server.close(error => (error ? reject(error) : resolve()))
  })

const readOrigin = (server: Server): string => {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Dashboard test server did not bind a TCP port')
  return `http://127.0.0.1:${address.port}`
}

const exerciseCookieChain = async (browser: Browser, surface: Surface): Promise<void> => {
  const context = await browser.newContext()
  try {
    // The external authentication boundary issues the cookie. Neither stock server exposes a login or Set-Cookie path.
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: SESSION_TOKEN,
        url: surface.origin,
        httpOnly: true,
        sameSite: 'Strict',
        secure: false,
      },
    ])
    const page = await context.newPage()
    const browserMessages: string[] = []
    const proxyRequestHeaders: Array<Promise<Record<string, string>>> = []
    page.on('console', message => browserMessages.push(message.text()))
    page.on('weberror', error => browserMessages.push(error.error().message))
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/data/credentialed-json') {
        proxyRequestHeaders.push(request.allHeaders())
      }
    })
    await page.goto(surface.origin)
    const result = await page.evaluate(async body => {
      const response = await fetch('/api/data/credentialed-json', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return {
        body: await response.json(),
        documentCookie: document.cookie,
        status: response.status,
      }
    }, requestBody())
    expect(result.status).toBe(200)
    expect(result.body.data).toEqual({ message: `${surface.name.toUpperCase()}_COOKIE_PROXY_OK` })
    expect(result.documentCookie).not.toContain(SESSION_TOKEN)
    expect(JSON.stringify(result)).not.toContain(PROVIDER_SECRET)

    const wrongProjectStatus = await page.evaluate(async body => {
      const response = await fetch('/api/data/credentialed-json', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return response.status
    }, requestBody('project-2'))
    expect(wrongProjectStatus).toBe(403)
    const observedBrowserHeaders = await Promise.all(proxyRequestHeaders)
    expect(observedBrowserHeaders).toHaveLength(2)
    for (const headers of observedBrowserHeaders) {
      expect(headers.authorization).toBeUndefined()
      expect(headers.cookie).toContain(`${SESSION_COOKIE}=${SESSION_TOKEN}`)
      expect(JSON.stringify(headers)).not.toContain(PROVIDER_SECRET)
    }
    const browserBoundary = await page.evaluate(() =>
      JSON.stringify({
        document: document.documentElement.innerHTML,
        localStorage: Object.fromEntries(Object.entries(localStorage)),
        sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
      }),
    )
    expect(browserBoundary).not.toContain(PROVIDER_SECRET)
    expect(browserBoundary).not.toContain(SESSION_TOKEN)
    expect(JSON.stringify(browserMessages)).not.toContain(PROVIDER_SECRET)
    expect(JSON.stringify(browserMessages)).not.toContain(SESSION_TOKEN)
  } finally {
    await context.close()
  }
}

test('stock production and Vite servers accept a real browser HttpOnly cookie without route interception', async ({
  browser,
}) => {
  const distDir = await mkdtemp(join(tmpdir(), 'easy-editor-cookie-browser-'))
  await writeFile(join(distDir, 'index.html'), '<!doctype html><main>cookie session browser shell</main>')
  const observedRequests: Array<{ authorization: string | undefined; cookie: string | undefined; surface: string }> = []
  const createDataProxyOptions = (surface: Surface['name']) => ({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    transport: async (options: {
      body?: Buffer
      headers: Record<string, string>
      lookup: (
        hostname: string,
        options: Record<string, unknown>,
        callback: (error: Error | null, address: string, family: number) => void,
      ) => void
      maxBytes: number
      method: string
      url: URL
    }) => {
      expect(options.url.href).toBe('https://api.example.test/v1/metrics')
      expect(options.method).toBe('GET')
      expect(options.body).toBeUndefined()
      expect(options.maxBytes).toBe(1024)
      expect(options.headers).toEqual({
        accept: 'application/json',
        authorization: `Bearer ${PROVIDER_SECRET}`,
      })
      const pinned = await new Promise<{ address: string; family: number }>((resolvePinned, rejectPinned) => {
        options.lookup('api.example.test', {}, (error, address, family) => {
          if (error) rejectPinned(error)
          else resolvePinned({ address, family })
        })
      })
      expect(pinned).toEqual({ address: '93.184.216.34', family: 4 })
      observedRequests.push({
        authorization: options.headers.authorization,
        cookie: options.headers.cookie,
        surface,
      })
      return {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: Buffer.from(JSON.stringify({ message: `${surface.toUpperCase()}_COOKIE_PROXY_OK` })),
      }
    },
  })

  const productionServer = createDashboardServer({
    distDir,
    env,
    dataProxyOptions: createDataProxyOptions('production'),
  })
  let viteServer: ViteDevServer | undefined
  try {
    await listen(productionServer)
    viteServer = await createViteServer({
      ...createDashboardViteConfig({ env, dataProxyOptions: createDataProxyOptions('vite') }),
      appType: 'spa',
      configFile: false,
      logLevel: 'silent',
      root: distDir,
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    })
    await viteServer.listen()
    if (!viteServer.httpServer) throw new Error('Vite test server did not expose its HTTP server')
    const surfaces: Surface[] = [
      { name: 'production', origin: readOrigin(productionServer) },
      { name: 'vite', origin: readOrigin(viteServer.httpServer) },
    ]
    for (const surface of surfaces) await exerciseCookieChain(browser, surface)

    expect(observedRequests).toEqual([
      { authorization: `Bearer ${PROVIDER_SECRET}`, cookie: undefined, surface: 'production' },
      { authorization: `Bearer ${PROVIDER_SECRET}`, cookie: undefined, surface: 'vite' },
    ])
  } finally {
    await viteServer?.close()
    await close(productionServer)
    await rm(distDir, { recursive: true, force: true })
  }
})
