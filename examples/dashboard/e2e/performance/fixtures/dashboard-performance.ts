import { type Page, expect } from '@playwright/test'
import {
  GENERATED_MATERIAL_INSTANCE_COUNT,
  GENERATED_MATERIAL_INSTANCE_IDS,
  GENERATED_MATERIAL_PRIMARY_ID,
  seedGeneratedMaterialProject,
} from '../../fixtures/generated-material-host'

export const PERFORMANCE_NODE_COUNT = 200
export const PERFORMANCE_ONLINE_NODE_COUNT = GENERATED_MATERIAL_INSTANCE_COUNT
export const PERFORMANCE_TARGET_NODE_ID = GENERATED_MATERIAL_INSTANCE_IDS[15] ?? GENERATED_MATERIAL_PRIMARY_ID
export const PERFORMANCE_EDITOR_SURFACE_ID = 'dashboard-editor-online'

const EXISTING_ORDINARY_NODE_COUNT = 1
const ADDITIONAL_ORDINARY_NODE_COUNT =
  PERFORMANCE_NODE_COUNT - PERFORMANCE_ONLINE_NODE_COUNT - EXISTING_ORDINARY_NODE_COUNT

export interface PerformanceProjectBoundary {
  readonly childNodeCount: number
  readonly onlineNodeCount: number
  readonly onlineNodeIds: readonly string[]
}

export const seedDashboardPerformanceProject = async (page: Page): Promise<PerformanceProjectBoundary> => {
  await seedGeneratedMaterialProject(page)
  await page.goto('/')
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__EASY_EDITOR_E2E__?.getEngineState() ?? null)).toBe('ready')

  await page.evaluate(async additionalNodeCount => {
    const runtime = await import('/src/editor/runtime.ts')
    const document = runtime.engine.project.currentDocument
    if (!document) throw new Error('Performance fixture requires an active Dashboard document')
    const commands = Array.from({ length: additionalNodeCount }, (_, index) => {
      const column = index % 20
      const row = Math.floor(index / 20)
      return {
        type: 'insertNode' as const,
        documentId: document.id,
        parentId: document.root.id,
        node: {
          id: `g010-ordinary-${index + 1}`,
          componentName: 'Text',
          props: { text: `G010 ordinary ${index + 1}` },
          $dashboard: {
            rect: { x: 20 + column * 90, y: 20 + row * 50, width: 72, height: 32 },
          },
          children: [],
        },
      }
    })
    runtime.engine.transactions.runOnDocument(document, commands, {
      expectedMutationVersion: document.mutationVersion,
    })
    await runtime.persistDashboardProject('manual-save')
    await runtime.dashboardPersistence.flush()
  }, ADDITIONAL_ORDINARY_NODE_COUNT)

  await page.reload()
  await expect(page.locator('.lc-simulator-canvas')).toBeVisible()
  await expect(page.locator('[data-online-component-shell]')).toHaveCount(PERFORMANCE_ONLINE_NODE_COUNT)
  await expect(page.locator(`iframe[data-online-component-sandbox="${PERFORMANCE_EDITOR_SURFACE_ID}"]`)).toHaveCount(1)

  const boundary = await page.evaluate(() => {
    const visit = (node: { componentName?: string; id?: string; children?: readonly unknown[] }) => {
      const descendants = (node.children ?? []).flatMap(child =>
        visit(child as { componentName?: string; id?: string; children?: readonly unknown[] }),
      )
      return [node, ...descendants]
    }
    return import('/src/editor/runtime.ts').then(runtime => {
      const schema = runtime.engine.project.export() as {
        componentsTree?: readonly {
          componentName?: string
          id?: string
          children?: readonly unknown[]
        }[]
      }
      const root = schema.componentsTree?.[0]
      if (!root) throw new Error('Performance fixture could not export the Dashboard root')
      const children = (root.children ?? []).flatMap(child =>
        visit(child as { componentName?: string; id?: string; children?: readonly unknown[] }),
      )
      const online = children.filter(node => node.componentName === 'GeneratedMaterialHost')
      return {
        childNodeCount: children.length,
        onlineNodeCount: online.length,
        onlineNodeIds: online.map(node => node.id ?? ''),
      }
    })
  })

  expect(boundary.childNodeCount).toBe(PERFORMANCE_NODE_COUNT)
  expect(boundary.onlineNodeCount).toBe(PERFORMANCE_ONLINE_NODE_COUNT)
  expect([...boundary.onlineNodeIds].sort()).toEqual([...GENERATED_MATERIAL_INSTANCE_IDS].sort())
  return boundary
}
