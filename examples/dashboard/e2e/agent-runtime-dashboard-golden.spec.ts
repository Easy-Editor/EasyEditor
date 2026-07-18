import { readFileSync } from 'node:fs'

import { type Locator, type Page, expect, test } from '@playwright/test'
import {
  GENERATED_MATERIAL_REVISED_SOURCE,
  GENERATED_MATERIAL_REVISED_SOURCE_REVISION,
  GENERATED_MATERIAL_SOURCE,
  GENERATED_MATERIAL_SOURCE_REVISION,
} from './fixtures/generated-material-host'
import { LOCAL_MATERIAL_E2E_GRANT_AUTHORITY } from './fixtures/local-material-promotion-lifecycle'

const SCRIPT_STORAGE_KEY = 'easy-editor:agent-runtime:e2e-steps:v1'
const WORKSPACE_TEST_ID = 'agent-workspace'
const GOLDEN_VERSION_NAME = '城市运行-v1'
const EDITOR_SURFACE_ID = 'dashboard-editor-online'
const PREVIEW_SURFACE_ID = 'dashboard-preview-online'
const GOLDEN_HTTP_URL = 'https://fixtures.easy-editor.invalid/api/traffic-flow'
const GOLDEN_ONLINE_SOURCE_REVISION = GENERATED_MATERIAL_SOURCE_REVISION
const GOLDEN_FOLLOW_UP_SOURCE_REVISION = GENERATED_MATERIAL_REVISED_SOURCE_REVISION
const GOLDEN_ONLINE_SOURCE = GENERATED_MATERIAL_SOURCE
const GOLDEN_FOLLOW_UP_SOURCE = GENERATED_MATERIAL_REVISED_SOURCE

const goldenProject = JSON.parse(
  readFileSync(new URL('../test/fixtures/agent-runtime-golden-project.json', import.meta.url), 'utf8'),
) as Record<string, unknown>

type WorkspaceProbe = NonNullable<ReturnType<NonNullable<Window['__EASY_EDITOR_E2E__']>['getAgentWorkspaceState']>>
type WorkspaceTask = WorkspaceProbe['snapshot']['remote']['tasks'][number]
interface OnlineArtifactRef {
  readonly artifactId: string
  readonly sourceRevision: string
  readonly logicalComponentId: string
  readonly sourceIntegrity: string
  readonly target: Readonly<{ kind: 'online' }>
}

interface LocalMaterialArtifactRef {
  readonly artifactId: string
  readonly sourceRevision: string
  readonly logicalComponentId: string
  readonly sourceIntegrity: string
  readonly target: Readonly<{
    kind: 'local-material'
    materialId: string
    materialVersion: string
    buildIntegrity: string
  }>
  readonly rollbackTo: Readonly<{
    artifactId: string
    sourceRevision: string
    logicalComponentId: string
    sourceIntegrity: string
  }>
}

interface MaterialIdentity {
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: string
}

const readProbe = async (page: Page): Promise<WorkspaceProbe | null> => {
  try {
    return await page.evaluate(() => window.__EASY_EDITOR_E2E__?.getAgentWorkspaceState() ?? null)
  } catch (error) {
    if (
      /execution context was destroyed|navigation|target page, context or browser has been closed/iu.test(String(error))
    ) {
      return null
    }
    throw error
  }
}

const waitForWorkspaceRuntime = async (page: Page): Promise<WorkspaceProbe> => {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__EASY_EDITOR_E2E__?.getEngineState())).toBe('ready')
  await expect
    .poll(async () => {
      const probe = await readProbe(page)
      return probe?.snapshot.remote.runtimeStatus === 'ready' && probe.snapshot.remote.availability.state === 'ready'
    })
    .toBe(true)
  const probe = await readProbe(page)
  if (!probe?.binding.sessionId) throw new Error('Golden Workspace binding is unavailable')
  return probe
}

const settleMaterialGc = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const trigger = window.__EASY_EDITOR_E2E__?.triggerMaterialGc
    if (trigger) await trigger()
  })

const openWorkspace = async (page: Page): Promise<Locator> => {
  const workspace = page.getByTestId(WORKSPACE_TEST_ID)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await workspace.isVisible().catch(() => false)) return workspace
    const toggle = page.getByTestId('agent-workspace-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    try {
      await expect(workspace).toBeVisible({ timeout: 3_000 })
      return workspace
    } catch {
      // Late editor initialization can replace the header once; retry against the current toggle.
    }
  }
  await expect(workspace).toBeVisible()
  return workspace
}

const closeWorkspace = async (workspace: Locator): Promise<void> => {
  await workspace.getByRole('button', { name: '关闭 Agent Workspace' }).click()
  await expect(workspace).toBeHidden()
}

const authorizeScope = async (page: Page, workspace: Locator, label: string, scope: string): Promise<void> => {
  await workspace.getByRole('tab', { name: '授权' }).click()
  const row = workspace.getByRole('listitem').filter({ hasText: label })
  const authorize = row.getByRole('button', { name: '授权' })
  if (await authorize.isVisible().catch(() => false)) await authorize.click()
  await expect
    .poll(async () => (await readProbe(page))?.snapshot.remote.grants.find(grant => grant.scope === scope)?.status)
    .toBe('granted')
}

const authorizeProjectWrite = async (page: Page, workspace: Locator): Promise<void> => {
  await authorizeScope(page, workspace, '修改当前项目', 'project.write')
  await workspace.getByRole('tab', { name: '任务' }).click()
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
  const task = (await readProbe(page))?.snapshot.remote.tasks.find(candidate => Boolean(predicate([candidate])))
  if (!task) throw new Error('Expected Golden Workspace task did not materialize')
  return task
}

const setToolScriptForNextReload = async (
  page: Page,
  options: Readonly<{
    blueprintSummary: string
    completionSummary: string
    capability: string
    arguments: Record<string, unknown>
  }>,
): Promise<string> =>
  page.evaluate(
    async ({ key, options }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const probe = window.__EASY_EDITOR_E2E__?.getAgentWorkspaceState()
      if (!probe?.binding.sessionId) throw new Error('Golden scripted Host binding is unavailable')
      const binding = probe.binding as Required<typeof probe.binding>
      const taskId = 'golden-script-preparation'
      const host = runtime.composeDashboardAgentHost({ ...binding, taskId })
      if (!host) throw new Error('Golden scripted Host is unavailable')
      try {
        const observed = await host.observe({ schemaVersion: 1, ...binding, taskId, mode: 'full' })
        sessionStorage.setItem(
          key,
          JSON.stringify([
            {
              expectedPhase: 'BLUEPRINT',
              events: [
                {
                  schemaVersion: 1,
                  kind: 'blueprint',
                  summary: options.blueprintSummary,
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
                    capability: options.capability,
                    expectedRevision: observed.revision,
                    arguments: options.arguments,
                  },
                },
                { schemaVersion: 1, kind: 'complete', summary: options.completionSummary },
              ],
            },
          ]),
        )
        return observed.revision
      } finally {
        host.dispose()
      }
    },
    { key: SCRIPT_STORAGE_KEY, options },
  )

const surfaceIdFor = (mode: 'editor' | 'preview') => (mode === 'editor' ? EDITOR_SURFACE_ID : PREVIEW_SURFACE_ID)
const sandboxFrame = (page: Page, mode: 'editor' | 'preview') =>
  page.frameLocator(`iframe[data-online-component-sandbox="${surfaceIdFor(mode)}"]`)
const sandboxInstance = (page: Page, mode: 'editor' | 'preview', nodeId: string) =>
  sandboxFrame(page, mode).locator(`.online-component-instance[data-instance-id="${nodeId}"]`)

const dragEditorShell = async (page: Page, nodeId: string, delta: Readonly<{ x: number; y: number }>) => {
  const shell = page.locator(`[data-online-component-shell="${nodeId}"]`)
  const isCurrentShellStableAndHitTestable = () =>
    shell.evaluate(async (element, targetNodeId) => {
      if (!(element instanceof HTMLElement)) return false

      const snapshot = () => {
        const currentShell = [...document.querySelectorAll<HTMLElement>('[data-online-component-shell]')].find(
          candidate => candidate.dataset.onlineComponentShell === targetNodeId,
        )
        const rect = element.getBoundingClientRect()
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        const hit = document.elementFromPoint(center.x, center.y)
        const style = getComputedStyle(element)
        return {
          height: rect.height,
          left: rect.left,
          ready:
            element.isConnected &&
            currentShell === element &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.pointerEvents !== 'none' &&
            hit !== null &&
            (hit === element || element.contains(hit)),
          top: rect.top,
          width: rect.width,
        }
      }

      const before = snapshot()
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      const after = snapshot()
      return (
        before.ready &&
        after.ready &&
        Math.max(
          Math.abs(after.left - before.left),
          Math.abs(after.top - before.top),
          Math.abs(after.width - before.width),
          Math.abs(after.height - before.height),
        ) < 0.5
      )
    }, nodeId)

  await expect(shell).toBeVisible()
  await expect.poll(isCurrentShellStableAndHitTestable).toBe(true)
  await shell.hover({ trial: true })
  await expect.poll(isCurrentShellStableAndHitTestable).toBe(true)
  await shell.hover()

  const box = await shell.boundingBox()
  if (!box) throw new Error(`Golden shell ${nodeId} has no bounding box`)
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const initialDelta = {
    x: Math.sign(delta.x) * Math.min(Math.abs(delta.x), 8),
    y: Math.sign(delta.y) * Math.min(Math.abs(delta.y), 8),
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  try {
    await page.mouse.move(start.x + initialDelta.x, start.y + initialDelta.y, { steps: 2 })
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const runtime = await import('/src/editor/runtime.ts')
            return runtime.engine.designer.dragon.dragging
          }),
        { timeout: 5_000 },
      )
      .toBe(true)
    await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 8 })
  } finally {
    await page.mouse.up()
  }
}

const persistEditorDraft = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const runtime = await import('/src/editor/runtime.ts')
    await runtime.persistDashboardProject('manual-save')
    await runtime.dashboardPersistence.flush()
  })

const openDurableMaterialCard = async (page: Page, material: MaterialIdentity): Promise<Locator> => {
  const quiescenceSnapshot = await page.evaluate(async () => {
    const runtime = await import('/src/editor/runtime.ts')
    await runtime.dashboardMaterialGcRuntime.waitForIdle()
    const gate = runtime.dashboardMutationQuiescenceGate
    if (!gate) throw new Error('Golden Dashboard mutation quiescence gate is unavailable')
    return gate.getSnapshot()
  })
  expect(quiescenceSnapshot.inputBlocked).toBe(false)
  await page.getByRole('button', { name: '组件', exact: true }).click()
  await expect(page.getByText('Components', { exact: true })).toBeVisible()
  const durableMaterials = page.getByRole('button', { name: /本地耐久物料/u })
  await expect(durableMaterials).toContainText('(1)')
  await durableMaterials.click()
  const card = page.locator(
    `[data-testid="durable-material-card"][data-material-id="${material.materialId}"][data-material-version="${material.materialVersion}"][data-build-integrity="${material.buildIntegrity}"]`,
  )
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('aria-disabled', 'false')
  await expect(card).toHaveAttribute('draggable', 'true')
  return card
}

const dragDurableMaterialIntoCanvas = async (page: Page, card: Locator): Promise<void> => {
  const canvas = page.locator('.lc-simulator-content-frame')
  await expect(canvas).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  await card.hover({ trial: true })
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('Golden durable material drag geometry is unavailable')
  const draggingObserved = page.evaluate(async () => {
    const runtime = await import('/src/editor/runtime.ts')
    const deadline = performance.now() + 5_000
    while (performance.now() < deadline) {
      if (runtime.engine.designer.dragon.dragging) return true
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    return false
  })
  await card.dragTo(canvas, { targetPosition: { x: canvasBox.width / 2, y: canvasBox.height / 2 } })
  expect(await draggingObserved).toBe(true)
  expect(
    await page.evaluate(async () => {
      const runtime = await import('/src/editor/runtime.ts')
      return runtime.engine.designer.dragon.dragging
    }),
  ).toBe(false)
}

const expectSurfaceInstances = async (
  page: Page,
  mode: 'editor' | 'preview',
  nodeIds: readonly string[],
): Promise<void> => {
  await expect(page.locator(`iframe[data-online-component-sandbox="${surfaceIdFor(mode)}"]`)).toHaveCount(1)
  await expect(page.locator('[data-online-component-shell]')).toHaveCount(nodeIds.length)
  const instances = sandboxFrame(page, mode).locator('.online-component-instance')
  await expect(instances).toHaveCount(nodeIds.length)
  await expect
    .poll(async () =>
      (
        await instances.evaluateAll(elements => elements.map(element => element.getAttribute('data-instance-id')))
      ).sort(),
    )
    .toEqual([...nodeIds].sort())
}

const readNodeArtifactRefs = (
  page: Page,
  nodeIds: readonly string[],
): Promise<Record<string, OnlineArtifactRef | LocalMaterialArtifactRef | null>> =>
  page.evaluate(async ids => {
    const runtime = await import('/src/editor/runtime.ts')
    const document = runtime.engine.project.currentDocument
    if (!document) throw new Error('Golden document is unavailable while reading artifact refs')
    return Object.fromEntries(
      ids.map(id => {
        const raw = document.getNode(id)?.exportRaw() as
          | { $agent?: { artifactRef?: OnlineArtifactRef | LocalMaterialArtifactRef } }
          | undefined
        return [id, raw?.$agent?.artifactRef ?? null]
      }),
    )
  }, nodeIds)

const readPersistedNodeArtifactRefs = (
  page: Page,
  nodeIds: readonly string[],
): Promise<Record<string, OnlineArtifactRef | LocalMaterialArtifactRef | null>> =>
  page.evaluate(async ids => {
    const storage = await import('/src/lib/storage/index.mjs')
    const pointer = JSON.parse(localStorage.getItem(storage.DASHBOARD_STORAGE_IDENTITY_POINTER_KEY) ?? 'null') as {
      projectId?: string
      branchId?: string
    } | null
    if (typeof pointer?.projectId !== 'string' || typeof pointer.branchId !== 'string') {
      throw new Error('Golden persisted identity pointer is unavailable')
    }
    const coordinator = new storage.ProjectPersistenceCoordinator({
      backend: new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
      crypto,
    })
    try {
      const draft = await coordinator.readWorkingDraft({
        projectId: pointer.projectId,
        branchId: pointer.branchId,
      })
      if (!draft) throw new Error('Golden persisted draft is unavailable while reading artifact refs')
      const found = new Map<string, OnlineArtifactRef | LocalMaterialArtifactRef>()
      const visit = (node: Record<string, unknown>) => {
        const id = typeof node.id === 'string' ? node.id : ''
        const artifactRef = (node.$agent as { artifactRef?: OnlineArtifactRef | LocalMaterialArtifactRef } | undefined)
          ?.artifactRef
        if (ids.includes(id) && artifactRef) found.set(id, structuredClone(artifactRef))
        const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : []
        for (const child of children) visit(child)
      }
      for (const root of draft.projectSchema.componentsTree as Record<string, unknown>[]) visit(root)
      return Object.fromEntries(ids.map(id => [id, found.get(id) ?? null]))
    } finally {
      await coordinator.dispose()
    }
  }, nodeIds)

const seedGoldenProject = async (page: Page): Promise<void> => {
  await page.goto('/logo.svg')
  await page.evaluate(async project => {
    const storage = await import('/src/lib/storage/index.mjs')
    const deleteRequest = indexedDB.deleteDatabase(storage.DASHBOARD_STORAGE_DATABASE_NAME)
    await new Promise<void>((resolve, reject) => {
      deleteRequest.onsuccess = () => resolve()
      deleteRequest.onerror = () => reject(deleteRequest.error ?? new Error('failed to reset Golden IndexedDB'))
      deleteRequest.onblocked = () => reject(new Error('Golden IndexedDB reset was blocked'))
    })
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem(
      storage.DASHBOARD_STORAGE_IDENTITY_POINTER_KEY,
      JSON.stringify({ schemaVersion: 1, projectId: project.id, branchId: 'main' }),
    )
    const coordinator = new storage.ProjectPersistenceCoordinator({
      backend: new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
      crypto,
    })
    try {
      const draft = await coordinator.commit({
        schemaVersion: 1,
        batchId: 'agent-runtime-golden-seed',
        projectId: project.id,
        branchId: 'main',
        expectedDraftGeneration: 0,
        activeDocument: { documentId: 'golden-dashboard-page', fileName: 'agent-runtime-golden-dashboard', index: 0 },
        projectSchema: project,
        commitKind: 'manual-save',
        updatedAt: 1,
        operations: [],
      })
      if (draft.draftGeneration !== 1) throw new Error('Golden seed did not create draft generation 1')
    } finally {
      await coordinator.dispose()
    }
  }, goldenProject)
}

test('Agent Runtime dashboard Golden journey', async ({ context, page }) => {
  await context.route(GOLDEN_HTTP_URL, route =>
    route.fulfill({
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify([
        { name: '08:00', value: 48 },
        { name: '14:00', value: 72 },
        { name: '20:00', value: 61 },
      ]),
    }),
  )
  await test.step('1. open the Golden dashboard and Workspace', async () => {
    await seedGoldenProject(page)
    await page.goto('/')
    await waitForWorkspaceRuntime(page)
    await expect(page.locator('.lc-simulator-content-frame')).toContainText('城市运行态势')
    await openWorkspace(page)
  })

  const initialBinding = (await readProbe(page))?.binding
  if (!initialBinding?.sessionId) throw new Error('Golden initial binding is unavailable')
  const initialBaseRevision = await setToolScriptForNextReload(page, {
    blueprintSummary: 'city dashboard blueprint',
    completionSummary: 'city dashboard completed',
    capability: 'screen.applyChangeSet',
    arguments: {
      schemaVersion: 1,
      documentId: 'golden-dashboard-page',
      operations: [
        {
          opId: 'golden-root-background',
          type: 'set',
          nodeId: 'golden-root',
          fieldId: 'props.backgroundColor',
          value: '#123abc',
        },
        {
          opId: 'golden-title-copy',
          type: 'set',
          nodeId: 'golden-title',
          fieldId: 'props.text',
          value: '城市运行态势驾驶舱',
        },
        {
          opId: 'golden-chart-fallback',
          type: 'set',
          nodeId: 'golden-chart',
          fieldId: 'props.data',
          value: [{ name: 'Agent 规划', value: 88 }],
        },
      ],
    },
  })
  await page.reload()
  const scriptedBinding = (await waitForWorkspaceRuntime(page)).binding
  expect(scriptedBinding).toEqual(initialBinding)
  const workspace = await openWorkspace(page)
  await authorizeProjectWrite(page, workspace)

  let initialTask: WorkspaceTask
  await test.step('2. submit the city-operations dashboard intent', async () => {
    await submitIntent(page, '搭建城市运行态势大屏', '开始搭建')
    initialTask = await waitForTask(page, tasks => tasks.find(task => task.phase === 'COMPLETED'))
    expect(initialTask).toMatchObject({
      intent: '搭建城市运行态势大屏',
      phase: 'COMPLETED',
      blueprint: { summary: 'city dashboard blueprint' },
      completionSummary: 'city dashboard completed',
      compensationEligible: true,
    })
  })

  await test.step('3. preserve the blueprint and existing material layout', async () => {
    await expect(workspace.getByText('搭建蓝图')).toBeVisible()
    await expect(workspace.getByText('city dashboard blueprint')).toBeVisible()
    const layout = await page.evaluate(() => {
      const probe = window.__EASY_EDITOR_E2E__?.getAgentWorkspaceState()
      return import('/src/editor/runtime.ts').then(runtime => {
        const document = runtime.engine.project.currentDocument
        return {
          phase: probe?.snapshot.remote.tasks[0]?.phase,
          title: document?.getNode('golden-title')?.getDashboardRect(),
          map: document?.getNode('golden-map')?.getDashboardRect(),
          chart: document?.getNode('golden-chart')?.getDashboardRect(),
        }
      })
    })
    expect(layout).toMatchObject({
      phase: 'COMPLETED',
      title: { x: 660, y: 32, width: 600, height: 72 },
      map: { x: 540, y: 150, width: 840, height: 760 },
      chart: { x: 1440, y: 180, width: 420, height: 300 },
    })
    expect(initialBaseRevision).toEqual(expect.any(String))
  })

  await test.step('4. upsert and bind deterministic mock plus HTTP data sources', async () => {
    const data = await page.evaluate(
      async ({ binding, publicUrl }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const authority = { ...binding, taskId: 'golden-data-task' }
        const host = runtime.composeDashboardAgentHost(authority)
        if (!host) throw new Error('Golden data Host is unavailable')
        let sequence = 0
        const invoke = async (capability: string, argumentsValue: Record<string, unknown>) => {
          const observed = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
          sequence += 1
          const callId = `golden-data-call-${sequence}`
          const result = await host.invoke(
            {
              schemaVersion: 1,
              ...authority,
              stepId: `golden-data-step-${sequence}`,
              callId,
              capability,
              expectedRevision: observed.revision,
              arguments: argumentsValue,
            },
            { schemaVersion: 1 },
          )
          if (result.status !== 'applied') throw new Error(`Golden data call failed: ${JSON.stringify(result)}`)
          return { callId, observed, result }
        }
        const mockDescriptor = {
          schemaVersion: 1,
          id: 'golden-mock',
          kind: 'mock',
          fixture: { value: '181', total: 181 },
        }
        const httpDescriptor = {
          schemaVersion: 1,
          id: 'golden-http',
          kind: 'public-http-json',
          request: { url: publicUrl, method: 'GET' },
        }
        try {
          const mockPreview = await invoke('data.preview', { schemaVersion: 1, descriptor: mockDescriptor })
          const httpPreview = await invoke('data.preview', { schemaVersion: 1, descriptor: httpDescriptor })
          await invoke('data.upsert', { schemaVersion: 1, descriptor: mockDescriptor })
          await invoke('data.upsert', { schemaVersion: 1, descriptor: httpDescriptor })
          const bindingResult = await invoke('data.bind', {
            schemaVersion: 1,
            nodeId: 'golden-chart',
            field: 'data',
            binding: { sourceId: 'golden-http' },
          })
          await runtime.persistDashboardProject('manual-save')
          await runtime.dashboardPersistence.flush()
          const receipt = await host.queryReceipt({
            schemaVersion: 1,
            ...authority,
            callId: bindingResult.callId,
          })
          const chart = runtime.engine.project.currentDocument?.getNode('golden-chart')?.exportRaw() as
            | { props?: { dataBindings?: unknown } }
            | undefined
          return {
            mockSample: mockPreview.result.output?.preview?.sample,
            httpSample: httpPreview.result.output?.preview?.sample,
            callId: bindingResult.callId,
            revision: bindingResult.result.revision,
            receipt,
            dataBindings: chart?.props?.dataBindings,
          }
        } finally {
          host.dispose()
        }
      },
      { binding: initialBinding, publicUrl: GOLDEN_HTTP_URL },
    )
    expect(data.mockSample).toEqual({ value: '181', total: 181 })
    expect(data.httpSample).toEqual([
      { name: '08:00', value: 48 },
      { name: '14:00', value: 72 },
      { name: '20:00', value: 61 },
    ])
    expect(data.dataBindings).toEqual({ schemaVersion: 1, fields: { data: { sourceId: 'golden-http' } } })
    expect(data.receipt).toMatchObject({ callId: data.callId, status: 'applied', revision: data.revision })
    await settleMaterialGc(page)
    await page.reload()
    await waitForWorkspaceRuntime(page)
    await expect
      .poll(async () =>
        page
          .locator('textarea')
          .evaluateAll(elements =>
            elements.some(element => (element as HTMLTextAreaElement).value.includes('golden-http')),
          ),
      )
      .toBe(true)
  })

  let onlineNodeId = ''
  let onlineArtifactRef: OnlineArtifactRef
  let originalOnlineArtifactRef: OnlineArtifactRef
  await test.step('5. create a browser-native KPI online artifact through the Host', async () => {
    const created = await page.evaluate(
      async ({ binding, source }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const authority = { ...binding, taskId: 'golden-online-create-task' }
        const host = runtime.composeDashboardAgentHost(authority)
        if (!host) throw new Error('Golden online-artifact Host is unavailable')
        try {
          const observed = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
          const callId = 'golden-online-create-call'
          const result = await host.invoke(
            {
              schemaVersion: 1,
              ...authority,
              stepId: 'golden-online-create-step',
              callId,
              capability: 'artifact.createOnline',
              expectedRevision: observed.revision,
              arguments: {
                schemaVersion: 1,
                documentId: 'golden-dashboard-page',
                parentId: 'golden-root',
                position: { place: 'last' },
                rect: { x: 620, y: 180, width: 360, height: 180 },
                props: {
                  label: '城市运行 KPI',
                  dataBindings: { schemaVersion: 1, fields: { data: { sourceId: 'golden-mock' } } },
                  theme: { mode: 'dark', designTokens: { accent: '#38bdf8' } },
                },
                source,
                css: ':host { display: block; width: 100%; height: 100%; }',
                safeManifest: { schemaVersion: 1, displayName: '城市运行 KPI', events: ['activate'] },
                dependencies: [],
              },
            },
            { schemaVersion: 1 },
          )
          if (result.status !== 'applied' || !result.output) {
            throw new Error(`Golden online artifact did not apply: ${JSON.stringify(result)}`)
          }
          const receipt = await host.queryReceipt({ schemaVersion: 1, ...authority, callId })
          await runtime.dashboardPersistence.flush()
          return { observed, result, receipt }
        } finally {
          host.dispose()
        }
      },
      { binding: initialBinding, source: GOLDEN_ONLINE_SOURCE },
    )
    onlineNodeId = created.result.output.nodeId
    onlineArtifactRef = created.result.output.artifactRef as OnlineArtifactRef
    originalOnlineArtifactRef = onlineArtifactRef
    expect(onlineNodeId).toMatch(/^generated-node-/u)
    expect(onlineArtifactRef).toMatchObject({ target: { kind: 'online' } })
    expect(created.result.revision).not.toBe(created.observed.revision)
    expect(created.receipt).toMatchObject({ callId: 'golden-online-create-call', status: 'applied' })
  })

  await test.step('6. render the shared editor iframe with data, theme, size, and trusted click-through', async () => {
    await expect(page.locator(`iframe[data-online-component-sandbox="${EDITOR_SURFACE_ID}"]`)).toHaveCount(1)
    const instance = sandboxInstance(page, 'editor', onlineNodeId)
    await expect(instance).toHaveAttribute('data-rendered-label', '城市运行 KPI')
    await expect(instance).toHaveAttribute('data-rendered-data-value', '181')
    await expect(instance).toHaveAttribute('data-rendered-data-total', '181')
    await expect(instance).toHaveAttribute('data-rendered-theme', 'dark')
    await expect(instance).toHaveAttribute('data-rendered-width', '360')
    await expect(instance).toHaveAttribute('data-rendered-height', '180')
    await expect(instance).toHaveAttribute('data-source-revision', GOLDEN_ONLINE_SOURCE_REVISION)
    await page.locator(`[data-online-component-shell="${onlineNodeId}"]`).click()
    await expect
      .poll(() =>
        page.evaluate(async nodeId => {
          const runtime = await import('/src/editor/runtime.ts')
          return runtime.engine.designer.selection.has(nodeId)
        }, onlineNodeId),
      )
      .toBe(true)
  })

  let humanRect: Readonly<{ x: number; y: number; width: number; height: number }>
  await test.step('7. reject a stale prepared call, reobserve, and preserve the human move', async () => {
    const prepared = await page.evaluate(
      async ({ binding }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const authority = { ...binding, taskId: 'golden-stale-task' }
        const host = runtime.composeDashboardAgentHost(authority)
        if (!host) throw new Error('Golden stale-check Host is unavailable')
        try {
          return await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
        } finally {
          host.dispose()
        }
      },
      { binding: initialBinding },
    )
    const beforeHumanMove = await page.evaluate(nodeId => {
      return import('/src/editor/runtime.ts').then(runtime => {
        const rect = runtime.engine.project.currentDocument?.getNode(nodeId)?.getDashboardRect()
        if (!rect) throw new Error('Golden online node has no rect before human move')
        return rect
      })
    }, onlineNodeId)
    await page.keyboard.down('Shift')
    try {
      await dragEditorShell(page, onlineNodeId, { x: 80, y: 50 })
      await persistEditorDraft(page)
    } finally {
      await page.keyboard.up('Shift')
    }
    const stale = await page.evaluate(
      async ({ binding, nodeId, preparedRevision }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const authority = { ...binding, taskId: 'golden-stale-task' }
        const host = runtime.composeDashboardAgentHost(authority)
        if (!host) throw new Error('Golden stale-check Host is unavailable')
        try {
          const rejected = await host.invoke(
            {
              schemaVersion: 1,
              ...authority,
              stepId: 'golden-stale-step',
              callId: 'golden-stale-call',
              capability: 'screen.inspect',
              expectedRevision: preparedRevision,
              arguments: { nodeIds: [nodeId] },
            },
            { schemaVersion: 1 },
          )
          const reobserved = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
          const retried = await host.invoke(
            {
              schemaVersion: 1,
              ...authority,
              stepId: 'golden-reobserve-step',
              callId: 'golden-reobserve-call',
              capability: 'screen.inspect',
              expectedRevision: reobserved.revision,
              arguments: { nodeIds: [nodeId] },
            },
            { schemaVersion: 1 },
          )
          const rect = runtime.engine.project.currentDocument?.getNode(nodeId)?.getDashboardRect()
          if (!rect) throw new Error('Golden online node has no rect after human move')
          return { rejected, reobserved, retried, rect }
        } finally {
          host.dispose()
        }
      },
      { binding: initialBinding, nodeId: onlineNodeId, preparedRevision: prepared.revision },
    )
    humanRect = stale.rect
    expect(stale.rejected).toMatchObject({ status: 'rejected', failure: { code: 'STALE_REVISION' } })
    expect(stale.reobserved.revision).not.toBe(prepared.revision)
    expect(stale.retried).toMatchObject({ status: 'applied', revision: stale.reobserved.revision })
    expect(humanRect).toMatchObject({ width: beforeHumanMove.width, height: beforeHumanMove.height })
    expect({ x: humanRect.x, y: humanRect.y }).not.toEqual({ x: beforeHumanMove.x, y: beforeHumanMove.y })
  })

  let version: WorkspaceProbe['snapshot']['remote']['versions'][number]
  await test.step('8. create a checkpoint and named version 城市运行-v1', async () => {
    const versionWorkspace = await openWorkspace(page)
    await versionWorkspace.getByRole('tab', { name: '版本' }).click()
    await page.locator('#agent-workspace-version-name').fill(GOLDEN_VERSION_NAME)
    await versionWorkspace.getByRole('button', { name: '保存版本' }).click()
    await expect.poll(async () => (await readProbe(page))?.snapshot.remote.versions.length ?? 0).toBe(1)
    const found = (await readProbe(page))?.snapshot.remote.versions[0]
    if (!found) throw new Error('Golden named version is unavailable')
    version = found
    expect(version).toMatchObject({
      name: GOLDEN_VERSION_NAME,
      sourceBranchId: initialBinding.branchId,
      sourceSessionId: initialBinding.sessionId,
      sourceTaskId: initialTask.taskId,
    })
  })

  let followUp: WorkspaceTask
  await test.step('9. run a same-session follow-up with durable parent lineage', async () => {
    await settleMaterialGc(page)
    await page.reload()
    const normalizedFollowUpBinding = (await waitForWorkspaceRuntime(page)).binding
    expect(normalizedFollowUpBinding).toEqual(initialBinding)
    await settleMaterialGc(page)
    const followUpBaseRevision = await setToolScriptForNextReload(page, {
      blueprintSummary: 'KPI follow-up blueprint',
      completionSummary: 'KPI follow-up completed',
      capability: 'artifact.reviseOnline',
      arguments: {
        schemaVersion: 1,
        nodeId: onlineNodeId,
        source: GOLDEN_FOLLOW_UP_SOURCE,
        css: ':host { display: block; width: 100%; height: 100%; }',
        safeManifest: { schemaVersion: 1, displayName: '城市运行 KPI v2', events: ['activate'] },
        dependencies: [],
      },
    })
    await page.reload()
    const followUpBinding = (await waitForWorkspaceRuntime(page)).binding
    expect(followUpBinding).toEqual(initialBinding)
    const followUpWorkspace = await openWorkspace(page)
    await followUpWorkspace.getByRole('tab', { name: '任务' }).click()
    await submitIntent(page, '补充城市 KPI 与运行信号', '继续搭建')
    await expect.poll(async () => (await readProbe(page))?.snapshot.remote.tasks.length ?? 0).toBeGreaterThan(1)
    followUp = await waitForTask(page, tasks =>
      tasks.find(task => task.taskId !== initialTask.taskId && task.phase === 'COMPLETED'),
    )
    expect(followUp).toMatchObject({
      parentTaskId: initialTask.taskId,
      blueprint: { summary: 'KPI follow-up blueprint' },
      completionSummary: 'KPI follow-up completed',
      compensationEligible: true,
    })
    const durable = await page.evaluate(async binding => {
      const runtime = await import('/src/editor/runtime.ts')
      const journal = await runtime.dashboardPersistence.readAgentPersistence({
        schemaVersion: 1,
        ...binding,
        expectedPersistenceGeneration: 0,
      })
      const records = journal.records
        .filter(record => record.kind === 'agent-runtime-task')
        .map(record => ({ recordId: record.recordId, value: record.value }))
      const callIds = records.flatMap(record =>
        Array.isArray(record.value.callIds) ? record.value.callIds.filter(value => typeof value === 'string') : [],
      )
      const receipts = []
      for (const callId of callIds) {
        const taskRecord = records.find(record =>
          Array.isArray(record.value.callIds) ? record.value.callIds.includes(callId) : false,
        )
        const taskId = String(taskRecord?.recordId.slice('task:'.length) ?? '')
        const host = runtime.composeDashboardAgentHost({ ...binding, taskId })
        if (!host) throw new Error('Golden receipt Host is unavailable')
        try {
          receipts.push(await host.queryReceipt({ schemaVersion: 1, ...binding, taskId, callId }))
        } finally {
          host.dispose()
        }
      }
      return { records, receipts }
    }, initialBinding)
    expect(durable.records.map(record => record.recordId).sort()).toEqual(
      [`task:${initialTask.taskId}`, `task:${followUp.taskId}`].sort(),
    )
    expect(durable.records.every(record => record.value.sessionId === initialBinding.sessionId)).toBe(true)
    expect(durable.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordId: `task:${initialTask.taskId}`,
          value: expect.objectContaining({
            callIndex: [expect.objectContaining({ capability: 'screen.applyChangeSet' })],
          }),
        }),
        expect.objectContaining({
          recordId: `task:${followUp.taskId}`,
          value: expect.objectContaining({
            callIndex: [expect.objectContaining({ capability: 'artifact.reviseOnline' })],
          }),
        }),
      ]),
    )
    expect(durable.receipts).toHaveLength(2)
    expect(durable.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'applied', witness: expect.any(Object) }),
        expect.objectContaining({ status: 'applied', witness: expect.any(Object) }),
      ]),
    )
    expect(followUpBaseRevision).toEqual(expect.any(String))
    onlineArtifactRef = await page.evaluate(nodeId => {
      return import('/src/editor/runtime.ts').then(runtime => {
        const raw = runtime.engine.project.currentDocument?.getNode(nodeId)?.exportRaw() as
          | { $agent?: { artifactRef?: OnlineArtifactRef } }
          | undefined
        if (!raw?.$agent?.artifactRef) throw new Error('Golden revised artifact ref is unavailable')
        return raw.$agent.artifactRef
      })
    }, onlineNodeId)
    expect(onlineArtifactRef.sourceRevision).not.toBe(originalOnlineArtifactRef.sourceRevision)
  })

  await test.step('10. reload the editor and recover task ancestry plus persistence', async () => {
    await settleMaterialGc(page)
    await page.reload()
    const recovered = await waitForWorkspaceRuntime(page)
    expect(recovered.binding).toEqual(initialBinding)
    expect(recovered.snapshot.remote.tasks.map(task => task.taskId)).toEqual([initialTask.taskId, followUp.taskId])
    expect(recovered.snapshot.remote.tasks[1]?.parentTaskId).toBe(initialTask.taskId)
    await expect(page.locator('.lc-simulator-content-frame')).toContainText('城市运行态势驾驶舱')
    await expect(sandboxInstance(page, 'editor', onlineNodeId)).toHaveAttribute(
      'data-source-revision',
      GOLDEN_FOLLOW_UP_SOURCE_REVISION,
    )
    const recoveredNode = await page.evaluate(nodeId => {
      return import('/src/editor/runtime.ts').then(runtime => {
        const node = runtime.engine.project.currentDocument?.getNode(nodeId)
        const raw = node?.exportRaw() as
          | { props?: Record<string, unknown>; $agent?: { artifactRef?: OnlineArtifactRef } }
          | undefined
        return { rect: node?.getDashboardRect(), props: raw?.props, artifactRef: raw?.$agent?.artifactRef }
      })
    }, onlineNodeId)
    expect(recoveredNode.rect).toMatchObject(humanRect)
    expect(recoveredNode.artifactRef).toEqual(onlineArtifactRef)
  })

  let preview: Page
  await test.step('11. render and reload the standalone preview without design shells', async () => {
    preview = await context.newPage()
    await preview.goto('/preview')
    await expect(preview.locator('.lc-editor-canvas')).toBeVisible()
    await expect(preview.locator('.lc-designer')).toHaveCount(0)
    await expect(preview.getByTestId('agent-workspace-toggle')).toHaveCount(0)
    await expect(preview.locator(`iframe[data-online-component-sandbox="${PREVIEW_SURFACE_ID}"]`)).toHaveCount(1)
    await expect(sandboxInstance(preview, 'preview', onlineNodeId)).toHaveAttribute(
      'data-source-revision',
      GOLDEN_FOLLOW_UP_SOURCE_REVISION,
    )
    await expect(sandboxInstance(preview, 'preview', onlineNodeId)).toHaveAttribute('data-rendered-data-value', '181')
    await preview.evaluate(() => {
      const target = window as Window & { __GOLDEN_ACTIVATIONS__?: unknown[] }
      target.__GOLDEN_ACTIVATIONS__ = []
      window.addEventListener('easy-editor:online-component-runtime-event', event => {
        target.__GOLDEN_ACTIVATIONS__?.push((event as CustomEvent).detail)
      })
    })
    await preview.locator(`[data-online-component-shell="${onlineNodeId}"]`).click()
    await expect
      .poll(() =>
        preview.evaluate(
          () => (window as Window & { __GOLDEN_ACTIVATIONS__?: unknown[] }).__GOLDEN_ACTIVATIONS__ ?? [],
        ),
      )
      .toEqual([
        {
          schemaVersion: 1,
          surfaceId: PREVIEW_SURFACE_ID,
          instanceId: onlineNodeId,
          type: 'activate',
          payload: null,
        },
      ])
    await preview.reload()
    await expect(sandboxInstance(preview, 'preview', onlineNodeId)).toHaveAttribute(
      'data-source-revision',
      GOLDEN_FOLLOW_UP_SOURCE_REVISION,
    )
    await expect(preview.locator('.lc-designer')).toHaveCount(0)
  })

  let compensationTask: WorkspaceTask
  await test.step('12. preserve current state when call-level compensation finds a post-image conflict', async () => {
    await page.keyboard.down('Shift')
    try {
      await page.evaluate(async () => {
        const runtime = await import('/src/editor/runtime.ts')
        const document = runtime.engine.project.currentDocument
        if (!document) throw new Error('Golden document is unavailable before human title edit')
        runtime.engine.transactions.runOnDocument(
          document,
          [
            {
              type: 'updateProps',
              documentId: document.id,
              nodeId: 'golden-title',
              props: { text: '客户人工确认标题' },
            },
          ],
          { expectedMutationVersion: document.mutationVersion },
        )
        await runtime.persistDashboardProject('manual-save')
        await runtime.dashboardPersistence.flush()
      })
    } finally {
      await page.keyboard.up('Shift')
    }
    const compensationWorkspace = await openWorkspace(page)
    await compensationWorkspace.getByRole('tab', { name: '任务' }).click()
    const initialTaskCard = compensationWorkspace.getByRole('listitem').filter({ hasText: '搭建城市运行态势大屏' })
    await initialTaskCard.getByRole('button', { name: '补偿此任务' }).click()
    compensationTask = await waitForTask(page, tasks =>
      tasks.find(
        task =>
          task.taskId !== initialTask.taskId &&
          task.parentTaskId === initialTask.taskId &&
          task.intent === `Compensate task ${initialTask.taskId}` &&
          task.phase === 'COMPLETED',
      ),
    )
    const compensated = await page.evaluate(
      async ({ binding, compensationTaskId, onlineNodeId }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const document = runtime.engine.project.currentDocument
        if (!document) throw new Error('Golden document is unavailable after compensation')
        const journal = await runtime.dashboardPersistence.readAgentPersistence({
          schemaVersion: 1,
          ...binding,
          expectedPersistenceGeneration: 0,
        })
        const record = journal.records.find(candidate => candidate.recordId === `task:${compensationTaskId}`)
        const callId = Array.isArray(record?.value.callIds) ? record.value.callIds[0] : null
        if (typeof callId !== 'string') throw new Error('Golden compensation callId is unavailable')
        const run = await runtime.dashboardPersistence.readCompensationRun({
          schemaVersion: 1,
          ...binding,
          outerCallId: callId,
        })
        const chart = document.getNode('golden-chart')?.exportRaw() as { props?: Record<string, unknown> } | undefined
        const online = document.getNode(onlineNodeId)?.exportRaw() as
          | { $agent?: { artifactRef?: OnlineArtifactRef } }
          | undefined
        return {
          title: document.getNode('golden-title')?.getPropValue('text'),
          background: document.root.getPropValue('backgroundColor'),
          chartProps: chart?.props,
          artifactRef: online?.$agent?.artifactRef,
          callId,
          record,
          run,
        }
      },
      { binding: initialBinding, compensationTaskId: compensationTask.taskId, onlineNodeId },
    )
    expect(compensated.title).toBe('客户人工确认标题')
    expect(compensated.background).toBe('#123abc')
    expect(compensated.chartProps?.data).toEqual([{ name: 'Agent 规划', value: 88 }])
    expect(compensated.chartProps?.dataBindings).toEqual({
      schemaVersion: 1,
      fields: { data: { sourceId: 'golden-http' } },
    })
    expect(compensated.artifactRef).toEqual(onlineArtifactRef)
    expect(compensated.record?.value).toMatchObject({
      compensatesTaskId: initialTask.taskId,
      callIndex: [{ callId: compensated.callId, capability: 'task.compensate' }],
    })
    expect(compensated.run).toMatchObject({
      taskId: initialTask.taskId,
      cursor: 1,
      status: 'completed-with-conflicts',
      conflicts: [expect.objectContaining({ code: 'POST_IMAGE_CHANGED' })],
    })
    await expect(compensationWorkspace.getByText('任务补偿遇到人工修改')).toBeVisible()
    await preview.close()
  })

  let forkBinding: Required<WorkspaceProbe['binding']>
  let restoredOnlineArtifactRef: OnlineArtifactRef
  await test.step('13. restore the named version into an isolated branch and session', async () => {
    const oldProbe = await readProbe(page)
    const oldTaskIds = oldProbe?.snapshot.remote.tasks.map(task => task.taskId) ?? []
    const recoveredWorkspace = await openWorkspace(page)
    await recoveredWorkspace.getByRole('tab', { name: '版本' }).click()
    await recoveredWorkspace.getByRole('button', { name: '恢复到新分支' }).click()
    await expect
      .poll(async () => {
        const probe = await readProbe(page)
        return probe ? `${probe.binding.branchId}\u0000${probe.binding.sessionId ?? ''}` : null
      })
      .not.toBe(`${initialBinding.branchId}\u0000${initialBinding.sessionId}`)

    const fork = await waitForWorkspaceRuntime(page)
    forkBinding = fork.binding as Required<WorkspaceProbe['binding']>
    expect(forkBinding.projectId).toBe(initialBinding.projectId)
    expect(forkBinding.branchId).not.toBe(initialBinding.branchId)
    expect(forkBinding.sessionId).not.toBe(initialBinding.sessionId)
    expect(fork.snapshot.remote.tasks).toEqual([])
    expect(fork.snapshot.pendingAction ?? null).toBeNull()
    expect(fork.snapshot.remote.versions[0]).toMatchObject({
      versionId: version.versionId,
      sourceBranchId: initialBinding.branchId,
      sourceSessionId: initialBinding.sessionId,
      sourceTaskId: initialTask.taskId,
    })
    expect(oldTaskIds).toEqual([initialTask.taskId, followUp.taskId, compensationTask.taskId])

    const forkEvidence = await page.evaluate(
      async ({ binding, nodeId }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const journal = await runtime.dashboardPersistence.readAgentPersistence({
          schemaVersion: 1,
          ...binding,
          expectedPersistenceGeneration: 0,
        })
        const observerTaskId = 'golden-fork-observer'
        const host = runtime.composeDashboardAgentHost({ ...binding, taskId: observerTaskId })
        if (!host) throw new Error('Golden fork Host is unavailable')
        try {
          const observed = await host.observe({ schemaVersion: 1, ...binding, taskId: observerTaskId, mode: 'full' })
          const node = runtime.engine.project.currentDocument?.getNode(nodeId)
          const raw = node?.exportRaw() as
            | { props?: Record<string, unknown>; $agent?: { artifactRef?: OnlineArtifactRef } }
            | undefined
          return {
            journal,
            cursor: observed.cursor,
            node: { rect: node?.getDashboardRect(), props: raw?.props, artifactRef: raw?.$agent?.artifactRef },
          }
        } finally {
          host.dispose()
        }
      },
      { binding: forkBinding, nodeId: onlineNodeId },
    )
    expect(forkEvidence.journal.records).toEqual([])
    expect(forkEvidence.cursor).toEqual(expect.any(String))
    expect(forkEvidence.node.rect).toMatchObject(humanRect)
    expect(forkEvidence.node.props?.label).toBe('城市运行 KPI')
    expect(forkEvidence.node.artifactRef).toEqual(originalOnlineArtifactRef)
    restoredOnlineArtifactRef = forkEvidence.node.artifactRef as OnlineArtifactRef
    await expect(sandboxInstance(page, 'editor', onlineNodeId)).toHaveAttribute(
      'data-source-revision',
      GOLDEN_ONLINE_SOURCE_REVISION,
    )
  })

  let localArtifactRef: LocalMaterialArtifactRef
  let durableCopyId = ''
  await test.step('14. promote the restored online component and add a second instance from the palette', async () => {
    const promotionWorkspace = await openWorkspace(page)
    await authorizeScope(page, promotionWorkspace, '修改当前项目', 'project.write')
    await authorizeScope(page, promotionWorkspace, '发布自定义物料', 'material.promote.local')
    await closeWorkspace(promotionWorkspace)

    const beforePromotion = await page.evaluate(nodeId => {
      return import('/src/editor/runtime.ts').then(runtime => {
        const node = runtime.engine.project.currentDocument?.getNode(nodeId)
        if (!node) throw new Error('Golden online node is unavailable before promotion')
        const raw = node.exportRaw() as Record<string, unknown>
        return {
          props: structuredClone((raw.props ?? {}) as Record<string, unknown>),
          dashboard: structuredClone((raw.$dashboard ?? {}) as Record<string, unknown>),
          parentId: node.parent?.id ?? null,
          index: node.index,
          siblingOrder: node.parent?.childrenNodes.map(sibling => sibling.id) ?? [node.id],
        }
      })
    }, onlineNodeId)

    const promotion = (await page.evaluate(
      async ({ authority, binding, nodeId }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const taskId = 'golden-promotion-task'
        const stepId = 'golden-promotion-step'
        const callId = 'golden-promote-local-call'
        const host = runtime.composeDashboardAgentHost({ ...binding, taskId }, authority)
        if (!host) throw new Error('Golden promotion Host is unavailable')
        try {
          const observed = await host.observe({ schemaVersion: 1, ...binding, taskId, mode: 'full' })
          const capability = await host.describeCapability({
            schemaVersion: 1,
            projectId: binding.projectId,
            branchId: binding.branchId,
            capability: 'artifact.promoteLocal',
          })
          const result = await host.invoke(
            {
              schemaVersion: 1,
              ...binding,
              taskId,
              stepId,
              callId,
              capability: 'artifact.promoteLocal',
              expectedRevision: observed.revision,
              arguments: { schemaVersion: 1, nodeId },
            },
            { schemaVersion: 1 },
          )
          if (result.status !== 'applied' || !result.output) {
            throw new Error(`Golden promotion did not apply: ${JSON.stringify(result)}`)
          }
          const receipt = await host.queryReceipt({ schemaVersion: 1, ...binding, taskId, callId })
          const journal = await runtime.dashboardPersistence.readAgentPersistence({
            schemaVersion: 1,
            ...binding,
            expectedPersistenceGeneration: 0,
          })
          return {
            capability,
            result,
            receipt,
            promotionJournal: journal.records.find(record => record.recordId === `promotion:${callId}`) ?? null,
          }
        } finally {
          host.dispose()
        }
      },
      { authority: LOCAL_MATERIAL_E2E_GRANT_AUTHORITY, binding: forkBinding, nodeId: onlineNodeId },
    )) as {
      capability: Readonly<{ revision: string }>
      result: Readonly<{ status: 'applied'; revision: string; output: { artifactRef: LocalMaterialArtifactRef } }>
      receipt: Readonly<Record<string, unknown>> | null
      promotionJournal: Readonly<{ recordId: string; kind: string; value: Record<string, unknown> }> | null
    }

    localArtifactRef = promotion.result.output.artifactRef
    const materialIdentity: MaterialIdentity = {
      materialId: localArtifactRef.target.materialId,
      materialVersion: localArtifactRef.target.materialVersion,
      buildIntegrity: localArtifactRef.target.buildIntegrity,
    }
    expect(promotion.capability.revision).toBe('artifact.promoteLocal/1')
    expect(localArtifactRef).toMatchObject({
      artifactId: restoredOnlineArtifactRef.artifactId,
      sourceRevision: restoredOnlineArtifactRef.sourceRevision,
      logicalComponentId: restoredOnlineArtifactRef.logicalComponentId,
      sourceIntegrity: restoredOnlineArtifactRef.sourceIntegrity,
      target: {
        kind: 'local-material',
        materialId: expect.stringMatching(/^local-material-[\da-f]{64}$/u),
        materialVersion: expect.stringMatching(/^local-version-[\da-f]{64}$/u),
        buildIntegrity: expect.stringMatching(/^sha256:[\da-f]{64}$/u),
      },
      rollbackTo: {
        artifactId: restoredOnlineArtifactRef.artifactId,
        sourceRevision: restoredOnlineArtifactRef.sourceRevision,
        logicalComponentId: restoredOnlineArtifactRef.logicalComponentId,
        sourceIntegrity: restoredOnlineArtifactRef.sourceIntegrity,
      },
    })
    expect(promotion.receipt).toMatchObject({
      projectId: forkBinding.projectId,
      branchId: forkBinding.branchId,
      callId: 'golden-promote-local-call',
      status: 'applied',
      revision: promotion.result.revision,
    })
    expect(promotion.promotionJournal).toMatchObject({
      recordId: 'promotion:golden-promote-local-call',
      kind: 'local-material-promotion',
      value: {
        stage: 'committed',
        output: { artifactRef: localArtifactRef },
      },
    })

    const afterPromotion = await page.evaluate(nodeId => {
      return import('/src/editor/runtime.ts').then(runtime => {
        const node = runtime.engine.project.currentDocument?.getNode(nodeId)
        if (!node) throw new Error('Golden online node is unavailable after promotion')
        const raw = node.exportRaw() as Record<string, unknown>
        return {
          props: structuredClone((raw.props ?? {}) as Record<string, unknown>),
          dashboard: structuredClone((raw.$dashboard ?? {}) as Record<string, unknown>),
          artifactRef: (raw.$agent as { artifactRef?: LocalMaterialArtifactRef } | undefined)?.artifactRef,
          parentId: node.parent?.id ?? null,
          index: node.index,
          siblingOrder: node.parent?.childrenNodes.map(sibling => sibling.id) ?? [node.id],
        }
      })
    }, onlineNodeId)
    expect(afterPromotion).toMatchObject({
      props: beforePromotion.props,
      dashboard: beforePromotion.dashboard,
      artifactRef: localArtifactRef,
      parentId: beforePromotion.parentId,
      index: beforePromotion.index,
      siblingOrder: beforePromotion.siblingOrder,
    })
    await expectSurfaceInstances(page, 'editor', [onlineNodeId])

    await expect
      .poll(() =>
        page.evaluate(async expectedArtifactRef => {
          const runtime = await import('/src/editor/runtime.ts')
          const snapshot = runtime.dashboardLocalMaterialCatalogRuntime.getSnapshot()
          return (
            snapshot.status === 'ready' &&
            snapshot.materials.some(
              material =>
                material.availability === 'available' &&
                material.artifactRef.target.materialId === expectedArtifactRef.target.materialId &&
                material.artifactRef.target.materialVersion === expectedArtifactRef.target.materialVersion &&
                material.artifactRef.target.buildIntegrity === expectedArtifactRef.target.buildIntegrity,
            )
          )
        }, localArtifactRef),
      )
      .toBe(true)

    const durableMaterialCard = await openDurableMaterialCard(page, materialIdentity)
    await dragDurableMaterialIntoCanvas(page, durableMaterialCard)
    durableCopyId = await page.evaluate(
      async ({ beforeIds, expectedArtifactRef, primaryId }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const primary = runtime.engine.project.currentDocument?.getNode(primaryId)
        if (!primary?.parent) throw new Error('Golden primary node authority is unavailable after palette drag')
        const candidates = primary.parent.childrenNodes.filter(node => {
          if (beforeIds.includes(node.id) || node.componentName !== 'GeneratedMaterialHost') return false
          const raw = node.exportRaw() as { $agent?: { artifactRef?: LocalMaterialArtifactRef } }
          const artifactRef = raw.$agent?.artifactRef
          return (
            artifactRef?.target.materialId === expectedArtifactRef.target.materialId &&
            artifactRef.target.materialVersion === expectedArtifactRef.target.materialVersion &&
            artifactRef.target.buildIntegrity === expectedArtifactRef.target.buildIntegrity
          )
        })
        if (candidates.length !== 1) {
          throw new Error(`Golden palette drag created ${candidates.length} matching nodes`)
        }
        return candidates[0].id
      },
      {
        beforeIds: beforePromotion.siblingOrder,
        expectedArtifactRef: localArtifactRef,
        primaryId: onlineNodeId,
      },
    )
    const durableCopy = await page.evaluate(
      async ({ copyId, primaryId }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const document = runtime.engine.project.currentDocument
        const primary = document?.getNode(primaryId)
        const copy = document?.getNode(copyId)
        if (!document || !primary?.parent || !copy || copy.parent !== primary.parent) {
          throw new Error('Golden palette-created node authority is unavailable')
        }
        const primaryRaw = primary.exportRaw() as Record<string, unknown>
        const copyRaw = copy.exportRaw() as Record<string, unknown>
        const copyProps = {
          ...structuredClone((primaryRaw.props ?? {}) as Record<string, unknown>),
          label: '城市运行 KPI 复制',
        }
        const copyRect = { x: 1040, y: 420, width: 320, height: 180 }
        runtime.engine.transactions.runOnDocument(
          document,
          [
            {
              type: 'updateProps',
              documentId: document.id,
              nodeId: copyId,
              props: copyProps,
              extras: { $dashboard: { ...((copyRaw.$dashboard ?? {}) as Record<string, unknown>), rect: copyRect } },
            },
            {
              type: 'moveNode',
              documentId: document.id,
              nodeId: copyId,
              parentId: primary.parent.id,
              at: primary.index + 1,
            },
          ],
          { expectedMutationVersion: document.mutationVersion },
        )
        await runtime.persistDashboardProject('manual-save')
        await runtime.dashboardPersistence.flush()
        const raw = copy.exportRaw() as Record<string, unknown>
        return {
          componentName: copy.componentName,
          props: raw.props,
          dashboard: raw.$dashboard,
          artifactRef: (raw.$agent as { artifactRef?: LocalMaterialArtifactRef } | undefined)?.artifactRef,
          parentId: copy.parent?.id ?? null,
          selected: runtime.engine.designer.selection.has(copyId),
        }
      },
      { copyId: durableCopyId, primaryId: onlineNodeId },
    )
    expect(durableCopy).toMatchObject({
      componentName: 'GeneratedMaterialHost',
      props: { label: '城市运行 KPI 复制' },
      dashboard: { rect: { x: 1040, y: 420, width: 320, height: 180 } },
      artifactRef: localArtifactRef,
      parentId: beforePromotion.parentId,
      selected: true,
    })
  })

  await test.step('15. reload both surfaces and switch only the primary back to its online rollback target', async () => {
    await settleMaterialGc(page)
    await page.reload()
    expect((await waitForWorkspaceRuntime(page)).binding).toEqual(forkBinding)
    await expectSurfaceInstances(page, 'editor', [onlineNodeId, durableCopyId])
    expect(await readNodeArtifactRefs(page, [onlineNodeId, durableCopyId])).toEqual({
      [onlineNodeId]: localArtifactRef,
      [durableCopyId]: localArtifactRef,
    })

    const durablePreview = await context.newPage()
    await durablePreview.goto('/preview')
    await expect(durablePreview.locator('.lc-designer')).toHaveCount(0)
    await expect(durablePreview.getByTestId('agent-workspace-toggle')).toHaveCount(0)
    await expectSurfaceInstances(durablePreview, 'preview', [onlineNodeId, durableCopyId])
    expect(await readPersistedNodeArtifactRefs(durablePreview, [onlineNodeId, durableCopyId])).toEqual({
      [onlineNodeId]: localArtifactRef,
      [durableCopyId]: localArtifactRef,
    })

    const rollbackArtifactRef: OnlineArtifactRef = { ...localArtifactRef.rollbackTo, target: { kind: 'online' } }
    await page.evaluate(
      async ({ artifactRef, nodeId }) => {
        const runtime = await import('/src/editor/runtime.ts')
        const document = runtime.engine.project.currentDocument
        const node = document?.getNode(nodeId)
        if (!document || !node) throw new Error('Golden primary node is unavailable for online rollback')
        const raw = node.exportRaw() as Record<string, unknown>
        runtime.engine.transactions.runOnDocument(
          document,
          [
            {
              type: 'updateProps',
              documentId: document.id,
              nodeId,
              extras: {
                $agent: {
                  ...((raw.$agent ?? {}) as Record<string, unknown>),
                  schemaVersion: 1,
                  artifactRef,
                },
              },
            },
          ],
          { expectedMutationVersion: document.mutationVersion },
        )
        await runtime.persistDashboardProject('manual-save')
        await runtime.dashboardPersistence.flush()
      },
      { artifactRef: rollbackArtifactRef, nodeId: onlineNodeId },
    )
    expect(await readNodeArtifactRefs(page, [onlineNodeId, durableCopyId])).toEqual({
      [onlineNodeId]: rollbackArtifactRef,
      [durableCopyId]: localArtifactRef,
    })
    await expect(sandboxInstance(page, 'editor', onlineNodeId)).toHaveAttribute(
      'data-source-revision',
      GOLDEN_ONLINE_SOURCE_REVISION,
    )
    await expect(sandboxInstance(page, 'editor', durableCopyId)).toHaveAttribute(
      'data-source-revision',
      GOLDEN_ONLINE_SOURCE_REVISION,
    )

    await durablePreview.reload()
    await expectSurfaceInstances(durablePreview, 'preview', [onlineNodeId, durableCopyId])
    expect(await readPersistedNodeArtifactRefs(durablePreview, [onlineNodeId, durableCopyId])).toEqual({
      [onlineNodeId]: rollbackArtifactRef,
      [durableCopyId]: localArtifactRef,
    })

    await settleMaterialGc(page)
    await page.reload()
    expect((await waitForWorkspaceRuntime(page)).binding).toEqual(forkBinding)
    await expectSurfaceInstances(page, 'editor', [onlineNodeId, durableCopyId])
    expect(await readNodeArtifactRefs(page, [onlineNodeId, durableCopyId])).toEqual({
      [onlineNodeId]: rollbackArtifactRef,
      [durableCopyId]: localArtifactRef,
    })
    await durablePreview.reload()
    await expectSurfaceInstances(durablePreview, 'preview', [onlineNodeId, durableCopyId])
    expect(await readPersistedNodeArtifactRefs(durablePreview, [onlineNodeId, durableCopyId])).toEqual({
      [onlineNodeId]: rollbackArtifactRef,
      [durableCopyId]: localArtifactRef,
    })
    await durablePreview.close()
  })
})
