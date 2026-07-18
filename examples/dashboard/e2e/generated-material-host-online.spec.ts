import { type Page, expect, test } from '@playwright/test'
import {
  GENERATED_MATERIAL_ARTIFACT_ID,
  GENERATED_MATERIAL_BRANCH_ID,
  GENERATED_MATERIAL_INSTANCE_COUNT,
  GENERATED_MATERIAL_INSTANCE_IDS,
  GENERATED_MATERIAL_ORDINARY_ID,
  GENERATED_MATERIAL_ORDINARY_TEXT,
  GENERATED_MATERIAL_PRIMARY_ASSET_HANDLE,
  GENERATED_MATERIAL_PRIMARY_ID,
  GENERATED_MATERIAL_PROJECT_ID,
  GENERATED_MATERIAL_RESOLVED_DATA_VALUE,
  GENERATED_MATERIAL_REVISED_SOURCE_REVISION,
  GENERATED_MATERIAL_SOURCE_REVISION,
  GENERATED_MATERIAL_THEME_MODE,
  GENERATED_MATERIAL_THEME_TOKEN,
  GENERATED_MATERIAL_UPDATED_LABEL,
  type GeneratedMaterialArtifactRef,
  seedGeneratedMaterialProject,
} from './fixtures/generated-material-host'

const RUNTIME_EVENT = 'easy-editor:online-component-runtime-event'
const EDITOR_SURFACE_ID = 'dashboard-editor-online'
const PREVIEW_SURFACE_ID = 'dashboard-preview-online'

type SurfaceMode = 'editor' | 'preview'

interface SurfaceMetrics {
  readonly contentZIndex: number
  readonly devicePixelRatio: number
  readonly iframePointerEvents: string
  readonly mountZIndex: number
  readonly shell: Readonly<{ height: number; left: number; top: number; width: number; zIndex: number }>
  readonly anchor: Readonly<{ height: number; left: number; top: number; width: number }>
  readonly toolsZIndex: number | null
}

interface DashboardRect {
  readonly height: number
  readonly width: number
  readonly x: number
  readonly y: number
}

interface SurfaceClipSnapshot {
  readonly inlineWidth: string
  readonly overflowX: string
  readonly overflowY: string
  readonly viewportInlineLeft: string
}

const surfaceIdFor = (mode: SurfaceMode) => (mode === 'editor' ? EDITOR_SURFACE_ID : PREVIEW_SURFACE_ID)

const surfaceMount = (page: Page, mode: SurfaceMode) =>
  page.locator(`[data-easy-editor-surface-overlay-mount="${mode}"]`)

const surfaceShell = (page: Page, instanceId: string) => page.locator(`[data-online-component-shell="${instanceId}"]`)

const sandboxFrame = (page: Page, mode: SurfaceMode) =>
  page.frameLocator(`iframe[data-online-component-sandbox="${surfaceIdFor(mode)}"]`)

const sandboxInstance = (page: Page, mode: SurfaceMode, instanceId: string) =>
  sandboxFrame(page, mode).locator(`.online-component-instance[data-instance-id="${instanceId}"]`)

const expectActiveSurface = async (
  page: Page,
  mode: SurfaceMode,
  instanceIds: readonly string[] = GENERATED_MATERIAL_INSTANCE_IDS,
) => {
  const surfaceId = surfaceIdFor(mode)
  await expect(surfaceMount(page, mode)).toBeVisible()
  await expect(page.locator(`[data-online-component-surface="${surfaceId}"]`)).toHaveCount(1)
  await expect(page.locator(`iframe[data-online-component-sandbox="${surfaceId}"]`)).toHaveCount(1)
  await expect(page.locator('[data-online-component-shell]')).toHaveCount(instanceIds.length)
  const instances = sandboxFrame(page, mode).locator('.online-component-instance')
  await expect(instances).toHaveCount(instanceIds.length)
  await expect
    .poll(async () =>
      (
        await instances.evaluateAll(elements => elements.map(element => element.getAttribute('data-instance-id')))
      ).sort(),
    )
    .toEqual([...instanceIds].sort())
  if (instanceIds.length > 0) {
    await expect(surfaceShell(page, instanceIds[0])).toBeVisible()
  }
}

const expectNoSurfaceResources = async (page: Page) => {
  await expect(page.locator('[data-online-component-surface]')).toHaveCount(0)
  await expect(page.locator('iframe[data-online-component-sandbox]')).toHaveCount(0)
  await expect(page.locator('[data-online-component-shell]')).toHaveCount(0)
}

const installRuntimeEventRecorder = async (page: Page) => {
  await page.evaluate(eventName => {
    const target = window as Window & { __G008_RUNTIME_EVENTS__?: unknown[] }
    target.__G008_RUNTIME_EVENTS__ = []
    window.addEventListener(eventName, event => {
      target.__G008_RUNTIME_EVENTS__?.push((event as CustomEvent).detail)
    })
  }, RUNTIME_EVENT)
}

const readRuntimeEvents = (page: Page): Promise<unknown[]> =>
  page.evaluate(() => {
    const target = window as Window & { __G008_RUNTIME_EVENTS__?: unknown[] }
    return target.__G008_RUNTIME_EVENTS__ ?? []
  })

const readSurfaceMetrics = (page: Page, mode: SurfaceMode, instanceId: string): Promise<SurfaceMetrics> =>
  page.evaluate(
    ({ instanceId, mode, surfaceId }) => {
      const mount = document.querySelector(`[data-easy-editor-surface-overlay-mount="${mode}"]`)
      const shell = document.querySelector(`[data-online-component-shell="${instanceId}"]`)
      const iframe = document.querySelector(`iframe[data-online-component-sandbox="${surfaceId}"]`)
      const anchor = document.querySelector(`[data-easy-editor-generated-material-host="${instanceId}"]`)
      const content = document.querySelector(mode === 'editor' ? '.lc-simulator-content' : '.lc-editor-content')
      const tools = document.querySelector('[data-easy-editor-surface-tools="editor"]')
      if (
        !(mount instanceof HTMLElement) ||
        !(shell instanceof HTMLElement) ||
        !(iframe instanceof HTMLIFrameElement) ||
        !(anchor instanceof HTMLElement) ||
        !(content instanceof HTMLElement)
      ) {
        throw new Error(`G008 ${mode} surface metrics are unavailable`)
      }
      const shellRect = shell.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()
      return {
        contentZIndex: Number(getComputedStyle(content).zIndex),
        devicePixelRatio: window.devicePixelRatio,
        iframePointerEvents: getComputedStyle(iframe).pointerEvents,
        mountZIndex: Number(getComputedStyle(mount).zIndex),
        shell: {
          left: shellRect.left,
          top: shellRect.top,
          width: shellRect.width,
          height: shellRect.height,
          zIndex: Number(getComputedStyle(shell).zIndex),
        },
        anchor: {
          left: anchorRect.left,
          top: anchorRect.top,
          width: anchorRect.width,
          height: anchorRect.height,
        },
        toolsZIndex: tools instanceof HTMLElement ? Number(getComputedStyle(tools).zIndex) : null,
      }
    },
    { instanceId, mode, surfaceId: surfaceIdFor(mode) },
  )

const expectShellAlignedToAnchor = (metrics: SurfaceMetrics) => {
  expect(metrics.shell.left).toBeCloseTo(metrics.anchor.left, 0)
  expect(metrics.shell.top).toBeCloseTo(metrics.anchor.top, 0)
  expect(metrics.shell.width).toBeCloseTo(metrics.anchor.width, 0)
  expect(metrics.shell.height).toBeCloseTo(metrics.anchor.height, 0)
}

const expectEventuallyAligned = async (page: Page, mode: SurfaceMode, instanceId = GENERATED_MATERIAL_PRIMARY_ID) => {
  await expect
    .poll(async () => {
      const metrics = await readSurfaceMetrics(page, mode, instanceId)
      return Math.max(
        Math.abs(metrics.shell.left - metrics.anchor.left),
        Math.abs(metrics.shell.top - metrics.anchor.top),
        Math.abs(metrics.shell.width - metrics.anchor.width),
        Math.abs(metrics.shell.height - metrics.anchor.height),
      )
    })
    .toBeLessThan(1.5)
}

const updatePrimaryMaterial = async (page: Page) => {
  await page.evaluate(
    async ({ label, nodeId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const document = runtime.engine.project.currentDocument
      if (!document) throw new Error('G008 editor document is unavailable')
      runtime.engine.transactions.runOnDocument(
        document,
        [
          {
            type: 'updateProps',
            documentId: document.id,
            nodeId,
            props: { label, value: 33, color: '#be123c' },
            extras: { $dashboard: { rect: { x: 820, y: 360, width: 340, height: 180 } } },
          },
        ],
        { expectedMutationVersion: document.mutationVersion },
      )
      await runtime.persistDashboardProject('manual-save')
      await runtime.dashboardPersistence.flush()
    },
    { label: GENERATED_MATERIAL_UPDATED_LABEL, nodeId: GENERATED_MATERIAL_PRIMARY_ID },
  )
}

const setPrimaryNodeHidden = (page: Page, hidden: boolean) =>
  page.evaluate(
    async ({ hidden, nodeId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const node = runtime.engine.project.currentDocument?.getNode(nodeId)
      if (!node) throw new Error(`G008 node ${nodeId} is unavailable`)
      const visibilityEvents: boolean[] = []
      const dispose = node.onVisibleChange(visible => visibilityEvents.push(visible))
      try {
        node.hide(hidden)
      } finally {
        dispose()
      }
      if (node.hidden !== hidden) throw new Error(`G008 node ${nodeId} hidden state did not update`)
      if (visibilityEvents.length !== 1 || visibilityEvents[0] !== !hidden) {
        throw new Error(
          `G008 node ${nodeId} visibility event mismatch: expected ${String(!hidden)}, received ${JSON.stringify(visibilityEvents)}`,
        )
      }
      if (runtime.engine.project.simulator.renderer?.autoRepaintNode === false) {
        throw new Error('G008 simulator renderer auto repaint is disabled')
      }
    },
    { hidden, nodeId: GENERATED_MATERIAL_PRIMARY_ID },
  )

const readEditorNodeRect = (page: Page, nodeId: string): Promise<DashboardRect> =>
  page.evaluate(async targetId => {
    const runtime = await import('/src/editor/runtime.ts')
    const node = runtime.engine.project.currentDocument?.getNode(targetId)
    const rect = node?.getDashboardRect()
    if (!rect) throw new Error(`G008 node ${targetId} has no dashboard rect`)
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, nodeId)

const dragEditorShell = async (page: Page, nodeId: string, delta: Readonly<{ x: number; y: number }>) => {
  const shell = surfaceShell(page, nodeId)
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
  if (!box) throw new Error(`G008 shell ${nodeId} has no bounding box`)
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const initialDelta = {
    x: Math.sign(delta.x) * Math.min(Math.abs(delta.x), 8),
    y: Math.sign(delta.y) * Math.min(Math.abs(delta.y), 8),
  }

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

const persistEditorDraft = (page: Page) =>
  page.evaluate(async () => {
    const runtime = await import('/src/editor/runtime.ts')
    await runtime.persistDashboardProject('manual-save')
    await runtime.dashboardPersistence.flush()
  })

const switchGeneratedMaterialsToRevision = (
  page: Page,
  instanceIds: readonly string[],
  artifactRef: GeneratedMaterialArtifactRef,
) =>
  page.evaluate(
    async ({ artifactRef, instanceIds, projectId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const document = runtime.engine.project.currentDocument
      if (!document) throw new Error('G008 editor document is unavailable')
      runtime.engine.transactions.runOnDocument(
        document,
        instanceIds.map(nodeId => ({
          type: 'updateProps' as const,
          documentId: document.id,
          nodeId,
          extras: { $agent: { schemaVersion: 1, artifactRef } },
        })),
        { expectedMutationVersion: document.mutationVersion },
      )
      await runtime.persistDashboardProject('manual-save')
      await runtime.dashboardPersistence.flush()
      const roots = await runtime.dashboardPersistence.enumerateArtifactRoots({ schemaVersion: 1, projectId })
      return roots.roots.filter(root => root.ownerType === 'working-draft')
    },
    { artifactRef, instanceIds, projectId: GENERATED_MATERIAL_PROJECT_ID },
  )

const removeGeneratedMaterials = (page: Page, instanceIds: readonly string[]) =>
  page.evaluate(
    async ({ instanceIds, projectId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const document = runtime.engine.project.currentDocument
      if (!document) throw new Error('G008 editor document is unavailable')
      runtime.engine.transactions.runOnDocument(
        document,
        instanceIds.map(nodeId => ({ type: 'removeNode' as const, documentId: document.id, nodeId })),
        { expectedMutationVersion: document.mutationVersion },
      )
      await runtime.persistDashboardProject('manual-save')
      await runtime.dashboardPersistence.flush()
      const roots = await runtime.dashboardPersistence.enumerateArtifactRoots({ schemaVersion: 1, projectId })
      return roots.roots.filter(root => root.ownerType === 'working-draft')
    },
    { instanceIds, projectId: GENERATED_MATERIAL_PROJECT_ID },
  )

const setEditorZoom = (page: Page, scale: number) =>
  page.evaluate(async value => {
    const runtime = await import('/src/editor/runtime.ts')
    runtime.engine.project.simulator.viewport.scale = value
  }, scale)

const offsetSurfaceRootAndDispatchScroll = (page: Page, mode: SurfaceMode, offset: number) =>
  page.evaluate(
    ({ mode, offset }) => {
      const mount = document.querySelector(`[data-easy-editor-surface-overlay-mount="${mode}"]`)
      const root = mount?.parentElement
      if (!(root instanceof HTMLElement)) throw new Error(`G008 ${mode} surface root is unavailable`)
      root.style.top = offset === 0 ? '50%' : `calc(50% + ${offset}px)`
      root.dispatchEvent(new Event('scroll', { bubbles: true }))
    },
    { mode, offset },
  )

const setSurfaceOuterClipWidth = (page: Page, mode: SurfaceMode, width: number): Promise<SurfaceClipSnapshot> =>
  page.evaluate(
    ({ mode, width }) => {
      const clipSelector = mode === 'editor' ? '.lc-simulator-canvas' : '.lc-editor-canvas'
      const viewportSelector = mode === 'editor' ? '.lc-simulator-canvas-viewport' : '.lc-editor-canvas-viewport'
      const clip = document.querySelector(clipSelector)
      const viewport = document.querySelector(viewportSelector)
      if (!(clip instanceof HTMLElement)) throw new Error(`G008 ${mode} outer clipping ancestor is unavailable`)
      if (!(viewport instanceof HTMLElement)) throw new Error(`G008 ${mode} canvas viewport is unavailable`)
      const computed = getComputedStyle(clip)
      const snapshot = {
        inlineWidth: clip.style.width,
        overflowX: computed.overflowX,
        overflowY: computed.overflowY,
        viewportInlineLeft: viewport.style.left,
      }
      viewport.style.left = `${viewport.offsetLeft}px`
      clip.style.width = `${width}px`
      return snapshot
    },
    { mode, width },
  )

const restoreSurfaceOuterClipWidth = (page: Page, mode: SurfaceMode, snapshot: SurfaceClipSnapshot) =>
  page.evaluate(
    ({ inlineWidth, mode, viewportInlineLeft }) => {
      const clipSelector = mode === 'editor' ? '.lc-simulator-canvas' : '.lc-editor-canvas'
      const viewportSelector = mode === 'editor' ? '.lc-simulator-canvas-viewport' : '.lc-editor-canvas-viewport'
      const clip = document.querySelector(clipSelector)
      const viewport = document.querySelector(viewportSelector)
      if (!(clip instanceof HTMLElement)) throw new Error(`G008 ${mode} outer clipping ancestor is unavailable`)
      if (!(viewport instanceof HTMLElement)) throw new Error(`G008 ${mode} canvas viewport is unavailable`)
      clip.style.width = inlineWidth
      viewport.style.left = viewportInlineLeft
    },
    { inlineWidth: snapshot.inlineWidth, mode, viewportInlineLeft: snapshot.viewportInlineLeft },
  )

test('editor trusted shell delegates drag to Dashboard Dragon and persists the committed rect for 20 instances', async ({
  page,
}) => {
  await seedGeneratedMaterialProject(page)
  await page.goto('/')
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expectActiveSurface(page, 'editor')

  const initial = await readEditorNodeRect(page, GENERATED_MATERIAL_PRIMARY_ID)
  await dragEditorShell(page, GENERATED_MATERIAL_PRIMARY_ID, { x: 96, y: 64 })
  await expect.poll(() => readEditorNodeRect(page, GENERATED_MATERIAL_PRIMARY_ID)).not.toEqual(initial)
  const moved = await readEditorNodeRect(page, GENERATED_MATERIAL_PRIMARY_ID)
  expect(Math.abs(moved.x - initial.x) + Math.abs(moved.y - initial.y)).toBeGreaterThan(20)
  await persistEditorDraft(page)

  await page.reload()
  await expectActiveSurface(page, 'editor')
  const restored = await readEditorNodeRect(page, GENERATED_MATERIAL_PRIMARY_ID)
  expect(restored.x).toBeCloseTo(moved.x, 4)
  expect(restored.y).toBeCloseTo(moved.y, 4)
  expect(restored.width).toBeCloseTo(moved.width, 4)
  expect(restored.height).toBeCloseTo(moved.height, 4)
  expectShellAlignedToAnchor(await readSurfaceMetrics(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID))
})

test('20 GeneratedMaterialHost instances preserve context, independent surfaces, geometry, restart, and cleanup', async ({
  page,
}, testInfo) => {
  const timings: Record<string, number> = {}
  await seedGeneratedMaterialProject(page)
  const initialStartedAt = Date.now()
  await page.goto('/')
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expect(page.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })).toBeVisible()
  await expectActiveSurface(page, 'editor')
  timings.initialEditorRehydrate = Date.now() - initialStartedAt

  const editorPrimary = sandboxInstance(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)
  await expect(editorPrimary).toHaveAttribute('data-rendered-label', 'G008 Instance 1')
  await expect(editorPrimary).toHaveAttribute('data-rendered-value', '1')
  await expect(editorPrimary).toHaveAttribute('data-rendered-color', '#7c3aed')
  await expect(editorPrimary).toHaveAttribute('data-rendered-token', 'g008-business-token-1')
  await expect(editorPrimary).toHaveAttribute('data-rendered-data-value', GENERATED_MATERIAL_RESOLVED_DATA_VALUE)
  await expect(editorPrimary).toHaveAttribute('data-rendered-data-total', String(GENERATED_MATERIAL_INSTANCE_COUNT))
  await expect(editorPrimary).toHaveAttribute('data-rendered-theme', GENERATED_MATERIAL_THEME_MODE)
  await expect(editorPrimary).toHaveAttribute('data-rendered-theme-token', GENERATED_MATERIAL_THEME_TOKEN)
  await expect(editorPrimary).toHaveAttribute('data-rendered-asset', GENERATED_MATERIAL_PRIMARY_ASSET_HANDLE)
  await expect(editorPrimary).toHaveAttribute('data-rendered-width', '150')
  await expect(editorPrimary).toHaveAttribute('data-rendered-height', '90')
  await expect(editorPrimary).toHaveAttribute('data-source-revision', GENERATED_MATERIAL_SOURCE_REVISION)

  const ordinaryMaterial = page.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })
  await ordinaryMaterial.click()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const runtime = await import('/src/editor/runtime.ts')
        return runtime.engine.designer.selection.selected
      }),
    )
    .toEqual([GENERATED_MATERIAL_ORDINARY_ID])

  const initialMetrics = await readSurfaceMetrics(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)
  expect(initialMetrics.devicePixelRatio).toBe(2)
  expect(initialMetrics.iframePointerEvents).toBe('none')
  expect(initialMetrics.contentZIndex).toBeLessThan(initialMetrics.mountZIndex)
  expect(initialMetrics.mountZIndex).toBeLessThan(initialMetrics.toolsZIndex ?? Number.NaN)
  expectShellAlignedToAnchor(initialMetrics)

  await installRuntimeEventRecorder(page)
  await surfaceShell(page, GENERATED_MATERIAL_PRIMARY_ID).click()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const runtime = await import('/src/editor/runtime.ts')
        return runtime.engine.designer.selection.selected
      }),
    )
    .toEqual([GENERATED_MATERIAL_PRIMARY_ID])
  expect(await readRuntimeEvents(page)).toEqual([])

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: '预览' }).click()
  const preview = await popupPromise
  await expect(preview).toHaveURL(/\/preview$/)
  await expect(preview.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })).toBeVisible()
  await expectActiveSurface(preview, 'preview')
  expect(await page.locator(`iframe[data-online-component-sandbox="${EDITOR_SURFACE_ID}"]`).count()).toBe(1)
  expect(await preview.locator(`iframe[data-online-component-sandbox="${PREVIEW_SURFACE_ID}"]`).count()).toBe(1)
  await installRuntimeEventRecorder(preview)

  await surfaceShell(preview, GENERATED_MATERIAL_PRIMARY_ID).click()
  await expect
    .poll(() => readRuntimeEvents(preview))
    .toEqual([
      {
        schemaVersion: 1,
        surfaceId: PREVIEW_SURFACE_ID,
        instanceId: GENERATED_MATERIAL_PRIMARY_ID,
        type: 'activate',
        payload: null,
      },
    ])
  expect(await readRuntimeEvents(page)).toEqual([])
  expect(
    await page.evaluate(async () => {
      const runtime = await import('/src/editor/runtime.ts')
      return runtime.engine.designer.selection.selected
    }),
  ).toEqual([GENERATED_MATERIAL_PRIMARY_ID])

  const previewMetrics = await readSurfaceMetrics(preview, 'preview', GENERATED_MATERIAL_PRIMARY_ID)
  expect(previewMetrics.devicePixelRatio).toBe(2)
  expect(previewMetrics.iframePointerEvents).toBe('none')
  expect(previewMetrics.contentZIndex).toBeLessThan(previewMetrics.mountZIndex)
  expect(previewMetrics.toolsZIndex).toBeNull()
  expectShellAlignedToAnchor(previewMetrics)

  await updatePrimaryMaterial(page)
  await expect(editorPrimary).toHaveAttribute('data-rendered-label', GENERATED_MATERIAL_UPDATED_LABEL)
  await expect(editorPrimary).toHaveAttribute('data-rendered-value', '33')
  await expect(editorPrimary).toHaveAttribute('data-rendered-color', '#be123c')
  await expect(editorPrimary).toHaveAttribute('data-rendered-width', '340')
  await expect(editorPrimary).toHaveAttribute('data-rendered-height', '180')
  await expectEventuallyAligned(page, 'editor')
  await expect(sandboxInstance(preview, 'preview', GENERATED_MATERIAL_PRIMARY_ID)).toHaveAttribute(
    'data-rendered-label',
    'G008 Instance 1',
  )

  await setPrimaryNodeHidden(page, true)
  await expect(surfaceShell(page, GENERATED_MATERIAL_PRIMARY_ID)).toBeHidden()
  await expectActiveSurface(page, 'editor', [
    ...GENERATED_MATERIAL_INSTANCE_IDS.filter(instanceId => instanceId !== GENERATED_MATERIAL_PRIMARY_ID),
    GENERATED_MATERIAL_PRIMARY_ID,
  ])
  await expect(editorPrimary).toBeHidden()
  await expectActiveSurface(preview, 'preview')
  await setPrimaryNodeHidden(page, false)
  await expectActiveSurface(page, 'editor')
  await expectActiveSurface(preview, 'preview')
  await expect(surfaceShell(page, GENERATED_MATERIAL_PRIMARY_ID)).toBeVisible()
  await expect(editorPrimary).toBeVisible()

  const editorClip = await setSurfaceOuterClipWidth(page, 'editor', 60)
  expect(editorClip).toMatchObject({ overflowX: 'hidden', overflowY: 'hidden' })
  try {
    await expect(surfaceShell(page, GENERATED_MATERIAL_PRIMARY_ID)).toBeHidden()
    await expect(editorPrimary).toBeHidden()
  } finally {
    await restoreSurfaceOuterClipWidth(page, 'editor', editorClip)
  }
  await expect(surfaceShell(page, GENERATED_MATERIAL_PRIMARY_ID)).toBeVisible()
  await expect(editorPrimary).toBeVisible()
  await expectEventuallyAligned(page, 'editor')

  const previewPrimary = sandboxInstance(preview, 'preview', GENERATED_MATERIAL_PRIMARY_ID)
  const previewClip = await setSurfaceOuterClipWidth(preview, 'preview', 60)
  expect(previewClip).toMatchObject({ overflowX: 'hidden', overflowY: 'hidden' })
  try {
    await expect(surfaceShell(preview, GENERATED_MATERIAL_PRIMARY_ID)).toBeHidden()
    await expect(previewPrimary).toBeHidden()
  } finally {
    await restoreSurfaceOuterClipWidth(preview, 'preview', previewClip)
  }
  await expect(surfaceShell(preview, GENERATED_MATERIAL_PRIMARY_ID)).toBeVisible()
  await expect(previewPrimary).toBeVisible()
  await expectEventuallyAligned(preview, 'preview')

  const beforeZoomMetrics = await readSurfaceMetrics(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)
  await setEditorZoom(page, 0.75)
  await expectEventuallyAligned(page, 'editor')
  const zoomedMetrics = await readSurfaceMetrics(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)
  expect(zoomedMetrics.anchor.width).toBeLessThan(beforeZoomMetrics.anchor.width)

  const beforeScrollOffset = await readSurfaceMetrics(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)
  await offsetSurfaceRootAndDispatchScroll(page, 'editor', 37)
  await expectEventuallyAligned(page, 'editor')
  const afterScrollOffset = await readSurfaceMetrics(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)
  expect(Math.abs(afterScrollOffset.anchor.top - beforeScrollOffset.anchor.top)).toBeGreaterThan(20)
  await offsetSurfaceRootAndDispatchScroll(page, 'editor', 0)
  await expectEventuallyAligned(page, 'editor')

  await page.setViewportSize({ width: 1500, height: 900 })
  await expectEventuallyAligned(page, 'editor')
  await preview.setViewportSize({ width: 1400, height: 820 })
  await expectEventuallyAligned(preview, 'preview')

  const oldEditorFrame = await page
    .locator(`iframe[data-online-component-sandbox="${EDITOR_SURFACE_ID}"]`)
    .elementHandle()
  if (!oldEditorFrame) throw new Error('G008 editor sandbox frame is unavailable before revision switch')
  const restartStartedAt = Date.now()
  const seed = await seedGeneratedMaterialProjectRevisionHandle(page)
  const workingDraftRoots = await switchGeneratedMaterialsToRevision(page, GENERATED_MATERIAL_INSTANCE_IDS, seed)
  expect(workingDraftRoots).toEqual([
    expect.objectContaining({
      ownerType: 'working-draft',
      ownerId: GENERATED_MATERIAL_BRANCH_ID,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_REVISED_SOURCE_REVISION,
    }),
  ])
  await expect.poll(() => oldEditorFrame.evaluate(element => element.isConnected).catch(() => false)).toBe(false)
  await expectActiveSurface(page, 'editor')
  await expect(
    sandboxFrame(page, 'editor').locator(
      `.online-component-instance[data-source-revision="${GENERATED_MATERIAL_REVISED_SOURCE_REVISION}"]`,
    ),
  ).toHaveCount(GENERATED_MATERIAL_INSTANCE_COUNT)
  timings.revisionRestartAndRehydrate = Date.now() - restartStartedAt
  await expect(
    sandboxFrame(preview, 'preview').locator(
      `.online-component-instance[data-source-revision="${GENERATED_MATERIAL_SOURCE_REVISION}"]`,
    ),
  ).toHaveCount(GENERATED_MATERIAL_INSTANCE_COUNT)

  const reloadStartedAt = Date.now()
  await page.reload()
  await expectActiveSurface(page, 'editor')
  await expect(
    sandboxFrame(page, 'editor').locator(
      `.online-component-instance[data-source-revision="${GENERATED_MATERIAL_REVISED_SOURCE_REVISION}"]`,
    ),
  ).toHaveCount(GENERATED_MATERIAL_INSTANCE_COUNT)
  timings.reloadRehydrate = Date.now() - reloadStartedAt
  await preview.close()

  const removalStartedAt = Date.now()
  const rootsAfterRemoval = await removeGeneratedMaterials(page, GENERATED_MATERIAL_INSTANCE_IDS)
  expect(rootsAfterRemoval).toEqual([])
  await expectNoSurfaceResources(page)
  timings.removeToZeroResources = Date.now() - removalStartedAt
  await expect(page.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })).toBeVisible()
  await page.reload()
  await expectNoSurfaceResources(page)
  await expect(page.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })).toBeVisible()

  const artifact = await page.evaluate(
    async ({ artifactId, projectId, sourceRevision }) => {
      const runtime = await import('/src/editor/runtime.ts')
      return runtime.dashboardPersistence.readArtifact({ schemaVersion: 1, projectId, artifactId, sourceRevision })
    },
    {
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      projectId: GENERATED_MATERIAL_PROJECT_ID,
      sourceRevision: GENERATED_MATERIAL_REVISED_SOURCE_REVISION,
    },
  )
  expect(artifact).toMatchObject({
    artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
    projectId: GENERATED_MATERIAL_PROJECT_ID,
    sourceRevision: GENERATED_MATERIAL_REVISED_SOURCE_REVISION,
    provenance: { actor: 'e2e', phase: 'G008', sourceRevision: GENERATED_MATERIAL_REVISED_SOURCE_REVISION },
  })
  testInfo.annotations.push({ type: 'g008-lifecycle-timing-ms', description: JSON.stringify(timings) })
  console.info(`[G008 lifecycle timing ms] ${JSON.stringify(timings)}`)
})

const seedGeneratedMaterialProjectRevisionHandle = async (page: Page): Promise<GeneratedMaterialArtifactRef> =>
  page.evaluate(
    async ({ artifactId, projectId, sourceRevision }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const artifact = await runtime.dashboardPersistence.readArtifact({
        schemaVersion: 1,
        projectId,
        artifactId,
        sourceRevision,
      })
      if (!artifact) throw new Error('G008 revised artifact is unavailable')
      return {
        artifactId: artifact.artifactId,
        sourceRevision: artifact.sourceRevision,
        logicalComponentId: artifact.logicalComponentId,
        sourceIntegrity: artifact.sourceIntegrity,
        target: { kind: 'online' as const },
      }
    },
    {
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      projectId: GENERATED_MATERIAL_PROJECT_ID,
      sourceRevision: GENERATED_MATERIAL_REVISED_SOURCE_REVISION,
    },
  )

test('safe boot performs no work while a stale revision quarantines only matching instances across reload and rollback', async ({
  page,
}) => {
  const seed = await seedGeneratedMaterialProject(page)
  await page.goto('/')
  await expectActiveSurface(page, 'editor')
  await switchGeneratedMaterialsToRevision(page, [GENERATED_MATERIAL_PRIMARY_ID], seed.revisedArtifactRef)
  await expect(sandboxInstance(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)).toHaveAttribute(
    'data-source-revision',
    GENERATED_MATERIAL_REVISED_SOURCE_REVISION,
  )

  const markerKey = `easy-editor:online-component-activation:v1:${GENERATED_MATERIAL_PROJECT_ID}:${GENERATED_MATERIAL_BRANCH_ID}:${EDITOR_SURFACE_ID}`
  const pendingMarker = {
    state: 'pending',
    revisionKey: seed.revisedRevisionKey,
    surfaceId: EDITOR_SURFACE_ID,
    activationId: `${GENERATED_MATERIAL_PROJECT_ID}:${GENERATED_MATERIAL_BRANCH_ID}:${EDITOR_SURFACE_ID}`,
    nonce: 'g008-stale-nonce-0001',
    startedAt: 1,
  }
  await page.evaluate(
    ({ key, marker }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          pending: { [`${marker.revisionKey}::${marker.surfaceId}`]: marker },
          quarantined: {},
        }),
      )
    },
    { key: markerKey, marker: pendingMarker },
  )

  await page.goto('/?easy-editor-online-safe-boot=1')
  await expect(page.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })).toBeVisible()
  await expectNoSurfaceResources(page)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), markerKey)).toEqual({
    schemaVersion: 1,
    pending: { [`${seed.revisedRevisionKey}::${EDITOR_SURFACE_ID}`]: pendingMarker },
    quarantined: {},
  })

  await page.goto('/')
  await expect(page.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })).toBeVisible()
  const goodInstanceIds = GENERATED_MATERIAL_INSTANCE_IDS.filter(id => id !== GENERATED_MATERIAL_PRIMARY_ID)
  await expectActiveSurface(page, 'editor', goodInstanceIds)
  await expect(surfaceShell(page, GENERATED_MATERIAL_PRIMARY_ID)).toHaveCount(0)
  await expect(sandboxInstance(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)).toHaveCount(0)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), markerKey)).toEqual({
    schemaVersion: 1,
    pending: {},
    quarantined: { [seed.revisedRevisionKey]: pendingMarker },
  })

  await switchGeneratedMaterialsToRevision(page, [GENERATED_MATERIAL_PRIMARY_ID], seed.artifactRef)
  await expectActiveSurface(page, 'editor')
  await expect(sandboxInstance(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)).toHaveAttribute(
    'data-source-revision',
    GENERATED_MATERIAL_SOURCE_REVISION,
  )
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), markerKey)).toEqual({
    schemaVersion: 1,
    pending: {},
    quarantined: { [seed.revisedRevisionKey]: pendingMarker },
  })
})
