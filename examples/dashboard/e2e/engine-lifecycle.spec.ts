import { type BrowserContext, type Page, expect, test } from '@playwright/test'

type DashboardPersistenceProbe = Readonly<{
  state: string
  projectId: string | null
  branchId: string | null
  draftGeneration: number
  projectSchemaVersion: string | null
  activeDocument: Readonly<{ documentId: string; fileName: string; index: number }> | null
  pendingAutosave: boolean
}>

const collectBrowserErrors = (context: BrowserContext): string[] => {
  const errors: string[] = []
  context.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  context.on('weberror', error => errors.push(`weberror: ${error.error().message}`))
  return errors
}

const expectEngineState = async (page: Page, expected: string): Promise<void> => {
  await expect
    .poll(() => page.evaluate(() => window.__EASY_EDITOR_E2E__?.getEngineState()), {
      message: `expected dashboard engine state to become ${expected}`,
    })
    .toBe(expected)
}

const flushAndReadPersistence = (page: Page): Promise<DashboardPersistenceProbe> =>
  page.evaluate(async () => {
    const probe = window.__EASY_EDITOR_E2E__ as unknown as
      | Readonly<{
          flushPersistence: () => Promise<void>
          getPersistenceState: () => DashboardPersistenceProbe
        }>
      | undefined
    if (!probe) throw new Error('Dashboard E2E persistence probe is unavailable')
    await probe.flushPersistence()
    return probe.getPersistenceState()
  })

const dispatchPageHide = (page: Page, persisted: boolean): Promise<void> =>
  page.evaluate(value => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: value }))
  }, persisted)

test('dashboard lifecycle, reload, persistence, and preview remain coherent', async ({ baseURL, context, page }) => {
  if (!baseURL) throw new Error('Dashboard E2E baseURL is unavailable')
  const dashboardOrigin = new URL(baseURL).origin
  const browserErrors = collectBrowserErrors(context)
  const externalRequests: string[] = []
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== dashboardOrigin) {
      externalRequests.push(url.href)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expectEngineState(page, 'ready')
  const initialPersistence = await flushAndReadPersistence(page)
  expect(initialPersistence).toMatchObject({
    state: 'ready',
    branchId: 'main',
    draftGeneration: 1,
    projectSchemaVersion: '1.0.0',
    pendingAutosave: false,
  })
  expect(initialPersistence.projectId).toBeTruthy()

  const probeKeys = await page.evaluate(() => Object.keys(window.__EASY_EDITOR_E2E__ ?? {}).sort())
  expect(probeKeys).toEqual(['flushPersistence', 'getEngineState', 'getPersistenceState'])

  await dispatchPageHide(page, true)
  await expectEngineState(page, 'ready')

  await dispatchPageHide(page, false)
  await expectEngineState(page, 'disposed')

  await page.reload()
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expectEngineState(page, 'ready')
  const reloadedPersistence = await flushAndReadPersistence(page)
  expect(reloadedPersistence.projectId).toBe(initialPersistence.projectId)
  expect(reloadedPersistence.draftGeneration).toBe(initialPersistence.draftGeneration)

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: '预览' }).click()
  const preview = await popupPromise
  await expect(preview).toHaveURL(/\/preview$/)
  await expect(preview.locator('.lc-editor-canvas')).toBeVisible()

  const previewPersistence = await flushAndReadPersistence(page)
  expect(previewPersistence.projectSchemaVersion).toBe('1.0.0')
  expect(previewPersistence.draftGeneration).toBeGreaterThan(reloadedPersistence.draftGeneration)
  expect(previewPersistence.activeDocument?.fileName).toBe('home')

  await preview.close()
  expect(externalRequests).toEqual([])
  expect(browserErrors).toEqual([])
})
