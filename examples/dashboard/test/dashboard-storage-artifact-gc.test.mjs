import assert from 'node:assert/strict'
import test from 'node:test'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'

const projectId = 'project-artifact-gc'
const branchId = 'main'
const draftCommit = (expectedDraftGeneration, operations = []) => ({
  schemaVersion: 1,
  batchId: `draft-${expectedDraftGeneration + 1}`,
  projectId,
  branchId,
  expectedDraftGeneration,
  activeDocument: null,
  projectSchema: { componentsTree: [] },
  commitKind: 'manual-save',
  updatedAt: expectedDraftGeneration + 1,
  operations,
})

const artifactIdentity = (artifactId, sourceRevision) => ({ artifactId, sourceRevision })

const root = (ownerType, ownerId, artifactId, sourceRevision) => ({
  schemaVersion: 1,
  projectId,
  branchId,
  ownerType,
  ownerId,
  artifactId,
  sourceRevision,
})

const immutableArtifact = (artifactId, sourceRevision) => ({
  schemaVersion: 1,
  projectId,
  artifactId,
  sourceRevision,
  logicalComponentId: `logical-${artifactId}`,
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
})

const createFixture = async ({ onlyLive = false } = {}) => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  await coordinator.createArtifact(immutableArtifact('artifact-live', 'revision-1'))
  if (!onlyLive) await coordinator.createArtifact(immutableArtifact('artifact-orphan', 'r2'))
  await coordinator.createArtifactRoot(root('working-draft', branchId, 'artifact-live', 'revision-1'))
  await coordinator.createArtifactRoot(root('receipt-intent', 'call-missing', 'artifact-missing', 'revision-9'))
  await coordinator.commit(draftCommit(0))
  return { backend, coordinator }
}

test('Memory mark+sweep is deterministic, deletes only orphans, retains roots, and reports missing artifacts', async () => {
  const { backend, coordinator } = await createFixture()
  const request = { schemaVersion: 1, projectId }
  const first = await coordinator.planArtifactGcDryRun(request)
  const second = await coordinator.planArtifactGcDryRun(request)

  assert.deepEqual(second, first)
  assert.deepEqual(first.generationFence, [{ branchId, draftGeneration: 1 }])
  assert.deepEqual(first.artifactIdentityFence, [
    artifactIdentity('artifact-live', 'revision-1'),
    artifactIdentity('artifact-orphan', 'r2'),
  ])
  assert.deepEqual(first.rootFence, [
    {
      branchId,
      ownerType: 'receipt-intent',
      ownerId: 'call-missing',
      artifactId: 'artifact-missing',
      sourceRevision: 'revision-9',
    },
    {
      branchId,
      ownerType: 'working-draft',
      ownerId: branchId,
      artifactId: 'artifact-live',
      sourceRevision: 'revision-1',
    },
  ])
  assert.deepEqual(first.missingArtifacts, [
    { artifactId: 'artifact-missing', sourceRevision: 'revision-9', referenceCount: 1 },
  ])
  assert.deepEqual(first.deletionCandidates, [artifactIdentity('artifact-orphan', 'r2')])

  const swept = await coordinator.sweepArtifactGc(first)
  assert.equal(swept.dryRun, false)
  assert.deepEqual(swept.deletedArtifacts, first.deletionCandidates)
  assert.deepEqual(swept.deletionCandidates, first.deletionCandidates)
  assert.equal(await backend.get('artifacts', [projectId, 'artifact-orphan', 'r2']), undefined)
  assert.deepEqual(
    await backend.get('artifactRefs', [projectId, branchId, 'working-draft', branchId, 'artifact-live', 'revision-1']),
    root('working-draft', branchId, 'artifact-live', 'revision-1'),
  )
  assert.deepEqual((await coordinator.planArtifactGcDryRun(request)).deletionCandidates, [])
})

test('Memory sweep rejects all three post-mark fence races and deletes nothing', async t => {
  await t.test('working draft generation changed', async () => {
    const { backend, coordinator } = await createFixture()
    const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
    await coordinator.commit(draftCommit(1))
    await assert.rejects(
      coordinator.sweepArtifactGc(plan),
      error => error.code === 'generation-conflict' && error.reason === 'artifact-gc-working-draft-fence-changed',
    )
    assert.notEqual(await backend.get('artifacts', [projectId, 'artifact-orphan', 'r2']), undefined)
  })

  await t.test('artifact identity set changed', async () => {
    const { backend, coordinator } = await createFixture()
    const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
    await backend.createArtifact(immutableArtifact('artifact-raced', 'revision-1'))
    await assert.rejects(
      coordinator.sweepArtifactGc(plan),
      error => error.code === 'generation-conflict' && error.reason === 'artifact-gc-artifact-fence-changed',
    )
    assert.notEqual(await backend.get('artifacts', [projectId, 'artifact-orphan', 'r2']), undefined)
  })

  await t.test('artifact root set changed', async () => {
    const { backend, coordinator } = await createFixture()
    const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
    await backend.createArtifactRoot(root('checkpoint', 'checkpoint-raced', 'artifact-orphan', 'r2'))
    await assert.rejects(
      coordinator.sweepArtifactGc(plan),
      error => error.code === 'generation-conflict' && error.reason === 'artifact-gc-root-fence-changed',
    )
    assert.notEqual(await backend.get('artifacts', [projectId, 'artifact-orphan', 'r2']), undefined)
  })

  await t.test('artifact root was released', async () => {
    const { backend, coordinator } = await createFixture()
    const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
    await backend.deleteArtifactRoot(root('working-draft', branchId, 'artifact-live', 'revision-1'))
    await assert.rejects(
      coordinator.sweepArtifactGc(plan),
      error => error.code === 'generation-conflict' && error.reason === 'artifact-gc-root-fence-changed',
    )
    assert.notEqual(await backend.get('artifacts', [projectId, 'artifact-orphan', 'r2']), undefined)

    const fresh = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
    const swept = await coordinator.sweepArtifactGc(fresh)
    assert.deepEqual(swept.deletedArtifacts, [
      artifactIdentity('artifact-live', 'revision-1'),
      artifactIdentity('artifact-orphan', 'r2'),
    ])
  })
})

test('empty-candidate sweep still revalidates every fence', async () => {
  const { backend, coordinator } = await createFixture({ onlyLive: true })
  const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
  assert.deepEqual(plan.deletionCandidates, [])

  await backend.createArtifactRoot(root('checkpoint', 'late-root', 'artifact-live', 'revision-1'))
  await assert.rejects(
    coordinator.sweepArtifactGc(plan),
    error => error.code === 'generation-conflict' && error.reason === 'artifact-gc-root-fence-changed',
  )

  const fresh = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
  const result = await coordinator.sweepArtifactGc(fresh)
  assert.deepEqual(result.deletedArtifacts, [])
  assert.deepEqual(await backend.getAll('artifactRefs'), [
    root('working-draft', branchId, 'artifact-live', 'revision-1'),
    root('receipt-intent', 'call-missing', 'artifact-missing', 'revision-9'),
    root('checkpoint', 'late-root', 'artifact-live', 'revision-1'),
  ])
})
