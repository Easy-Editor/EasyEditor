import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const contract = await import('../src/editor/data/contract.mjs')
const featureFlag = await import('../src/editor/data/feature-flag.mjs')
const SAFE_TYPE = 'dashboard-safe-v1'

const loadRuntime = captures => {
  const filename = resolve(dashboardRoot, 'src/editor/data/runtime.ts')
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const legacyFetch = async () => ({ data: 'legacy' })
  const datasourcePackage = {
    __esModule: true,
    createDataSourceEngine: (dataSource, engine, options) => {
      captures.engineCreations = [...(captures.engineCreations ?? []), { dataSource, engine, options }]
      captures.pluginOptions = options
      const closureId = dataSource.list?.[0]?.id ?? 'empty'
      return {
        dataSource,
        engine,
        options,
        reloadDataSource: async () => {
          captures.reloadCalls = [...(captures.reloadCalls ?? []), closureId]
        },
      }
    },
    defaultRequestHandlersMap: { fetch: legacyFetch },
  }
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    request => {
      if (request === '@easy-editor/plugin-datasource') return datasourcePackage
      if (request === './contract.mjs') return contract
      if (request === './composition') return { DASHBOARD_SAFE_DATA_SOURCE_TYPE: SAFE_TYPE }
      throw new Error(`Unexpected dependency ${request}`)
    },
    loaded,
    loaded.exports,
  )
  return { legacyFetch, runtime: loaded.exports }
}

const connectPageRenderer = (instance, dataSource = { list: [] }) =>
  instance.dataSourceEngine.createDataSourceEngine(dataSource, { __namespace: 'page' })

const jsonResponse = value => ({
  ok: true,
  headers: { get: name => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify(value),
})

test('safe data feature flag is independently default-off and strict', () => {
  assert.equal(featureFlag.resolveDashboardSafeDataFeatureFlag(), false)
  assert.equal(featureFlag.resolveDashboardSafeDataFeatureFlag({ VITE_DASHBOARD_AGENT_DATA: 'false' }), false)
  for (const enabled of [true, 'true', '1']) {
    assert.equal(featureFlag.resolveDashboardSafeDataFeatureFlag({ VITE_DASHBOARD_AGENT_DATA: enabled }), true)
  }
})

test('editor, preview, and Agent Host use explicit data flag wiring', () => {
  const editorSource = readFileSync(resolve(dashboardRoot, 'src/editor/index.ts'), 'utf8')
  const previewSource = readFileSync(resolve(dashboardRoot, 'src/pages/preview/index.tsx'), 'utf8')
  const previewMaterialGcSource = readFileSync(resolve(dashboardRoot, 'src/pages/preview/material-gc.mjs'), 'utf8')
  const runtimeSource = readFileSync(resolve(dashboardRoot, 'src/editor/runtime.ts'), 'utf8')

  assert.match(editorSource, /safeDataEnabled:\s*dashboardAgentRuntimeFeatureFlags\.data/u)
  assert.match(editorSource, /engine\.config\.set\('dataSourceEngine', dashboardDataRuntime\.dataSourceEngine\)/u)
  assert.match(previewSource, /resolveDashboardSafeDataFeatureFlag\(import\.meta\.env\)/u)
  assert.match(previewSource, /composeDashboardRootSchema\([^)]*\{ safeDataEnabled \}/su)
  assert.doesNotMatch(
    `${previewSource}\n${previewMaterialGcSource}`,
    /@\/editor\/runtime|editor\/agent\/(?:host|capabilities\/data|data-runtime)/u,
  )
  assert.match(previewMaterialGcSource, /editor\/agent\/capabilities\/promotion\/material-gc/u)
  assert.match(runtimeSource, /dashboardAgentRuntimeFeatureFlags\.data\s*\?\s*createDashboardSameOriginDataResolver/su)
  assert.match(runtimeSource, /\.\.\.\(dataResolver \? \{ dataResolver \} : \{\}\)/u)
})

test('editor and preview runtime unwrap credentialed proxy data and apply the same descriptor transform', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return jsonResponse({
      schemaVersion: 1,
      data: [{ value: 1 }, { value: 2 }],
      diagnostics: { status: 200, rows: 2, bytes: 25, durationMs: 3, providerId: 'analytics' },
    })
  }
  const captures = {}
  const { runtime } = loadRuntime(captures)
  const instance = runtime.createDashboardDataRuntime({
    expressionEvaluator: {},
    fetchImpl,
    getProjectId: () => 'project-1',
    safeDataEnabled: true,
  })
  connectPageRenderer(instance)
  const descriptor = {
    schemaVersion: 1,
    id: 'sales',
    kind: 'credentialed-http-json',
    providerId: 'analytics',
    credentialRef: 'primary',
    request: { url: 'https://api.example.test/sales', method: 'GET' },
    transform: [{ op: 'take', count: 1 }],
  }

  const result = await captures.pluginOptions.requestHandlersMap[SAFE_TYPE]({ descriptor })
  assert.deepEqual(result, { data: [{ value: 1 }] })
  assert.equal(calls[0].url, '/api/data/credentialed-json')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    schemaVersion: 1,
    projectId: 'project-1',
    providerId: 'analytics',
    credentialRef: 'primary',
    url: 'https://api.example.test/sales',
    method: 'GET',
  })
  instance.dispose()
})

test('manual datasource fetch and inert legacy mock handling remain explicit beside the safe handler', async () => {
  const captures = {}
  const { legacyFetch, runtime } = loadRuntime(captures)
  let fetchCalls = 0
  const instance = runtime.createDashboardDataRuntime({
    expressionEvaluator: {},
    fetchImpl: async () => {
      fetchCalls += 1
      return jsonResponse([])
    },
    getProjectId: () => 'project-1',
  })
  connectPageRenderer(instance)

  assert.strictEqual(captures.pluginOptions.requestHandlersMap.fetch, legacyFetch)
  assert.deepEqual(
    await captures.pluginOptions.requestHandlersMap.mock({ uri: 'mock://city/summary', method: 'GET' }),
    { data: null },
  )
  assert.equal(fetchCalls, 0)
  await assert.rejects(
    captures.pluginOptions.requestHandlersMap.mock({ uri: 'https://fixtures.example.test/summary' }),
    /requires a mock:\/\/ URI/iu,
  )
  assert.equal(typeof captures.pluginOptions.requestHandlersMap[SAFE_TYPE], 'function')
  instance.dispose()
  await assert.rejects(captures.pluginOptions.requestHandlersMap.mock({ uri: 'mock://city/summary' }), /disposed/iu)
})

test('editor data runtime refreshes through the current renderer-owned datasource closure', async () => {
  const captures = {}
  const { runtime } = loadRuntime(captures)
  const instance = runtime.createDashboardDataRuntime({
    expressionEvaluator: {},
    fetchImpl: async () => jsonResponse([]),
    getProjectId: () => 'project-1',
    safeDataEnabled: true,
  })

  await assert.rejects(instance.reloadDataSources(), /not connected to a renderer/iu)
  instance.dataSourceEngine.createDataSourceEngine({ list: [{ id: 'old-page' }] }, { __namespace: 'page' })
  await instance.reloadDataSources()
  assert.deepEqual(captures.reloadCalls, ['old-page'])
  let releaseCommit
  const committed = new Promise(resolve => {
    releaseCommit = resolve
  })
  const refreshPhases = []
  const refresh = instance.refreshAfterRerender(
    async signal => {
      assert.equal(signal.aborted, false)
      instance.dataSourceEngine.createDataSourceEngine({ list: [{ id: 'new-page' }] }, { __namespace: 'page' })
      instance.dataSourceEngine.createDataSourceEngine({ list: [{ id: 'component' }] }, { __namespace: 'component' })
      await committed
      refreshPhases.push('pre-reload-commit')
    },
    async signal => {
      assert.equal(signal.aborted, false)
      assert.deepEqual(captures.reloadCalls, ['old-page', 'new-page'])
      refreshPhases.push('post-reload-commit')
    },
  )
  await Promise.resolve()
  assert.deepEqual(captures.reloadCalls, ['old-page'], 'render-time configuration must not reload before commit')
  releaseCommit()
  await refresh
  assert.deepEqual(captures.reloadCalls, ['old-page', 'new-page'])
  assert.deepEqual(refreshPhases, ['pre-reload-commit', 'post-reload-commit'])

  await assert.rejects(
    instance.refreshAfterRerender(async () => {
      instance.dataSourceEngine.createDataSourceEngine({ list: [{ id: 'rejected-page' }] }, { __namespace: 'page' })
      throw new Error('renderer commit failed')
    }),
    /renderer commit failed/u,
  )
  assert.deepEqual(captures.reloadCalls, ['old-page', 'new-page'])

  let releaseDisposedCommit
  const disposedCommit = new Promise(resolve => {
    releaseDisposedCommit = resolve
  })
  let refreshSignal
  const disposedRefresh = instance.refreshAfterRerender(async signal => {
    refreshSignal = signal
    await disposedCommit
  })
  await Promise.resolve()
  instance.dispose()
  assert.equal(refreshSignal.aborted, true)
  releaseDisposedCommit()
  await assert.rejects(disposedRefresh, /disposed/iu)
  assert.deepEqual(captures.reloadCalls, ['old-page', 'new-page'])
  await assert.rejects(instance.reloadDataSources(), /disposed/iu)
  assert.throws(
    () => instance.dataSourceEngine.createDataSourceEngine({ list: [] }, { __namespace: 'page' }),
    /disposed/iu,
  )
})

test('disabled safe data handler fails closed without fetching', async () => {
  let fetchCalls = 0
  const captures = {}
  const { runtime } = loadRuntime(captures)
  const instance = runtime.createDashboardDataRuntime({
    expressionEvaluator: {},
    fetchImpl: async () => {
      fetchCalls += 1
      return jsonResponse([])
    },
    getProjectId: () => 'project-1',
    safeDataEnabled: false,
  })
  connectPageRenderer(instance)

  await assert.rejects(
    captures.pluginOptions.requestHandlersMap[SAFE_TYPE]({
      descriptor: { schemaVersion: 1, id: 'disabled', kind: 'static', value: [] },
    }),
    /safe data feature is disabled/iu,
  )
  assert.equal(fetchCalls, 0)
  instance.dispose()
})

test('safe datasource identifiers reject prototype keys and non-canonical characters', () => {
  const staticDescriptor = id => ({ schemaVersion: 1, id, kind: 'static', value: [] })
  for (const id of ['__proto__', 'constructor', 'prototype', 'bad id', 'bad\nid', '-leading']) {
    assert.throws(
      () => contract.parseSafeDataDescriptor(staticDescriptor(id)),
      error => error?.code === 'INVALID_DATA_DESCRIPTOR' && error?.path === 'descriptor.id',
    )
    assert.throws(
      () => contract.parseSafeDataBinding({ sourceId: id }),
      error => error?.code === 'INVALID_DATA_DESCRIPTOR' && error?.path === 'binding.sourceId',
    )
  }

  const credentialed = {
    schemaVersion: 1,
    id: 'sales.v1',
    kind: 'credentialed-http-json',
    providerId: 'analytics:prod',
    credentialRef: 'primary-key',
    request: { url: 'https://api.example.test/sales', method: 'GET' },
  }
  assert.equal(contract.parseSafeDataDescriptor(credentialed).providerId, 'analytics:prod')
  for (const field of ['providerId', 'credentialRef']) {
    assert.throws(
      () => contract.parseSafeDataDescriptor({ ...credentialed, [field]: '__proto__' }),
      error => error?.code === 'INVALID_DATA_DESCRIPTOR' && error?.path === `descriptor.${field}`,
    )
  }
})

test('shared resolver enforces the top-level row budget even without a transform', async () => {
  const resolver = contract.createDashboardSameOriginDataResolver({
    fetchImpl: async () => {
      throw new Error('static data must not fetch')
    },
  })

  await assert.rejects(
    resolver.resolve({
      schemaVersion: 1,
      id: 'too-many-rows',
      kind: 'static',
      value: Array.from({ length: contract.DEFAULT_DASHBOARD_DATA_LIMITS.maxRows + 1 }, (_, index) => ({ index })),
    }),
    error => error?.code === 'DATA_BUDGET_EXCEEDED' && error?.reason === 'row-budget-exceeded',
  )
})

test('public JSON streaming stops as soon as the byte budget is exceeded', async () => {
  const encoder = new TextEncoder()
  const chunks = [encoder.encode('x'.repeat(800)), encoder.encode('y'.repeat(300)), encoder.encode('unread')]
  let reads = 0
  let cancels = 0
  let releases = 0
  let textCalls = 0
  const resolver = contract.createDashboardSameOriginDataResolver({
    fetchImpl: async () => ({
      ok: true,
      headers: { get: name => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      body: {
        getReader: () => ({
          read: async () => (reads < chunks.length ? { done: false, value: chunks[reads++] } : { done: true }),
          cancel: async () => {
            cancels += 1
          },
          releaseLock: () => {
            releases += 1
          },
        }),
      },
      text: async () => {
        textCalls += 1
        return 'should-not-buffer'
      },
    }),
  })

  await assert.rejects(
    resolver.resolve(
      {
        schemaVersion: 1,
        id: 'stream-budget',
        kind: 'public-http-json',
        request: { url: 'https://public.example.test/data', method: 'GET' },
      },
      { limits: { maxBytes: 1_024 } },
    ),
    error => error?.code === 'DATA_BUDGET_EXCEEDED' && error?.reason === 'resolver-response-byte-budget-exceeded',
  )
  assert.equal(reads, 2)
  assert.equal(cancels, 1)
  assert.equal(releases, 1)
  assert.equal(textCalls, 0)
})

test('public JSON rejects an oversized Content-Length before reading the body', async () => {
  let reads = 0
  const resolver = contract.createDashboardSameOriginDataResolver({
    fetchImpl: async () => ({
      ok: true,
      headers: {
        get: name =>
          name.toLowerCase() === 'content-type'
            ? 'application/json'
            : name.toLowerCase() === 'content-length'
              ? '2048'
              : null,
      },
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1
            return { done: true }
          },
          releaseLock: () => undefined,
        }),
      },
    }),
  })

  await assert.rejects(
    resolver.resolve(
      {
        schemaVersion: 1,
        id: 'content-length-budget',
        kind: 'public-http-json',
        request: { url: 'https://public.example.test/data', method: 'GET' },
      },
      { limits: { maxBytes: 1_024 } },
    ),
    error => error?.code === 'DATA_BUDGET_EXCEEDED' && error?.reason === 'resolver-response-byte-budget-exceeded',
  )
  assert.equal(reads, 0)
})
