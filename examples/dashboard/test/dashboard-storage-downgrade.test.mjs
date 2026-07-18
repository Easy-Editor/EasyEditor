import assert from 'node:assert/strict'
import test from 'node:test'
import { hashCanonicalJson } from '../src/lib/storage/canonical-json.mjs'
import {
  createStorageCompatibilityMarker,
  readStorageCompatibilityMarker,
  writeStorageCompatibilityMarker,
} from '../src/lib/storage/compatibility-marker.mjs'
import {
  materializeLegacyFromCanonical,
  refreshIndexedDbCompatibilitySnapshot,
  selectForwardReentryDraft,
} from '../src/lib/storage/downgrade.mjs'
import { requestLegacySnapshotLock } from '../src/lib/storage/legacy-snapshot-lock.mjs'
import { createLegacyStorageAdapter, legacySnapshotMetadataKey } from '../src/lib/storage/legacy-storage.mjs'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'

class MemoryLocalStorage {
  #entries = new Map()
  #writeTransform

  constructor({ entries = {}, writeTransform = null } = {}) {
    this.#writeTransform = writeTransform
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
    const transformed = this.#writeTransform?.(key, String(value)) ?? String(value)
    this.#entries.set(key, transformed)
  }

  removeItem(key) {
    this.#entries.delete(key)
  }
}

class SharedExclusiveLockManager {
  #tails = new Map()
  requests = []

  request(name, _options, operation) {
    this.requests.push(name)
    const previous = this.#tails.get(name) ?? Promise.resolve()
    const task = previous.then(() => operation({ name, mode: 'exclusive' }))
    const settled = task.then(
      () => undefined,
      () => undefined,
    )
    this.#tails.set(name, settled)
    settled.then(() => {
      if (this.#tails.get(name) === settled) this.#tails.delete(name)
    })
    return task
  }
}

const projectSchema = {
  componentsMap: [{ componentName: 'Chart' }],
  componentsTree: [
    { componentName: 'Page', fileName: 'overview', id: 'page-overview', title: '总览' },
    { componentName: 'Page', fileName: 'detail', id: 'page-detail', title: '详情' },
  ],
  config: { theme: 'dark' },
  dataSource: { list: [{ id: 'source-1', type: 'mock' }] },
  meta: { owner: 'customer-a' },
  version: '1.0.0',
}

const createDraft = async (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'main',
  draftGeneration: 7,
  activeDocument: { documentId: 'page-detail', fileName: 'detail', index: 1 },
  projectSchema,
  projectHash: await hashCanonicalJson(projectSchema),
  commitKind: 'manual-save',
  updatedAt: 700,
  ...overrides,
})

const setIndexedDbMarker = (storage, draft) =>
  writeStorageCompatibilityMarker(storage, {
    canonicalBackend: 'indexeddb',
    projectId: draft.projectId,
    branchId: draft.branchId,
    draftGeneration: draft.draftGeneration,
    projectHash: draft.projectHash,
    updatedAt: draft.updatedAt,
  })

test('node runtimes use the deterministic local lock instead of navigator.locks', async () => {
  const ownNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  if (globalThis.navigator === undefined) {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    })
  }

  const runtimeNavigator = globalThis.navigator
  const ownLocks = Object.getOwnPropertyDescriptor(runtimeNavigator, 'locks')
  let platformRequests = 0
  Object.defineProperty(runtimeNavigator, 'locks', {
    configurable: true,
    value: {
      request() {
        platformRequests += 1
        throw new Error('node-platform-lock-must-not-be-used')
      },
    },
  })

  try {
    const result = await requestLegacySnapshotLock(
      { scope: { projectId: 'project-node-lock', branchId: 'main' } },
      () => 'local-lock-completed',
    )
    assert.equal(result, 'local-lock-completed')
    assert.equal(platformRequests, 0)
  } finally {
    if (ownLocks) Object.defineProperty(runtimeNavigator, 'locks', ownLocks)
    else Reflect.deleteProperty(runtimeNavigator, 'locks')

    if (ownNavigator) Object.defineProperty(globalThis, 'navigator', ownNavigator)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})

test('downgrade materializes and verifies full/page legacy bytes before changing the marker last', async () => {
  const draft = await createDraft()
  const storage = new MemoryLocalStorage()
  setIndexedDbMarker(storage, draft)
  const writes = []
  const originalSet = storage.setItem.bind(storage)
  storage.setItem = (key, value) => {
    writes.push(key)
    originalSet(key, value)
  }

  const result = await materializeLegacyFromCanonical({
    legacy: createLegacyStorageAdapter(storage),
    draft,
    now: () => 701,
  })

  assert.equal(result.status, 'materialized')
  assert.deepEqual(JSON.parse(storage.getItem('projectSchema')), projectSchema)
  assert.deepEqual(JSON.parse(storage.getItem('pageInfo')), [
    { path: 'overview', title: '总览' },
    { path: 'detail', title: '详情' },
  ])
  assert.deepEqual(JSON.parse(storage.getItem('pageSchema:overview')), {
    ...projectSchema,
    componentsTree: [projectSchema.componentsTree[0]],
  })
  assert.deepEqual(JSON.parse(storage.getItem('pageSchema:detail')), {
    ...projectSchema,
    componentsTree: [projectSchema.componentsTree[1]],
  })
  assert.deepEqual(JSON.parse(storage.getItem(legacySnapshotMetadataKey(draft))), {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    draftGeneration: 7,
    projectHash: draft.projectHash,
    updatedAt: 701,
  })
  assert.equal(writes.at(-1), 'easy-editor:storage:compatibility:v1')
  assert.deepEqual(readStorageCompatibilityMarker(storage).marker, {
    ...createStorageCompatibilityMarker({
      canonicalBackend: 'legacy-local-storage',
      projectId: 'project-1',
      branchId: 'main',
      draftGeneration: 7,
      projectHash: draft.projectHash,
      updatedAt: 701,
    }),
  })
})

test('coordinator downgrade linearizes after an earlier save and never accepts a stale caller draft', async () => {
  const inner = new MemoryDashboardStorageBackend()
  let blockNextCommit = false
  let markSaveEntered
  let releaseSave
  let workingDraftReads = 0
  const saveEntered = new Promise(resolve => {
    markSaveEntered = resolve
  })
  const saveGate = new Promise(resolve => {
    releaseSave = resolve
  })
  const backend = {
    async get(store, key) {
      if (store === 'workingDrafts') workingDraftReads += 1
      return inner.get(store, key)
    },
    async commit(batch) {
      if (blockNextCommit) {
        blockNextCommit = false
        markSaveEntered()
        await saveGate
      }
      return inner.commit(batch)
    },
    flush: () => inner.flush(),
    dispose: () => inner.dispose(),
  }
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const initialSchema = { ...projectSchema, meta: { owner: 'before-racing-save' } }
  const initial = (
    await coordinator.commit({
      schemaVersion: 1,
      batchId: 'initial-save',
      projectId: 'project-1',
      branchId: 'main',
      expectedDraftGeneration: 0,
      activeDocument: { documentId: 'page-detail', fileName: 'detail', index: 1 },
      projectSchema: initialSchema,
      commitKind: 'manual-save',
      updatedAt: 700,
      operations: [],
    })
  ).draft
  const storage = new MemoryLocalStorage()
  setIndexedDbMarker(storage, initial)
  const legacy = createLegacyStorageAdapter(storage)

  const latestSchema = { ...projectSchema, meta: { owner: 'racing-save-won' } }
  blockNextCommit = true
  const saving = coordinator.commit({
    schemaVersion: 1,
    batchId: 'racing-save',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 1,
    activeDocument: { documentId: 'page-overview', fileName: 'overview', index: 0 },
    projectSchema: latestSchema,
    commitKind: 'manual-save',
    updatedAt: 701,
    operations: [],
  })
  await saveEntered

  await assert.rejects(
    coordinator.downgradeToLegacy({
      projectId: 'project-1',
      branchId: 'main',
      legacy,
      draft: initial,
    }),
    error =>
      error.code === 'validation-failed' && error.reason === 'project-persistence-downgrade-fields-must-match-contract',
  )
  const downgrade = coordinator.downgradeToLegacy({
    projectId: 'project-1',
    branchId: 'main',
    legacy,
    now: () => 702,
  })

  await Promise.resolve()
  assert.equal(workingDraftReads, 0)
  assert.equal(storage.getItem('projectSchema'), null)
  assert.equal(readStorageCompatibilityMarker(storage).marker.canonicalBackend, 'indexeddb')

  releaseSave()
  const [saved, downgraded] = await Promise.all([saving, downgrade])
  assert.equal(saved.draft.draftGeneration, 2)
  assert.equal(workingDraftReads, 1)
  assert.equal(downgraded.metadata.draftGeneration, 2)
  assert.equal(downgraded.metadata.projectHash, saved.draft.projectHash)
  assert.deepEqual(JSON.parse(storage.getItem('projectSchema')), latestSchema)
  const marker = readStorageCompatibilityMarker(storage).marker
  assert.equal(marker.canonicalBackend, 'legacy-local-storage')
  assert.equal(marker.draftGeneration, 2)
  assert.equal(marker.projectHash, saved.draft.projectHash)
})

test('origin lock prevents a second coordinator from committing after downgrade has read its canonical draft', async () => {
  const storage = new MemoryLocalStorage()
  const backend = new MemoryDashboardStorageBackend()
  const lockManager = new SharedExclusiveLockManager()
  const seedCoordinator = new ProjectPersistenceCoordinator({ backend, compatibilityStorage: storage, lockManager })
  const initial = (
    await seedCoordinator.commit({
      schemaVersion: 1,
      batchId: 'cross-runtime-initial-save',
      projectId: 'project-1',
      branchId: 'main',
      expectedDraftGeneration: 0,
      activeDocument: { documentId: 'page-detail', fileName: 'detail', index: 1 },
      projectSchema,
      commitKind: 'manual-save',
      updatedAt: 700,
      operations: [],
    })
  ).draft
  setIndexedDbMarker(storage, initial)

  let markDigestEntered
  let releaseDigest
  const digestEntered = new Promise(resolve => {
    markDigestEntered = resolve
  })
  const digestGate = new Promise(resolve => {
    releaseDigest = resolve
  })
  let blockNextDigest = true
  const gatedCrypto = {
    subtle: {
      async digest(algorithm, data) {
        if (blockNextDigest) {
          blockNextDigest = false
          markDigestEntered()
          await digestGate
        }
        return globalThis.crypto.subtle.digest(algorithm, data)
      },
    },
  }
  const downgradeCoordinator = new ProjectPersistenceCoordinator({
    backend,
    compatibilityStorage: storage,
    crypto: gatedCrypto,
    lockManager,
  })
  const racingCoordinator = new ProjectPersistenceCoordinator({ backend, compatibilityStorage: storage, lockManager })
  const downgrade = downgradeCoordinator.downgradeToLegacy({
    projectId: 'project-1',
    branchId: 'main',
    legacy: createLegacyStorageAdapter(storage),
    now: () => 701,
  })
  await digestEntered

  const racingCommit = racingCoordinator.commit({
    schemaVersion: 1,
    batchId: 'cross-runtime-racing-save',
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 1,
    activeDocument: { documentId: 'page-overview', fileName: 'overview', index: 0 },
    projectSchema: { ...projectSchema, meta: { owner: 'must-not-commit-after-downgrade' } },
    commitKind: 'manual-save',
    updatedAt: 702,
    operations: [],
  })
  const racingRejection = assert.rejects(
    racingCommit,
    error =>
      error.code === 'read-only-compatibility' && error.reason === 'legacy-local-storage-is-canonical-for-project',
  )
  await Promise.resolve()
  assert.equal(lockManager.requests.length, 4)
  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 1)

  releaseDigest()
  const downgraded = await downgrade
  await racingRejection
  assert.equal(downgraded.marker.canonicalBackend, 'legacy-local-storage')
  assert.equal(downgraded.marker.draftGeneration, 1)
  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 1)
  assert.equal(readStorageCompatibilityMarker(storage).marker.draftGeneration, 1)
})

test('every pre-marker crash point leaves IndexedDB canonical and a retry is idempotent', async t => {
  const draft = await createDraft()
  const crashCases = [
    ['after-active-pointer'],
    ['after-project-schema'],
    ['after-page-schema', 0],
    ['after-page-schema', 1],
    ['after-page-info'],
    ['after-snapshot-metadata'],
    ['after-verification'],
  ]

  for (const [targetPoint, targetIndex] of crashCases) {
    await t.test(`${targetPoint}${targetIndex === undefined ? '' : `:${targetIndex}`}`, async () => {
      const storage = new MemoryLocalStorage()
      setIndexedDbMarker(storage, draft)
      const legacy = createLegacyStorageAdapter(storage)

      await assert.rejects(
        materializeLegacyFromCanonical({
          legacy,
          draft,
          crashInjector(event) {
            if (event.point === targetPoint && event.index === targetIndex) throw new Error('simulated-crash')
          },
        }),
        /simulated-crash/,
      )
      assert.equal(readStorageCompatibilityMarker(storage).marker.canonicalBackend, 'indexeddb')

      const retried = await materializeLegacyFromCanonical({ legacy, draft, now: () => 702 })
      assert.equal(retried.status, 'materialized')
      assert.equal(readStorageCompatibilityMarker(storage).marker.canonicalBackend, 'legacy-local-storage')
    })
  }
})

test('read-back hash or generation mismatch aborts before the marker switch', async () => {
  const draft = await createDraft()
  const storage = new MemoryLocalStorage({
    writeTransform(key, value) {
      if (key !== 'projectSchema') return value
      const parsed = JSON.parse(value)
      parsed.meta = { owner: 'tampered' }
      return JSON.stringify(parsed)
    },
  })
  setIndexedDbMarker(storage, draft)

  await assert.rejects(
    materializeLegacyFromCanonical({ legacy: createLegacyStorageAdapter(storage), draft }),
    error => error.code === 'integrity-mismatch' && error.reason === 'legacy-project-hash-verification-failed',
  )
  assert.equal(readStorageCompatibilityMarker(storage).marker.canonicalBackend, 'indexeddb')
})

test('rollback-window refresh verifies V2 legacy bytes while keeping IndexedDB canonical', async () => {
  const previous = await createDraft({ draftGeneration: 7 })
  const v2Project = { ...projectSchema, meta: { owner: 'customer-v2' } }
  const draft = await createDraft({
    draftGeneration: 8,
    projectSchema: v2Project,
    projectHash: await hashCanonicalJson(v2Project),
    updatedAt: 800,
  })
  const storage = new MemoryLocalStorage()
  setIndexedDbMarker(storage, previous)

  const result = await refreshIndexedDbCompatibilitySnapshot({
    legacy: createLegacyStorageAdapter(storage),
    draft,
    now: () => 801,
  })

  assert.equal(result.status, 'refreshed')
  assert.deepEqual(JSON.parse(storage.getItem('projectSchema')), v2Project)
  assert.deepEqual(JSON.parse(storage.getItem(legacySnapshotMetadataKey(draft))), {
    schemaVersion: 1,
    projectId: draft.projectId,
    branchId: draft.branchId,
    draftGeneration: 8,
    projectHash: draft.projectHash,
    updatedAt: 801,
  })
  assert.deepEqual(readStorageCompatibilityMarker(storage).marker, {
    ...createStorageCompatibilityMarker({
      canonicalBackend: 'indexeddb',
      projectId: draft.projectId,
      branchId: draft.branchId,
      draftGeneration: 8,
      projectHash: draft.projectHash,
      updatedAt: 801,
    }),
  })
})

test('shared origin lock serializes two runtimes so an older refresh cannot overwrite newer legacy bytes', async () => {
  const initial = await createDraft({ draftGeneration: 7 })
  const staleProject = { ...projectSchema, meta: { owner: 'stale-runtime' } }
  const stale = await createDraft({
    draftGeneration: 8,
    projectSchema: staleProject,
    projectHash: await hashCanonicalJson(staleProject),
    updatedAt: 800,
  })
  const latestProject = { ...projectSchema, meta: { owner: 'latest-runtime' } }
  const latest = await createDraft({
    draftGeneration: 9,
    projectSchema: latestProject,
    projectHash: await hashCanonicalJson(latestProject),
    updatedAt: 900,
  })
  const storage = new MemoryLocalStorage()
  setIndexedDbMarker(storage, initial)
  const lockManager = new SharedExclusiveLockManager()

  const latestRefresh = refreshIndexedDbCompatibilitySnapshot({
    legacy: createLegacyStorageAdapter(storage),
    draft: latest,
    now: () => 901,
    lockManager,
  })
  const staleRefresh = refreshIndexedDbCompatibilitySnapshot({
    legacy: createLegacyStorageAdapter(storage),
    draft: stale,
    now: () => 801,
    lockManager,
  })

  const [latestResult, staleResult] = await Promise.allSettled([latestRefresh, staleRefresh])
  assert.equal(latestResult.status, 'fulfilled')
  assert.equal(staleResult.status, 'rejected')
  assert.equal(staleResult.reason.code, 'integrity-mismatch')
  assert.equal(staleResult.reason.reason, 'downgrade-draft-is-older-than-indexeddb-marker')
  assert.equal(lockManager.requests.length, 2)
  assert.equal(lockManager.requests[0], lockManager.requests[1])
  assert.deepEqual(JSON.parse(storage.getItem('projectSchema')), latestProject)
  const marker = readStorageCompatibilityMarker(storage).marker
  assert.equal(marker.canonicalBackend, 'indexeddb')
  assert.equal(marker.draftGeneration, 9)
  assert.equal(marker.projectHash, latest.projectHash)
})

test('persistent snapshot fence survives a newer runtime crash and blocks stale runtime recovery writes', async () => {
  const initial = await createDraft({ draftGeneration: 7 })
  const staleProject = { ...projectSchema, meta: { owner: 'stale-recovery-runtime' } }
  const stale = await createDraft({
    draftGeneration: 8,
    projectSchema: staleProject,
    projectHash: await hashCanonicalJson(staleProject),
    updatedAt: 800,
  })
  const latestProject = { ...projectSchema, meta: { owner: 'newer-crashed-runtime' } }
  const latest = await createDraft({
    draftGeneration: 9,
    projectSchema: latestProject,
    projectHash: await hashCanonicalJson(latestProject),
    updatedAt: 900,
  })
  const storage = new MemoryLocalStorage()
  setIndexedDbMarker(storage, initial)

  await assert.rejects(
    refreshIndexedDbCompatibilitySnapshot({
      legacy: createLegacyStorageAdapter(storage),
      draft: latest,
      lockManager: new SharedExclusiveLockManager(),
      crashInjector(event) {
        if (event.point === 'after-project-schema') throw new Error('newer-runtime-crashed')
      },
    }),
    /newer-runtime-crashed/u,
  )
  assert.deepEqual(JSON.parse(storage.getItem('projectSchema')), latestProject)
  assert.equal(readStorageCompatibilityMarker(storage).marker.draftGeneration, 7)

  await assert.rejects(
    refreshIndexedDbCompatibilitySnapshot({
      legacy: createLegacyStorageAdapter(storage),
      draft: stale,
      lockManager: new SharedExclusiveLockManager(),
    }),
    error => error.code === 'generation-conflict' && error.reason === 'legacy-snapshot-fence-is-newer-than-draft',
  )
  assert.deepEqual(JSON.parse(storage.getItem('projectSchema')), latestProject)
  assert.equal(readStorageCompatibilityMarker(storage).marker.draftGeneration, 7)

  const recovered = await refreshIndexedDbCompatibilitySnapshot({
    legacy: createLegacyStorageAdapter(storage),
    draft: latest,
    now: () => 902,
    lockManager: new SharedExclusiveLockManager(),
  })
  assert.equal(recovered.marker.draftGeneration, 9)
  assert.deepEqual(JSON.parse(storage.getItem('projectSchema')), latestProject)
})

test('rollback-window refresh crashes never transfer canonical authority to legacy', async t => {
  const previous = await createDraft({ draftGeneration: 6 })
  const draft = await createDraft({ draftGeneration: 7 })
  const crashCases = [
    ['after-active-pointer'],
    ['after-project-schema'],
    ['after-page-schema', 0],
    ['after-page-schema', 1],
    ['after-page-info'],
    ['after-snapshot-metadata'],
    ['after-verification'],
  ]

  for (const [targetPoint, targetIndex] of crashCases) {
    await t.test(`${targetPoint}${targetIndex === undefined ? '' : `:${targetIndex}`}`, async () => {
      const storage = new MemoryLocalStorage()
      setIndexedDbMarker(storage, previous)
      const legacy = createLegacyStorageAdapter(storage)

      await assert.rejects(
        refreshIndexedDbCompatibilitySnapshot({
          legacy,
          draft,
          crashInjector(event) {
            if (event.point === targetPoint && event.index === targetIndex) throw new Error('refresh-crash')
          },
        }),
        /refresh-crash/,
      )
      const retainedMarker = readStorageCompatibilityMarker(storage).marker
      assert.equal(retainedMarker.canonicalBackend, 'indexeddb')
      assert.equal(retainedMarker.draftGeneration, previous.draftGeneration)

      const retried = await refreshIndexedDbCompatibilitySnapshot({ legacy, draft })
      assert.equal(retried.status, 'refreshed')
      assert.equal(readStorageCompatibilityMarker(storage).marker.canonicalBackend, 'indexeddb')
      assert.equal(readStorageCompatibilityMarker(storage).marker.draftGeneration, draft.draftGeneration)
    })
  }
})

test('forward re-entry selects the newer generation, rejects split-brain hashes, and never trusts stale legacy bytes', async () => {
  const indexedDb = await createDraft({ draftGeneration: 9, commitKind: 'migration' })
  const staleLegacy = await createDraft({ draftGeneration: 8 })
  const newerLegacy = await createDraft({
    draftGeneration: 10,
    projectSchema: { ...projectSchema, meta: { owner: 'legacy-newer' } },
    projectHash: await hashCanonicalJson({ ...projectSchema, meta: { owner: 'legacy-newer' } }),
  })
  const legacyMarker = createStorageCompatibilityMarker({
    canonicalBackend: 'legacy-local-storage',
    projectId: newerLegacy.projectId,
    branchId: newerLegacy.branchId,
    draftGeneration: newerLegacy.draftGeneration,
    projectHash: newerLegacy.projectHash,
    updatedAt: 1_000,
  })
  const staleLegacyMarker = createStorageCompatibilityMarker({
    canonicalBackend: 'legacy-local-storage',
    projectId: staleLegacy.projectId,
    branchId: staleLegacy.branchId,
    draftGeneration: staleLegacy.draftGeneration,
    projectHash: staleLegacy.projectHash,
    updatedAt: 999,
  })

  assert.equal(
    selectForwardReentryDraft({ indexedDbDraft: indexedDb, legacyDraft: staleLegacy, marker: staleLegacyMarker })
      .source,
    'indexeddb',
  )
  assert.equal(
    selectForwardReentryDraft({ indexedDbDraft: indexedDb, legacyDraft: newerLegacy, marker: legacyMarker }).source,
    'legacy-local-storage',
  )

  const sameGenerationDifferentHash = await createDraft({
    draftGeneration: indexedDb.draftGeneration,
    projectHash: `sha256:${'b'.repeat(64)}`,
  })
  const splitBrainMarker = createStorageCompatibilityMarker({
    canonicalBackend: 'legacy-local-storage',
    projectId: sameGenerationDifferentHash.projectId,
    branchId: sameGenerationDifferentHash.branchId,
    draftGeneration: sameGenerationDifferentHash.draftGeneration,
    projectHash: sameGenerationDifferentHash.projectHash,
    updatedAt: 1_000,
  })
  assert.throws(
    () =>
      selectForwardReentryDraft({
        indexedDbDraft: indexedDb,
        legacyDraft: sameGenerationDifferentHash,
        marker: splitBrainMarker,
      }),
    error => error.code === 'integrity-mismatch' && error.reason === 'forward-reentry-generation-has-divergent-hashes',
  )

  const indexedDbMarker = createStorageCompatibilityMarker({
    canonicalBackend: 'indexeddb',
    projectId: indexedDb.projectId,
    branchId: indexedDb.branchId,
    draftGeneration: indexedDb.draftGeneration,
    projectHash: indexedDb.projectHash,
    updatedAt: 1_001,
  })
  const staleDivergentLegacy = await createDraft({
    draftGeneration: 8,
    projectHash: `sha256:${'c'.repeat(64)}`,
  })
  assert.equal(
    selectForwardReentryDraft({
      indexedDbDraft: indexedDb,
      legacyDraft: staleDivergentLegacy,
      marker: indexedDbMarker,
    }).source,
    'indexeddb',
  )
  assert.throws(
    () =>
      selectForwardReentryDraft({
        indexedDbDraft: indexedDb,
        legacyDraft: newerLegacy,
        marker: indexedDbMarker,
      }),
    error => error.code === 'integrity-mismatch' && error.reason === 'legacy-snapshot-is-newer-than-indexeddb-marker',
  )
})
