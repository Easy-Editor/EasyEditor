import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentWorkspaceController, deriveAgentWorkspaceIntentMode } from './controller.ts'
import type {
  AgentWorkspaceCommandPort,
  AgentWorkspaceGrantScope,
  AgentWorkspaceSnapshot,
  AgentWorkspaceTaskProjection,
} from './types.ts'
import { agentWorkspaceVersionIdentityKey } from './version-identity.ts'

const baseTask = (overrides: Partial<AgentWorkspaceTaskProjection> = {}): AgentWorkspaceTaskProjection => ({
  taskId: 'task-1',
  intent: '搭建运营大屏',
  phase: 'COMPLETED',
  compensationEligible: true,
  createdAt: 10,
  updatedAt: 20,
  checkpointId: 'checkpoint-1',
  ...overrides,
})

const baseSnapshot = (overrides: Partial<AgentWorkspaceSnapshot> = {}): AgentWorkspaceSnapshot => ({
  schemaVersion: 1,
  availability: { state: 'ready' },
  runtimeStatus: 'ready',
  projectId: 'project-1',
  branchId: 'main',
  sessionId: 'session-1',
  tasks: [],
  versions: [],
  grants: [],
  recoveries: [],
  activeTargets: [],
  ...overrides,
})

interface FakePort extends AgentWorkspaceCommandPort {
  readonly calls: string[]
  setSnapshot(snapshot: AgentWorkspaceSnapshot): void
  failNext(error: Error): void
}

const createFakePort = (initialSnapshot = baseSnapshot()): FakePort => {
  let snapshot = initialSnapshot
  let failure: Error | undefined
  const listeners = new Set<() => void>()
  const calls: string[] = []
  const run = async (call: string) => {
    calls.push(call)
    const currentFailure = failure
    failure = undefined
    if (currentFailure) throw currentFailure
  }
  return {
    calls,
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSnapshot(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    failNext(error) {
      failure = error
    },
    submitIntent: ({ intent, mode }) => run(`submit:${mode}:${intent}`),
    pauseTask: taskId => run(`pause:${taskId}`),
    resumeTask: taskId => run(`resume:${taskId}`),
    cancelTask: taskId => run(`cancel:${taskId}`),
    respondToQuestion: ({ taskId, questionId, response }) => run(`respond:${taskId}:${questionId}:${response}`),
    createVersion: name => run(`version:create:${name}`),
    restoreVersion: identity => run(`version:restore:${identity.sourceBranchId}:${identity.versionId}`),
    compensateTask: taskId => run(`compensate:${taskId}`),
    requestGrant: scope => run(`grant:request:${scope}`),
    revokeGrant: scope => run(`grant:revoke:${scope}`),
    retrySave: recoveryId => run(`recovery:save:${recoveryId}`),
    retryDurability: recoveryId => run(`recovery:durability:${recoveryId}`),
    refreshCompensationConflict: recoveryId => run(`recovery:refresh-conflict-report:${recoveryId}`),
  }
}

test('intent mode distinguishes initial, completed follow-up, and active refinement', () => {
  assert.equal(deriveAgentWorkspaceIntentMode(baseSnapshot()), 'initial')
  assert.equal(deriveAgentWorkspaceIntentMode(baseSnapshot({ tasks: [baseTask()] })), 'follow-up')
  assert.equal(
    deriveAgentWorkspaceIntentMode(baseSnapshot({ activeTaskId: 'task-1', tasks: [baseTask({ phase: 'EXECUTE' })] })),
    'refinement',
  )
})

test('submit trims the intent, uses the derived lineage mode, and clears the draft only on success', async () => {
  const port = createFakePort(baseSnapshot({ tasks: [baseTask()] }))
  const controller = new AgentWorkspaceController(port)
  controller.setIntentDraft('  增加今日告警趋势  ')

  assert.equal(await controller.submitIntent(), true)
  assert.deepEqual(port.calls, ['submit:follow-up:增加今日告警趋势'])
  assert.equal(controller.getSnapshot().intentDraft, '')

  controller.setIntentDraft('保留失败输入')
  port.failNext(new Error('gateway unavailable'))
  assert.equal(await controller.submitIntent(), false)
  assert.equal(controller.getSnapshot().intentDraft, '保留失败输入')
  assert.equal(controller.getSnapshot().actionError, 'gateway unavailable')
})

test('active refinement is submitted as a superseding intent without invoking compensation', async () => {
  const port = createFakePort(baseSnapshot({ activeTaskId: 'task-1', tasks: [baseTask({ phase: 'VERIFY' })] }))
  const controller = new AgentWorkspaceController(port)
  controller.setIntentDraft('把柱状图改成折线图')

  assert.equal(await controller.submitIntent(), true)
  assert.deepEqual(port.calls, ['submit:refinement:把柱状图改成折线图'])
})

test('question response is accepted only for the current WAITING_USER question', async () => {
  const port = createFakePort(baseSnapshot({ activeTaskId: 'task-1', tasks: [baseTask({ phase: 'EXECUTE' })] }))
  const controller = new AgentWorkspaceController(port)
  controller.setResponseDraft('确认')

  assert.equal(await controller.respondToQuestion(), false)
  assert.match(controller.getSnapshot().actionError ?? '', /等待确认/)

  port.setSnapshot(
    baseSnapshot({
      activeTaskId: 'task-1',
      tasks: [
        baseTask({
          phase: 'WAITING_USER',
          question: { questionId: 'question-1', prompt: '是否保留当前配色？' },
        }),
      ],
    }),
  )
  controller.setResponseDraft(' 保留配色 ')
  assert.equal(await controller.respondToQuestion(), true)
  assert.deepEqual(port.calls, ['respond:task-1:question-1:保留配色'])
  assert.equal(controller.getSnapshot().responseDraft, '')
})

test('task compensation and named-version restore are separate explicit commands', async () => {
  const port = createFakePort(
    baseSnapshot({
      tasks: [baseTask()],
      versions: [
        {
          versionId: 'version-1',
          name: '客户确认版',
          createdAt: 30,
          sourceBranchId: 'main',
          sourceTaskId: 'task-1',
          schemaHash: 'sha256:version-1',
        },
      ],
    }),
  )
  const controller = new AgentWorkspaceController(port)

  assert.equal(await controller.compensateTask('task-1'), true)
  assert.equal(await controller.restoreVersion({ sourceBranchId: 'main', versionId: 'version-1' }), true)
  assert.deepEqual(port.calls, ['compensate:task-1', 'version:restore:main:version-1'])
})

test('named versions use composite branch and version identity end to end', async () => {
  const versions = [
    {
      versionId: 'shared-version',
      name: '主分支版本',
      createdAt: 30,
      sourceBranchId: 'main',
      schemaHash: 'sha256:main',
    },
    {
      versionId: 'shared-version',
      name: '方案分支版本',
      createdAt: 30,
      sourceBranchId: 'scenario',
      schemaHash: 'sha256:scenario',
    },
  ] as const
  const port = createFakePort(baseSnapshot({ versions }))
  const controller = new AgentWorkspaceController(port)

  assert.notEqual(agentWorkspaceVersionIdentityKey(versions[0]), agentWorkspaceVersionIdentityKey(versions[1]))
  assert.equal(await controller.restoreVersion({ sourceBranchId: 'scenario', versionId: 'shared-version' }), true)
  assert.deepEqual(port.calls, ['version:restore:scenario:shared-version'])
  assert.equal(await controller.restoreVersion({ sourceBranchId: 'missing', versionId: 'shared-version' }), false)
  assert.match(controller.getSnapshot().actionError ?? '', /不存在/)
})

test('grant and recovery actions preserve the typed command boundary', async () => {
  const port = createFakePort()
  const controller = new AgentWorkspaceController(port)
  const scope: AgentWorkspaceGrantScope = 'online-code.author'

  assert.equal(await controller.requestGrant(scope), true)
  assert.equal(await controller.revokeGrant(scope), true)
  assert.equal(await controller.retrySave('save-1'), true)
  assert.equal(await controller.retryDurability('durable-1'), true)
  assert.equal(await controller.refreshCompensationConflict('conflict-1'), true)
  assert.deepEqual(port.calls, [
    'grant:request:online-code.author',
    'grant:revoke:online-code.author',
    'recovery:save:save-1',
    'recovery:durability:durable-1',
    'recovery:refresh-conflict-report:conflict-1',
  ])
})

test('a changed question clears stale response text while same-question refresh preserves it', () => {
  const waitingSnapshot = (questionId: string) =>
    baseSnapshot({
      activeTaskId: 'task-1',
      tasks: [
        baseTask({
          phase: 'WAITING_USER',
          question: { questionId, prompt: '请选择布局' },
        }),
      ],
    })
  const port = createFakePort(waitingSnapshot('question-1'))
  const controller = new AgentWorkspaceController(port)
  controller.setResponseDraft('双栏')

  port.setSnapshot(waitingSnapshot('question-1'))
  assert.equal(controller.getSnapshot().responseDraft, '双栏')
  port.setSnapshot(waitingSnapshot('question-2'))
  assert.equal(controller.getSnapshot().responseDraft, '')
})
