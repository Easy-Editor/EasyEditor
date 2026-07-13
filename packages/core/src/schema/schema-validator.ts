import { PolicyViolation, type TrustPolicy, findExecutableValue } from '../trust'
import type { NodeSchema, ProjectSchema } from '../types'

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
    clone[key] = cloneSchemaValue(child, visited)
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

export class SchemaValidator {
  constructor(
    readonly trustPolicy: TrustPolicy,
    private readonly assertTrustBoundaryIntegrity?: (origin: string) => void,
  ) {}

  prepare(schema: ProjectSchema): ProjectSchema {
    this.assertSerializableStructure(schema)
    this.assertTrustedValue(schema, 'project.load')
    const issues: SchemaValidationIssue[] = []

    if (isRecord(schema)) {
      if (typeof schema.version !== 'string' || schema.version.trim().length === 0) {
        issues.push({
          code: 'project.version.required',
          message: 'version must be a non-empty string',
          path: '$.version',
        })
      }
      if (Array.isArray(schema.componentsTree)) {
        schema.componentsTree.forEach((node, index) => validateNode(node, `$.componentsTree[${index}]`, issues))
      } else {
        issues.push({
          code: 'project.componentsTree.type',
          message: 'componentsTree must be an array',
          path: '$.componentsTree',
        })
      }
    } else {
      issues.push({ code: 'project.type', message: 'Project schema must be an object', path: '$' })
    }

    if (issues.length > 0) {
      throw new SchemaValidationError(issues)
    }

    return cloneSchemaValue(schema)
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
