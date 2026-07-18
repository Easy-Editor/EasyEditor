import assert from 'node:assert/strict'
import test from 'node:test'

import { createDashboardScreenApplyChangeSetHandler } from '../src/editor/agent/capabilities/screen/runtime-adapter.mjs'

const authority = Object.freeze({
  projectId: 'project-a',
  branchId: 'main',
  sessionId: 'session-a',
  taskId: 'task-a',
})

const textManifest = (version, title = 'Text') => ({
  schemaVersion: 1,
  materialRegistryVersion: version,
  componentName: 'Text',
  title,
  fields: [
    {
      fieldId: 'props.text',
      access: 'read-write',
      readPath: ['props', 'text'],
      writeTargets: [{ path: ['props', 'text'] }],
      unsetTargets: [{ path: ['props', 'text'] }],
      verifyPaths: [['props', 'text']],
    },
  ],
  diagnostics: [],
  readiness: { status: 'ready', missingFieldIds: [], unsupportedFieldIds: [] },
})

const notReadyTextManifest = (version, componentName, title) => ({
  ...textManifest(version, title),
  componentName,
  readiness: { status: 'not-ready', missingFieldIds: ['props.text'], unsupportedFieldIds: [] },
})

const createHarness = ({
  admitMaterialRefsUnderSharedMutation,
  coreMode = 'applied',
  mutateAfterIntent,
  nonStableDocumentFacade = false,
  targetNotReady = false,
  unrelatedNotReady = false,
} = {}) => {
  const events = []
  const agentMutationCalls = []
  let activeAgentCallId = null
  const targetComponentName = targetNotReady ? 'UnavailableText' : 'Text'
  const state = {
    activityGeneration: 3,
    active: false,
    providerGeneration: 1,
    registryVersion: 9,
    manifestTitle: 'Text',
    notReadyManifestTitle: 'Unavailable material',
    documentId: 'document-a',
    mutationVersion: 4,
    schema: {
      componentName: 'Root',
      id: 'document-a',
      docId: 'document-a',
      fileName: 'overview',
      children: [{ componentName: targetComponentName, id: 'text-a', props: { text: 'before' } }],
    },
  }
  const document = {
    get id() {
      return state.documentId
    },
    fileName: 'overview',
    get mutationVersion() {
      return state.mutationVersion
    },
    exportRaw() {
      events.push('document:exportRaw')
      return structuredClone(state.schema)
    },
  }
  let opaqueHandleOwnKeys = 0
  let coreHandle
  const createDocumentFacade = () =>
    nonStableDocumentFacade
      ? new Proxy(
          {
            get id() {
              return document.id
            },
            get fileName() {
              return document.fileName
            },
            get mutationVersion() {
              return document.mutationVersion
            },
            exportRaw: document.exportRaw.bind(document),
          },
          {
            ownKeys(target) {
              opaqueHandleOwnKeys += 1
              return Reflect.ownKeys(target)
            },
          },
        )
      : document
  const project = {
    get currentDocument() {
      return createDocumentFacade()
    },
    get documents() {
      return [createDocumentFacade()]
    },
    export() {
      events.push('project:export')
      return { version: '1.0.0', componentsTree: [structuredClone(state.schema)] }
    },
  }
  const engine = {
    project,
    materials: {
      get version() {
        return state.registryVersion
      },
      getComponentMetasMap() {
        return new Map([[targetComponentName, {}], ...(unrelatedNotReady ? [['UnavailableChart', {}]] : [])])
      },
    },
    transactions: {
      runOnDocument(handle, commands, options) {
        events.push('core:run')
        assert.equal(activeAgentCallId, `call-${coreMode}`)
        coreHandle = handle
        assert.equal(handle.id, document.id)
        assert.deepEqual(options, { expectedMutationVersion: 4 })
        assert.deepEqual(commands, [
          { type: 'updateProps', documentId: 'document-a', nodeId: 'text-a', props: { text: 'after' } },
        ])
        if (coreMode === 'applied' || coreMode === 'committed-error') {
          state.schema.children[0].props.text = 'after'
          state.mutationVersion = 5
        }
        if (coreMode === 'committed-error') throw committedError
        if (coreMode === 'rollback-error') throw rollbackError
      },
    },
  }
  const committedError = new Error('committed observer failed')
  const rollbackError = new Error('rollback incomplete')
  const predicateCalls = []
  let committedBatch
  const persistence = {
    recoverDurableAgentReceipt: async () => ({ classification: 'missing' }),
    runAgentMutation(callId, operation) {
      assert.equal(activeAgentCallId, null)
      activeAgentCallId = callId
      agentMutationCalls.push(callId)
      try {
        return operation()
      } finally {
        activeAgentCallId = null
      }
    },
    runDurableAgentWrite: async operation =>
      operation({
        draft: { draftGeneration: 0 },
        recordIntent: async intent => {
          events.push('intent:record')
          mutateAfterIntent?.(state)
          return structuredClone(intent)
        },
        commitBatch: async batch => {
          events.push('batch:commit')
          committedBatch = structuredClone(batch)
          return { receipt: structuredClone(batch.receipt) }
        },
      }),
  }
  const activityLease = {
    get generation() {
      return state.activityGeneration
    },
    isActive: () => state.active,
    waitUntilIdle: async () => ({ generation: state.activityGeneration }),
  }
  const captureFullSnapshot = async () => ({
    schemaVersion: 1,
    revision: `revision-${state.mutationVersion}-${state.providerGeneration}-${state.registryVersion}`,
    cursor: 'unused',
    providerGenerations: { 'dashboard.core': state.providerGeneration },
    projection: {},
  })
  const manifestCache = {
    async get(componentName, version) {
      events.push(`manifest:${componentName}:${version}`)
      if (componentName === 'Text') return textManifest(version, state.manifestTitle)
      return notReadyTextManifest(version, componentName, state.notReadyManifestTitle)
    },
  }
  let hashIndex = 0
  const handler = createDashboardScreenApplyChangeSetHandler({
    authority,
    activityLease,
    engine,
    persistence,
    captureFullSnapshot,
    manifestCache,
    ...(admitMaterialRefsUnderSharedMutation === undefined ? {} : { admitMaterialRefsUnderSharedMutation }),
    hashCanonicalJson: async () => `sha256:${String(++hashIndex).padStart(64, '0')}`,
    now: () => 1_700_000_000_000,
    isTransactionCommittedError(error) {
      predicateCalls.push(['committed', error])
      return error === committedError
    },
    isTransactionRollbackIncompleteError(error) {
      predicateCalls.push(['rollback', error])
      return error === rollbackError
    },
  })
  const call = {
    schemaVersion: 1,
    ...authority,
    stepId: 'step-a',
    callId: `call-${coreMode}`,
    capability: 'screen.applyChangeSet',
    expectedRevision: 'revision-4-1-9',
    arguments: {
      schemaVersion: 1,
      documentId: 'document-a',
      operations: [{ opId: 'set-title', type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'after' }],
    },
  }
  return {
    call,
    agentMutationCalls,
    engine,
    events,
    handler,
    predicateCalls,
    state,
    get committedBatch() {
      return committedBatch
    },
    get coreHandle() {
      return coreHandle
    },
    get opaqueHandleOwnKeys() {
      return opaqueHandleOwnKeys
    },
    committedError,
    rollbackError,
  }
}

test('production adapter captures real document/project data and runs the Engine transaction', async () => {
  const harness = createHarness()
  const result = await harness.handler(harness.call)

  assert.equal(result.status, 'applied')
  assert.equal(harness.state.schema.children[0].props.text, 'after')
  assert.ok(harness.events.includes('core:run'))
  assert.deepEqual(harness.agentMutationCalls, [harness.call.callId])
  assert.deepEqual(harness.committedBatch.activeDocument, {
    documentId: 'document-a',
    fileName: 'overview',
    index: 0,
  })
  assert.deepEqual(harness.committedBatch.projectSchema, {
    componentsTree: [harness.state.schema],
    version: '1.0.0',
  })
})

test('adapter conditionally passes the admission dependency to the semantic handler without eager calls', async () => {
  let admissionCalls = 0
  const harness = createHarness({
    admitMaterialRefsUnderSharedMutation: async () => {
      admissionCalls += 1
    },
  })

  const result = await harness.handler(harness.call)

  assert.equal(result.status, 'applied')
  assert.equal(admissionCalls, 0, 'a ChangeSet without new canonical local refs must not call admission')
  assert.ok(harness.events.includes('intent:record'))
  assert.ok(harness.events.includes('core:run'))
})

test('adapter forwards a configured admission value directly to lower dependency validation', () => {
  assert.throws(
    () => createHarness({ admitMaterialRefsUnderSharedMutation: 1 }),
    /dependencies\.admitMaterialRefsUnderSharedMutation is required/u,
  )
})

test('an unrelated not-ready material stays fenced without blocking a ready target', async () => {
  const harness = createHarness({ unrelatedNotReady: true })

  const result = await harness.handler(harness.call)

  assert.equal(result.status, 'applied')
  assert.equal(harness.state.schema.children[0].props.text, 'after')
  assert.ok(harness.events.includes('manifest:Text:9'))
  assert.ok(harness.events.includes('manifest:UnavailableChart:9'))
  assert.ok(harness.events.includes('core:run'))
})

test('an unrelated not-ready material still participates in the semantic runtime fence', async () => {
  const harness = createHarness({
    unrelatedNotReady: true,
    mutateAfterIntent: state => (state.notReadyManifestTitle = 'Changed unavailable material'),
  })

  const result = await harness.handler(harness.call)

  assert.equal(result.status, 'not-applied')
  assert.equal(result.failure.code, 'STALE_REVISION')
  assert.equal(harness.events.includes('core:run'), false)
})

test('a targeted not-ready material fails closed as unavailable', async () => {
  const harness = createHarness({ targetNotReady: true })

  const result = await harness.handler(harness.call)

  assert.equal(result.status, 'rejected')
  assert.equal(result.failure.code, 'UNKNOWN_MATERIAL')
  assert.equal(result.failure.details.reason, 'material-manifest-is-unavailable')
  assert.equal(harness.events.includes('core:run'), false)
})

test('adapter supports non-stable Core document facades without freezing the bound handle', async () => {
  const harness = createHarness({ nonStableDocumentFacade: true })
  const boundHandle = harness.engine.project.currentDocument
  assert.notStrictEqual(boundHandle, harness.engine.project.currentDocument)

  const result = await harness.handler(harness.call)

  assert.equal(result.status, 'applied')
  assert.equal(Object.isFrozen(harness.coreHandle), false)
  assert.equal(harness.opaqueHandleOwnKeys, 0)
  assert.equal(Object.isFrozen(harness.engine), false)
  assert.equal(Object.isFrozen(harness.engine.project), false)
})

for (const [label, mutate, expectedCode] of [
  ['provider generation', state => (state.providerGeneration += 1), 'STALE_REVISION'],
  ['document identity', state => (state.documentId = 'document-b'), 'STALE_REVISION'],
  ['document mutation version', state => (state.mutationVersion += 1), 'STALE_REVISION'],
  ['material registry version', state => (state.registryVersion += 1), 'STALE_REVISION'],
  ['manifest semantic DTO', state => (state.manifestTitle = 'Changed Text'), 'STALE_REVISION'],
  ['activity generation', state => (state.activityGeneration += 1), 'HUMAN_ACTIVITY'],
]) {
  test(`${label} fence changes fail closed before Core execution`, async () => {
    const harness = createHarness({ mutateAfterIntent: mutate })
    const result = await harness.handler(harness.call)

    assert.equal(result.status, 'not-applied')
    assert.equal(result.failure.code, expectedCode)
    assert.equal(harness.events.includes('core:run'), false)
  })
}

test('typed transaction error predicates receive the exact Core failure', async () => {
  const committed = createHarness({ coreMode: 'committed-error' })
  const committedResult = await committed.handler(committed.call)
  assert.equal(committedResult.status, 'applied')
  assert.ok(
    committed.predicateCalls.some(([kind, error]) => kind === 'committed' && error === committed.committedError),
  )

  const rollback = createHarness({ coreMode: 'rollback-error' })
  const rollbackResult = await rollback.handler(rollback.call)
  assert.equal(rollbackResult.status, 'indeterminate')
  assert.ok(rollback.predicateCalls.some(([kind, error]) => kind === 'rollback' && error === rollback.rollbackError))
})

test('adapter rejects accessor-backed snapshot DTOs without invoking the getter', async () => {
  const harness = createHarness()
  let getterCalls = 0
  const handler = createDashboardScreenApplyChangeSetHandler({
    authority,
    activityLease: {
      generation: 0,
      isActive: () => false,
      waitUntilIdle: async () => ({ generation: 0 }),
    },
    engine: harness.engine,
    persistence: {
      recoverDurableAgentReceipt: async () => ({ classification: 'missing' }),
      runDurableAgentWrite: async () => assert.fail('must not write'),
    },
    captureFullSnapshot: () => ({
      get revision() {
        getterCalls += 1
        return 'forged'
      },
      providerGenerations: {},
    }),
    manifestCache: { get: async () => textManifest(9) },
    hashCanonicalJson: async () => `sha256:${'0'.repeat(64)}`,
    now: () => 0,
    isTransactionCommittedError: () => false,
    isTransactionRollbackIncompleteError: () => false,
  })
  await assert.rejects(handler({ ...harness.call, expectedRevision: 'forged' }), /snapshot\.revision/)
  assert.equal(getterCalls, 0)
})
