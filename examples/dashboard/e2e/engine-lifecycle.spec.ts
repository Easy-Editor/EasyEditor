import { type BrowserContext, type Page, expect, test } from '@playwright/test'

const dashboardOrigin = 'http://127.0.0.1:5173'

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

const dispatchPageHide = (page: Page, persisted: boolean): Promise<void> =>
  page.evaluate(value => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: value }))
  }, persisted)

test('dashboard lifecycle, reload, persistence, and preview remain coherent', async ({ context, page }) => {
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

  await dispatchPageHide(page, true)
  await expectEngineState(page, 'ready')

  await dispatchPageHide(page, false)
  await expectEngineState(page, 'disposed')

  await page.reload()
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expectEngineState(page, 'ready')

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: '预览' }).click()
  const preview = await popupPromise
  await expect(preview).toHaveURL(/\/preview$/)
  await expect(preview.locator('.lc-editor-canvas')).toBeVisible()

  const persistedVersion = await page.evaluate(() => {
    const pageInfo = JSON.parse(localStorage.getItem('pageInfo') || '[]') as Array<{ path: string }>
    const firstPage = pageInfo[0]
    if (!firstPage) return undefined
    const schema = JSON.parse(localStorage.getItem(`pageSchema:${firstPage.path}`) || 'null') as {
      version?: string
    } | null
    return schema?.version
  })
  expect(persistedVersion).toBe('1.0.0')

  await preview.close()
  expect(externalRequests).toEqual([])
  expect(browserErrors).toEqual([])
})
