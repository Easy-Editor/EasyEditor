import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { type Locator, type Page, expect, test } from '@playwright/test'
import {
  type BrowserOperationMeasurement,
  type OnlineResourceDiagnostics,
  beginBrowserOperationMeasurement,
  finishBrowserOperationMeasurement,
  installBrowserPerformanceObserver,
  readBrowserBoundarySnapshot,
  readOnlineResourceDiagnostics,
} from './fixtures/browser-performance-observer'
import {
  PERFORMANCE_EDITOR_SURFACE_ID,
  PERFORMANCE_NODE_COUNT,
  PERFORMANCE_ONLINE_NODE_COUNT,
  PERFORMANCE_TARGET_NODE_ID,
  seedDashboardPerformanceProject,
} from './fixtures/dashboard-performance'

const WARMUP_RUNS = 5
const MEASUREMENT_RUNS = 5
const INPUT_STEPS = 24
const INPUT_STEP_DELAY_MS = 12
const MEDIAN_FPS_FLOOR = 55
const MODEL_GATEWAY_PATH_PREFIX = '/api/agent/model'
const ARTIFACT_ROOT = fileURLToPath(new URL('../test-results/agent-runtime-performance/', import.meta.url))

interface FrameMeasurement {
  readonly durationMs: number
  readonly fps: number
  readonly frameIntervalsMs: readonly number[]
  readonly longTaskCount: number
  readonly longTaskSupported: boolean
  readonly longTasks: BrowserOperationMeasurement['longTasks']
  readonly maxRenderBatchesPerFrame: number
  readonly p95FrameIntervalMs: number
  readonly renderBatches: BrowserOperationMeasurement['renderBatches']
  readonly run: number
}

const percentile = (values: readonly number[], percentileValue: number): number => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)] ?? Number.NaN
}

const median = (values: readonly number[]): number => percentile(values, 0.5)

const maximumBatchesPerFrame = (measurement: BrowserOperationMeasurement): number => {
  const counts = new Map<number, number>()
  for (const batch of measurement.renderBatches) counts.set(batch.frameId, (counts.get(batch.frameId) ?? 0) + 1)
  return Math.max(0, ...counts.values())
}

const stableResourceBoundary = (diagnostics: OnlineResourceDiagnostics) => ({
  activePortCount: diagnostics.activePortCount,
  bridge: diagnostics.bridge,
  objectUrlCount: diagnostics.objectUrlCount,
  sandboxInstanceCount: diagnostics.sandboxInstanceCount,
  sandboxListenerCount: diagnostics.sandboxListenerCount,
  sandboxPendingTaskCount: diagnostics.sandboxPendingTaskCount,
})

const continuouslyDrag = async (page: Page, shell: Locator, direction: number): Promise<void> => {
  const box = await shell.boundingBox()
  if (!box) throw new Error('G010 target shell has no bounding box')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  try {
    for (let step = 1; step <= INPUT_STEPS; step += 1) {
      await page.mouse.move(start.x + direction * step * 2, start.y + direction * step)
      await page.waitForTimeout(INPUT_STEP_DELAY_MS)
    }
  } finally {
    await page.mouse.up()
  }
}

const selectPerformanceTarget = async (page: Page, shell: Locator): Promise<void> => {
  await shell.click()
  await expect
    .poll(() =>
      page.evaluate(async targetNodeId => {
        const runtime = await import('/src/editor/runtime.ts')
        return runtime.engine.designer.selection.has(targetNodeId)
      }, PERFORMANCE_TARGET_NODE_ID),
    )
    .toBe(true)
  await expect(page.locator('.lc-resize-corner.se:visible').last()).toBeVisible()
}

const continuouslyResize = async (page: Page, direction: number): Promise<void> => {
  const handle = page.locator('.lc-resize-corner.se:visible').last()
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  if (!box) throw new Error('G010 southeast resize handle has no bounding box')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  try {
    for (let step = 1; step <= INPUT_STEPS; step += 1) {
      await page.mouse.move(start.x + direction * step, start.y + direction * step)
      await page.waitForTimeout(INPUT_STEP_DELAY_MS)
    }
  } finally {
    await page.mouse.up()
  }
}

const waitForStableOnlineResources = async (page: Page) => {
  await expect
    .poll(async () => {
      const diagnostics = await readOnlineResourceDiagnostics(page)
      return {
        instanceCount: diagnostics.bridge.instanceCount,
        objectUrlCount: diagnostics.objectUrlCount,
        sandboxInstanceCount: diagnostics.sandboxInstanceCount,
        sandboxPendingTaskCount: diagnostics.sandboxPendingTaskCount,
        scheduledFrameCount: diagnostics.bridge.scheduledFrameCount,
      }
    })
    .toEqual({
      instanceCount: PERFORMANCE_ONLINE_NODE_COUNT,
      objectUrlCount: 0,
      sandboxInstanceCount: PERFORMANCE_ONLINE_NODE_COUNT,
      sandboxPendingTaskCount: 0,
      scheduledFrameCount: 0,
    })
  await page.evaluate(
    () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  return readOnlineResourceDiagnostics(page)
}

const runWorkerBoundaryTask = async (page: Page) => {
  await expect
    .poll(() => page.workers().map(worker => worker.url()))
    .toContainEqual(expect.stringContaining('/editor/agent/runtime-e2e/worker'))
  await expect
    .poll(() =>
      page.evaluate(() => {
        const probe = window.__EASY_EDITOR_E2E__?.getAgentWorkspaceState()
        return probe?.snapshot.remote.runtimeStatus ?? null
      }),
    )
    .toBe('ready')

  await page.getByTestId('agent-workspace-toggle').click()
  const workspace = page.getByTestId('agent-workspace')
  await expect(workspace).toBeVisible()
  await workspace.getByRole('tab', { name: '授权' }).click()
  const projectWriteGrant = workspace.getByRole('listitem').filter({ hasText: '修改当前项目' })
  const authorize = projectWriteGrant.getByRole('button', { name: '授权' })
  if (await authorize.isVisible().catch(() => false)) await authorize.click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__EASY_EDITOR_E2E__
          ?.getAgentWorkspaceState()
          ?.snapshot.remote.grants.find(grant => grant.scope === 'project.write'),
      ),
    )
    .toMatchObject({ status: 'granted' })
  await workspace.getByRole('tab', { name: '任务' }).click()
  await workspace.locator('#agent-workspace-intent').fill('Run the G010 Worker boundary marker without a Host mutation')
  await workspace.getByRole('button', { name: '开始搭建', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const tasks = window.__EASY_EDITOR_E2E__?.getAgentWorkspaceState()?.snapshot.remote.tasks ?? []
        return tasks.at(-1)?.phase ?? null
      }),
    )
    .toBe('COMPLETED')
  const task = await page.evaluate(() => {
    const tasks = window.__EASY_EDITOR_E2E__?.getAgentWorkspaceState()?.snapshot.remote.tasks ?? []
    return tasks.at(-1) ?? null
  })
  await workspace.getByRole('button', { name: '关闭 Agent Workspace' }).click()
  await expect(workspace).toBeHidden()
  if (!task) throw new Error('G010 Worker boundary task is unavailable')
  return { phase: task.phase, taskId: task.taskId }
}

test('fixed Chromium runner sustains the 200-node online editor during continuous drag and resize', async ({
  browser,
  context,
  page,
}, testInfo) => {
  expect(testInfo.project.metadata).toMatchObject({
    runnerClass: 'g010-fixed-no-throttle',
    cpuThrottleRate: 1,
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await installBrowserPerformanceObserver(page)
  const boundary = await seedDashboardPerformanceProject(page)
  expect(boundary).toMatchObject({
    childNodeCount: PERFORMANCE_NODE_COUNT,
    onlineNodeCount: PERFORMANCE_ONLINE_NODE_COUNT,
  })
  await expect(page.locator(`iframe[data-online-component-sandbox="${PERFORMANCE_EDITOR_SURFACE_ID}"]`)).toHaveCount(1)

  const workerTask = await runWorkerBoundaryTask(page)
  const workerBoundary = await readBrowserBoundarySnapshot(page)
  expect(workerBoundary.workers.some(worker => worker.url.includes('/editor/agent/runtime-e2e/worker'))).toBe(true)
  expect(workerBoundary.mainThreadModelRequests).toEqual([])

  const baselineResources = await waitForStableOnlineResources(page)
  const shell = page.locator(`[data-online-component-shell="${PERFORMANCE_TARGET_NODE_ID}"]`)
  await expect(shell).toBeVisible()
  const measurements: FrameMeasurement[] = []
  for (let run = 0; run < WARMUP_RUNS + MEASUREMENT_RUNS; run += 1) {
    const direction = run % 2 === 0 ? 1 : -1
    await selectPerformanceTarget(page, shell)
    if (run >= WARMUP_RUNS) await beginBrowserOperationMeasurement(page, run - WARMUP_RUNS)
    await continuouslyDrag(page, shell, direction)
    await selectPerformanceTarget(page, shell)
    await continuouslyResize(page, direction)
    if (run < WARMUP_RUNS) continue

    const measurement = await finishBrowserOperationMeasurement(page)
    const timestamps = measurement.frameTimestampsMs
    expect(timestamps.length).toBeGreaterThan(2)
    const intervals = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index])
    const elapsed = timestamps.at(-1)! - timestamps[0]!
    measurements.push({
      durationMs: elapsed,
      fps: ((timestamps.length - 1) * 1000) / elapsed,
      frameIntervalsMs: intervals,
      longTaskCount: measurement.longTasks.length,
      longTaskSupported: measurement.longTaskSupported,
      longTasks: measurement.longTasks,
      maxRenderBatchesPerFrame: maximumBatchesPerFrame(measurement),
      p95FrameIntervalMs: percentile(intervals, 0.95),
      renderBatches: measurement.renderBatches,
      run: measurement.run,
    })
  }

  const finalResources = await waitForStableOnlineResources(page)
  const finalBoundary = await readBrowserBoundarySnapshot(page)
  const runtimeBoundary = await page.evaluate(() => ({
    devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
  }))
  const runnerBoundary = {
    schemaVersion: 1,
    projectName: testInfo.project.name,
    browserName: testInfo.project.use.browserName,
    browserVersion: browser.version(),
    configuredViewport: testInfo.project.use.viewport,
    configuredDeviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    configuredLocale: testInfo.project.use.locale,
    configuredTimezoneId: testInfo.project.use.timezoneId,
    runnerClass: testInfo.project.metadata.runnerClass,
    cpuThrottleRate: testInfo.project.metadata.cpuThrottleRate,
    workers: finalBoundary.workers,
    mainThreadModelRequests: finalBoundary.mainThreadModelRequests,
    modelGatewayPathPrefix: MODEL_GATEWAY_PATH_PREFIX,
    workerTask,
    runtime: runtimeBoundary,
  }
  const allFrameIntervals = measurements.flatMap(measurement => measurement.frameIntervalsMs)
  const portLifecycle = {
    createdPortDelta: finalResources.createdPortCount - baselineResources.createdPortCount,
    closedPortDelta: finalResources.closedPortCount - baselineResources.closedPortCount,
  }
  const raw = {
    schemaVersion: 1,
    runner: runnerBoundary,
    companionNodeGates: [
      {
        file: 'test/agent-runtime-screen-integration-gates.test.mjs',
        name: 'fixed 200-node real Core atomic commit runner keeps warmed P95 below 50ms',
        boundary: 'warmed P95 < 50ms',
      },
      {
        file: 'test/agent-runtime-snapshot.test.mjs',
        name: 'fixed 200-node smoke records warmed build+clone evidence and keeps one-move delta below 20% of full',
        boundary: 'one-move delta < 20% of full snapshot bytes',
      },
    ],
    workload: {
      boundary,
      warmupRuns: WARMUP_RUNS,
      measurementRuns: MEASUREMENT_RUNS,
      operations: ['continuous-real-drag', 'continuous-real-resize'],
      inputStepsPerOperation: INPUT_STEPS,
      inputStepDelayMs: INPUT_STEP_DELAY_MS,
      sharedEditorIframeCount: 1,
    },
    resources: { baseline: baselineResources, final: finalResources, portLifecycle },
    measurements,
    aggregate: {
      medianFps: median(measurements.map(measurement => measurement.fps)),
      p95FrameIntervalMs: percentile(allFrameIntervals, 0.95),
      longTaskCount: measurements.reduce((count, measurement) => count + measurement.longTaskCount, 0),
      maxRenderBatchesPerFrame: Math.max(...measurements.map(measurement => measurement.maxRenderBatchesPerFrame)),
    },
  }

  const rawJson = `${JSON.stringify(raw, null, 2)}\n`
  const runnerJson = `${JSON.stringify(runnerBoundary, null, 2)}\n`
  const rawPath = `${ARTIFACT_ROOT}g010-browser-performance-measurements.json`
  const runnerPath = `${ARTIFACT_ROOT}g010-runner-boundary.json`
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await Promise.all([writeFile(rawPath, rawJson), writeFile(runnerPath, runnerJson)])
  await Promise.all([
    testInfo.attach('g010-browser-performance-measurements', {
      body: Buffer.from(rawJson),
      contentType: 'application/json',
    }),
    testInfo.attach('g010-runner-boundary', {
      body: Buffer.from(runnerJson),
      contentType: 'application/json',
    }),
  ])
  testInfo.annotations.push({ type: 'g010-raw-measurements', description: rawPath })
  console.info(`[G010 raw measurements] ${rawPath}`)
  console.info(`[G010 runner boundary] ${runnerPath}`)

  expect(finalBoundary.mainThreadModelRequests).toEqual([])
  expect(stableResourceBoundary(finalResources)).toEqual(stableResourceBoundary(baselineResources))
  expect(portLifecycle.createdPortDelta).toBe(portLifecycle.closedPortDelta)
  expect(measurements.every(measurement => measurement.longTaskSupported)).toBe(true)
  expect(raw.aggregate.maxRenderBatchesPerFrame).toBeLessThanOrEqual(1)
  expect(raw.aggregate.p95FrameIntervalMs).toBeGreaterThan(0)
  expect(raw.aggregate.longTaskCount).toBeGreaterThanOrEqual(0)
  expect(raw.aggregate.medianFps).toBeGreaterThanOrEqual(MEDIAN_FPS_FLOOR)
})
