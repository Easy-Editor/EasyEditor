import { type BrowserContext, type Page, expect, test } from '@playwright/test'

type Authority = Readonly<{
  projectId: string
  branchId: string
  sessionId: string
  taskId: string
}>

type ScreenApplyCall = Readonly<{
  schemaVersion: 1
  projectId: string
  branchId: string
  sessionId: string
  taskId: string
  stepId: string
  callId: string
  capability: 'screen.applyChangeSet'
  expectedRevision: string
  arguments: Readonly<{
    schemaVersion: 1
    documentId: string
    operations: readonly Readonly<{
      opId: string
      type: 'set'
      nodeId: string
      fieldId: 'props.backgroundColor'
      value: string
    }>[]
  }>
}>

type CrashSetup = Readonly<{
  authority: Authority
  call: ScreenApplyCall
  beforeColor: string
  beforeSchema: unknown
  beforeMutationVersion: number
}>

type RestartResult = Readonly<{
  receiptStatus: string | null
  receiptFailureCode: string | null
  replayStatus: string
  replayFailureCode: string | null
  color: string
  schema: unknown
  mutationVersionBeforeReplay: number
  mutationVersionAfterReplay: number
}>

const waitForEditor = async (page: Page): Promise<void> => {
  await page.goto('/')
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__EASY_EDITOR_E2E__?.getEngineState())).toBe('ready')
}

const startInterruptedApply = (
  page: Page,
  options: Readonly<{
    stateKey: string
    callId: string
    targetColor: string
    interruptAt: 'intent' | 'commit'
  }>,
): Promise<CrashSetup> =>
  page.evaluate(async options => {
    const runtime = await import('/src/editor/runtime.ts')
    await runtime.dashboardPersistence.flush()
    await runtime.persistDashboardProject('manual-save')
    await runtime.dashboardPersistence.flush()

    const persistenceSnapshot = runtime.dashboardPersistence.getSnapshot()
    const projectId = persistenceSnapshot.projectId
    const branchId = persistenceSnapshot.branchId
    const document = runtime.engine.project.currentDocument
    if (!projectId || !branchId || !document) throw new Error('Dashboard Agent E2E authority is unavailable')

    const authority = {
      projectId,
      branchId,
      sessionId: `browser-crash-session-${options.interruptAt}`,
      taskId: `browser-crash-task-${options.interruptAt}`,
    }
    const state = {
      intentRecorded: false,
      commitCompleted: false,
      invocationSettled: false,
      invocationError: null as string | null,
    }
    Object.assign(window, { [options.stateKey]: state })

    type DurableSession = Readonly<{
      draft: unknown
      recordIntent(intent: unknown): Promise<unknown>
      readReceiptLineage(request: unknown): Promise<unknown>
      readMutationProvenance(request: unknown): Promise<unknown>
      commitBatch(batch: unknown): Promise<unknown>
    }>
    type DurablePersistence = {
      runDurableAgentWrite<T>(operation: (session: DurableSession) => Promise<T>): Promise<T>
    }
    const persistence = runtime.dashboardPersistence as unknown as DurablePersistence
    const originalRunDurableAgentWrite = persistence.runDurableAgentWrite.bind(persistence)
    persistence.runDurableAgentWrite = operation =>
      originalRunDurableAgentWrite(session => {
        const interruptedSession: DurableSession = Object.freeze({
          ...session,
          recordIntent: async intent => {
            const recorded = await session.recordIntent(intent)
            state.intentRecorded = true
            if (options.interruptAt === 'intent') await new Promise<never>(() => {})
            return recorded
          },
          commitBatch: async batch => {
            const committed = await session.commitBatch(batch)
            state.commitCompleted = true
            if (options.interruptAt === 'commit') await new Promise<never>(() => {})
            return committed
          },
        })
        return operation(interruptedSession)
      })

    const host = runtime.composeDashboardAgentHost(authority)
    if (!host) throw new Error('Dashboard Agent Host is disabled in the browser gate')
    const observed = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
    const beforeColor = document.root.getPropValue('backgroundColor')
    if (typeof beforeColor !== 'string') throw new Error('Dashboard root backgroundColor is unavailable')

    const call = {
      schemaVersion: 1 as const,
      ...authority,
      stepId: `browser-crash-step-${options.interruptAt}`,
      callId: options.callId,
      capability: 'screen.applyChangeSet' as const,
      expectedRevision: observed.revision,
      arguments: {
        schemaVersion: 1 as const,
        documentId: document.id,
        operations: [
          {
            opId: `browser-crash-set-background-${options.interruptAt}`,
            type: 'set' as const,
            nodeId: document.root.id,
            fieldId: 'props.backgroundColor' as const,
            value: options.targetColor,
          },
        ],
      },
    }

    void host.invoke(call, { schemaVersion: 1 }).then(
      () => {
        state.invocationSettled = true
      },
      error => {
        state.invocationSettled = true
        state.invocationError = error instanceof Error ? error.message : String(error)
      },
    )

    return {
      authority,
      call,
      beforeColor,
      beforeSchema: document.exportRaw(),
      beforeMutationVersion: document.mutationVersion,
    }
  }, options)

const waitForCrashPoint = async (page: Page, stateKey: string, point: 'intentRecorded' | 'commitCompleted') => {
  await expect
    .poll(() =>
      page.evaluate(
        ({ point, stateKey }) =>
          Boolean((window as unknown as Record<string, Record<string, unknown> | undefined>)[stateKey]?.[point]),
        { point, stateKey },
      ),
    )
    .toBe(true)
  await expect(
    page.evaluate(
      stateKey =>
        Boolean(
          (window as unknown as Record<string, { invocationSettled?: boolean } | undefined>)[stateKey]
            ?.invocationSettled,
        ),
      stateKey,
    ),
  ).resolves.toBe(false)
}

const restartAndReplay = async (
  context: BrowserContext,
  setup: CrashSetup,
): Promise<Readonly<{ page: Page; result: RestartResult }>> => {
  const page = await context.newPage()
  await waitForEditor(page)
  const result = await page.evaluate(async setup => {
    const runtime = await import('/src/editor/runtime.ts')
    await runtime.dashboardPersistence.flush()
    const document = runtime.engine.project.currentDocument
    if (!document) throw new Error('Dashboard document is unavailable after restart')
    const host = runtime.composeDashboardAgentHost(setup.authority)
    if (!host) throw new Error('Dashboard Agent Host is disabled after restart')

    const receipt = await host.queryReceipt({
      schemaVersion: 1,
      ...setup.authority,
      callId: setup.call.callId,
    })
    const mutationVersionBeforeReplay = document.mutationVersion
    const replay = await host.invoke(setup.call, { schemaVersion: 1 })
    const mutationVersionAfterReplay = document.mutationVersion
    const color = document.root.getPropValue('backgroundColor')
    if (typeof color !== 'string') throw new Error('Dashboard root backgroundColor is unavailable after restart')
    host.dispose()

    return {
      receiptStatus: receipt?.status ?? null,
      receiptFailureCode: receipt?.failure?.code ?? null,
      replayStatus: replay.status,
      replayFailureCode: replay.failure?.code ?? null,
      color,
      schema: document.exportRaw(),
      mutationVersionBeforeReplay,
      mutationVersionAfterReplay,
    }
  }, setup)
  return { page, result }
}

test('page close after durable intent recovers indeterminate without changing or replaying Core', async ({
  context,
  page,
}) => {
  await waitForEditor(page)
  const stateKey = '__G005_INTENT_CRASH_GATE__'
  const setup = await startInterruptedApply(page, {
    stateKey,
    callId: 'browser-screen-intent-crash-1',
    targetColor: '#123456',
    interruptAt: 'intent',
  })
  await waitForCrashPoint(page, stateKey, 'intentRecorded')
  await page.close()

  const restarted = await restartAndReplay(context, setup)
  expect(restarted.result).toMatchObject({
    receiptStatus: 'indeterminate',
    receiptFailureCode: 'INDETERMINATE_RECEIPT',
    replayStatus: 'indeterminate',
    replayFailureCode: 'INDETERMINATE_RECEIPT',
    color: setup.beforeColor,
  })
  expect(restarted.result.schema).toEqual(setup.beforeSchema)
  expect(restarted.result.mutationVersionAfterReplay).toBe(restarted.result.mutationVersionBeforeReplay)
  await restarted.page.close()
})

test('page close after durable commit replays the stable callId without a second Core effect', async ({
  context,
  page,
}) => {
  await waitForEditor(page)
  const stateKey = '__G005_COMMIT_CRASH_GATE__'
  const targetColor = '#654321'
  const setup = await startInterruptedApply(page, {
    stateKey,
    callId: 'browser-screen-commit-crash-1',
    targetColor,
    interruptAt: 'commit',
  })
  await waitForCrashPoint(page, stateKey, 'commitCompleted')
  await page.close()

  const restarted = await restartAndReplay(context, setup)
  expect(restarted.result).toMatchObject({
    receiptStatus: 'applied',
    receiptFailureCode: null,
    replayStatus: 'applied',
    replayFailureCode: null,
    color: targetColor,
  })
  expect(restarted.result.mutationVersionAfterReplay).toBe(restarted.result.mutationVersionBeforeReplay)
  expect(restarted.result.schema).not.toEqual(setup.beforeSchema)
  await restarted.page.close()
})

test('real module Worker crash after the durable Host commit auto-recovers without a second Core effect', async ({
  page,
}) => {
  await waitForEditor(page)
  const stateKey = '__G005_WORKER_CRASH_GATE__'
  const targetColor = '#246810'
  const setup = await page.evaluate(
    async ({ stateKey, targetColor }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const { createBrowserAgentRuntimeHarness } = await import('/e2e/fixtures/agent-runtime-main.ts')
      await runtime.dashboardPersistence.flush()
      await runtime.persistDashboardProject('manual-save')
      await runtime.dashboardPersistence.flush()

      const persistenceSnapshot = runtime.dashboardPersistence.getSnapshot()
      const projectId = persistenceSnapshot.projectId
      const branchId = persistenceSnapshot.branchId
      const document = runtime.engine.project.currentDocument
      if (!projectId || !branchId || !document) throw new Error('Dashboard Agent E2E authority is unavailable')

      const authority = {
        projectId,
        branchId,
        sessionId: 'browser-worker-session',
        taskId: 'browser-worker-1-task-1',
      }
      const state = {
        commitCompleted: false,
        hostAckBlocked: false,
        harness: null as ReturnType<typeof createBrowserAgentRuntimeHarness> | null,
        host: null as ReturnType<typeof runtime.composeDashboardAgentHost>,
        call: null as ScreenApplyCall | null,
      }
      Object.assign(window, { [stateKey]: state })

      type DurableSession = Readonly<{
        draft: unknown
        recordIntent(intent: unknown): Promise<unknown>
        readReceiptLineage(request: unknown): Promise<unknown>
        readMutationProvenance(request: unknown): Promise<unknown>
        commitBatch(batch: unknown): Promise<unknown>
      }>
      type DurablePersistence = {
        runDurableAgentWrite<T>(operation: (session: DurableSession) => Promise<T>): Promise<T>
      }
      const persistence = runtime.dashboardPersistence as unknown as DurablePersistence
      const originalRunDurableAgentWrite = persistence.runDurableAgentWrite.bind(persistence)
      persistence.runDurableAgentWrite = async operation => {
        const result = await originalRunDurableAgentWrite(session =>
          operation(
            Object.freeze({
              ...session,
              commitBatch: async batch => {
                const committed = await session.commitBatch(batch)
                state.commitCompleted = true
                return committed
              },
            }),
          ),
        )
        if (state.commitCompleted) {
          state.hostAckBlocked = true
          await new Promise<never>(() => {})
        }
        return result
      }

      const host = runtime.composeDashboardAgentHost(authority)
      if (!host) throw new Error('Dashboard Agent Host is disabled in the Worker crash gate')
      state.host = host
      const observed = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
      const beforeColor = String(document.root.getPropValue('backgroundColor'))
      const beforeSchema = document.exportRaw()
      const beforeMutationVersion = document.mutationVersion
      const call: ScreenApplyCall = {
        schemaVersion: 1,
        ...authority,
        stepId: 'browser-worker-1-step-1',
        callId: `call:${authority.sessionId.length}:${authority.sessionId}:browser-worker-1-call-1`,
        capability: 'screen.applyChangeSet',
        expectedRevision: observed.revision,
        arguments: {
          schemaVersion: 1,
          documentId: document.id,
          operations: [
            {
              opId: 'browser-worker-set-background',
              type: 'set',
              nodeId: document.root.id,
              fieldId: 'props.backgroundColor',
              value: targetColor,
            },
          ],
        },
      }
      state.call = call

      const harness = createBrowserAgentRuntimeHarness({
        binding: { projectId, branchId, sessionId: authority.sessionId },
        host,
        persistence: runtime.dashboardAgentPersistence,
        scripts: [
          [
            {
              expectedPhase: 'BLUEPRINT',
              events: [{ schemaVersion: 1, kind: 'blueprint', summary: 'Update the dashboard background' }],
            },
            {
              expectedPhase: 'PLAN_STEP',
              events: [
                {
                  schemaVersion: 1,
                  kind: 'tool-call',
                  call: {
                    schemaVersion: 1,
                    capability: call.capability,
                    arguments: call.arguments,
                    expectedRevision: call.expectedRevision,
                  },
                },
                { schemaVersion: 1, kind: 'complete', summary: 'Dashboard updated' },
              ],
            },
          ],
          [],
        ],
      })
      state.harness = harness
      await harness.runtime.ready()
      const task = await harness.runtime.submit({ text: 'Update the dashboard background' })
      if (task.taskId !== authority.taskId) throw new Error(`Unexpected Worker task id ${task.taskId}`)

      return {
        authority,
        call,
        beforeColor,
        beforeSchema,
        beforeMutationVersion,
      }
    },
    { stateKey, targetColor },
  )

  await expect
    .poll(() =>
      page.evaluate(
        stateKey =>
          Boolean(
            (window as unknown as Record<string, { hostAckBlocked?: boolean } | undefined>)[stateKey]?.hostAckBlocked,
          ),
        stateKey,
      ),
    )
    .toBe(true)

  await page.evaluate(stateKey => {
    const state = (window as unknown as Record<string, { harness?: { crashActiveWorker(): void } } | undefined>)[
      stateKey
    ]
    state?.harness?.crashActiveWorker()
  }, stateKey)
  await expect
    .poll(() =>
      page.evaluate(stateKey => {
        const state = (
          window as unknown as Record<
            string,
            { harness?: { getWorkerCount(): number; runtime: { getSnapshot(): { phase: string } } } } | undefined
          >
        )[stateKey]
        return {
          phase: state?.harness?.runtime.getSnapshot().phase ?? null,
          workerCount: state?.harness?.getWorkerCount() ?? 0,
        }
      }, stateKey),
    )
    .toEqual({ phase: 'COMPLETED', workerCount: 2 })

  const result = await page.evaluate(
    async ({ setup, stateKey }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const state = (
        window as unknown as Record<
          string,
          {
            harness: {
              runtime: { waitForIdle(): Promise<void>; getSnapshot(): { phase: string }; dispose(): Promise<void> }
              getWorkerCount(): number
              getLiveWorkerCount(): number
              getStatuses(): readonly string[]
            }
            host: NonNullable<ReturnType<typeof runtime.composeDashboardAgentHost>>
            call: ScreenApplyCall
          }
        >
      )[stateKey]
      if (!state?.harness || !state.host || !state.call) throw new Error('Worker crash harness state is unavailable')
      await state.harness.runtime.waitForIdle()
      const document = runtime.engine.project.currentDocument
      if (!document) throw new Error('Dashboard document is unavailable after Worker recovery')
      const receipt = await state.host.queryReceipt({
        schemaVersion: 1,
        ...setup.authority,
        callId: setup.call.callId,
      })
      const mutationVersionBeforeReplay = document.mutationVersion
      const replay = await state.host.invoke(state.call, { schemaVersion: 1 })
      const mutationVersionAfterReplay = document.mutationVersion
      const liveWorkersBeforeDispose = state.harness.getLiveWorkerCount()
      const statuses = state.harness.getStatuses()
      const workerCount = state.harness.getWorkerCount()
      const phase = state.harness.runtime.getSnapshot().phase
      await state.harness.runtime.dispose()
      const liveWorkersAfterDispose = state.harness.getLiveWorkerCount()
      state.host.dispose()
      return {
        receiptStatus: receipt?.status ?? null,
        replayStatus: replay.status,
        color: String(document.root.getPropValue('backgroundColor')),
        schema: document.exportRaw(),
        mutationVersionBeforeReplay,
        mutationVersionAfterReplay,
        statuses,
        workerCount,
        liveWorkersBeforeDispose,
        liveWorkersAfterDispose,
        phase,
      }
    },
    { setup, stateKey },
  )

  expect(result).toMatchObject({
    receiptStatus: 'applied',
    replayStatus: 'applied',
    color: targetColor,
    workerCount: 2,
    liveWorkersBeforeDispose: 1,
    liveWorkersAfterDispose: 0,
    phase: 'COMPLETED',
  })
  expect(result.statuses).toContain('recovering')
  expect(result.mutationVersionBeforeReplay).toBe(setup.beforeMutationVersion + 1)
  expect(result.mutationVersionAfterReplay).toBe(result.mutationVersionBeforeReplay)
  expect(result.schema).not.toEqual(setup.beforeSchema)
  expect(result.color).not.toBe(setup.beforeColor)
})
