import { expect, test } from '@playwright/test'
import {
  GENERATED_MATERIAL_INSTANCE_COUNT,
  GENERATED_MATERIAL_ORDINARY_TEXT,
  seedGeneratedMaterialProject,
} from './fixtures/generated-material-host'

const expectNoOnlineSurfaceEffects = async (page: Parameters<typeof seedGeneratedMaterialProject>[0]) => {
  await expect(page.locator('iframe[data-online-component-sandbox]')).toHaveCount(0)
  await expect(page.locator('[data-online-component-shell]')).toHaveCount(0)
  await expect(page.locator('[data-online-component-surface]')).toHaveCount(0)
  const activationState = await page.evaluate(() =>
    Object.keys(localStorage).filter(key => key.startsWith('easy-editor:online-component-activation:')),
  )
  expect(activationState).toEqual([])
}

test('dashboard default-off editor and preview allocate no online surface resources', async ({ page }) => {
  await seedGeneratedMaterialProject(page)

  await page.goto('/')
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expect(page.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })).toBeVisible()
  await expect(page.locator('[data-easy-editor-generated-material-host]')).toHaveCount(
    GENERATED_MATERIAL_INSTANCE_COUNT,
  )
  await expectNoOnlineSurfaceEffects(page)

  await page.reload()
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expect(page.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })).toBeVisible()
  await expect(page.locator('[data-easy-editor-generated-material-host]')).toHaveCount(
    GENERATED_MATERIAL_INSTANCE_COUNT,
  )
  await expectNoOnlineSurfaceEffects(page)

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: '预览' }).click()
  const preview = await popupPromise
  await expect(preview).toHaveURL(/\/preview$/)
  await expect(preview.getByText(GENERATED_MATERIAL_ORDINARY_TEXT, { exact: true })).toBeVisible()
  await expect(preview.locator('[data-easy-editor-generated-material-host]')).toHaveCount(
    GENERATED_MATERIAL_INSTANCE_COUNT,
  )
  await expectNoOnlineSurfaceEffects(preview)
  await preview.close()
})
