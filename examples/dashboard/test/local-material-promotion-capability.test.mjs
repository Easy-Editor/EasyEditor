import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LOCAL_MATERIAL_PROMOTION_FAILURE_CODE,
  createDashboardLocalMaterialPromotionCapabilityService,
  createDashboardLocalMaterialPromotionCoreAdapter,
} from '../src/editor/agent/capabilities/promotion/index.mjs'
import { classifyReceiptRecovery } from '../src/editor/agent/persistence/receipt-ledger.mjs'
import { hashCanonicalJson } from '../src/lib/storage/canonical-json.mjs'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'
import { DASHBOARD_STORAGE_STORE_NAMES } from '../src/lib/storage/schema.mjs'

const coreUrl = new URL('../../../packages/core/dist/instance.js', import.meta.url)

const authority = Object.freeze({
  projectId: 'project-promotion',
  branchId: 'main',
  sessionId: 'session-1',
  taskId: 'task-1',
})

const sha256 = async value => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `sha256:${Buffer.from(digest).toString('hex')}`
}

const sha256Sri = async bytes => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `sha256-${Buffer.from(digest).toString('base64')}`
}

const sourceRevision = (overrides = {}) => ({
  artifactId: 'artifact-kpi',
  sourceRevision: 'source-revision-7',
  logicalComponentId: 'logical-kpi',
  sourceIntegrity: `sha256:${'a'.repeat(64)}`,
  ...overrides,
})

const onlineRef = (overrides = {}) => ({
  ...sourceRevision(),
  target: { kind: 'online' },
  ...overrides,
})

const localRef = (overrides = {}) => ({
  ...sourceRevision(),
  target: {
    kind: 'local-material',
    materialId: 'material-kpi',
    materialVersion: '1.0.0',
    buildIntegrity: `sha256:${'b'.repeat(64)}`,
  },
  rollbackTo: sourceRevision(),
  ...overrides,
})

const createPromotionCall = (overrides = {}) => ({
  schemaVersion: 1,
  ...authority,
  stepId: 'step-promote-1',
  callId: 'promote-local-1',
  capability: 'artifact.promoteLocal',
  expectedRevision: 'host-revision-0',
  arguments: {
    schemaVersion: 1,
    nodeId: 'generated-kpi',
  },
  ...overrides,
})

const createArtifact = async () => {
  const source = `export default {
  mount(root) { root.textContent = 'durable KPI' },
  update() {},
  destroy(root) { root.replaceChildren() },
}`
  return {
    schemaVersion: 1,
    projectId: authority.projectId,
    ...sourceRevision({ sourceIntegrity: await sha256(source) }),
    source,
    css: ':host { display: block; }',
    safeManifest: { schemaVersion: 1, title: 'Durable KPI' },
    lockedDependencies: [],
    dependencyLockDigest: await hashCanonicalJson([]),
    diagnostics: [],
    provenance: { actor: 'agent-test' },
    createdAt: 100,
    supersedes: null,
  }
}

const createNearLimitArtifact = async () => {
  const artifact = await createArtifact()
  const dependencyBytes = new Uint8Array(1_350_000).fill(97)
  const dependency = {
    package: 'large-regression-fixture',
    range: '^1.0.0',
    exactVersion: '1.0.0',
    finalUrl: 'https://cdn.example.test/large-regression-fixture.mjs',
    integrity: await sha256Sri(dependencyBytes),
    cached: true,
    module: {
      format: 'bundled-esm',
      contentType: 'text/javascript',
      encoding: 'base64',
      byteLength: dependencyBytes.byteLength,
      bytes: Buffer.from(dependencyBytes).toString('base64'),
    },
  }
  return {
    ...artifact,
    lockedDependencies: [dependency],
    dependencyLockDigest: await hashCanonicalJson([dependency]),
  }
}

const serverPromotion = (request, artifact) => ({
  schemaVersion: 1,
  status: 'active',
  promotionId: request.promotionId,
  materialId: 'material-kpi',
  materialVersion: '1.0.0',
  buildIntegrity: `sha256:${'b'.repeat(64)}`,
  rollbackTo: {
    artifactId: artifact.artifactId,
    sourceRevision: artifact.sourceRevision,
    logicalComponentId: artifact.logicalComponentId,
    sourceIntegrity: artifact.sourceIntegrity,
  },
})

const createCoreAdapterHarness = async t => {
  const { createEngine } = await import(coreUrl.href)
  const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  await engine.init()
  engine.materials.createComponentMeta({
    componentName: 'Root',
    configure: { component: { isContainer: true } },
  })
  engine.materials.createComponentMeta({ componentName: 'GeneratedMaterialHost' })
  engine.loadProject(
    {
      id: authority.projectId,
      version: '0.0.1',
      componentsMap: [],
      componentsTree: [
        {
          docId: 'document-1',
          fileName: 'dashboard',
          id: 'root-1',
          componentName: 'Root',
          children: [
            {
              id: 'fixed-before',
              componentName: 'GeneratedMaterialHost',
              $agent: { schemaVersion: 1, artifactRef: onlineRef() },
            },
            {
              id: 'generated-kpi',
              componentName: 'GeneratedMaterialHost',
              props: {
                title: 'City KPI',
                data: [{ name: 'online', value: 7 }],
              },
              $dashboard: { rect: { x: 40, y: 60, width: 320, height: 120 }, locked: true },
              bindings: {
                data: { sourceId: 'data-source-1', path: '$.records' },
              },
              $agent: { schemaVersion: 1, artifactRef: onlineRef() },
            },
            {
              id: 'fixed-after',
              componentName: 'GeneratedMaterialHost',
              $agent: { schemaVersion: 1, artifactRef: onlineRef() },
            },
          ],
        },
      ],
    },
    true,
  )

  const commands = []
  const mutationCalls = []
  const transactionEngine = {
    project: engine.project,
    materials: engine.materials,
    transactions: {
      runOnDocument(document, inputCommands, options) {
        commands.push(structuredClone(inputCommands))
        return engine.transactions.runOnDocument(document, inputCommands, options)
      },
    },
  }
  const adapter = createDashboardLocalMaterialPromotionCoreAdapter({
    engine: transactionEngine,
    projectId: authority.projectId,
    branchId: authority.branchId,
    runAgentMutation(callId, operation) {
      mutationCalls.push(callId)
      return operation()
    },
  })
  t.after(() => engine.destroy())
  return { adapter, commands, engine, mutationCalls }
}

test('promotion Core adapter uses one updateProps and preserves node identity, structure, layout, props, and bindings', async t => {
  const { adapter, commands, engine, mutationCalls } = await createCoreAdapterHarness(t)
  const document = engine.project.currentDocument
  const node = document.getNode('generated-kpi')
  const before = structuredClone(node.exportRaw())
  const beforeParent = node.parent.id
  const beforeIndex = node.index
  const capture = await adapter.captureProject()
  const prepared = await adapter.prepareSwitch({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'promote-local-1',
    expectedRevision: capture.revision,
    nodeId: node.id,
  })

  assert.deepEqual(prepared.previousArtifactRef, onlineRef())
  const switched = await adapter.switchRef({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'promote-local-1',
    documentId: prepared.documentId,
    nodeId: prepared.nodeId,
    expectedMutationVersion: prepared.baseMutationVersion,
    previousArtifactRef: prepared.previousArtifactRef,
    artifactRef: localRef(),
  })

  const after = document.getNode('generated-kpi')
  const raw = after.exportRaw()
  assert.equal(switched.componentName, 'GeneratedMaterialHost')
  assert.deepEqual(mutationCalls, ['promote-local-1'])
  assert.equal(commands.length, 1)
  assert.equal(commands[0].length, 1)
  assert.equal(commands[0][0].type, 'updateProps')
  assert.equal(commands[0][0].nodeId, 'generated-kpi')
  assert.deepEqual(commands[0][0].extras, { $agent: { schemaVersion: 1, artifactRef: localRef() } })
  assert.equal(Object.hasOwn(commands[0][0], 'props'), false)

  assert.equal(after.id, 'generated-kpi')
  assert.equal(after.componentName, 'GeneratedMaterialHost')
  assert.equal(after.parent.id, beforeParent)
  assert.equal(after.index, beforeIndex)
  assert.deepEqual(raw.props, before.props)
  assert.deepEqual(raw.$dashboard, before.$dashboard)
  assert.deepEqual(raw.bindings, before.bindings)
  assert.deepEqual(raw.$agent, { schemaVersion: 1, artifactRef: localRef() })
  assert.deepEqual(
    document.root.childrenNodes.map(child => child.id),
    ['fixed-before', 'generated-kpi', 'fixed-after'],
  )

  const restored = await adapter.restoreOnline({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'restore-online-1',
    documentId: prepared.documentId,
    nodeId: prepared.nodeId,
    expectedMutationVersion: document.mutationVersion,
    previousArtifactRef: localRef(),
    artifactRef: onlineRef(),
  })
  assert.equal(restored.componentName, 'GeneratedMaterialHost')
  assert.equal(commands.length, 2)
  assert.equal(commands[1].length, 1)
  assert.equal(commands[1][0].type, 'updateProps')
  assert.deepEqual(document.getNode('generated-kpi').exportRaw().$agent.artifactRef, onlineRef())
})

const createServiceHarness = async ({
  artifactOverride = null,
  coreFailure = null,
  coreResultMutator = null,
  durableFailure = null,
  promoteAckLoss = false,
  queryPromotionFailure = null,
  queryPromotionResult = undefined,
} = {}) => {
  const artifact = artifactOverride ?? (await createArtifact())
  const batches = []
  const clientCalls = []
  const coreCalls = []
  const queryCalls = []
  const lineage = new Map()
  const promotionJournals = new Map()
  let currentRef = {
    ...onlineRef(),
    sourceIntegrity: artifact.sourceIntegrity,
  }
  let draftGeneration = 0

  const journalKey = value => `${value.projectId}:${value.branchId}:${value.sessionId}:${value.callId}`
  const persistence = {
    async readArtifact(request) {
      assert.deepEqual(request, {
        schemaVersion: 1,
        projectId: authority.projectId,
        artifactId: artifact.artifactId,
        sourceRevision: artifact.sourceRevision,
      })
      return structuredClone(artifact)
    },
    async recoverDurableAgentReceipt({ callId }) {
      const evidence = lineage.get(callId)
      return evidence ? classifyReceiptRecovery(evidence) : { classification: 'missing' }
    },
    async readPromotionJournal(request) {
      return structuredClone(promotionJournals.get(journalKey(request)) ?? null)
    },
    async listPromotionJournals(request) {
      return [...promotionJournals.values()]
        .filter(
          journal =>
            journal.projectId === request.projectId &&
            journal.branchId === request.branchId &&
            journal.sessionId === request.sessionId,
        )
        .map(value => structuredClone(value))
    },
    async writePromotionJournal(journal) {
      assert.equal(journal.kind, 'local-material-promotion')
      promotionJournals.set(journalKey(journal), structuredClone(journal))
      return structuredClone(journal)
    },
    async runDurableAgentWrite(operation) {
      const draft = {
        projectId: authority.projectId,
        branchId: authority.branchId,
        draftGeneration,
        activeDocument: { documentId: 'document-1', fileName: 'dashboard', index: 0 },
        projectSchema: {
          componentsTree: [
            {
              id: 'root-1',
              componentName: 'Root',
              children: [
                {
                  id: 'generated-kpi',
                  componentName: 'GeneratedMaterialHost',
                  $agent: { schemaVersion: 1, artifactRef: currentRef },
                },
              ],
            },
          ],
        },
      }
      let intent = null
      return operation({
        draft,
        async recordIntent(value) {
          intent = structuredClone(value)
          lineage.set(value.callId, {
            projectId: value.projectId,
            branchId: value.branchId,
            callId: value.callId,
            receiptIntent: intent,
            receipt: null,
            applyWitness: null,
            failureWitness: null,
          })
          return value
        },
        async commitBatch(batch) {
          batches.push(structuredClone(batch))
          if (durableFailure === 'before-commit') throw new Error('durable commit failed')
          draftGeneration += 1
          lineage.set(batch.callId, {
            projectId: batch.projectId,
            branchId: batch.branchId,
            callId: batch.callId,
            receiptIntent: intent,
            receipt: structuredClone(batch.receipt),
            applyWitness: batch.receipt.status === 'applied' ? structuredClone(batch.witness) : null,
            failureWitness: batch.receipt.status === 'applied' ? null : structuredClone(batch.witness),
          })
          promotionJournals.set(journalKey({ ...authority, callId: batch.callId }), {
            schemaVersion: 1,
            ...authority,
            callId: batch.callId,
            recordId: batch.journal.recordId,
            kind: batch.journal.kind,
            value: structuredClone(batch.journal.value),
          })
          if (durableFailure === 'ack-loss') throw new Error('ACK lost after durable commit')
          return {
            schemaVersion: 1,
            status: 'committed',
            receipt: structuredClone(batch.receipt),
            draft: {
              ...draft,
              draftGeneration,
              projectSchema: structuredClone(batch.projectSchema),
            },
          }
        },
      })
    },
  }

  const core = {
    async prepareSwitch(input) {
      coreCalls.push({ method: 'prepareSwitch', input: structuredClone(input) })
      return {
        schemaVersion: 1,
        baseRevision: input.expectedRevision,
        documentId: 'document-1',
        nodeId: input.nodeId,
        baseMutationVersion: coreCalls.filter(call => call.method === 'switchRef').length,
        previousArtifactRef: structuredClone(currentRef),
      }
    },
    async switchRef(input) {
      coreCalls.push({ method: 'switchRef', input: structuredClone(input) })
      if (coreFailure) throw coreFailure
      currentRef = structuredClone(input.artifactRef)
      const result = {
        schemaVersion: 1,
        revision: 'host-revision-1',
        documentId: 'document-1',
        nodeId: input.nodeId,
        componentName: 'GeneratedMaterialHost',
        coreMutationVersion: 1,
        activeDocument: { documentId: 'document-1', fileName: 'dashboard', index: 0 },
        projectSchema: {
          componentsTree: [
            {
              id: 'root-1',
              componentName: 'Root',
              children: [
                {
                  id: input.nodeId,
                  componentName: 'GeneratedMaterialHost',
                  $agent: { schemaVersion: 1, artifactRef: currentRef },
                },
              ],
            },
          ],
        },
        affectedSlotKeys: [`${authority.projectId}/${authority.branchId}/${input.nodeId}/extras/$agent`],
      }
      return coreResultMutator ? coreResultMutator(structuredClone(result)) : result
    },
    async restoreOnline(input) {
      coreCalls.push({ method: 'restoreOnline', input: structuredClone(input) })
      currentRef = structuredClone(input.artifactRef)
      return this.captureProject()
    },
    async captureProject() {
      return {
        schemaVersion: 1,
        revision: currentRef.target.kind === 'online' ? 'host-revision-0' : 'host-revision-1',
        documentId: 'document-1',
        coreMutationVersion: coreCalls.filter(call => call.method === 'switchRef').length,
        activeDocument: { documentId: 'document-1', fileName: 'dashboard', index: 0 },
        projectSchema: {
          componentsTree: [
            {
              id: 'root-1',
              componentName: 'Root',
              children: [
                {
                  id: 'generated-kpi',
                  componentName: 'GeneratedMaterialHost',
                  $agent: { schemaVersion: 1, artifactRef: currentRef },
                },
              ],
            },
          ],
        },
      }
    },
  }

  const client = {
    async promote(request) {
      clientCalls.push(structuredClone(request))
      if (promoteAckLoss) throw new Error('promotion transport ACK was lost')
      return serverPromotion(request, artifact)
    },
    async queryPromotion({ promotionId }) {
      queryCalls.push(promotionId)
      if (queryPromotionFailure) throw queryPromotionFailure
      if (queryPromotionResult !== undefined) return structuredClone(queryPromotionResult)
      const request = clientCalls.find(call => call.promotionId === promotionId)
      return request ? serverPromotion(request, artifact) : null
    },
  }

  const service = createDashboardLocalMaterialPromotionCapabilityService({
    authority,
    core,
    persistence,
    client,
    now: () => 123,
  })

  return {
    artifact,
    batches,
    clientCalls,
    coreCalls,
    currentRef: () => structuredClone(currentRef),
    lineage,
    persistence,
    promotionJournals,
    queryCalls,
    service,
  }
}

test('promoteLocal binds the server identity to the canonical call digest and commits existing journal/root stores', async () => {
  const harness = await createServiceHarness()
  const call = createPromotionCall()
  const result = await harness.service.promoteLocal(call)

  assert.equal(result.status, 'applied')
  assert.equal(result.output.kind, 'local-material-promotion-post-images')
  assert.equal(result.output.componentName, 'GeneratedMaterialHost')
  assert.equal(result.output.nodeId, call.arguments.nodeId)
  assert.equal(result.output.artifactRef.target.kind, 'local-material')
  assert.deepEqual(
    result.output.artifactRef.rollbackTo,
    sourceRevision({ sourceIntegrity: harness.artifact.sourceIntegrity }),
  )
  assert.deepEqual(harness.currentRef(), result.output.artifactRef)

  assert.equal(harness.clientCalls.length, 1)
  const serverRequest = harness.clientCalls[0]
  assert.equal(serverRequest.projectId, authority.projectId)
  assert.equal(serverRequest.branchId, authority.branchId)
  assert.equal(serverRequest.callId, call.callId)
  assert.equal(serverRequest.callDigest, await hashCanonicalJson(call))
  assert.match(serverRequest.promotionId, /^sha256:[a-f0-9]{64}$/u)
  assert.deepEqual(serverRequest.artifact, harness.artifact)

  const batch = harness.batches.at(-1)
  const expectedMaterialRefs = [
    {
      materialId: result.output.artifactRef.target.materialId,
      materialVersion: result.output.artifactRef.target.materialVersion,
      buildIntegrity: result.output.artifactRef.target.buildIntegrity,
    },
  ]
  assert.equal(batch.journal.kind, 'local-material-promotion')
  assert.equal(batch.journal.value.stage, 'committed')
  assert.equal(batch.journal.value.promotionId, serverRequest.promotionId)
  assert.equal(batch.journal.value.callDigest, serverRequest.callDigest)
  assert.equal(batch.receiptIntent.preImages.kind, 'local-material-promotion-pre-images')
  assert.equal(batch.receiptIntent.expectedPostImages.kind, 'local-material-promotion-post-images')
  for (const artifactRoot of batch.artifactRefs) {
    assert.deepEqual(artifactRoot.materialRefs, expectedMaterialRefs)
  }
  assert.ok(
    batch.artifactRefs.some(
      root =>
        root.ownerType === 'promotion-rollback' &&
        root.ownerId === serverRequest.promotionId &&
        root.artifactId === harness.artifact.artifactId &&
        root.sourceRevision === harness.artifact.sourceRevision,
    ),
  )
  assert.ok(
    batch.artifactRefs.some(
      root =>
        root.ownerType === 'durable-registry' &&
        root.ownerId === serverRequest.promotionId &&
        root.artifactId === harness.artifact.artifactId &&
        root.sourceRevision === harness.artifact.sourceRevision,
    ),
  )
  assert.equal(DASHBOARD_STORAGE_STORE_NAMES.includes('promotionSagas'), false)
})

test('exact committed retries return byte-for-byte output while same callId with different semantics is rejected', async () => {
  const harness = await createServiceHarness()
  const call = createPromotionCall()
  const first = await harness.service.promoteLocal(call)
  const repeated = await harness.service.promoteLocal(structuredClone(call))

  assert.deepEqual(repeated, first)
  assert.equal(harness.clientCalls.length, 1)
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)

  const altered = await harness.service.promoteLocal(
    createPromotionCall({ expectedRevision: 'host-revision-attacker' }),
  )
  assert.equal(altered.status, 'rejected')
  assert.equal(altered.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.idempotencyConflict)
  assert.equal(harness.clientCalls.length, 1)
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)
})

test('durable ACK loss recovers the exact committed result without a second server or Core effect', async () => {
  const harness = await createServiceHarness({ durableFailure: 'ack-loss' })
  const call = createPromotionCall()
  const first = await harness.service.promoteLocal(call)
  assert.equal(first.status, 'indeterminate')
  assert.equal(first.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.appliedUndurable)

  const recovered = await harness.service.promoteLocal(call)
  assert.equal(recovered.status, 'applied')
  assert.equal(recovered.output.kind, 'local-material-promotion-post-images')
  assert.deepEqual(recovered.output.artifactRef, harness.currentRef())
  assert.equal(harness.clientCalls.length, 1)
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)

  const receipt = await harness.service.queryReceipt({
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: call.callId,
  })
  assert.equal(receipt.status, 'applied')
  assert.equal(receipt.callId, call.callId)
})

test('server activation followed by a rolled-back Core switch leaves the online ref active', async () => {
  const harness = await createServiceHarness({ coreFailure: new Error('Core rejected the ref switch') })
  const result = await harness.service.promoteLocal(createPromotionCall())

  assert.equal(result.status, 'not-applied')
  assert.equal(result.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.coreTransactionFailed)
  assert.equal(harness.clientCalls.length, 1, 'the durable registry was activated before the Core attempt')
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)
  assert.equal(harness.currentRef().target.kind, 'online')
  const batch = harness.batches.at(-1)
  assert.equal(
    batch.artifactRefs.some(root => root.ownerType === 'promotion-rollback'),
    false,
  )
  assert.equal(
    batch.artifactRefs.some(root => root.ownerType === 'working-draft'),
    false,
  )
  for (const artifactRoot of batch.artifactRefs) {
    assert.deepEqual(artifactRoot.materialRefs, [
      {
        materialId: 'material-kpi',
        materialVersion: '1.0.0',
        buildIntegrity: `sha256:${'b'.repeat(64)}`,
      },
    ])
  }
})

test('Core-applied/durable-failed promotion is APPLIED_UNDURABLE and resumePending never repeats switchRef', async () => {
  const harness = await createServiceHarness({ durableFailure: 'before-commit' })
  const first = await harness.service.promoteLocal(createPromotionCall())
  assert.equal(first.status, 'indeterminate')
  assert.equal(first.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.appliedUndurable)
  assert.equal(harness.currentRef().target.kind, 'local-material')
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)

  const resumed = await harness.service.resumePending()
  assert.equal(resumed.schemaVersion, 1)
  assert.equal(resumed.results.length, 1)
  assert.equal(resumed.results[0].callId, createPromotionCall().callId)
  assert.equal(resumed.results[0].status, 'indeterminate')
  assert.equal(resumed.results[0].failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.appliedUndurable)
  assert.equal(harness.clientCalls.length, 1)
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)
})

test('ambiguous promotion transport ACK loss queries the trusted server and continues exactly once', async () => {
  const harness = await createServiceHarness({ promoteAckLoss: true })
  const result = await harness.service.promoteLocal(createPromotionCall())

  assert.equal(result.status, 'applied')
  assert.equal(harness.clientCalls.length, 1)
  assert.deepEqual(harness.queryCalls, [harness.clientCalls[0].promotionId])
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)
})

test('promotion remains indeterminate when the trusted server status query throws after transport failure', async () => {
  const harness = await createServiceHarness({
    promoteAckLoss: true,
    queryPromotionFailure: new Error('promotion status query failed'),
  })
  const call = createPromotionCall()
  const result = await harness.service.promoteLocal(call)

  assert.equal(result.status, 'indeterminate')
  assert.equal(result.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateServerOutcome)
  assert.equal(result.failure.details.requiredPause, true)
  assert.equal(harness.clientCalls.length, 1)
  assert.deepEqual(harness.queryCalls, [harness.clientCalls[0].promotionId])
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 0)
  assert.equal(harness.batches.length, 0)
  assert.equal(harness.lineage.get(call.callId)?.receipt, null)
})

test('promotion remains indeterminate when the trusted server cannot find an outcome after transport failure', async () => {
  const harness = await createServiceHarness({ promoteAckLoss: true, queryPromotionResult: null })
  const call = createPromotionCall()
  const result = await harness.service.promoteLocal(call)

  assert.equal(result.status, 'indeterminate')
  assert.equal(result.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateServerOutcome)
  assert.equal(result.failure.details.requiredPause, true)
  assert.equal(harness.clientCalls.length, 1)
  assert.deepEqual(harness.queryCalls, [harness.clientCalls[0].promotionId])
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 0)
  assert.equal(harness.batches.length, 0)
  assert.equal(harness.lineage.get(call.callId)?.receipt, null)
})

test('a malformed Core post-result after mutation is APPLIED_UNDURABLE and never reported not-applied', async () => {
  const harness = await createServiceHarness({
    coreResultMutator: result => ({ ...result, componentName: 'ForgedGeneratedHost' }),
  })
  const result = await harness.service.promoteLocal(createPromotionCall())

  assert.equal(result.status, 'indeterminate')
  assert.equal(result.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.appliedUndurable)
  assert.equal(harness.currentRef().target.kind, 'local-material')
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)
})

test('promotion journals keep only frozen artifact identity even for a near-2MB artifact', async () => {
  const artifact = await createNearLimitArtifact()
  assert.ok(JSON.stringify(artifact).length > 1_750_000)
  const harness = await createServiceHarness({ artifactOverride: artifact })
  const result = await harness.service.promoteLocal(createPromotionCall())
  assert.equal(result.status, 'applied')

  const journalValue = harness.batches.at(-1).journal.value
  const serialized = JSON.stringify(journalValue)
  assert.ok(serialized.length < 20_000)
  assert.deepEqual(Object.keys(journalValue.artifactIdentity).sort(), [
    'artifactId',
    'dependencyLockDigest',
    'logicalComponentId',
    'sourceIntegrity',
    'sourceRevision',
  ])
  assert.equal(Object.hasOwn(journalValue, 'artifact'), false)
  assert.equal(serialized.includes(artifact.lockedDependencies[0].module.bytes.slice(0, 256)), false)
})

test('corrupted discriminated journals and forged stored server/output refs are never trusted', async () => {
  const outputHarness = await createServiceHarness()
  await outputHarness.service.promoteLocal(createPromotionCall())
  const outputJournal = [...outputHarness.promotionJournals.values()][0]
  outputJournal.value.output.artifactRef.target.materialVersion = '9.9.9-forged'
  const forgedOutput = await outputHarness.service.promoteLocal(createPromotionCall())
  assert.equal(forgedOutput.status, 'indeterminate')
  assert.equal(forgedOutput.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateReceipt)
  assert.equal(outputHarness.clientCalls.length, 1)
  assert.equal(outputHarness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)

  const serverHarness = await createServiceHarness()
  await serverHarness.service.promoteLocal(createPromotionCall())
  const serverJournal = [...serverHarness.promotionJournals.values()][0]
  serverJournal.value.server.rollbackTo.sourceRevision = 'forged-source-revision'
  serverJournal.value.attackerControlled = true
  const forgedServer = await serverHarness.service.promoteLocal(createPromotionCall())
  assert.equal(forgedServer.status, 'indeterminate')
  assert.equal(forgedServer.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateReceipt)
  assert.equal(serverHarness.clientCalls.length, 1)
  assert.equal(serverHarness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)
})

test('receipt recovery rejects forged prepared hashes and promotion-specific image kinds', async () => {
  const harness = await createServiceHarness()
  await harness.service.promoteLocal(createPromotionCall())
  const evidence = harness.lineage.get(createPromotionCall().callId)
  evidence.receiptIntent.preparedHash = `sha256:${'f'.repeat(64)}`
  evidence.receiptIntent.preImages.capability = 'artifact.createOnline'
  evidence.receiptIntent.expectedPostImages.kind = 'online-artifact-post-images'

  const recovered = await harness.service.promoteLocal(createPromotionCall())
  assert.equal(recovered.status, 'indeterminate')
  assert.equal(recovered.failure.code, LOCAL_MATERIAL_PROMOTION_FAILURE_CODE.indeterminateReceipt)
  assert.equal(harness.clientCalls.length, 1)
  assert.equal(harness.coreCalls.filter(entry => entry.method === 'switchRef').length, 1)
})

test('promotion rollback and durable-registry roots independently retain the source until both are released', async () => {
  const artifact = await createArtifact()
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  await coordinator.createArtifact(artifact)
  const root = (ownerType, ownerId) => ({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    ownerType,
    ownerId,
    artifactId: artifact.artifactId,
    sourceRevision: artifact.sourceRevision,
  })
  const rollbackRoot = root('promotion-rollback', 'promotion-root-lifecycle')
  const registryRoot = root('durable-registry', 'promotion-root-lifecycle')
  await coordinator.createArtifactRoot(rollbackRoot)
  await coordinator.createArtifactRoot(registryRoot)

  assert.deepEqual(
    (await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId: authority.projectId })).deletionCandidates,
    [],
  )
  await coordinator.deleteArtifactRoot(rollbackRoot)
  assert.deepEqual(
    (await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId: authority.projectId })).deletionCandidates,
    [],
  )
  await coordinator.deleteArtifactRoot(registryRoot)
  const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId: authority.projectId })
  assert.deepEqual(plan.deletionCandidates, [
    { artifactId: artifact.artifactId, sourceRevision: artifact.sourceRevision },
  ])
  assert.deepEqual((await coordinator.sweepArtifactGc(plan)).deletedArtifacts, plan.deletionCandidates)
})
