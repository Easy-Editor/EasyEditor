import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Page, expect, test } from '@playwright/test'
import {
  GENERATED_MATERIAL_ARTIFACT_ID,
  GENERATED_MATERIAL_BRANCH_ID,
  GENERATED_MATERIAL_CSS,
  GENERATED_MATERIAL_LOGICAL_COMPONENT_ID,
  GENERATED_MATERIAL_PRIMARY_ID,
  GENERATED_MATERIAL_PROJECT_ID,
  GENERATED_MATERIAL_SOURCE,
  GENERATED_MATERIAL_SOURCE_REVISION,
} from './fixtures/generated-material-host'

const PRODUCTION_SEED_MODULE = '/__e2e__/generated-material-host-production-seed.js'
const PRODUCTION_SEED_OUTPUT_DIRECTORY = fileURLToPath(
  new URL('../node_modules/.tmp/dashboard-production-surface-e2e', import.meta.url),
)
const PRODUCTION_SEED_BUNDLE = join(PRODUCTION_SEED_OUTPUT_DIRECTORY, 'generated-material-host-production-seed.js')
const EDITOR_SURFACE_ID = 'dashboard-editor-online'
const PREVIEW_SURFACE_ID = 'dashboard-preview-online'
const RENDERED_LABEL = 'G009 Production Surface'
const REQUIRED_DOCUMENT_CSP = "frame-src 'none'"
const GENERATED_MATERIAL_RENDER_DECLARATION = 'const render = (root, ctx) => {'
const SANDBOX_REALM_SENTINEL = 'easyEditorG009SandboxRealm'
const SANDBOX_REALM_SENTINEL_VALUE = 'sandbox-only'
const PRODUCTION_GENERATED_MATERIAL_SOURCE = GENERATED_MATERIAL_SOURCE.replace(
  GENERATED_MATERIAL_RENDER_DECLARATION,
  `${GENERATED_MATERIAL_RENDER_DECLARATION}
  root.ownerDocument.documentElement.dataset.${SANDBOX_REALM_SENTINEL} = '${SANDBOX_REALM_SENTINEL_VALUE}'`,
)

test.afterAll(async () => {
  await rm(PRODUCTION_SEED_OUTPUT_DIRECTORY, { force: true, recursive: true })
})

const seedProductionProject = async (page: Page) => {
  const seedBundle = await readFile(PRODUCTION_SEED_BUNDLE)
  await page.goto('/logo.svg')
  const applicationOrigin = new URL(page.url()).origin
  await page.context().route('**/*', route => {
    const requestUrl = new URL(route.request().url())
    if (['http:', 'https:'].includes(requestUrl.protocol) && requestUrl.origin !== applicationOrigin) {
      return route.abort('blockedbyclient')
    }
    return route.fallback()
  })
  await page.route(`**${PRODUCTION_SEED_MODULE}`, route =>
    route.fulfill({
      body: seedBundle,
      contentType: 'text/javascript; charset=utf-8',
      status: 200,
    }),
  )
  await page.evaluate(
    async ({ fixture, moduleUrl }) => {
      const seeder = await import(moduleUrl)
      await seeder.seedGeneratedMaterialHostProductionProject(fixture)
    },
    {
      moduleUrl: PRODUCTION_SEED_MODULE,
      fixture: {
        projectId: GENERATED_MATERIAL_PROJECT_ID,
        branchId: GENERATED_MATERIAL_BRANCH_ID,
        artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
        sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
        logicalComponentId: GENERATED_MATERIAL_LOGICAL_COMPONENT_ID,
        instanceId: GENERATED_MATERIAL_PRIMARY_ID,
        label: RENDERED_LABEL,
        source: PRODUCTION_GENERATED_MATERIAL_SOURCE,
        css: GENERATED_MATERIAL_CSS,
      },
    },
  )
}

const expectSandboxedRenderedComponent = async (page: Page, surfaceId: string) => {
  const frameSelector = `iframe[data-online-component-sandbox="${surfaceId}"]`
  const frame = page.locator(frameSelector)
  const sandbox = page.frameLocator(frameSelector)
  await expect(
    sandbox.locator(`.online-component-instance[data-instance-id="${GENERATED_MATERIAL_PRIMARY_ID}"]`),
  ).toHaveAttribute('data-rendered-label', RENDERED_LABEL)
  await expect
    .poll(async () => {
      const handles = await frame.elementHandles()
      if (handles.length !== 1) return null
      const handle = handles[0]
      const contentFrame = await handle.contentFrame()
      return {
        contentUrl: contentFrame?.url() ?? null,
        sandbox: await handle.getAttribute('sandbox'),
        source: await handle.getAttribute('src'),
        srcdocContainsOnlineComponent: /online-component/u.test((await handle.getAttribute('srcdoc')) ?? ''),
      }
    })
    .toEqual({
      contentUrl: 'about:srcdoc',
      sandbox: 'allow-scripts',
      source: null,
      srcdocContainsOnlineComponent: true,
    })
  await expect(page.locator('.online-component-instance')).toHaveCount(0)
  await expect(
    page.locator(`[data-easy-editor-generated-material-host="${GENERATED_MATERIAL_PRIMARY_ID}"]`),
  ).not.toHaveAttribute('data-rendered-label', /.+/u)
  await expect
    .poll(async () =>
      sandbox
        .locator('html')
        .evaluate((element, sentinel) => (element as HTMLElement).dataset[sentinel], SANDBOX_REALM_SENTINEL),
    )
    .toBe(SANDBOX_REALM_SENTINEL_VALUE)
  expect(
    await page.evaluate(sentinel => document.documentElement.dataset[sentinel], SANDBOX_REALM_SENTINEL),
  ).toBeUndefined()
}

test('production Dashboard permits only its opaque srcdoc sandbox in editor and preview', async ({ context, page }) => {
  const contentSecurityPolicyErrors: string[] = []
  const pageErrors: string[] = []
  const recordContentSecurityPolicyErrors = (target: Page) => {
    target.on('console', message => {
      if (/content security policy|refused to frame/iu.test(message.text())) {
        contentSecurityPolicyErrors.push(message.text())
      }
    })
    target.on('pageerror', error => pageErrors.push(error.message))
  }
  recordContentSecurityPolicyErrors(page)
  expect((await page.request.get(PRODUCTION_SEED_MODULE)).status()).toBe(404)
  await seedProductionProject(page)

  const editorResponse = await page.goto('/')
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expectSandboxedRenderedComponent(page, EDITOR_SURFACE_ID)

  const preview = await context.newPage()
  recordContentSecurityPolicyErrors(preview)
  const previewResponse = await preview.goto('/preview')
  await expectSandboxedRenderedComponent(preview, PREVIEW_SURFACE_ID)

  for (const response of [editorResponse, previewResponse]) {
    const policy = response?.headers()['content-security-policy'] ?? ''
    expect(policy).toBe(REQUIRED_DOCUMENT_CSP)
    expect(policy).not.toMatch(/(?:\*|blob:|data:|https?:|unsafe-inline|unsafe-eval)/u)
  }
  expect(contentSecurityPolicyErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
