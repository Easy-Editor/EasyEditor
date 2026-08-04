import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MessageChannel } from 'node:worker_threads'
import ts from 'typescript'

import { createDashboardMutationQuiescenceGate } from '../src/editor/agent/activity/mutation-quiescence-gate.mjs'
import {
  DASHBOARD_AGENT_HOST_ERROR_CODE,
  DashboardAgentHostError,
  createDashboardAgentHost,
} from '../src/editor/agent/host/index.mjs'
import { createDashboardHostPersistenceFacade } from '../src/editor/agent/host/persistence-facade.mjs'

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

const eventually = async predicate => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolvePromise => setImmediate(resolvePromise))
  }
  assert.fail('condition was not reached')
}

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
    ...(options.admitMaterialRefsUnderSharedMutation === undefined
      ? {}
      : { admitMaterialRefsUnderSharedMutation: options.admitMaterialRefsUnderSharedMutation }),
    authority,
    artifactService: options.artifactService,
    compensationService:
      options.compensationService ??
      Object.freeze({
        compensate: async () => assert.fail('unexpected compensation invocation'),
        query: async () => null,
      }),
    ...(options.omitTelemetryChangeSetId
      ? {}
      : {
          createTelemetryChangeSetId: callId => `change-set-v1-${Buffer.from(callId, 'utf8').toString('hex')}`,
        }),
    dataResolver: options.dataResolver,
    dataService: options.dataService,
    enabled: true,
    engine,
    invocationActivity: options.invocationActivity,
    isTransactionCommittedError: error => error instanceof TransactionCommittedError,
    isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
    mutationGate: options.mutationGate,
    now: () => 1_700_000_000_000,
    persistence,
    promotionAvailability: options.promotionAvailability,
    promotionService: options.promotionService,
    telemetry: options.telemetry,
    telemetryNow: options.telemetryNow,
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
  for (const key of ['admitMaterialRefsUnderSharedMutation', 'authority', 'engine']) {
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
  assert.match(
    sources[1],
    /dashboardAgentTelemetryLedger\s*=\s*dashboardAgentRuntimeFeatureFlags\.runtime\s*\?\s*createDashboardAgentTelemetryLedger/u,
  )
  assert.match(sources[1], /dashboardAgentTelemetry\s*=\s*dashboardAgentTelemetryLedger\s*\?/u)
  assert.match(sources[1], /dashboardAgentWorkerTelemetry\s*=\s*dashboardAgentTelemetryLedger\s*\?/u)
})

test('Host persistence facade exposes only frozen required methods and gates the recorded call identity', async () => {
  const calls = []
  let releaseGate
  let markReached
  const reached = new Promise(resolvePromise => {
    markReached = resolvePromise
  })
  const release = new Promise(resolvePromise => {
    releaseGate = resolvePromise
  })
  const persistence = {
    runAgentMutation(callId, operation) {
      calls.push(['mutation', callId])
      return operation()
    },
    async readCompensationRun(request) {
      calls.push(['run-read', request])
      return null
    },
    async readCompensationTargetClaim(request) {
      calls.push(['claim-read', request])
      return null
    },
    async commitCompensationRunState(input) {
      calls.push(['run-commit', input])
      return { committed: true }
    },
    async recoverDurableAgentReceipt(request) {
      calls.push(['receipt-read', request])
      return { classification: 'missing' }
    },
    async runDurableAgentWrite(operation) {
      return operation({
        draft: { draftGeneration: 3 },
        async recordIntent(intent) {
          calls.push(['intent', intent.callId])
          return structuredClone(intent)
        },
        async readReceiptLineage(request) {
          calls.push(['lineage', request])
          return { records: [] }
        },
        async readMutationProvenance(request) {
          calls.push(['provenance', request])
          return { records: [] }
        },
        async commitBatch(batch) {
          calls.push(['batch', batch.callId])
          return { receipt: batch.receipt }
        },
      })
    },
  }
  Object.defineProperty(persistence, 'unknownRuntimePower', {
    get() {
      assert.fail('Host facade must not inspect unknown persistence properties')
    },
  })
  const facade = createDashboardHostPersistenceFacade(persistence, {
    afterRecordIntent: async intent => {
      markReached(intent.callId)
      await release
    },
  })

  assert.equal(Object.isFrozen(facade), true)
  assert.deepEqual(Object.keys(facade).sort(), [
    'commitCompensationRunState',
    'readCompensationRun',
    'readCompensationTargetClaim',
    'recoverDurableAgentReceipt',
    'runAgentMutation',
    'runDurableAgentWrite',
  ])
  assert.equal(
    facade.runAgentMutation('call-mutation', () => 'mutated'),
    'mutated',
  )

  let settled = false
  const write = facade
    .runDurableAgentWrite(async session => {
      assert.equal(Object.isFrozen(session), true)
      assert.deepEqual(Object.keys(session).sort(), [
        'commitBatch',
        'draft',
        'readMutationProvenance',
        'readReceiptLineage',
        'recordIntent',
      ])
      return session.recordIntent({ callId: 'gated-call' })
    })
    .finally(() => {
      settled = true
    })
  assert.equal(await reached, 'gated-call')
  assert.equal(settled, false)
  releaseGate()
  assert.equal((await write).callId, 'gated-call')

  const facadeSource = readFileSync(resolve(dashboardRoot, 'src/editor/agent/host/persistence-facade.mjs'), 'utf8')
  const runtimeSource = readFileSync(resolve(dashboardRoot, 'src/editor/runtime.ts'), 'utf8')
  assert.doesNotMatch(facadeSource, /\bProxy\b|\bReflect\b|\.bind\(/u)
  assert.doesNotMatch(runtimeSource, /new\s+Proxy\s*\(\s*dashboardPersistence/u)
})

test('Host persistence facade gates only successful commit results before they reach the Host', async () => {
  const events = []
  const commitFailure = new Error('commit failed')
  const committedResult = Object.freeze({
    status: 'committed',
    receipt: Object.freeze({ callId: 'committed-call' }),
  })
  let markReached
  let releaseGate
  const reached = new Promise(resolvePromise => {
    markReached = resolvePromise
  })
  const release = new Promise(resolvePromise => {
    releaseGate = resolvePromise
  })
  const persistence = {
    runAgentMutation(_callId, operation) {
      return operation()
    },
    async readCompensationRun() {
      return null
    },
    async readCompensationTargetClaim() {
      return null
    },
    async commitCompensationRunState() {
      return { committed: true }
    },
    async recoverDurableAgentReceipt() {
      return { classification: 'missing' }
    },
    async runDurableAgentWrite(operation) {
      return operation(
        Object.freeze({
          draft: Object.freeze({ draftGeneration: 3 }),
          async recordIntent(intent) {
            return intent
          },
          async readReceiptLineage() {
            return { records: [] }
          },
          async readMutationProvenance() {
            return { records: [] }
          },
          async commitBatch(batch) {
            events.push(`commit:${batch.callId}:start`)
            if (batch.callId === 'failed-call') {
              events.push('commit:failed-call:failed')
              throw commitFailure
            }
            events.push(`commit:${batch.callId}:succeeded`)
            return committedResult
          },
        }),
      )
    },
  }
  const facade = createDashboardHostPersistenceFacade(persistence, {
    afterCommitBatch: async result => {
      events.push(`hook:${result.receipt.callId}:start`)
      markReached(result)
      await release
      events.push(`hook:${result.receipt.callId}:released`)
    },
  })

  let settled = false
  const committed = facade
    .runDurableAgentWrite(session => session.commitBatch({ callId: 'committed-call' }))
    .then(result => {
      events.push(`host:${result.receipt.callId}:result`)
      return result
    })
    .finally(() => {
      settled = true
    })
  assert.strictEqual(await reached, committedResult)
  assert.equal(settled, false)
  assert.deepEqual(events, [
    'commit:committed-call:start',
    'commit:committed-call:succeeded',
    'hook:committed-call:start',
  ])
  releaseGate()
  assert.strictEqual(await committed, committedResult)
  assert.deepEqual(events, [
    'commit:committed-call:start',
    'commit:committed-call:succeeded',
    'hook:committed-call:start',
    'hook:committed-call:released',
    'host:committed-call:result',
  ])

  await assert.rejects(
    facade.runDurableAgentWrite(session => session.commitBatch({ callId: 'failed-call' })),
    error => error === commitFailure,
  )
  assert.deepEqual(events.slice(-2), ['commit:failed-call:start', 'commit:failed-call:failed'])
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

test('Host keeps local promotion on a separate gated service port and recovers its receipts before online artifacts', async t => {
  const calls = []
  const promotionReceipt = {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'promotion-call-1',
    status: 'applied',
    revision: 'revision-promotion-1',
  }
  const localArtifactRef = {
    artifactId: 'artifact-created',
    sourceRevision: 'source-revised',
    logicalComponentId: 'logical-created',
    sourceIntegrity: `sha256:${'b'.repeat(64)}`,
    target: {
      kind: 'local-material',
      materialId: 'material-local',
      materialVersion: '1.0.0',
      buildIntegrity: `sha256:${'c'.repeat(64)}`,
    },
    rollbackTo: {
      artifactId: 'artifact-created',
      sourceRevision: 'source-revised',
      logicalComponentId: 'logical-created',
      sourceIntegrity: `sha256:${'b'.repeat(64)}`,
    },
  }
  const promotionService = {
    async promoteLocal(call) {
      calls.push(['promoteLocal', structuredClone(call)])
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: 'applied',
        revision: promotionReceipt.revision,
        output: {
          schemaVersion: 1,
          kind: 'local-material-promotion-post-images',
          componentName: 'GeneratedMaterialHost',
          nodeId: call.arguments.nodeId,
          artifactRef: localArtifactRef,
        },
      }
    },
    async queryReceipt(request) {
      calls.push(['promotion.queryReceipt', structuredClone(request)])
      return request.callId === promotionReceipt.callId ? promotionReceipt : null
    },
    async resumePending() {
      calls.push(['resumePending'])
      return { schemaVersion: 1, results: [] }
    },
  }
  const artifactService = {
    async createOnline() {
      assert.fail('promotion must not dispatch through artifactService.createOnline')
    },
    async reviseOnline() {
      assert.fail('promotion must not dispatch through artifactService.reviseOnline')
    },
    async queryReceipt(request) {
      calls.push(['artifact.queryReceipt', structuredClone(request)])
      return null
    },
  }
  const promotionAvailability = async () => ({ available: true })
  const { rpc } = await createHarness(t, { artifactService, promotionAvailability, promotionService })

  const schema = await rpc.call('describeCapability', {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    capability: 'artifact.promoteLocal',
  })
  assert.equal(schema.revision, 'artifact.promoteLocal/1')
  assert.deepEqual(schema.input.required, ['schemaVersion', 'nodeId'])
  assert.deepEqual(Object.keys(schema.input.properties), ['schemaVersion', 'nodeId'])

  const call = semanticCall({
    arguments: { schemaVersion: 1, nodeId: 'generated-created' },
    callId: promotionReceipt.callId,
    capability: 'artifact.promoteLocal',
    expectedRevision: 'service-owned-fence',
  })
  const result = await rpc.call('invoke', invokeRequest(call))
  assert.equal(result.status, 'applied')
  assert.equal(result.output.componentName, 'GeneratedMaterialHost')
  assert.equal(result.output.artifactRef.target.kind, 'local-material')
  assert.deepEqual(calls.slice(0, 2), [['resumePending'], ['promoteLocal', call]])
  assert.doesNotMatch(JSON.stringify({ result, schema }), /callback|\bEngine\b/u)

  assert.deepEqual(await rpc.call('queryReceipt', receiptQuery(promotionReceipt.callId)), promotionReceipt)
  assert.deepEqual(calls.slice(2), [
    [
      'promotion.queryReceipt',
      { projectId: authority.projectId, branchId: authority.branchId, callId: promotionReceipt.callId },
    ],
  ])
})

test('Host returns the runtime promotion gate reason without invoking the promotion service', async t => {
  for (const reason of [
    'promotion-feature-disabled',
    'promotion-requires-node-20',
    'promotion-server-unavailable',
    'promotion-local-grant-required',
  ]) {
    let invocations = 0
    const promotionService = {
      async promoteLocal() {
        invocations += 1
        assert.fail('unavailable promotion must not invoke the service')
      },
      async queryReceipt() {
        return null
      },
      async resumePending() {
        return { schemaVersion: 1, results: [] }
      },
    }
    const { rpc } = await createHarness(t, {
      promotionAvailability: async () => ({ available: false, reason }),
      promotionService,
    })
    await assert.rejects(
      rpc.call('describeCapability', {
        schemaVersion: 1,
        projectId: authority.projectId,
        branchId: authority.branchId,
        capability: 'artifact.promoteLocal',
      }),
      error => error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable && error.reason === reason,
    )
    const result = await rpc.call(
      'invoke',
      invokeRequest(
        semanticCall({
          arguments: { schemaVersion: 1, nodeId: 'generated-created' },
          callId: `promotion-unavailable-${reason}`,
          capability: 'artifact.promoteLocal',
          expectedRevision: 'service-owned-fence',
        }),
      ),
    )
    assert.equal(result.status, 'rejected')
    assert.equal(result.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable)
    assert.equal(result.failure.details.reason, reason)
    assert.equal(invocations, 0)
  }
})

test('Host awaits one active-registry recovery per bound host before concurrent promotion describe, invoke, and query', async t => {
  const events = []
  let resumeCount = 0
  let releaseRecovery
  const recoveryGate = new Promise(resolvePromise => {
    releaseRecovery = resolvePromise
  })
  const promotionService = {
    async promoteLocal(call) {
      events.push('promote')
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: 'applied',
        revision: 'promotion-revision',
        output: {
          schemaVersion: 1,
          kind: 'local-material-promotion-post-images',
          componentName: 'GeneratedMaterialHost',
          nodeId: call.arguments.nodeId,
          artifactRef: {
            artifactId: 'artifact-recovered',
            sourceRevision: 'source-recovered',
            logicalComponentId: 'logical-recovered',
            sourceIntegrity: `sha256:${'a'.repeat(64)}`,
            target: {
              kind: 'local-material',
              materialId: 'material-recovered',
              materialVersion: '1.0.0',
              buildIntegrity: `sha256:${'b'.repeat(64)}`,
            },
            rollbackTo: {
              artifactId: 'artifact-recovered',
              sourceRevision: 'source-recovered',
              logicalComponentId: 'logical-recovered',
              sourceIntegrity: `sha256:${'a'.repeat(64)}`,
            },
          },
        },
      }
    },
    async queryReceipt() {
      events.push('query')
      return null
    },
    async resumePending() {
      resumeCount += 1
      events.push('recover-active-registry')
      return recoveryGate
    },
  }
  const promotionAvailability = async () => {
    events.push('availability')
    return { available: true }
  }
  const first = await createHarness(t, { promotionAvailability, promotionService })
  const call = semanticCall({
    arguments: { schemaVersion: 1, nodeId: 'generated-recovered' },
    callId: 'promotion-after-recovery',
    capability: 'artifact.promoteLocal',
    expectedRevision: 'service-owned-fence',
  })
  const describePromise = first.host.describeCapability({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    capability: 'artifact.promoteLocal',
  })
  const invokePromise = first.host.invoke(call, invocationContext())
  const queryPromise = first.host.queryReceipt(receiptQuery('promotion-after-recovery'))

  await new Promise(resolvePromise => setImmediate(resolvePromise))
  assert.equal(resumeCount, 1)
  assert.deepEqual(events, ['recover-active-registry'])
  releaseRecovery({ schemaVersion: 1, results: [] })

  const [schema, result, receipt] = await Promise.all([describePromise, invokePromise, queryPromise])
  assert.equal(schema.revision, 'artifact.promoteLocal/1')
  assert.equal(result.status, 'applied')
  assert.equal(receipt, null)
  assert.equal(resumeCount, 1)
  assert.equal(events[0], 'recover-active-registry')
  assert.equal(events.filter(event => event === 'availability').length, 2)
  assert.equal(events.filter(event => event === 'promote').length, 1)
  assert.equal(events.filter(event => event === 'query').length, 1)

  events.length = 0
  const reloaded = await createHarness(t, { promotionAvailability, promotionService })
  await reloaded.host.describeCapability({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    capability: 'artifact.promoteLocal',
  })
  assert.equal(resumeCount, 2, 'a reloaded bound Host must recover exactly once for its own lifecycle')
  assert.deepEqual(events, ['recover-active-registry', 'availability'])
})

test('Host caches an indeterminate promotion recovery failure and never repeats or bypasses resumePending', async t => {
  let resumeCount = 0
  let downstreamCalls = 0
  const promotionService = {
    async promoteLocal() {
      downstreamCalls += 1
      assert.fail('indeterminate recovery must block promotion')
    },
    async queryReceipt() {
      downstreamCalls += 1
      assert.fail('indeterminate recovery must block promotion receipt lookup')
    },
    async resumePending() {
      resumeCount += 1
      return {
        schemaVersion: 1,
        results: [
          {
            schemaVersion: 1,
            callId: 'promotion-indeterminate',
            status: 'indeterminate',
            failure: { code: 'INDETERMINATE_SERVER_OUTCOME', message: 'unknown', retryable: false },
          },
        ],
      }
    },
  }
  const promotionAvailability = async () => {
    downstreamCalls += 1
    assert.fail('indeterminate recovery must block availability checks')
  }
  const { host } = await createHarness(t, { promotionAvailability, promotionService })
  const request = {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    capability: 'artifact.promoteLocal',
  }
  const call = semanticCall({
    arguments: { schemaVersion: 1, nodeId: 'generated-indeterminate' },
    callId: 'promotion-indeterminate',
    capability: 'artifact.promoteLocal',
    expectedRevision: 'service-owned-fence',
  })
  const [firstDescribe, secondDescribe, invocation, receipt] = await Promise.allSettled([
    host.describeCapability(request),
    host.describeCapability(request),
    host.invoke(call, invocationContext()),
    host.queryReceipt(receiptQuery(call.callId)),
  ])

  for (const described of [firstDescribe, secondDescribe]) {
    assert.equal(described.status, 'rejected')
    assert.equal(described.reason.code, DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable)
    assert.equal(described.reason.reason, 'promotion-recovery-indeterminate')
  }
  assert.equal(invocation.status, 'fulfilled')
  assert.equal(invocation.value.status, 'rejected')
  assert.equal(invocation.value.failure.code, DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable)
  assert.equal(invocation.value.failure.details.reason, 'promotion-recovery-indeterminate')
  assert.equal(receipt.status, 'rejected')
  assert.equal(receipt.reason.code, DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable)
  assert.equal(receipt.reason.reason, 'promotion-recovery-indeterminate')
  assert.equal(resumeCount, 1)
  assert.equal(downstreamCalls, 0)

  await assert.rejects(
    host.describeCapability(request),
    error =>
      error.code === DASHBOARD_AGENT_HOST_ERROR_CODE.capabilityUnavailable &&
      error.reason === 'promotion-recovery-indeterminate',
  )
  assert.equal(resumeCount, 1, 'a cached recovery failure must not retry implicitly')
})

test('Host validates the dedicated promotion service without widening the online artifact service contract', async t => {
  const requiredMethods = ['promoteLocal', 'queryReceipt', 'resumePending']
  for (const missing of requiredMethods) {
    const promotionService = Object.fromEntries(
      requiredMethods.filter(method => method !== missing).map(method => [method, async () => null]),
    )
    await assert.rejects(
      async () => createHarness(t, { promotionAvailability: async () => ({ available: true }), promotionService }),
      new TypeError(`promotionService must expose ${missing}`),
    )
  }
})

test('actual MessageChannel observation owns full and delta DTOs without host leakage or aliasing', async t => {
  const { engine, rpc } = await createHarness(t)
  const full = await rpc.call('observe', observeRequest())
  const core = full.projection['dashboard.core']
  const serialized = JSON.stringify(full)

  assert.equal(full.schemaVersion, 1)
  assert.equal(typeof full.cursor, 'string')
  assert.deepEqual(Object.keys(core.materials).sort(), ['registryVersion', 'summaries', 'writableManifests'])
  assert.deepEqual(
    core.materials.summaries.map(summary => summary.componentName),
    ['Image', 'Root'],
  )
  assert.deepEqual(
    core.materials.writableManifests.map(manifest => manifest.componentName),
    ['Image', 'Root'],
  )
  assert.ok(
    core.materials.writableManifests
      .find(manifest => manifest.componentName === 'Image')
      .fields.some(field => field.fieldId === 'shared.rect'),
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

test('Host projects current values for manifest-approved writable props without exposing unrelated props', async t => {
  const { rpc } = await createHarness(t, { includeDataNodes: true })
  const full = await rpc.call('observe', observeRequest())
  const nodes = full.projection['dashboard.core'].nodes
  const serialized = JSON.stringify(full)

  assert.deepEqual(JSON.parse(JSON.stringify(nodes['text-1'].writableValues)), {
    'props.text': 'Fallback',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(nodes['bar-1'].writableValues)), {
    'props.data': [],
  })
  assert.deepEqual(JSON.parse(JSON.stringify(nodes['line-1'].writableValues)), {
    'props.data': [],
  })
  assert.equal(Object.hasOwn(nodes['image-1'], 'writableValues'), false)
  assert.doesNotMatch(serialized, /credential-must-not-cross|api-key-must-not-cross|source-must-not-cross/u)
})

test('Host records safe snapshot, call-boundary, and receipt recovery telemetry from real seams', async t => {
  const telemetry = []
  const { host } = await createHarness(t, { telemetry: { record: event => telemetry.push(structuredClone(event)) } })
  const full = await host.observe(observeRequest())
  const result = await host.invoke(
    semanticCall({
      arguments: { nodeIds: ['image-1'] },
      callId: 'telemetry-inspect-1',
      capability: 'screen.inspect',
      expectedRevision: full.revision,
    }),
    invocationContext(),
  )
  assert.equal(result.status, 'applied')
  assert.equal(await host.queryReceipt(receiptQuery('telemetry-missing-1')), null)

  assert.deepEqual(
    telemetry.map(event => event.eventType),
    ['dashboard.snapshot.captured', 'dashboard.call.observed', 'dashboard.receipt.recovery'],
  )
  assert.deepEqual(telemetry[0], {
    schemaVersion: 1,
    eventType: 'dashboard.snapshot.captured',
    timestampMs: 1_700_000_000_000,
    durationMs: 0,
    sessionId: authority.sessionId,
    taskId: authority.taskId,
    snapshotMode: 'full',
    projectRevision: full.revision,
    byteCount: telemetry[0].byteCount,
  })
  assert.ok(telemetry[0].byteCount > 0)
  assert.deepEqual(telemetry[1], {
    schemaVersion: 1,
    eventType: 'dashboard.call.observed',
    timestampMs: 1_700_000_000_000,
    sessionId: authority.sessionId,
    taskId: authority.taskId,
    stepId: 'step-1',
    callId: 'telemetry-inspect-1',
    projectRevision: full.revision,
  })
  assert.deepEqual(telemetry[2], {
    schemaVersion: 1,
    eventType: 'dashboard.receipt.recovery',
    timestampMs: 1_700_000_000_000,
    durationMs: 0,
    sessionId: authority.sessionId,
    taskId: authority.taskId,
    callId: 'telemetry-missing-1',
    receiptClassification: 'missing',
    status: 'missing',
  })
  assert.doesNotMatch(
    JSON.stringify(telemetry),
    /credential-must-not-cross|api-key-must-not-cross|source-must-not-cross/u,
  )
})

test('Host without telemetry has no telemetry-correlation dependency', async t => {
  const { host } = await createHarness(t, { omitTelemetryChangeSetId: true })
  const full = await host.observe(observeRequest())
  const result = await host.invoke(
    semanticCall({
      arguments: { nodeIds: ['image-1'] },
      callId: 'no-telemetry-inspect-1',
      capability: 'screen.inspect',
      expectedRevision: full.revision,
    }),
    invocationContext(),
  )
  assert.equal(result.status, 'applied')
})

test('Host telemetry clock and rejected sink failures remain passive', async t => {
  let sinkCalls = 0
  const { host } = await createHarness(t, {
    telemetry: {
      record: () => {
        sinkCalls += 1
        return Promise.reject(new Error('private Host telemetry failure'))
      },
    },
    telemetryNow: () => {
      throw new Error('private Host telemetry clock failure')
    },
  })
  const full = await host.observe(observeRequest())
  const result = await host.invoke(
    semanticCall({
      arguments: { nodeIds: ['image-1'] },
      callId: 'passive-telemetry-inspect-1',
      capability: 'screen.inspect',
      expectedRevision: full.revision,
    }),
    invocationContext(),
  )
  assert.equal(result.status, 'applied')
  assert.equal(sinkCalls, 0)
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

test('Host invocation waits behind GC exclusive ownership and resumes with one shared lease', async t => {
  const gate = createDashboardMutationQuiescenceGate()
  t.after(() => gate.dispose())
  const phases = []
  const dataService = {
    bind: async () => assert.fail('unexpected bind'),
    inspect: async () => assert.fail('unexpected inspect'),
    preview: async () => assert.fail('unexpected preview'),
    upsert: async call => {
      phases.push(`service:${call.callId}`)
      return { schemaVersion: 1, callId: call.callId, status: 'applied' }
    },
  }
  const invocationActivity = {
    begin(input) {
      phases.push(`activity-start:${input.callId}`)
      return () => phases.push(`activity-finish:${input.callId}`)
    },
  }
  const { host } = await createHarness(t, { dataService, invocationActivity, mutationGate: gate })
  const full = await host.observe(observeRequest())
  const exclusive = gate.tryAcquireExclusive()
  assert.ok(exclusive)
  let settled = false
  const invocation = host
    .invoke(
      semanticCall({
        arguments: { schemaVersion: 1, source: { sourceId: 'source-gated' } },
        callId: 'data-upsert-gated',
        capability: 'data.upsert',
        expectedRevision: full.revision,
      }),
      invocationContext(),
    )
    .then(result => {
      settled = true
      return result
    })

  assert.equal(gate.getSnapshot().waitingSharedCount, 1)
  await Promise.resolve()
  assert.equal(settled, false)
  assert.deepEqual(phases, [])
  assert.equal(exclusive.release(), true)
  assert.equal(gate.getSnapshot().sharedCount, 1, 'shared ownership is reserved before Host resumes')
  const result = await invocation
  assert.equal(result.status, 'applied')
  assert.deepEqual(phases, [
    'activity-start:data-upsert-gated',
    'service:data-upsert-gated',
    'activity-finish:data-upsert-gated',
  ])
  assert.equal(gate.getSnapshot().sharedCount, 0)
})

test('Host keeps semantic material admission and its Core effect under one existing shared lease', async t => {
  const gate = createDashboardMutationQuiescenceGate()
  t.after(() => gate.dispose())
  const events = []
  let coreMutationCalls = 0
  const admitMaterialRefsUnderSharedMutation = async input => {
    events.push(['admit', structuredClone(input)])
    assert.equal(gate.getSnapshot().sharedCount, 1, 'Host must already own the one shared mutation lease')
  }
  const promotionService = {
    async promoteLocal(call) {
      events.push(['semantic', call.callId])
      await admitMaterialRefsUnderSharedMutation({
        schemaVersion: 1,
        projectId: call.projectId,
        materialRefs: [
          {
            materialId: 'material-hosted-local',
            materialVersion: '1.0.0',
            buildIntegrity: `sha256:${'b'.repeat(64)}`,
          },
        ],
        unresolvedPromotionIds: [`sha256:${'c'.repeat(64)}`],
        reason: 'promotion-activation',
      })
      events.push(['core', call.callId])
      assert.equal(gate.getSnapshot().sharedCount, 1, 'Host must already own the one shared mutation lease')
      coreMutationCalls += 1
      return { schemaVersion: 1, callId: call.callId, status: 'applied', revision: 'promotion-revision-1' }
    },
    async queryReceipt() {
      return null
    },
    async resumePending() {
      return { schemaVersion: 1, results: [] }
    },
  }
  const { host } = await createHarness(t, {
    admitMaterialRefsUnderSharedMutation,
    mutationGate: gate,
    promotionAvailability: async () => ({ available: true }),
    promotionService,
  })
  const result = await host.invoke(
    semanticCall({
      arguments: { schemaVersion: 1, nodeId: 'generated-local-1' },
      callId: 'promotion-admit-hosted-local',
      capability: 'artifact.promoteLocal',
      expectedRevision: 'promotion-base-revision',
    }),
    invocationContext(),
  )

  assert.equal(result.status, 'applied', JSON.stringify(result))
  assert.deepEqual(
    events.map(event => event[0]),
    ['semantic', 'admit', 'core'],
  )
  assert.equal(coreMutationCalls, 1)
  assert.equal(gate.getSnapshot().sharedCount, 0)
})

test('Host admission rejection reaches no semantic Core effect and releases its shared lease', async t => {
  const gate = createDashboardMutationQuiescenceGate()
  t.after(() => gate.dispose())
  const events = []
  let coreMutationCalls = 0
  const rejection = new Error('durable admission rejected')
  const admitMaterialRefsUnderSharedMutation = async () => {
    events.push('admit')
    assert.equal(gate.getSnapshot().sharedCount, 1)
    throw rejection
  }
  const promotionService = {
    async promoteLocal(call) {
      events.push('semantic')
      try {
        await admitMaterialRefsUnderSharedMutation()
      } catch {
        return {
          schemaVersion: 1,
          callId: call.callId,
          status: 'not-applied',
          revision: call.expectedRevision,
          failure: {
            code: 'MATERIAL_ADMISSION_FAILED',
            message: 'Material admission failed',
            retryable: false,
            details: { stage: 'material-admission' },
          },
        }
      }
      coreMutationCalls += 1
      assert.fail('Core must remain behind material admission')
    },
    async queryReceipt() {
      return null
    },
    async resumePending() {
      return { schemaVersion: 1, results: [] }
    },
  }
  const { host } = await createHarness(t, {
    admitMaterialRefsUnderSharedMutation,
    mutationGate: gate,
    promotionAvailability: async () => ({ available: true }),
    promotionService,
  })

  const result = await host.invoke(
    semanticCall({
      arguments: { schemaVersion: 1, nodeId: 'generated-local-1' },
      callId: 'promotion-admission-rejected',
      capability: 'artifact.promoteLocal',
      expectedRevision: 'promotion-base-revision',
    }),
    invocationContext(),
  )

  assert.equal(result.status, 'not-applied', JSON.stringify(result))
  assert.equal(result.failure.code, 'MATERIAL_ADMISSION_FAILED')
  assert.deepEqual(events, ['semantic', 'admit'])
  assert.equal(coreMutationCalls, 0)
  assert.equal(gate.getSnapshot().sharedCount, 0)
})

test('disposing the gate during an exclusive sweep keeps a queued Host invocation closed until settle', async t => {
  const gate = createDashboardMutationQuiescenceGate()
  let serviceCalls = 0
  let activityCalls = 0
  const dataService = {
    bind: async () => assert.fail('unexpected bind'),
    inspect: async () => assert.fail('unexpected inspect'),
    preview: async () => assert.fail('unexpected preview'),
    upsert: async call => {
      serviceCalls += 1
      return { schemaVersion: 1, callId: call.callId, status: 'applied' }
    },
  }
  const invocationActivity = {
    begin() {
      activityCalls += 1
      return () => undefined
    },
  }
  const { host } = await createHarness(t, { dataService, invocationActivity, mutationGate: gate })
  const exclusiveSweep = gate.tryAcquireExclusive()
  assert.ok(exclusiveSweep)
  let settled = false
  const invocation = host
    .invoke(
      semanticCall({
        arguments: { schemaVersion: 1, source: { sourceId: 'source-disposed' } },
        callId: 'data-upsert-disposed-gate',
        capability: 'data.upsert',
        expectedRevision: 'revision-not-read-before-gate',
      }),
      invocationContext(),
    )
    .then(result => {
      settled = true
      return result
    })
  await eventually(() => gate.getSnapshot().waitingSharedCount === 1)
  gate.dispose()
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(serviceCalls, 0)
  assert.equal(activityCalls, 0)
  assert.equal(gate.getSnapshot().exclusiveActive, true)

  exclusiveSweep.release()
  const result = await invocation
  assert.equal(result.status, 'rejected')
  assert.equal(serviceCalls, 0)
  assert.equal(activityCalls, 0)
  assert.deepEqual(gate.getSnapshot(), {
    schemaVersion: 1,
    disposed: true,
    exclusiveActive: false,
    inputBlocked: false,
    sharedCount: 0,
    waitingSharedCount: 0,
  })
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
