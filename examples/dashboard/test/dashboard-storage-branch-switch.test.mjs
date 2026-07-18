import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DASHBOARD_STORAGE_BRANCH_SWITCH_CRASH_POINTS,
  DASHBOARD_STORAGE_BRANCH_SWITCH_KEY,
  DASHBOARD_STORAGE_IDENTITY_POINTER_KEY,
  abortPreparedIndexedDbCompatibilityBranchSwitch,
  createLegacyStorageAdapter,
  hashCanonicalJson,
  prepareIndexedDbCompatibilityBranchSwitch,
  readStorageCompatibilityMarker,
  recoverIndexedDbCompatibilityBranchSwitch,
  refreshIndexedDbCompatibilitySnapshot,
  switchIndexedDbCompatibilityBranch,
  writeStorageCompatibilityMarker,
} from '../src/lib/storage/index.mjs'

class MemoryLocalStorage {
  #entries = new Map()

  constructor(entries = {}) {
    for (const [key, value] of Object.entries(entries)) this.#entries.set(key, String(value))
  }

  getItem(key) {
    return this.#entries.get(key) ?? null
  }

  setItem(key, value) {
    this.#entries.set(key, String(value))
  }

  snapshot() {
    return Object.fromEntries(this.#entries)
  }
}

const project = (branchId, text) => ({
  version: '1.0.0',
  componentsTree: [
    {
      componentName: 'Root',
      docId: `${branchId}-document`,
      fileName: `${branchId}-screen`,
      fileDesc: `${branchId} screen`,
      isRoot: true,
      props: { text },
    },
  ],
})

const createDraft = async (branchId, text, draftGeneration, updatedAt) => {
  const projectSchema = project(branchId, text)
  return Object.freeze({
    schemaVersion: 1,
    projectId: 'project-branch-switch',
    branchId,
    draftGeneration,
    projectSchema,
    projectHash: await hashCanonicalJson(projectSchema),
    activeDocument: {
      documentId: `${branchId}-document`,
      fileName: `${branchId}-screen`,
      index: 0,
    },
    commitKind: branchId === 'main' ? 'manual-save' : 'version-restore',
    updatedAt,
  })
}

const seedSource = async () => {
  const storage = new MemoryLocalStorage()
  const source = await createDraft('main', 'source', 2, 20)
  storage.setItem(
    DASHBOARD_STORAGE_IDENTITY_POINTER_KEY,
    JSON.stringify({ schemaVersion: 1, projectId: source.projectId, branchId: source.branchId }),
  )
  writeStorageCompatibilityMarker(storage, {
    canonicalBackend: 'indexeddb',
    projectId: source.projectId,
    branchId: source.branchId,
    draftGeneration: source.draftGeneration,
    projectHash: source.projectHash,
    updatedAt: source.updatedAt,
  })
  const legacy = createLegacyStorageAdapter(storage)
  await refreshIndexedDbCompatibilitySnapshot({ legacy, draft: source, now: () => 21 })
  return { legacy, source, storage }
}

const fence = draft => ({
  projectId: draft.projectId,
  branchId: draft.branchId,
  draftGeneration: draft.draftGeneration,
  projectHash: draft.projectHash,
})

const restoreRequest = target => ({
  schemaVersion: 1,
  batchId: `restore:${target.branchId}`,
  projectId: target.projectId,
  sourceBranchId: 'main',
  versionId: 'version-1',
  targetBranchId: target.branchId,
  targetSessionId: `session:${target.branchId}`,
  forkedFromSessionId: null,
  forkedFromTaskId: null,
  restoredAt: target.updatedAt,
})

const prepare = ({ legacy, source, target, crashInjector }) =>
  prepareIndexedDbCompatibilityBranchSwitch({
    legacy,
    source: fence(source),
    target: fence(target),
    restoreRequest: restoreRequest(target),
    readDraft: async () => null,
    now: () => 30,
    crashInjector,
  })

const assertTargetSurface = ({ storage, target }) => {
  assert.deepEqual(JSON.parse(storage.getItem(DASHBOARD_STORAGE_IDENTITY_POINTER_KEY)), {
    schemaVersion: 1,
    projectId: target.projectId,
    branchId: target.branchId,
  })
  const marker = readStorageCompatibilityMarker(storage).marker
  assert.equal(marker?.canonicalBackend, 'indexeddb')
  assert.equal(marker?.projectId, target.projectId)
  assert.equal(marker?.branchId, target.branchId)
  assert.equal(marker?.draftGeneration, target.draftGeneration)
  assert.equal(marker?.projectHash, target.projectHash)
  assert.deepEqual(JSON.parse(storage.getItem('projectSchema')), target.projectSchema)
  assert.deepEqual(JSON.parse(storage.getItem('pageInfo')), [
    { path: `${target.branchId}-screen`, title: `${target.branchId} screen` },
  ])
  assert.equal(JSON.parse(storage.getItem(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY)).status, 'complete')
}

test('branch switch prepares exact restore identity, writes verified target bytes, and reconciles exact retry', async () => {
  const { legacy, source, storage } = await seedSource()
  const target = await createDraft('restore-version-1', 'restored', 1, 30)
  const events = []

  const prepared = await prepare({ legacy, source, target, crashInjector: event => events.push(event.point) })
  assert.equal(prepared.status, 'prepared')

  const switched = await switchIndexedDbCompatibilityBranch({
    legacy,
    draft: target,
    restoreRequest: restoreRequest(target),
    now: () => 31,
    crashInjector: event => events.push(event.point),
  })

  assert.equal(switched.status, 'switched')
  assert.ok(events.indexOf('after-verification') < events.indexOf('after-compatibility-marker'))
  assert.ok(events.indexOf('after-compatibility-marker') < events.indexOf('after-active-pointer'))
  assert.ok(events.indexOf('after-active-pointer') < events.indexOf('after-transition-complete'))
  assertTargetSurface({ storage, target })

  const retried = await switchIndexedDbCompatibilityBranch({
    legacy,
    draft: target,
    restoreRequest: restoreRequest(target),
    now: () => 32,
  })
  assert.equal(retried.status, 'reconciled')
  assertTargetSurface({ storage, target })

  const preparedAgainFromActiveTarget = await prepareIndexedDbCompatibilityBranchSwitch({
    legacy,
    source: fence(target),
    target: fence(target),
    restoreRequest: restoreRequest(target),
    readDraft: async () => target,
    now: () => 33,
  })
  assert.equal(preparedAgainFromActiveTarget.status, 'reconciled')
  assertTargetSurface({ storage, target })
})

test('completed branch switch remains stable after a later save on the restored target', async () => {
  const { legacy, source, storage } = await seedSource()
  const target = await createDraft('restore-version-1', 'restored', 1, 30)
  await prepare({ legacy, source, target })
  await switchIndexedDbCompatibilityBranch({
    legacy,
    draft: target,
    restoreRequest: restoreRequest(target),
    now: () => 31,
  })

  const savedTarget = await createDraft(target.branchId, 'saved after restore', 2, 40)
  await refreshIndexedDbCompatibilitySnapshot({ legacy, draft: savedTarget, now: () => 41 })

  const recovered = await recoverIndexedDbCompatibilityBranchSwitch({
    legacy,
    ensureRestoreTarget: async () => {
      throw new Error('completed transition must not recreate the original restore target')
    },
  })

  assert.equal(recovered.status, 'stable')
  assertTargetSurface({ storage, target: savedTarget })
})

test('completed target advancement stays fail-closed for invalid authority changes and pending drift', async t => {
  const seedCompletedTarget = async () => {
    const seeded = await seedSource()
    const target = await createDraft('restore-version-1', 'restored', 1, 30)
    await prepare({ legacy: seeded.legacy, source: seeded.source, target })
    await switchIndexedDbCompatibilityBranch({
      legacy: seeded.legacy,
      draft: target,
      restoreRequest: restoreRequest(target),
      now: () => 31,
    })
    return { ...seeded, target }
  }

  await t.test('foreign project or branch', async () => {
    const { legacy, storage, target } = await seedCompletedTarget()
    writeStorageCompatibilityMarker(storage, {
      canonicalBackend: 'indexeddb',
      projectId: 'foreign-project',
      branchId: 'foreign-branch',
      draftGeneration: 2,
      projectHash: target.projectHash,
      updatedAt: 40,
    })
    await assert.rejects(
      recoverIndexedDbCompatibilityBranchSwitch({ legacy, ensureRestoreTarget: async () => ({ draft: target }) }),
      error => error.code === 'integrity-mismatch' && error.reason === 'branch-switch-surface-has-unrelated-authority',
    )
  })

  await t.test('generation rollback', async () => {
    const { legacy, storage, target } = await seedCompletedTarget()
    writeStorageCompatibilityMarker(storage, {
      canonicalBackend: 'indexeddb',
      projectId: target.projectId,
      branchId: target.branchId,
      draftGeneration: 0,
      projectHash: target.projectHash,
      updatedAt: 40,
    })
    await assert.rejects(
      recoverIndexedDbCompatibilityBranchSwitch({ legacy, ensureRestoreTarget: async () => ({ draft: target }) }),
      error => error.code === 'integrity-mismatch' && error.reason === 'branch-switch-fence-is-malformed',
    )
  })

  await t.test('same generation with a different hash', async () => {
    const { legacy, storage, target } = await seedCompletedTarget()
    const divergent = await createDraft(target.branchId, 'divergent target', target.draftGeneration, 40)
    writeStorageCompatibilityMarker(storage, {
      canonicalBackend: 'indexeddb',
      projectId: target.projectId,
      branchId: target.branchId,
      draftGeneration: divergent.draftGeneration,
      projectHash: divergent.projectHash,
      updatedAt: 40,
    })
    await assert.rejects(
      recoverIndexedDbCompatibilityBranchSwitch({ legacy, ensureRestoreTarget: async () => ({ draft: target }) }),
      error => error.code === 'integrity-mismatch' && error.reason === 'branch-switch-surface-has-unrelated-authority',
    )
  })

  await t.test('pending transition marker drift', async () => {
    const { legacy, source, storage } = await seedSource()
    const target = await createDraft('restore-version-1', 'restored', 1, 30)
    await prepare({ legacy, source, target })
    writeStorageCompatibilityMarker(storage, {
      canonicalBackend: 'indexeddb',
      projectId: target.projectId,
      branchId: target.branchId,
      draftGeneration: 2,
      projectHash: target.projectHash,
      updatedAt: 40,
    })
    await assert.rejects(
      recoverIndexedDbCompatibilityBranchSwitch({ legacy, ensureRestoreTarget: async () => ({ draft: target }) }),
      error => error.code === 'integrity-mismatch' && error.reason === 'branch-switch-surface-has-unrelated-authority',
    )
  })
})

test('every branch-switch crash point recovers deterministically from the durable target draft', async t => {
  const seeded = await seedSource()
  const initialEntries = seeded.storage.snapshot()
  const target = await createDraft('restore-version-1', 'restored', 1, 30)

  for (const point of DASHBOARD_STORAGE_BRANCH_SWITCH_CRASH_POINTS) {
    await t.test(point, async () => {
      const storage = new MemoryLocalStorage(initialEntries)
      const legacy = createLegacyStorageAdapter(storage)
      let crashed = false
      const crashInjector = event => {
        if (!crashed && event.point === point) {
          crashed = true
          throw new Error(`crash:${point}`)
        }
      }
      if (point === 'after-transition-intent') {
        await assert.rejects(prepare({ legacy, source: seeded.source, target, crashInjector }), /crash:/)
      } else {
        await prepare({ legacy, source: seeded.source, target })
        await assert.rejects(
          switchIndexedDbCompatibilityBranch({
            legacy,
            draft: target,
            restoreRequest: restoreRequest(target),
            now: () => 31,
            crashInjector,
          }),
          new RegExp(`crash:${point}`),
        )
      }
      assert.equal(crashed, true)

      const recovered = await recoverIndexedDbCompatibilityBranchSwitch({
        legacy,
        now: () => 32,
        ensureRestoreTarget: async request => {
          assert.deepEqual(request, restoreRequest(target))
          return { draft: target }
        },
      })
      assert.ok(recovered.status === 'recovered' || recovered.status === 'stable')
      assertTargetSurface({ storage, target })
    })
  }
})

test('recovery fails closed for a missing, divergent, or unrelated target authority', async () => {
  const { legacy, source, storage } = await seedSource()
  const target = await createDraft('restore-version-1', 'restored', 1, 30)
  await prepare({ legacy, source, target })

  await assert.rejects(
    recoverIndexedDbCompatibilityBranchSwitch({
      legacy,
      ensureRestoreTarget: async () => {
        throw new Error('exact restore target is unavailable')
      },
    }),
    /exact restore target is unavailable/,
  )
  const divergent = await createDraft(target.branchId, 'different bytes', 1, 30)
  await assert.rejects(
    recoverIndexedDbCompatibilityBranchSwitch({ legacy, ensureRestoreTarget: async () => ({ draft: divergent }) }),
    error => error.code === 'integrity-mismatch' && error.reason === 'branch-switch-target-draft-does-not-match-intent',
  )

  storage.setItem(
    DASHBOARD_STORAGE_IDENTITY_POINTER_KEY,
    JSON.stringify({ schemaVersion: 1, projectId: target.projectId, branchId: 'unrelated' }),
  )
  await assert.rejects(
    recoverIndexedDbCompatibilityBranchSwitch({ legacy, ensureRestoreTarget: async () => ({ draft: target }) }),
    error => error.code === 'integrity-mismatch' && error.reason === 'branch-switch-surface-has-unrelated-authority',
  )
})

test('prepare is exact-idempotent and aborts only while the target is absent and source remains active', async () => {
  const { legacy, source, storage } = await seedSource()
  const target = await createDraft('restore-version-1', 'restored', 1, 30)
  const first = await prepare({ legacy, source, target })
  const second = await prepare({ legacy, source, target })
  assert.equal(first.status, 'prepared')
  assert.equal(second.status, 'reconciled')

  const conflicting = { ...restoreRequest(target), targetSessionId: 'different-session' }
  await assert.rejects(
    prepareIndexedDbCompatibilityBranchSwitch({
      legacy,
      source: fence(source),
      target: fence(target),
      restoreRequest: conflicting,
      readDraft: async () => null,
    }),
    error => error.code === 'generation-conflict' && error.reason === 'another-branch-switch-is-already-pending',
  )

  const aborted = await abortPreparedIndexedDbCompatibilityBranchSwitch({
    legacy,
    restoreRequest: restoreRequest(target),
    readDraft: async () => null,
    now: () => 33,
  })
  assert.equal(aborted.status, 'aborted')
  assert.equal(JSON.parse(storage.getItem(DASHBOARD_STORAGE_BRANCH_SWITCH_KEY)).status, 'aborted')
  assert.equal(readStorageCompatibilityMarker(storage).marker?.branchId, source.branchId)

  const replacement = await prepare({ legacy, source, target })
  assert.equal(replacement.status, 'prepared')
  await assert.rejects(
    abortPreparedIndexedDbCompatibilityBranchSwitch({
      legacy,
      restoreRequest: restoreRequest(target),
      readDraft: async () => target,
    }),
    error => error.code === 'integrity-mismatch' && error.reason === 'branch-switch-target-exists-during-abort',
  )
})
