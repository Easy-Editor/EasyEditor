import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import { createDashboardAgentHost } from '../src/editor/agent/host/index.mjs'
import * as durableAgentCommit from '../src/editor/agent/persistence/durable-agent-commit.mjs'
import * as mutationAttribution from '../src/editor/agent/persistence/mutation-attribution.mjs'
import * as provenance from '../src/editor/agent/persistence/provenance.mjs'
import * as dashboardStorage from '../src/lib/storage/index.mjs'

const coreInstanceUrl = new URL('../../../packages/core/dist/instance.js', import.meta.url)
const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const persistenceRuntimePath = resolve(dashboardRoot, 'src/editor/persistence-runtime.ts')

const FAILURE = Object.freeze({
  appliedUndurable: 'APPLIED_UNDURABLE',
  coreTransactionFailed: 'CORE_TRANSACTION_FAILED',
  indeterminateReceipt: 'INDETERMINATE_RECEIPT',
  persistenceFailure: 'PERSISTENCE_FAILURE',
  rollbackIncomplete: 'TRANSACTION_ROLLBACK_INCOMPLETE',
})

class MemoryLocalStorage {
  #entries = new Map()

  get length() {
    return this.#entries.size
  }

  key(index) {
    return [...this.#entries.keys()][index] ?? null
  }

  getItem(key) {
    return this.#entries.get(key) ?? null
  }

  setItem(key, value) {
    this.#entries.set(key, String(value))
  }

  removeItem(key) {
    this.#entries.delete(key)
  }
}

const loadPersistenceRuntime = () => {
  const source = readFileSync(persistenceRuntimePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: persistenceRuntimePath,
  }).outputText
  const loadedModule = { exports: {} }
  const localRequire = request => {
    if (request === '../lib/storage/index.mjs') return dashboardStorage
    if (request === './agent/persistence/durable-agent-commit.mjs') return durableAgentCommit
    if (request === './agent/persistence/mutation-attribution.mjs') return mutationAttribution
    if (request === './agent/persistence/provenance.mjs') return provenance
    throw new Error(`Unexpected persistence runtime dependency: ${request}`)
  }
  new Function('require', 'module', 'exports', transpiled)(localRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const authority = Object.freeze({
  projectId: 'screen-crash-matrix-project',
  branchId: 'main',
  sessionId: 'screen-crash-matrix-session',
  taskId: 'screen-crash-matrix-task',
})

const createProjectSchema = (title = 'before') => ({
  id: authority.projectId,
  version: '0.0.1',
  componentsMap: [],
  componentsTree: [
    {
      docId: 'page-1',
      fileName: 'page-1',
      id: 'root-1',
      isRoot: true,
      componentName: 'ScreenRoot',
      props: { title },
      children: [],
    },
  ],
})

const createCall = expectedRevision => ({
  schemaVersion: 1,
  ...authority,
  stepId: 'step-1',
  callId: 'screen-crash-call-1',
  capability: 'screen.applyChangeSet',
  expectedRevision,
  arguments: {
    schemaVersion: 1,
    documentId: 'page-1',
    operations: [
      {
        opId: 'set-root-title',
        type: 'set',
        nodeId: 'root-1',
        fieldId: 'props.title',
        value: 'after',
      },
    ],
  },
})

const deferred = () => {
  let resolve
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const registerMaterials = engine => {
  engine.materials.createComponentMeta({
    componentName: 'ScreenRoot',
    title: 'Screen Root',
    configure: { props: [{ name: 'title', title: 'Title', setter: 'StringSetter' }] },
  })
}

const createHarness = async (t, options = {}) => {
  const { TransactionCommittedError, TransactionRollbackIncompleteError, createEngine } = await import(
    coreInstanceUrl.href
  )
  const { createDashboardPersistenceRuntime } = loadPersistenceRuntime()
  const backendFault = { enabled: false }
  const backend = new dashboardStorage.MemoryDashboardStorageBackend({
    faultInjector(event) {
      if (backendFault.enabled && event.phase === 'before-commit' && event.batch.draft.commitKind === 'agent-batch') {
        backendFault.enabled = false
        throw new Error('crash before the durable Agent transaction committed')
      }
    },
  })
  const runtime = createDashboardPersistenceRuntime({
    autosaveDelayMs: 0,
    backend,
    createProjectId: () => authority.projectId,
    now: (() => {
      let value = 1_700_000_000_000
      return () => ++value
    })(),
    refreshCompatibilitySnapshot: async () => undefined,
    storage: new MemoryLocalStorage(),
  })
  const initialSchema = createProjectSchema()
  const initialDraft = await runtime.initialize(initialSchema)
  assert.equal(initialDraft.draftGeneration, 1)

  const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  await engine.init()
  registerMaterials(engine)
  engine.loadProject(initialSchema, true)

  const controls = {
    backendFault,
    batchGate: options.batchGate ?? null,
    persistenceFault: options.persistenceFault ?? null,
    persistenceFaultConsumed: false,
  }
  let coreAttempts = 0
  let actualCoreEffects = 0
  const enginePort = {
    project: engine.project,
    materials: engine.materials,
    transactions: {
      runOnDocument(handle, commands, transactionOptions) {
        coreAttempts += 1
        const before = handle.root.getPropValue('title')
        try {
          if (options.coreMode === 'rollback-incomplete') {
            throw new TransactionRollbackIncompleteError(new Error('transaction failed'), [
              new Error('rollback resource failed'),
            ])
          }
          if (options.coreMode === 'rollback-complete') {
            return engine.transactions.runOnDocument(handle, commands, {
              ...transactionOptions,
              postcondition() {
                throw new Error('fail after command execution and roll back completely')
              },
            })
          }
          const result = engine.transactions.runOnDocument(handle, commands, transactionOptions)
          if (options.coreMode === 'committed-error') {
            throw new TransactionCommittedError([new Error('post-commit observer failed')], result)
          }
          return result
        } finally {
          if (before !== handle.root.getPropValue('title')) actualCoreEffects += 1
        }
      },
    },
  }

  const persistence = {
    recoverDurableAgentReceipt: request => runtime.recoverDurableAgentReceipt(request),
    runDurableAgentWrite: operation =>
      runtime.runDurableAgentWrite(session =>
        operation({
          draft: session.draft,
          recordIntent: async intent => {
            if (controls.persistenceFault === 'before-intent' && !controls.persistenceFaultConsumed) {
              controls.persistenceFaultConsumed = true
              throw new Error('crash before receipt intent')
            }
            const stored = await session.recordIntent(intent)
            if (controls.persistenceFault === 'after-intent' && !controls.persistenceFaultConsumed) {
              controls.persistenceFaultConsumed = true
              throw new Error('crash after receipt intent and before Core')
            }
            return stored
          },
          commitBatch: async batch => {
            if (controls.batchGate) {
              controls.batchGate.entered.resolve()
              await controls.batchGate.release.promise
            }
            if (controls.persistenceFault === 'before-batch' && !controls.persistenceFaultConsumed) {
              controls.persistenceFaultConsumed = true
              throw new Error('crash after Core and before durable batch')
            }
            const committed = await session.commitBatch(batch)
            if (controls.persistenceFault === 'ack-loss' && !controls.persistenceFaultConsumed) {
              controls.persistenceFaultConsumed = true
              throw new Error('ACK channel lost after durable commit')
            }
            return committed
          },
        }),
      ),
  }
  if (options.backendAbort) backendFault.enabled = true

  const activityLease = Object.freeze({
    generation: 0,
    isActive: () => false,
    waitUntilIdle: async () => ({ generation: 0 }),
  })
  let host
  const buildHost = () =>
    createDashboardAgentHost({
      activityLease,
      authority,
      compensationService: Object.freeze({
        compensate: async () => assert.fail('compensation is outside the Screen crash matrix'),
        query: async () => null,
      }),
      enabled: true,
      engine: enginePort,
      isTransactionCommittedError: error => error instanceof TransactionCommittedError,
      isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
      now: () => 1_700_000_000_100,
      persistence,
    })
  host = buildHost()

  t.after(async () => {
    host?.dispose()
    await runtime.dispose()
    await engine.destroy()
  })

  return {
    backend,
    engine,
    persistence,
    runtime,
    get host() {
      return host
    },
    get actualCoreEffects() {
      return actualCoreEffects
    },
    get coreAttempts() {
      return coreAttempts
    },
    rebuildHost() {
      host.dispose()
      host = buildHost()
      return host
    },
  }
}

const observe = harness => harness.host.observe({ schemaVersion: 1, ...authority, mode: 'full' })

const invoke = (harness, call) => harness.host.invoke(call, { schemaVersion: 1 })

const readDurableState = async harness => {
  const callId = 'screen-crash-call-1'
  const key = [authority.projectId, authority.branchId, callId]
  return {
    draft: await harness.runtime.readWorkingDraft(),
    intent: (await harness.backend.get('receiptIntents', key)) ?? null,
    receipt: (await harness.backend.get('toolReceipts', key)) ?? null,
    applyWitness: (await harness.backend.get('applyWitnesses', key)) ?? null,
    failureWitness: (await harness.backend.get('failureWitnesses', key)) ?? null,
    provenance: await harness.backend.getAll('mutationProvenance'),
  }
}

const assertInvocation = (result, status, code) => {
  assert.equal(result.status, status)
  if (code === undefined) assert.equal(result.failure, undefined)
  else assert.equal(result.failure?.code, code)
}

const assertSingleHistoryEffect = (document, expectedEffect) => {
  if (!expectedEffect) {
    assert.equal(document.history.isUndoable(), false)
    return
  }
  assert.equal(document.history.isUndoable(), true)
  document.history.back()
  assert.equal(document.root.getPropValue('title'), 'before')
  assert.equal(document.history.isUndoable(), false, 'one undo must consume the only Screen History unit')
}

const crashCases = [
  {
    name: 'crash before intent safely retries from missing lineage',
    persistenceFault: 'before-intent',
    first: ['indeterminate', FAILURE.persistenceFailure],
    firstDraftGeneration: 1,
    firstIntent: false,
    firstReceipt: null,
    retry: ['applied'],
    finalDraftGeneration: 2,
    finalReceipt: 'applied',
    coreAttempts: 1,
    effect: true,
  },
  {
    name: 'crash after intent and before Core stays indeterminate without replay',
    persistenceFault: 'after-intent',
    first: ['indeterminate', FAILURE.persistenceFailure],
    firstDraftGeneration: 1,
    firstIntent: true,
    firstReceipt: null,
    retry: ['indeterminate', FAILURE.indeterminateReceipt],
    finalDraftGeneration: 1,
    finalReceipt: null,
    coreAttempts: 0,
    effect: false,
  },
  {
    name: 'crash after Core and before durable batch preserves one effect and forbids replay',
    persistenceFault: 'before-batch',
    first: ['indeterminate', FAILURE.appliedUndurable],
    firstDraftGeneration: 1,
    firstIntent: true,
    firstReceipt: null,
    retry: ['indeterminate', FAILURE.indeterminateReceipt],
    finalDraftGeneration: 1,
    finalReceipt: null,
    coreAttempts: 1,
    effect: true,
  },
  {
    name: 'TransactionCommittedError is classified and committed as applied',
    coreMode: 'committed-error',
    first: ['applied'],
    firstDraftGeneration: 2,
    firstIntent: true,
    firstReceipt: 'applied',
    retry: ['applied'],
    finalDraftGeneration: 2,
    finalReceipt: 'applied',
    coreAttempts: 1,
    effect: true,
  },
  {
    name: 'real Core rollback-complete commits one failed receipt and no History unit',
    coreMode: 'rollback-complete',
    first: ['not-applied', FAILURE.coreTransactionFailed],
    firstDraftGeneration: 2,
    firstIntent: true,
    firstReceipt: 'not-applied',
    retry: ['not-applied', FAILURE.coreTransactionFailed],
    finalDraftGeneration: 2,
    finalReceipt: 'not-applied',
    coreAttempts: 1,
    effect: false,
  },
  {
    name: 'rollback-incomplete remains intent-only indeterminate and never replays',
    coreMode: 'rollback-incomplete',
    first: ['indeterminate', FAILURE.rollbackIncomplete],
    firstDraftGeneration: 1,
    firstIntent: true,
    firstReceipt: null,
    retry: ['indeterminate', FAILURE.indeterminateReceipt],
    finalDraftGeneration: 1,
    finalReceipt: null,
    coreAttempts: 1,
    effect: false,
  },
  {
    name: 'durable transaction abort atomically rolls back batch state after one Core effect',
    backendAbort: true,
    first: ['indeterminate', FAILURE.appliedUndurable],
    firstDraftGeneration: 1,
    firstIntent: true,
    firstReceipt: null,
    retry: ['indeterminate', FAILURE.indeterminateReceipt],
    finalDraftGeneration: 1,
    finalReceipt: null,
    coreAttempts: 1,
    effect: true,
  },
  {
    name: 'ACK loss recovers the committed receipt without a second Core effect',
    persistenceFault: 'ack-loss',
    first: ['indeterminate', FAILURE.appliedUndurable],
    firstDraftGeneration: 2,
    firstIntent: true,
    firstReceipt: 'applied',
    retry: ['applied'],
    finalDraftGeneration: 2,
    finalReceipt: 'applied',
    coreAttempts: 1,
    effect: true,
  },
]

for (const crashCase of crashCases) {
  test(crashCase.name, async t => {
    const harness = await createHarness(t, crashCase)
    const document = harness.engine.project.currentDocument
    assert.equal(document.history.isUndoable(), false)
    const call = createCall((await observe(harness)).revision)

    const first = await invoke(harness, call)
    assertInvocation(first, ...crashCase.first)
    const firstState = await readDurableState(harness)
    assert.equal(firstState.draft?.draftGeneration, crashCase.firstDraftGeneration)
    assert.equal(firstState.intent !== null, crashCase.firstIntent)
    assert.equal(firstState.receipt?.status ?? null, crashCase.firstReceipt)
    assert.equal(firstState.applyWitness !== null, crashCase.firstReceipt === 'applied')
    assert.equal(firstState.failureWitness !== null, crashCase.firstReceipt === 'not-applied')
    assert.equal(firstState.provenance.length > 0, crashCase.firstReceipt === 'applied')

    harness.rebuildHost()
    const retried = await invoke(harness, call)
    assertInvocation(retried, ...crashCase.retry)
    const finalState = await readDurableState(harness)
    assert.equal(finalState.draft?.draftGeneration, crashCase.finalDraftGeneration)
    assert.equal(finalState.receipt?.status ?? null, crashCase.finalReceipt)
    assert.equal(finalState.applyWitness !== null, crashCase.finalReceipt === 'applied')
    assert.equal(finalState.failureWitness !== null, crashCase.finalReceipt === 'not-applied')
    assert.equal(finalState.provenance.length > 0, crashCase.finalReceipt === 'applied')
    for (const record of finalState.provenance) {
      assert.equal(record.draftGeneration, crashCase.finalDraftGeneration)
      assert.equal(record.token, `agent:${call.callId}`)
    }
    assert.equal(harness.coreAttempts, crashCase.coreAttempts)
    assert.equal(harness.actualCoreEffects, crashCase.effect ? 1 : 0)
    assert.equal(document.root.getPropValue('title'), crashCase.effect ? 'after' : 'before')
    assertSingleHistoryEffect(document, crashCase.effect)
  })
}

test('real Screen write serializes ahead of autosave and manual-save without duplicating its effect', async t => {
  const batchGate = { entered: deferred(), release: deferred() }
  const harness = await createHarness(t, { batchGate })
  const document = harness.engine.project.currentDocument
  const call = createCall((await observe(harness)).revision)
  const invocation = invoke(harness, call)
  await batchGate.entered.promise
  assert.equal(document.root.getPropValue('title'), 'after', 'Core committed before the durable Screen batch gate')

  const captureCurrentProject = () => ({
    activeDocument: { documentId: document.id, fileName: document.fileName, index: 0 },
    projectSchema: harness.engine.project.export(),
  })
  const autosaveCaptured = deferred()
  harness.runtime.scheduleAutosave(() => {
    const captured = captureCurrentProject()
    autosaveCaptured.resolve()
    return captured
  })
  await autosaveCaptured.promise
  const manualSave = harness.runtime.save({ ...captureCurrentProject(), commitKind: 'manual-save' })

  batchGate.release.resolve()
  const result = await invocation
  assertInvocation(result, 'applied')
  const manualResult = await manualSave
  await harness.runtime.flush()

  assert.equal(manualResult.draft.draftGeneration, 4)
  assert.equal(manualResult.draft.commitKind, 'manual-save')
  assert.equal(manualResult.draft.projectSchema.componentsTree[0].props.title, 'after')
  const state = await readDurableState(harness)
  assert.equal(state.draft?.draftGeneration, 4)
  assert.equal(state.receipt?.status, 'applied')
  assert.ok(state.applyWitness)
  assert.equal(state.failureWitness, null)
  assert.ok(state.provenance.length > 0)
  assert.ok(
    state.provenance.every(record => record.draftGeneration === 2 && record.token === `agent:${call.callId}`),
    'same-byte editor saves preserve the exact generation-2 Agent provenance',
  )

  harness.rebuildHost()
  assertInvocation(await invoke(harness, call), 'applied')
  assert.equal(harness.coreAttempts, 1)
  assert.equal(harness.actualCoreEffects, 1)
  assertSingleHistoryEffect(document, true)
})
