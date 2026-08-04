import type { ComponentsMap, ProjectSchema, RootSchema } from '@easy-editor/core'

export type PureDashboardPageChangeHandler = (pageSchema: RootSchema) => void

export async function navigatePureDashboardPage({
  projectSchema,
  path,
  onBeforeNavigate,
  onPageChange,
}: {
  projectSchema: ProjectSchema
  path?: string
  onBeforeNavigate?: (pageSchema: RootSchema, componentsMap?: ComponentsMap) => Promise<void>
  onPageChange?: PureDashboardPageChangeHandler
}): Promise<RootSchema | undefined> {
  const pageSchema = path
    ? projectSchema.componentsTree.find(item => item.fileName === path)
    : projectSchema.componentsTree[0]

  if (!pageSchema) {
    return undefined
  }

  await onBeforeNavigate?.(pageSchema, projectSchema.componentsMap)
  onPageChange?.(pageSchema)
  return pageSchema
}
