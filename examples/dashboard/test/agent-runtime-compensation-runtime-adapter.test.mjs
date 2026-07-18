import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { loadCore } from '../../../packages/core/test/helpers/kernel.mjs'
import {
  compileScreenChangeSet,
  createScreenPreparedHashInput,
  createScreenTransactionFingerprintInput,
} from '../src/editor/agent/capabilities/screen/index.mjs'
import {
  compensationTargetClaimRecordId,
  createDashboardTaskCompensationService,
} from '../src/editor/agent/compensation/index.mjs'
import {
  createChildrenOrderSlotKey,
  createFieldSlotAliases,
  createFieldSlotKey,
  createMutationProvenanceBatch,
  createNodeParentSlotKey,
} from '../src/editor/agent/persistence/provenance.mjs'
import {
  createApplyWitness,
  createFailureWitness,
  createReceiptIntent,
  createToolReceipt,
  createToolReceiptWitness,
} from '../src/editor/agent/persistence/receipt-ledger.mjs'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'

const authority = Object.freeze({ projectId: 'project-a', branchId: 'main', sessionId: 'session-a' })
const REGISTRY_VERSION = 7

const hashCanonicalJson = async value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`

const manifest = (componentName, fields = []) => ({
  schemaVersion: 1,
  materialRegistryVersion: REGISTRY_VERSION,
  componentName,
  title: componentName,
  fields,
  diagnostics: [],
  readiness: { status: 'ready', missingFieldIds: [], unsupportedFieldIds: [] },
})

const manifests = () => [
  manifest('Root'),
  manifest('Text', [
    {
      fieldId: 'props.text',
      access: 'read-write',
      readPath: ['props', 'text'],
      writeTargets: [{ path: ['props', 'text'] }],
      unsetTargets: [{ path: ['props', 'text'] }],
      verifyPaths: [['props', 'text']],
    },
    {
      fieldId: 'props.style',
      access: 'read-write',
      readPath: ['props', 'style'],
      writeTargets: [{ path: ['props', 'style'] }],
      unsetTargets: [{ path: ['props', 'style'] }],
      verifyPaths: [['props', 'style']],
    },
    {
      fieldId: 'props.style.color',
      access: 'read-write',
      readPath: ['props', 'style', 'color'],
      writeTargets: [{ path: ['props', 'style', 'color'] }],
      unsetTargets: [{ path: ['props', 'style', 'color'] }],
      verifyPaths: [['props', 'style', 'color']],
    },
  ]),
]

const baseSchema = () => ({
  componentName: 'Root',
  docId: 'page-home',
  fileName: 'home',
  id: 'root',
  children: [
    { componentName: 'Text', id: 'anchor', props: { text: 'anchor' } },
    {
      componentName: 'Text',
      id: 'target',
      props: { text: 'before' },
      children: [{ componentName: 'Text', id: 'target-child', props: { text: 'nested' } }],
    },
  ],
})

const artifactSource = suffix => ({
  artifactId: `artifact-${suffix}`,
  sourceRevision: `source-${suffix}`,
  logicalComponentId: `logical-${suffix}`,
  sourceIntegrity: `sha256:${suffix.repeat(64)}`,
})

const localArtifactRef = (materialId, suffix) => ({
  ...artifactSource(suffix),
  target: {
    kind: 'local-material',
    materialId,
    materialVersion: '1.0.0',
    buildIntegrity: `sha256:${suffix.repeat(64)}`,
  },
  rollbackTo: artifactSource(suffix),
})

const onlineArtifactRef = suffix => ({ ...artifactSource(suffix), target: { kind: 'online' } })

const materialRestoreSchema = () => {
  const schema = baseSchema()
  const target = schema.children.find(node => node.id === 'target')
  const first = localArtifactRef('material-a', 'c')
  const second = localArtifactRef('material-b', 'd')
  target.$agent = { schemaVersion: 1, artifactRef: structuredClone(first) }
  target.props.artifactRef = structuredClone(second)
  target.children[0].$agent = { schemaVersion: 1, artifactRef: structuredClone(first) }
  target.children.push(
    {
      componentName: 'Text',
      id: 'target-local-second',
      props: { text: 'second' },
      $agent: { schemaVersion: 1, artifactRef: structuredClone(second) },
    },
    {
      componentName: 'Text',
      id: 'target-online',
      props: { text: 'online' },
      $agent: { schemaVersion: 1, artifactRef: onlineArtifactRef('e') },
    },
  )
  return schema
}

const moveSchema = () => ({
  componentName: 'Root',
  docId: 'page-home',
  fileName: 'home',
  id: 'root',
  children: [
    {
      componentName: 'Text',
      id: 'parent-1',
      props: { text: 'P1' },
      children: [{ componentName: 'Text', id: 'moving-node', props: { text: 'N' } }],
    },
    { componentName: 'Text', id: 'parent-2', props: { text: 'P2' } },
    { componentName: 'Text', id: 'parent-3', props: { text: 'P3' } },
  ],
})

const payloadsFor = compiled => ({
  preImages: {
    schemaVersion: 1,
    kind: 'screen-change-set-pre-images',
    documentId: compiled.documentId,
    baseMutationVersion: compiled.baseMutationVersion,
    materialRegistryVersion: compiled.materialRegistryVersion,
    manifestFingerprints: compiled.manifestFingerprints,
    insertedNodeIdentities: compiled.insertedNodeIdentities,
    operations: compiled.operations,
    commands: compiled.commands,
    images: compiled.preImages,
    inverseOperations: compiled.inverseOperations,
    affectedFieldSlots: compiled.affectedFieldSlots,
    affectedStructuralSlots: compiled.affectedStructuralSlots,
    affectedSlotKeys: compiled.affectedSlotKeys,
  },
  expectedPostImages: {
    schemaVersion: 1,
    kind: 'screen-change-set-post-images',
    documentId: compiled.documentId,
    images: compiled.expectedPostImages,
    affectedFieldSlots: compiled.affectedFieldSlots,
    affectedStructuralSlots: compiled.affectedStructuralSlots,
    affectedSlotKeys: compiled.affectedSlotKeys,
  },
})

const createHarness = async (
  t,
  {
    admitMaterialRefsUnderSharedMutation,
    forwardOperation,
    afterIntent,
    extraManifests = [],
    initialSchema = baseSchema(),
    snapshotExtra = {},
  } = {},
) => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(
    {
      id: authority.projectId,
      version: '0.0.1',
      componentsMap: [],
      componentsTree: [initialSchema],
    },
    true,
  )
  const document = engine.project.currentDocument
  const originalHandleFrozen = Object.isFrozen(document)
  const beforeSchema = structuredClone(document.exportRaw())
  const availableManifests = [...manifests(), ...extraManifests]
  const compilerManifests = availableManifests.filter(item => item.readiness.status === 'ready')
  const compiled = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'forward-1',
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: { id: document.id, mutationVersion: document.mutationVersion, schema: beforeSchema },
    manifests: compilerManifests,
    changeSet: {
      schemaVersion: 1,
      documentId: document.id,
      operations: [forwardOperation ?? { opId: 'delete-target', type: 'remove', nodeId: 'target' }],
    },
  })
  const baseRevision = `revision-${document.mutationVersion}`
  engine.transactions.runOnDocument(document, compiled.commands, {
    expectedMutationVersion: compiled.baseMutationVersion,
  })
  const forwardSchema = structuredClone(document.exportRaw())
  const payloads = payloadsFor(compiled)
  const transactionFingerprint = await hashCanonicalJson(
    createScreenTransactionFingerprintInput({
      callId: 'forward-1',
      documentId: compiled.documentId,
      baseMutationVersion: compiled.baseMutationVersion,
      materialRegistryVersion: compiled.materialRegistryVersion,
      manifestFingerprints: compiled.manifestFingerprints,
      insertedNodeIdentities: compiled.insertedNodeIdentities,
      commands: compiled.commands,
    }),
  )
  const preparedHash = await hashCanonicalJson(
    createScreenPreparedHashInput({
      projectId: authority.projectId,
      branchId: authority.branchId,
      callId: 'forward-1',
      baseRevision,
      preImages: payloads.preImages,
      expectedPostImages: payloads.expectedPostImages,
    }),
  )
  const intent = createReceiptIntent({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'forward-1',
    preparedHash,
    baseRevision,
    preImages: payloads.preImages,
    expectedPostImages: payloads.expectedPostImages,
    status: 'pending',
  })
  const originalProvenance = createMutationProvenanceBatch({
    projectId: authority.projectId,
    branchId: authority.branchId,
    draftGeneration: 1,
    slotKeys: compiled.affectedSlotKeys,
    source: 'agent',
    callId: 'forward-1',
  })
  const witness = createApplyWitness({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'forward-1',
    draftGeneration: 1,
    coreMutationVersion: document.mutationVersion,
    transactionFingerprint,
    affectedSlotTokens: originalProvenance.map(({ slotKey, token }) => ({ slotKey, token })),
  })
  const receipt = createToolReceipt({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'forward-1',
    status: 'applied',
    revision: `revision-${document.mutationVersion}`,
    witness: createToolReceiptWitness(witness),
  })

  const state = {
    activeAgentCallId: null,
    activityGeneration: 0,
    agentMutationCalls: [],
    active: false,
    coreCommands: [],
    coreRuns: 0,
    draft: {
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      draftGeneration: 1,
      activeDocument: { documentId: document.id, fileName: document.fileName, index: 0 },
      projectSchema: structuredClone(engine.project.export()),
      projectHash: `sha256:${'a'.repeat(64)}`,
      commitKind: 'agent-batch',
      updatedAt: 1,
    },
    runs: new Map(),
    claims: new Map(),
    recoveries: new Map([['forward-1', { classification: 'committed', receiptIntent: intent, receipt }]]),
    provenance: new Map(originalProvenance.map(record => [record.slotKey, record])),
    lineages: new Map([
      [
        'forward-1',
        {
          projectId: authority.projectId,
          branchId: authority.branchId,
          callId: 'forward-1',
          receiptIntent: intent,
          receipt,
          applyWitness: witness,
          failureWitness: null,
          provenance: originalProvenance,
        },
      ],
    ]),
  }
  const persistence = {
    runAgentMutation(callId, operation) {
      assert.equal(state.activeAgentCallId, null)
      state.activeAgentCallId = callId
      state.agentMutationCalls.push(callId)
      try {
        return operation()
      } finally {
        state.activeAgentCallId = null
      }
    },
    async readCompensationRun({ outerCallId }) {
      return structuredClone(state.runs.get(outerCallId) ?? null)
    },
    async readCompensationTargetClaim({ targetTaskId }) {
      return structuredClone(state.claims.get(targetTaskId) ?? null)
    },
    async commitCompensationRunState(input) {
      state.runs.set(input.outerCallId, structuredClone(input.run))
      if (input.action === 'release') state.claims.delete(input.targetTaskId)
      else {
        state.claims.set(input.targetTaskId, {
          schemaVersion: 1,
          ...authority,
          targetTaskId: input.targetTaskId,
          outerCallId: input.outerCallId,
          status: 'active',
        })
      }
      state.draft = { ...state.draft, draftGeneration: state.draft.draftGeneration + 1 }
      return { schemaVersion: 1, status: 'committed', run: structuredClone(input.run), draft: state.draft }
    },
    async recoverDurableAgentReceipt({ callId }) {
      return structuredClone(state.recoveries.get(callId) ?? { classification: 'missing' })
    },
    async runDurableAgentWrite(operation) {
      return operation({
        draft: structuredClone(state.draft),
        async recordIntent(nextIntent) {
          await afterIntent?.({ document, engine, state, intent: nextIntent })
          return structuredClone(nextIntent)
        },
        async readReceiptLineage({ callId }) {
          return structuredClone(state.lineages.get(callId))
        },
        async readMutationProvenance({ slotKeys }) {
          return {
            schemaVersion: 1,
            ...authority,
            slotKeys,
            records: slotKeys.map(slotKey => structuredClone(state.provenance.get(slotKey) ?? null)),
          }
        },
        async commitBatch(batch) {
          state.recoveries.set(batch.callId, {
            classification: batch.receipt.status === 'applied' ? 'committed' : 'failed',
            receiptIntent: structuredClone(batch.receiptIntent),
            receipt: structuredClone(batch.receipt),
          })
          state.runs.set(batch.journal.value.outerCallId, structuredClone(batch.journal.value))
          for (const recordId of batch.journalDeletes ?? []) {
            if (recordId === compensationTargetClaimRecordId(batch.journal.value.taskId)) {
              state.claims.delete(batch.journal.value.taskId)
            }
          }
          state.draft = {
            ...state.draft,
            draftGeneration: state.draft.draftGeneration + 1,
            activeDocument: structuredClone(batch.activeDocument),
            projectSchema: structuredClone(batch.projectSchema),
            updatedAt: batch.updatedAt,
          }
          return { schemaVersion: 1, status: 'committed', receipt: batch.receipt, draft: state.draft }
        },
      })
    },
  }
  const engineFacade = {
    project: engine.project,
    materials: {
      version: REGISTRY_VERSION,
      getComponentMetasMap: () => new Map(availableManifests.map(item => [item.componentName, {}])),
    },
    transactions: {
      runOnDocument(handle, commands, options) {
        assert.equal(typeof state.activeAgentCallId, 'string')
        state.coreRuns += 1
        state.coreCommands.push(structuredClone(commands))
        return engine.transactions.runOnDocument(handle, commands, options)
      },
    },
  }
  const activityLease = {
    get generation() {
      return state.activityGeneration
    },
    isActive: () => state.active,
    waitUntilIdle: async () => ({ generation: state.activityGeneration }),
  }
  const captureFullSnapshot = async () => ({
    ...snapshotExtra,
    revision: `revision-${engine.project.currentDocument.mutationVersion}`,
    providerGenerations: { 'dashboard.core': 1 },
  })
  const service = createDashboardTaskCompensationService({
    authority,
    activityLease,
    engine: engineFacade,
    persistence,
    captureFullSnapshot,
    manifestCache: {
      async get(componentName, version) {
        assert.equal(version, REGISTRY_VERSION)
        return structuredClone(availableManifests.find(item => item.componentName === componentName))
      },
    },
    hashCanonicalJson,
    now: () => 1_700_000_000_000,
    isTransactionCommittedError: () => false,
    isTransactionRollbackIncompleteError: () => false,
    ...(admitMaterialRefsUnderSharedMutation === undefined ? {} : { admitMaterialRefsUnderSharedMutation }),
  })
  const compensate = (outerCallId, callIndex = [{ callId: 'forward-1', capability: 'screen.applyChangeSet' }]) =>
    service.compensate({
      schemaVersion: 1,
      outerCallId,
      target: {
        schemaVersion: 1,
        taskId: `task-${outerCallId}`,
        sessionId: authority.sessionId,
        phase: 'COMPLETED',
        callIndexComplete: true,
        callIndex,
      },
    })
  return {
    beforeSchema,
    compensate,
    compiled,
    document,
    engine,
    forwardSchema,
    manifests: compilerManifests,
    originalHandleFrozen,
    state,
    syncDraft() {
      state.draft = { ...state.draft, projectSchema: structuredClone(engine.project.export()) }
    },
  }
}

const runSemanticChange = (harness, callId, operation) => {
  const document = harness.document
  const compiled = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId,
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: {
      id: document.id,
      mutationVersion: document.mutationVersion,
      schema: structuredClone(document.exportRaw()),
    },
    manifests: harness.manifests,
    changeSet: { schemaVersion: 1, documentId: document.id, operations: [operation] },
  })
  harness.engine.transactions.runOnDocument(document, compiled.commands, {
    expectedMutationVersion: compiled.baseMutationVersion,
  })
  return compiled
}

test('production compensation adapter executes trusted raw restore without freezing the Core handle', async t => {
  const harness = await createHarness(t)
  const receipt = await harness.compensate('restore')

  assert.equal(receipt.status, 'applied')
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
  assert.equal(harness.state.coreRuns, 1)
  assert.equal(harness.state.agentMutationCalls.length, 1)
  assert.equal(harness.state.recoveries.has(harness.state.agentMutationCalls[0]), true)
  assert.equal(Object.isFrozen(harness.document), harness.originalHandleFrozen)
  harness.engine.undo(harness.document)
  assert.deepEqual(harness.document.exportRaw(), harness.forwardSchema)
  assert.equal(harness.state.runs.get('restore').status, 'completed')
  assert.equal(harness.document.history.isUndoable(), true)
})

test('a durable failed Screen call is skipped while committed calls remain compensable', async t => {
  const harness = await createHarness(t)
  const failedCallId = 'forward-failed'
  const failedIntent = createReceiptIntent({
    ...harness.state.lineages.get('forward-1').receiptIntent,
    callId: failedCallId,
  })
  const failedWitness = createFailureWitness({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: failedCallId,
    draftGeneration: 1,
    transactionFingerprint: `sha256:${'f'.repeat(64)}`,
    receiptStatus: 'not-applied',
    failureCode: 'HUMAN_ACTIVITY',
  })
  const failedReceipt = createToolReceipt({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: failedCallId,
    status: 'not-applied',
    revision: 'revision-failed',
    witness: createToolReceiptWitness(failedWitness),
    failure: { code: 'HUMAN_ACTIVITY', message: 'human activity won the fence', retryable: true },
  })
  harness.state.recoveries.set(failedCallId, {
    classification: 'failed',
    receiptIntent: failedIntent,
    receipt: failedReceipt,
  })

  const receipt = await harness.compensate('skip-failed', [
    { callId: 'forward-1', capability: 'screen.applyChangeSet' },
    { callId: failedCallId, capability: 'screen.applyChangeSet' },
  ])

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 1)
  assert.deepEqual(harness.state.runs.get('skip-failed').originalCallIds, ['forward-1'])
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
})

test('compensation admission deduplicates restored local refs, ignores non-canonical refs, and retries before Core', async t => {
  const admissionCalls = []
  let attempts = 0
  const harness = await createHarness(t, {
    initialSchema: materialRestoreSchema(),
    admitMaterialRefsUnderSharedMutation: async input => {
      attempts += 1
      admissionCalls.push(structuredClone(input))
      assert.equal(harness.state.coreRuns, 0)
      if (attempts === 1) throw new Error('material admission unavailable')
    },
  })

  await assert.rejects(harness.compensate('material-admission'), /material admission unavailable/u)
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.state.recoveries.size, 1, 'only the original forward receipt remains')
  assert.equal(harness.state.runs.get('material-admission').status, 'running')
  assert.deepEqual(admissionCalls[0], {
    schemaVersion: 1,
    projectId: authority.projectId,
    materialRefs: [
      {
        materialId: 'material-a',
        materialVersion: '1.0.0',
        buildIntegrity: `sha256:${'c'.repeat(64)}`,
      },
      {
        materialId: 'material-b',
        materialVersion: '1.0.0',
        buildIntegrity: `sha256:${'d'.repeat(64)}`,
      },
    ],
    reason: 'screen-compensation',
  })

  const receipt = await harness.compensate('material-admission')
  assert.equal(receipt.status, 'applied')
  assert.equal(attempts, 2)
  assert.equal(harness.state.coreRuns, 1)
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
})

test('production compensation adapter recompiles and executes an ordinary field inverse', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'set-target',
      type: 'set',
      nodeId: 'target',
      fieldId: 'props.text',
      value: 'after',
    },
  })
  const receipt = await harness.compensate('field')

  assert.equal(receipt.status, 'applied')
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
  assert.equal(harness.state.coreRuns, 1)
  assert.equal(Object.isFrozen(harness.document), harness.originalHandleFrozen)
  harness.engine.undo(harness.document)
  assert.deepEqual(harness.document.exportRaw(), harness.forwardSchema)
})

test('changed-hash human attribution preserves an unrelated persisted Agent effect for compensation', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'set-target',
      type: 'set',
      nodeId: 'target',
      fieldId: 'props.text',
      value: 'after',
    },
  })
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({
    backend,
    lockManager: { request: (_name, _options, operation) => operation() },
  })
  t.after(() => coordinator.dispose())
  const originalProvenance = [...harness.state.provenance.values()]
  const seeded = await coordinator.commit({
    schemaVersion: 1,
    batchId: 'persisted-forward-agent-effect',
    projectId: authority.projectId,
    branchId: authority.branchId,
    expectedDraftGeneration: 0,
    activeDocument: harness.state.draft.activeDocument,
    projectSchema: harness.state.draft.projectSchema,
    commitKind: 'agent-batch',
    updatedAt: 1,
    operations: originalProvenance.map(value => ({ type: 'put', store: 'mutationProvenance', value })),
  })
  assert.equal(seeded.draft.draftGeneration, 1)

  runSemanticChange(harness, 'human-anchor-edit', {
    opId: 'human-anchor-edit',
    type: 'set',
    nodeId: 'anchor',
    fieldId: 'props.text',
    value: 'human-anchor',
  })
  const humanSlotKeys = createFieldSlotAliases({
    projectId: authority.projectId,
    branchId: authority.branchId,
    nodeId: 'anchor',
    root: 'props',
    path: ['text'],
  })
  const humanProvenance = createMutationProvenanceBatch({
    projectId: authority.projectId,
    branchId: authority.branchId,
    draftGeneration: 2,
    slotKeys: humanSlotKeys,
    source: 'human',
  })
  const humanCommit = await coordinator.commit({
    schemaVersion: 1,
    batchId: 'persisted-unrelated-human-edit',
    projectId: authority.projectId,
    branchId: authority.branchId,
    expectedDraftGeneration: 1,
    activeDocument: harness.state.draft.activeDocument,
    projectSchema: harness.engine.project.export(),
    commitKind: 'manual-save',
    updatedAt: 2,
    operations: humanProvenance.map(value => ({ type: 'put', store: 'mutationProvenance', value })),
  })
  const persistedProvenance = await backend.getAll('mutationProvenance')
  const persistedBySlot = new Map(persistedProvenance.map(record => [record.slotKey, record]))
  assert.ok(
    originalProvenance.every(record => persistedBySlot.get(record.slotKey)?.token === 'agent:forward-1'),
    'the unrelated changed-hash human edit must preserve the complete original Agent slot set',
  )
  assert.ok(humanProvenance.every(record => persistedBySlot.get(record.slotKey)?.token === 'human'))
  harness.state.provenance.clear()
  for (const record of persistedProvenance) harness.state.provenance.set(record.slotKey, record)
  harness.state.draft = structuredClone(humanCommit.draft)

  const receipt = await harness.compensate('persisted-unrelated-human')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.runs.get('persisted-unrelated-human').status, 'completed')
  assert.equal(harness.state.coreRuns, 1)
  assert.equal(harness.document.getNode('target').getPropValue('text'), 'before')
  assert.equal(harness.document.getNode('anchor').getPropValue('text'), 'human-anchor')
})

test('production compensation adapter removes a node created by the original Screen call', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'insert-created',
      type: 'insert',
      parentId: 'root',
      componentName: 'Text',
      position: { place: 'last' },
      fields: { 'props.text': 'created' },
    },
  })
  const insertedNodeId = harness.compiled.insertedNodeIdentities[0].nodeId
  assert.notEqual(harness.document.getNode(insertedNodeId), null)

  const receipt = await harness.compensate('remove-created')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.runs.get('remove-created').status, 'completed')
  assert.deepEqual(harness.state.coreCommands, [
    [
      {
        type: 'removeNode',
        documentId: harness.document.id,
        nodeId: insertedNodeId,
      },
    ],
  ])
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
  assert.equal(harness.document.getNode(insertedNodeId), null)
  assert.equal(harness.state.coreRuns, 1)
  harness.engine.undo(harness.document)
  assert.deepEqual(harness.document.exportRaw(), harness.forwardSchema)
})

test('production compensation adapter moves an existing node back through the public Screen compiler', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'move-target',
      type: 'move',
      nodeId: 'target',
      parentId: 'root',
      position: { place: 'before', siblingId: 'anchor' },
    },
  })
  assert.deepEqual(
    harness.document.exportRaw().children.map(child => child.id),
    ['target', 'anchor'],
  )

  const receipt = await harness.compensate('move-back')

  assert.equal(receipt.status, 'applied')
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
  assert.equal(harness.state.coreRuns, 1)
  harness.engine.undo(harness.document)
  assert.deepEqual(harness.document.exportRaw(), harness.forwardSchema)
})

test('a node moved by a human from P2 to P3 is preserved without an inverse or empty History unit', async t => {
  const harness = await createHarness(t, {
    initialSchema: moveSchema(),
    forwardOperation: {
      opId: 'move-to-p2',
      type: 'move',
      nodeId: 'moving-node',
      parentId: 'parent-2',
      position: { place: 'last' },
    },
  })
  runSemanticChange(harness, 'human-move-p3', {
    opId: 'human-move-p3',
    type: 'move',
    nodeId: 'moving-node',
    parentId: 'parent-3',
    position: { place: 'last' },
  })
  harness.state.provenance.clear()
  harness.syncDraft()

  const receipt = await harness.compensate('preserve-p3')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.state.runs.get('preserve-p3').conflicts[0].code, 'POST_IMAGE_CHANGED')
  assert.equal(harness.document.getNode('moving-node').parent.id, 'parent-3')
  harness.engine.undo(harness.document)
  assert.equal(harness.document.getNode('moving-node').parent.id, 'parent-2')
})

for (const parentId of ['parent-1', 'parent-2']) {
  test(`move away-and-back retires ${parentId} children-order provenance`, async t => {
    const harness = await createHarness(t, {
      initialSchema: moveSchema(),
      forwardOperation: {
        opId: 'move-to-p2',
        type: 'move',
        nodeId: 'moving-node',
        parentId: 'parent-2',
        position: { place: 'last' },
      },
    })
    const orderSlot = createChildrenOrderSlotKey({
      projectId: authority.projectId,
      branchId: authority.branchId,
      parentId,
    })
    const parentSlot = createNodeParentSlotKey({
      projectId: authority.projectId,
      branchId: authority.branchId,
      nodeId: 'moving-node',
    })
    assert.equal(harness.compiled.affectedSlotKeys.includes(orderSlot), true)
    assert.equal(harness.compiled.affectedSlotKeys.includes(parentSlot), true)
    for (const destination of ['parent-3', 'parent-2']) {
      runSemanticChange(harness, `human-move-${destination}`, {
        opId: `human-move-${destination}`,
        type: 'move',
        nodeId: 'moving-node',
        parentId: destination,
        position: { place: 'last' },
      })
    }
    harness.state.provenance.delete(orderSlot)
    harness.syncDraft()

    const outerCallId = `move-alias-${parentId}`
    const receipt = await harness.compensate(outerCallId)

    assert.equal(receipt.status, 'applied')
    assert.equal(harness.state.coreRuns, 0)
    assert.equal(harness.state.runs.get(outerCallId).conflicts[0].code, 'PROVENANCE_CHANGED')
    assert.equal(harness.document.getNode('moving-node').parent.id, 'parent-2')
    harness.engine.undo(harness.document)
    assert.equal(harness.document.getNode('moving-node').parent.id, 'parent-3')
  })
}

test('trusted raw restore fails closed when a descendant identity was reused', async t => {
  const harness = await createHarness(t)
  harness.engine.transactions.runOnDocument(
    harness.document,
    [
      {
        type: 'insertNode',
        documentId: harness.document.id,
        parentId: 'root',
        at: 1,
        node: { componentName: 'Text', id: 'target-child', props: { text: 'foreign' } },
      },
    ],
    { expectedMutationVersion: harness.document.mutationVersion },
  )
  harness.syncDraft()
  const receipt = await harness.compensate('collision')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.document.getNode('target'), null)
  assert.equal(harness.document.getNode('target-child').getPropValue('text'), 'foreign')
  assert.equal(harness.state.runs.get('collision').status, 'completed-with-conflicts')
  assert.equal(harness.state.runs.get('collision').conflicts[0].code, 'AMBIGUOUS')
})

test('trusted raw restore fails closed when its relative anchor is missing', async t => {
  const harness = await createHarness(t)
  harness.engine.transactions.runOnDocument(
    harness.document,
    [{ type: 'removeNode', documentId: harness.document.id, nodeId: 'anchor' }],
    { expectedMutationVersion: harness.document.mutationVersion },
  )
  harness.syncDraft()
  const receipt = await harness.compensate('anchor')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.document.getNode('target'), null)
  assert.equal(harness.state.runs.get('anchor').status, 'completed-with-conflicts')
  assert.equal(harness.state.runs.get('anchor').conflicts[0].code, 'ANCHOR_INVALID')
})

test('trusted raw restore follows a valid relative anchor after an unrelated sibling changes the raw index', async t => {
  const harness = await createHarness(t)
  harness.engine.transactions.runOnDocument(
    harness.document,
    [
      {
        type: 'insertNode',
        documentId: harness.document.id,
        parentId: 'root',
        at: 1,
        node: { componentName: 'Text', id: 'unrelated-sibling', props: { text: 'unrelated' } },
      },
    ],
    { expectedMutationVersion: harness.document.mutationVersion },
  )
  harness.syncDraft()

  const receipt = await harness.compensate('relative-anchor')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 1)
  assert.equal(harness.state.runs.get('relative-anchor').status, 'completed')
  assert.deepEqual(
    harness.document.exportRaw().children.map(child => child.id),
    ['anchor', 'target', 'unrelated-sibling'],
  )
  harness.engine.undo(harness.document)
  assert.deepEqual(
    harness.document.exportRaw().children.map(child => child.id),
    ['anchor', 'unrelated-sibling'],
  )
})

test('activity after inverse intent persists a conservative conflict without running Core', async t => {
  const harness = await createHarness(t, {
    afterIntent: async ({ state }) => {
      state.activityGeneration += 1
      state.active = true
    },
  })
  const receipt = await harness.compensate('activity')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.state.runs.get('activity').status, 'completed-with-conflicts')
  assert.equal(harness.state.runs.get('activity').conflicts[0].code, 'AMBIGUOUS')
  harness.engine.undo(harness.document)
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
})

test('an empty compensation target adds no Core or History unit', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'set-target',
      type: 'set',
      nodeId: 'target',
      fieldId: 'props.text',
      value: 'after',
    },
  })

  const receipt = await harness.compensate('empty-target', [])

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.state.runs.get('empty-target').status, 'completed')
  assert.deepEqual(harness.document.exportRaw(), harness.forwardSchema)
  harness.engine.undo(harness.document)
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
})

test('away-and-back field edits fail closed on retired provenance without adding a compensation History unit', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'set-target',
      type: 'set',
      nodeId: 'target',
      fieldId: 'props.text',
      value: 'after',
    },
  })
  for (const text of ['human-away', 'after']) {
    harness.engine.transactions.runOnDocument(
      harness.document,
      [
        {
          type: 'updateProps',
          documentId: harness.document.id,
          nodeId: 'target',
          props: { text },
        },
      ],
      { expectedMutationVersion: harness.document.mutationVersion },
    )
  }
  harness.state.provenance.clear()
  harness.syncDraft()

  const receipt = await harness.compensate('away-back')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.state.runs.get('away-back').status, 'completed-with-conflicts')
  assert.equal(harness.state.runs.get('away-back').conflicts[0].code, 'PROVENANCE_CHANGED')
  harness.engine.undo(harness.document)
  assert.equal(harness.document.getNode('target').getPropValue('text'), 'human-away')
})

test('a later human field value C is preserved and compensation adds no History unit', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'set-target',
      type: 'set',
      nodeId: 'target',
      fieldId: 'props.text',
      value: 'after',
    },
  })
  runSemanticChange(harness, 'human-c', {
    opId: 'human-c',
    type: 'set',
    nodeId: 'target',
    fieldId: 'props.text',
    value: 'human-c',
  })
  harness.state.provenance.clear()
  harness.syncDraft()

  const receipt = await harness.compensate('human-c')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.state.runs.get('human-c').conflicts[0].code, 'POST_IMAGE_CHANGED')
  assert.equal(harness.document.getNode('target').getPropValue('text'), 'human-c')
  harness.engine.undo(harness.document)
  assert.equal(harness.document.getNode('target').getPropValue('text'), 'after')
})

for (const scenario of [
  {
    name: 'aggregate write followed by leaf away-and-back',
    forwardFieldId: 'props.style',
    forwardValue: { color: 'red', fontSize: 12 },
    humanFieldId: 'props.style.color',
    humanAway: 'blue',
    humanBack: 'red',
    retiredPath: ['style', 'color'],
  },
  {
    name: 'leaf write followed by aggregate away-and-back',
    forwardFieldId: 'props.style.color',
    forwardValue: 'red',
    humanFieldId: 'props.style',
    humanAway: { color: 'blue' },
    humanBack: { color: 'red' },
    retiredPath: ['style'],
  },
]) {
  test(`${scenario.name} retires the canonical alias and preserves the human post-image`, async t => {
    const harness = await createHarness(t, {
      forwardOperation: {
        opId: 'set-style',
        type: 'set',
        nodeId: 'target',
        fieldId: scenario.forwardFieldId,
        value: scenario.forwardValue,
      },
    })
    const retiredSlot = createFieldSlotKey({
      projectId: authority.projectId,
      branchId: authority.branchId,
      nodeId: 'target',
      root: 'props',
      path: scenario.retiredPath,
    })
    assert.equal(harness.compiled.affectedSlotKeys.includes(retiredSlot), true)
    for (const [index, value] of [scenario.humanAway, scenario.humanBack].entries()) {
      runSemanticChange(harness, `human-alias-${index}`, {
        opId: `human-alias-${index}`,
        type: 'set',
        nodeId: 'target',
        fieldId: scenario.humanFieldId,
        value,
      })
    }
    harness.state.provenance.delete(retiredSlot)
    harness.syncDraft()

    const receipt = await harness.compensate(`alias-${scenario.retiredPath.length}`)

    assert.equal(receipt.status, 'applied')
    assert.equal(harness.state.coreRuns, 0)
    assert.equal(harness.state.runs.get(`alias-${scenario.retiredPath.length}`).conflicts[0].code, 'PROVENANCE_CHANGED')
    harness.engine.undo(harness.document)
    assert.deepEqual(
      harness.document.getNode('target').getPropValue('style'),
      scenario.forwardFieldId === 'props.style' ? { color: 'blue', fontSize: 12 } : { color: 'blue' },
    )
  })
}

test('a created node modified after the original call is never removed as the original identity', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'insert-created',
      type: 'insert',
      parentId: 'root',
      componentName: 'Text',
      position: { place: 'last' },
      fields: { 'props.text': 'created' },
    },
  })
  const insertedNodeId = harness.compiled.insertedNodeIdentities[0].nodeId
  harness.engine.transactions.runOnDocument(
    harness.document,
    [
      {
        type: 'updateProps',
        documentId: harness.document.id,
        nodeId: insertedNodeId,
        props: { text: 'human-edited' },
      },
    ],
    { expectedMutationVersion: harness.document.mutationVersion },
  )
  harness.syncDraft()

  const receipt = await harness.compensate('edited-created')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.state.runs.get('edited-created').status, 'completed-with-conflicts')
  assert.equal(harness.state.runs.get('edited-created').conflicts[0].code, 'IDENTITY_REUSED')
  assert.equal(harness.document.getNode(insertedNodeId).getPropValue('text'), 'human-edited')
})

test('a child added under a created node preserves the whole human-extended subtree', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'insert-created',
      type: 'insert',
      parentId: 'root',
      componentName: 'Text',
      position: { place: 'last' },
      fields: { 'props.text': 'created' },
    },
  })
  const insertedNodeId = harness.compiled.insertedNodeIdentities[0].nodeId
  harness.engine.transactions.runOnDocument(
    harness.document,
    [
      {
        type: 'insertNode',
        documentId: harness.document.id,
        parentId: insertedNodeId,
        at: 0,
        node: { componentName: 'Text', id: 'human-child', props: { text: 'human-child' } },
      },
    ],
    { expectedMutationVersion: harness.document.mutationVersion },
  )
  harness.syncDraft()

  const receipt = await harness.compensate('created-child')

  assert.equal(receipt.status, 'applied')
  assert.equal(harness.state.coreRuns, 0)
  assert.equal(harness.state.runs.get('created-child').conflicts[0].code, 'IDENTITY_REUSED')
  assert.equal(harness.document.getNode('human-child').parent.id, insertedNodeId)
  harness.engine.undo(harness.document)
  assert.equal(harness.document.getNode('human-child'), null)
  assert.notEqual(harness.document.getNode(insertedNodeId), null)
})

test('snapshot fencing ignores an unrelated full projection larger than the Screen ChangeSet budget', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'set-target',
      type: 'set',
      nodeId: 'target',
      fieldId: 'props.text',
      value: 'after',
    },
    snapshotExtra: { projection: 'x'.repeat(1_100_000) },
  })

  const receipt = await harness.compensate('large-snapshot')

  assert.equal(receipt.status, 'applied')
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
  assert.equal(harness.state.coreRuns, 1)
})

test('an unrelated not-ready material stays in the fence without blocking inverse compilation', async t => {
  const harness = await createHarness(t, {
    forwardOperation: {
      opId: 'set-target',
      type: 'set',
      nodeId: 'target',
      fieldId: 'props.text',
      value: 'after',
    },
    extraManifests: [
      {
        ...manifest('UnavailableChart'),
        readiness: {
          status: 'not-ready',
          missingFieldIds: ['series'],
          unsupportedFieldIds: [],
        },
      },
    ],
  })

  const receipt = await harness.compensate('unrelated-not-ready')

  assert.equal(receipt.status, 'applied')
  assert.deepEqual(harness.document.exportRaw(), harness.beforeSchema)
  assert.equal(harness.state.coreRuns, 1)
})
