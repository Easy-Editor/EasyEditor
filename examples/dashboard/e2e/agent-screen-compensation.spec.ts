import { expect, test } from '@playwright/test'

type AgentRoundTripResult = Readonly<{
  before: string
  afterApply: string
  afterCompensate: string
  applyStatus: string
  applyReceiptStatus: string | null
  compensationStatus: string
  compensationReceiptStatus: string | null
  draftGeneration: number
}>

const runAgentRoundTrip = (page: import('@playwright/test').Page): Promise<AgentRoundTripResult> =>
  page.evaluate(async () => {
    const runtime = await import('/src/editor/runtime.ts')
    await runtime.dashboardPersistence.flush()

    const persistence = runtime.dashboardPersistence.getSnapshot()
    const projectId = persistence.projectId
    const branchId = persistence.branchId
    const document = runtime.engine.project.currentDocument
    if (!projectId || !branchId || !document) throw new Error('Dashboard Agent E2E authority is unavailable')

    const sessionId = 'browser-agent-session'
    const forwardTaskId = 'browser-forward-task'
    const forwardCallId = 'browser-screen-apply-1'
    const compensationCallId = 'browser-task-compensate-1'
    const before = document.root.getPropValue('backgroundColor')
    if (typeof before !== 'string') throw new Error('Dashboard root backgroundColor is unavailable')

    const forwardAuthority = { projectId, branchId, sessionId, taskId: forwardTaskId }
    const forwardHost = runtime.composeDashboardAgentHost(forwardAuthority)
    if (!forwardHost) throw new Error('Dashboard Agent Host is disabled in the browser gate')

    const observed = await forwardHost.observe({ schemaVersion: 1, ...forwardAuthority, mode: 'full' })
    const applied = await forwardHost.invoke(
      {
        schemaVersion: 1,
        ...forwardAuthority,
        stepId: 'browser-forward-step',
        callId: forwardCallId,
        capability: 'screen.applyChangeSet',
        expectedRevision: observed.revision,
        arguments: {
          schemaVersion: 1,
          documentId: document.id,
          operations: [
            {
              opId: 'browser-set-background',
              type: 'set',
              nodeId: document.root.id,
              fieldId: 'props.backgroundColor',
              value: '#123456',
            },
          ],
        },
      },
      { schemaVersion: 1 },
    )
    const afterApply = document.root.getPropValue('backgroundColor')
    const applyReceipt = await forwardHost.queryReceipt({ projectId, branchId, callId: forwardCallId })
    forwardHost.dispose()

    const compensationAuthority = {
      projectId,
      branchId,
      sessionId,
      taskId: 'browser-compensation-task',
    }
    const compensationHost = runtime.composeDashboardAgentHost(compensationAuthority)
    if (!compensationHost) throw new Error('Dashboard compensation Host is disabled in the browser gate')
    const compensationObserved = await compensationHost.observe({
      schemaVersion: 1,
      ...compensationAuthority,
      mode: 'full',
    })
    const compensation = await compensationHost.invoke(
      {
        schemaVersion: 1,
        ...compensationAuthority,
        stepId: 'browser-compensation-step',
        callId: compensationCallId,
        capability: 'task.compensate',
        expectedRevision: compensationObserved.revision,
        arguments: { schemaVersion: 1, targetTaskId: forwardTaskId },
      },
      {
        schemaVersion: 1,
        compensationTarget: {
          schemaVersion: 1,
          taskId: forwardTaskId,
          sessionId,
          phase: 'COMPLETED',
          callIndexComplete: true,
          callIndex: [{ callId: forwardCallId, capability: 'screen.applyChangeSet' }],
        },
      },
    )
    const afterCompensate = document.root.getPropValue('backgroundColor')
    const compensationReceipt = await compensationHost.queryReceipt({
      projectId,
      branchId,
      callId: compensationCallId,
    })
    compensationHost.dispose()
    await runtime.dashboardPersistence.flush()

    return {
      before,
      afterApply: String(afterApply),
      afterCompensate: String(afterCompensate),
      applyStatus: applied.status,
      applyReceiptStatus: applyReceipt?.status ?? null,
      compensationStatus: compensation.status,
      compensationReceiptStatus: compensationReceipt?.status ?? null,
      draftGeneration: runtime.dashboardPersistence.getSnapshot().draftGeneration,
    }
  })

test('production browser Host applies and durably compensates a real Screen change', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__EASY_EDITOR_E2E__?.getEngineState())).toBe('ready')

  const result = await runAgentRoundTrip(page)

  expect(result).toMatchObject({
    applyStatus: 'applied',
    applyReceiptStatus: 'applied',
    compensationStatus: 'applied',
    compensationReceiptStatus: 'applied',
    afterApply: '#123456',
  })
  expect(result.afterCompensate).toBe(result.before)
  expect(result.draftGeneration).toBeGreaterThanOrEqual(3)

  await page.reload()
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__EASY_EDITOR_E2E__?.getEngineState())).toBe('ready')
  const restored = await page.evaluate(async () => {
    const runtime = await import('/src/editor/runtime.ts')
    return runtime.engine.project.currentDocument?.root.getPropValue('backgroundColor')
  })
  expect(restored).toBe(result.before)
})
