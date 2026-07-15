import { defaultRootSchema } from '@/editor/const'
import { CURRENT_PROJECT_SCHEMA_VERSION, type ProjectSchema, type RootSchema } from '@easy-editor/core/instance'

const PROJECT_SCHEMA = 'projectSchema'
const PAGE_INFO = 'pageInfo'
const PREFIX_PAGE_SCHEMA = 'pageSchema'

type LegacyProjectSchema = {
  componentsMap?: ProjectSchema<RootSchema>['componentsMap']
  componentsTree: RootSchema[]
}

type ProjectSchemaInput = LegacyProjectSchema | ProjectSchema<RootSchema> | RootSchema

const getPageName = (pageId: string) => {
  return `${PREFIX_PAGE_SCHEMA}:${pageId}`
}

const generateProjectSchema = (pageSchema: RootSchema): ProjectSchema<RootSchema> => {
  return {
    componentsTree: [pageSchema],
    // componentsMap: material.componentsMap as any,
    version: CURRENT_PROJECT_SCHEMA_VERSION,
  }
}

const normalizeProjectSchema = (value: unknown): ProjectSchema<RootSchema> | null => {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray((value as Partial<ProjectSchema>).componentsTree)) {
    const schema = value as ProjectSchema<RootSchema>
    return {
      ...schema,
      version: schema.version ?? CURRENT_PROJECT_SCHEMA_VERSION,
    }
  }
  return generateProjectSchema(value as RootSchema)
}

export const getProjectSchemaFromLocalStorage = (): ProjectSchema<RootSchema> => {
  const projectSchema = localStorage.getItem(PROJECT_SCHEMA)
  return (
    normalizeProjectSchema(projectSchema ? JSON.parse(projectSchema) : defaultRootSchema) ??
    generateProjectSchema(defaultRootSchema)
  )
}

export const saveProjectSchemaToLocalStorage = (schema: ProjectSchemaInput) => {
  const normalizedSchema = normalizeProjectSchema(schema)
  if (!normalizedSchema) throw new TypeError('Project schema must be an object')
  localStorage.setItem(PROJECT_SCHEMA, JSON.stringify(normalizedSchema))
}

export const getPageSchemaFromLocalStorage = (pageId: string) => {
  const pageSchema = localStorage.getItem(getPageName(pageId))
  return pageSchema ? normalizeProjectSchema(JSON.parse(pageSchema)) : null
}

export const savePageSchemaToLocalStorage = (pageId: string, schema: ProjectSchemaInput) => {
  const normalizedSchema = normalizeProjectSchema(schema)
  if (!normalizedSchema) throw new TypeError('Page schema must be an object')
  localStorage.setItem(getPageName(pageId), JSON.stringify(normalizedSchema))
}

export const savePageInfoToLocalStorage = (info: Array<{ path: string; title: string }>) => {
  localStorage.setItem(PAGE_INFO, JSON.stringify(info))
}

export const getPageInfoFromLocalStorage = (): Array<{ path: string; title: string }> => {
  const pageInfo = localStorage.getItem(PAGE_INFO)
  return pageInfo ? JSON.parse(pageInfo) : []
}
