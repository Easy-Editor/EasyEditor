import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { canonicalJsonStringify } from '../src/lib/storage/canonical-json.mjs'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'

const projectId = 'project-local-material-version-restore'
const mainScope = Object.freeze({ projectId, branchId: 'main' })
const restoredScope = Object.freeze({ projectId, branchId: 'restored-online-v1' })
const sourceSessionId = 'session-source'
const sourceTaskId = 'task-promote-material'
const versionId = 'online-v1'

const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`

const artifactSource = `export default {
  mount(root) { root.textContent = 'version restore lifecycle' },
  update() {},
  destroy(root) { root.replaceChildren() },
}`

const sourceRevision = Object.freeze({
  artifactId: 'artifact-version-restore',
  sourceRevision: 'source-revision-1',
  logicalComponentId: 'logical-version-restore',
  sourceIntegrity: digest(artifactSource),
})

const onlineArtifactRef = Object.freeze({
  ...sourceRevision,
  target: Object.freeze({ kind: 'online' }),
})

const localArtifactRef = Object.freeze({
  ...sourceRevision,
  target: Object.freeze({
    kind: 'local-material',
    materialId: 'material-version-restore',
    materialVersion: '1.0.0',
    buildIntegrity: digest('durable-material-build'),
  }),
  rollbackTo: sourceRevision,
})

const materialIdentity = Object.freeze({
  materialId: localArtifactRef.target.materialId,
  materialVersion: localArtifactRef.target.materialVersion,
  buildIntegrity: localArtifactRef.target.buildIntegrity,
})

const activeDocument = Object.freeze({
  documentId: 'document-dashboard',
  fileName: 'Dashboard',
  index: 0,
})

const projectSchema = artifactRef => ({
  componentsTree: [
    {
      id: 'generated-material-host',
      componentName: 'GeneratedMaterialHost',
      props: {},
      $agent: {
        schemaVersion: 1,
        artifactRef,
      },
    },
  ],
})

const assertCanonicalSnapshotDigest = snapshot => {
  const { snapshotDigest, ...snapshotPayload } = snapshot
  assert.equal(snapshotDigest, digest(canonicalJsonStringify(snapshotPayload)))
}

test('named version restore recovers the online ref without disturbing the promoted main branch or GC roots', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const onlineProjectSchema = projectSchema(onlineArtifactRef)
  const localProjectSchema = projectSchema(localArtifactRef)

  await coordinator.createArtifact({
    schemaVersion: 1,
    projectId,
    ...sourceRevision,
    source: artifactSource,
    css: ':host { display: block; }',
    safeManifest: { schemaVersion: 1, title: 'Version Restore Material' },
    lockedDependencies: [],
    dependencyLockDigest: digest('[]'),
    diagnostics: [],
    provenance: { actor: 'agent-lifecycle-test' },
    createdAt: 1,
    supersedes: null,
  })

  const bootstrapped = await coordinator.commit({
    schemaVersion: 1,
    batchId: 'bootstrap-online-artifact-ref',
    ...mainScope,
    expectedDraftGeneration: 0,
    activeDocument,
    projectSchema: onlineProjectSchema,
    commitKind: 'manual-save',
    updatedAt: 10,
    operations: [],
  })
  assert.equal(bootstrapped.draft.draftGeneration, 1)
  assert.deepEqual(bootstrapped.draft.projectSchema, onlineProjectSchema)

  const sourceSession = await coordinator.saveAgentSession({
    schemaVersion: 1,
    batchId: 'save-source-session',
    ...mainScope,
    expectedDraftGeneration: 1,
    sessionId: sourceSessionId,
    status: 'active',
    createdAt: 20,
    updatedAt: 20,
    forkedFrom: null,
  })
  assert.equal(sourceSession.draft.draftGeneration, 2)

  await coordinator.commitAgentPersistence({
    schemaVersion: 1,
    ...mainScope,
    sessionId: sourceSessionId,
    batchId: 'persist-source-task',
    expectedPersistenceGeneration: 0,
    records: [
      {
        recordId: `task:${sourceTaskId}`,
        kind: 'journal-head',
        value: { taskId: sourceTaskId, phase: 'VERIFY' },
      },
    ],
  })
  assert.deepEqual(
    await coordinator.readAgentPersistence({
      schemaVersion: 1,
      ...mainScope,
      sessionId: sourceSessionId,
      expectedPersistenceGeneration: 0,
    }),
    {
      schemaVersion: 1,
      ...mainScope,
      sessionId: sourceSessionId,
      persistenceGeneration: 1,
      records: [
        {
          recordId: `task:${sourceTaskId}`,
          kind: 'journal-head',
          value: { taskId: sourceTaskId, phase: 'VERIFY' },
        },
      ],
    },
  )

  const version = await coordinator.createProjectVersion({
    schemaVersion: 1,
    batchId: 'create-online-v1',
    ...mainScope,
    expectedDraftGeneration: 2,
    versionId,
    name: 'Online v1',
    createdAt: 30,
    artifactRefs: [{ artifactId: sourceRevision.artifactId, sourceRevision: sourceRevision.sourceRevision }],
    sourceSessionId,
    sourceTaskId,
    sourceCheckpointId: null,
  })
  assert.equal(version.draft.draftGeneration, 3)
  assert.deepEqual(version.version.projectSchema, onlineProjectSchema)

  const promoted = await coordinator.commit({
    schemaVersion: 1,
    batchId: 'promote-main-to-local-material',
    ...mainScope,
    expectedDraftGeneration: 3,
    activeDocument,
    projectSchema: localProjectSchema,
    commitKind: 'agent-batch',
    updatedAt: 40,
    operations: [],
  })
  assert.equal(promoted.draft.draftGeneration, 4)
  assert.deepEqual(promoted.draft.projectSchema, localProjectSchema)

  const mainMaterialSnapshot = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  assert.deepEqual(await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId }), mainMaterialSnapshot)
  assertCanonicalSnapshotDigest(mainMaterialSnapshot)
  assert.deepEqual(mainMaterialSnapshot.generationFence, [{ branchId: mainScope.branchId, draftGeneration: 4 }])
  assert.deepEqual(mainMaterialSnapshot.sessionGenerationFence, [
    { branchId: mainScope.branchId, sessionId: sourceSessionId, persistenceGeneration: 1 },
  ])
  assert.deepEqual(mainMaterialSnapshot.materialRefs, [materialIdentity])
  assert.deepEqual(mainMaterialSnapshot.unresolvedPromotionIds, [])
  assert.deepEqual(mainMaterialSnapshot.rootFence, [
    {
      artifactId: sourceRevision.artifactId,
      branchId: mainScope.branchId,
      materialRefs: [],
      ownerId: versionId,
      ownerType: 'project-version',
      sourceRevision: sourceRevision.sourceRevision,
    },
    {
      artifactId: sourceRevision.artifactId,
      branchId: mainScope.branchId,
      materialRefs: [materialIdentity],
      ownerId: mainScope.branchId,
      ownerType: 'working-draft',
      sourceRevision: sourceRevision.sourceRevision,
    },
  ])
  assert.deepEqual(
    mainMaterialSnapshot.storeFence.map(({ store, recordCount }) => ({ store, recordCount })),
    [
      { store: 'workingDrafts', recordCount: 1 },
      { store: 'projectVersions', recordCount: 1 },
      { store: 'agentSessions', recordCount: 1 },
      { store: 'taskJournals', recordCount: 1 },
      { store: 'toolReceipts', recordCount: 0 },
      { store: 'receiptIntents', recordCount: 0 },
      { store: 'agentCheckpoints', recordCount: 1 },
      { store: 'artifactRefs', recordCount: 2 },
    ],
  )

  const restoreRequest = {
    schemaVersion: 1,
    batchId: 'restore-online-v1',
    projectId,
    sourceBranchId: mainScope.branchId,
    versionId,
    targetBranchId: restoredScope.branchId,
    targetSessionId: 'session-restored-online-v1',
    forkedFromSessionId: sourceSessionId,
    forkedFromTaskId: sourceTaskId,
    restoredAt: 50,
  }
  const restored = await coordinator.restoreProjectVersion(restoreRequest)
  assert.equal(restored.status, 'committed')
  assert.equal(restored.draft.draftGeneration, 1)
  assert.deepEqual(restored.draft.projectSchema, onlineProjectSchema)
  assert.deepEqual(restored.version.projectSchema, onlineProjectSchema)
  assert.deepEqual(restored.session.forkedFrom, {
    sessionId: sourceSessionId,
    taskId: sourceTaskId,
    versionId,
  })
  assert.notEqual(restored.draft.branchId, mainScope.branchId)
  assert.notEqual(restored.session.sessionId, sourceSessionId)
  assert.deepEqual((await coordinator.readWorkingDraft(mainScope)).projectSchema, localProjectSchema)

  const retried = await coordinator.restoreProjectVersion(restoreRequest)
  assert.equal(retried.status, 'reconciled')
  assert.deepEqual(retried.draft, restored.draft)
  assert.deepEqual(retried.session, restored.session)
  assert.deepEqual(retried.version, restored.version)
  assert.deepEqual((await coordinator.readWorkingDraft(mainScope)).projectSchema, localProjectSchema)

  const restoredMaterialSnapshot = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  assert.deepEqual(await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId }), restoredMaterialSnapshot)
  assertCanonicalSnapshotDigest(restoredMaterialSnapshot)
  assert.notEqual(restoredMaterialSnapshot.snapshotDigest, mainMaterialSnapshot.snapshotDigest)
  assert.deepEqual(restoredMaterialSnapshot.generationFence, [
    { branchId: mainScope.branchId, draftGeneration: 4 },
    { branchId: restoredScope.branchId, draftGeneration: 1 },
  ])
  assert.deepEqual(restoredMaterialSnapshot.sessionGenerationFence, [
    { branchId: mainScope.branchId, sessionId: sourceSessionId, persistenceGeneration: 1 },
    { branchId: restoredScope.branchId, sessionId: restoreRequest.targetSessionId, persistenceGeneration: 0 },
  ])
  assert.deepEqual(restoredMaterialSnapshot.materialRefs, [materialIdentity])
  assert.deepEqual(restoredMaterialSnapshot.unresolvedPromotionIds, [])
  assert.deepEqual(restoredMaterialSnapshot.rootFence, [
    ...mainMaterialSnapshot.rootFence,
    {
      artifactId: sourceRevision.artifactId,
      branchId: restoredScope.branchId,
      materialRefs: [],
      ownerId: restoredScope.branchId,
      ownerType: 'working-draft',
      sourceRevision: sourceRevision.sourceRevision,
    },
  ])
  assert.deepEqual(
    restoredMaterialSnapshot.storeFence.map(({ store, recordCount }) => ({ store, recordCount })),
    [
      { store: 'workingDrafts', recordCount: 2 },
      { store: 'projectVersions', recordCount: 1 },
      { store: 'agentSessions', recordCount: 2 },
      { store: 'taskJournals', recordCount: 1 },
      { store: 'toolReceipts', recordCount: 0 },
      { store: 'receiptIntents', recordCount: 0 },
      { store: 'agentCheckpoints', recordCount: 1 },
      { store: 'artifactRefs', recordCount: 3 },
    ],
  )

  const gcPlan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId })
  assert.equal(gcPlan.dryRun, true)
  assert.deepEqual(gcPlan.generationFence, [
    { branchId: mainScope.branchId, draftGeneration: 4 },
    { branchId: restoredScope.branchId, draftGeneration: 1 },
  ])
  assert.deepEqual(
    gcPlan.roots.map(root => [root.branchId, root.ownerType, root.ownerId]),
    [
      [mainScope.branchId, 'project-version', versionId],
      [mainScope.branchId, 'working-draft', mainScope.branchId],
      [restoredScope.branchId, 'working-draft', restoredScope.branchId],
    ],
  )
  assert.deepEqual(gcPlan.retainedArtifacts, [
    {
      artifactId: sourceRevision.artifactId,
      sourceRevision: sourceRevision.sourceRevision,
      referenceCount: 3,
    },
  ])
  assert.deepEqual(gcPlan.missingArtifacts, [])
  assert.deepEqual(gcPlan.deletionCandidates, [])
})
