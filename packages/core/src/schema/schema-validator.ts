import { lockReadonlyProperties } from '../lifecycle/readonly-properties'
import { PolicyViolation, type TrustPolicy, findExecutableValue } from '../trust'
import type { NodeSchema, ProjectSchema } from '../types'
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  LEGACY_PROJECT_SCHEMA_VERSION,
  type SchemaPreparationResult,
  createSchemaPreparationReport,
  migrateProjectSchema,
  normalizeProjectSchema,
} from './schema-migration'

export interface SchemaValidationIssue {
  code: string
  message: string
  path: string
}

export class SchemaValidationError extends Error {
  readonly name = 'SchemaValidationError'

  constructor(readonly issues: SchemaValidationIssue[]) {
    super(`Project schema validation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const parseSemanticVersion = (value: string): readonly [number, number, number] | undefined => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const compareSemanticVersions = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number => {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

const CURRENT_PROJECT_SCHEMA_SEMVER = parseSemanticVersion(CURRENT_PROJECT_SCHEMA_VERSION) as readonly [
  number,
  number,
  number,
]

const findInvalidSchemaStructure = (
  value: unknown,
  path = '$',
  ancestors = new Set<object>(),
): SchemaValidationIssue | undefined => {
  if (!value || typeof value !== 'object') return undefined
  if (ancestors.has(value)) {
    return { code: 'schema.circular', message: 'Schema values cannot contain circular references', path }
  }
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return { code: 'schema.nonPlainObject', message: 'Schema values must use plain objects and arrays', path }
    }
  }

  ancestors.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    const keyLabel = typeof key === 'symbol' ? key.toString() : key
    const childPath = /^[A-Za-z_$][\w$]*$/.test(keyLabel)
      ? `${path}.${keyLabel}`
      : `${path}[${JSON.stringify(keyLabel)}]`
    if (descriptor?.get || descriptor?.set) {
      ancestors.delete(value)
      return { code: 'schema.accessor', message: 'Schema accessors are not allowed', path: childPath }
    }
    const issue = findInvalidSchemaStructure(descriptor?.value, childPath, ancestors)
    if (issue) {
      ancestors.delete(value)
      return issue
    }
  }
  ancestors.delete(value)
  return undefined
}

const cloneSchemaValue = <T>(value: T, visited = new Map<object, unknown>()): T => {
  if (!value || typeof value !== 'object') return value
  if (visited.has(value)) return visited.get(value) as T

  if (Array.isArray(value)) {
    const clone: unknown[] = []
    visited.set(value, clone)
    value.forEach(item => clone.push(cloneSchemaValue(item, visited)))
    return clone as T
  }

  const clone: Record<string, unknown> = {}
  visited.set(value, clone)
  Object.entries(value).forEach(([key, child]) => {
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: cloneSchemaValue(child, visited),
      writable: true,
    })
  })
  return clone as T
}

const validateNode = (
  value: unknown,
  path: string,
  issues: SchemaValidationIssue[],
  ancestors = new Set<object>(),
): void => {
  if (!isRecord(value)) {
    issues.push({ code: 'node.type', message: 'Node must be an object', path })
    return
  }
  if (ancestors.has(value)) {
    issues.push({ code: 'node.circular', message: 'Node trees cannot contain circular references', path })
    return
  }
  ancestors.add(value)

  if (typeof value.componentName !== 'string' || value.componentName.trim().length === 0) {
    issues.push({
      code: 'node.componentName.required',
      message: 'componentName must be a non-empty string',
      path: `${path}.componentName`,
    })
  }

  if (value.children !== undefined && !Array.isArray(value.children)) {
    issues.push({ code: 'node.children.type', message: 'children must be an array', path: `${path}.children` })
  } else if (Array.isArray(value.children)) {
    value.children.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, issues, ancestors))
  }
  ancestors.delete(value)
}

const validateSourceVersion = (schema: unknown): string => {
  const issues: SchemaValidationIssue[] = []
  if (!isRecord(schema)) {
    throw new SchemaValidationError([{ code: 'project.type', message: 'Project schema must be an object', path: '$' }])
  }

  const version = schema.version
  if (version === undefined || version === null || (typeof version === 'string' && version.trim().length === 0)) {
    issues.push({
      code: 'project.version.required',
      message: 'version must be a non-empty semantic version string',
      path: '$.version',
    })
  } else if (typeof version !== 'string') {
    issues.push({
      code: 'project.version.type',
      message: 'version must be a string',
      path: '$.version',
    })
  } else {
    const parsedVersion = parseSemanticVersion(version)
    if (!parsedVersion) {
      issues.push({
        code: 'project.version.format',
        message: 'version must use major.minor.patch semantic version format',
        path: '$.version',
      })
    } else if (compareSemanticVersions(parsedVersion, CURRENT_PROJECT_SCHEMA_SEMVER) > 0) {
      issues.push({
        code: 'project.version.future',
        message: `Project schema version ${version} is newer than supported version ${CURRENT_PROJECT_SCHEMA_VERSION}`,
        path: '$.version',
      })
    } else if (version !== CURRENT_PROJECT_SCHEMA_VERSION && version !== LEGACY_PROJECT_SCHEMA_VERSION) {
      issues.push({
        code: 'project.version.unsupported',
        message: `No migration path is registered from project schema version ${version}`,
        path: '$.version',
      })
    }
  }

  if (issues.length > 0) throw new SchemaValidationError(issues)
  return version as string
}

const validateCurrentProjectSchema = (schema: ProjectSchema): void => {
  const issues: SchemaValidationIssue[] = []

  if (schema.version !== CURRENT_PROJECT_SCHEMA_VERSION) {
    issues.push({
      code: 'project.version.current',
      message: `Migrated schema must use version ${CURRENT_PROJECT_SCHEMA_VERSION}`,
      path: '$.version',
    })
  }

  if (schema.componentsMap !== undefined && !Array.isArray(schema.componentsMap)) {
    issues.push({
      code: 'project.componentsMap.type',
      message: 'componentsMap must be an array when provided',
      path: '$.componentsMap',
    })
  }

  if (schema.config !== undefined && !isRecord(schema.config)) {
    issues.push({
      code: 'project.config.type',
      message: 'config must be an object when provided',
      path: '$.config',
    })
  }

  if (schema.meta !== undefined && !isRecord(schema.meta)) {
    issues.push({
      code: 'project.meta.type',
      message: 'meta must be an object when provided',
      path: '$.meta',
    })
  }

  if (schema.componentsTree === undefined) {
    issues.push({
      code: 'project.componentsTree.required',
      message: 'componentsTree is required',
      path: '$.componentsTree',
    })
  } else if (Array.isArray(schema.componentsTree)) {
    schema.componentsTree.forEach((node, index) => validateNode(node, `$.componentsTree[${index}]`, issues))
  } else {
    issues.push({
      code: 'project.componentsTree.type',
      message: 'componentsTree must be an array',
      path: '$.componentsTree',
    })
  }

  if (issues.length > 0) throw new SchemaValidationError(issues)
}

export class SchemaValidator {
  constructor(
    readonly trustPolicy: TrustPolicy,
    private readonly assertTrustBoundaryIntegrity?: (origin: string) => void,
  ) {
    lockReadonlyProperties(this, ['assertTrustBoundaryIntegrity', 'trustPolicy'])
  }

  prepare(schema: ProjectSchema): ProjectSchema {
    return this.prepareWithReport(schema).schema
  }

  prepareWithReport(schema: ProjectSchema): SchemaPreparationResult {
    this.assertSerializableStructure(schema)
    this.assertTrustedValue(schema, 'project.load')
    const sourceVersion = validateSourceVersion(schema)
    const detachedSchema = cloneSchemaValue(schema)
    const migration = migrateProjectSchema(detachedSchema)
    validateCurrentProjectSchema(migration.schema)
    const normalization = normalizeProjectSchema(migration.schema)

    return Object.freeze({
      schema: normalization.schema,
      report: createSchemaPreparationReport(sourceVersion, migration.migrations, normalization.normalizations),
    })
  }

  prepareNode(schema: NodeSchema, path = '$'): NodeSchema {
    this.assertSerializableStructure(schema, path)
    this.assertTrustedValue(schema, 'project.document')
    const issues: SchemaValidationIssue[] = []
    validateNode(schema, path, issues)
    if (issues.length > 0) {
      throw new SchemaValidationError(issues)
    }
    return cloneSchemaValue(schema)
  }

  private assertTrustedValue(value: unknown, origin: string): void {
    this.assertTrustBoundaryIntegrity?.(origin)
    const executable = findExecutableValue(value)
    if (executable && !this.trustPolicy.allowExecutableSchema) {
      throw new PolicyViolation({
        capability: 'schema.executable',
        details: executable,
        message: `Executable schema value ${executable.type} is not allowed at ${executable.path}`,
        origin,
        path: executable.path,
        rule: `${this.trustPolicy.name}.schema.executable.deny`,
      })
    }
  }

  private assertSerializableStructure(value: unknown, path = '$'): void {
    const issue = findInvalidSchemaStructure(value, path)
    if (issue) throw new SchemaValidationError([issue])
  }
}

export const validateProjectSchema = (schema: ProjectSchema, trustPolicy: TrustPolicy): ProjectSchema => {
  return new SchemaValidator(trustPolicy).prepare(schema)
}

export type { NodeSchema }
