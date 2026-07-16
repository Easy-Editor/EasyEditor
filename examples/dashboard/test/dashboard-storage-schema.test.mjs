import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DASHBOARD_STORAGE_COMPATIBILITY_MARKER_KEY,
  DASHBOARD_STORAGE_DATABASE_NAME,
  DASHBOARD_STORAGE_DATABASE_VERSION,
  DASHBOARD_STORAGE_IDENTITY_POINTER_KEY,
  DASHBOARD_STORAGE_STORES,
  ensureDashboardStorageSchema,
} from '../src/lib/storage/schema.mjs'
import {
  DASHBOARD_STORAGE_PARTIAL_V1_RESUME_FIXTURE,
  DASHBOARD_STORAGE_VERSION_ZERO_FIXTURE,
} from './fixtures/dashboard-storage-schema-upgrade-fixtures.mjs'

const expectedKeyPaths = {
  projects: 'projectId',
  workingDrafts: ['projectId', 'branchId'],
  projectVersions: ['projectId', 'branchId', 'versionId'],
  agentSessions: ['projectId', 'branchId', 'sessionId'],
  taskJournals: ['projectId', 'branchId', 'sessionId', 'recordId'],
  toolReceipts: ['projectId', 'branchId', 'callId'],
  receiptIntents: ['projectId', 'branchId', 'callId'],
  applyWitnesses: ['projectId', 'branchId', 'callId'],
  failureWitnesses: ['projectId', 'branchId', 'callId'],
  mutationProvenance: ['projectId', 'branchId', 'slotKey'],
  agentCheckpoints: ['projectId', 'branchId', 'checkpointId'],
  artifacts: ['projectId', 'artifactId', 'sourceRevision'],
  artifactRefs: ['projectId', 'branchId', 'ownerType', 'ownerId', 'artifactId', 'sourceRevision'],
  grants: ['userId', 'projectId', 'scope', 'policyVersion'],
  migrationState: ['projectId', 'branchId'],
}

test('storage identity, database name, stores, and key paths are frozen protocol constants', () => {
  assert.equal(DASHBOARD_STORAGE_DATABASE_NAME, 'easy-editor-dashboard-storage')
  assert.equal(DASHBOARD_STORAGE_DATABASE_VERSION, 1)
  assert.equal(DASHBOARD_STORAGE_IDENTITY_POINTER_KEY, 'easy-editor:storage:active:v1')
  assert.equal(DASHBOARD_STORAGE_COMPATIBILITY_MARKER_KEY, 'easy-editor:storage:compatibility:v1')
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(DASHBOARD_STORAGE_STORES).map(([name, descriptor]) => [name, descriptor.keyPath]),
    ),
    expectedKeyPaths,
  )
  assert.ok(Object.isFrozen(DASHBOARD_STORAGE_STORES))
  for (const descriptor of Object.values(DASHBOARD_STORAGE_STORES)) {
    assert.ok(Object.isFrozen(descriptor))
    if (Array.isArray(descriptor.keyPath)) assert.ok(Object.isFrozen(descriptor.keyPath))
  }
})

test('schema upgrade creates every missing store once and is idempotent', () => {
  const created = new Map()
  const database = {
    objectStoreNames: {
      contains: name => created.has(name),
    },
    createObjectStore(name, options) {
      assert.equal(created.has(name), false)
      created.set(name, options)
      return { name }
    },
  }

  ensureDashboardStorageSchema(database)
  ensureDashboardStorageSchema(database)

  assert.deepEqual(Object.fromEntries([...created].map(([name, options]) => [name, options.keyPath])), expectedKeyPaths)
})

const createFixtureDatabase = fixture => {
  const stores = new Map(fixture.existingStores.map(store => [store.name, structuredClone(store.keyPath)]))
  const createAttempts = []
  let remainingSuccessfulCreates = Number.POSITIVE_INFINITY

  return {
    database: {
      objectStoreNames: {
        contains: name => stores.has(name),
      },
      createObjectStore(name, options) {
        createAttempts.push(name)
        if (remainingSuccessfulCreates === 0) throw new Error('simulated-schema-upgrade-interruption')
        remainingSuccessfulCreates -= 1
        assert.equal(stores.has(name), false)
        stores.set(name, structuredClone(options.keyPath))
        return { name }
      },
    },
    createAttempts,
    interruptAfter(successfulCreates) {
      remainingSuccessfulCreates = successfulCreates
    },
    resume() {
      remainingSuccessfulCreates = Number.POSITIVE_INFINITY
    },
    snapshot() {
      return Object.fromEntries(stores)
    },
  }
}

test('version-zero fixture upgrades to the complete first released schema', () => {
  assert.equal(DASHBOARD_STORAGE_VERSION_ZERO_FIXTURE.oldVersion, 0)
  const fixtureDatabase = createFixtureDatabase(DASHBOARD_STORAGE_VERSION_ZERO_FIXTURE)

  ensureDashboardStorageSchema(fixtureDatabase.database)

  assert.deepEqual(fixtureDatabase.snapshot(), expectedKeyPaths)
  assert.deepEqual(fixtureDatabase.createAttempts, Object.keys(expectedKeyPaths))
})

test('partial-v1 fixture resumes after interruption without recreating existing stores', () => {
  assert.equal(DASHBOARD_STORAGE_PARTIAL_V1_RESUME_FIXTURE.oldVersion, 0)
  const fixtureDatabase = createFixtureDatabase(DASHBOARD_STORAGE_PARTIAL_V1_RESUME_FIXTURE)
  const existingNames = DASHBOARD_STORAGE_PARTIAL_V1_RESUME_FIXTURE.existingStores.map(store => store.name)
  const initialSnapshot = fixtureDatabase.snapshot()
  fixtureDatabase.interruptAfter(2)

  assert.throws(() => ensureDashboardStorageSchema(fixtureDatabase.database), /simulated-schema-upgrade-interruption/u)
  assert.deepEqual(
    Object.fromEntries(existingNames.map(name => [name, fixtureDatabase.snapshot()[name]])),
    initialSnapshot,
  )
  assert.equal(
    fixtureDatabase.createAttempts.some(name => existingNames.includes(name)),
    false,
  )

  fixtureDatabase.resume()
  ensureDashboardStorageSchema(fixtureDatabase.database)
  const attemptsAfterResume = fixtureDatabase.createAttempts.length
  ensureDashboardStorageSchema(fixtureDatabase.database)

  assert.deepEqual(fixtureDatabase.snapshot(), expectedKeyPaths)
  assert.equal(fixtureDatabase.createAttempts.length, attemptsAfterResume)
})
