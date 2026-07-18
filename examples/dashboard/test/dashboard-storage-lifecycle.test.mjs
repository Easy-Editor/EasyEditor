import assert from 'node:assert/strict'
import test from 'node:test'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'

const scope = Object.freeze({ projectId: 'project-lifecycle', branchId: 'main' })
const activeDocument = Object.freeze({ documentId: 'document-1', fileName: 'Home', index: 0 })
const projectSchema = Object.freeze({
  componentsTree: [
    {
      componentName: 'GeneratedMaterialHost',
      id: 'root',
      $agent: {
        schemaVersion: 1,
        artifactRef: {
          artifactId: 'artifact-kpi',
          sourceRevision: 'revision-7',
          logicalComponentId: 'logical-kpi',
          sourceIntegrity: `sha256:${'a'.repeat(64)}`,
          target: { kind: 'online' },
        },
      },
    },
  ],
})

const bootstrap = async (backend = new MemoryDashboardStorageBackend()) => {
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const committed = await coordinator.commit({
    schemaVersion: 1,
    batchId: 'bootstrap',
    ...scope,
    expectedDraftGeneration: 0,
    activeDocument,
    projectSchema,
    commitKind: 'manual-save',
    updatedAt: 10,
    operations: [
      {
        type: 'put',
        store: 'artifacts',
        value: {
          schemaVersion: 1,
          projectId: scope.projectId,
          artifactId: 'artifact-kpi',
          sourceRevision: 'revision-7',
          createdAt: 8,
        },
      },
    ],
  })
  return { backend, coordinator, draft: committed.draft }
}

const versionRequest = (overrides = {}) => ({
  schemaVersion: 1,
  batchId: 'version-city-v1',
  ...scope,
  expectedDraftGeneration: 1,
  versionId: 'city-v1',
  name: '城市运行-v1',
  createdAt: 20,
  artifactRefs: [{ artifactId: 'artifact-kpi', sourceRevision: 'revision-7' }],
  sourceSessionId: 'session-1',
  sourceTaskId: 'task-1',
  sourceCheckpointId: 'checkpoint-1',
  ...overrides,
})

test('named project versions are immutable, stable-listable, and exact retries do not advance the draft', async () => {
  const { backend, coordinator } = await bootstrap()

  const first = await coordinator.createProjectVersion(versionRequest())
  assert.equal(first.draft.draftGeneration, 2)
  assert.equal(first.draft.commitKind, 'named-version')
  assert.deepEqual(first.version.artifactRefs, [{ artifactId: 'artifact-kpi', sourceRevision: 'revision-7' }])
  assert.deepEqual(
    await backend.get('artifactRefs', [
      scope.projectId,
      scope.branchId,
      'project-version',
      'city-v1',
      'artifact-kpi',
      'revision-7',
    ]),
    {
      schemaVersion: 1,
      ...scope,
      ownerType: 'project-version',
      ownerId: 'city-v1',
      artifactId: 'artifact-kpi',
      sourceRevision: 'revision-7',
      materialRefs: [],
    },
  )

  const retried = await coordinator.createProjectVersion(versionRequest())
  assert.deepEqual(retried.version, first.version)
  assert.equal(retried.draft.draftGeneration, 2)

  await assert.rejects(
    coordinator.createProjectVersion(versionRequest({ name: '同 ID 的不同内容' })),
    error =>
      error.code === 'integrity-mismatch' && error.reason === 'project-version-id-was-reused-with-different-bytes',
  )
  assert.deepEqual(
    await coordinator.getProjectVersion({ schemaVersion: 1, ...scope, versionId: 'city-v1' }),
    first.version,
  )
  assert.deepEqual(await coordinator.listProjectVersions({ schemaVersion: 1, projectId: scope.projectId }), [
    first.version,
  ])
})

test('an original project-version request reconciles after later draft edits without advancing the draft', async () => {
  const { backend, coordinator } = await bootstrap()
  const first = await coordinator.createProjectVersion(versionRequest())
  const edited = await coordinator.commit({
    schemaVersion: 1,
    batchId: 'edit-after-version-create',
    ...scope,
    expectedDraftGeneration: 2,
    activeDocument,
    projectSchema: { componentsTree: [{ componentName: 'Root', id: 'root' }] },
    commitKind: 'manual-save',
    updatedAt: 21,
    operations: [],
  })
  assert.equal(edited.draft.draftGeneration, 3)

  const replayed = await coordinator.createProjectVersion(versionRequest())
  assert.equal(replayed.status, 'reconciled')
  assert.deepEqual(replayed.version, first.version)
  assert.equal(replayed.draft.draftGeneration, 3)
  assert.deepEqual(
    await backend.get('artifactRefs', [
      scope.projectId,
      scope.branchId,
      'project-version',
      'city-v1',
      'artifact-kpi',
      'revision-7',
    ]),
    {
      schemaVersion: 1,
      ...scope,
      ownerType: 'project-version',
      ownerId: 'city-v1',
      artifactId: 'artifact-kpi',
      sourceRevision: 'revision-7',
      materialRefs: [],
    },
  )
})

test('named project versions reject missing or forged artifact refs before creating roots', async () => {
  const { backend, coordinator } = await bootstrap()
  const cases = [
    versionRequest({
      batchId: 'version-missing-ref',
      versionId: 'missing-ref',
      artifactRefs: [],
    }),
    versionRequest({
      batchId: 'version-forged-ref',
      versionId: 'forged-ref',
      artifactRefs: [
        { artifactId: 'artifact-kpi', sourceRevision: 'revision-7' },
        { artifactId: 'artifact-forged', sourceRevision: 'revision-1' },
      ],
    }),
  ]

  for (const request of cases) {
    await assert.rejects(
      coordinator.createProjectVersion(request),
      error =>
        error.code === 'validation-failed' &&
        error.reason === 'project-version-create.artifactRefs-must-match-current-project-schema',
    )
    assert.equal(await backend.get('projectVersions', [scope.projectId, scope.branchId, request.versionId]), undefined)
  }
  assert.equal(
    await backend.get('artifactRefs', [
      scope.projectId,
      scope.branchId,
      'project-version',
      'forged-ref',
      'artifact-forged',
      'revision-1',
    ]),
    undefined,
  )
  assert.equal((await coordinator.readWorkingDraft(scope)).draftGeneration, 1)
})

test('stored project versions fail closed when schema-derived and recorded artifact refs diverge', async () => {
  const { backend, coordinator } = await bootstrap()
  const created = await coordinator.createProjectVersion(versionRequest())
  const current = await coordinator.readWorkingDraft(scope)
  await backend.commit({
    schemaVersion: 1,
    batchId: 'inject-inconsistent-project-version',
    ...scope,
    expectedDraftGeneration: current.draftGeneration,
    draft: {
      ...current,
      draftGeneration: current.draftGeneration + 1,
      commitKind: 'manual-save',
      updatedAt: 22,
    },
    operations: [
      {
        type: 'put',
        store: 'projectVersions',
        value: { ...created.version, artifactRefs: [] },
      },
    ],
  })

  await assert.rejects(
    coordinator.getProjectVersion({ schemaVersion: 1, ...scope, versionId: created.version.versionId }),
    error => error.code === 'integrity-mismatch' && error.reason === 'stored-project-version-contract-is-invalid',
  )
})

test('version creation is atomic under a storage abort and can be retried without partial roots', async () => {
  let fail = true
  const backend = new MemoryDashboardStorageBackend({
    faultInjector(event) {
      if (
        fail &&
        event.batch.batchId === 'version-city-v1' &&
        event.phase === 'after-operation' &&
        event.operationIndex === 1
      ) {
        fail = false
        throw new Error('simulated version transaction loss')
      }
    },
  })
  const { coordinator } = await bootstrap(backend)

  await assert.rejects(
    coordinator.createProjectVersion(versionRequest()),
    error => error.code === 'transaction-aborted',
  )
  assert.equal(await backend.get('projectVersions', [scope.projectId, scope.branchId, 'city-v1']), undefined)
  assert.equal(
    await backend.get('artifactRefs', [
      scope.projectId,
      scope.branchId,
      'project-version',
      'city-v1',
      'artifact-kpi',
      'revision-7',
    ]),
    undefined,
  )
  assert.equal((await coordinator.readWorkingDraft(scope)).draftGeneration, 1)

  const retried = await coordinator.createProjectVersion(versionRequest())
  assert.equal(retried.draft.draftGeneration, 2)
})

const sessionRequest = (overrides = {}) => ({
  schemaVersion: 1,
  batchId: 'session-1-active',
  ...scope,
  expectedDraftGeneration: 1,
  sessionId: 'session-1',
  status: 'active',
  createdAt: 30,
  updatedAt: 30,
  forkedFrom: null,
  ...overrides,
})

test('session lifecycle resolves active/latest, demotes prior active sessions, and preserves metadata on journal commits', async () => {
  const { backend, coordinator } = await bootstrap()
  const first = await coordinator.saveAgentSession(sessionRequest())
  assert.equal(first.session.persistenceGeneration, 0)
  assert.equal(first.draft.draftGeneration, 2)

  const second = await coordinator.saveAgentSession(
    sessionRequest({
      batchId: 'session-2-active',
      expectedDraftGeneration: 2,
      sessionId: 'session-2',
      createdAt: 40,
      updatedAt: 40,
      forkedFrom: { sessionId: 'session-1', taskId: 'task-1', versionId: 'city-v1' },
    }),
  )
  assert.equal(second.draft.draftGeneration, 3)
  assert.equal((await coordinator.resolveAgentSession({ schemaVersion: 1, ...scope })).sessionId, 'session-2')
  assert.deepEqual(
    (await coordinator.listAgentSessions({ schemaVersion: 1, ...scope })).map(session => [
      session.sessionId,
      session.status,
    ]),
    [
      ['session-1', 'idle'],
      ['session-2', 'active'],
    ],
  )

  assert.equal(
    (
      await coordinator.commitAgentPersistence({
        schemaVersion: 1,
        ...scope,
        sessionId: 'session-2',
        batchId: 'session-2-journal-1',
        expectedPersistenceGeneration: 0,
        records: [{ recordId: 'task:2', kind: 'journal-head', value: { taskId: 'task-2', phase: 'OBSERVE' } }],
      })
    ).status,
    'committed',
  )
  assert.deepEqual(await backend.get('agentSessions', [scope.projectId, scope.branchId, 'session-2']), {
    ...second.session,
    persistenceGeneration: 1,
  })

  await coordinator.saveAgentSession(
    sessionRequest({
      batchId: 'session-2-closed',
      expectedDraftGeneration: 3,
      sessionId: 'session-2',
      createdAt: 40,
      updatedAt: 50,
      status: 'closed',
      forkedFrom: { sessionId: 'session-1', taskId: 'task-1', versionId: 'city-v1' },
    }),
  )
  assert.equal((await coordinator.resolveAgentSession({ schemaVersion: 1, ...scope })).sessionId, 'session-1')
})

test('legacy minimal Agent session rows are enriched without losing persistence generation', async () => {
  const backend = new MemoryDashboardStorageBackend()
  await backend.commitAgentPersistence({
    schemaVersion: 1,
    ...scope,
    sessionId: 'legacy-session',
    batchId: 'legacy-journal',
    expectedPersistenceGeneration: 0,
    records: [],
  })

  assert.deepEqual(await backend.get('agentSessions', [scope.projectId, scope.branchId, 'legacy-session']), {
    schemaVersion: 1,
    ...scope,
    sessionId: 'legacy-session',
    status: 'active',
    persistenceGeneration: 1,
    createdAt: 0,
    updatedAt: 0,
    closedAt: null,
    forkedFrom: null,
  })
})

test('restoring a named version forks an isolated branch/session and is idempotent without copying old lineage', async () => {
  const { backend, coordinator } = await bootstrap()
  await coordinator.createProjectVersion(versionRequest())
  await coordinator.commitAgentPersistence({
    schemaVersion: 1,
    ...scope,
    sessionId: 'session-1',
    batchId: 'old-journal',
    expectedPersistenceGeneration: 0,
    records: [{ recordId: 'task:1', kind: 'journal-head', value: { taskId: 'task-1' } }],
  })
  await coordinator.recordReceiptIntent({
    schemaVersion: 1,
    ...scope,
    callId: 'old-call',
    preparedHash: `sha256:${'a'.repeat(64)}`,
    baseRevision: 'old-revision',
    preImages: {},
    expectedPostImages: {},
    status: 'pending',
  })

  const request = {
    schemaVersion: 1,
    batchId: 'restore-city-v1',
    projectId: scope.projectId,
    sourceBranchId: scope.branchId,
    versionId: 'city-v1',
    targetBranchId: 'restore-city-v1',
    targetSessionId: 'session-restore-1',
    forkedFromSessionId: 'session-1',
    forkedFromTaskId: 'task-1',
    restoredAt: 60,
  }
  const restored = await coordinator.restoreProjectVersion(request)
  assert.equal(restored.status, 'committed')
  assert.equal(restored.draft.branchId, 'restore-city-v1')
  assert.equal(restored.draft.commitKind, 'version-restore')
  assert.equal(restored.draft.draftGeneration, 1)
  assert.deepEqual(restored.session.forkedFrom, {
    sessionId: 'session-1',
    taskId: 'task-1',
    versionId: 'city-v1',
  })
  assert.deepEqual(await backend.getAll('taskJournals'), [
    {
      schemaVersion: 1,
      ...scope,
      sessionId: 'session-1',
      recordId: 'task:1',
      kind: 'journal-head',
      value: { taskId: 'task-1' },
    },
  ])
  assert.equal(await backend.get('receiptIntents', [scope.projectId, 'restore-city-v1', 'old-call']), undefined)
  assert.equal(await backend.get('toolReceipts', [scope.projectId, 'restore-city-v1', 'old-call']), undefined)

  const retried = await coordinator.restoreProjectVersion(request)
  assert.equal(retried.status, 'reconciled')
  assert.equal(retried.draft.draftGeneration, 1)

  await assert.rejects(
    coordinator.restoreProjectVersion({
      ...request,
      batchId: 'restore-city-v1-wrong-lineage',
      targetBranchId: 'restore-city-v1-wrong-lineage',
      targetSessionId: 'session-restore-wrong-lineage',
      forkedFromTaskId: 'different-task',
    }),
    error => error.code === 'integrity-mismatch' && error.reason === 'project-version-restore-source-lineage-mismatch',
  )
})

test('taskless named versions preserve explicit null lineage and reject invented restore authority', async () => {
  const { coordinator } = await bootstrap()
  await coordinator.createProjectVersion(
    versionRequest({
      batchId: 'version-taskless',
      versionId: 'taskless-v1',
      name: 'Taskless v1',
      sourceSessionId: null,
      sourceTaskId: null,
      sourceCheckpointId: null,
    }),
  )

  const request = {
    schemaVersion: 1,
    batchId: 'restore-taskless-v1',
    projectId: scope.projectId,
    sourceBranchId: scope.branchId,
    versionId: 'taskless-v1',
    targetBranchId: 'restore-taskless-v1',
    targetSessionId: 'session-restore-taskless-v1',
    forkedFromSessionId: null,
    forkedFromTaskId: null,
    restoredAt: 60,
  }
  const restored = await coordinator.restoreProjectVersion(request)
  assert.deepEqual(restored.session.forkedFrom, {
    sessionId: null,
    taskId: null,
    versionId: 'taskless-v1',
  })
  assert.equal((await coordinator.restoreProjectVersion(request)).status, 'reconciled')

  for (const field of ['forkedFromSessionId', 'forkedFromTaskId']) {
    const missing = structuredClone(request)
    delete missing[field]
    await assert.rejects(
      coordinator.restoreProjectVersion(missing),
      error =>
        error.code === 'validation-failed' && error.reason === 'project-version-restore-fields-must-match-contract',
    )
  }
  await assert.rejects(
    coordinator.restoreProjectVersion({ ...request, unexpected: true }),
    error =>
      error.code === 'validation-failed' && error.reason === 'project-version-restore-fields-must-match-contract',
  )

  for (const [suffix, forgedLineage] of [
    ['session', { forkedFromSessionId: 'invented-session', forkedFromTaskId: null }],
    ['task', { forkedFromSessionId: null, forkedFromTaskId: 'invented-task' }],
  ]) {
    await assert.rejects(
      coordinator.restoreProjectVersion({
        ...request,
        batchId: `restore-taskless-v1-forged-${suffix}`,
        targetBranchId: `restore-taskless-v1-forged-${suffix}`,
        targetSessionId: `session-restore-taskless-v1-forged-${suffix}`,
        ...forgedLineage,
      }),
      error =>
        error.code === 'integrity-mismatch' && error.reason === 'project-version-restore-source-lineage-mismatch',
    )
  }
})

const grantRequest = (overrides = {}) => ({
  schemaVersion: 1,
  batchId: 'grant-project-write',
  ...scope,
  expectedDraftGeneration: 1,
  userId: 'user-1',
  scope: 'project.write',
  policyVersion: 'policy-v1',
  providerId: 'gateway-main',
  providerFingerprint: 'fingerprint-a',
  updatedAt: 70,
  ...overrides,
})

const grantCheck = (overrides = {}) => ({
  schemaVersion: 1,
  userId: 'user-1',
  projectId: scope.projectId,
  scope: 'project.write',
  policyVersion: 'policy-v1',
  providerId: 'gateway-main',
  providerFingerprint: 'fingerprint-a',
  ...overrides,
})

test('local grants are reused only for the exact scope/policy/provider fingerprint and revoke immediately', async () => {
  const { coordinator } = await bootstrap()
  assert.equal((await coordinator.checkLocalGrant(grantCheck())).reason, 'missing')

  const authorized = await coordinator.authorizeLocalGrant(grantRequest())
  assert.equal(authorized.draft.draftGeneration, 2)
  assert.deepEqual(await coordinator.checkLocalGrant(grantCheck()), {
    schemaVersion: 1,
    granted: true,
    reason: 'granted',
    grant: authorized.grant,
  })
  assert.equal(
    (await coordinator.authorizeLocalGrant(grantRequest())).draft.draftGeneration,
    2,
    'an exact retry must not create another durable generation',
  )
  assert.equal(
    (await coordinator.checkLocalGrant(grantCheck({ providerId: 'gateway-secondary' }))).reason,
    'provider-changed',
  )
  assert.equal(
    (await coordinator.checkLocalGrant(grantCheck({ providerFingerprint: 'fingerprint-b' }))).reason,
    'provider-fingerprint-changed',
  )
  assert.equal(
    (await coordinator.checkLocalGrant(grantCheck({ policyVersion: 'policy-v2' }))).reason,
    'policy-version-changed',
  )
  assert.equal((await coordinator.checkLocalGrant(grantCheck({ scope: 'data.read' }))).reason, 'missing')

  const revoked = await coordinator.revokeLocalGrant({
    schemaVersion: 1,
    batchId: 'revoke-project-write',
    ...scope,
    expectedDraftGeneration: 2,
    userId: 'user-1',
    scope: 'project.write',
    policyVersion: 'policy-v1',
    revokedAt: 71,
  })
  assert.equal(revoked.grant.status, 'revoked')
  assert.equal((await coordinator.checkLocalGrant(grantCheck())).reason, 'revoked')
  assert.deepEqual(
    await coordinator.listLocalGrants({ schemaVersion: 1, userId: 'user-1', projectId: scope.projectId }),
    [revoked.grant],
  )
})

test('artifact root enumeration and GC dry-run are deterministic and retain missing referenced artifacts', async () => {
  const { coordinator } = await bootstrap()
  await coordinator.commit({
    schemaVersion: 1,
    batchId: 'seed-artifact-roots',
    ...scope,
    expectedDraftGeneration: 1,
    activeDocument,
    projectSchema,
    commitKind: 'agent-batch',
    updatedAt: 80,
    operations: [
      {
        type: 'put',
        store: 'artifacts',
        value: {
          schemaVersion: 1,
          projectId: scope.projectId,
          artifactId: 'artifact-orphan',
          sourceRevision: 'revision-1',
        },
      },
      {
        type: 'put',
        store: 'artifactRefs',
        value: {
          schemaVersion: 1,
          ...scope,
          ownerType: 'receipt-intent',
          ownerId: 'call-pending',
          artifactId: 'artifact-missing-but-live',
          sourceRevision: 'revision-3',
        },
      },
      {
        type: 'put',
        store: 'artifactRefs',
        value: {
          schemaVersion: 1,
          ...scope,
          ownerType: 'checkpoint',
          ownerId: 'checkpoint-1',
          artifactId: 'artifact-kpi',
          sourceRevision: 'revision-7',
        },
      },
    ],
  })

  const roots = await coordinator.enumerateArtifactRoots({ schemaVersion: 1, projectId: scope.projectId })
  assert.deepEqual(roots.generationFence, [{ branchId: 'main', draftGeneration: 2 }])
  assert.deepEqual(
    roots.roots.map(root => [root.ownerType, root.ownerId, root.artifactId]),
    [
      ['checkpoint', 'checkpoint-1', 'artifact-kpi'],
      ['receipt-intent', 'call-pending', 'artifact-missing-but-live'],
      ['working-draft', 'main', 'artifact-kpi'],
    ],
  )

  const plan = await coordinator.planArtifactGcDryRun({ schemaVersion: 1, projectId: scope.projectId })
  assert.equal(plan.dryRun, true)
  assert.deepEqual(plan.retainedArtifacts, [
    { artifactId: 'artifact-kpi', sourceRevision: 'revision-7', referenceCount: 2 },
    { artifactId: 'artifact-missing-but-live', sourceRevision: 'revision-3', referenceCount: 1 },
  ])
  assert.deepEqual(plan.missingArtifacts, [
    { artifactId: 'artifact-missing-but-live', sourceRevision: 'revision-3', referenceCount: 1 },
  ])
  assert.deepEqual(plan.deletionCandidates, [{ artifactId: 'artifact-orphan', sourceRevision: 'revision-1' }])
})
