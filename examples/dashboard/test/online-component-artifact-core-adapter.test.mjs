import assert from 'node:assert/strict'
import test from 'node:test'

import { createDashboardOnlineArtifactCoreAdapter } from '../src/editor/agent/capabilities/artifact/core-adapter.mjs'
import { OnlineArtifactCoreOutcomeError } from '../src/editor/agent/capabilities/artifact/service.mjs'
import { createDashboardAgentHost } from '../src/editor/agent/host/index.mjs'

const coreUrl = new URL('../../../packages/core/dist/instance.js', import.meta.url)

const authority = Object.freeze({
  projectId: 'project-artifact-adapter',
  branchId: 'main',
  sessionId: 'session-1',
  taskId: 'task-1',
})

const artifactRef = suffix => ({
  artifactId: `artifact-${suffix}`,
  sourceRevision: `revision-${suffix}`,
  logicalComponentId: 'logical-generated-card',
  sourceIntegrity: `sha256:${suffix.repeat(64).slice(0, 64)}`,
  target: { kind: 'online' },
})

const createHarness = async (t, transactionMode = 'normal') => {
  const { TransactionCommittedError, TransactionRollbackIncompleteError, createEngine } = await import(coreUrl.href)
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
          children: [],
        },
      ],
    },
    true,
  )
  const mutationCalls = []
  let executions = 0
  const projectFacade = {
    get currentDocument() {
      return engine.project.currentDocument
    },
    get documents() {
      return engine.project.documents
    },
    export() {
      if (transactionMode === 'capture-failure' && executions > 0) throw new Error('capture failed')
      return engine.project.export()
    },
  }
  const transactionEngine = {
    project: projectFacade,
    materials: engine.materials,
    transactions: {
      runOnDocument(...args) {
        executions += 1
        if (transactionMode === 'rollback-incomplete') {
          throw new TransactionRollbackIncompleteError(new Error('apply failed'), [new Error('rollback failed')])
        }
        const result = engine.transactions.runOnDocument(...args)
        if (transactionMode === 'committed-error') {
          throw new TransactionCommittedError([new Error('observer failed')], result)
        }
        return result
      },
    },
  }
  const adapter = createDashboardOnlineArtifactCoreAdapter({
    engine: transactionEngine,
    projectId: authority.projectId,
    branchId: authority.branchId,
    runAgentMutation(callId, operation) {
      mutationCalls.push(callId)
      return operation()
    },
    isTransactionCommittedError: error => error instanceof TransactionCommittedError,
    isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
  })
  t.after(() => engine.destroy())
  return { adapter, engine, executions: () => executions, mutationCalls }
}

test('Core adapter creates and revises canonical GeneratedMaterialHost with exact Host revision and provenance aliases', async t => {
  const { adapter, engine, mutationCalls } = await createHarness(t)
  const host = createDashboardAgentHost({
    enabled: true,
    authority,
    engine,
    persistence: {
      recoverDurableAgentReceipt: async () => ({ classification: 'missing' }),
      runDurableAgentWrite: async operation => operation({}),
    },
    compensationService: { compensate: async () => null, query: async () => null },
    activityLease: { generation: 0, isActive: () => false, waitUntilIdle: async () => ({ generation: 0 }) },
    isTransactionCommittedError: () => false,
    isTransactionRollbackIncompleteError: () => false,
  })
  t.after(() => host.dispose())

  const initial = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
  const capture = await adapter.captureProject()
  assert.equal(capture.revision, initial.revision, 'adapter revision must be the exact Host full-snapshot revision')

  const prepareCreate = await adapter.prepareCreate({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'create-1',
    expectedRevision: initial.revision,
    documentId: 'document-1',
    parentId: 'root-1',
    position: { place: 'last' },
    props: { title: 'Generated KPI' },
    rect: { x: 10, y: 20, width: 300, height: 120 },
    nodeId: 'generated-1',
  })
  const created = await adapter.createOnline({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'create-1',
    documentId: prepareCreate.documentId,
    nodeId: prepareCreate.nodeId,
    parentId: 'root-1',
    position: { place: 'last' },
    props: { title: 'Generated KPI' },
    rect: { x: 10, y: 20, width: 300, height: 120 },
    expectedMutationVersion: prepareCreate.baseMutationVersion,
    artifactRef: artifactRef('a'),
  })
  const afterCreate = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
  assert.equal(created.revision, afterCreate.revision)
  assert.notEqual(created.revision, initial.revision)
  assert.deepEqual(mutationCalls, ['create-1'])
  const createdRaw = engine.project.currentDocument.getNode('generated-1').exportRaw()
  assert.deepEqual(createdRaw.$agent, { schemaVersion: 1, artifactRef: artifactRef('a') })
  assert.equal(Object.hasOwn(createdRaw, 'artifactRef'), false)
  assert.equal(Object.hasOwn(createdRaw, 'extra'), false)
  assert.ok(created.affectedSlotKeys.includes(`${authority.projectId}/${authority.branchId}/generated-1/extras`))
  assert.ok(created.affectedSlotKeys.includes(`${authority.projectId}/${authority.branchId}/generated-1/extras/$agent`))
  assert.ok(
    created.affectedSlotKeys.includes(`${authority.projectId}/${authority.branchId}/parent/root-1/children-order`),
  )

  engine.transactions.runOnDocument(engine.project.currentDocument, [
    {
      type: 'updateProps',
      nodeId: 'generated-1',
      extras: { artifactRef: artifactRef('a'), extra: { artifactRef: artifactRef('a'), retained: true } },
    },
  ])
  const reviseBase = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
  const prepareRevise = await adapter.prepareRevise({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'revise-1',
    expectedRevision: reviseBase.revision,
    nodeId: 'generated-1',
  })
  const revised = await adapter.reviseOnline({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'revise-1',
    documentId: prepareRevise.documentId,
    nodeId: prepareRevise.nodeId,
    expectedMutationVersion: prepareRevise.baseMutationVersion,
    previousArtifactRef: prepareRevise.previousArtifactRef,
    artifactRef: artifactRef('b'),
  })
  const revisedRaw = engine.project.currentDocument.getNode('generated-1').exportRaw()
  assert.deepEqual(revisedRaw.$agent, { schemaVersion: 1, artifactRef: artifactRef('b') })
  assert.equal(Object.hasOwn(revisedRaw, 'artifactRef'), false)
  assert.deepEqual(revisedRaw.extra, { retained: true })
  assert.deepEqual(mutationCalls, ['create-1', 'revise-1'])
  assert.ok(revised.affectedSlotKeys.includes(`${authority.projectId}/${authority.branchId}/generated-1/extras`))
  assert.ok(
    revised.affectedSlotKeys.includes(
      `${authority.projectId}/${authority.branchId}/generated-1/extras/extra/artifactRef`,
    ),
  )
})

test('Core adapter treats observer TransactionCommittedError as committed and captures canonical post-state once', async t => {
  const { adapter, engine, executions } = await createHarness(t, 'committed-error')
  const base = await adapter.captureProject()
  const prepare = await adapter.prepareCreate({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'observer-commit',
    expectedRevision: base.revision,
    documentId: 'document-1',
    parentId: 'root-1',
    position: { place: 'last' },
    nodeId: 'generated-observer',
  })
  const result = await adapter.createOnline({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'observer-commit',
    documentId: prepare.documentId,
    nodeId: prepare.nodeId,
    parentId: 'root-1',
    position: { place: 'last' },
    expectedMutationVersion: prepare.baseMutationVersion,
    artifactRef: artifactRef('c'),
  })
  assert.equal(executions(), 1)
  assert.equal(result.nodeId, 'generated-observer')
  assert.deepEqual(
    engine.project.currentDocument.root.childrenNodes.map(node => node.id),
    ['generated-observer'],
  )
})

test('Core adapter preserves rollback-incomplete as indeterminate and never reports a canonical post-state', async t => {
  const { adapter } = await createHarness(t, 'rollback-incomplete')
  const base = await adapter.captureProject()
  const prepare = await adapter.prepareCreate({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'rollback-incomplete',
    expectedRevision: base.revision,
    documentId: 'document-1',
    parentId: 'root-1',
    position: { place: 'last' },
    nodeId: 'generated-indeterminate',
  })
  await assert.rejects(
    adapter.createOnline({
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      callId: 'rollback-incomplete',
      documentId: prepare.documentId,
      nodeId: prepare.nodeId,
      parentId: 'root-1',
      position: { place: 'last' },
      expectedMutationVersion: prepare.baseMutationVersion,
      artifactRef: artifactRef('d'),
    }),
    error => error instanceof OnlineArtifactCoreOutcomeError && error.outcome === 'indeterminate',
  )
})

test('Core adapter classifies post-commit capture failures as applied instead of a rolled-back transaction', async t => {
  const { adapter } = await createHarness(t, 'capture-failure')
  const prepare = await adapter.prepareCreate({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'capture-failure',
    expectedRevision: (await adapter.captureProject()).revision,
    documentId: 'document-1',
    parentId: 'root-1',
    position: { place: 'last' },
    nodeId: 'generated-capture-failure',
  })
  await assert.rejects(
    adapter.createOnline({
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      callId: 'capture-failure',
      documentId: prepare.documentId,
      nodeId: prepare.nodeId,
      parentId: 'root-1',
      position: { place: 'last' },
      expectedMutationVersion: prepare.baseMutationVersion,
      artifactRef: artifactRef('e'),
    }),
    error => error instanceof OnlineArtifactCoreOutcomeError && error.outcome === 'applied',
  )
})
