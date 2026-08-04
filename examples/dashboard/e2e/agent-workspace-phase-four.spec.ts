import { type Locator, type Page, expect, test } from '@playwright/test'

const SCRIPT_STORAGE_KEY = 'easy-editor:agent-runtime:e2e-steps:v1'
const RECOVERY_STORAGE_KEY = 'easy-editor:agent-runtime:e2e-recoveries:v1'
const WORKSPACE_TEST_ID = 'agent-workspace'

type WorkspaceProbe = NonNullable<ReturnType<NonNullable<Window['__EASY_EDITOR_E2E__']>['getAgentWorkspaceState']>>
type WorkspaceTask = WorkspaceProbe['snapshot']['remote']['tasks'][number]

const blueprint = (summary: string) => ({
  schemaVersion: 1 as const,
  kind: 'blueprint' as const,
  summary,
  unresolvedConstraints: [],
})

const complete = (summary: string) => ({
  schemaVersion: 1 as const,
  kind: 'complete' as const,
  summary,
})

const completedTaskSteps = (name: string) => [
  {
    expectedPhase: 'BLUEPRINT' as const,
    events: [blueprint(`${name} blueprint`)],
  },
  {
    expectedPhase: 'PLAN_STEP' as const,
    events: [complete(`${name} completed`)],
  },
]

const installScript = async (page: Page, steps: readonly unknown[]): Promise<void> => {
  await page.addInitScript(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: SCRIPT_STORAGE_KEY,
    value: JSON.stringify(steps),
  })
}

const readProbe = (page: Page): Promise<WorkspaceProbe | null> =>
  page.evaluate(() => window.__EASY_EDITOR_E2E__?.getAgentWorkspaceState() ?? null)

const waitForWorkspaceRuntime = async (page: Page): Promise<WorkspaceProbe> => {
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__EASY_EDITOR_E2E__?.getEngineState())).toBe('ready')
  await expect
    .poll(async () => {
      const probe = await readProbe(page)
      return probe?.snapshot.remote.runtimeStatus === 'ready' && probe.snapshot.remote.availability.state === 'ready'
    })
    .toBe(true)
  const probe = await readProbe(page)
  if (!probe) throw new Error('Agent Workspace E2E probe is unavailable')
  return probe
}

const openWorkspace = async (page: Page) => {
  const workspace = page.getByTestId(WORKSPACE_TEST_ID)
  if (!(await workspace.isVisible().catch(() => false))) {
    await page.getByTestId('agent-workspace-toggle').click()
  }
  await expect(workspace).toBeVisible()
  return workspace
}

const authorizeProjectWrite = async (page: Page, workspace?: Locator) => {
  const target = workspace ?? (await openWorkspace(page))
  await target.getByRole('tab', { name: '授权' }).click()
  const row = target.getByRole('listitem').filter({ hasText: '修改当前项目' })
  const authorize = row.getByRole('button', { name: '授权' })
  if (await authorize.isVisible().catch(() => false)) await authorize.click()
  await expect
    .poll(
      async () =>
        (await readProbe(page))?.snapshot.remote.grants.find(grant => grant.scope === 'project.write')?.status ?? null,
    )
    .toBe('granted')
  await target.getByRole('tab', { name: '任务' }).click()
  return target
}

const submitIntent = async (page: Page, intent: string, buttonName: string): Promise<void> => {
  await page.locator('#agent-workspace-intent').fill(intent)
  await page.getByRole('button', { name: buttonName, exact: true }).click()
}

const waitForTask = async (
  page: Page,
  predicate: (tasks: readonly WorkspaceTask[]) => WorkspaceTask | undefined,
): Promise<WorkspaceTask> => {
  await expect
    .poll(async () => {
      const probe = await readProbe(page)
      return probe ? (predicate(probe.snapshot.remote.tasks)?.taskId ?? null) : null
    })
    .not.toBeNull()
  const probe = await readProbe(page)
  const task = probe && predicate(probe.snapshot.remote.tasks)
  if (!task) throw new Error('Expected Agent Workspace task did not materialize')
  return task
}

test('Workspace persists blueprints and follow-up lineage, then restores a named version into a new branch/session', async ({
  page,
}) => {
  await installScript(page, [...completedTaskSteps('initial'), ...completedTaskSteps('follow-up')])
  await page.goto('/')
  const initialBinding = (await waitForWorkspaceRuntime(page)).binding
  const workspace = await openWorkspace(page)
  await authorizeProjectWrite(page, workspace)

  await submitIntent(page, '搭建销售运营总览大屏', '开始搭建')
  const initialTask = await waitForTask(page, tasks => tasks.find(task => task.phase === 'COMPLETED'))
  expect(initialTask).toMatchObject({
    intent: '搭建销售运营总览大屏',
    phase: 'COMPLETED',
    blueprint: { summary: 'initial blueprint' },
    completionSummary: 'initial completed',
  })
  await expect(workspace.getByText('搭建蓝图')).toBeVisible()
  await expect(workspace.getByText('initial blueprint')).toBeVisible()

  await workspace.getByRole('tab', { name: '版本' }).click()
  await page.locator('#agent-workspace-version-name').fill('客户确认版')
  await workspace.getByRole('button', { name: '保存版本' }).click()
  await expect.poll(async () => (await readProbe(page))?.snapshot.remote.versions.length ?? 0).toBe(1)
  const version = (await readProbe(page))?.snapshot.remote.versions[0]
  expect(version).toMatchObject({
    name: '客户确认版',
    sourceBranchId: initialBinding.branchId,
    sourceSessionId: initialBinding.sessionId,
    sourceTaskId: initialTask.taskId,
  })

  await workspace.getByRole('tab', { name: '任务' }).click()
  await submitIntent(page, '补充渠道转化和区域排名', '继续搭建')
  const followUp = await waitForTask(page, tasks =>
    tasks.find(task => task.taskId !== initialTask.taskId && task.phase === 'COMPLETED'),
  )
  expect(followUp).toMatchObject({
    intent: '补充渠道转化和区域排名',
    parentTaskId: initialTask.taskId,
    blueprint: { summary: 'follow-up blueprint' },
    completionSummary: 'follow-up completed',
  })

  const durableJournal = await page.evaluate(async binding => {
    const runtime = await import('/src/editor/runtime.ts')
    return runtime.dashboardPersistence.readAgentPersistence({
      schemaVersion: 1,
      ...binding,
      expectedPersistenceGeneration: 0,
    })
  }, initialBinding)
  expect(durableJournal.records).toHaveLength(2)
  expect(durableJournal.records.map(record => record.recordId).sort()).toEqual(
    [`task:${initialTask.taskId}`, `task:${followUp.taskId}`].sort(),
  )
  for (const record of durableJournal.records) {
    expect(record.kind).toBe('agent-runtime-task')
    expect(record.value).toMatchObject({ sessionId: initialBinding.sessionId })
  }

  await page.reload()
  const recovered = await waitForWorkspaceRuntime(page)
  expect(recovered.binding).toEqual(initialBinding)
  expect(recovered.snapshot.remote.tasks.map(task => task.taskId)).toEqual([initialTask.taskId, followUp.taskId])

  const recoveredWorkspace = await openWorkspace(page)
  await recoveredWorkspace.getByRole('tab', { name: '版本' }).click()
  await recoveredWorkspace.getByRole('button', { name: '恢复到新分支' }).click()
  await expect
    .poll(async () => {
      const probe = await readProbe(page)
      return probe ? `${probe.binding.branchId}\u0000${probe.binding.sessionId ?? ''}` : null
    })
    .not.toBe(`${initialBinding.branchId}\u0000${initialBinding.sessionId ?? ''}`)

  const fork = await waitForWorkspaceRuntime(page)
  expect(fork.binding.projectId).toBe(initialBinding.projectId)
  expect(fork.binding.branchId).not.toBe(initialBinding.branchId)
  expect(fork.binding.sessionId).not.toBe(initialBinding.sessionId)
  expect(fork.snapshot.remote.branchId).toBe(fork.binding.branchId)
  expect(fork.snapshot.remote.sessionId).toBe(fork.binding.sessionId)
  expect(fork.snapshot.remote.tasks).toEqual([])
  expect(fork.snapshot.remote.versions[0]).toMatchObject({
    versionId: version?.versionId,
    sourceBranchId: initialBinding.branchId,
    sourceSessionId: initialBinding.sessionId,
    sourceTaskId: initialTask.taskId,
  })

  const persistenceBinding = await page.evaluate(() => window.__EASY_EDITOR_E2E__?.getPersistenceState())
  expect(persistenceBinding).toMatchObject({
    projectId: fork.binding.projectId,
    branchId: fork.binding.branchId,
    state: 'ready',
  })
})

test('an active task is safely superseded by a refinement intent', async ({ page }) => {
  await installScript(page, [
    {
      expectedPhase: 'BLUEPRINT',
      events: [blueprint('slow initial blueprint')],
    },
    {
      expectedPhase: 'PLAN_STEP',
      delayMs: 30_000,
      events: [complete('the superseded task must not complete')],
    },
    ...completedTaskSteps('refinement'),
  ])
  await page.goto('/')
  await waitForWorkspaceRuntime(page)
  const workspace = await openWorkspace(page)
  await authorizeProjectWrite(page, workspace)

  await submitIntent(page, '先生成基础驾驶舱', '开始搭建')
  const initialTask = await waitForTask(page, tasks => tasks.find(task => task.phase === 'PLAN_STEP'))
  await expect(workspace.getByText('slow initial blueprint')).toBeVisible()

  await submitIntent(page, '调整为客户全景经营视图', '调整当前任务')
  const refinedTask = await waitForTask(page, tasks =>
    tasks.find(task => task.taskId !== initialTask.taskId && task.phase === 'COMPLETED'),
  )
  const probe = await readProbe(page)
  const superseded = probe?.snapshot.remote.tasks.find(task => task.taskId === initialTask.taskId)
  expect(superseded?.phase).toBe('CANCELLED')
  expect(refinedTask).toMatchObject({
    intent: '调整为客户全景经营视图',
    phase: 'COMPLETED',
    parentTaskId: initialTask.taskId,
    supersedesTaskId: initialTask.taskId,
    blueprint: { summary: 'refinement blueprint' },
  })
  await expect(workspace.getByText(/已安全替代/)).toBeVisible()
})

test('project writes silently authorize once, reuse the exact grant after reload, and fail immediately after revoke', async ({
  page,
}) => {
  await installScript(page, completedTaskSteps('authorized'))
  await page.goto('/')
  const initial = await waitForWorkspaceRuntime(page)
  const workspace = await openWorkspace(page)

  await submitIntent(page, '首次提交自动授权并完成写入', '开始搭建')
  const firstTask = await waitForTask(page, tasks => tasks.find(task => task.phase === 'COMPLETED'))
  await expect
    .poll(
      async () =>
        (await readProbe(page))?.snapshot.remote.grants.find(grant => grant.scope === 'project.write')?.status ?? null,
    )
    .toBe('granted')
  await expect(workspace.getByRole('alert')).toHaveCount(0)

  await page.reload()
  const recovered = await waitForWorkspaceRuntime(page)
  expect(recovered.binding).toEqual(initial.binding)
  expect(recovered.snapshot.remote.grants.find(grant => grant.scope === 'project.write')).toMatchObject({
    status: 'granted',
    policyVersion: 'dashboard-e2e-policy-v1',
  })

  const recoveredWorkspace = await openWorkspace(page)
  await submitIntent(page, '刷新后复用同一授权', '继续搭建')
  const reusedTask = await waitForTask(page, tasks =>
    tasks.find(task => task.taskId !== firstTask.taskId && task.phase === 'COMPLETED'),
  )
  await recoveredWorkspace.getByRole('tab', { name: '授权' }).click()
  const recoveredRow = recoveredWorkspace.getByRole('listitem').filter({ hasText: '修改当前项目' })
  await recoveredRow.getByRole('button', { name: '撤销' }).click()
  await expect
    .poll(
      async () =>
        (await readProbe(page))?.snapshot.remote.grants.find(grant => grant.scope === 'project.write')?.status ?? null,
    )
    .toBe('revoked')
  await expect(recoveredRow.getByRole('button', { name: '授权' })).toBeVisible()
  await recoveredWorkspace.getByRole('tab', { name: '任务' }).click()
  await submitIntent(page, '撤销后不可继续写入', '继续搭建')
  await expect(recoveredWorkspace.getByRole('alert')).toContainText(/Agent 对当前项目的访问已关闭.*更多设置/)
  expect((await readProbe(page))?.snapshot.remote.tasks.map(task => task.taskId)).toEqual([
    firstTask.taskId,
    reusedTask.taskId,
  ])
})

test('a fixture compensation conflict exposes only a non-destructive durable report refresh', async ({ page }) => {
  await page.addInitScript(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: RECOVERY_STORAGE_KEY,
    value: JSON.stringify([
      {
        kind: 'compensation-conflict',
        recoveryId: 'recovery-compensation-1',
        taskId: 'task-with-human-conflict',
        message: '客户已人工调整标题，补偿不能覆盖该值。',
        occurredAt: 1_000,
        conflictPaths: ['root.props.title', 'root.props.subtitle'],
      },
    ]),
  })
  await page.goto('/')
  const initial = await waitForWorkspaceRuntime(page)
  expect(initial.snapshot.remote.recoveries).toEqual([
    expect.objectContaining({
      kind: 'compensation-conflict',
      recoveryId: 'recovery-compensation-1',
      taskId: 'task-with-human-conflict',
      conflictPaths: ['root.props.subtitle', 'root.props.title'],
    }),
  ])

  const workspace = await openWorkspace(page)
  const recoveryBanner = workspace.locator('section').filter({ hasText: '任务补偿遇到人工修改' })
  await expect(recoveryBanner).toContainText('客户已人工调整标题，补偿不能覆盖该值。')
  await expect(recoveryBanner.getByRole('list', { name: '冲突字段' })).toContainText('root.props.title')
  await expect(recoveryBanner.getByRole('button', { name: '刷新耐久冲突报告' })).toBeVisible()
  await expect(recoveryBanner.getByRole('button', { name: '重试任务补偿' })).toHaveCount(0)

  await recoveryBanner.getByRole('button', { name: '刷新耐久冲突报告' }).click()
  await expect.poll(async () => (await readProbe(page))?.snapshot.pendingAction ?? null).toBeNull()
  await expect.poll(async () => (await readProbe(page))?.snapshot.remote.recoveries.length ?? -1).toBe(1)
  await expect(workspace.getByText('任务补偿遇到人工修改')).toBeVisible()
})

test('a real Workspace Screen task preserves journal, revision, call, receipt, branch, and session identity', async ({
  page,
}) => {
  await page.goto('/')
  await waitForWorkspaceRuntime(page)

  await page.evaluate(async () => {
    const runtime = await import('/src/editor/runtime.ts')
    const document = runtime.engine.project.currentDocument
    if (!document) throw new Error('Dashboard document is unavailable')
    const input = runtime.captureDashboardPersistenceInput()
    const projectSchema = structuredClone(input.projectSchema) as {
      componentsTree: Array<Record<string, unknown>>
    }
    const root = projectSchema.componentsTree[0]
    if (!root) throw new Error('Dashboard root schema is unavailable')

    // Core document ids are realm-generated unless the canonical root carries
    // docId. Persist it once so the scripted Worker can safely cross a reload
    // with a real, pre-observed revision rather than a guessed authority token.
    root.docId = document.id
    await runtime.dashboardPersistence.save({
      activeDocument: input.activeDocument,
      projectSchema,
      commitKind: 'manual-save',
    })
    await runtime.dashboardPersistence.flush()
  })

  await page.reload()
  await waitForWorkspaceRuntime(page)
  const prepared = await page.evaluate(async storageKey => {
    const runtime = await import('/src/editor/runtime.ts')
    const probe = window.__EASY_EDITOR_E2E__?.getAgentWorkspaceState()
    const document = runtime.engine.project.currentDocument
    if (!probe?.binding.sessionId || !document) throw new Error('Workspace Screen authority is unavailable')
    const binding = probe.binding as Required<typeof probe.binding>
    const taskId = 'e2e-revision-observer'
    const host = runtime.composeDashboardAgentHost({ ...binding, taskId })
    if (!host) throw new Error('Dashboard Agent Host is unavailable')
    const observed = await host.observe({ schemaVersion: 1, ...binding, taskId, mode: 'full' })
    host.dispose()

    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          expectedPhase: 'BLUEPRINT',
          events: [
            {
              schemaVersion: 1,
              kind: 'blueprint',
              summary: 'Apply a durable Workspace Screen change',
              unresolvedConstraints: [],
            },
          ],
        },
        {
          expectedPhase: 'PLAN_STEP',
          events: [
            {
              schemaVersion: 1,
              kind: 'tool-call',
              call: {
                schemaVersion: 1,
                capability: 'screen.applyChangeSet',
                expectedRevision: observed.revision,
                arguments: {
                  schemaVersion: 1,
                  documentId: document.id,
                  operations: [
                    {
                      opId: 'workspace-phase-four-background',
                      type: 'set',
                      nodeId: document.root.id,
                      fieldId: 'props.backgroundColor',
                      value: '#123abc',
                    },
                  ],
                },
              },
            },
            { schemaVersion: 1, kind: 'complete', summary: 'Workspace Screen change is durable' },
          ],
        },
      ]),
    )
    return {
      binding,
      documentId: document.id,
      rootId: document.root.id,
      baseRevision: observed.revision,
    }
  }, SCRIPT_STORAGE_KEY)

  await page.reload()
  const recovered = await waitForWorkspaceRuntime(page)
  expect(recovered.binding).toEqual(prepared.binding)
  const workspace = await openWorkspace(page)
  await authorizeProjectWrite(page, workspace)
  await submitIntent(page, '通过 Agent 修改大屏背景色', '开始搭建')
  const task = await waitForTask(page, tasks => tasks.find(candidate => candidate.phase === 'COMPLETED'))
  expect(task).toMatchObject({
    intent: '通过 Agent 修改大屏背景色',
    blueprint: { summary: 'Apply a durable Workspace Screen change' },
    completionSummary: 'Workspace Screen change is durable',
    compensationEligible: true,
  })
  await expect(workspace.getByText('Workspace Screen change is durable')).toBeVisible()
  const compensateButton = workspace.getByRole('button', { name: '补偿此任务' })
  await expect(compensateButton).toBeVisible()

  const identity = await page.evaluate(
    async ({ binding, taskId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const document = runtime.engine.project.currentDocument
      if (!document) throw new Error('Dashboard document is unavailable after the Screen call')
      const journal = await runtime.dashboardPersistence.readAgentPersistence({
        schemaVersion: 1,
        ...binding,
        expectedPersistenceGeneration: 0,
      })
      const record = journal.records.find(candidate => candidate.recordId === `task:${taskId}`)
      if (!record || record.kind !== 'agent-runtime-task') throw new Error('Durable task journal is unavailable')
      const value = record.value as {
        sessionId?: string
        callIds?: string[]
        callIndex?: Array<{ callId: string; capability: string }>
        callIndexComplete?: boolean
      }
      const callId = value.callIds?.[0]
      if (!callId) throw new Error('Durable task call identity is unavailable')
      const lineage = await runtime.dashboardPersistence.readDurableAgentReceiptLineage({
        projectId: binding.projectId,
        branchId: binding.branchId,
        callId,
      })
      const observerTaskId = 'e2e-post-call-observer'
      const host = runtime.composeDashboardAgentHost({ ...binding, taskId: observerTaskId })
      if (!host) throw new Error('Dashboard Agent Host is unavailable after the Screen call')
      const observed = await host.observe({ schemaVersion: 1, ...binding, taskId: observerTaskId, mode: 'full' })
      host.dispose()
      return {
        binding,
        documentId: document.id,
        rootId: document.root.id,
        backgroundColor: document.root.getPropValue('backgroundColor'),
        persistence: runtime.dashboardPersistence.getSnapshot(),
        journal: {
          sessionId: value.sessionId,
          callIds: value.callIds,
          callIndex: value.callIndex,
          callIndexComplete: value.callIndexComplete,
        },
        callId,
        lineage,
        observedRevision: observed.revision,
      }
    },
    { binding: prepared.binding, taskId: task.taskId },
  )

  expect(identity.documentId).toBe(prepared.documentId)
  expect(identity.rootId).toBe(prepared.rootId)
  expect(identity.backgroundColor).toBe('#123abc')
  expect(identity.persistence).toMatchObject({
    state: 'ready',
    projectId: prepared.binding.projectId,
    branchId: prepared.binding.branchId,
  })
  expect(identity.journal).toEqual({
    sessionId: prepared.binding.sessionId,
    callIds: [identity.callId],
    callIndex: [{ callId: identity.callId, capability: 'screen.applyChangeSet' }],
    callIndexComplete: true,
  })
  expect(identity.callId).toContain(`:${prepared.binding.sessionId}:`)
  expect(identity.lineage).toMatchObject({
    projectId: prepared.binding.projectId,
    branchId: prepared.binding.branchId,
    callId: identity.callId,
    receiptIntent: { baseRevision: prepared.baseRevision, status: 'pending' },
    receipt: { status: 'applied', revision: identity.observedRevision },
  })
  expect(identity.observedRevision).not.toBe(prepared.baseRevision)

  await page.keyboard.down('Shift')
  try {
    await page.evaluate(async ({ documentId, rootId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const document = runtime.engine.project.currentDocument
      if (!document || document.id !== documentId || document.root.id !== rootId) {
        throw new Error('Dashboard document authority changed before the human edit')
      }
      runtime.engine.transactions.runOnDocument(
        document,
        [
          {
            type: 'updateProps',
            documentId,
            nodeId: rootId,
            props: { backgroundColor: '#fedcba' },
          },
        ],
        { expectedMutationVersion: document.mutationVersion },
      )
      await runtime.persistDashboardProject('manual-save')
      await runtime.dashboardPersistence.flush()
    }, prepared)
  } finally {
    await page.keyboard.up('Shift')
  }
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const runtime = await import('/src/editor/runtime.ts')
        return runtime.engine.project.currentDocument?.root.getPropValue('backgroundColor')
      }),
    )
    .toBe('#fedcba')

  await compensateButton.click()
  const compensationTask = await waitForTask(page, tasks =>
    tasks.find(
      candidate =>
        candidate.taskId !== task.taskId &&
        candidate.parentTaskId === task.taskId &&
        candidate.intent === `Compensate task ${task.taskId}` &&
        candidate.phase === 'COMPLETED',
    ),
  )

  const compensation = await page.evaluate(
    async ({ binding, compensationTaskId, forwardCallId, targetTaskId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const document = runtime.engine.project.currentDocument
      if (!document) throw new Error('Dashboard document is unavailable after task compensation')
      const journal = await runtime.dashboardPersistence.readAgentPersistence({
        schemaVersion: 1,
        ...binding,
        expectedPersistenceGeneration: 0,
      })
      const record = journal.records.find(candidate => candidate.recordId === `task:${compensationTaskId}`)
      if (!record || record.kind !== 'agent-runtime-task') {
        throw new Error('Durable compensation task journal is unavailable')
      }
      const value = record.value as {
        sessionId?: string
        compensatesTaskId?: string
        callIds?: string[]
        callIndex?: Array<{ callId: string; capability: string }>
        callIndexComplete?: boolean
      }
      const outerCallId = value.callIds?.[0]
      if (!outerCallId) throw new Error('Durable compensation call identity is unavailable')
      const run = await runtime.dashboardPersistence.readCompensationRun({
        schemaVersion: 1,
        ...binding,
        outerCallId,
      })
      const host = runtime.composeDashboardAgentHost({ ...binding, taskId: compensationTaskId })
      if (!host) throw new Error('Dashboard compensation Host is unavailable after task compensation')
      const receipt = await host.queryReceipt({
        schemaVersion: 1,
        ...binding,
        taskId: compensationTaskId,
        callId: outerCallId,
      })
      host.dispose()
      return {
        backgroundColor: document.root.getPropValue('backgroundColor'),
        journal: {
          sessionId: value.sessionId,
          compensatesTaskId: value.compensatesTaskId,
          callIds: value.callIds,
          callIndex: value.callIndex,
          callIndexComplete: value.callIndexComplete,
        },
        outerCallId,
        run,
        compensationRunId: run && typeof run.compensationRunId === 'string' ? run.compensationRunId : null,
        conflictPaths:
          run && Array.isArray(run.conflicts)
            ? [
                ...new Set(
                  run.conflicts.flatMap(conflict =>
                    conflict && Array.isArray(conflict.slotKeys)
                      ? conflict.slotKeys.filter((slotKey): slotKey is string => typeof slotKey === 'string')
                      : [],
                  ),
                ),
              ].sort()
            : [],
        receipt,
        expectedConflict: { originalCallId: forwardCallId, code: 'POST_IMAGE_CHANGED' },
        targetTaskId,
      }
    },
    {
      binding: prepared.binding,
      compensationTaskId: compensationTask.taskId,
      forwardCallId: identity.callId,
      targetTaskId: task.taskId,
    },
  )

  expect(compensation.backgroundColor).toBe('#fedcba')
  expect(compensation.journal).toEqual({
    sessionId: prepared.binding.sessionId,
    compensatesTaskId: task.taskId,
    callIds: [compensation.outerCallId],
    callIndex: [{ callId: compensation.outerCallId, capability: 'task.compensate' }],
    callIndexComplete: true,
  })
  expect(compensation.outerCallId).toContain(`:${prepared.binding.sessionId}:`)
  expect(compensation.run).toMatchObject({
    schemaVersion: 1,
    outerCallId: compensation.outerCallId,
    sessionId: prepared.binding.sessionId,
    taskId: task.taskId,
    cursor: 1,
    originalCallIds: [identity.callId],
    status: 'completed-with-conflicts',
    conflicts: [compensation.expectedConflict],
  })
  expect(compensation.receipt).toMatchObject({
    projectId: prepared.binding.projectId,
    branchId: prepared.binding.branchId,
    callId: compensation.outerCallId,
    status: 'applied',
    witness: {
      kind: 'compensation-run',
      taskId: task.taskId,
      status: 'completed-with-conflicts',
    },
  })
  expect(compensation.targetTaskId).toBe(task.taskId)

  if (!compensation.compensationRunId || compensation.conflictPaths.length === 0) {
    throw new Error('Terminal compensation conflict did not expose stable durable recovery identity')
  }
  const expectedRecoveryId = `compensation-conflict-v1:${encodeURIComponent(compensation.compensationRunId)}`
  await expect
    .poll(async () => {
      const probe = await readProbe(page)
      return probe?.snapshot.remote.recoveries.find(recovery => recovery.recoveryId === expectedRecoveryId) ?? null
    })
    .toMatchObject({
      kind: 'compensation-conflict',
      recoveryId: expectedRecoveryId,
      taskId: task.taskId,
      conflictPaths: compensation.conflictPaths,
    })

  const recoveryBanner = workspace.locator('section').filter({ hasText: '任务补偿遇到人工修改' })
  await expect(recoveryBanner).toContainText('这里只能刷新耐久冲突报告，不会再次执行补偿')
  await expect(recoveryBanner.getByRole('list', { name: '冲突字段' })).toContainText(compensation.conflictPaths[0])
  await expect(recoveryBanner.getByRole('button', { name: '刷新耐久冲突报告' })).toBeVisible()
  await expect(recoveryBanner.getByRole('button', { name: '重试任务补偿' })).toHaveCount(0)

  const tasksBeforeRefresh = (await readProbe(page))?.snapshot.remote.tasks.map(candidate => candidate.taskId) ?? []
  await recoveryBanner.getByRole('button', { name: '刷新耐久冲突报告' }).click()
  await expect.poll(async () => (await readProbe(page))?.snapshot.pendingAction ?? null).toBeNull()
  await expect
    .poll(
      async () =>
        (await readProbe(page))?.snapshot.remote.recoveries.some(
          recovery => recovery.recoveryId === expectedRecoveryId,
        ) ?? false,
    )
    .toBe(true)

  const afterRefresh = await page.evaluate(
    async ({ binding, outerCallId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      return {
        taskIds:
          window.__EASY_EDITOR_E2E__
            ?.getAgentWorkspaceState()
            ?.snapshot.remote.tasks.map(candidate => candidate.taskId) ?? [],
        backgroundColor: runtime.engine.project.currentDocument?.root.getPropValue('backgroundColor'),
        run: await runtime.dashboardPersistence.readCompensationRun({
          schemaVersion: 1,
          ...binding,
          outerCallId,
        }),
      }
    },
    { binding: prepared.binding, outerCallId: compensation.outerCallId },
  )
  expect(afterRefresh.taskIds).toEqual(tasksBeforeRefresh)
  expect(afterRefresh.backgroundColor).toBe('#fedcba')
  expect(afterRefresh.run).toEqual(compensation.run)
})
