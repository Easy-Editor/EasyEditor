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

const onlineArtifactRef = (artifactId, sourceRevision) => ({
  artifactId,
  sourceRevision,
  logicalComponentId: `logical-${artifactId}`,
  sourceIntegrity: `sha256:${'a'.repeat(64)}`,
  target: { kind: 'online' },
})

const projectSchemaWithArtifactRefs = (...refs) => ({
  componentsTree: [
    {
      id: 'document-1',
      componentName: 'Root',
      children: refs.map((artifactRef, index) => ({
        id: `generated-${index + 1}`,
        componentName: 'GeneratedMaterialHost',
        $agent: { schemaVersion: 1, artifactRef },
      })),
    },
  ],
})

const root = (ownerType, ownerId, artifactId, sourceRevision) => ({
  schemaVersion: 1,
  projectId,
  branchId,
  ownerType,
  ownerId,
  artifactId,
  sourceRevision,
})

const normalizedRoot = (ownerType, ownerId, artifactId, sourceRevision) => ({
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
  await coordinator.createArtifactRoot(root('receipt-intent', 'call-missing', 'artifact-missing', 'revision-9'))
  await coordinator.commit({
    ...draftCommit(0),
    projectSchema: projectSchemaWithArtifactRefs(onlineArtifactRef('artifact-live', 'revision-1')),
  })
  return { backend, coordinator }
}

test('working-draft roots are schema-derived and reject caller or public API bypasses', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const live = onlineArtifactRef('artifact-live', 'revision-1')
  const forged = onlineArtifactRef('artifact-forged', 'revision-1')
  const forgedRoot = root('working-draft', 'forged-owner', forged.artifactId, forged.sourceRevision)
  await coordinator.createArtifact(immutableArtifact(live.artifactId, live.sourceRevision))
  await coordinator.createArtifact(immutableArtifact(forged.artifactId, forged.sourceRevision))

  await assert.rejects(
    coordinator.createArtifactRoot(forgedRoot),
    error =>
      error.code === 'validation-failed' && error.reason === 'working-draft-artifact-roots-are-coordinator-controlled',
  )

  await backend.createArtifactRoot(forgedRoot)
  await coordinator.commit({
    ...draftCommit(0, [
      { type: 'put', store: 'artifactRefs', value: forgedRoot },
      {
        type: 'delete',
        store: 'artifactRefs',
        key: [projectId, branchId, 'working-draft', branchId, live.artifactId, live.sourceRevision],
      },
    ]),
    batchId: 'reject-working-draft-bypass',
    projectSchema: projectSchemaWithArtifactRefs(live),
  })

  assert.deepEqual((await coordinator.enumerateArtifactRoots({ schemaVersion: 1, projectId })).roots, [
    normalizedRoot('working-draft', branchId, live.artifactId, live.sourceRevision),
  ])
  await assert.rejects(
    coordinator.deleteArtifactRoot(root('working-draft', branchId, live.artifactId, live.sourceRevision)),
    error =>
      error.code === 'validation-failed' && error.reason === 'working-draft-artifact-roots-are-coordinator-controlled',
  )

  const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
  assert.deepEqual(plan.deletionCandidates, [artifactIdentity(forged.artifactId, forged.sourceRevision)])
  assert.deepEqual((await coordinator.sweepArtifactGc(plan)).deletedArtifacts, plan.deletionCandidates)
})

test('artifact collection follows only componentsTree children and ignores business $agent values', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const childRef = onlineArtifactRef('artifact-child', 'revision-1')
  const ignoredRef = onlineArtifactRef('artifact-business-data', 'revision-1')

  await coordinator.commit({
    ...draftCommit(0),
    batchId: 'schema-node-only-artifact-collection',
    projectSchema: {
      meta: { $agent: { schemaVersion: 1, artifactRef: ignoredRef } },
      componentsTree: [
        {
          id: 'root',
          componentName: 'Root',
          props: { $agent: { business: true } },
          data: { nested: { $agent: { schemaVersion: 1, artifactRef: ignoredRef } } },
          children: [
            {
              id: 'generated-child',
              componentName: 'GeneratedMaterialHost',
              $agent: { schemaVersion: 1, artifactRef: childRef },
            },
          ],
        },
      ],
    },
  })

  assert.deepEqual((await coordinator.enumerateArtifactRoots({ schemaVersion: 1, projectId })).roots, [
    normalizedRoot('working-draft', branchId, childRef.artifactId, childRef.sourceRevision),
  ])
})

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
    root('receipt-intent', 'call-missing', 'artifact-missing', 'revision-9'),
    root('working-draft', branchId, 'artifact-live', 'revision-1'),
    root('checkpoint', 'late-root', 'artifact-live', 'revision-1'),
  ])
})

test('ordinary saves reconcile exact working-draft roots while durable lineage retains superseded revisions', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const revision1 = onlineArtifactRef('artifact-revised', 'revision-1')
  const revision2 = onlineArtifactRef('artifact-revised', 'revision-2')
  await coordinator.createArtifact(immutableArtifact(revision1.artifactId, revision1.sourceRevision))
  await coordinator.createArtifact(immutableArtifact(revision2.artifactId, revision2.sourceRevision))

  await coordinator.commit({
    ...draftCommit(0),
    batchId: 'save-revision-1',
    projectSchema: projectSchemaWithArtifactRefs(revision1, revision1),
  })
  assert.deepEqual(await coordinator.enumerateArtifactRoots({ schemaVersion: 1, projectId }), {
    schemaVersion: 1,
    projectId,
    generationFence: [{ branchId, draftGeneration: 1 }],
    roots: [normalizedRoot('working-draft', branchId, revision1.artifactId, revision1.sourceRevision)],
  })

  const revision1LineageRoots = [
    root('receipt-intent', 'revise-call-1', revision1.artifactId, revision1.sourceRevision),
    root('tool-receipt', 'revise-call-1', revision1.artifactId, revision1.sourceRevision),
    root(
      'task-journal',
      'task-journal-v1:session-1:call%3Arevise-call-1',
      revision1.artifactId,
      revision1.sourceRevision,
    ),
    root('checkpoint', 'call:revise-call-1', revision1.artifactId, revision1.sourceRevision),
  ]
  for (const lineageRoot of revision1LineageRoots) await coordinator.createArtifactRoot(lineageRoot)

  const revision2LineageRoots = [revision1, revision2].flatMap(revision => [
    root('receipt-intent', 'revise-call-2', revision.artifactId, revision.sourceRevision),
    root('tool-receipt', 'revise-call-2', revision.artifactId, revision.sourceRevision),
    root(
      'task-journal',
      'task-journal-v1:session-1:call%3Arevise-call-2',
      revision.artifactId,
      revision.sourceRevision,
    ),
    root('checkpoint', 'call:revise-call-2', revision.artifactId, revision.sourceRevision),
  ])

  await coordinator.commit({
    ...draftCommit(
      1,
      revision2LineageRoots.map(value => ({ type: 'put', store: 'artifactRefs', mode: 'add', value })),
    ),
    batchId: 'save-revision-2',
    projectSchema: projectSchemaWithArtifactRefs(revision2),
  })
  const afterRevision = await coordinator.enumerateArtifactRoots({ schemaVersion: 1, projectId })
  assert.equal(
    afterRevision.roots.some(
      candidate => candidate.ownerType === 'working-draft' && candidate.sourceRevision === revision1.sourceRevision,
    ),
    false,
  )
  assert.equal(
    afterRevision.roots.some(
      candidate => candidate.ownerType === 'working-draft' && candidate.sourceRevision === revision2.sourceRevision,
    ),
    true,
  )
  assert.deepEqual((await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })).deletionCandidates, [])

  await coordinator.commit({
    ...draftCommit(2),
    batchId: 'remove-generated-node',
    projectSchema: projectSchemaWithArtifactRefs(),
  })
  const afterRemoval = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
  assert.deepEqual(afterRemoval.deletionCandidates, [])
  assert.notEqual(
    await coordinator.readArtifact({
      schemaVersion: 1,
      projectId,
      artifactId: revision1.artifactId,
      sourceRevision: revision1.sourceRevision,
    }),
    null,
  )

  for (const lineageRoot of revision2LineageRoots) await coordinator.deleteArtifactRoot(lineageRoot)
  const releasedRevision2 = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
  assert.deepEqual(releasedRevision2.deletionCandidates, [
    artifactIdentity(revision2.artifactId, revision2.sourceRevision),
  ])
  assert.deepEqual(
    (await coordinator.sweepArtifactGc(releasedRevision2)).deletedArtifacts,
    releasedRevision2.deletionCandidates,
  )

  for (const lineageRoot of revision1LineageRoots) await coordinator.deleteArtifactRoot(lineageRoot)
  const released = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
  assert.deepEqual(released.deletionCandidates, [artifactIdentity(revision1.artifactId, revision1.sourceRevision)])
  assert.deepEqual((await coordinator.sweepArtifactGc(released)).deletedArtifacts, released.deletionCandidates)
})

test('Memory save abort leaves the prior draft and exact working-draft roots unchanged', async () => {
  let failReplacement = true
  const backend = new MemoryDashboardStorageBackend({
    faultInjector(event) {
      if (failReplacement && event.batch.batchId === 'replace-fault' && event.phase === 'before-commit') {
        failReplacement = false
        throw new Error('simulated transaction loss')
      }
    },
  })
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const revision1 = onlineArtifactRef('artifact-atomic', 'revision-1')
  const revision2 = onlineArtifactRef('artifact-atomic', 'revision-2')

  await coordinator.commit({
    ...draftCommit(0),
    batchId: 'atomic-bootstrap',
    projectSchema: projectSchemaWithArtifactRefs(revision1),
  })
  await assert.rejects(
    coordinator.commit({
      ...draftCommit(1),
      batchId: 'replace-fault',
      projectSchema: projectSchemaWithArtifactRefs(revision2),
    }),
    error => error.code === 'transaction-aborted',
  )

  assert.equal((await coordinator.readWorkingDraft({ projectId, branchId })).draftGeneration, 1)
  assert.deepEqual((await coordinator.enumerateArtifactRoots({ schemaVersion: 1, projectId })).roots, [
    normalizedRoot('working-draft', branchId, revision1.artifactId, revision1.sourceRevision),
  ])
})

test('concurrent coordinators share the draft-generation CAS and cannot leave a losing working-draft root', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const firstCoordinator = new ProjectPersistenceCoordinator({ backend })
  const secondCoordinator = new ProjectPersistenceCoordinator({ backend })
  const revision1 = onlineArtifactRef('artifact-cas', 'revision-1')
  const revision2 = onlineArtifactRef('artifact-cas', 'revision-2')
  const revision3 = onlineArtifactRef('artifact-cas', 'revision-3')
  await firstCoordinator.commit({
    ...draftCommit(0),
    batchId: 'cas-bootstrap',
    projectSchema: projectSchemaWithArtifactRefs(revision1),
  })

  const results = await Promise.allSettled([
    firstCoordinator.commit({
      ...draftCommit(1),
      batchId: 'cas-revision-2',
      projectSchema: projectSchemaWithArtifactRefs(revision2),
    }),
    secondCoordinator.commit({
      ...draftCommit(1),
      batchId: 'cas-revision-3',
      projectSchema: projectSchemaWithArtifactRefs(revision3),
    }),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'generation-conflict')

  const draft = await firstCoordinator.readWorkingDraft({ projectId, branchId })
  const finalRef = draft.projectSchema.componentsTree[0].children[0].$agent.artifactRef
  assert.deepEqual((await firstCoordinator.enumerateArtifactRoots({ schemaVersion: 1, projectId })).roots, [
    normalizedRoot('working-draft', branchId, finalRef.artifactId, finalRef.sourceRevision),
  ])
})
