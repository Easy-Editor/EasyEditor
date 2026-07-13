import { type EditorCommand, type EditorCommandType, isEditorCommandType } from './types'

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
  ids = new Map<string, string>(),
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
  if (typeof value.id === 'string' && value.id.trim().length > 0 && value.id.length <= 256) {
    const firstPath = ids.get(value.id)
    if (firstPath) {
      issues.push({
        code: 'node.id.duplicate',
        message: `node id must be unique within the command node tree; first declared at ${firstPath}`,
        path: `${path}.id`,
      })
    } else {
      ids.set(value.id, `${path}.id`)
    }
  }
  requireString(value.componentName, `${path}.componentName`, 'componentName', issues)
  if (value.children !== undefined && !Array.isArray(value.children)) {
    issues.push({ code: 'node.children.type', message: 'children must be an array', path: `${path}.children` })
  } else if (Array.isArray(value.children)) {
    value.children.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, issues, ancestors, ids))
  }
  ancestors.delete(value)
}

const COMMAND_FIELDS = {
  insertNode: new Set(['type', 'documentId', 'parentId', 'node', 'at']),
  updateProps: new Set(['type', 'documentId', 'nodeId', 'props', 'extras']),
  removeNode: new Set(['type', 'documentId', 'nodeId']),
  moveNode: new Set(['type', 'documentId', 'nodeId', 'parentId', 'at']),
  replace: new Set(['type', 'documentId', 'nodeId', 'node']),
  insertBefore: new Set(['type', 'documentId', 'nodeId', 'node']),
  insertAfter: new Set(['type', 'documentId', 'nodeId', 'node']),
  wrap: new Set(['type', 'documentId', 'nodeId', 'node']),
  unwrap: new Set(['type', 'documentId', 'nodeId']),
} satisfies Record<EditorCommandType, ReadonlySet<string>>

const validateKnownCommandFields = (
  command: Record<string, unknown>,
  type: EditorCommandType,
  path: string,
  issues: CommandValidationIssue[],
): void => {
  for (const key of Object.keys(command)) {
    if (!COMMAND_FIELDS[type].has(key)) {
      issues.push({
        code: 'command.field.unsupported',
        message: `Unsupported field for ${type}: ${key}`,
        path: `${path}.${key}`,
      })
    }
  }
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
    if (isEditorCommandType(command.type)) validateKnownCommandFields(command, command.type, path, issues)

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
      case 'replace':
      case 'insertBefore':
      case 'insertAfter':
        requireString(command.nodeId, `${path}.nodeId`, 'nodeId', issues)
        validateNode(command.node, `${path}.node`, issues)
        break
      case 'wrap':
        requireString(command.nodeId, `${path}.nodeId`, 'nodeId', issues)
        validateNode(command.node, `${path}.node`, issues)
        if (isRecord(command.node) && Array.isArray(command.node.children) && command.node.children.length > 0) {
          issues.push({
            code: 'wrap.children.notEmpty',
            message: 'wrap node children must be omitted or empty; the target becomes its only child',
            path: `${path}.node.children`,
          })
        }
        break
      case 'unwrap':
        requireString(command.nodeId, `${path}.nodeId`, 'nodeId', issues)
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
