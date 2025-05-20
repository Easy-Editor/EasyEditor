import { defaultRootSchema } from '@/editor/const'
import type { ProjectSchema } from '@easy-editor/core'

const PROJECT_SCHEMA = 'projectSchema'
const PAGE_INFO = 'pageInfo'
const PREFIX_PAGE_SCHEMA = 'pageSchema'

const getPageName = (pageId: string) => {
  return `${PREFIX_PAGE_SCHEMA}:${pageId}`
}

const generateProjectSchema = (pageSchema: any): ProjectSchema => {
  return {
    componentsTree: [pageSchema],
    // componentsMap: material.componentsMap as any,
    version: '1.0.0',
  }
}

export const getProjectSchemaFromLocalStorage = () => {
  const projectSchema = localStorage.getItem(PROJECT_SCHEMA)
  return projectSchema ? JSON.parse(projectSchema) : defaultRootSchema
}

export const saveProjectSchemaToLocalStorage = (schema: any) => {
  localStorage.setItem(PROJECT_SCHEMA, JSON.stringify(schema))
}

export const getPageSchemaFromLocalStorage = (pageId: string) => {
  const pageSchema = localStorage.getItem(getPageName(pageId))
  return pageSchema ? (JSON.parse(pageSchema) as ProjectSchema) : null
}

export const savePageSchemaToLocalStorage = (pageId: string, schema: any) => {
  localStorage.setItem(getPageName(pageId), JSON.stringify(generateProjectSchema(schema)))
}

export const savePageInfoToLocalStorage = (info: Array<{ path: string; title: string }>) => {
  localStorage.setItem(PAGE_INFO, JSON.stringify(info))
}

export const getPageInfoFromLocalStorage = (): Array<{ path: string; title: string }> => {
  const pageInfo = localStorage.getItem(PAGE_INFO)
  return pageInfo ? JSON.parse(pageInfo) : []
}
