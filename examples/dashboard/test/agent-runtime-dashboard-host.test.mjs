import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MessageChannel } from 'node:worker_threads'
import ts from 'typescript'

import {
  DASHBOARD_AGENT_HOST_ERROR_CODE,
  DashboardAgentHostError,
  createDashboardAgentHost,
} from '../src/editor/agent/host/index.mjs'

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const coreInstanceUrl = new URL('../../../packages/core/dist/instance.js', import.meta.url)
const moduleCache = new Map()

const resolveTypeScriptModule = (request, parentFilename) => {
  const basePath = resolve(dirname(parentFilename), request)
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, resolve(basePath, 'index.ts')]
  return candidates.find(candidate => {
    try {
      readFileSync(candidate)
      return true
    } catch {
      return false
    }
  })
}

const loadDashboardModule = relativePath => {
  const filename = resolve(dashboardRoot, relativePath)
  const cached = moduleCache.get(filename)
  if (cached) return cached.exports

  const source = readFileSync(filename, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  moduleCache.set(filename, loadedModule)

  const localRequire = request => {
    if (request === '@easy-editor/core') return {}
    if (request.endsWith('/component') || request === './component') {
      return { __esModule: true, default: function MaterialView() {} }
    }
    if (request.startsWith('.')) {
      const resolved = resolveTypeScriptModule(request, filename)
      if (!resolved) throw new Error(`Unable to resolve ${request} from ${filename}`)
      return loadDashboardModule(relative(dashboardRoot, resolved))
    }
    throw new Error(`Unexpected dependency ${request} in ${filename}`)
  }

  const evaluate = new Function('require', 'module', 'exports', transpiled)
  evaluate(localRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const authority = Object.freeze({
  projectId: 'project-agent-host',
  branchId: 'branch-main',
  sessionId: 'session-1',
  taskId: 'task-1',
})

const observeRequest = (mode, cursor) => ({
  schemaVersion: 1,
  ...authority,
  mode: mode ?? 'full',
  ...(cursor ? { cursor } : {}),
})

const semanticCall = ({ arguments: args = {}, callId, capability, expectedRevision, overrides = {} }) => ({
  schemaVersion: 1,
  ...authority,
  stepId: 'step-1',
  callId,
  capability,
  arguments: args,
  expectedRevision,
  ...overrides,
})

const createRpc = host => {
  const { port1, port2 } = new MessageChannel()
  const pending = new Map()
  let nextId = 1

  port1.on('message', async message => {
    const { id, method, payload } = message
    try {
      const value = await host[method](payload)
      port1.postMessage({ id, ok: true, value })
    } catch (error) {
      const serialized =
        typeof error?.toJSON === 'function'
          ? error.toJSON()
          : {
              code: error?.code,
              message: error instanceof Error ? error.message : 'RPC request failed',
              name: error?.name,
              reason: error?.reason,
            }
      port1.postMessage({ id, ok: false, error: serialized })
    }
  })
  port2.on('message', message => {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.ok) request.resolve(message.value)
    else {
      const error = new Error(message.error?.message || message.error?.reason || 'RPC request failed')
      Object.assign(error, message.error)
      request.reject(error)
    }
  })
  port1.start()
  port2.start()

  return {
    call(method, payload) {
      return new Promise((resolvePromise, rejectPromise) => {
        const id = nextId++
        pending.set(id, { reject: rejectPromise, resolve: resolvePromise })
        port2.postMessage({ id, method, payload })
      })
    },
    close() {
      for (const request of pending.values()) request.reject(new Error('RPC closed'))
      pending.clear()
      port1.close()
      port2.close()
    },
  }
}

const createHarness = async t => {
  const { createEngine } = await import(coreInstanceUrl.href)
  const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  await engine.init()
  const rootMeta = loadDashboardModule('src/editor/materials/root/meta.ts').default
  const imageMeta = loadDashboardModule('src/editor/materials/basic/image/meta.ts').default
  engine.materials.createComponentMeta(rootMeta)
  engine.materials.createComponentMeta(imageMeta)
  engine.loadProject(
    {
      id: authority.projectId,
      version: '0.0.1',
      componentsMap: [],
      componentsTree: [
        {
          docId: 'page-1',
          id: 'root-1',
          componentName: 'Root',
          title: 'Landing page',
          props: {
            backgroundColor: '#232630',
            credentialRef: 'credential-must-not-cross',
            artifactRef: { source: 'source-must-not-cross' },
          },
          $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
          children: [
            {
              id: 'image-1',
              componentName: 'Image',
              title: 'Hero image',
              props: { src: 'image://safe', apiKey: 'api-key-must-not-cross' },
              $dashboard: { rect: { x: 20, y: 30, width: 640, height: 360 } },
              children: [],
            },
          ],
        },
      ],
    },
    true,
  )
  const host = createDashboardAgentHost({ authority, enabled: true, engine })
  assert.ok(host)
  const rpc = createRpc(host)
  t.after(async () => {
    rpc.close()
    host.dispose()
    await engine.destroy()
  })
  return { engine, host, rpc }
}

test('default-off Host composition is inert and production never boots an Agent Runtime or Worker', () => {
  let getterInvocations = 0
  const options = { enabled: false }
  for (const key of ['authority', 'engine']) {
    Object.defineProperty(options, key, {
      enumerable: true,
      get() {
        getterInvocations += 1
        throw new Error('default-off composition touched a host dependency')
      },
    })
  }

  assert.equal(createDashboardAgentHost(options), null)
  assert.equal(createDashboardAgentHost(), null)
  assert.equal(getterInvocations, 0)

  const sources = ['src/editor/agent/host/index.mjs', 'src/editor/runtime.ts', 'src/editor/index.ts'].map(path =>
    readFileSync(resolve(dashboardRoot, path), 'utf8'),
  )
  const productionSource = sources.join('\n')
  assert.doesNotMatch(productionSource, /\bcreateAgentRuntime\b|\bnew\s+Worker\b|\bAgentPersistence\b/)
  assert.doesNotMatch(productionSource, /\bMessageChannel\b|\bMessagePort\b/)
})

test('actual MessageChannel observation owns full and delta DTOs without host leakage or aliasing', async t => {
  const { engine, rpc } = await createHarness(t)
  const full = await rpc.call('observe', observeRequest())
  const core = full.projection['dashboard.core']
  const serialized = JSON.stringify(full)

  assert.equal(full.schemaVersion, 1)
  assert.equal(typeof full.cursor, 'string')
  assert.deepEqual(Object.keys(core.materials).sort(), ['registryVersion', 'summaries'])
  assert.deepEqual(
    core.materials.summaries.map(summary => summary.componentName),
    ['Image', 'Root'],
  )
  assert.doesNotMatch(
    serialized,
    /credential-must-not-cross|api-key-must-not-cross|source-must-not-cross|configure|advanced|History|Document|Engine/,
  )

  const providerIds = Object.keys(full.projection).sort()
  assert.deepEqual(Object.keys(full.providerGenerations).sort(), providerIds)

  const ownedProviderGenerations = structuredClone(full.providerGenerations)
  assert.ok(
    Number.isSafeInteger(ownedProviderGenerations['dashboard.core']) && ownedProviderGenerations['dashboard.core'] >= 0,
  )

  const originalGeneration = ownedProviderGenerations['dashboard.core']
  full.providerGenerations['dashboard.core'] = -1
  full.projection['dashboard.core'].materials.summaries[0].title = 'caller mutation'
  full.projection['dashboard.core'].nodes['image-1'].extra.title = 'caller alias'
  const nextFull = await rpc.call('observe', observeRequest())
  assert.deepEqual(nextFull.providerGenerations, ownedProviderGenerations)
  assert.notStrictEqual(nextFull.providerGenerations, ownedProviderGenerations)
  assert.equal(nextFull.providerGenerations['dashboard.core'], originalGeneration)
  assert.notEqual(nextFull.projection['dashboard.core'].materials.summaries[0].title, 'caller mutation')
  assert.equal(nextFull.projection['dashboard.core'].nodes['image-1'].extra.title, 'Hero image')

  engine.project.currentDocument.getNode('image-1').setExtraPropValue('$dashboard.rect.x', 88)
  const delta = await rpc.call('observe', observeRequest('delta', nextFull.cursor))
  assert.equal(Object.hasOwn(delta, 'projection'), false)
  assert.equal(delta.baseRevision, nextFull.revision)
  assert.equal(delta.baseCursor, nextFull.cursor)
  assert.equal(delta.providerId, 'dashboard.core')
  assert.equal(delta.providerGeneration, originalGeneration)
  assert.ok(delta.changes.some(change => change.path.join('.') === 'nodes.image-1.extra.$dashboard.rect.x'))

  const resync = await rpc.call('observe', observeRequest('delta', 'lost-cursor'))
  assert.equal(Object.hasOwn(resync, 'projection'), true)
  assert.deepEqual(resync.providerGenerations, ownedProviderGenerations)
  assert.notStrictEqual(resync.providerGenerations, ownedProviderGenerations)
  assert.equal(resync.projection['dashboard.core'].nodes['image-1'].extra.$dashboard.rect.x, 88)
})

test('Host validates fixed authority and exposes only available Phase-2 descriptions', async t => {
  const { rpc } = await createHarness(t)
  const schema = await rpc.call('describeCapability', {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    capability: 'material.describe',
  })

  assert.equal(schema.capability, 'material.describe')
  assert.deepEqual(schema.input.required, ['componentName'])
  await assert.rejects(
    rpc.call('describeCapability', {
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      capability: 'screen.applyChangeSet',
    }),
    error => error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable,
  )
  await assert.rejects(
    rpc.call('observe', { ...observeRequest(), projectId: 'foreign-project' }),
    error => error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.authorityMismatch,
  )
  await assert.rejects(
    rpc.call('observe', {
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      sessionId: authority.sessionId,
      mode: 'full',
    }),
    error => error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
  )
  assert.equal(
    await rpc.call('queryReceipt', {
      projectId: authority.projectId,
      branchId: authority.branchId,
      callId: 'read-only-call',
    }),
    null,
  )
})

test('read-only invokes inspect and search while every write rejects before effects', async t => {
  const { engine, rpc } = await createHarness(t)
  const full = await rpc.call('observe', observeRequest())
  const inspect = await rpc.call(
    'invoke',
    semanticCall({
      arguments: { nodeIds: ['image-1'] },
      callId: 'inspect-1',
      capability: 'screen.inspect',
      expectedRevision: full.revision,
    }),
  )
  assert.equal(inspect.status, 'applied')
  assert.deepEqual(inspect.output.nodes, [
    {
      id: 'image-1',
      parentId: 'root-1',
      index: 0,
      componentName: 'Image',
      title: 'Hero image',
      rect: { x: 20, y: 30, width: 640, height: 360 },
    },
  ])

  const search = await rpc.call(
    'invoke',
    semanticCall({
      arguments: { query: 'basic', limit: 5 },
      callId: 'search-1',
      capability: 'material.search',
      expectedRevision: full.revision,
    }),
  )
  assert.equal(search.status, 'applied')
  assert.deepEqual(
    search.output.matches.map(match => match.componentName),
    ['Image'],
  )

  const beforeSchema = structuredClone(engine.project.currentDocument.exportRaw())
  const beforeMaterialVersion = engine.materials.version
  const unavailableCapabilities = [
    'artifact.createOnline',
    'artifact.promoteLocal',
    'artifact.reviseOnline',
    'data.bind',
    'data.inspect',
    'data.preview',
    'data.upsert',
    'project.checkpoint',
    'screen.applyChangeSet',
    'task.compensate',
  ]
  for (const [index, capability] of unavailableCapabilities.entries()) {
    const write = await rpc.call(
      'invoke',
      semanticCall({
        arguments: { changes: [{ nodeId: 'image-1', path: ['props', 'src'], value: 'mutated' }] },
        callId: `unavailable-${index + 1}`,
        capability,
        expectedRevision: full.revision,
      }),
    )
    assert.equal(write.status, 'rejected', capability)
    assert.equal(write.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable, capability)
    assert.deepEqual(engine.project.currentDocument.exportRaw(), beforeSchema, capability)
    assert.equal(engine.materials.version, beforeMaterialVersion, capability)
  }

  const stale = await rpc.call(
    'invoke',
    semanticCall({
      callId: 'stale-1',
      capability: 'screen.inspect',
      expectedRevision: 'stale-revision',
    }),
  )
  assert.equal(stale.status, 'rejected')
  assert.equal(stale.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.staleRevision)
})

test('actual Root/Image manifests compile on demand and refresh with real Materials.version', async t => {
  const { engine, rpc } = await createHarness(t)
  const full = await rpc.call('observe', observeRequest())
  const describe = componentName =>
    rpc.call(
      'invoke',
      semanticCall({
        arguments: { componentName },
        callId: `describe-${componentName}-${engine.materials.version}`,
        capability: 'material.describe',
        expectedRevision: full.revision,
      }),
    )
  const [root, image] = await Promise.all([describe('Root'), describe('Image')])

  assert.equal(root.status, 'applied')
  assert.equal(image.status, 'applied')
  assert.equal(root.output.material.componentName, 'Root')
  assert.equal(image.output.material.componentName, 'Image')
  assert.ok(root.output.material.fields.some(field => field.fieldId === 'root.image'))
  assert.ok(image.output.material.fields.some(field => field.fieldId === 'image.source'))
  assert.doesNotMatch(JSON.stringify([root, image]), /setValue|getValue|MaterialView|credential|source-must-not-cross/)

  const previousVersion = root.output.materialRegistryVersion
  engine.materials.refreshComponentMetasMap()
  const refreshedFull = await rpc.call('observe', observeRequest())
  assert.notEqual(refreshedFull.revision, full.revision)
  const refreshed = await rpc.call(
    'invoke',
    semanticCall({
      arguments: { componentName: 'Root' },
      callId: 'describe-root-refreshed',
      capability: 'material.describe',
      expectedRevision: refreshedFull.revision,
    }),
  )
  assert.equal(refreshed.status, 'applied')
  assert.notEqual(refreshed.output.materialRegistryVersion, previousVersion)
})

test('direct Host validation rejects accessor-only keys without invoking getters or effects', async t => {
  const { engine, host } = await createHarness(t)
  const full = await host.observe(observeRequest())
  const before = structuredClone(engine.project.currentDocument.exportRaw())

  let getterCount = 0
  const hostileCall = semanticCall({
    arguments: { query: 'basic', limit: 5 },
    callId: 'direct-accessor-key',
    capability: 'material.search',
    expectedRevision: full.revision,
  })
  Object.defineProperty(hostileCall, 'unexpected', {
    enumerable: true,
    get() {
      getterCount += 1
      return 'boom'
    },
  })

  const rejected = await host.invoke(hostileCall)
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest)
  assert.equal(getterCount, 0)
  assert.deepEqual(engine.project.currentDocument.exportRaw(), before)
})

test('direct Host screen.inspect rejects getter-backed nodeIds arrays before any effect', async t => {
  const { engine, host } = await createHarness(t)
  const full = await host.observe(observeRequest())
  const before = structuredClone(engine.project.currentDocument.exportRaw())

  let getterCount = 0
  const nodeIds = []
  Object.defineProperty(nodeIds, '0', {
    enumerable: true,
    get() {
      getterCount += 1
      return 'image-1'
    },
  })

  const rejected = await host.invoke(
    semanticCall({
      arguments: { nodeIds },
      callId: 'direct-nodeIds-getter',
      capability: 'screen.inspect',
      expectedRevision: full.revision,
    }),
  )

  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest)
  assert.equal(getterCount, 0)
  assert.deepEqual(engine.project.currentDocument.exportRaw(), before)
})

test('disposed Host closes its owned services and returns a typed rejection', async t => {
  const { host } = await createHarness(t)
  host.dispose()
  assert.equal(host.disposed, true)
  assert.equal(host.dispose(), undefined)

  const result = await host.invoke(
    semanticCall({
      callId: 'disposed-call',
      capability: 'screen.inspect',
      expectedRevision: 'revision',
    }),
  )
  assert.equal(result.status, 'rejected')
  assert.equal(result.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.hostDisposed)
  await assert.rejects(host.observe(observeRequest()), DashboardAgentHostError)
})
