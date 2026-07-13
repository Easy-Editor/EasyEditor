import type { ProjectSchema } from '../types'

export const LEGACY_PROJECT_SCHEMA_VERSION = '0.0.1' as const
export const CURRENT_PROJECT_SCHEMA_VERSION = '1.0.0' as const

export interface SchemaMigrationRecord {
  readonly fromVersion: string
  readonly toVersion: string
}

export interface SchemaNormalizationRecord {
  readonly code: string
  readonly message: string
  readonly path: string
}

export interface SchemaPreparationReport {
  readonly sourceVersion: string
  readonly targetVersion: typeof CURRENT_PROJECT_SCHEMA_VERSION
  readonly migrated: boolean
  readonly migrations: readonly SchemaMigrationRecord[]
  readonly normalizations: readonly SchemaNormalizationRecord[]
}

export interface SchemaPreparationResult {
  readonly schema: ProjectSchema
  readonly report: SchemaPreparationReport
}

interface SchemaMigrationResult {
  readonly schema: ProjectSchema
  readonly migrations: readonly SchemaMigrationRecord[]
}

interface SchemaNormalizationResult {
  readonly schema: ProjectSchema
  readonly normalizations: readonly SchemaNormalizationRecord[]
}

const LEGACY_TO_CURRENT_MIGRATION: SchemaMigrationRecord = Object.freeze({
  fromVersion: LEGACY_PROJECT_SCHEMA_VERSION,
  toVersion: CURRENT_PROJECT_SCHEMA_VERSION,
})

export const createEmptyProjectSchema = (): ProjectSchema => ({
  version: CURRENT_PROJECT_SCHEMA_VERSION,
  componentsMap: [],
  componentsTree: [],
})

export const migrateProjectSchema = (schema: ProjectSchema): SchemaMigrationResult => {
  if (schema.version === CURRENT_PROJECT_SCHEMA_VERSION) {
    return { schema, migrations: Object.freeze([]) }
  }

  if (schema.version === LEGACY_PROJECT_SCHEMA_VERSION) {
    // 0.0.1 already used the current tree shape. The explicit step records
    // provenance and advances the protocol version; defaults are applied by
    // the separate normalization stage below.
    return {
      schema: {
        ...schema,
        version: CURRENT_PROJECT_SCHEMA_VERSION,
      },
      migrations: Object.freeze([LEGACY_TO_CURRENT_MIGRATION]),
    }
  }

  throw new Error(`No project schema migration is registered for version "${schema.version}"`)
}

export const normalizeProjectSchema = (schema: ProjectSchema): SchemaNormalizationResult => {
  const normalizations: SchemaNormalizationRecord[] = []
  const componentsMap = schema.componentsMap ?? []

  if (schema.componentsMap === undefined) {
    normalizations.push({
      code: 'project.componentsMap.defaulted',
      message: 'componentsMap was defaulted to an empty array',
      path: '$.componentsMap',
    })
  }

  return {
    schema: {
      ...schema,
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      componentsMap,
      componentsTree: schema.componentsTree,
    },
    normalizations: Object.freeze(normalizations.map(record => Object.freeze(record))),
  }
}

export const createSchemaPreparationReport = (
  sourceVersion: string,
  migrations: readonly SchemaMigrationRecord[],
  normalizations: readonly SchemaNormalizationRecord[],
): SchemaPreparationReport => {
  return Object.freeze({
    sourceVersion,
    targetVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    migrated: migrations.length > 0,
    migrations,
    normalizations,
  })
}
