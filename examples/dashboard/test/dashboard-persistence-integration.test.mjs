import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { createDashboardAgentPersistencePort } from '../src/editor/agent/persistence/agent-persistence-port.mjs'
import * as durableAgentCommit from '../src/editor/agent/persistence/durable-agent-commit.mjs'
import { createFieldSlotAliases, createMutationProvenanceBatch } from '../src/editor/agent/persistence/provenance.mjs'
import {
  createApplyWitness,
  createReceiptIntent,
  createToolReceipt,
  createToolReceiptWitness,
} from '../src/editor/agent/persistence/receipt-ledger.mjs'
import * as dashboardStorage from '../src/lib/storage/index.mjs'

class MemoryLocalStorage {
  #entries = new Map()

  constructor(entries = {}) {
    for (const [key, value] of Object.entries(entries)) this.#entries.set(key, String(value))
  }

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

  snapshot() {
    return Object.fromEntries(this.#entries)
  }
}

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const persistenceRuntimePath = resolve(dashboardRoot, 'src/editor/persistence-runtime.ts')

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
    throw new Error(`Unexpected dependency ${request} in persistence-runtime.ts`)
  }
  const evaluate = new Function('require', 'module', 'exports', transpiled)
  evaluate(localRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const page = (fileName, docId, text) => ({
  componentName: 'Root',
  docId,
  fileDesc: fileName,
  fileName,
  isRoot: true,
  props: { text },
})

const project = (text = 'initial') => ({
  componentsTree: [page('overview', 'page-overview', text), page('detail', 'page-detail', `${text}-detail`)],
  config: { theme: 'night' },
  dataSource: { list: [{ id: 'source-1', type: 'mock' }] },
  version: '1.0.0',
})

const activeDocument = (index = 0) => ({
  documentId: index === 0 ? 'page-overview' : 'page-detail',
  fileName: index === 0 ? 'overview' : 'detail',
  index,
})

const SHA_A = `sha256:${'a'.repeat(64)}`
const SHA_B = `sha256:${'b'.repeat(64)}`

const durableAuthority = Object.freeze({
  projectId: 'project-dashboard',
  branchId: 'main',
  callId: 'call-runtime-agent-1',
})

const createDurableIntent = () =>
  createReceiptIntent({
    schemaVersion: 1,
    ...durableAuthority,
    preparedHash: SHA_A,
    baseRevision: 'core:1:registry:1',
    preImages: [{ slotKey: 'title', value: 'before' }],
    expectedPostImages: [{ slotKey: 'title', value: 'after' }],
    status: 'pending',
  })

const createDurableOutcome = draftGeneration => {
  const slotKeys = createFieldSlotAliases({
    projectId: durableAuthority.projectId,
    branchId: durableAuthority.branchId,
    nodeId: 'title-1',
    root: 'props',
    path: ['text'],
  })
  const provenance = createMutationProvenanceBatch({
    projectId: durableAuthority.projectId,
    branchId: durableAuthority.branchId,
    draftGeneration,
    slotKeys,
    source: 'agent',
    callId: durableAuthority.callId,
  })
  const witness = createApplyWitness({
    schemaVersion: 1,
    ...durableAuthority,
    draftGeneration,
    coreMutationVersion: draftGeneration,
    transactionFingerprint: SHA_B,
    affectedSlotTokens: provenance.map(({ slotKey, token }) => ({ slotKey, token })),
  })
  const receipt = createToolReceipt({
    schemaVersion: 1,
    ...durableAuthority,
    status: 'applied',
    revision: `core:${draftGeneration}:registry:1`,
    witness: createToolReceiptWitness(witness),
  })
  return { provenance, receipt, witness }
}

const createDurableBatch = (intent, outcome, expectedDraftGeneration) => ({
  schemaVersion: 1,
  ...durableAuthority,
  expectedDraftGeneration,
  activeDocument: activeDocument(),
  projectSchema: project('agent-committed'),
  updatedAt: 2_000,
  receiptIntent: intent,
  receipt: outcome.receipt,
  witness: outcome.witness,
  provenance: outcome.provenance,
  sessionId: 'session-runtime-agent-1',
  journal: {
    recordId: 'task:runtime-agent-1',
    kind: 'journal-head',
    value: { phase: 'VERIFY' },
  },
  checkpoint: {
    checkpointId: 'verified:runtime-agent-1',
    value: { verified: true },
  },
})

const createClock = () => {
  let value = 1_000
  return () => ++value
}

const createRuntime = (overrides = {}) => {
  const { createDashboardPersistenceRuntime } = loadPersistenceRuntime()
  const storage = overrides.storage ?? new MemoryLocalStorage()
  const backend = overrides.backend ?? new dashboardStorage.MemoryDashboardStorageBackend()
  const warnings = []
  const runtime = createDashboardPersistenceRuntime({
    autosaveDelayMs: 5,
    backend,
    createProjectId: () => 'project-dashboard',
    now: createClock(),
    onWarning: warning => warnings.push(warning),
    storage,
    ...overrides,
  })
  return { backend, runtime, storage, warnings }
}

const walk = directory =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })

test('empty storage initializes one canonical full-project draft and an indexeddb compatibility snapshot', async () => {
  const { backend, runtime, storage } = createRuntime()

  const draft = await runtime.initialize(project())

  assert.equal(draft.draftGeneration, 1)
  assert.equal(draft.commitKind, 'migration')
  assert.deepEqual(draft.projectSchema, project())
  assert.deepEqual(draft.activeDocument, activeDocument())
  assert.deepEqual(await backend.get('workingDrafts', ['project-dashboard', 'main']), draft)

  const marker = dashboardStorage.readStorageCompatibilityMarker(storage).marker
  assert.equal(marker?.canonicalBackend, 'indexeddb')
  assert.equal(marker?.draftGeneration, 1)
  assert.deepEqual(JSON.parse(storage.getItem('projectSchema')), project())
  assert.deepEqual(JSON.parse(storage.getItem('pageInfo')), [
    { path: 'overview', title: 'overview' },
    { path: 'detail', title: 'detail' },
  ])

  await runtime.dispose()
})

test('two runtimes bootstrap one shared project identity and canonical generation', async () => {
  const storage = new MemoryLocalStorage()
  const backend = new dashboardStorage.MemoryDashboardStorageBackend()
  const first = createRuntime({ backend, createProjectId: () => 'project-first-runtime', storage })
  const second = createRuntime({ backend, createProjectId: () => 'project-second-runtime', storage })

  const [firstDraft, secondDraft] = await Promise.all([
    first.runtime.initialize(project()),
    second.runtime.initialize(project()),
  ])

  assert.equal(firstDraft.projectId, 'project-first-runtime')
  assert.deepEqual(secondDraft, firstDraft)
  assert.equal(firstDraft.draftGeneration, 1)
  assert.deepEqual(await backend.get('workingDrafts', ['project-first-runtime', 'main']), firstDraft)
  assert.equal(await backend.get('workingDrafts', ['project-second-runtime', 'main']), undefined)
  assert.deepEqual(JSON.parse(storage.getItem('easy-editor:storage:active:v1')), {
    schemaVersion: 1,
    projectId: 'project-first-runtime',
    branchId: 'main',
  })
  assert.equal(dashboardStorage.readStorageCompatibilityMarker(storage).marker?.draftGeneration, 1)

  await Promise.all([first.runtime.dispose(), second.runtime.dispose()])
})

test('runtime and coordinator share the injected compatibility storage authority', async () => {
  const { runtime, storage } = createRuntime()
  const draft = await runtime.initialize(project())
  dashboardStorage.writeStorageCompatibilityMarker(storage, {
    schemaVersion: 1,
    writerVersion: 1,
    canonicalBackend: 'legacy-local-storage',
    minReaderVersion: 1,
    projectId: draft.projectId,
    branchId: draft.branchId,
    draftGeneration: draft.draftGeneration,
    projectHash: draft.projectHash,
    updatedAt: 2_000,
  })

  await assert.rejects(
    runtime.save({
      activeDocument: activeDocument(),
      commitKind: 'manual-save',
      projectSchema: project('must-not-write-after-downgrade'),
    }),
    error =>
      dashboardStorage.isDashboardStorageError(error) &&
      error.code === dashboardStorage.DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
  )
  assert.equal((await runtime.readWorkingDraft())?.draftGeneration, draft.draftGeneration)

  await runtime.dispose()
})

test('legacy page fragments migrate once and preview selection follows the canonical active document', async () => {
  const legacyProject = project('legacy')
  const storage = new MemoryLocalStorage({
    pageInfo: JSON.stringify([
      { path: 'overview', title: 'Overview' },
      { path: 'detail', title: 'Detail' },
    ]),
    'pageSchema:overview': JSON.stringify({ ...legacyProject, componentsTree: [legacyProject.componentsTree[0]] }),
    'pageSchema:detail': JSON.stringify({ ...legacyProject, componentsTree: [legacyProject.componentsTree[1]] }),
  })
  const { runtime } = createRuntime({ storage })
  const { selectDashboardActiveDocumentSchema } = loadPersistenceRuntime()

  const draft = await runtime.initialize(project('fallback'))

  assert.equal(draft.draftGeneration, 1)
  assert.equal(draft.commitKind, 'migration')
  assert.deepEqual(draft.projectSchema, legacyProject)
  assert.equal(selectDashboardActiveDocumentSchema(draft.projectSchema, activeDocument(1)).fileName, 'detail')
  assert.equal(dashboardStorage.readStorageCompatibilityMarker(storage).marker?.canonicalBackend, 'indexeddb')

  await runtime.dispose()
})

test('manual save cancels a stale debounce and all canonical writes advance through one queue', async () => {
  const { runtime } = createRuntime()
  await runtime.initialize(project())

  runtime.scheduleAutosave(() => ({ activeDocument: activeDocument(), projectSchema: project('stale') }))
  const manual = await runtime.save({
    activeDocument: activeDocument(1),
    commitKind: 'manual-save',
    projectSchema: project('manual'),
  })
  await runtime.flush()

  assert.equal(manual.draft.draftGeneration, 2)
  assert.equal(manual.draft.commitKind, 'manual-save')
  assert.deepEqual((await runtime.readWorkingDraft())?.projectSchema, project('manual'))

  runtime.scheduleAutosave(() => ({ activeDocument: activeDocument(), projectSchema: project('first') }))
  runtime.scheduleAutosave(() => ({ activeDocument: activeDocument(1), projectSchema: project('latest') }))
  await runtime.flush()

  const latest = await runtime.readWorkingDraft()
  assert.equal(latest?.draftGeneration, 3)
  assert.equal(latest?.commitKind, 'autosave')
  assert.deepEqual(latest?.projectSchema, project('latest'))
  assert.deepEqual(latest?.activeDocument, activeDocument(1))

  await runtime.dispose()
})

test('runtime-owned Agent persistence keeps its own generation outside the canonical draft clock', async () => {
  const { runtime } = createRuntime()
  await runtime.initialize(project())
  const port = createDashboardAgentPersistencePort(runtime)
  const binding = {
    projectId: durableAuthority.projectId,
    branchId: durableAuthority.branchId,
    sessionId: 'session-runtime-port-1',
  }

  assert.deepEqual(await port.read({ schemaVersion: 1, ...binding, expectedPersistenceGeneration: 0 }), {
    schemaVersion: 1,
    ...binding,
    persistenceGeneration: 0,
    records: [],
  })
  assert.deepEqual(
    await port.commit({
      schemaVersion: 1,
      ...binding,
      batchId: 'runtime-port-batch-1',
      expectedPersistenceGeneration: 0,
      records: [{ recordId: 'journal-1', kind: 'journal', value: { phase: 'OBSERVE' } }],
    }),
    {
      schemaVersion: 1,
      batchId: 'runtime-port-batch-1',
      status: 'committed',
      persistenceGeneration: 1,
    },
  )
  assert.equal(runtime.getSnapshot().draftGeneration, 1)

  await runtime.dispose()
})

test('durable Agent commit and manual save share one runtime head and conservatively retire current provenance', async () => {
  const refreshedGenerations = []
  const { backend, runtime } = createRuntime({
    async refreshCompatibilitySnapshot({ draft }) {
      refreshedGenerations.push(draft.draftGeneration)
    },
  })
  await runtime.initialize(project())
  const intent = createDurableIntent()
  const outcome = createDurableOutcome(2)

  await runtime.recordDurableAgentIntent(intent)
  const agentResult = await runtime.commitDurableAgentBatch(createDurableBatch(intent, outcome, 1))

  assert.equal(agentResult.draft.draftGeneration, 2)
  assert.equal(agentResult.draft.commitKind, 'agent-batch')
  assert.equal(agentResult.compatibilityWarning, null)
  assert.equal(runtime.getSnapshot().draftGeneration, 2)
  assert.deepEqual(await runtime.recoverDurableAgentReceipt(durableAuthority), {
    classification: 'committed',
    receipt: outcome.receipt,
  })

  const manualResult = await runtime.save({
    activeDocument: activeDocument(1),
    commitKind: 'manual-save',
    projectSchema: project('manual-after-agent'),
  })
  assert.equal(manualResult.draft.draftGeneration, 3)
  const currentProvenance = await backend.getAll('mutationProvenance')
  assert.equal(currentProvenance.length, outcome.provenance.length)
  assert.deepEqual(
    currentProvenance.map(({ draftGeneration, token }) => ({ draftGeneration, token })),
    outcome.provenance.map(() => ({ draftGeneration: 3, token: 'unknown' })),
  )
  assert.deepEqual(await runtime.recoverDurableAgentReceipt(durableAuthority), {
    classification: 'committed',
    receipt: outcome.receipt,
  })
  assert.deepEqual(refreshedGenerations, [1, 2, 3])

  await runtime.dispose()
})

test('generation conflict refreshes the cached head without replay before the next explicit save', async () => {
  const { backend, runtime } = createRuntime()
  await runtime.initialize(project())
  const externalCoordinator = new dashboardStorage.ProjectPersistenceCoordinator({ backend })
  const externallyCommitted = await externalCoordinator.commit({
    schemaVersion: 1,
    batchId: 'external:manual-save:2',
    projectId: durableAuthority.projectId,
    branchId: durableAuthority.branchId,
    expectedDraftGeneration: 1,
    activeDocument: activeDocument(1),
    projectSchema: project('external-generation-2'),
    commitKind: 'manual-save',
    updatedAt: 3_000,
    operations: [],
  })
  assert.equal(externallyCommitted.draft.draftGeneration, 2)

  await assert.rejects(
    runtime.save({
      activeDocument: activeDocument(),
      commitKind: 'manual-save',
      projectSchema: project('must-not-replay'),
    }),
    error =>
      dashboardStorage.isDashboardStorageError(error) &&
      error.code === dashboardStorage.DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
  )
  assert.equal(runtime.getSnapshot().draftGeneration, 2)
  assert.deepEqual((await runtime.readWorkingDraft())?.projectSchema, project('external-generation-2'))

  const recovered = await runtime.save({
    activeDocument: activeDocument(),
    commitKind: 'manual-save',
    projectSchema: project('explicit-generation-3'),
  })
  assert.equal(recovered.draft.draftGeneration, 3)
  assert.deepEqual(recovered.draft.projectSchema, project('explicit-generation-3'))

  await runtime.dispose()
})

test('a failed canonical commit rejects without advancing the runtime generation', async () => {
  let rejectManualSave = true
  const backend = new dashboardStorage.MemoryDashboardStorageBackend({
    faultInjector(event) {
      if (rejectManualSave && event.phase === 'before-commit' && event.batch.draft.commitKind === 'manual-save') {
        throw new Error('durable commit failed')
      }
    },
  })
  const { runtime } = createRuntime({ backend })
  await runtime.initialize(project())

  await assert.rejects(
    runtime.save({
      activeDocument: activeDocument(),
      commitKind: 'manual-save',
      projectSchema: project('failed'),
    }),
    /memory-storage-fault-injected/,
  )
  assert.equal(runtime.getSnapshot().draftGeneration, 1)
  assert.deepEqual((await runtime.readWorkingDraft())?.projectSchema, project())

  rejectManualSave = false
  const recovered = await runtime.save({
    activeDocument: activeDocument(),
    commitKind: 'manual-save',
    projectSchema: project('recovered'),
  })
  assert.equal(recovered.draft.draftGeneration, 2)

  await runtime.dispose()
})

test('compatibility refresh warnings stay ordered and do not negate a durable canonical commit', async () => {
  const events = []
  const { runtime, warnings } = createRuntime({
    async refreshCompatibilitySnapshot({ draft }) {
      events.push(`refresh:${draft.draftGeneration}:start`)
      await new Promise(resolve => setTimeout(resolve, draft.draftGeneration === 2 ? 8 : 0))
      events.push(`refresh:${draft.draftGeneration}:end`)
      if (draft.draftGeneration === 2) throw new Error('legacy snapshot unavailable')
    },
  })
  await runtime.initialize(project())

  const first = runtime.save({
    activeDocument: activeDocument(),
    commitKind: 'manual-save',
    projectSchema: project('generation-2'),
  })
  const second = runtime.save({
    activeDocument: activeDocument(1),
    commitKind: 'manual-save',
    projectSchema: project('generation-3'),
  })
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.equal(firstResult.draft.draftGeneration, 2)
  assert.equal(firstResult.compatibilityWarning?.code, 'compatibility-snapshot-refresh-failed')
  assert.equal(secondResult.draft.draftGeneration, 3)
  assert.equal(secondResult.compatibilityWarning, null)
  assert.deepEqual(events.slice(-4), ['refresh:2:start', 'refresh:2:end', 'refresh:3:start', 'refresh:3:end'])
  assert.equal(warnings.length, 1)
  assert.equal((await runtime.readWorkingDraft())?.draftGeneration, 3)

  await runtime.dispose()
})

test('preview opens synchronously but navigates only after the durable save settles', async () => {
  const { openDashboardPreviewAfterSave } = loadPersistenceRuntime()
  const events = []
  let releaseSave
  const save = new Promise(resolve => {
    releaseSave = resolve
  })
  const popup = {
    navigate(url) {
      events.push(`navigate:${url}`)
    },
    showFailure(message) {
      events.push(`failure:${message}`)
    },
  }

  const opening = openDashboardPreviewAfterSave({
    openWindow() {
      events.push('open')
      return popup
    },
    persist: async () => {
      events.push('persist:start')
      await save
      events.push('persist:end')
    },
    previewUrl: '/preview',
  })

  assert.deepEqual(events, ['open', 'persist:start'])
  releaseSave()
  assert.equal((await opening).status, 'opened')
  assert.deepEqual(events, ['open', 'persist:start', 'persist:end', 'navigate:/preview'])

  const failureEvents = []
  const failure = await openDashboardPreviewAfterSave({
    openWindow: () => ({
      navigate: url => failureEvents.push(`navigate:${url}`),
      showFailure: message => failureEvents.push(`failure:${message}`),
    }),
    persist: async () => {
      throw new Error('save failed')
    },
    previewUrl: '/preview',
  })
  assert.equal(failure.status, 'failed')
  assert.deepEqual(failureEvents, ['failure:当前更改尚未保存，无法打开预览。'])
})

test('explicit disposal flushes the latest pending autosave and rejects new work', async () => {
  const { runtime } = createRuntime()
  await runtime.initialize(project())
  runtime.scheduleAutosave(() => ({ activeDocument: activeDocument(1), projectSchema: project('before-dispose') }))

  await runtime.dispose()

  assert.equal(runtime.getSnapshot().state, 'disposed')
  assert.equal(runtime.getSnapshot().draftGeneration, 2)
  assert.throws(
    () => runtime.scheduleAutosave(() => ({ activeDocument: activeDocument(), projectSchema: project('late') })),
    /disposed/,
  )
  await assert.rejects(
    runtime.save({
      activeDocument: activeDocument(),
      commitKind: 'manual-save',
      projectSchema: project('late'),
    }),
    /disposed/,
  )
})

test('Dashboard wiring keeps canonical writes and IndexedDB transactions behind the persistence boundary', () => {
  const sourceRoot = resolve(dashboardRoot, 'src')
  const canonicalConsumers = [
    'src/lib/schema.ts',
    'src/editor/index.ts',
    'src/editor/runtime.ts',
    'src/pages/editor/Header.tsx',
    'src/pages/preview/index.tsx',
  ]
  for (const relativePath of canonicalConsumers) {
    const source = readFileSync(resolve(dashboardRoot, relativePath), 'utf8')
    assert.doesNotMatch(source, /(?:localStorage|storage)\.(?:setItem|removeItem)\s*\(/u, relativePath)
    assert.doesNotMatch(source, /(?:projectSchema|pageInfo|pageSchema:)['"`]\s*,/u, relativePath)
  }

  const indexedDbApiUsers = walk(sourceRoot)
    .filter(path => ['.js', '.mjs', '.ts', '.tsx'].includes(extname(path)))
    .filter(path => /\bindexedDB\.open\s*\(|\bdatabase\.transaction\s*\(/u.test(readFileSync(path, 'utf8')))
    .map(path => relative(dashboardRoot, path))
  assert.deepEqual(indexedDbApiUsers, ['src/lib/storage/indexeddb-backend.mjs'])

  const runtimeSource = readFileSync(resolve(dashboardRoot, 'src/editor/runtime.ts'), 'utf8')
  const probe = runtimeSource.match(
    /Object\.defineProperty\(window, '__EASY_EDITOR_E2E__',[\s\S]+?flushPersistence:[\s\S]+?\n\s*\}\)/u,
  )?.[0]
  assert.ok(probe)
  assert.match(probe, /getEngineState:/u)
  assert.match(probe, /getPersistenceState:/u)
  assert.match(probe, /flushPersistence:/u)
  assert.doesNotMatch(probe, /\b(?:save|write|commit|loadProject|destroy)\w*:/iu)

  const persistenceSource = readFileSync(persistenceRuntimePath, 'utf8')
  assert.match(persistenceSource, /this\.#coordinator\.commit\(/u)
  assert.match(persistenceSource, /await this\.#coordinator\.ensureLegacyIdentity\(/u)
  assert.match(persistenceSource, /await this\.#coordinator\.bootstrapIndexedDbAuthority\(/u)
  assert.doesNotMatch(persistenceSource, /this\.#legacy\.ensureIdentity\(/u)
  assert.doesNotMatch(persistenceSource, /this\.#legacy\.writeCompatibilityMarker\(/u)
  assert.doesNotMatch(persistenceSource, /\bbackend\.commit\(/u)
})
