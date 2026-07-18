import assert from 'node:assert/strict'
import test from 'node:test'
import { IndexedDbDashboardStorageBackend } from '../src/lib/storage/indexeddb-backend.mjs'
import { DASHBOARD_MATERIAL_GC_STORE_NAMES } from '../src/lib/storage/material-gc.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'
import { DASHBOARD_STORAGE_STORES, DASHBOARD_STORAGE_STORE_NAMES } from '../src/lib/storage/schema.mjs'

const clone = value => (value === undefined ? undefined : structuredClone(value))
const encode = key => JSON.stringify(key)

class FakeRequest {
  result = undefined
  error = null
  onsuccess = null
  onerror = null
}

class FakeTransaction {
  constructor(database, names, mode) {
    this.database = database
    this.names = new Set(names)
    this.mode = mode
    this.error = null
    this.oncomplete = null
    this.onerror = null
    this.onabort = null
    this.aborted = false
    this.completed = false
    this.pending = 0
    this.timer = null
    this.stage = new Map(
      [...database.records].map(([name, records]) => [
        name,
        new Map([...records].map(([key, value]) => [key, clone(value)])),
      ]),
    )
  }

  objectStore(name) {
    if (!this.names.has(name)) throw new DOMException(`Store ${name} is outside the transaction`, 'NotFoundError')
    const records = this.stage.get(name)
    const descriptor = this.database.descriptors.get(name)
    const request = operation => this.request(operation)
    const recordKey = value => {
      const parts = Array.isArray(descriptor.keyPath) ? descriptor.keyPath : [descriptor.keyPath]
      const key = parts.map(part => value[part])
      return parts.length === 1 ? key[0] : key
    }
    return {
      get: key => request(() => clone(records.get(encode(key)))),
      getAll: () => request(() => [...records.values()].map(clone)),
      put: value =>
        request(() => {
          this.database.consumeWriteFault()
          const key = recordKey(value)
          records.set(encode(key), clone(value))
          return key
        }),
      add: value =>
        request(() => {
          this.database.consumeWriteFault()
          const key = recordKey(value)
          if (records.has(encode(key))) throw new DOMException('Record exists', 'ConstraintError')
          records.set(encode(key), clone(value))
          return key
        }),
      delete: key =>
        request(() => {
          this.database.consumeWriteFault()
          records.delete(encode(key))
        }),
    }
  }

  request(operation) {
    if (this.completed || this.aborted) throw new DOMException('Transaction is inactive', 'TransactionInactiveError')
    const request = new FakeRequest()
    this.pending += 1
    if (this.timer) clearTimeout(this.timer)
    queueMicrotask(() => {
      if (this.aborted) return
      try {
        request.result = operation()
        request.onsuccess?.({ target: request })
      } catch (error) {
        request.error = error
        request.onerror?.({ target: request })
        this.fail(error)
      } finally {
        this.pending -= 1
        this.scheduleCompletion()
      }
    })
    return request
  }

  scheduleCompletion() {
    if (this.pending !== 0 || this.aborted || this.completed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.pending !== 0 || this.aborted || this.completed) return
      this.completed = true
      if (this.mode === 'readwrite') this.database.records = this.stage
      this.oncomplete?.({ target: this })
    }, 0)
  }

  fail(error) {
    if (this.aborted || this.completed) return
    this.error = error
    this.aborted = true
    this.onerror?.({ target: this })
    this.onabort?.({ target: this })
  }

  abort() {
    this.fail(new DOMException('Transaction aborted', 'AbortError'))
  }
}

class FakeDatabase {
  constructor() {
    this.version = 0
    this.closed = false
    this.records = new Map()
    this.descriptors = new Map()
    this.writeFault = null
    this.objectStoreNames = {
      contains: name => this.descriptors.has(name),
    }
  }

  createObjectStore(name, options) {
    this.descriptors.set(name, clone(options))
    this.records.set(name, new Map())
    return { name }
  }

  transaction(names, mode) {
    if (this.closed) throw new DOMException('Database is closed', 'InvalidStateError')
    return new FakeTransaction(this, Array.isArray(names) ? names : [names], mode)
  }

  close() {
    this.closed = true
  }

  consumeWriteFault() {
    if (!this.writeFault) return
    if (this.writeFault.successfulWrites > 0) {
      this.writeFault.successfulWrites -= 1
      return
    }
    const { error } = this.writeFault
    this.writeFault = null
    throw error
  }
}

const createFactory = () => {
  const database = new FakeDatabase()
  const opens = []
  return {
    database,
    opens,
    open(name, version) {
      opens.push({ name, version })
      const request = new FakeRequest()
      request.onupgradeneeded = null
      request.onblocked = null
      request.transaction = null
      queueMicrotask(() => {
        request.result = database
        if (database.version < version) {
          const oldVersion = database.version
          database.version = version
          request.onupgradeneeded?.({ oldVersion, newVersion: version, target: request })
        }
        request.onsuccess?.({ target: request })
      })
      return request
    },
  }
}

const projectHash = `sha256:${'1'.repeat(64)}`
const createBatch = (expectedDraftGeneration, operations = []) => ({
  schemaVersion: 1,
  batchId: `batch-${expectedDraftGeneration + 1}`,
  projectId: 'project-1',
  branchId: 'main',
  expectedDraftGeneration,
  draft: {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    draftGeneration: expectedDraftGeneration + 1,
    activeDocument: null,
    projectSchema: { value: expectedDraftGeneration + 1 },
    projectHash,
    commitKind: 'manual-save',
    updatedAt: expectedDraftGeneration + 1,
  },
  operations,
})

const createAgentBatch = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'main',
  sessionId: 'session-1',
  batchId: 'agent-batch-1',
  expectedPersistenceGeneration: 0,
  records: [{ recordId: 'journal-1', kind: 'journal', value: { phase: 'OBSERVE' } }],
  ...overrides,
})

const createReceiptIntent = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'main',
  callId: 'call-1',
  preparedHash: `sha256:${'a'.repeat(64)}`,
  baseRevision: 'revision-1',
  preImages: { title: 'Before' },
  expectedPostImages: { title: 'After' },
  status: 'pending',
  ...overrides,
})

test('IndexedDB backend opens the frozen database version and installs the complete local schema', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })

  assert.equal(await backend.get('projects', 'missing'), undefined)
  assert.deepEqual(indexedDB.opens, [{ name: 'easy-editor-dashboard-storage', version: 1 }])
  assert.deepEqual([...indexedDB.database.descriptors], Object.entries(DASHBOARD_STORAGE_STORES))
  assert.deepEqual(
    [...indexedDB.database.records],
    DASHBOARD_STORAGE_STORE_NAMES.map(name => [name, new Map()]),
  )
})

test('IndexedDB material GC snapshot reads every relevant store in one readonly transaction', async () => {
  const indexedDB = createFactory()
  const transactions = []
  const transaction = indexedDB.database.transaction.bind(indexedDB.database)
  indexedDB.database.transaction = (names, mode) => {
    transactions.push({ names: [...names], mode })
    return transaction(names, mode)
  }
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })

  const snapshot = await backend.readMaterialGcStoreSnapshot('project-1')
  assert.deepEqual(transactions, [{ names: [...DASHBOARD_MATERIAL_GC_STORE_NAMES], mode: 'readonly' }])
  assert.deepEqual(Object.keys(snapshot.stores), [...DASHBOARD_MATERIAL_GC_STORE_NAMES])
  assert.equal(
    Object.values(snapshot.stores).every(records => records.length === 0),
    true,
  )
})

test('IndexedDB backend performs generation CAS and all store writes in one read-write transaction', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  await backend.commit(
    createBatch(0, [
      {
        type: 'put',
        store: 'toolReceipts',
        value: { projectId: 'project-1', branchId: 'main', callId: 'call-1', status: 'committed' },
      },
    ]),
  )

  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 1)
  assert.equal((await backend.get('toolReceipts', ['project-1', 'main', 'call-1'])).status, 'committed')
  await assert.rejects(backend.commit(createBatch(0)), error => error.code === 'generation-conflict')
})

test('IndexedDB backend matches conservative Agent provenance invalidation and unchanged-save preservation', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  const agentSlot = 'project-1/main/title-1/props/text'
  const humanSlot = 'project-1/main/title-2/props/text'
  const agentProvenance = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    slotKey: agentSlot,
    draftGeneration: 1,
    token: 'agent:call-1',
  }
  const humanProvenance = { ...agentProvenance, slotKey: humanSlot, token: 'human' }
  const invalidate = { type: 'invalidate-agent-provenance', store: 'mutationProvenance' }

  await backend.commit(
    createBatch(0, [
      { type: 'put', store: 'mutationProvenance', value: agentProvenance },
      { type: 'put', store: 'mutationProvenance', value: humanProvenance },
    ]),
  )
  await backend.commit(createBatch(1, [invalidate]))
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', agentSlot]), agentProvenance)

  const changed = createBatch(2, [invalidate])
  changed.draft.projectHash = `sha256:${'2'.repeat(64)}`
  await backend.commit(changed)
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', agentSlot]), {
    ...agentProvenance,
    draftGeneration: 3,
    token: 'unknown',
  })
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', humanSlot]), humanProvenance)

  const stale = createBatch(0, [invalidate])
  stale.draft.projectHash = `sha256:${'3'.repeat(64)}`
  await assert.rejects(backend.commit(stale), error => error.code === 'generation-conflict')
  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 3)
})

test('IndexedDB quota abort rolls back the draft and provenance invalidation together', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  const agentSlot = 'project-1/main/title-1/props/text'
  await backend.commit(
    createBatch(0, [
      {
        type: 'put',
        store: 'mutationProvenance',
        value: {
          schemaVersion: 1,
          projectId: 'project-1',
          branchId: 'main',
          slotKey: agentSlot,
          draftGeneration: 1,
          token: 'agent:call-1',
        },
      },
    ]),
  )
  indexedDB.database.writeFault = {
    successfulWrites: 1,
    error: new DOMException('Full', 'QuotaExceededError'),
  }
  const changed = createBatch(1, [{ type: 'invalidate-agent-provenance', store: 'mutationProvenance' }])
  changed.draft.projectHash = `sha256:${'2'.repeat(64)}`

  await assert.rejects(backend.commit(changed), error => error.code === 'quota-exceeded')
  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 1)
  assert.equal((await backend.get('mutationProvenance', ['project-1', 'main', agentSlot])).token, 'agent:call-1')
})

test('IndexedDB backend maps quota aborts and leaves no partial transaction state', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  await backend.commit(createBatch(0))
  indexedDB.database.writeFault = {
    successfulWrites: 2,
    error: new DOMException('Full', 'QuotaExceededError'),
  }

  await assert.rejects(
    backend.commit(
      createBatch(1, [
        {
          type: 'put',
          store: 'projects',
          value: { projectId: 'project-1', updatedAt: 2 },
        },
        {
          type: 'put',
          store: 'toolReceipts',
          value: { projectId: 'project-1', branchId: 'main', callId: 'call-2', status: 'committed' },
        },
      ]),
    ),
    error => error.code === 'quota-exceeded',
  )
  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 1)
  assert.equal(await backend.get('projects', 'project-1'), undefined)
  assert.equal(await backend.get('toolReceipts', ['project-1', 'main', 'call-2']), undefined)
})

test('IndexedDB backend reports a blocked open distinctly', async () => {
  const indexedDB = {
    open() {
      const request = new FakeRequest()
      request.onblocked = null
      queueMicrotask(() => request.onblocked?.({ oldVersion: 0, newVersion: 1, target: request }))
      return request
    },
  }
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })

  await assert.rejects(backend.get('projects', 'project-1'), error => error.code === 'database-blocked')
})

test('IndexedDB backend writes migration failure state through a typed single-store transaction', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  const record = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    status: 'failed',
    source: 'page-fragments',
    sourceDraftGeneration: 0,
    targetGeneration: null,
    diagnostics: [{ code: 'partial-page-fragments' }],
    updatedAt: 7,
  }

  assert.deepEqual(await backend.putMigrationState(record), record)
  assert.deepEqual(await backend.get('migrationState', ['project-1', 'main']), record)
})

test('IndexedDB Agent persistence matches durable session idempotency without advancing a working draft', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  const firstBatch = createAgentBatch()

  assert.equal((await backend.commitAgentPersistence(firstBatch)).persistenceGeneration, 1)
  assert.deepEqual(await backend.commitAgentPersistence(firstBatch), {
    schemaVersion: 1,
    batchId: 'agent-batch-1',
    status: 'committed',
    persistenceGeneration: 1,
  })
  assert.equal((await backend.commitAgentPersistence(createAgentBatch({ records: [] }))).status, 'rejected')
  const stale = createAgentBatch({
    batchId: 'agent-stale',
    records: [{ recordId: 'must-not-write', kind: 'journal', value: { phase: 'STALE' } }],
  })
  assert.deepEqual(await backend.commitAgentPersistence(stale), {
    schemaVersion: 1,
    batchId: 'agent-stale',
    status: 'generation-conflict',
    persistenceGeneration: 1,
  })
  await backend.commitAgentPersistence(
    createAgentBatch({
      batchId: 'agent-batch-2',
      expectedPersistenceGeneration: 1,
      records: [
        { recordId: 'journal-1', kind: 'journal', value: { phase: 'VERIFY' } },
        { recordId: 'checkpoint-1', kind: 'checkpoint', value: { verified: true } },
      ],
    }),
  )
  assert.deepEqual(await backend.commitAgentPersistence(stale), {
    schemaVersion: 1,
    batchId: 'agent-stale',
    status: 'generation-conflict',
    persistenceGeneration: 1,
  })
  assert.deepEqual(
    (
      await backend.readAgentPersistence({
        schemaVersion: 1,
        projectId: 'project-1',
        branchId: 'main',
        sessionId: 'session-1',
        expectedPersistenceGeneration: 0,
      })
    ).records,
    [
      { recordId: 'checkpoint-1', kind: 'checkpoint', value: { verified: true } },
      { recordId: 'journal-1', kind: 'journal', value: { phase: 'VERIFY' } },
    ],
  )
  assert.equal(await backend.get('taskJournals', ['project-1', 'main', 'session-1', 'must-not-write']), undefined)
  assert.equal(await backend.get('workingDrafts', ['project-1', 'main']), undefined)
})

test('IndexedDB Agent persistence quota abort rolls back session, journal, and idempotency checkpoint', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  indexedDB.database.writeFault = {
    successfulWrites: 2,
    error: new DOMException('Full', 'QuotaExceededError'),
  }

  await assert.rejects(backend.commitAgentPersistence(createAgentBatch()), error => error.code === 'quota-exceeded')
  assert.deepEqual(await backend.getAll('agentSessions'), [])
  assert.deepEqual(await backend.getAll('taskJournals'), [])
  assert.deepEqual(await backend.getAll('agentCheckpoints'), [])
})

test('IndexedDB receipt intent CAS and lineage lookup share the narrow durable contract', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  const intent = createReceiptIntent()
  assert.deepEqual(await backend.putReceiptIntent(intent), intent)
  assert.deepEqual(await backend.putReceiptIntent(intent), intent)
  await assert.rejects(
    backend.putReceiptIntent(createReceiptIntent({ baseRevision: 'other' })),
    error => error.code === 'integrity-mismatch',
  )
  await backend.commit(
    createBatch(0, [
      {
        type: 'put',
        store: 'toolReceipts',
        value: { schemaVersion: 1, projectId: 'project-1', branchId: 'main', callId: 'call-1', status: 'applied' },
      },
      {
        type: 'put',
        store: 'failureWitnesses',
        value: { schemaVersion: 1, projectId: 'project-1', branchId: 'main', callId: 'call-1', draftGeneration: 1 },
      },
      {
        type: 'put',
        store: 'mutationProvenance',
        value: {
          schemaVersion: 1,
          projectId: 'project-1',
          branchId: 'main',
          slotKey: 'slot-agent',
          token: 'agent:call-1',
        },
      },
      {
        type: 'put',
        store: 'mutationProvenance',
        value: {
          schemaVersion: 1,
          projectId: 'project-1',
          branchId: 'main',
          slotKey: 'slot-other',
          token: 'agent:call-2',
        },
      },
    ]),
  )

  const lineage = await backend.readReceiptLineage({ projectId: 'project-1', branchId: 'main', callId: 'call-1' })
  assert.deepEqual(lineage.receiptIntent, intent)
  assert.equal(lineage.receipt.status, 'applied')
  assert.equal(lineage.applyWitness, null)
  assert.equal(lineage.failureWitness.draftGeneration, 1)
  assert.deepEqual(
    lineage.provenance.map(record => record.slotKey),
    ['slot-agent'],
  )
})

test('IndexedDB coordinator matches Phase 4 session, version, grant, restore, and root lifecycle semantics', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const projectSchema = {
    componentsTree: [
      {
        componentName: 'GeneratedMaterialHost',
        id: 'root',
        $agent: {
          schemaVersion: 1,
          artifactRef: {
            artifactId: 'artifact-1',
            sourceRevision: 'revision-1',
            logicalComponentId: 'logical-artifact-1',
            sourceIntegrity: `sha256:${'a'.repeat(64)}`,
            target: { kind: 'online' },
          },
        },
      },
    ],
  }
  await coordinator.commit({
    schemaVersion: 1,
    batchId: 'phase-4-bootstrap',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 0,
    activeDocument: null,
    projectSchema,
    commitKind: 'manual-save',
    updatedAt: 1,
    operations: [
      {
        type: 'put',
        store: 'artifacts',
        value: {
          schemaVersion: 1,
          projectId: 'project-1',
          artifactId: 'artifact-1',
          sourceRevision: 'revision-1',
        },
      },
    ],
  })
  const session = await coordinator.saveAgentSession({
    schemaVersion: 1,
    batchId: 'phase-4-session',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 1,
    sessionId: 'session-1',
    status: 'active',
    createdAt: 2,
    updatedAt: 2,
    forkedFrom: null,
  })
  await coordinator.commitAgentPersistence({
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    sessionId: 'session-1',
    batchId: 'phase-4-journal',
    expectedPersistenceGeneration: 0,
    records: [{ recordId: 'task:1', kind: 'journal-head', value: { taskId: 'task-1' } }],
  })
  assert.deepEqual(await backend.get('agentSessions', ['project-1', 'main', 'session-1']), {
    ...session.session,
    persistenceGeneration: 1,
  })

  const version = await coordinator.createProjectVersion({
    schemaVersion: 1,
    batchId: 'phase-4-version',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 2,
    versionId: 'version-1',
    name: 'Version 1',
    createdAt: 3,
    artifactRefs: [{ artifactId: 'artifact-1', sourceRevision: 'revision-1' }],
    sourceSessionId: 'session-1',
    sourceTaskId: 'task-1',
    sourceCheckpointId: null,
  })
  assert.equal(version.draft.draftGeneration, 3)
  assert.equal(
    (
      await coordinator.createProjectVersion({
        schemaVersion: 1,
        batchId: 'phase-4-version',
        projectId: 'project-1',
        branchId: 'main',
        expectedDraftGeneration: 2,
        versionId: 'version-1',
        name: 'Version 1',
        createdAt: 3,
        artifactRefs: [{ artifactId: 'artifact-1', sourceRevision: 'revision-1' }],
        sourceSessionId: 'session-1',
        sourceTaskId: 'task-1',
        sourceCheckpointId: null,
      })
    ).status,
    'reconciled',
  )

  const tasklessVersion = await coordinator.createProjectVersion({
    schemaVersion: 1,
    batchId: 'phase-4-version-taskless',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 3,
    versionId: 'version-taskless',
    name: 'Version taskless',
    createdAt: 4,
    artifactRefs: [{ artifactId: 'artifact-1', sourceRevision: 'revision-1' }],
    sourceSessionId: null,
    sourceTaskId: null,
    sourceCheckpointId: null,
  })
  assert.equal(tasklessVersion.draft.draftGeneration, 4)

  await coordinator.authorizeLocalGrant({
    schemaVersion: 1,
    batchId: 'phase-4-grant',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 4,
    userId: 'user-1',
    scope: 'project.write',
    policyVersion: 1,
    providerId: 'provider-1',
    providerFingerprint: 'fingerprint-1',
    updatedAt: 5,
  })
  assert.equal(
    (
      await coordinator.checkLocalGrant({
        schemaVersion: 1,
        userId: 'user-1',
        projectId: 'project-1',
        scope: 'project.write',
        policyVersion: 1,
        providerId: 'provider-1',
        providerFingerprint: 'fingerprint-1',
      })
    ).granted,
    true,
  )

  const roots = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId: 'project-1' })
  assert.equal(roots.deletionCandidates.length, 0)
  assert.deepEqual(roots.generationFence, [{ branchId: 'main', draftGeneration: 5 }])

  const restored = await coordinator.restoreProjectVersion({
    schemaVersion: 1,
    batchId: 'phase-4-restore',
    projectId: 'project-1',
    sourceBranchId: 'main',
    versionId: 'version-1',
    targetBranchId: 'restored',
    targetSessionId: 'session-2',
    forkedFromSessionId: 'session-1',
    forkedFromTaskId: 'task-1',
    restoredAt: 6,
  })
  assert.equal(restored.draft.branchId, 'restored')
  assert.equal(restored.session.forkedFrom.versionId, 'version-1')
  assert.equal(await backend.get('taskJournals', ['project-1', 'restored', 'session-2', 'task:1']), undefined)

  const restoredTaskless = await coordinator.restoreProjectVersion({
    schemaVersion: 1,
    batchId: 'phase-4-restore-taskless',
    projectId: 'project-1',
    sourceBranchId: 'main',
    versionId: 'version-taskless',
    targetBranchId: 'restored-taskless',
    targetSessionId: 'session-taskless',
    forkedFromSessionId: null,
    forkedFromTaskId: null,
    restoredAt: 7,
  })
  assert.deepEqual(restoredTaskless.session.forkedFrom, {
    sessionId: null,
    taskId: null,
    versionId: 'version-taskless',
  })
  assert.equal(
    (
      await coordinator.restoreProjectVersion({
        schemaVersion: 1,
        batchId: 'phase-4-restore-taskless',
        projectId: 'project-1',
        sourceBranchId: 'main',
        versionId: 'version-taskless',
        targetBranchId: 'restored-taskless',
        targetSessionId: 'session-taskless',
        forkedFromSessionId: null,
        forkedFromTaskId: null,
        restoredAt: 7,
      })
    ).status,
    'reconciled',
  )
})

test('IndexedDB immutable artifact/root APIs and atomic GC sweep match Memory semantics', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const artifact = {
    schemaVersion: 1,
    projectId: 'project-1',
    artifactId: 'artifact-live',
    sourceRevision: 'revision-1',
    logicalComponentId: 'logical-live',
    sourceIntegrity: `sha256:${'a'.repeat(64)}`,
    source: 'export default { mount() {}, update() {}, destroy() {} }',
    css: '',
    safeManifest: { schemaVersion: 1 },
    lockedDependencies: [],
    dependencyLockDigest: `sha256:${'b'.repeat(64)}`,
    diagnostics: [],
    provenance: { actor: 'test' },
    createdAt: 1,
    supersedes: null,
  }
  const liveRoot = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    ownerType: 'working-draft',
    ownerId: 'main',
    artifactId: 'artifact-live',
    sourceRevision: 'revision-1',
  }
  const missingRoot = {
    ...liveRoot,
    ownerType: 'receipt-intent',
    ownerId: 'call-missing',
    artifactId: 'artifact-missing',
    sourceRevision: 'revision-9',
  }

  assert.equal((await backend.createArtifact(artifact)).status, 'created')
  assert.equal((await backend.createArtifact(artifact)).status, 'reconciled')
  await assert.rejects(
    backend.createArtifact({ ...artifact, css: ':host { display: none; }' }),
    error =>
      error.code === 'integrity-mismatch' && error.reason === 'artifact-revision-was-reused-with-different-bytes',
  )
  assert.equal((await backend.createArtifactRoot(liveRoot)).status, 'created')
  assert.equal((await backend.createArtifactRoot(liveRoot)).status, 'reconciled')
  await backend.createArtifactRoot(missingRoot)
  await coordinator.createArtifact({
    ...artifact,
    artifactId: 'artifact-orphan',
    sourceRevision: 'revision-2',
    logicalComponentId: 'logical-orphan',
    sourceIntegrity: `sha256:${'c'.repeat(64)}`,
  })
  await coordinator.commit({
    schemaVersion: 1,
    batchId: 'artifact-gc-draft-1',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 0,
    activeDocument: null,
    projectSchema: {
      componentsTree: [
        {
          id: 'generated-live',
          componentName: 'GeneratedMaterialHost',
          $agent: {
            schemaVersion: 1,
            artifactRef: {
              artifactId: artifact.artifactId,
              sourceRevision: artifact.sourceRevision,
              logicalComponentId: artifact.logicalComponentId,
              sourceIntegrity: artifact.sourceIntegrity,
              target: { kind: 'online' },
            },
          },
        },
      ],
    },
    commitKind: 'manual-save',
    updatedAt: 1,
    operations: [],
  })

  const restartedBackend = new IndexedDbDashboardStorageBackend({ indexedDB })
  assert.deepEqual(
    await restartedBackend.readArtifact({
      schemaVersion: 1,
      projectId: 'project-1',
      artifactId: 'artifact-live',
      sourceRevision: 'revision-1',
    }),
    artifact,
  )
  assert.deepEqual(await restartedBackend.readArtifactRoot(liveRoot), liveRoot)

  const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId: 'project-1' })
  assert.deepEqual(plan.missingArtifacts, [
    { artifactId: 'artifact-missing', sourceRevision: 'revision-9', referenceCount: 1 },
  ])
  assert.deepEqual(plan.deletionCandidates, [{ artifactId: 'artifact-orphan', sourceRevision: 'revision-2' }])
  const result = await coordinator.sweepArtifactGc(plan)
  assert.deepEqual(result.deletedArtifacts, plan.deletionCandidates)
  assert.equal(await backend.get('artifacts', ['project-1', 'artifact-orphan', 'revision-2']), undefined)
  assert.deepEqual(await backend.readArtifactRoot(liveRoot), liveRoot)
  assert.deepEqual(await backend.readArtifactRoot(missingRoot), missingRoot)
  await restartedBackend.dispose()
})

test('IndexedDB GC transaction revalidates the root fence even with no deletion candidates', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  await coordinator.commit({
    schemaVersion: 1,
    batchId: 'artifact-gc-empty-draft-1',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 0,
    activeDocument: null,
    projectSchema: { value: 1 },
    commitKind: 'manual-save',
    updatedAt: 1,
    operations: [],
  })
  const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId: 'project-1' })
  assert.deepEqual(plan.deletionCandidates, [])

  await backend.createArtifactRoot({
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    ownerType: 'checkpoint',
    ownerId: 'checkpoint-late',
    artifactId: 'artifact-missing',
    sourceRevision: 'revision-late',
  })
  await assert.rejects(
    coordinator.sweepArtifactGc(plan),
    error => error.code === 'generation-conflict' && error.reason === 'artifact-gc-root-fence-changed',
  )
  assert.equal((await backend.getAll('artifactRefs')).length, 1)
})

test('IndexedDB quota abort rolls back canonical draft replacement and exact working-draft root reconciliation together', async () => {
  const indexedDB = createFactory()
  const backend = new IndexedDbDashboardStorageBackend({ indexedDB })
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const ref = sourceRevision => ({
    artifactId: 'artifact-atomic-root',
    sourceRevision,
    logicalComponentId: 'logical-atomic-root',
    sourceIntegrity: `sha256:${'a'.repeat(64)}`,
    target: { kind: 'online' },
  })
  const schema = artifactRef => ({
    componentsTree: [
      {
        id: 'generated-atomic-root',
        componentName: 'GeneratedMaterialHost',
        $agent: { schemaVersion: 1, artifactRef },
      },
    ],
  })
  const rootKey = sourceRevision => [
    'project-1',
    'main',
    'working-draft',
    'main',
    'artifact-atomic-root',
    sourceRevision,
  ]

  await coordinator.commit({
    schemaVersion: 1,
    batchId: 'atomic-root-bootstrap',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 0,
    activeDocument: null,
    projectSchema: schema(ref('revision-1')),
    commitKind: 'manual-save',
    updatedAt: 1,
    operations: [],
  })
  indexedDB.database.writeFault = {
    successfulWrites: 1,
    error: new DOMException('Full', 'QuotaExceededError'),
  }

  await assert.rejects(
    coordinator.commit({
      schemaVersion: 1,
      batchId: 'atomic-root-replacement',
      projectId: 'project-1',
      branchId: 'main',
      expectedDraftGeneration: 1,
      activeDocument: null,
      projectSchema: schema(ref('revision-2')),
      commitKind: 'manual-save',
      updatedAt: 2,
      operations: [],
    }),
    error => error.code === 'quota-exceeded',
  )

  assert.equal((await coordinator.readWorkingDraft({ projectId: 'project-1', branchId: 'main' })).draftGeneration, 1)
  assert.notEqual(await backend.get('artifactRefs', rootKey('revision-1')), undefined)
  assert.equal(await backend.get('artifactRefs', rootKey('revision-2')), undefined)
})
