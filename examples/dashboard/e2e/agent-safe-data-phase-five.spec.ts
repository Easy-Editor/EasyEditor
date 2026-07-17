import { type Server, createServer } from 'node:http'
import { type BrowserContext, type Page, expect, test } from '@playwright/test'

const SERVER_ONLY_SENTINEL = 'phase-five-server-only-secret-must-never-reach-browser'
const CREDENTIAL_ROUTE = '**/api/data/credentialed-json'
const PUBLIC_ROUTE = 'https://phase-five-public.example/**'

let fixtureServer: Server
let fixtureOrigin: string

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

test.beforeAll(async () => {
  fixtureServer = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.invalid')
    const allowedOrigin = request.headers.origin ?? '*'
    const payload = url.pathname === '/legacy' ? { message: 'LEGACY_MANUAL_OK' } : null
    if (request.method !== 'GET' || payload === null) {
      response
        .writeHead(404, {
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Origin': allowedOrigin,
          'Cache-Control': 'no-store',
          Vary: 'Origin',
        })
        .end()
      return
    }
    const body = JSON.stringify(payload)
    response
      .writeHead(200, {
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/json; charset=utf-8',
        Vary: 'Origin',
      })
      .end(body)
  })
  await listen(fixtureServer)
  const address = fixtureServer.address()
  if (!address || typeof address === 'string') throw new Error('Phase-five HTTP fixture did not bind a TCP port')
  fixtureOrigin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  await close(fixtureServer)
})

const waitForEditor = async (page: Page): Promise<void> => {
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__EASY_EDITOR_E2E__?.getEngineState())).toBe('ready')
}

const installCredentialedFixture = async (
  context: BrowserContext,
  requests: Array<{
    readonly body: Record<string, unknown>
    readonly headers: Record<string, string>
    readonly surface: string
  }>,
): Promise<void> => {
  await context.route(CREDENTIAL_ROUTE, async route => {
    const request = route.request()
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>
    requests.push({
      body,
      headers: request.headers(),
      surface: new URL(request.frame().url()).pathname,
    })
    await route.fulfill({
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        schemaVersion: 1,
        data: { message: 'CREDENTIALED_BROWSER_OK' },
        diagnostics: {
          status: 200,
          rows: 1,
          bytes: 39,
          durationMs: 1,
          providerId: body.providerId,
        },
      }),
    })
  })
}

const readBrowserPersistenceBoundary = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const databases: Record<string, unknown> = {}
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
      try {
        const storeNames = [...database.objectStoreNames]
        if (storeNames.length === 0) continue
        const transaction = database.transaction(storeNames, 'readonly')
        const records = Object.fromEntries(
          await Promise.all(
            storeNames.map(
              storeName =>
                new Promise<[string, unknown[]]>((resolve, reject) => {
                  const request = transaction.objectStore(storeName).getAll()
                  request.onerror = () => reject(request.error)
                  request.onsuccess = () => resolve([storeName, request.result])
                }),
            ),
          ),
        )
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
        })
        databases[info.name] = records
      } finally {
        database.close()
      }
    }
    return JSON.stringify({
      databases,
      document: document.documentElement.innerHTML,
      localStorage: Object.fromEntries(Object.entries(localStorage)),
      sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
    })
  })

test('Agent safe data survives editor and standalone preview reloads without crossing the credential boundary', async ({
  context,
  page,
}) => {
  const credentialRequests: Array<{
    readonly body: Record<string, unknown>
    readonly headers: Record<string, string>
    readonly surface: string
  }> = []
  const browserMessages: string[] = []
  const publicRequests: Array<{ method: string; postData: string | null; url: string }> = []
  context.on('console', message => browserMessages.push(message.text()))
  context.on('weberror', error => browserMessages.push(error.error().message))
  await installCredentialedFixture(context, credentialRequests)
  await context.route(PUBLIC_ROUTE, async route => {
    const request = route.request()
    publicRequests.push({ method: request.method(), postData: request.postData(), url: request.url() })
    await route.fulfill({
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message: 'PUBLIC_BROWSER_OK' }),
    })
  })

  await page.goto('/')
  await waitForEditor(page)
  const initialized = await page.evaluate(
    async ({ legacyUrl }) => {
      const runtime = await import('/src/editor/runtime.ts')
      runtime.engine.loadProject(
        {
          id: 'phase-five-browser-project',
          version: '1.0.0',
          componentsMap: [],
          dataSource: {
            list: [
              {
                id: 'legacy-manual',
                isInit: true,
                isSync: false,
                type: 'fetch',
                options: { uri: legacyUrl, method: 'GET' },
              },
            ],
          },
          componentsTree: [
            {
              docId: 'phase-five-page',
              fileName: 'home',
              id: 'phase-five-root',
              componentName: 'Root',
              isRoot: true,
              props: { backgroundColor: '#232630' },
              $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
              children: [
                {
                  id: 'phase-five-mock-text',
                  componentName: 'Text',
                  props: { text: 'MOCK_FALLBACK' },
                  $dashboard: { rect: { x: 700, y: 330, width: 420, height: 60 } },
                  children: [],
                },
                {
                  id: 'phase-five-public-text',
                  componentName: 'Text',
                  props: { text: 'PUBLIC_FALLBACK' },
                  $dashboard: { rect: { x: 700, y: 400, width: 420, height: 60 } },
                  children: [],
                },
                {
                  id: 'phase-five-private-text',
                  componentName: 'Text',
                  props: { text: 'CREDENTIAL_FALLBACK' },
                  $dashboard: { rect: { x: 700, y: 470, width: 420, height: 60 } },
                  children: [],
                },
                {
                  id: 'phase-five-legacy-text',
                  componentName: 'Text',
                  props: {
                    text: 'LEGACY_FALLBACK',
                    dataBindings: {
                      schemaVersion: 1,
                      fields: {
                        text: { sourceId: 'legacy-manual', transform: [{ op: 'select', path: ['message'] }] },
                      },
                    },
                  },
                  $dashboard: { rect: { x: 1140, y: 330, width: 420, height: 60 } },
                  children: [],
                },
                {
                  id: 'phase-five-static-chart',
                  componentName: 'BarChart',
                  props: { data: [] },
                  $dashboard: { rect: { x: 700, y: 550, width: 760, height: 360 } },
                  children: [],
                },
              ],
            },
          ],
        },
        true,
      )
      await runtime.persistDashboardProject('manual-save')
      await runtime.dashboardPersistence.flush()
      return {
        dataFlag: runtime.dashboardAgentRuntimeFeatureFlags.data,
        persistence: runtime.dashboardPersistence.getSnapshot(),
      }
    },
    { legacyUrl: `${fixtureOrigin}/legacy` },
  )
  expect(initialized.dataFlag).toBe(true)
  expect(initialized.persistence).toMatchObject({ state: 'ready', branchId: 'main' })
  await page.reload()
  await waitForEditor(page)
  await expect(page.locator('.lc-simulator-content-frame')).toContainText('LEGACY_MANUAL_OK')

  const result = await page.evaluate(
    async ({ publicUrl }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const persistence = runtime.dashboardPersistence.getSnapshot()
      const document = runtime.engine.project.currentDocument
      if (!persistence.projectId || !persistence.branchId || !document) {
        throw new Error('Phase-five browser authority is unavailable')
      }
      const authority = {
        projectId: persistence.projectId,
        branchId: persistence.branchId,
        sessionId: 'phase-five-browser-session',
        taskId: 'phase-five-browser-task',
      }
      const host = runtime.composeDashboardAgentHost(authority)
      if (!host) throw new Error('Phase-five browser Host is unavailable')
      const descriptors = [
        {
          schemaVersion: 1,
          id: 'phase-five-mock',
          kind: 'mock',
          fixture: { message: 'MOCK_BROWSER_OK' },
          transform: [{ op: 'select', path: ['message'] }],
        },
        {
          schemaVersion: 1,
          id: 'phase-five-public',
          kind: 'public-http-json',
          request: { url: publicUrl, method: 'GET' },
          transform: [{ op: 'select', path: ['message'] }],
        },
        {
          schemaVersion: 1,
          id: 'phase-five-credentialed',
          kind: 'credentialed-http-json',
          providerId: 'phase-five-provider',
          credentialRef: 'opaque-phase-five-credential-ref',
          request: { url: 'https://phase-five-provider.example/v1/metrics', method: 'GET' },
          transform: [{ op: 'select', path: ['message'] }],
        },
        {
          schemaVersion: 1,
          id: 'phase-five-static-chart',
          kind: 'static',
          value: [
            { month: 'P5A', desktop: 7, mobile: 3 },
            { month: 'P5B', desktop: 11, mobile: 5 },
          ],
        },
      ] as const
      let sequence = 0
      const invoke = async (capability: string, argumentsValue: Record<string, unknown>) => {
        const observed = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
        sequence += 1
        const response = await host.invoke(
          {
            schemaVersion: 1,
            ...authority,
            stepId: `phase-five-step-${sequence}`,
            callId: `phase-five-call-${sequence}`,
            capability,
            expectedRevision: observed.revision,
            arguments: argumentsValue,
          },
          { schemaVersion: 1 },
        )
        if (response.status !== 'applied') throw new Error(JSON.stringify(response))
        return response
      }
      try {
        const previews = []
        for (const descriptor of descriptors) {
          previews.push(
            await invoke('data.preview', {
              schemaVersion: 1,
              descriptor,
            }),
          )
          await invoke('data.upsert', { schemaVersion: 1, descriptor })
        }
        for (const [nodeId, field, sourceId] of [
          ['phase-five-mock-text', 'text', 'phase-five-mock'],
          ['phase-five-public-text', 'text', 'phase-five-public'],
          ['phase-five-private-text', 'text', 'phase-five-credentialed'],
          ['phase-five-static-chart', 'data', 'phase-five-static-chart'],
        ]) {
          await invoke('data.bind', {
            schemaVersion: 1,
            nodeId,
            field,
            binding: { sourceId },
          })
        }
        await runtime.persistDashboardProject('manual-save')
        await runtime.dashboardPersistence.flush()
        const raw = document.exportRaw()
        return {
          catalog: raw.props?.dataSources,
          draftGeneration: runtime.dashboardPersistence.getSnapshot().draftGeneration,
          previewSamples: previews.map(preview => preview.output.preview.sample),
        }
      } finally {
        host.dispose()
      }
    },
    { publicUrl: 'https://phase-five-public.example/public' },
  )

  expect(result.previewSamples).toEqual([
    'MOCK_BROWSER_OK',
    'PUBLIC_BROWSER_OK',
    'CREDENTIALED_BROWSER_OK',
    [
      { month: 'P5A', desktop: 7, mobile: 3 },
      { month: 'P5B', desktop: 11, mobile: 5 },
    ],
  ])
  expect(result.catalog.sources.map((source: { id: string }) => source.id)).toEqual([
    'phase-five-credentialed',
    'phase-five-mock',
    'phase-five-public',
    'phase-five-static-chart',
  ])
  expect(result.draftGeneration).toBeGreaterThan(1)

  await page.reload()
  await waitForEditor(page)
  const editorCanvas = page.locator('.lc-simulator-content-frame')
  await expect(editorCanvas).toContainText('MOCK_BROWSER_OK')
  await expect(editorCanvas).toContainText('PUBLIC_BROWSER_OK')
  await expect(editorCanvas).toContainText('CREDENTIALED_BROWSER_OK')
  await expect(editorCanvas).toContainText('LEGACY_MANUAL_OK')
  await expect(editorCanvas).toContainText('P5A')
  await expect(editorCanvas.locator('.recharts-wrapper')).toHaveCount(1)

  await page.goto('/preview')
  await expect(page.locator('.lc-editor-canvas')).toBeVisible()
  const previewCanvas = page.locator('.lc-editor-content-frame')
  for (const text of ['MOCK_BROWSER_OK', 'PUBLIC_BROWSER_OK', 'CREDENTIALED_BROWSER_OK', 'LEGACY_MANUAL_OK', 'P5A']) {
    await expect(previewCanvas).toContainText(text)
  }
  await expect(previewCanvas.locator('.recharts-wrapper')).toHaveCount(1)

  await page.reload()
  await expect(page.locator('.lc-editor-canvas')).toBeVisible()
  await expect(page.locator('.lc-editor-content-frame')).toContainText('CREDENTIALED_BROWSER_OK')
  await expect(page.locator('.lc-editor-content-frame')).toContainText('LEGACY_MANUAL_OK')

  expect(credentialRequests.length).toBeGreaterThanOrEqual(4)
  expect(new Set(credentialRequests.map(request => request.surface))).toEqual(new Set(['/', '/preview']))
  for (const request of credentialRequests) {
    expect(request.headers.authorization).toBeUndefined()
    expect(JSON.stringify(request)).not.toContain(SERVER_ONLY_SENTINEL)
    expect(request.body).toEqual({
      schemaVersion: 1,
      projectId: initialized.persistence.projectId,
      providerId: 'phase-five-provider',
      credentialRef: 'opaque-phase-five-credential-ref',
      url: 'https://phase-five-provider.example/v1/metrics',
      method: 'GET',
    })
  }
  expect(publicRequests.length).toBeGreaterThanOrEqual(4)
  for (const request of publicRequests) {
    expect(request.url).toBe('https://phase-five-public.example/public')
    expect(request.method).toBe('GET')
    expect(request.postData).toBeNull()
  }

  expect(await readBrowserPersistenceBoundary(page)).not.toContain(SERVER_ONLY_SENTINEL)
  expect(JSON.stringify(browserMessages)).not.toContain(SERVER_ONLY_SENTINEL)
})
