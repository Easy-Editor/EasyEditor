import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRuntime } from '@easy-editor/agent-runtime'
import type { DashboardInvocationActivity } from '../../../editor/agent/activity/invocation-activity.mjs'
import type { DashboardPersistenceSnapshot } from '../../../editor/persistence-runtime'
import {
  type AgentWorkspaceBinding,
  AgentWorkspaceGrantConfirmationRequiredError,
  type AgentWorkspaceInvocationActivity,
  type AgentWorkspaceInvocationSnapshot,
  type AgentWorkspaceLocalGrantDecision,
  type AgentWorkspacePersistenceLifecycle,
  type AgentWorkspacePersistenceProjection,
  type AgentWorkspacePersistenceSnapshot,
  type AgentWorkspaceRuntimeFacade,
  type AgentWorkspaceRuntimeSnapshot,
  type AgentWorkspaceRuntimeTask,
  createAgentWorkspaceCommandPortAdapter,
} from './command-port-adapter.ts'

type AssertAssignable<Condition extends true> = Condition

const SHARED_CONTRACT_COMPATIBILITY: readonly [
  AssertAssignable<AgentRuntime extends AgentWorkspaceRuntimeFacade ? true : false>,
  AssertAssignable<DashboardInvocationActivity extends AgentWorkspaceInvocationActivity ? true : false>,
  AssertAssignable<DashboardPersistenceSnapshot extends AgentWorkspacePersistenceSnapshot ? true : false>,
] = [true, true, true]

const binding: AgentWorkspaceBinding = { projectId: 'project-1', branchId: 'main' }

const runtimeTask = (overrides: Partial<AgentWorkspaceRuntimeTask> = {}): AgentWorkspaceRuntimeTask => ({
  taskId: 'task-1',
  sessionId: 'session-1',
  phase: 'COMPLETED',
  compensationEligible: true,
  createdAt: 10,
  updatedAt: 20,
  intent: { text: '搭建运营大屏' },
  sessionContext: {
    sourceHash: 'context-hash',
    includedTaskIds: ['task-1'],
    omittedTaskCount: 0,
    unresolvedConstraints: [],
    omittedUnresolvedConstraintCount: 0,
  },
  ...overrides,
})

const runtimeSnapshot = (overrides: Partial<AgentWorkspaceRuntimeSnapshot> = {}): AgentWorkspaceRuntimeSnapshot => ({
  binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' },
  status: 'ready',
  revision: 1,
  tasks: [],
  ...overrides,
})

const persistenceSnapshot = (
  overrides: Partial<AgentWorkspacePersistenceSnapshot> = {},
): AgentWorkspacePersistenceSnapshot => ({
  state: 'ready',
  projectId: 'project-1',
  branchId: 'main',
  draftGeneration: 4,
  pendingAutosave: false,
  lastFailure: null,
  ...overrides,
})

const emptyProjection = (): AgentWorkspacePersistenceProjection => ({ versions: [], grants: [], recoveries: [] })

class FakeRuntime implements AgentWorkspaceRuntimeFacade {
  readonly calls: unknown[] = []
  readonly listeners = new Set<(snapshot: AgentWorkspaceRuntimeSnapshot) => void>()
  snapshot: AgentWorkspaceRuntimeSnapshot
  releaseCount = 0

  constructor(snapshot: AgentWorkspaceRuntimeSnapshot) {
    this.snapshot = snapshot
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: (snapshot: AgentWorkspaceRuntimeSnapshot) => void) => {
    this.listeners.add(listener)
    return () => {
      if (this.listeners.delete(listener)) this.releaseCount += 1
    }
  }

  emit(snapshot: AgentWorkspaceRuntimeSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }

  async submit(input: Parameters<AgentWorkspaceRuntimeFacade['submit']>[0]): Promise<void> {
    this.calls.push(['submit', input])
  }

  async pause(taskId: string): Promise<void> {
    this.calls.push(['pause', taskId])
  }

  async resume(taskId: string): Promise<void> {
    this.calls.push(['resume', taskId])
  }

  async cancel(taskId: string): Promise<void> {
    this.calls.push(['cancel', taskId])
  }

  async respond(taskId: string, response: Readonly<{ questionId: string; value: string }>): Promise<void> {
    this.calls.push(['respond', taskId, response])
  }

  async compensate(taskId: string): Promise<void> {
    this.calls.push(['compensate', taskId])
  }
}

class FakePersistence implements AgentWorkspacePersistenceLifecycle {
  readonly calls: unknown[] = []
  readonly listeners = new Set<() => void>()
  snapshot: AgentWorkspacePersistenceSnapshot
  projection: AgentWorkspacePersistenceProjection
  releaseCount = 0
  grantDecision: AgentWorkspaceLocalGrantDecision = { granted: true, reason: 'granted' }
  grantOnRequest = false
  readonly grantChecks: Parameters<AgentWorkspacePersistenceLifecycle['checkLocalGrant']>[0][] = []
  readWorkspaceProjectionImpl: (binding: AgentWorkspaceBinding) => Promise<AgentWorkspacePersistenceProjection> =
    async () => this.projection

  constructor(snapshot: AgentWorkspacePersistenceSnapshot, projection: AgentWorkspacePersistenceProjection) {
    this.snapshot = snapshot
    this.projection = projection
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      if (this.listeners.delete(listener)) this.releaseCount += 1
    }
  }

  emit(snapshot = this.snapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }

  readWorkspaceProjection = (currentBinding: AgentWorkspaceBinding) => {
    this.calls.push(['read', currentBinding])
    return this.readWorkspaceProjectionImpl(currentBinding)
  }

  async createVersion(input: Parameters<AgentWorkspacePersistenceLifecycle['createVersion']>[0]): Promise<void> {
    this.calls.push(['create-version', input])
  }

  async restoreVersion(input: Parameters<AgentWorkspacePersistenceLifecycle['restoreVersion']>[0]): Promise<void> {
    this.calls.push(['restore-version', input])
  }

  async checkLocalGrant(
    input: Parameters<AgentWorkspacePersistenceLifecycle['checkLocalGrant']>[0],
  ): Promise<AgentWorkspaceLocalGrantDecision> {
    this.grantChecks.push(input)
    return this.grantDecision
  }

  async requestGrant(input: Parameters<AgentWorkspacePersistenceLifecycle['requestGrant']>[0]): Promise<void> {
    this.calls.push(['request-grant', input])
    if (this.grantOnRequest && this.grantDecision.reason !== 'revoked') {
      this.grantDecision = { granted: true, reason: 'granted' }
    }
  }

  async revokeGrant(input: Parameters<AgentWorkspacePersistenceLifecycle['revokeGrant']>[0]): Promise<void> {
    this.calls.push(['revoke-grant', input])
  }

  async retryRecovery(input: Parameters<AgentWorkspacePersistenceLifecycle['retryRecovery']>[0]): Promise<void> {
    this.calls.push(['retry-recovery', input])
  }
}

class FakeActivity implements AgentWorkspaceInvocationActivity {
  readonly listeners = new Set<() => void>()
  snapshot: AgentWorkspaceInvocationSnapshot
  releaseCount = 0

  constructor(snapshot: AgentWorkspaceInvocationSnapshot) {
    this.snapshot = snapshot
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      if (this.listeners.delete(listener)) this.releaseCount += 1
    }
  }

  emit(snapshot: AgentWorkspaceInvocationSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

test('stays structurally compatible with the shared Runtime, activity and persistence snapshots', () => {
  assert.deepEqual(SHARED_CONTRACT_COMPATIBILITY, [true, true, true])
})

test('maps Runtime, lifecycle recoveries and atomic or resolved targets into a stable Workspace snapshot', async () => {
  const firstTask = runtimeTask({ taskId: 'task-a', createdAt: 10, updatedAt: 11 })
  const activeTask = runtimeTask({
    taskId: 'task-b',
    phase: 'WAITING_USER',
    createdAt: 20,
    updatedAt: 21,
    parentTaskId: 'task-a',
    acceptedBlueprint: { summary: '先布局，再绑定数据', unresolvedConstraints: ['确认配色'] },
    question: { questionId: 'question-1', prompt: '是否使用深色主题？' },
    checkpointId: 'checkpoint-b',
    sessionContext: {
      sourceHash: 'context-b',
      includedTaskIds: ['task-a', 'task-b'],
      omittedTaskCount: 2,
      unresolvedConstraints: [{ kind: 'question' }, { kind: 'blueprint' }],
      omittedUnresolvedConstraintCount: 1,
    },
  })
  const runtime = new FakeRuntime(
    runtimeSnapshot({
      revision: 3,
      activeTask,
      tasks: [activeTask, runtimeTask({ taskId: 'foreign-task', sessionId: 'other-session' }), firstTask],
    }),
  )
  const persistence = new FakePersistence(
    persistenceSnapshot({
      lastFailure: {
        source: 'autosave',
        message: '自动保存失败',
        recoveryId: 'save-1',
        occurredAt: 8,
      },
    }),
    {
      versions: [
        {
          versionId: 'version-b',
          name: '第二版',
          createdAt: 30,
          branchId: 'main',
          projectHash: 'sha256:b',
          sourceSessionId: 'session-1',
          sourceTaskId: 'task-b',
        },
        {
          versionId: 'version-a',
          name: '第一版',
          createdAt: 20,
          branchId: 'main',
          projectHash: 'sha256:a',
          sourceSessionId: null,
          sourceTaskId: null,
        },
      ],
      grants: [
        { scope: 'online-code.author', status: 'granted', policyVersion: 2, grantedAt: 7 },
        { scope: 'project.write', status: 'required', policyVersion: 'v1' },
      ],
      recoveries: [
        {
          kind: 'compensation-conflict',
          recoveryId: 'conflict-1',
          taskId: 'task-a',
          message: '字段已被人工修改',
          occurredAt: 13,
          conflictPaths: ['z.path', 'a.path', 'z.path'],
        },
        {
          kind: 'applied-undurable',
          recoveryId: 'durable-1',
          taskId: 'task-b',
          callId: 'call-1',
          message: '画布已修改但回执未保存',
          occurredAt: 12,
        },
      ],
    },
  )
  const activity = new FakeActivity({
    revision: 1,
    activeCalls: [
      {
        callId: 'call-1',
        capability: 'screen.applyChangeSet',
        taskId: 'task-b',
        startedAt: 5,
        targetNodeIds: ['node-a', 'node-b'],
        targets: [
          {
            nodeId: 'node-b',
            label: '趋势图',
            rect: { x: 200, y: 40, width: 300, height: 160 },
          },
        ],
      },
      {
        callId: 'call-foreign',
        capability: 'screen.applyChangeSet',
        taskId: 'foreign-task',
        startedAt: 6,
        targetNodeIds: ['node-foreign'],
        targets: [
          {
            nodeId: 'node-foreign',
            label: '其他会话目标',
            rect: { x: 1, y: 1, width: 10, height: 10 },
          },
        ],
      },
    ],
  })
  const resolvedCalls: unknown[] = []
  const port = createAgentWorkspaceCommandPortAdapter({
    enabled: true,
    binding,
    runtime,
    persistence,
    invocationActivity: activity,
    targetRectResolver: {
      async resolveTargets(input) {
        resolvedCalls.push(input)
        return [
          { targetId: 'node-a', label: '标题', rect: { x: 10, y: 20, width: 120, height: 32 } },
          { targetId: 'node-unrequested', label: '非请求目标', rect: { x: 1, y: 1, width: 10, height: 10 } },
        ]
      },
    },
    now: () => 100,
  })

  assert.equal(port.getSnapshot().availability.state, 'unavailable')
  await port.ready()

  const snapshot = port.getSnapshot()
  assert.equal(snapshot.availability.state, 'ready')
  assert.equal(snapshot.runtimeStatus, 'ready')
  assert.equal(snapshot.sessionId, 'session-1')
  assert.equal(snapshot.activeTaskId, 'task-b')
  assert.deepEqual(
    snapshot.tasks.map(task => task.taskId),
    ['task-a', 'task-b'],
  )
  assert.deepEqual(snapshot.tasks[1]?.blueprint, { summary: '先布局，再绑定数据', steps: [] })
  assert.deepEqual(snapshot.tasks[1]?.contextDigest, {
    sourceHash: 'context-b',
    includedTaskIds: ['task-a', 'task-b'],
    omittedTaskCount: 2,
    unresolvedConstraintCount: 3,
  })
  assert.equal(snapshot.tasks[1]?.checkpointId, 'checkpoint-b')
  assert.equal(snapshot.tasks[0]?.compensationEligible, true)
  assert.equal(snapshot.tasks[1]?.compensationEligible, true)
  assert.deepEqual(
    snapshot.versions.map(version => version.versionId),
    ['version-a', 'version-b'],
  )
  assert.deepEqual(
    snapshot.grants.map(grant => [grant.scope, grant.policyVersion]),
    [
      ['project.write', 'v1'],
      ['online-code.author', '2'],
    ],
  )
  assert.deepEqual(
    snapshot.recoveries.map(recovery => recovery.recoveryId),
    ['save-1', 'durable-1', 'conflict-1'],
  )
  assert.deepEqual(snapshot.recoveries.find(recovery => recovery.kind === 'compensation-conflict')?.conflictPaths, [
    'a.path',
    'z.path',
  ])
  assert.deepEqual(snapshot.activeTargets, [
    { targetId: 'node-a', label: '标题', rect: { left: 10, top: 20, width: 120, height: 32 }, tone: 'active' },
    {
      targetId: 'node-b',
      label: '趋势图',
      rect: { left: 200, top: 40, width: 300, height: 160 },
      tone: 'active',
    },
  ])
  assert.equal(resolvedCalls.length, 1)
  assert.deepEqual(
    (resolvedCalls[0] as { activeCalls: readonly { callId: string }[] }).activeCalls.map(call => call.callId),
    ['call-1'],
  )
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.tasks[1]?.contextDigest?.includedTaskIds), true)

  const stableSnapshot = port.getSnapshot()
  await port.refresh()
  assert.strictEqual(port.getSnapshot(), stableSnapshot)
})

test('maps lineage-aware Runtime commands and lifecycle commands without exposing Host authority', async () => {
  const completed = runtimeTask({ checkpointId: 'checkpoint-1' })
  const runtime = new FakeRuntime(runtimeSnapshot({ activeTask: completed, tasks: [completed] }))
  const persistence = new FakePersistence(persistenceSnapshot(), {
    versions: [
      {
        versionId: 'version-1',
        name: '客户确认版',
        createdAt: 30,
        branchId: 'main',
        projectHash: 'sha256:version-1',
        sourceSessionId: 'session-1',
        sourceTaskId: 'task-1',
      },
    ],
    grants: [{ scope: 'project.write', status: 'granted', policyVersion: 'v1', grantedAt: 25 }],
    recoveries: [
      { kind: 'unsaved', recoveryId: 'save-1', message: '保存失败', occurredAt: 31 },
      {
        kind: 'applied-undurable',
        recoveryId: 'durable-1',
        taskId: 'task-1',
        callId: 'call-1',
        message: '持久化失败',
        occurredAt: 32,
      },
      {
        kind: 'compensation-conflict',
        recoveryId: 'conflict-1',
        taskId: 'task-1',
        message: '补偿冲突',
        occurredAt: 33,
        conflictPaths: ['props.value'],
      },
    ],
  })
  const port = createAgentWorkspaceCommandPortAdapter({ enabled: true, binding, runtime, persistence })
  await port.ready()

  await assert.rejects(port.submitIntent({ intent: '过期操作', mode: 'initial' }), /任务状态已更新/)
  await port.submitIntent({ intent: '  增加告警趋势  ', mode: 'follow-up' })

  const executing = runtimeTask({ taskId: 'task-2', phase: 'EXECUTE', supersedesTaskId: 'task-1' })
  runtime.emit(runtimeSnapshot({ revision: 2, activeTask: executing, tasks: [completed, executing] }))
  await port.submitIntent({ intent: '改成折线图', mode: 'refinement' })
  await port.pauseTask('task-2')
  await port.cancelTask('task-2')

  const paused = runtimeTask({ taskId: 'task-2', phase: 'PAUSED' })
  runtime.emit(runtimeSnapshot({ revision: 3, activeTask: paused, tasks: [completed, paused] }))
  await port.resumeTask('task-2')

  const waiting = runtimeTask({
    taskId: 'task-2',
    phase: 'WAITING_USER',
    question: { questionId: 'question-2', prompt: '确认布局？' },
  })
  runtime.emit(runtimeSnapshot({ revision: 4, activeTask: waiting, tasks: [completed, waiting] }))
  await assert.rejects(
    port.respondToQuestion({ taskId: 'task-2', questionId: 'old-question', response: '确认' }),
    /问题已更新/,
  )
  await port.respondToQuestion({ taskId: 'task-2', questionId: 'question-2', response: ' 确认 ' })
  await port.compensateTask('task-1')

  await port.createVersion(' 客户确认版 ')
  await port.restoreVersion({ sourceBranchId: 'main', versionId: 'version-1' })
  await port.requestGrant('online-code.author')
  await port.revokeGrant('project.write')
  await port.retrySave('save-1')
  await port.retryDurability('durable-1')
  await port.refreshCompensationConflict('conflict-1')

  assert.deepEqual(runtime.calls, [
    ['submit', { text: '增加告警趋势', metadata: { agentWorkspaceIntentMode: 'follow-up' } }],
    ['submit', { text: '改成折线图', metadata: { agentWorkspaceIntentMode: 'refinement' } }],
    ['pause', 'task-2'],
    ['cancel', 'task-2'],
    ['resume', 'task-2'],
    ['respond', 'task-2', { questionId: 'question-2', value: '确认' }],
    ['compensate', 'task-1'],
  ])
  assert.equal(persistence.grantChecks.length, 7)
  assert.ok(persistence.grantChecks.every(check => check.scope === 'project.write'))
  const mutationCalls = persistence.calls.filter(call => Array.isArray(call) && call[0] !== 'read')
  assert.deepEqual(mutationCalls, [
    [
      'create-version',
      {
        binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' },
        name: '客户确认版',
        sourceTaskId: 'task-2',
      },
    ],
    [
      'restore-version',
      {
        binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' },
        versionId: 'version-1',
        sourceBranchId: 'main',
        sourceSessionId: 'session-1',
        sourceTaskId: 'task-1',
      },
    ],
    [
      'request-grant',
      {
        binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' },
        scope: 'online-code.author',
      },
    ],
    [
      'revoke-grant',
      { binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' }, scope: 'project.write' },
    ],
    [
      'retry-recovery',
      {
        binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' },
        recoveryId: 'save-1',
        kind: 'unsaved',
        action: 'retry-save',
      },
    ],
    [
      'retry-recovery',
      {
        binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' },
        recoveryId: 'durable-1',
        kind: 'applied-undurable',
        action: 'retry-durability',
      },
    ],
    [
      'retry-recovery',
      {
        binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' },
        recoveryId: 'conflict-1',
        kind: 'compensation-conflict',
        action: 'refresh-conflict-report',
      },
    ],
  ])
})

test('silently authorizes a missing or changed local grant once and continues the original submit', async t => {
  for (const reason of [
    'missing',
    'provider-changed',
    'provider-fingerprint-changed',
    'policy-version-changed',
  ] as const) {
    await t.test(reason, async () => {
      const runtime = new FakeRuntime(runtimeSnapshot())
      const persistence = new FakePersistence(persistenceSnapshot(), emptyProjection())
      persistence.grantDecision = { granted: false, reason }
      persistence.grantOnRequest = true
      const port = createAgentWorkspaceCommandPortAdapter({ enabled: true, binding, runtime, persistence })
      await port.ready()

      await port.submitIntent({ intent: '直接搭建大屏', mode: 'initial' })

      assert.deepEqual(runtime.calls, [
        ['submit', { text: '直接搭建大屏', metadata: { agentWorkspaceIntentMode: 'initial' } }],
      ])
      const effectiveBinding = { ...binding, sessionId: 'session-1' }
      assert.deepEqual(persistence.grantChecks, [
        { binding: effectiveBinding, scope: 'project.write' },
        { binding: effectiveBinding, scope: 'project.write' },
      ])
      assert.deepEqual(
        persistence.calls.filter(call => Array.isArray(call) && call[0] === 'request-grant'),
        [['request-grant', { binding: effectiveBinding, scope: 'project.write' }]],
      )
    })
  }
})

test('keeps an explicit revoke authoritative before Runtime or lifecycle effects', async () => {
  const completed = runtimeTask()
  const runtime = new FakeRuntime(runtimeSnapshot({ activeTask: completed, tasks: [completed] }))
  const persistence = new FakePersistence(persistenceSnapshot(), {
    versions: [
      {
        versionId: 'version-1',
        name: '客户确认版',
        createdAt: 30,
        branchId: 'main',
        projectHash: 'sha256:version-1',
        sourceSessionId: 'session-1',
        sourceTaskId: 'task-1',
      },
    ],
    grants: [{ scope: 'project.write', status: 'revoked', policyVersion: 'v1' }],
    recoveries: [
      {
        kind: 'compensation-conflict',
        recoveryId: 'conflict-1',
        taskId: 'task-1',
        message: '补偿冲突',
        occurredAt: 33,
        conflictPaths: ['props.value'],
      },
    ],
  })
  persistence.grantDecision = { granted: false, reason: 'revoked' }
  const port = createAgentWorkspaceCommandPortAdapter({ enabled: true, binding, runtime, persistence })
  await port.ready()

  const rejectsForGrant = async (effect: Promise<void>) => {
    await assert.rejects(
      effect,
      error =>
        error instanceof AgentWorkspaceGrantConfirmationRequiredError &&
        error.code === 'agent-workspace-grant-confirmation-required' &&
        error.scope === 'project.write' &&
        error.reason === 'revoked',
    )
  }

  await rejectsForGrant(port.submitIntent({ intent: '继续搭建', mode: 'follow-up' }))
  await rejectsForGrant(port.compensateTask('task-1'))
  await rejectsForGrant(port.createVersion('客户确认版'))
  await rejectsForGrant(port.restoreVersion({ sourceBranchId: 'main', versionId: 'version-1' }))

  const paused = runtimeTask({ phase: 'PAUSED' })
  runtime.emit(runtimeSnapshot({ revision: 2, activeTask: paused, tasks: [paused] }))
  await rejectsForGrant(port.resumeTask('task-1'))

  const waiting = runtimeTask({ phase: 'WAITING_USER', question: { questionId: 'question-1', prompt: '继续？' } })
  runtime.emit(runtimeSnapshot({ revision: 3, activeTask: waiting, tasks: [waiting] }))
  await rejectsForGrant(port.respondToQuestion({ taskId: 'task-1', questionId: 'question-1', response: '继续' }))
  assert.deepEqual(runtime.calls, [])
  assert.deepEqual(
    persistence.calls.filter(call => Array.isArray(call) && call[0] !== 'read'),
    [],
  )
  assert.equal(persistence.grantChecks.length, 6)
})

test('recovery-locks APPLIED_UNDURABLE tasks before generic submit, resume or cancel effects', async () => {
  const recoveryLocked = runtimeTask({
    phase: 'PAUSED',
    failure: {
      code: 'APPLIED_UNDURABLE',
      message: '工具调用已应用，但精确回执尚未持久化。',
      retryable: false,
    },
  })
  const runtime = new FakeRuntime(runtimeSnapshot({ activeTask: recoveryLocked, tasks: [recoveryLocked] }))
  const persistence = new FakePersistence(persistenceSnapshot(), emptyProjection())
  const port = createAgentWorkspaceCommandPortAdapter({ enabled: true, binding, runtime, persistence })
  await port.ready()

  const rejectsForRecoveryLock = async (effect: Promise<void>) => {
    await assert.rejects(effect, /请先在恢复事项中完成精确回执核对/)
  }

  await rejectsForRecoveryLock(port.submitIntent({ intent: '继续搭建', mode: 'refinement' }))
  await rejectsForRecoveryLock(port.resumeTask(recoveryLocked.taskId))
  await rejectsForRecoveryLock(port.cancelTask(recoveryLocked.taskId))

  assert.deepEqual(runtime.calls, [])
  assert.deepEqual(persistence.grantChecks, [])
})

test('a non-active APPLIED_UNDURABLE task recovery-locks ordinary active-task and compensation commands', async () => {
  const recoveryLocked = runtimeTask({
    taskId: 'task-locked',
    phase: 'PAUSED',
    compensationEligible: false,
    failure: {
      code: 'APPLIED_UNDURABLE',
      message: '工具调用已应用，但精确回执尚未持久化。',
      retryable: false,
    },
  })
  const active = runtimeTask({ taskId: 'task-active', phase: 'PAUSED', compensationEligible: false })
  const terminal = runtimeTask({ taskId: 'task-terminal' })
  const runtime = new FakeRuntime(runtimeSnapshot({ activeTask: active, tasks: [recoveryLocked, active, terminal] }))
  const persistence = new FakePersistence(persistenceSnapshot(), emptyProjection())
  const port = createAgentWorkspaceCommandPortAdapter({ enabled: true, binding, runtime, persistence })
  await port.ready()

  const rejectsForRecoveryLock = async (effect: Promise<void>) => {
    await assert.rejects(effect, /请先在恢复事项中完成精确回执核对/)
  }

  await rejectsForRecoveryLock(port.submitIntent({ intent: '继续搭建', mode: 'refinement' }))
  await rejectsForRecoveryLock(port.resumeTask(active.taskId))
  await rejectsForRecoveryLock(port.cancelTask(active.taskId))
  await rejectsForRecoveryLock(port.compensateTask(terminal.taskId))

  assert.deepEqual(runtime.calls, [])
  assert.deepEqual(persistence.grantChecks, [])
})

test('rejects compensation when the Runtime projection marks a terminal task ineligible', async () => {
  const ineligible = runtimeTask({ compensationEligible: false, checkpointId: undefined })
  const runtime = new FakeRuntime(runtimeSnapshot({ activeTask: ineligible, tasks: [ineligible] }))
  const persistence = new FakePersistence(persistenceSnapshot(), emptyProjection())
  const port = createAgentWorkspaceCommandPortAdapter({ enabled: true, binding, runtime, persistence })
  await port.ready()

  await assert.rejects(port.compensateTask(ineligible.taskId), /不满足补偿条件/)
  assert.deepEqual(runtime.calls, [])
})

test('forwards null named-version provenance exactly without using the current Runtime lineage', async () => {
  const currentTask = runtimeTask({ taskId: 'task-current', sessionId: 'session-current' })
  const runtime = new FakeRuntime(
    runtimeSnapshot({
      binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-current' },
      activeTask: currentTask,
      tasks: [currentTask],
    }),
  )
  const persistence = new FakePersistence(persistenceSnapshot(), {
    versions: [
      {
        versionId: 'version-without-lineage',
        name: '无来源任务版本',
        createdAt: 40,
        branchId: 'main',
        projectHash: 'sha256:without-lineage',
        sourceSessionId: null,
        sourceTaskId: null,
      },
    ],
    grants: [],
    recoveries: [],
  })
  const port = createAgentWorkspaceCommandPortAdapter({ enabled: true, binding, runtime, persistence })
  await port.ready()

  await port.restoreVersion({ sourceBranchId: 'main', versionId: 'version-without-lineage' })

  assert.deepEqual(
    persistence.calls.filter(call => Array.isArray(call) && call[0] === 'restore-version'),
    [
      [
        'restore-version',
        {
          binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-current' },
          versionId: 'version-without-lineage',
          sourceBranchId: 'main',
          sourceSessionId: null,
          sourceTaskId: null,
        },
      ],
    ],
  )
})

test('restores the exact source branch when version ids repeat across branches', async () => {
  const currentTask = runtimeTask()
  const runtime = new FakeRuntime(runtimeSnapshot({ activeTask: currentTask, tasks: [currentTask] }))
  const persistence = new FakePersistence(persistenceSnapshot(), {
    versions: [
      {
        versionId: 'shared-version',
        name: '主分支版本',
        createdAt: 40,
        branchId: 'main',
        projectHash: 'sha256:main',
        sourceSessionId: 'session-main',
        sourceTaskId: 'task-main',
      },
      {
        versionId: 'shared-version',
        name: '方案分支版本',
        createdAt: 40,
        branchId: 'scenario',
        projectHash: 'sha256:scenario',
        sourceSessionId: 'session-scenario',
        sourceTaskId: 'task-scenario',
      },
    ],
    grants: [{ scope: 'project.write', status: 'granted', policyVersion: 'v1', grantedAt: 30 }],
    recoveries: [],
  })
  const port = createAgentWorkspaceCommandPortAdapter({ enabled: true, binding, runtime, persistence })
  await port.ready()

  assert.deepEqual(
    port.getSnapshot().versions.map(version => [version.sourceBranchId, version.versionId]),
    [
      ['main', 'shared-version'],
      ['scenario', 'shared-version'],
    ],
  )
  await port.restoreVersion({ sourceBranchId: 'scenario', versionId: 'shared-version' })
  await assert.rejects(
    port.restoreVersion({ sourceBranchId: 'missing', versionId: 'shared-version' }),
    /不存在或列表已过期/,
  )
  assert.deepEqual(
    persistence.calls.filter(call => Array.isArray(call) && call[0] === 'restore-version'),
    [
      [
        'restore-version',
        {
          binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' },
          versionId: 'shared-version',
          sourceBranchId: 'scenario',
          sourceSessionId: 'session-scenario',
          sourceTaskId: 'task-scenario',
        },
      ],
    ],
  )
})

test('drops stale lifecycle and target refresh results after a newer source revision', async () => {
  const activeTask = runtimeTask({ phase: 'EXECUTE' })
  const runtime = new FakeRuntime(runtimeSnapshot({ activeTask, tasks: [activeTask] }))
  const staleLifecycle = deferred<AgentWorkspacePersistenceProjection>()
  let lifecycleRead = 0
  const persistence = new FakePersistence(persistenceSnapshot(), emptyProjection())
  persistence.readWorkspaceProjectionImpl = async () => {
    lifecycleRead += 1
    if (lifecycleRead === 1) return staleLifecycle.promise
    return {
      versions: [
        {
          versionId: 'version-new',
          name: '新版本',
          createdAt: 20,
          branchId: 'main',
          projectHash: 'sha256:new',
          sourceSessionId: null,
          sourceTaskId: null,
        },
      ],
      grants: [],
      recoveries: [],
    }
  }
  const activity = new FakeActivity({
    revision: 1,
    activeCalls: [
      {
        callId: 'call-old',
        capability: 'screen.applyChangeSet',
        taskId: 'task-1',
        startedAt: 1,
        targetNodeIds: ['node-old'],
      },
    ],
  })
  const staleTarget =
    deferred<
      readonly { targetId: string; label: string; rect: { x: number; y: number; width: number; height: number } }[]
    >()
  const port = createAgentWorkspaceCommandPortAdapter({
    enabled: true,
    binding,
    runtime,
    persistence,
    invocationActivity: activity,
    targetRectResolver: { resolveTargets: async () => staleTarget.promise },
  })

  persistence.emit()
  activity.emit({ revision: 2, activeCalls: [] })
  await nextTask()
  assert.deepEqual(
    port.getSnapshot().versions.map(version => version.versionId),
    ['version-new'],
  )
  assert.deepEqual(port.getSnapshot().activeTargets, [])

  staleLifecycle.resolve({
    versions: [
      {
        versionId: 'version-stale',
        name: '旧版本',
        createdAt: 1,
        branchId: 'main',
        projectHash: 'sha256:stale',
        sourceSessionId: null,
        sourceTaskId: null,
      },
    ],
    grants: [],
    recoveries: [],
  })
  staleTarget.resolve([{ targetId: 'node-old', label: '旧目标', rect: { x: 1, y: 1, width: 10, height: 10 } }])
  await port.ready()
  await nextTask()

  assert.deepEqual(
    port.getSnapshot().versions.map(version => version.versionId),
    ['version-new'],
  )
  assert.deepEqual(port.getSnapshot().activeTargets, [])
})

test('models disabled, unavailable, binding mismatch, refresh failure and disposal as non-authoritative states', async () => {
  const disabledRuntime = new FakeRuntime(runtimeSnapshot())
  const disabledPersistence = new FakePersistence(persistenceSnapshot(), emptyProjection())
  const disabled = createAgentWorkspaceCommandPortAdapter({
    enabled: false,
    binding,
    runtime: disabledRuntime,
    persistence: disabledPersistence,
  })
  await disabled.ready()
  assert.deepEqual(disabled.getSnapshot().availability, {
    state: 'disabled',
    reason: 'Agent Runtime 功能未启用。',
  })
  assert.equal(disabledRuntime.listeners.size, 0)
  assert.equal(disabledPersistence.listeners.size, 0)
  await assert.rejects(disabled.submitIntent({ intent: '搭建大屏', mode: 'initial' }), /功能未启用/)

  const unavailable = createAgentWorkspaceCommandPortAdapter({
    enabled: true,
    binding,
    runtime: null,
    persistence: disabledPersistence,
    unavailable: { reason: '尚未配置模型网关。', detail: '缺少 Worker factory' },
  })
  await unavailable.ready()
  assert.deepEqual(unavailable.getSnapshot().availability, {
    state: 'unavailable',
    reason: '尚未配置模型网关。',
    detail: '缺少 Worker factory',
  })

  const mismatch = createAgentWorkspaceCommandPortAdapter({
    enabled: true,
    binding,
    runtime: new FakeRuntime(
      runtimeSnapshot({
        binding: { projectId: 'project-1', branchId: 'other', sessionId: 'session-other' },
        tasks: [runtimeTask()],
      }),
    ),
    persistence: new FakePersistence(persistenceSnapshot(), emptyProjection()),
  })
  await mismatch.ready()
  assert.equal(mismatch.getSnapshot().availability.state, 'unavailable')
  assert.deepEqual(mismatch.getSnapshot().tasks, [])

  const restoring = createAgentWorkspaceCommandPortAdapter({
    enabled: true,
    binding,
    runtime: new FakeRuntime(runtimeSnapshot()),
    persistence: new FakePersistence(
      persistenceSnapshot({
        state: 'restoring',
        lastFailure: { source: 'restore', message: '正在切换到命名版本' },
      }),
      emptyProjection(),
    ),
  })
  await restoring.ready()
  assert.deepEqual(restoring.getSnapshot().availability, {
    state: 'unavailable',
    reason: '正在恢复命名版本。',
    detail: '正在切换到命名版本',
  })

  const errors: string[] = []
  const failingPersistence = new FakePersistence(persistenceSnapshot(), emptyProjection())
  failingPersistence.readWorkspaceProjectionImpl = async () => {
    throw new Error('indexeddb unavailable')
  }
  const recovering = createAgentWorkspaceCommandPortAdapter({
    enabled: true,
    binding,
    runtime: new FakeRuntime(runtimeSnapshot()),
    persistence: failingPersistence,
    onError: (_error, source) => errors.push(source),
  })
  await recovering.ready()
  assert.deepEqual(recovering.getSnapshot().availability, {
    state: 'unavailable',
    reason: 'Agent Workspace 数据刷新失败。',
    detail: 'indexeddb unavailable',
  })
  assert.deepEqual(errors, ['lifecycle-refresh'])
  failingPersistence.readWorkspaceProjectionImpl = async () => emptyProjection()
  await recovering.refresh()
  assert.equal(recovering.getSnapshot().availability.state, 'ready')

  const runtime = new FakeRuntime(runtimeSnapshot())
  const persistence = new FakePersistence(persistenceSnapshot(), emptyProjection())
  const activity = new FakeActivity({ revision: 0, activeCalls: [] })
  const port = createAgentWorkspaceCommandPortAdapter({
    enabled: true,
    binding,
    runtime,
    persistence,
    invocationActivity: activity,
  })
  await port.ready()
  let notifications = 0
  port.subscribe(() => {
    notifications += 1
  })
  port.dispose()
  assert.equal(notifications, 1)
  assert.equal(port.getSnapshot().runtimeStatus, 'disposed')
  assert.equal(runtime.releaseCount, 1)
  assert.equal(persistence.releaseCount, 1)
  assert.equal(activity.releaseCount, 1)
  runtime.emit(runtimeSnapshot({ revision: 99, tasks: [runtimeTask()] }))
  assert.deepEqual(port.getSnapshot().tasks, [])
  await assert.rejects(port.compensateTask('task-1'), /已释放/)
})

test('keeps the composer available after a task-scoped model failure while lifecycle failures stay unavailable', async () => {
  const taskFailure = {
    code: 'worker-task-failed',
    message: 'The model gateway request exceeded its deadline',
    retryable: false,
  }
  const failedTask = runtimeTask({ phase: 'FAILED', compensationEligible: false, failure: taskFailure })
  const runtime = new FakeRuntime(
    runtimeSnapshot({
      status: 'failed',
      activeTask: failedTask,
      tasks: [failedTask],
      failure: taskFailure,
    }),
  )
  const workspace = createAgentWorkspaceCommandPortAdapter({
    enabled: true,
    binding,
    runtime,
    persistence: new FakePersistence(persistenceSnapshot(), emptyProjection()),
  })

  await workspace.ready()
  assert.deepEqual(workspace.getSnapshot().availability, { state: 'ready' })
  await workspace.submitIntent({ intent: '重新生成低空大屏', mode: 'follow-up' })
  assert.deepEqual(runtime.calls.at(-1), [
    'submit',
    {
      text: '重新生成低空大屏',
      metadata: { agentWorkspaceIntentMode: 'follow-up' },
    },
  ])

  const lifecycleFailure = {
    code: 'worker-initialization-failed',
    message: 'Worker transport is unavailable',
    retryable: true,
  }
  runtime.emit(
    runtimeSnapshot({
      status: 'failed',
      activeTask: failedTask,
      tasks: [failedTask],
      failure: lifecycleFailure,
    }),
  )
  assert.deepEqual(workspace.getSnapshot().availability, {
    state: 'unavailable',
    reason: 'Agent Runtime 启动失败。',
    detail: lifecycleFailure.message,
  })
})
