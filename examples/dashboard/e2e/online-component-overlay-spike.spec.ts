import { type Page, expect, test } from '@playwright/test'

type SurfaceMode = 'editor' | 'preview'

const mountSpike = async (page: Page, mode: SurfaceMode) =>
  page.evaluate(async surfaceMode => {
    // @ts-expect-error The spike is served as a browser module outside the app TS program.
    const module = await import('/spikes/online-component-overlay/surface-spike.mjs')
    const mountSelector = `[data-easy-editor-surface-overlay-mount="${surfaceMode}"]`
    const mount = document.querySelector(mountSelector)
    if (!(mount instanceof HTMLElement)) throw new Error(`missing stable ${surfaceMode} overlay mount`)
    const viewport = mount.parentElement
    if (!(viewport instanceof HTMLElement)) throw new Error('overlay mount is detached from its viewport')

    const createMarkerStore = (initialMarker?: Record<string, unknown>) => {
      let marker = initialMarker
      const events: string[] = []
      return {
        events,
        read: () => {
          events.push('read')
          return marker
        },
        write: (_key: string, value: Record<string, unknown>) => {
          marker = value
          events.push('write')
        },
        clear: () => {
          marker = undefined
          events.push('clear')
        },
        quarantine: () => events.push('quarantine'),
        getMarker: () => marker,
      }
    }

    const staleMarker = {
      state: 'pending',
      revisionKey: `${surfaceMode}-stale-revision`,
      surfaceId: `${surfaceMode}-stale-surface`,
      startedAt: 1,
    }
    const quarantineStore = createMarkerStore(staleMarker)
    const childrenBeforeQuarantine = mount.childElementCount
    const quarantined = module.createOnlineComponentOverlaySurfaceSpike({
      mount,
      surfaceId: `${surfaceMode}-quarantined-surface`,
      mode: surfaceMode,
      activation: {
        markerStore: quarantineStore,
        revisionKey: `${surfaceMode}-stale-revision`,
        now: () => 2,
      },
    })
    const quarantineProbe = {
      diagnostics: quarantined.getDiagnostics(),
      childrenBefore: childrenBeforeQuarantine,
      childrenAfter: mount.childElementCount,
      events: [...quarantineStore.events],
    }

    const safeBootStore = createMarkerStore(staleMarker)
    const childrenBeforeSafeBoot = mount.childElementCount
    const safeBoot = module.createOnlineComponentOverlaySurfaceSpike({
      mount,
      surfaceId: `${surfaceMode}-safe-boot-surface`,
      mode: surfaceMode,
      activation: {
        markerStore: safeBootStore,
        revisionKey: `${surfaceMode}-stale-revision`,
        safeBoot: true,
        now: () => 3,
      },
    })
    const safeBootProbe = {
      diagnostics: safeBoot.getDiagnostics(),
      childrenBefore: childrenBeforeSafeBoot,
      childrenAfter: mount.childElementCount,
      events: [...safeBootStore.events],
      marker: safeBootStore.getMarker(),
    }

    const pendingStore = createMarkerStore()
    const pending = module.createOnlineComponentOverlaySurfaceSpike({
      mount,
      surfaceId: `${surfaceMode}-pending-surface`,
      mode: surfaceMode,
      activation: {
        markerStore: pendingStore,
        revisionKey: `${surfaceMode}-pending-revision`,
        now: () => 4,
      },
    })
    const pendingReady = pending.whenReady().catch(() => undefined)
    pending.dispose()
    await pendingReady
    const markerAfterDispose = pendingStore.getMarker()
    const reload = module.createOnlineComponentOverlaySurfaceSpike({
      mount,
      surfaceId: `${surfaceMode}-reload-surface`,
      mode: surfaceMode,
      activation: {
        markerStore: pendingStore,
        revisionKey: `${surfaceMode}-pending-revision`,
        now: () => 5,
      },
    })
    const pendingReloadProbe = {
      markerAfterDispose,
      reload: reload.getDiagnostics(),
      events: [...pendingStore.events],
    }

    const ordinary = document.createElement('button')
    ordinary.type = 'button'
    ordinary.textContent = `${surfaceMode} ordinary material`
    ordinary.dataset.overlaySpikeOrdinary = surfaceMode
    Object.assign(ordinary.style, {
      position: 'absolute',
      left: '1120px',
      top: '460px',
      width: '220px',
      height: '100px',
      zIndex: '0',
    })
    ordinary.addEventListener('click', () => {
      ordinary.dataset.clicks = String(Number(ordinary.dataset.clicks ?? 0) + 1)
    })
    viewport.append(ordinary)

    const selections: unknown[] = []
    const runtimeEvents: unknown[] = []
    const activationStore = createMarkerStore()
    const surface = module.createOnlineComponentOverlaySurfaceSpike({
      mount,
      surfaceId: `${surfaceMode}-surface`,
      mode: surfaceMode,
      activation: {
        markerStore: activationStore,
        revisionKey: `${surfaceMode}-primary-revision`,
        now: () => 6,
      },
      onSelection: (event: unknown) => selections.push(event),
      onRuntimeEvent: (event: unknown) => runtimeEvents.push(event),
    })
    surface.registerInstance({
      id: `${surfaceMode}-kpi-primary`,
      label: `${surfaceMode} KPI`,
      color: '#7c3aed',
      rect: { x: 760, y: 420, width: 300, height: 180 },
    })
    surface.registerInstance({
      id: `${surfaceMode}-kpi-secondary`,
      label: `${surfaceMode} KPI 2`,
      color: '#0369a1',
      rect: { x: 1420, y: 760, width: 220, height: 120 },
    })
    await surface.whenReady()
    ;(window as any).__ONLINE_COMPONENT_OVERLAY_SPIKE__ = {
      surface,
      selections,
      runtimeEvents,
      ordinary,
      mount,
      viewport,
    }
    return {
      ...surface.getDiagnostics(),
      lifecycleProbe: {
        quarantine: quarantineProbe,
        safeBoot: safeBootProbe,
        pendingReload: pendingReloadProbe,
        heartbeat: {
          events: [...activationStore.events],
          marker: activationStore.getMarker(),
        },
      },
    }
  }, mode)

const getSurfaceMetrics = (page: Page, mode: SurfaceMode) =>
  page.evaluate(surfaceMode => {
    const state = (window as any).__ONLINE_COMPONENT_OVERLAY_SPIKE__
    const viewportRect = state.viewport.getBoundingClientRect()
    const shell = document.querySelector(`[data-online-component-shell="${surfaceMode}-kpi-primary"]`)
    const frame = document.querySelector(`[data-online-component-sandbox="${surfaceMode}-surface"]`)
    const tools = document.querySelector('[data-easy-editor-surface-tools="editor"]')
    if (!(shell instanceof HTMLElement) || !(frame instanceof HTMLIFrameElement)) {
      throw new Error('spike elements are missing')
    }
    if (surfaceMode === 'editor' && !(tools instanceof HTMLElement)) {
      throw new Error('real editor tools seam is missing')
    }
    const shellRect = shell.getBoundingClientRect()
    const scaleX = viewportRect.width / state.viewport.offsetWidth
    const scaleY = viewportRect.height / state.viewport.offsetHeight
    return {
      viewport: { left: viewportRect.left, top: viewportRect.top },
      shell: {
        left: shellRect.left,
        top: shellRect.top,
        width: shellRect.width,
        height: shellRect.height,
      },
      scaleX,
      scaleY,
      sandbox: frame.getAttribute('sandbox'),
      framePointerEvents: getComputedStyle(frame).pointerEvents,
      ordinaryZIndex: getComputedStyle(state.ordinary).zIndex,
      mountZIndex: getComputedStyle(state.mount).zIndex,
      toolsZIndex: tools instanceof HTMLElement ? getComputedStyle(tools).zIndex : null,
    }
  }, mode)

test('editor and standalone preview use independent shared overlay sandboxes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-easy-editor-surface-overlay-mount="editor"]')).toBeVisible()
  const editorDiagnostics = await mountSpike(page, 'editor')

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: '预览' }).click()
  const preview = await popupPromise
  await expect(preview).toHaveURL(/\/preview$/)
  await expect(preview.locator('[data-easy-editor-surface-overlay-mount="preview"]')).toBeVisible()
  const previewDiagnostics = await mountSpike(preview, 'preview')

  for (const [diagnostics, surfaceId] of [
    [editorDiagnostics, 'editor-surface'],
    [previewDiagnostics, 'preview-surface'],
  ] as const) {
    expect(diagnostics).toMatchObject({
      surfaceId,
      ready: true,
      iframeCount: 1,
      instanceCount: 2,
      coordinateModel: 'surface-viewport-local',
      activation: { state: 'heartbeat-cleared' },
    })
    expect(diagnostics.lifecycleProbe.quarantine).toMatchObject({
      diagnostics: { ready: false, iframeCount: 0, activation: { state: 'quarantined' } },
      childrenBefore: 0,
      childrenAfter: 0,
      events: ['read', 'quarantine'],
    })
    expect(diagnostics.lifecycleProbe.safeBoot).toMatchObject({
      diagnostics: { ready: false, iframeCount: 0, activation: { state: 'safe-boot-skipped' } },
      childrenBefore: 0,
      childrenAfter: 0,
      events: ['read', 'quarantine'],
    })
    expect(diagnostics.lifecycleProbe.pendingReload).toMatchObject({
      markerAfterDispose: { state: 'pending' },
      reload: { ready: false, iframeCount: 0, activation: { state: 'quarantined' } },
      events: ['read', 'write', 'read', 'quarantine'],
    })
    expect(diagnostics.lifecycleProbe.heartbeat).toEqual({
      events: ['read', 'write', 'clear'],
      marker: undefined,
    })
  }

  for (const [surfacePage, surfaceMode] of [
    [page, 'editor'],
    [preview, 'preview'],
  ] as const) {
    const metrics = await getSurfaceMetrics(surfacePage, surfaceMode)
    expect(metrics.sandbox).toBe('allow-scripts')
    expect(metrics.framePointerEvents).toBe('none')
    expect(Number(metrics.ordinaryZIndex)).toBeLessThan(Number(metrics.mountZIndex))
    if (surfaceMode === 'editor') {
      expect(Number(metrics.mountZIndex)).toBeLessThan(Number(metrics.toolsZIndex))
    }
    expect(metrics.shell.left).toBeCloseTo(metrics.viewport.left + 760 * metrics.scaleX, 0)
    expect(metrics.shell.top).toBeCloseTo(metrics.viewport.top + 420 * metrics.scaleY, 0)
    expect(metrics.shell.width).toBeCloseTo(300 * metrics.scaleX, 0)
    expect(metrics.shell.height).toBeCloseTo(180 * metrics.scaleY, 0)

    await surfacePage.locator(`[data-overlay-spike-ordinary="${surfaceMode}"]`).click()
    await expect(surfacePage.locator(`[data-overlay-spike-ordinary="${surfaceMode}"]`)).toHaveAttribute(
      'data-clicks',
      '1',
    )
  }

  await page.locator('[data-online-component-shell="editor-kpi-primary"]').click()
  const editorInteractions = await page.evaluate(() => {
    const state = (window as any).__ONLINE_COMPONENT_OVERLAY_SPIKE__
    return { selections: state.selections, runtimeEvents: state.runtimeEvents }
  })
  expect(editorInteractions).toEqual({
    selections: [
      {
        surfaceId: 'editor-surface',
        instanceId: 'editor-kpi-primary',
        __id: 'editor-kpi-primary',
      },
    ],
    runtimeEvents: [],
  })

  await preview.locator('[data-online-component-shell="preview-kpi-primary"]').click()
  const previewInteractions = await preview.evaluate(() => {
    const state = (window as any).__ONLINE_COMPONENT_OVERLAY_SPIKE__
    return { selections: state.selections, runtimeEvents: state.runtimeEvents }
  })
  expect(previewInteractions).toEqual({
    selections: [],
    runtimeEvents: [
      {
        surfaceId: 'preview-surface',
        instanceId: 'preview-kpi-primary',
        type: 'activate',
        pointer: { button: 0 },
      },
    ],
  })

  await page.evaluate(() => (window as any).__ONLINE_COMPONENT_OVERLAY_SPIKE__.surface.dispose())
  await preview.evaluate(() => (window as any).__ONLINE_COMPONENT_OVERLAY_SPIKE__.surface.dispose())
  await expect(page.locator('[data-online-component-sandbox="editor-surface"]')).toHaveCount(0)
  await expect(preview.locator('[data-online-component-sandbox="preview-surface"]')).toHaveCount(0)
})
