import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AgentRuntime,
  AgentRuntimeBinding,
  AgentRuntimeOptions,
  AgentRuntimeSnapshot,
  UserIntent,
} from '@easy-editor/agent-runtime'
import type { DashboardPersistenceSnapshot } from '../../../editor/persistence-runtime'
import type { CanonicalWorkingDraftV1 } from '../../../lib/storage/contracts.mjs'
import type {
  DashboardAgentSessionRecordV1,
  DashboardLocalGrantRecordV1,
  DashboardProjectVersionRecordV1,
} from '../../../lib/storage/lifecycle.mjs'
import {
  type DashboardAgentWorkspaceComposition,
  type DashboardAgentWorkspaceCompositionDependencies,
  type DashboardAgentWorkspaceGrantAuthority,
  type DashboardAgentWorkspacePersistence,
  createDashboardAgentWorkspaceComposition,
} from './dashboard-composition.ts'

const grantAuthority: DashboardAgentWorkspaceGrantAuthority = {
  userId: 'user-1',
  policyVersion: 'policy-v1',
  providerId: 'gateway-main',
  providerFingerprint: 'fingerprint-a',
  providerLabel: 'Gateway Main',
}

const projectSchema = Object.freeze({ componentsTree: [{ componentName: 'Page', id: 'root' }] })

const draft = (branchId = 'main', generation = 1): CanonicalWorkingDraftV1 => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId,
  draftGeneration: generation,
  activeDocument: null,
  projectSchema,
  projectHash: `sha256:${'a'.repeat(64)}`,
  commitKind: branchId === 'main' ? 'manual-save' : 'version-restore',
  updatedAt: generation,
})

const persistenceSnapshot = (current: CanonicalWorkingDraftV1): DashboardPersistenceSnapshot => ({
  state: 'ready',
  projectId: current.projectId,
  branchId: current.branchId,
  draftGeneration: current.draftGeneration,
  projectHash: current.projectHash,
  projectSchemaVersion: null,
  activeDocument: current.activeDocument,
  pendingAutosave: false,
  compatibilityWarning: null,
  lastFailure: null,
})

const session = (branchId = 'main', sessionId = 'session-old'): DashboardAgentSessionRecordV1 => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId,
  sessionId,
  status: 'active',
  persistenceGeneration: 0,
  createdAt: 1,
  updatedAt: 1,
  closedAt: null,
  forkedFrom: null,
})

const version = (overrides: Partial<DashboardProjectVersionRecordV1> = {}): DashboardProjectVersionRecordV1 => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'main',
  versionId: 'version-1',
  name: '城市运行-v1',
  createdAt: 2,
  creationBatchId: 'version-batch',
  activeDocument: null,
  projectSchema,
  projectHash: `sha256:${'a'.repeat(64)}`,
  artifactRefs: [],
  sourceSessionId: 'session-old',
  sourceTaskId: 'task-1',
  sourceCheckpointId: null,
  ...overrides,
})

const grantedProjectWrite = (overrides: Partial<DashboardLocalGrantRecordV1> = {}): DashboardLocalGrantRecordV1 => ({
  schemaVersion: 1,
  userId: grantAuthority.userId,
  projectId: 'project-1',
  scope: 'project.write',
  policyVersion: grantAuthority.policyVersion,
  providerId: grantAuthority.providerId,
  providerFingerprint: grantAuthority.providerFingerprint,
  status: 'granted',
  grantedAt: 1,
  updatedAt: 1,
  revokedAt: null,
  ...overrides,
})

class FakePersistence implements DashboardAgentWorkspacePersistence {
  readonly events: string[]
  readonly listeners = new Set<() => void>()
  currentDraft: CanonicalWorkingDraftV1
  currentSession: DashboardAgentSessionRecordV1 | null
  versions: DashboardProjectVersionRecordV1[] = [version()]
  grants: DashboardLocalGrantRecordV1[] = []
  restoreError: Error | undefined
  restoreRequests: Parameters<DashboardAgentWorkspacePersistence['restoreProjectVersion']>[0][] = []
  grantChecks: Parameters<DashboardAgentWorkspacePersistence['checkLocalGrant']>[0][] = []

  constructor(
    events: string[],
    currentDraft = draft(),
    currentSession: DashboardAgentSessionRecordV1 | null = session(currentDraft.branchId),
  ) {
    this.events = events
    this.currentDraft = currentDraft
    this.currentSession = currentSession
  }

  getSnapshot = () => persistenceSnapshot(this.currentDraft)

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(): void {
    for (const listener of this.listeners) listener()
  }

  async flush(): Promise<void> {
    this.events.push('flush')
  }

  async readWorkingDraft(): Promise<CanonicalWorkingDraftV1> {
    this.events.push(`read-draft:${this.currentDraft.branchId}`)
    return structuredClone(this.currentDraft)
  }

  async resolveAgentSession(): Promise<DashboardAgentSessionRecordV1 | null> {
    return this.currentSession ? structuredClone(this.currentSession) : null
  }

  async saveAgentSession(
    request: Parameters<DashboardAgentWorkspacePersistence['saveAgentSession']>[0],
  ): Promise<Awaited<ReturnType<DashboardAgentWorkspacePersistence['saveAgentSession']>>> {
    this.events.push(`save-session:${request.sessionId}`)
    this.currentDraft = { ...this.currentDraft, draftGeneration: this.currentDraft.draftGeneration + 1 }
    this.currentSession = {
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      sessionId: request.sessionId,
      status: request.status,
      persistenceGeneration: 0,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      closedAt: null,
      forkedFrom: request.forkedFrom,
    }
    return { schemaVersion: 1, status: 'committed', session: this.currentSession, draft: this.currentDraft }
  }

  async listProjectVersions(): Promise<readonly DashboardProjectVersionRecordV1[]> {
    return structuredClone(this.versions)
  }

  async createProjectVersion(
    request: Parameters<DashboardAgentWorkspacePersistence['createProjectVersion']>[0],
  ): Promise<Awaited<ReturnType<DashboardAgentWorkspacePersistence['createProjectVersion']>>> {
    const created = version({
      branchId: request.branchId,
      versionId: request.versionId,
      name: request.name,
      sourceSessionId: request.sourceSessionId,
      sourceTaskId: request.sourceTaskId,
      sourceCheckpointId: request.sourceCheckpointId,
    })
    this.versions.push(created)
    return { schemaVersion: 1, status: 'committed', version: created, draft: this.currentDraft }
  }

  async restoreProjectVersion(
    request: Parameters<DashboardAgentWorkspacePersistence['restoreProjectVersion']>[0],
  ): Promise<Awaited<ReturnType<DashboardAgentWorkspacePersistence['restoreProjectVersion']>>> {
    this.events.push(`restore:${request.sourceBranchId}->${request.targetBranchId}`)
    this.restoreRequests.push(request)
    if (this.restoreError) throw this.restoreError
    this.currentDraft = draft(request.targetBranchId, 1)
    this.currentSession = {
      ...session(request.targetBranchId, request.targetSessionId),
      createdAt: request.restoredAt,
      updatedAt: request.restoredAt,
      forkedFrom: {
        sessionId: request.forkedFromSessionId,
        taskId: request.forkedFromTaskId,
        versionId: request.versionId,
      },
    }
    this.emit()
    return {
      schemaVersion: 1,
      status: 'committed',
      version: structuredClone(this.versions[0]),
      session: structuredClone(this.currentSession),
      draft: structuredClone(this.currentDraft),
    }
  }

  async listLocalGrants(): Promise<readonly DashboardLocalGrantRecordV1[]> {
    return structuredClone(this.grants)
  }

  async checkLocalGrant(
    request: Parameters<DashboardAgentWorkspacePersistence['checkLocalGrant']>[0],
  ): Promise<Awaited<ReturnType<DashboardAgentWorkspacePersistence['checkLocalGrant']>>> {
    this.grantChecks.push(structuredClone(request))
    const grant = this.grants
      .filter(
        value =>
          value.userId === request.userId && value.projectId === request.projectId && value.scope === request.scope,
      )
      .at(-1)
    if (!grant) return { schemaVersion: 1, granted: false, reason: 'missing', grant: null }
    if (String(grant.policyVersion) !== String(request.policyVersion)) {
      return { schemaVersion: 1, granted: false, reason: 'policy-version-changed', grant }
    }
    if (grant.providerId !== request.providerId) {
      return { schemaVersion: 1, granted: false, reason: 'provider-changed', grant }
    }
    if (grant.providerFingerprint !== request.providerFingerprint) {
      return { schemaVersion: 1, granted: false, reason: 'provider-fingerprint-changed', grant }
    }
    if (grant.status === 'revoked') return { schemaVersion: 1, granted: false, reason: 'revoked', grant }
    return { schemaVersion: 1, granted: true, reason: 'granted', grant }
  }

  async authorizeLocalGrant(
    request: Parameters<DashboardAgentWorkspacePersistence['authorizeLocalGrant']>[0],
  ): Promise<Awaited<ReturnType<DashboardAgentWorkspacePersistence['authorizeLocalGrant']>>> {
    const existing = this.grants
      .filter(
        value =>
          value.userId === request.userId &&
          value.projectId === request.projectId &&
          value.scope === request.scope &&
          String(value.policyVersion) === String(request.policyVersion) &&
          value.providerId === request.providerId &&
          value.providerFingerprint === request.providerFingerprint &&
          value.status === 'granted',
      )
      .at(-1)
    if (existing) return { schemaVersion: 1, status: 'reconciled', grant: existing, draft: this.currentDraft }
    const grantedAt = request.updatedAt
    const grant: DashboardLocalGrantRecordV1 = {
      schemaVersion: 1,
      userId: request.userId,
      projectId: request.projectId,
      scope: request.scope,
      policyVersion: request.policyVersion,
      providerId: request.providerId,
      providerFingerprint: request.providerFingerprint,
      status: 'granted',
      grantedAt,
      updatedAt: request.updatedAt,
      revokedAt: null,
    }
    this.grants = this.grants.filter(
      value =>
        !(value.userId === request.userId && value.projectId === request.projectId && value.scope === request.scope),
    )
    this.grants.push(grant)
    this.currentDraft = { ...this.currentDraft, draftGeneration: this.currentDraft.draftGeneration + 1 }
    this.emit()
    return { schemaVersion: 1, status: 'committed', grant, draft: this.currentDraft }
  }

  async revokeLocalGrant(
    request: Parameters<DashboardAgentWorkspacePersistence['revokeLocalGrant']>[0],
  ): Promise<Awaited<ReturnType<DashboardAgentWorkspacePersistence['revokeLocalGrant']>>> {
    const current = this.grants
      .filter(
        value =>
          value.userId === request.userId &&
          value.projectId === request.projectId &&
          value.scope === request.scope &&
          String(value.policyVersion) === String(request.policyVersion),
      )
      .at(-1)
    const grant = current
      ? { ...current, status: 'revoked' as const, revokedAt: request.revokedAt, updatedAt: request.revokedAt }
      : null
    if (grant) {
      this.grants = this.grants.filter(value => value !== current)
      this.grants.push(grant)
    }
    this.currentDraft = { ...this.currentDraft, draftGeneration: this.currentDraft.draftGeneration + 1 }
    this.emit()
    return { schemaVersion: 1, status: 'committed', grant, draft: this.currentDraft }
  }

  async enumerateArtifactRoots() {
    return { schemaVersion: 1 as const, projectId: 'project-1', generationFence: [], roots: [] }
  }

  async listCompensationRuns(): Promise<readonly []> {
    return []
  }

  async recoverDurableAgentReceipt() {
    return { classification: 'missing' as const }
  }
}

const runtimeSnapshot = (binding: AgentRuntimeBinding): AgentRuntimeSnapshot => ({
  schemaVersion: 1,
  binding: {
    projectId: binding.projectId,
    branchId: binding.branchId,
    sessionId: binding.sessionId ?? 'missing-session',
  },
  status: 'ready',
  phase: 'IDLE',
  revision: 1,
  tasks: [],
  recoveries: [],
})

const fakeRuntime = (binding: AgentRuntimeBinding, events: string[]): AgentRuntime => {
  const snapshot = runtimeSnapshot(binding)
  return {
    async submit(_intent: UserIntent) {
      events.push(`runtime-submit:${binding.branchId}`)
      return { taskId: 'task', sessionId: snapshot.binding.sessionId }
    },
    async compensate() {
      events.push(`runtime-compensate:${binding.branchId}`)
    },
    async pause() {},
    async resume() {},
    async cancel() {},
    async respond() {},
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    async dispose() {
      events.push(`runtime-dispose:${binding.branchId}`)
    },
  }
}

const ids = () => {
  const counts = new Map<string, number>()
  return (kind: 'batch' | 'branch' | 'session' | 'version') => {
    const count = (counts.get(kind) ?? 0) + 1
    counts.set(kind, count)
    return `${kind}-${count}`
  }
}

const dependencies = (
  persistence: FakePersistence,
  events: string[],
  options: {
    loadError?: Error
    reattachBinding?: () => string
    recoveryBridge?: DashboardAgentWorkspaceCompositionDependencies['recoveryBridge']
  } = {},
): DashboardAgentWorkspaceCompositionDependencies => ({
  runtimeEnabled: true,
  persistence,
  agentPersistence: {} as DashboardAgentWorkspaceCompositionDependencies['agentPersistence'],
  createSessionHost(binding) {
    events.push(`host-create:${binding.branchId}`)
    return {
      async observe() {
        throw new Error('not used')
      },
      async describeCapability() {
        throw new Error('not used')
      },
      async invoke() {
        throw new Error('not used')
      },
      async queryReceipt() {
        throw new Error('not used')
      },
      dispose() {
        events.push(`host-dispose:${binding.branchId}`)
      },
    }
  },
  createRuntime(runtimeOptions: AgentRuntimeOptions) {
    events.push(`runtime-create:${runtimeOptions.binding.branchId}`)
    return fakeRuntime(runtimeOptions.binding, events)
  },
  detachEditor() {
    events.push('detach')
  },
  loadEditorDraft(current) {
    events.push(`load:${current.branchId}`)
    if (options.loadError && current.branchId !== 'main') throw options.loadError
  },
  reattachEditor() {
    events.push(`reattach:${options.reattachBinding?.() ?? 'unknown'}`)
  },
  ...(options.recoveryBridge ? { recoveryBridge: options.recoveryBridge } : {}),
})

const workerFactory = () => {
  throw new Error('fake runtime must not consume the endpoint factory')
}

test('returns a typed unavailable controller when runtime is enabled without a production Worker factory', async () => {
  const events: string[] = []
  const persistence = new FakePersistence(events)
  const composition = await createDashboardAgentWorkspaceComposition({
    dependencies: dependencies(persistence, events),
    createId: ids(),
  })

  assert.deepEqual(composition.getBinding(), {
    projectId: 'project-1',
    branchId: 'main',
    sessionId: 'session-old',
  })
  assert.deepEqual(composition.getSnapshot().remote.availability, {
    state: 'unavailable',
    reason: 'Agent Runtime 尚未接入生产 Gateway Worker。',
  })
  assert.equal(
    events.some(event => event.startsWith('runtime-create:')),
    false,
  )
  await composition.dispose()
  await composition.dispose()
})

test('keeps durable compensation conflicts readable and refreshable when the production Runtime is unavailable', async () => {
  const events: string[] = []
  const persistence = new FakePersistence(events)
  const recoveryCalls: Array<{ operation: string; runtime: AgentRuntime | undefined }> = []
  const recovery = {
    kind: 'compensation-conflict' as const,
    recoveryId: 'compensation-conflict-1',
    taskId: 'task-1',
    message: '补偿已终止；只能刷新耐久冲突报告。',
    occurredAt: 20,
    conflictPaths: ['node:chart:props.title'],
  }
  const recoveryBridge: NonNullable<DashboardAgentWorkspaceCompositionDependencies['recoveryBridge']> = {
    async list(input) {
      recoveryCalls.push({ operation: 'list', runtime: input.runtime })
      return [recovery]
    },
    async retry(input) {
      recoveryCalls.push({ operation: input.action, runtime: input.runtime })
    },
  }
  const composition = await createDashboardAgentWorkspaceComposition({
    dependencies: dependencies(persistence, events, { recoveryBridge }),
    createId: ids(),
  })

  assert.equal(composition.getSnapshot().remote.availability.state, 'unavailable')
  assert.deepEqual(composition.getSnapshot().remote.recoveries, [recovery])
  assert.equal(await composition.controller.refreshCompensationConflict(recovery.recoveryId), true)
  assert.deepEqual(
    recoveryCalls.map(call => call.operation),
    ['list', 'refresh-conflict-report', 'list'],
  )
  assert.ok(recoveryCalls.every(call => call.runtime === undefined))
  await composition.dispose()
})

test('uses the dependency production recovery bridge by default for a live binding', async () => {
  const events: string[] = []
  const persistence = new FakePersistence(events)
  const runtimeInputs: AgentRuntime[] = []
  const recoveryBridge: NonNullable<DashboardAgentWorkspaceCompositionDependencies['recoveryBridge']> = {
    async list(input) {
      assert.ok(input.runtime)
      runtimeInputs.push(input.runtime)
      return []
    },
    async retry() {},
  }
  const composition = await createDashboardAgentWorkspaceComposition({
    dependencies: dependencies(persistence, events, { recoveryBridge }),
    workerFactory,
    createId: ids(),
  })

  assert.equal(runtimeInputs.length, 1)
  assert.equal(runtimeInputs[0]?.getSnapshot().binding.sessionId, 'session-old')
  await composition.dispose()
})

test('creates and binds an active durable session before composing the Host and Runtime', async () => {
  const events: string[] = []
  const persistence = new FakePersistence(events, draft(), null)
  const composition = await createDashboardAgentWorkspaceComposition({
    dependencies: dependencies(persistence, events),
    workerFactory,
    createId: ids(),
    now: () => 5,
  })

  assert.deepEqual(composition.getBinding(), {
    projectId: 'project-1',
    branchId: 'main',
    sessionId: 'session-1',
  })
  assert.ok(events.indexOf('save-session:session-1') < events.indexOf('host-create:main'))
  assert.equal(composition.getSnapshot().remote.availability.state, 'ready')
  await composition.dispose()
})

test('restores through the version source branch and switches the stable controller before reattaching', async () => {
  const events: string[] = []
  const persistence = new FakePersistence(events)
  persistence.grants = [grantedProjectWrite()]
  const compositionRef: { current?: DashboardAgentWorkspaceComposition } = {}
  const deps = dependencies(persistence, events, {
    reattachBinding: () => compositionRef.current?.getBinding().branchId ?? 'missing',
  })
  const composition = await createDashboardAgentWorkspaceComposition({
    dependencies: deps,
    workerFactory,
    grantAuthority,
    createId: ids(),
    now: () => 10,
  })
  compositionRef.current = composition
  const stableController = composition.controller
  events.length = 0

  assert.equal(await composition.controller.restoreVersion({ sourceBranchId: 'main', versionId: 'version-1' }), true)
  assert.equal(composition.controller, stableController)
  assert.equal(composition.getBinding().branchId, 'branch-1')
  assert.equal(
    composition.getSnapshot().remote.availability.state,
    'ready',
    JSON.stringify(composition.getSnapshot().remote.availability),
  )
  assert.equal(persistence.restoreRequests[0]?.sourceBranchId, 'main')
  assert.deepEqual(events.slice(0, 8), [
    'detach',
    'flush',
    'runtime-dispose:main',
    'host-dispose:main',
    'restore:main->branch-1',
    'read-draft:branch-1',
    'load:branch-1',
    'host-create:branch-1',
  ])
  assert.ok(events.indexOf('runtime-create:branch-1') < events.indexOf('reattach:branch-1'))
  await composition.dispose()
})

test('restores a lineage-free named version into a new branch and session without inventing lineage', async () => {
  const events: string[] = []
  const persistence = new FakePersistence(events)
  persistence.grants = [grantedProjectWrite()]
  persistence.versions = [version({ branchId: 'version-source', sourceSessionId: null, sourceTaskId: null })]
  const composition = await createDashboardAgentWorkspaceComposition({
    dependencies: dependencies(persistence, events),
    workerFactory,
    grantAuthority,
    createId: ids(),
    now: () => 10,
  })
  events.length = 0

  assert.equal(
    await composition.controller.restoreVersion({ sourceBranchId: 'version-source', versionId: 'version-1' }),
    true,
  )
  assert.deepEqual(composition.getBinding(), {
    projectId: 'project-1',
    branchId: 'branch-1',
    sessionId: 'session-1',
  })
  assert.deepEqual(persistence.restoreRequests[0], {
    schemaVersion: 1,
    batchId: 'batch-1',
    projectId: 'project-1',
    sourceBranchId: 'version-source',
    versionId: 'version-1',
    targetBranchId: 'branch-1',
    targetSessionId: 'session-1',
    forkedFromSessionId: null,
    forkedFromTaskId: null,
    restoredAt: 10,
  })
  assert.deepEqual(persistence.currentSession?.forkedFrom, {
    sessionId: null,
    taskId: null,
    versionId: 'version-1',
  })
  assert.ok(events.includes('restore:version-source->branch-1'))
  await composition.dispose()
})

test('rebuilds and reattaches the old binding when restore fails before the canonical branch switch', async () => {
  const events: string[] = []
  const persistence = new FakePersistence(events)
  persistence.grants = [grantedProjectWrite()]
  persistence.restoreError = new Error('restore rejected before commit')
  const compositionRef: { current?: DashboardAgentWorkspaceComposition } = {}
  const deps = dependencies(persistence, events, {
    reattachBinding: () => compositionRef.current?.getBinding().branchId ?? 'missing',
  })
  const composition = await createDashboardAgentWorkspaceComposition({
    dependencies: deps,
    workerFactory,
    grantAuthority,
    createId: ids(),
  })
  compositionRef.current = composition
  events.length = 0

  assert.equal(await composition.controller.restoreVersion({ sourceBranchId: 'main', versionId: 'version-1' }), false)
  assert.equal(composition.getBinding().branchId, 'main')
  assert.equal(composition.getSnapshot().remote.availability.state, 'ready')
  assert.ok(events.includes('read-draft:main'))
  assert.ok(events.includes('runtime-create:main'))
  assert.ok(events.includes('reattach:main'))
  await composition.dispose()
})

test('fails closed on the restored binding when loading the switched canonical draft fails', async () => {
  const events: string[] = []
  const persistence = new FakePersistence(events)
  persistence.grants = [grantedProjectWrite()]
  const composition = await createDashboardAgentWorkspaceComposition({
    dependencies: dependencies(persistence, events, { loadError: new Error('editor rejected restored draft') }),
    workerFactory,
    grantAuthority,
    createId: ids(),
  })
  events.length = 0

  assert.equal(await composition.controller.restoreVersion({ sourceBranchId: 'main', versionId: 'version-1' }), false)
  assert.equal(composition.getBinding().branchId, 'branch-1')
  assert.deepEqual(composition.getSnapshot().remote.availability, {
    state: 'unavailable',
    reason: 'Agent Workspace 已进入 fail-closed 状态。',
    detail: 'editor rejected restored draft',
  })
  assert.equal(events.includes('reattach:unknown'), false)
  assert.equal(events.includes('runtime-create:branch-1'), false)
  await composition.dispose()
})

test('checks exact project.write authority before Runtime effects, reuses confirmation, and denies immediately after revoke', async () => {
  const events: string[] = []
  const persistence = new FakePersistence(events)
  const createComposition = (authority: DashboardAgentWorkspaceGrantAuthority = grantAuthority) =>
    createDashboardAgentWorkspaceComposition({
      dependencies: dependencies(persistence, events),
      workerFactory,
      grantAuthority: authority,
      createId: ids(),
      now: () => 50,
    })

  const initial = await createComposition()
  initial.controller.setIntentDraft('搭建客户运营大屏')
  assert.equal(await initial.controller.submitIntent(), false)
  assert.match(initial.getSnapshot().actionError ?? '', /尚未授权.*project\.write/)
  assert.equal(events.includes('runtime-submit:main'), false)
  assert.deepEqual(persistence.grantChecks.at(-1), {
    schemaVersion: 1,
    userId: 'user-1',
    projectId: 'project-1',
    scope: 'project.write',
    policyVersion: 'policy-v1',
    providerId: 'gateway-main',
    providerFingerprint: 'fingerprint-a',
  })

  assert.equal(await initial.controller.requestGrant('project.write'), true)
  const generationAfterGrant = persistence.currentDraft.draftGeneration
  assert.equal(await initial.controller.requestGrant('project.write'), true)
  assert.equal(persistence.currentDraft.draftGeneration, generationAfterGrant, 'identical confirmation must be reused')
  initial.controller.setIntentDraft('搭建客户运营大屏')
  assert.equal(await initial.controller.submitIntent(), true)
  assert.equal(events.filter(event => event === 'runtime-submit:main').length, 1)
  await initial.dispose()

  const reloaded = await createComposition()
  reloaded.controller.setIntentDraft('继续完善客户运营大屏')
  assert.equal(await reloaded.controller.submitIntent(), true)
  assert.equal(events.filter(event => event === 'runtime-submit:main').length, 2)
  assert.equal(await reloaded.controller.revokeGrant('project.write'), true)
  reloaded.controller.setIntentDraft('撤销后不得继续写入')
  assert.equal(await reloaded.controller.submitIntent(), false)
  assert.match(reloaded.getSnapshot().actionError ?? '', /授权已撤销.*project\.write/)
  assert.equal(events.filter(event => event === 'runtime-submit:main').length, 2)
  await reloaded.dispose()

  for (const authority of [
    { ...grantAuthority, providerId: 'gateway-secondary' },
    { ...grantAuthority, providerFingerprint: 'fingerprint-b' },
    { ...grantAuthority, policyVersion: 'policy-v2' },
  ]) {
    const changed = await createComposition(authority)
    changed.controller.setIntentDraft('授权环境变化后不得复用')
    assert.equal(await changed.controller.submitIntent(), false)
    assert.match(changed.getSnapshot().actionError ?? '', /授权环境已变化|授权已撤销/)
    assert.equal(events.filter(event => event === 'runtime-submit:main').length, 2)
    assert.deepEqual(persistence.grantChecks.at(-1), {
      schemaVersion: 1,
      userId: authority.userId,
      projectId: 'project-1',
      scope: 'project.write',
      policyVersion: authority.policyVersion,
      providerId: authority.providerId,
      providerFingerprint: authority.providerFingerprint,
    })
    await changed.dispose()
  }
})
