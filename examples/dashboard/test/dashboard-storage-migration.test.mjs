import assert from 'node:assert/strict'
import test from 'node:test'
import { hashCanonicalJson } from '../src/lib/storage/canonical-json.mjs'
import {
  assertStorageCompatibilityWritable,
  createStorageCompatibilityMarker,
  readStorageCompatibilityMarker,
  writeStorageCompatibilityMarker,
} from '../src/lib/storage/compatibility-marker.mjs'
import { createLegacyStorageAdapter, ensureLegacyStorageIdentity } from '../src/lib/storage/legacy-storage.mjs'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import { migrateLegacyStorage } from '../src/lib/storage/migration.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'

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

class SharedExclusiveLockManager {
  #tails = new Map()

  request(name, _options, operation) {
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

const page = (fileName, id) => ({
  componentName: 'Page',
  fileName,
  id,
  props: { style: { height: 1080, width: 1920 } },
})

const fullProject = {
  componentsTree: [page('overview', 'page-full')],
  config: { theme: 'night' },
  dataSource: { list: [{ id: 'source-full', type: 'mock' }] },
  meta: { owner: 'dashboard-team' },
  version: '1.0.0',
}

const json = value => JSON.stringify(value)

const withLegacyMigrationAuthority = coordinator => ({
  ...coordinator,
  async ensureLegacyIdentity({ legacy, marker }) {
    return legacy.ensureIdentity(marker)
  },
  async transitionLegacyMigration(input) {
    const status = input.migration ? 'committed' : 'reconciled'
    const draft = input.migration
      ? await coordinator.commitMigration(input.migration)
      : await coordinator.readWorkingDraft({ projectId: input.projectId, branchId: input.branchId })
    input.legacy.writeCompatibilityMarker({
      canonicalBackend: 'indexeddb',
      projectId: draft.projectId,
      branchId: draft.branchId,
      draftGeneration: draft.draftGeneration,
      projectHash: draft.projectHash,
      updatedAt: input.updatedAt,
    })
    return { status, draft }
  },
})

const createCoordinator = (events, initialDraft = null, calls = {}) => {
  let draft = initialDraft
  return withLegacyMigrationAuthority({
    async readWorkingDraft() {
      events.push('read-indexeddb')
      return draft
    },
    async commitMigration(input) {
      events.push('commit-indexeddb')
      calls.commits?.push(input)
      draft = {
        schemaVersion: 1,
        projectId: input.projectId,
        branchId: input.branchId,
        draftGeneration: input.expectedDraftGeneration + 1,
        activeDocument: input.activeDocument,
        projectSchema: input.projectSchema,
        projectHash: input.projectHash,
        commitKind: 'migration',
        updatedAt: input.updatedAt,
      }
      return structuredClone(draft)
    },
    async recordMigrationFailure(input) {
      calls.failures?.push(input)
      return { ...input, schemaVersion: 1, status: 'failed', targetGeneration: null }
    },
  })
}

test('the active pointer is safe to parse and preserves one generated project identity', () => {
  const storage = new MemoryLocalStorage({
    'easy-editor:storage:active:v1': '{malformed',
  })
  let generated = 0

  const first = ensureLegacyStorageIdentity(storage, {
    createProjectId() {
      generated += 1
      return 'project-stable'
    },
  })
  const second = ensureLegacyStorageIdentity(storage, {
    createProjectId() {
      generated += 1
      return 'must-not-be-used'
    },
  })

  assert.deepEqual(first.identity, { schemaVersion: 1, projectId: 'project-stable', branchId: 'main' })
  assert.equal(first.created, true)
  assert.equal(first.diagnostic?.code, 'malformed-active-pointer')
  assert.deepEqual(second.identity, first.identity)
  assert.equal(second.created, false)
  assert.equal(generated, 1)

  assert.throws(
    () =>
      ensureLegacyStorageIdentity(storage, {
        compatibilityMarker: createStorageCompatibilityMarker({
          canonicalBackend: 'legacy-local-storage',
          projectId: 'different-project',
          branchId: 'main',
          draftGeneration: 0,
          projectHash: `sha256:${'0'.repeat(64)}`,
          updatedAt: 0,
        }),
      }),
    error =>
      error.code === 'integrity-mismatch' && error.reason === 'active-pointer-does-not-match-compatibility-marker',
  )
})

test('two coordinators serialize the first project identity claim with one fixed origin lock', async t => {
  const storage = new MemoryLocalStorage()
  const lockManager = new SharedExclusiveLockManager()
  const coordinatorA = new ProjectPersistenceCoordinator({
    backend: new MemoryDashboardStorageBackend(),
    compatibilityStorage: storage,
    lockManager,
  })
  const coordinatorB = new ProjectPersistenceCoordinator({
    backend: new MemoryDashboardStorageBackend(),
    compatibilityStorage: storage,
    lockManager,
  })
  t.after(() => Promise.all([coordinatorA.dispose(), coordinatorB.dispose()]))

  let releaseFirstClaim
  let markFirstClaimStarted
  const firstClaimGate = new Promise(resolve => {
    releaseFirstClaim = resolve
  })
  const firstClaimStarted = new Promise(resolve => {
    markFirstClaimStarted = resolve
  })
  let secondClaimEntered = false
  let secondProjectIdGenerated = false
  const firstLegacy = {
    async ensureIdentity(marker) {
      assert.equal(storage.getItem('easy-editor:storage:active:v1'), null)
      markFirstClaimStarted()
      await firstClaimGate
      return ensureLegacyStorageIdentity(storage, {
        compatibilityMarker: marker,
        createProjectId: () => 'project-first-claim',
      })
    },
  }
  const secondLegacy = {
    ensureIdentity(marker) {
      secondClaimEntered = true
      return ensureLegacyStorageIdentity(storage, {
        compatibilityMarker: marker,
        createProjectId() {
          secondProjectIdGenerated = true
          return 'project-second-claim'
        },
      })
    },
  }

  const firstClaim = coordinatorA.ensureLegacyIdentity({ legacy: firstLegacy, marker: null })
  await firstClaimStarted
  const secondClaim = coordinatorB.ensureLegacyIdentity({ legacy: secondLegacy, marker: null })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(secondClaimEntered, false)
  releaseFirstClaim()

  const [first, second] = await Promise.all([firstClaim, secondClaim])
  assert.equal(first.identity.projectId, 'project-first-claim')
  assert.deepEqual(second.identity, first.identity)
  assert.equal(secondProjectIdGenerated, false)
})

test('concurrent empty-storage bootstraps commit and seed one IndexedDB authority generation', async t => {
  const storage = new MemoryLocalStorage()
  const backend = new MemoryDashboardStorageBackend()
  const lockManager = new SharedExclusiveLockManager()
  const legacy = createLegacyStorageAdapter(storage, { createProjectId: () => 'project-bootstrap' })
  const coordinatorA = new ProjectPersistenceCoordinator({ backend, compatibilityStorage: storage, lockManager })
  const coordinatorB = new ProjectPersistenceCoordinator({ backend, compatibilityStorage: storage, lockManager })
  t.after(() => Promise.all([coordinatorA.dispose(), coordinatorB.dispose()]))
  const identity = await coordinatorA.ensureLegacyIdentity({ legacy, marker: null })
  const projectHash = await hashCanonicalJson(fullProject)
  const migration = {
    projectId: identity.identity.projectId,
    branchId: identity.identity.branchId,
    expectedDraftGeneration: 0,
    sourceDraftGeneration: 0,
    source: 'unknown',
    diagnostics: [{ code: 'empty-storage-default-project' }],
    activeDocument: { documentId: 'page-full', fileName: 'overview', index: 0 },
    projectSchema: fullProject,
    projectHash,
    updatedAt: 1,
  }

  const [first, second] = await Promise.all([
    coordinatorA.bootstrapIndexedDbAuthority({
      projectId: 'project-bootstrap',
      branchId: 'main',
      legacy,
      migration,
      updatedAt: 1,
    }),
    coordinatorB.bootstrapIndexedDbAuthority({
      projectId: 'project-bootstrap',
      branchId: 'main',
      legacy,
      migration,
      updatedAt: 2,
    }),
  ])

  assert.deepEqual([first.status, second.status].sort(), ['committed', 'reconciled'])
  assert.equal(first.draft.draftGeneration, 1)
  assert.deepEqual(second.draft, first.draft)
  assert.deepEqual(readStorageCompatibilityMarker(storage).marker, {
    schemaVersion: 1,
    writerVersion: 1,
    canonicalBackend: 'indexeddb',
    minReaderVersion: 1,
    projectId: 'project-bootstrap',
    branchId: 'main',
    draftGeneration: 1,
    projectHash,
    updatedAt: 2,
  })
})

test('a valid complete project wins and the IndexedDB compatibility marker is written after durable commit', async () => {
  const storage = new MemoryLocalStorage({
    projectSchema: json(fullProject),
    pageInfo: json([{ path: 'fragment', title: 'must not win' }]),
    'pageSchema:fragment': json({
      componentsTree: [page('fragment', 'page-fragment')],
      version: '1.0.0',
    }),
  })
  const sourceBefore = storage.snapshot()
  const events = []
  const calls = { commits: [] }
  const originalSetItem = storage.setItem.bind(storage)
  storage.setItem = (key, value) => {
    if (key === 'easy-editor:storage:compatibility:v1') events.push('write-marker')
    originalSetItem(key, value)
  }

  const result = await migrateLegacyStorage({
    legacy: createLegacyStorageAdapter(storage, { createProjectId: () => 'project-complete' }),
    coordinator: createCoordinator(events, null, calls),
    now: () => 101,
  })

  assert.equal(result.status, 'migrated')
  assert.equal(result.source, 'projectSchema')
  assert.deepEqual(result.draft.projectSchema, fullProject)
  assert.equal(calls.commits[0].source, 'projectSchema')
  assert.deepEqual(calls.commits[0].diagnostics, [])
  assert.deepEqual(events, ['read-indexeddb', 'commit-indexeddb', 'write-marker'])
  assert.deepEqual(
    readStorageCompatibilityMarker(storage).marker,
    createStorageCompatibilityMarker({
      canonicalBackend: 'indexeddb',
      projectId: 'project-complete',
      branchId: 'main',
      draftGeneration: 1,
      projectHash: result.draft.projectHash,
      updatedAt: 101,
    }),
  )
  for (const [key, value] of Object.entries(sourceBefore)) assert.equal(storage.getItem(key), value)
})

test('strict fragment fallback reconstructs every page and preserves project-level fields', async () => {
  const sharedMeta = {
    componentsMap: [{ componentName: 'Chart' }],
    config: { locale: 'zh-CN' },
    dataSource: { list: [{ id: 'mock-1', type: 'mock' }] },
    meta: { tenant: 'customer-a' },
    version: '1.0.0',
  }
  const storage = new MemoryLocalStorage({
    projectSchema: '{malformed',
    pageInfo: json([
      { path: 'overview', title: '总览' },
      { path: 'detail', title: '详情' },
    ]),
    'pageSchema:overview': json({ ...sharedMeta, componentsTree: [page('overview', 'page-overview')] }),
    'pageSchema:detail': json({ ...sharedMeta, componentsTree: [page('detail', 'page-detail')] }),
  })
  const events = []
  const calls = { commits: [] }

  const result = await migrateLegacyStorage({
    legacy: createLegacyStorageAdapter(storage, { createProjectId: () => 'project-fragments' }),
    coordinator: createCoordinator(events, null, calls),
    now: () => 202,
  })

  assert.equal(result.source, 'page-fragments')
  assert.deepEqual(result.draft.projectSchema, {
    ...sharedMeta,
    componentsTree: [page('overview', 'page-overview'), page('detail', 'page-detail')],
  })
  assert.deepEqual(result.draft.activeDocument, {
    documentId: 'page-overview',
    fileName: 'overview',
    index: 0,
  })
  assert.deepEqual(
    result.diagnostics.map(item => item.code),
    ['malformed-project-schema', 'multi-page-fragments'],
  )
  assert.deepEqual(calls.commits[0].diagnostics, result.diagnostics)
})

test('duplicate, partial, and malformed fragments fail with diagnostics without deleting source values', async t => {
  const cases = [
    {
      name: 'duplicate pageInfo paths',
      entries: {
        pageInfo: json([
          { path: 'same', title: 'A' },
          { path: 'same', title: 'B' },
        ]),
        'pageSchema:same': json({ componentsTree: [page('same', 'page-same')], version: '1.0.0' }),
      },
      code: 'duplicate-page-fragment',
    },
    {
      name: 'missing fragment',
      entries: { pageInfo: json([{ path: 'missing', title: 'Missing' }]) },
      code: 'missing-page-fragment',
    },
    {
      name: 'malformed fragment',
      entries: {
        pageInfo: json([{ path: 'broken', title: 'Broken' }]),
        'pageSchema:broken': '{malformed',
      },
      code: 'malformed-page-fragment',
    },
  ]

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const storage = new MemoryLocalStorage(fixture.entries)
      const before = storage.snapshot()
      let commits = 0
      const recordedFailures = []
      const coordinator = withLegacyMigrationAuthority({
        async readWorkingDraft() {
          return null
        },
        async commitMigration() {
          commits += 1
        },
        async recordMigrationFailure(input) {
          recordedFailures.push(input)
          return { ...input, schemaVersion: 1, status: 'failed', targetGeneration: null }
        },
      })

      await assert.rejects(
        migrateLegacyStorage({
          legacy: createLegacyStorageAdapter(storage, { createProjectId: () => `project-${fixture.code}` }),
          coordinator,
        }),
        error => error.code === 'migration-failed' && error.details.diagnosticCodes.split(',').includes(fixture.code),
      )

      assert.equal(commits, 0)
      assert.equal(recordedFailures.length, 1)
      assert.equal(recordedFailures[0].source, 'page-fragments')
      assert.ok(recordedFailures[0].diagnostics.some(item => item.code === fixture.code))
      assert.equal(readStorageCompatibilityMarker(storage).marker, null)
      for (const [key, value] of Object.entries(before)) assert.equal(storage.getItem(key), value)
    })
  }
})

test('invalid migration preserves both the candidate failure and diagnostics persistence failure causes', async () => {
  const storage = new MemoryLocalStorage({
    pageInfo: json([{ path: 'missing', title: 'Missing' }]),
  })

  await assert.rejects(
    migrateLegacyStorage({
      legacy: createLegacyStorageAdapter(storage, { createProjectId: () => 'project-double-failure' }),
      coordinator: withLegacyMigrationAuthority({
        async readWorkingDraft() {
          return null
        },
        async commitMigration() {
          throw new Error('must not commit')
        },
        async recordMigrationFailure() {
          throw new Error('diagnostics-store-failed')
        },
      }),
    }),
    error => {
      assert.equal(error.code, 'migration-failed')
      assert.equal(error.reason, 'legacy-project-failure-diagnostics-persist-failed')
      assert.ok(error.cause instanceof AggregateError)
      assert.equal(error.cause.errors[0].reason, 'legacy-project-candidate-is-not-complete')
      assert.equal(error.cause.errors[1].message, 'diagnostics-store-failed')
      return true
    },
  )
})

test('the real coordinator persists successful and failed migration diagnostics through its narrow seams', async t => {
  await t.test('successful diagnostics commit atomically with the canonical draft', async t => {
    const backend = new MemoryDashboardStorageBackend()
    const coordinator = new ProjectPersistenceCoordinator({ backend })
    t.after(() => coordinator.dispose())
    const storage = new MemoryLocalStorage({
      projectSchema: '{malformed',
      pageInfo: json([{ path: 'overview', title: '总览' }]),
      'pageSchema:overview': json(fullProject),
    })

    const result = await migrateLegacyStorage({
      legacy: createLegacyStorageAdapter(storage, { createProjectId: () => 'project-real-success' }),
      coordinator,
      now: () => 601,
    })

    const state = await backend.get('migrationState', ['project-real-success', 'main'])
    assert.equal(result.draft.draftGeneration, 1)
    assert.equal(state.status, 'draft-committed')
    assert.equal(state.targetGeneration, 1)
    assert.deepEqual(state.diagnostics, result.diagnostics)
  })

  await t.test('invalid fragments persist failed diagnostics without creating a working draft', async t => {
    const backend = new MemoryDashboardStorageBackend()
    const coordinator = new ProjectPersistenceCoordinator({ backend })
    t.after(() => coordinator.dispose())
    const storage = new MemoryLocalStorage({
      pageInfo: json([{ path: 'missing', title: 'Missing' }]),
    })

    await assert.rejects(
      migrateLegacyStorage({
        legacy: createLegacyStorageAdapter(storage, { createProjectId: () => 'project-real-failure' }),
        coordinator,
        now: () => 602,
      }),
      error => error.code === 'migration-failed' && error.reason === 'legacy-project-candidate-is-not-complete',
    )

    assert.equal(await backend.get('workingDrafts', ['project-real-failure', 'main']), undefined)
    const state = await backend.get('migrationState', ['project-real-failure', 'main'])
    assert.equal(state.status, 'failed')
    assert.equal(state.targetGeneration, null)
    assert.ok(state.diagnostics.some(item => item.code === 'missing-page-fragment'))
  })
})

test('an unsupported compatibility marker makes the bridge read-only before any migration effect', async () => {
  const storage = new MemoryLocalStorage({ projectSchema: json(fullProject) })
  storage.setItem(
    'easy-editor:storage:compatibility:v1',
    json({
      schemaVersion: 1,
      writerVersion: 2,
      canonicalBackend: 'indexeddb',
      minReaderVersion: 2,
      projectId: 'future-project',
      branchId: 'main',
      draftGeneration: 8,
      projectHash: `sha256:${'a'.repeat(64)}`,
      updatedAt: 500,
    }),
  )
  let reads = 0
  const marker = readStorageCompatibilityMarker(storage).marker

  assert.throws(
    () => assertStorageCompatibilityWritable(marker, { readerVersion: 1 }),
    error => error.code === 'read-only-compatibility' && error.details.minReaderVersion === 2,
  )
  await assert.rejects(
    migrateLegacyStorage({
      legacy: createLegacyStorageAdapter(storage, { createProjectId: () => 'unused' }),
      coordinator: withLegacyMigrationAuthority({
        async readWorkingDraft() {
          reads += 1
          return null
        },
        async commitMigration() {
          throw new Error('must not commit')
        },
      }),
    }),
    error => error.code === 'read-only-compatibility',
  )
  assert.equal(reads, 0)
})

test('a failed durable commit keeps legacy canonical and never deletes the source snapshot', async () => {
  const storage = new MemoryLocalStorage({ projectSchema: json(fullProject) })
  const before = storage.snapshot()

  await assert.rejects(
    migrateLegacyStorage({
      legacy: createLegacyStorageAdapter(storage, { createProjectId: () => 'project-failure' }),
      coordinator: withLegacyMigrationAuthority({
        async readWorkingDraft() {
          return null
        },
        async commitMigration() {
          throw new Error('quota')
        },
      }),
    }),
    error => error.code === 'migration-failed' && error.reason === 'legacy-project-durable-commit-failed',
  )

  assert.equal(readStorageCompatibilityMarker(storage).marker, null)
  for (const [key, value] of Object.entries(before)) assert.equal(storage.getItem(key), value)
})

test('forward re-entry rejects a stale legacy source when newer IndexedDB bytes have a different hash', async () => {
  const staleHash = await hashCanonicalJson(fullProject)
  const newerProject = { ...fullProject, meta: { owner: 'newer-indexeddb' } }
  const newerHash = await hashCanonicalJson(newerProject)
  const storage = new MemoryLocalStorage({ projectSchema: json(fullProject) })
  writeStorageCompatibilityMarker(storage, {
    canonicalBackend: 'legacy-local-storage',
    projectId: 'project-forward',
    branchId: 'main',
    draftGeneration: 3,
    projectHash: staleHash,
    updatedAt: 300,
  })
  const indexedDbDraft = {
    schemaVersion: 1,
    projectId: 'project-forward',
    branchId: 'main',
    draftGeneration: 4,
    activeDocument: { documentId: 'page-full', fileName: 'overview', index: 0 },
    projectSchema: newerProject,
    projectHash: newerHash,
    commitKind: 'manual-save',
    updatedAt: 400,
  }
  let commits = 0

  await assert.rejects(
    migrateLegacyStorage({
      legacy: createLegacyStorageAdapter(storage, { createProjectId: () => 'must-not-be-used' }),
      coordinator: withLegacyMigrationAuthority({
        async readWorkingDraft() {
          return indexedDbDraft
        },
        async commitMigration() {
          commits += 1
          throw new Error('stale legacy must not commit')
        },
      }),
      now: () => 401,
    }),
    error => error.code === 'integrity-mismatch' && error.reason === 'forward-reentry-source-generation-is-stale',
  )

  assert.equal(commits, 0)
  assert.equal(readStorageCompatibilityMarker(storage).marker.canonicalBackend, 'legacy-local-storage')
})

test('forward re-entry recovers an interrupted same-hash migration and advances a newer legacy source once', async t => {
  await t.test('same hash with a newer IndexedDB generation repairs the marker without a second commit', async () => {
    const projectHash = await hashCanonicalJson(fullProject)
    const storage = new MemoryLocalStorage({ projectSchema: json(fullProject) })
    writeStorageCompatibilityMarker(storage, {
      canonicalBackend: 'legacy-local-storage',
      projectId: 'project-interrupted',
      branchId: 'main',
      draftGeneration: 3,
      projectHash,
      updatedAt: 300,
    })
    const indexedDbDraft = {
      schemaVersion: 1,
      projectId: 'project-interrupted',
      branchId: 'main',
      draftGeneration: 4,
      activeDocument: { documentId: 'page-full', fileName: 'overview', index: 0 },
      projectSchema: fullProject,
      projectHash,
      commitKind: 'migration',
      updatedAt: 400,
    }
    let commits = 0

    const result = await migrateLegacyStorage({
      legacy: createLegacyStorageAdapter(storage),
      coordinator: withLegacyMigrationAuthority({
        async readWorkingDraft() {
          return indexedDbDraft
        },
        async commitMigration() {
          commits += 1
          throw new Error('must not repeat the durable commit')
        },
      }),
      now: () => 401,
    })

    assert.equal(result.status, 'recovered')
    assert.equal(result.source, 'indexeddb')
    assert.equal(result.draft, indexedDbDraft)
    assert.equal(commits, 0)
    assert.equal(readStorageCompatibilityMarker(storage).marker.draftGeneration, 4)
  })

  await t.test('a newer legacy generation is imported at source generation plus one', async () => {
    const indexedProject = { ...fullProject, meta: { owner: 'indexeddb-old' } }
    const indexedHash = await hashCanonicalJson(indexedProject)
    const legacyHash = await hashCanonicalJson(fullProject)
    const storage = new MemoryLocalStorage({ projectSchema: json(fullProject) })
    writeStorageCompatibilityMarker(storage, {
      canonicalBackend: 'legacy-local-storage',
      projectId: 'project-legacy-newer',
      branchId: 'main',
      draftGeneration: 5,
      projectHash: legacyHash,
      updatedAt: 500,
    })
    const indexedDbDraft = {
      schemaVersion: 1,
      projectId: 'project-legacy-newer',
      branchId: 'main',
      draftGeneration: 4,
      activeDocument: { documentId: 'page-full', fileName: 'overview', index: 0 },
      projectSchema: indexedProject,
      projectHash: indexedHash,
      commitKind: 'manual-save',
      updatedAt: 400,
    }
    let commitInput

    const result = await migrateLegacyStorage({
      legacy: createLegacyStorageAdapter(storage),
      coordinator: withLegacyMigrationAuthority({
        async readWorkingDraft() {
          return indexedDbDraft
        },
        async commitMigration(input) {
          commitInput = input
          return {
            schemaVersion: 1,
            projectId: input.projectId,
            branchId: input.branchId,
            draftGeneration: input.sourceDraftGeneration + 1,
            activeDocument: input.activeDocument,
            projectSchema: input.projectSchema,
            projectHash: input.projectHash,
            commitKind: 'migration',
            updatedAt: input.updatedAt,
          }
        },
      }),
      now: () => 501,
    })

    assert.equal(commitInput.expectedDraftGeneration, 4)
    assert.equal(commitInput.sourceDraftGeneration, 5)
    assert.equal(result.draft.draftGeneration, 6)
    assert.equal(readStorageCompatibilityMarker(storage).marker.draftGeneration, 6)
  })
})

test('pre-Bridge state with IndexedDB bytes but no compatibility marker is typed read-only recovery', async () => {
  const projectHash = await hashCanonicalJson(fullProject)
  const storage = new MemoryLocalStorage({ projectSchema: json(fullProject) })

  await assert.rejects(
    migrateLegacyStorage({
      legacy: createLegacyStorageAdapter(storage, { createProjectId: () => 'project-pre-bridge' }),
      coordinator: withLegacyMigrationAuthority({
        async readWorkingDraft() {
          return {
            schemaVersion: 1,
            projectId: 'project-pre-bridge',
            branchId: 'main',
            draftGeneration: 1,
            activeDocument: { documentId: 'page-full', fileName: 'overview', index: 0 },
            projectSchema: fullProject,
            projectHash,
            commitKind: 'migration',
            updatedAt: 100,
          }
        },
        async commitMigration() {
          throw new Error('must not write without Bridge evidence')
        },
      }),
    }),
    error =>
      error.code === 'read-only-compatibility' &&
      error.reason === 'pre-bridge-indexeddb-state-requires-export-recovery',
  )
})

test('a migration marker refresh cannot overwrite an explicit downgrade from another coordinator', async t => {
  const storage = new MemoryLocalStorage({ projectSchema: json(fullProject) })
  const backend = new MemoryDashboardStorageBackend()
  const lockManager = new SharedExclusiveLockManager()
  const coordinatorA = new ProjectPersistenceCoordinator({ backend, compatibilityStorage: storage, lockManager })
  const coordinatorB = new ProjectPersistenceCoordinator({ backend, compatibilityStorage: storage, lockManager })
  t.after(() => Promise.all([coordinatorA.dispose(), coordinatorB.dispose()]))

  const first = await coordinatorA.commit({
    schemaVersion: 1,
    batchId: 'race-seed-1',
    projectId: 'project-marker-race',
    branchId: 'main',
    expectedDraftGeneration: 0,
    activeDocument: { documentId: 'page-full', fileName: 'overview', index: 0 },
    projectSchema: fullProject,
    commitKind: 'manual-save',
    updatedAt: 1,
    operations: [],
  })
  const second = await coordinatorA.commit({
    schemaVersion: 1,
    batchId: 'race-seed-2',
    projectId: 'project-marker-race',
    branchId: 'main',
    expectedDraftGeneration: 1,
    activeDocument: first.draft.activeDocument,
    projectSchema: fullProject,
    commitKind: 'manual-save',
    updatedAt: 2,
    operations: [],
  })
  writeStorageCompatibilityMarker(storage, {
    canonicalBackend: 'indexeddb',
    projectId: 'project-marker-race',
    branchId: 'main',
    draftGeneration: 1,
    projectHash: first.draft.projectHash,
    updatedAt: 1,
  })

  let releaseRead
  let markReadStarted
  const readGate = new Promise(resolve => {
    releaseRead = resolve
  })
  const readStarted = new Promise(resolve => {
    markReadStarted = resolve
  })
  const migrationCoordinator = {
    ensureLegacyIdentity: value => coordinatorB.ensureLegacyIdentity(value),
    async readWorkingDraft(scope) {
      markReadStarted()
      await readGate
      return coordinatorB.readWorkingDraft(scope)
    },
    transitionLegacyMigration: value => coordinatorB.transitionLegacyMigration(value),
    recordMigrationFailure: value => coordinatorB.recordMigrationFailure(value),
  }
  const migration = migrateLegacyStorage({
    legacy: createLegacyStorageAdapter(storage),
    coordinator: migrationCoordinator,
    now: () => 3,
  })
  await readStarted

  const downgrade = await coordinatorA.downgradeToLegacy({
    projectId: 'project-marker-race',
    branchId: 'main',
    legacy: createLegacyStorageAdapter(storage),
    now: () => 4,
  })
  assert.equal(downgrade.marker.canonicalBackend, 'legacy-local-storage')
  assert.equal(downgrade.marker.draftGeneration, 2)
  releaseRead()

  await assert.rejects(
    migration,
    error =>
      error.code === 'read-only-compatibility' &&
      error.reason === 'storage-compatibility-authority-changed-during-migration' &&
      error.details.expectedCanonicalBackend === 'indexeddb' &&
      error.details.actualCanonicalBackend === 'legacy-local-storage',
  )
  assert.deepEqual(readStorageCompatibilityMarker(storage).marker, downgrade.marker)
  assert.deepEqual(
    await coordinatorA.readWorkingDraft({ projectId: 'project-marker-race', branchId: 'main' }),
    second.draft,
  )
})

test('legacy source marker advancement is revalidated inside the migration authority lock', async t => {
  const projectV2 = { ...fullProject, meta: { owner: 'legacy-v2' } }
  const hashV1 = await hashCanonicalJson(fullProject)
  const hashV2 = await hashCanonicalJson(projectV2)
  const storage = new MemoryLocalStorage({ projectSchema: json(fullProject) })
  writeStorageCompatibilityMarker(storage, {
    canonicalBackend: 'legacy-local-storage',
    projectId: 'project-source-race',
    branchId: 'main',
    draftGeneration: 1,
    projectHash: hashV1,
    updatedAt: 1,
  })
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({
    backend,
    compatibilityStorage: storage,
    lockManager: new SharedExclusiveLockManager(),
  })
  t.after(() => coordinator.dispose())

  let releaseTransition
  let markTransitionStarted
  const transitionGate = new Promise(resolve => {
    releaseTransition = resolve
  })
  const transitionStarted = new Promise(resolve => {
    markTransitionStarted = resolve
  })
  const migrationCoordinator = {
    ensureLegacyIdentity: value => coordinator.ensureLegacyIdentity(value),
    readWorkingDraft: scope => coordinator.readWorkingDraft(scope),
    async transitionLegacyMigration(value) {
      markTransitionStarted()
      await transitionGate
      return coordinator.transitionLegacyMigration(value)
    },
    recordMigrationFailure: value => coordinator.recordMigrationFailure(value),
  }
  const migration = migrateLegacyStorage({
    legacy: createLegacyStorageAdapter(storage),
    coordinator: migrationCoordinator,
    now: () => 2,
  })
  await transitionStarted

  storage.setItem('projectSchema', json(projectV2))
  const advancedMarker = writeStorageCompatibilityMarker(storage, {
    canonicalBackend: 'legacy-local-storage',
    projectId: 'project-source-race',
    branchId: 'main',
    draftGeneration: 2,
    projectHash: hashV2,
    updatedAt: 2,
  })
  releaseTransition()

  await assert.rejects(
    migration,
    error =>
      error.code === 'read-only-compatibility' &&
      error.reason === 'storage-compatibility-authority-changed-during-migration' &&
      error.details.expectedGeneration === 1 &&
      error.details.actualGeneration === 2,
  )
  assert.deepEqual(readStorageCompatibilityMarker(storage).marker, advancedMarker)
  assert.equal(await backend.get('workingDrafts', ['project-source-race', 'main']), undefined)
})
