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

const receiptQuery = (callId, overrides = {}) => ({
  schemaVersion: 1,
  ...authority,
  callId,
  ...overrides,
})

const invocationContext = compensationTarget => ({
  schemaVersion: 1,
  ...(compensationTarget === undefined ? {} : { compensationTarget }),
})

const runtimeCompensationTarget = (overrides = {}) => ({
  schemaVersion: 1,
  taskId: 'task-completed',
  sessionId: authority.sessionId,
  phase: 'COMPLETED',
  callIndexComplete: true,
  callIndex: [{ callId: 'screen-write-original', capability: 'screen.applyChangeSet' }],
  ...overrides,
})

const invokeRequest = (call, context = invocationContext()) => ({ schemaVersion: 1, call, context })

const createDurablePort = () => {
  let draftGeneration = 0
  const lineage = new Map()
  return {
    async recoverDurableAgentReceipt({ callId }) {
      return structuredClone(lineage.get(callId) ?? { classification: 'missing' })
    },
    async runDurableAgentWrite(operation) {
      let pendingIntent = null
      return operation({
        draft: { draftGeneration },
        async recordIntent(intent) {
          pendingIntent = structuredClone(intent)
          lineage.set(intent.callId, { classification: 'indeterminate', reason: 'intent-without-terminal-receipt' })
          return structuredClone(intent)
        },
        async commitBatch(batch) {
          assert.ok(pendingIntent)
          assert.deepEqual(batch.receiptIntent, pendingIntent)
          draftGeneration += 1
          lineage.set(batch.callId, {
            classification: batch.receipt.status === 'applied' ? 'committed' : 'failed',
            receiptIntent: structuredClone(batch.receiptIntent),
            receipt: structuredClone(batch.receipt),
          })
          return { receipt: structuredClone(batch.receipt) }
        },
      })
    },
    tamperReceiptIntent(callId, mutate) {
      const stored = lineage.get(callId)
      assert.ok(stored?.receiptIntent)
      mutate(stored.receiptIntent)
    },
  }
}

const createRpc = host => {
  const { port1, port2 } = new MessageChannel()
  const pending = new Map()
  let nextId = 1

  port1.on('message', async message => {
    const { id, method, payload } = message
    try {
      const value = method === 'invoke' ? await host.invoke(payload.call, payload.context) : await host[method](payload)
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

const createHarness = async (t, options = {}) => {
  const { TransactionCommittedError, TransactionRollbackIncompleteError, createEngine } = await import(
    coreInstanceUrl.href
  )
  const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  await engine.init()
  const rootMeta = loadDashboardModule('src/editor/materials/root/meta.ts').default
  const imageMeta = loadDashboardModule('src/editor/materials/basic/image/meta.ts').default
  engine.materials.createComponentMeta(rootMeta)
  engine.materials.createComponentMeta(imageMeta)
  if (options.includeDataNodes) {
    for (const path of [
      'src/editor/materials/basic/text/meta.ts',
      'src/editor/materials/chart/bar-chart/meta.ts',
      'src/editor/materials/chart/line-chart/meta.ts',
    ]) {
      engine.materials.createComponentMeta(loadDashboardModule(path).default)
    }
  }
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
            ...(options.includeDataNodes
              ? [
                  {
                    id: 'text-1',
                    componentName: 'Text',
                    title: 'Live total',
                    props: { text: 'Fallback' },
                    $dashboard: { rect: { x: 680, y: 30, width: 300, height: 80 } },
                    children: [],
                  },
                  {
                    id: 'bar-1',
                    componentName: 'BarChart',
                    title: 'Live bars',
                    props: { data: [] },
                    $dashboard: { rect: { x: 20, y: 420, width: 640, height: 360 } },
                    children: [],
                  },
                  {
                    id: 'line-1',
                    componentName: 'LineChart',
                    title: 'Live lines',
                    props: { data: [] },
                    $dashboard: { rect: { x: 680, y: 420, width: 640, height: 360 } },
                    children: [],
                  },
                ]
              : []),
          ],
        },
      ],
    },
    true,
  )
  const persistence = Object.assign(createDurablePort(), options.persistence)
  const activityLease =
    options.activityLease ??
    Object.freeze({ generation: 0, isActive: () => false, waitUntilIdle: async () => ({ generation: 0 }) })
  const host = createDashboardAgentHost({
    activityLease,
    authority,
    artifactService: options.artifactService,
    compensationService:
      options.compensationService ??
      Object.freeze({
        compensate: async () => assert.fail('unexpected compensation invocation'),
        query: async () => null,
      }),
    dataResolver: options.dataResolver,
    dataService: options.dataService,
    enabled: true,
    engine,
    invocationActivity: options.invocationActivity,
    isTransactionCommittedError: error => error instanceof TransactionCommittedError,
    isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
    now: () => 1_700_000_000_000,
    persistence,
  })
  assert.ok(host)
  const rpc = createRpc(host)
  t.after(async () => {
    rpc.close()
    host.dispose()
    await engine.destroy()
  })
  return { activityLease, engine, host, persistence, rpc }
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

test('Host gates and routes online artifact create/revise plus receipt recovery through the injected service', async t => {
  const calls = []
  const receipt = {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'artifact-receipt-1',
    status: 'applied',
    revision: 'revision-artifact-1',
  }
  const artifactService = {
    async createOnline(call) {
      calls.push(['createOnline', structuredClone(call)])
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: 'applied',
        revision: 'revision-artifact-create',
        output: {
          schemaVersion: 1,
          kind: 'online-artifact-post-images',
          componentName: 'GeneratedMaterialHost',
          nodeId: 'generated-created',
          artifactRef: {
            artifactId: 'artifact-created',
            sourceRevision: 'source-created',
            logicalComponentId: 'logical-created',
            sourceIntegrity: `sha256:${'a'.repeat(64)}`,
            target: { kind: 'online' },
          },
        },
      }
    },
    async reviseOnline(call) {
      calls.push(['reviseOnline', structuredClone(call)])
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: 'applied',
        revision: 'revision-artifact-revise',
        output: {
          schemaVersion: 1,
          kind: 'online-artifact-post-images',
          componentName: 'GeneratedMaterialHost',
          nodeId: call.arguments.nodeId,
          artifactRef: {
            artifactId: 'artifact-created',
            sourceRevision: 'source-revised',
            logicalComponentId: 'logical-created',
            sourceIntegrity: `sha256:${'b'.repeat(64)}`,
            target: { kind: 'online' },
          },
        },
      }
    },
    async queryReceipt(request) {
      calls.push(['queryReceipt', structuredClone(request)])
      return request.callId === receipt.callId ? receipt : null
    },
  }
  const { rpc } = await createHarness(t, { artifactService })
  const schema = await rpc.call('describeCapability', {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    capability: 'artifact.createOnline',
  })
  assert.equal(schema.revision, 'artifact.createOnline/1')

  const create = semanticCall({
    arguments: {
      schemaVersion: 1,
      documentId: 'page-1',
      parentId: 'root-1',
      position: { place: 'last' },
      source: 'export default {}',
      css: '',
      safeManifest: { schemaVersion: 1 },
      dependencies: [],
    },
    callId: 'artifact-create-1',
    capability: 'artifact.createOnline',
    expectedRevision: 'service-owned-fence',
  })
  const createResult = await rpc.call('invoke', invokeRequest(create))
  assert.equal(createResult.status, 'applied')
  assert.equal(createResult.output.nodeId, 'generated-created')
  assert.deepEqual(calls[0], ['createOnline', create])

  const revise = semanticCall({
    arguments: {
      schemaVersion: 1,
      nodeId: 'generated-created',
      source: 'export default { revised: true }',
      css: '',
      safeManifest: { schemaVersion: 1 },
      dependencies: [],
    },
    callId: 'artifact-revise-1',
    capability: 'artifact.reviseOnline',
    expectedRevision: 'service-owned-fence-2',
  })
  const reviseResult = await rpc.call('invoke', invokeRequest(revise))
  assert.equal(reviseResult.output.artifactRef.sourceRevision, 'source-revised')
  assert.deepEqual(calls[1], ['reviseOnline', revise])

  assert.deepEqual(await rpc.call('queryReceipt', receiptQuery(receipt.callId)), receipt)
  assert.deepEqual(calls[2], [
    'queryReceipt',
    { projectId: authority.projectId, branchId: authority.branchId, callId: receipt.callId },
  ])
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

test('Host.observe normalizes hostile runtime ComponentMeta metadata without leaking secrets', async t => {
  const { engine, rpc } = await createHarness(t)
  const hostileTags = ['alpha', { nested: 'tag-secret' }, 'omega']
  const hostileMeta = {
    componentName: 'Hostile',
    title: { secret: 'title-secret' },
    description: { secret: 'description-secret' },
    group: { secret: 'group-secret' },
    category: { secret: 'category-secret' },
    tags: hostileTags,
  }
  engine.materials.createComponentMeta(hostileMeta)

  const full = await rpc.call('observe', observeRequest())
  const hostile = full.projection['dashboard.core'].materials.summaries.find(
    summary => summary.componentName === 'Hostile',
  )

  assert.deepEqual(hostile, {
    category: '',
    componentName: 'Hostile',
    description: '',
    group: '',
    tags: ['alpha', 'omega'],
    title: 'Hostile',
  })
  assert.doesNotMatch(
    JSON.stringify(full),
    /title-secret|description-secret|group-secret|category-secret|tag-secret|poisoned/,
  )
})

test('Host validates fixed authority and exposes revisioned semantic capability descriptions', async t => {
  const { rpc } = await createHarness(t)
  const schema = await rpc.call('describeCapability', {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    capability: 'material.describe',
  })

  assert.equal(schema.capability, 'material.describe')
  assert.deepEqual(schema.input.required, ['componentName'])
  const screenWrite = await rpc.call('describeCapability', {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    capability: 'screen.applyChangeSet',
  })
  assert.equal(screenWrite.revision, 'screen.applyChangeSet/1')
  assert.deepEqual(screenWrite.input.required, ['schemaVersion', 'documentId', 'operations'])
  const compensate = await rpc.call('describeCapability', {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    capability: 'task.compensate',
  })
  assert.equal(compensate.revision, 'task.compensate/1')
  await assert.rejects(
    rpc.call('describeCapability', {
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      capability: 'data.inspect',
    }),
    error =>
      error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable &&
      error.reason === 'data-service-is-unavailable',
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
  assert.equal(await rpc.call('queryReceipt', receiptQuery('read-only-call')), null)
  await assert.rejects(
    rpc.call('queryReceipt', receiptQuery('foreign-task-call', { taskId: 'foreign-task' })),
    error => error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.authorityMismatch,
  )
})

test('Host queryReceipt maps durable missing and indeterminate lineage without replay', async t => {
  const persistence = {
    async recoverDurableAgentReceipt(request) {
      if (request.callId === 'missing-call') return { classification: 'missing' }
      return { classification: 'indeterminate', reason: 'missing-durable-receipt' }
    },
  }
  const { rpc } = await createHarness(t, { persistence })
  const query = callId => rpc.call('queryReceipt', receiptQuery(callId))

  assert.equal(await query('missing-call'), null)
  assert.deepEqual(await query('unknown-call'), {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'unknown-call',
    status: 'indeterminate',
    failure: {
      code: 'INDETERMINATE_RECEIPT',
      message: 'missing-durable-receipt',
      retryable: false,
      details: { reason: 'missing-durable-receipt' },
    },
  })
})

test('Host invokes reads while disabled data and future capabilities reject before effects', async t => {
  const { engine, rpc } = await createHarness(t)
  const full = await rpc.call('observe', observeRequest())
  const inspect = await rpc.call(
    'invoke',
    invokeRequest(
      semanticCall({
        arguments: { nodeIds: ['image-1'] },
        callId: 'inspect-1',
        capability: 'screen.inspect',
        expectedRevision: full.revision,
      }),
    ),
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
    invokeRequest(
      semanticCall({
        arguments: { query: 'basic', limit: 5 },
        callId: 'search-1',
        capability: 'material.search',
        expectedRevision: full.revision,
      }),
    ),
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
  ]
  for (const [index, capability] of unavailableCapabilities.entries()) {
    const write = await rpc.call(
      'invoke',
      invokeRequest(
        semanticCall({
          arguments: { changes: [{ nodeId: 'image-1', path: ['props', 'src'], value: 'mutated' }] },
          callId: `unavailable-${index + 1}`,
          capability,
          expectedRevision: full.revision,
        }),
      ),
    )
    assert.equal(write.status, 'rejected', capability)
    assert.equal(write.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable, capability)
    assert.deepEqual(engine.project.currentDocument.exportRaw(), beforeSchema, capability)
    assert.equal(engine.materials.version, beforeMaterialVersion, capability)
  }

  const stale = await rpc.call(
    'invoke',
    invokeRequest(
      semanticCall({
        callId: 'stale-1',
        capability: 'screen.inspect',
        expectedRevision: 'stale-revision',
      }),
    ),
  )
  assert.equal(stale.status, 'rejected')
  assert.equal(stale.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.staleRevision)
})

test('Host accepts only an exact runtime-owned compensation context and routes its immutable projection', async t => {
  let compensateInput
  const compensationReceipt = {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'compensate-1',
    status: 'applied',
    revision: 'compensation-run-1:1',
    witness: { schemaVersion: 1, kind: 'compensation-run' },
  }
  const compensationService = {
    async compensate(input) {
      compensateInput = input
      return compensationReceipt
    },
    async query({ outerCallId }) {
      return outerCallId === compensationReceipt.callId ? compensationReceipt : null
    },
  }
  const { host, rpc } = await createHarness(t, { compensationService })
  const full = await host.observe(observeRequest())
  const target = runtimeCompensationTarget()
  const call = semanticCall({
    arguments: { schemaVersion: 1, targetTaskId: target.taskId },
    callId: compensationReceipt.callId,
    capability: 'task.compensate',
    expectedRevision: full.revision,
  })
  const result = await host.invoke(call, invocationContext(target))

  assert.equal(result.status, 'applied')
  assert.deepEqual(compensateInput, {
    schemaVersion: 1,
    outerCallId: call.callId,
    target,
  })
  assert.notStrictEqual(compensateInput.target, target)
  assert.equal(Object.isFrozen(compensateInput.target), true)
  assert.equal(Object.isFrozen(compensateInput.target.callIndex), true)
  assert.equal(Object.isFrozen(compensateInput.target.callIndex[0]), true)
  assert.deepEqual(await rpc.call('queryReceipt', receiptQuery(call.callId)), compensationReceipt)
})

test('Host rejects missing, accessor-backed, misplaced, and mismatched invoke contexts before effects', async t => {
  let compensationCalls = 0
  const { engine, host } = await createHarness(t, {
    compensationService: {
      compensate: async () => {
        compensationCalls += 1
        return null
      },
      query: async () => null,
    },
  })
  const full = await host.observe(observeRequest())
  const before = structuredClone(engine.project.currentDocument.exportRaw())
  const readCall = semanticCall({
    arguments: { query: 'basic' },
    callId: 'context-read',
    capability: 'material.search',
    expectedRevision: full.revision,
  })
  const compensateCall = semanticCall({
    arguments: { schemaVersion: 1, targetTaskId: 'task-completed' },
    callId: 'context-compensate',
    capability: 'task.compensate',
    expectedRevision: full.revision,
  })
  let getterCount = 0
  const accessorContext = invocationContext()
  Object.defineProperty(accessorContext, 'unexpected', {
    enumerable: true,
    get() {
      getterCount += 1
      return 'must-not-run'
    },
  })

  const invalidCases = [
    [readCall, undefined],
    [readCall, { schemaVersion: 2 }],
    [readCall, accessorContext],
    [readCall, invocationContext(runtimeCompensationTarget())],
    [compensateCall, invocationContext()],
    [compensateCall, invocationContext(runtimeCompensationTarget({ sessionId: 'foreign-session' }))],
    [compensateCall, invocationContext(runtimeCompensationTarget({ taskId: 'other-task' }))],
    [compensateCall, invocationContext(runtimeCompensationTarget({ callIndexComplete: false }))],
    [
      compensateCall,
      invocationContext(
        runtimeCompensationTarget({
          callIndex: [
            { callId: 'duplicate', capability: 'screen.applyChangeSet' },
            { callId: 'duplicate', capability: 'screen.inspect' },
          ],
        }),
      ),
    ],
    [
      compensateCall,
      invocationContext(
        runtimeCompensationTarget({ callIndex: [{ callId: 'nested', capability: 'task.compensate' }] }),
      ),
    ],
  ]
  for (const [call, context] of invalidCases) {
    const result = await host.invoke(call, context)
    assert.equal(result.status, 'rejected')
    assert.ok(
      [DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest, DASHBOARD_AGENT_HOST_ERROR_CODE.authorityMismatch].includes(
        result.failure.code,
      ),
    )
  }
  assert.equal(getterCount, 0)
  assert.equal(compensationCalls, 0)
  assert.deepEqual(engine.project.currentDocument.exportRaw(), before)
})

test('Host applies a semantic Screen ChangeSet once and strictly recovers its private durable lineage', async t => {
  const { engine, persistence, rpc } = await createHarness(t)
  const full = await rpc.call('observe', observeRequest())
  const call = semanticCall({
    arguments: {
      schemaVersion: 1,
      documentId: engine.project.currentDocument.id,
      operations: [
        {
          opId: 'set-image-source',
          type: 'set',
          nodeId: 'image-1',
          fieldId: 'image.source',
          value: { base64: 'image://agent-updated', raw: { width: 800, height: 450 } },
        },
      ],
    },
    callId: 'screen-write-1',
    capability: 'screen.applyChangeSet',
    expectedRevision: full.revision,
  })
  const beforeMutationVersion = engine.project.currentDocument.mutationVersion
  const result = await rpc.call('invoke', invokeRequest(call))

  assert.equal(result.status, 'applied', JSON.stringify(result))
  const imageNode = engine.project.currentDocument.getNode('image-1')
  assert.equal(imageNode.getPropValue('src'), 'image://agent-updated')
  assert.equal(imageNode.getExtraPropValue('$dashboard.rect.width'), 800)
  assert.equal(imageNode.getExtraPropValue('$dashboard.rect.height'), 450)
  const appliedMutationVersion = engine.project.currentDocument.mutationVersion
  assert.ok(appliedMutationVersion > beforeMutationVersion)

  const recovered = await rpc.call('queryReceipt', receiptQuery(call.callId))
  assert.equal(recovered.status, 'applied')
  assert.equal(recovered.callId, call.callId)
  assert.equal(Object.hasOwn(recovered, 'receiptIntent'), false)

  const replay = await rpc.call('invoke', invokeRequest(call))
  assert.equal(replay.status, 'applied')
  assert.equal(engine.project.currentDocument.mutationVersion, appliedMutationVersion)

  persistence.tamperReceiptIntent(call.callId, intent => {
    intent.expectedPostImages.images[0].value = 'image://tampered'
  })
  const tampered = await rpc.call('queryReceipt', receiptQuery(call.callId))
  assert.equal(tampered.status, 'indeterminate')
  assert.equal(tampered.failure.code, 'INDETERMINATE_RECEIPT')
  assert.equal(tampered.failure.details.reason, 'screen-prepared-hash-mismatch')
})

test('Host routes page-local data writes through Screen and recovers receipts before changed-schema validation', async t => {
  const dataResolver = Object.freeze({
    resolve: async () => assert.fail('writes must not resolve datasource payloads'),
  })
  const { engine, persistence, rpc } = await createHarness(t, { dataResolver, includeDataNodes: true })
  const document = engine.project.currentDocument
  assert.equal(document.history.isUndoable(), false)

  const initial = await rpc.call('observe', observeRequest())
  const upsertCall = semanticCall({
    arguments: {
      schemaVersion: 1,
      descriptor: {
        schemaVersion: 1,
        id: 'live-total',
        kind: 'static',
        value: { total: 42 },
      },
    },
    callId: 'data-upsert-1',
    capability: 'data.upsert',
    expectedRevision: initial.revision,
  })
  const upsert = await rpc.call('invoke', invokeRequest(upsertCall))
  assert.equal(upsert.status, 'applied', JSON.stringify(upsert))
  assert.deepEqual(document.getNode('root-1').getPropValue('dataSources'), {
    schemaVersion: 1,
    sources: [upsertCall.arguments.descriptor],
  })
  assert.equal(document.getNode('root-1').getExtraPropValue('dataSource'), undefined)
  const afterUpsertMutation = document.mutationVersion
  assert.equal(document.history.isUndoable(), true)

  const replayedUpsert = await rpc.call('invoke', invokeRequest(upsertCall))
  assert.equal(replayedUpsert.status, 'applied')
  assert.equal(document.mutationVersion, afterUpsertMutation)
  assert.equal((await rpc.call('queryReceipt', receiptQuery(upsertCall.callId))).status, 'applied')

  const afterUpsert = await rpc.call('observe', observeRequest())
  const bindCall = semanticCall({
    arguments: {
      schemaVersion: 1,
      nodeId: 'text-1',
      field: 'text',
      binding: { sourceId: 'live-total', transform: [{ op: 'select', path: ['total'] }] },
    },
    callId: 'data-bind-1',
    capability: 'data.bind',
    expectedRevision: afterUpsert.revision,
  })
  const bind = await rpc.call('invoke', invokeRequest(bindCall))
  assert.equal(bind.status, 'applied', JSON.stringify(bind))
  assert.deepEqual(document.getNode('text-1').getPropValue('dataBindings'), {
    schemaVersion: 1,
    fields: { text: bindCall.arguments.binding },
  })
  const afterBindMutation = document.mutationVersion

  const replayedBind = await rpc.call('invoke', invokeRequest(bindCall))
  assert.equal(replayedBind.status, 'applied')
  assert.equal(document.mutationVersion, afterBindMutation)
  assert.equal((await rpc.call('queryReceipt', receiptQuery(bindCall.callId))).status, 'applied')

  document.history.back()
  assert.equal(document.getNode('text-1').getPropValue('dataBindings'), undefined)
  assert.ok(document.getNode('root-1').getPropValue('dataSources'))
  document.history.back()
  assert.equal(document.getNode('root-1').getPropValue('dataSources'), undefined)
  assert.equal(document.history.isUndoable(), false)

  document.getNode('root-1').setExtraPropValue('dataSource', {
    list: [{ id: upsertCall.arguments.descriptor.id, type: 'fetch' }],
  })
  assert.equal(document.exportRaw().dataSource.list[0].id, upsertCall.arguments.descriptor.id)
  const removed = await engine.commands.execute({ type: 'removeNode', nodeId: 'text-1' })
  assert.equal(removed.ok, true)
  assert.equal(document.getNode('text-1'), null)
  const damagedMutationVersion = document.mutationVersion

  const recoveredBindAfterUndoAndDeletion = await rpc.call('invoke', invokeRequest(bindCall))
  const recoveredUpsertAfterUndoAndLegacyConflict = await rpc.call('invoke', invokeRequest(upsertCall))
  assert.equal(recoveredBindAfterUndoAndDeletion.status, 'applied')
  assert.equal(recoveredUpsertAfterUndoAndLegacyConflict.status, 'applied')
  assert.equal(document.mutationVersion, damagedMutationVersion)
  assert.equal(document.getNode('text-1'), null)
  assert.equal(document.getNode('root-1').getPropValue('dataSources'), undefined)

  persistence.tamperReceiptIntent(bindCall.callId, intent => {
    intent.expectedPostImages.images[0].value = { schemaVersion: 1, fields: {} }
  })
  const integrityFailureBeforeSchemaValidation = await rpc.call('invoke', invokeRequest(bindCall))
  assert.equal(integrityFailureBeforeSchemaValidation.status, 'indeterminate')
  assert.equal(integrityFailureBeforeSchemaValidation.failure.code, 'INDETERMINATE_RECEIPT')
  assert.equal(integrityFailureBeforeSchemaValidation.failure.details.reason, 'screen-prepared-hash-mismatch')
  assert.equal(document.mutationVersion, damagedMutationVersion)

  const damaged = await rpc.call('observe', observeRequest())
  const missingSource = await rpc.call(
    'invoke',
    invokeRequest(
      semanticCall({
        arguments: {
          schemaVersion: 1,
          nodeId: 'bar-1',
          field: 'data',
          binding: { sourceId: 'missing-source' },
        },
        callId: 'data-bind-missing-source',
        capability: 'data.bind',
        expectedRevision: damaged.revision,
      }),
    ),
  )
  assert.equal(missingSource.status, 'rejected')
  assert.equal(missingSource.failure.code, 'DATA_SOURCE_NOT_FOUND')
})

test('Host projects only safe bounded data.bind node targets to invocation activity observers', async t => {
  const events = []
  const dataService = {
    bind: async call => ({ schemaVersion: 1, callId: call.callId, status: 'applied' }),
    inspect: async () => ({ schemaVersion: 1, scope: { kind: 'page', documentId: 'page-1' }, sources: [] }),
    preview: async () => assert.fail('unexpected preview'),
    upsert: async call => ({ schemaVersion: 1, callId: call.callId, status: 'applied' }),
  }
  const invocationActivity = {
    begin(input) {
      events.push({ phase: 'started', input: structuredClone(input) })
      return () => events.push({ phase: 'finished', callId: input.callId })
    },
  }
  const { host } = await createHarness(t, { dataService, includeDataNodes: true, invocationActivity })
  const full = await host.observe(observeRequest())
  const invokeBind = (callId, nodeId) =>
    host.invoke(
      semanticCall({
        arguments: { schemaVersion: 1, nodeId, field: 'text', binding: { sourceId: 'source-1' } },
        callId,
        capability: 'data.bind',
        expectedRevision: full.revision,
      }),
      invocationContext(),
    )

  assert.equal((await invokeBind('data-bind-target-safe', 'text-1')).status, 'applied')
  assert.equal((await invokeBind('data-bind-target-unsafe', '../text-1')).status, 'applied')
  assert.deepEqual(events, [
    {
      phase: 'started',
      input: {
        callId: 'data-bind-target-safe',
        capability: 'data.bind',
        taskId: authority.taskId,
        targetNodeIds: ['text-1'],
        targets: [
          {
            nodeId: 'text-1',
            label: 'Live total',
            rect: { x: 680, y: 30, width: 300, height: 80 },
          },
        ],
      },
    },
    { phase: 'finished', callId: 'data-bind-target-safe' },
    {
      phase: 'started',
      input: {
        callId: 'data-bind-target-unsafe',
        capability: 'data.bind',
        taskId: authority.taskId,
        targetNodeIds: [],
        targets: [],
      },
    },
    { phase: 'finished', callId: 'data-bind-target-unsafe' },
  ])
})

test('Host projects active Screen targets without granting UI observers invocation authority', async t => {
  const events = []
  const invocationActivity = {
    begin(input) {
      events.push({ phase: 'started', input: structuredClone(input) })
      return () => {
        events.push({ phase: 'finished', callId: input.callId })
        throw new Error('observer cleanup failure')
      }
    },
  }
  const { engine, rpc } = await createHarness(t, { invocationActivity })
  const full = await rpc.call('observe', observeRequest())
  const result = await rpc.call(
    'invoke',
    invokeRequest(
      semanticCall({
        arguments: {
          schemaVersion: 1,
          documentId: engine.project.currentDocument.id,
          operations: [
            {
              opId: 'update-image',
              type: 'set',
              nodeId: 'image-1',
              fieldId: 'image.source',
              value: { base64: 'image://target-projection', raw: { width: 640, height: 360 } },
            },
          ],
        },
        callId: 'screen-target-projection',
        capability: 'screen.applyChangeSet',
        expectedRevision: full.revision,
      }),
    ),
  )

  assert.equal(result.status, 'applied', JSON.stringify(result))
  assert.deepEqual(events, [
    {
      phase: 'started',
      input: {
        callId: 'screen-target-projection',
        capability: 'screen.applyChangeSet',
        taskId: authority.taskId,
        targetNodeIds: ['image-1'],
        targets: [
          {
            nodeId: 'image-1',
            label: 'Hero image',
            rect: { x: 20, y: 30, width: 640, height: 360 },
          },
        ],
      },
    },
    { phase: 'finished', callId: 'screen-target-projection' },
  ])
})

test('actual model-visible manifests expose data fields as read-only and refresh with real Materials.version', async t => {
  const { engine, rpc } = await createHarness(t, { includeDataNodes: true })
  const full = await rpc.call('observe', observeRequest())
  const describe = componentName =>
    rpc.call(
      'invoke',
      invokeRequest(
        semanticCall({
          arguments: { componentName },
          callId: `describe-${componentName}-${engine.materials.version}`,
          capability: 'material.describe',
          expectedRevision: full.revision,
        }),
      ),
    )
  const [root, image, text, bar, line] = await Promise.all(
    ['Root', 'Image', 'Text', 'BarChart', 'LineChart'].map(describe),
  )

  assert.equal(root.status, 'applied')
  assert.equal(image.status, 'applied')
  assert.equal(root.output.material.componentName, 'Root')
  assert.equal(image.output.material.componentName, 'Image')
  assert.ok(root.output.material.fields.some(field => field.fieldId === 'root.image'))
  assert.ok(image.output.material.fields.some(field => field.fieldId === 'image.source'))
  assert.equal(root.output.material.fields.find(field => field.fieldId === 'dataSources')?.access, 'read-only')
  for (const manifest of [text, bar, line]) {
    assert.equal(manifest.status, 'applied')
    assert.equal(manifest.output.material.fields.find(field => field.fieldId === 'dataBindings')?.access, 'read-only')
  }
  assert.doesNotMatch(
    JSON.stringify([root, image, text, bar, line]),
    /setValue|getValue|MaterialView|credential|source-must-not-cross/,
  )

  const previousVersion = root.output.materialRegistryVersion
  engine.materials.refreshComponentMetasMap()
  const refreshedFull = await rpc.call('observe', observeRequest())
  assert.notEqual(refreshedFull.revision, full.revision)
  const refreshed = await rpc.call(
    'invoke',
    invokeRequest(
      semanticCall({
        arguments: { componentName: 'Root' },
        callId: 'describe-root-refreshed',
        capability: 'material.describe',
        expectedRevision: refreshedFull.revision,
      }),
    ),
  )
  assert.equal(refreshed.status, 'applied')
  assert.notEqual(refreshed.output.materialRegistryVersion, previousVersion)
})

test('generic Screen writes cannot mutate reserved data fields while trusted data capabilities retain that path', async t => {
  const { engine, rpc } = await createHarness(t, { includeDataNodes: true })
  const full = await rpc.call('observe', observeRequest())
  const before = structuredClone(engine.project.currentDocument.exportRaw())
  const attempts = [
    {
      opId: 'direct-data-sources',
      type: 'set',
      nodeId: 'root-1',
      fieldId: 'dataSources',
      value: { schemaVersion: 1, sources: [] },
    },
    {
      opId: 'direct-data-bindings',
      type: 'set',
      nodeId: 'text-1',
      fieldId: 'dataBindings',
      value: { schemaVersion: 1, fields: { text: { sourceId: 'source-1' } } },
    },
  ]

  for (const [index, operation] of attempts.entries()) {
    const result = await rpc.call(
      'invoke',
      invokeRequest(
        semanticCall({
          arguments: {
            schemaVersion: 1,
            documentId: engine.project.currentDocument.id,
            operations: [operation],
          },
          callId: `direct-reserved-data-${index + 1}`,
          capability: 'screen.applyChangeSet',
          expectedRevision: full.revision,
        }),
      ),
    )
    assert.equal(result.status, 'rejected')
    assert.equal(result.failure.code, 'UNSUPPORTED_FIELD')
  }
  assert.deepEqual(engine.project.currentDocument.exportRaw(), before)
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

  const rejected = await host.invoke(hostileCall, invocationContext())
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
    invocationContext(),
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
    invocationContext(),
  )
  assert.equal(result.status, 'rejected')
  assert.equal(result.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.hostDisposed)
  await assert.rejects(host.observe(observeRequest()), DashboardAgentHostError)
})
