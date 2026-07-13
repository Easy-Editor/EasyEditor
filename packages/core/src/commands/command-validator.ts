import type { EditorCommand } from './types'

export interface CommandValidationIssue {
  code: string
  message: string
  path: string
}

export class CommandValidationError extends Error {
  readonly name = 'CommandValidationError'

  constructor(readonly issues: CommandValidationIssue[]) {
    super(`Command validation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const requireString = (value: unknown, path: string, field: string, issues: CommandValidationIssue[]): void => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ code: `${field}.required`, message: `${field} must be a non-empty string`, path })
  }
}

const validateAt = (value: unknown, path: string, issues: CommandValidationIssue[]): void => {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < -1)) {
    issues.push({ code: 'at.invalid', message: 'at must be an integer greater than or equal to -1', path })
  }
}

const validateOptionalNodeId = (value: unknown, path: string, issues: CommandValidationIssue[]): void => {
  if (value === undefined) return
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    issues.push({
      code: 'node.id.invalid',
      message: 'node id must be a non-empty string no longer than 256 characters',
      path,
    })
  }
}

const validateNode = (
  value: unknown,
  path: string,
  issues: CommandValidationIssue[],
  ancestors = new Set<object>(),
) => {
  if (!isRecord(value)) {
    issues.push({ code: 'node.type', message: 'node must be an object', path })
    return
  }
  if (ancestors.has(value)) {
    issues.push({ code: 'node.circular', message: 'node cannot contain circular children', path })
    return
  }
  ancestors.add(value)
  validateOptionalNodeId(value.id, `${path}.id`, issues)
  requireString(value.componentName, `${path}.componentName`, 'componentName', issues)
  if (value.children !== undefined && !Array.isArray(value.children)) {
    issues.push({ code: 'node.children.type', message: 'children must be an array', path: `${path}.children` })
  } else if (Array.isArray(value.children)) {
    value.children.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, issues, ancestors))
  }
  ancestors.delete(value)
}

export function validateCommands(commands: readonly unknown[]): asserts commands is readonly EditorCommand[] {
  const issues: CommandValidationIssue[] = []

  commands.forEach((command, index) => {
    const path = `$[${index}]`
    if (!isRecord(command)) {
      issues.push({ code: 'command.type', message: 'command must be an object', path })
      return
    }
    if (command.documentId !== undefined) {
      requireString(command.documentId, `${path}.documentId`, 'documentId', issues)
    }

    switch (command.type) {
      case 'insertNode':
        requireString(command.parentId, `${path}.parentId`, 'parentId', issues)
        validateNode(command.node, `${path}.node`, issues)
        validateAt(command.at, `${path}.at`, issues)
        break
      case 'updateProps':
        requireString(command.nodeId, `${path}.nodeId`, 'nodeId', issues)
        if (command.props === undefined && command.extras === undefined) {
          issues.push({
            code: 'updateProps.empty',
            message: 'updateProps requires props, extras, or both',
            path,
          })
        }
        if (command.props !== undefined && !isRecord(command.props)) {
          issues.push({ code: 'props.type', message: 'props must be an object', path: `${path}.props` })
        }
        if (command.extras !== undefined && !isRecord(command.extras)) {
          issues.push({ code: 'extras.type', message: 'extras must be an object', path: `${path}.extras` })
        }
        break
      case 'removeNode':
        requireString(command.nodeId, `${path}.nodeId`, 'nodeId', issues)
        break
      case 'moveNode':
        requireString(command.nodeId, `${path}.nodeId`, 'nodeId', issues)
        requireString(command.parentId, `${path}.parentId`, 'parentId', issues)
        validateAt(command.at, `${path}.at`, issues)
        break
      default:
        issues.push({
          code: 'command.unsupported',
          message: `Unsupported command type: ${String(command.type)}`,
          path: `${path}.type`,
        })
    }
  })

  if (issues.length) throw new CommandValidationError(issues)
}
