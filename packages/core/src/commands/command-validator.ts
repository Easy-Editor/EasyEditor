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

const MAX_UNSET_PATHS = 100
const MAX_UNSET_PATH_LENGTH = 256
const MAX_UNSET_PATH_DEPTH = 32
const MAX_UNSET_PATH_SEGMENT_LENGTH = 128
const MAX_UNSET_PATH_TOTAL_LENGTH = 8192
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

interface NormalizedPropertyPath {
  readonly index: number
  readonly path: string
  readonly segments: readonly string[]
}

type PropertyPathParseResult =
  | { readonly ok: true; readonly path: string; readonly segments: readonly string[] }
  | { readonly ok: false; readonly code: 'unset.path.dangerous' | 'unset.path.invalid'; readonly message: string }

const parsePropertyPath = (value: unknown): PropertyPathParseResult => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_UNSET_PATH_LENGTH ||
    value !== value.trim() ||
    value.normalize('NFC') !== value ||
    /[\s[\]]/u.test(value)
  ) {
    return {
      ok: false,
      code: 'unset.path.invalid',
      message: `unset path must be a normalized dotted string no longer than ${MAX_UNSET_PATH_LENGTH} characters`,
    }
  }

  const segments = value.split('.')
  if (
    segments.length > MAX_UNSET_PATH_DEPTH ||
    segments.some(segment => segment.length === 0 || segment.length > MAX_UNSET_PATH_SEGMENT_LENGTH)
  ) {
    return {
      ok: false,
      code: 'unset.path.invalid',
      message: `unset path must contain 1-${MAX_UNSET_PATH_DEPTH} non-empty bounded segments`,
    }
  }
  if (segments.some(segment => DANGEROUS_PATH_SEGMENTS.has(segment))) {
    return {
      ok: false,
      code: 'unset.path.dangerous',
      message: 'unset path cannot contain __proto__, prototype, or constructor segments',
    }
  }

  return { ok: true, path: segments.join('.'), segments }
}

const isPathAncestor = (ancestor: readonly string[], descendant: readonly string[]): boolean => {
  return ancestor.length < descendant.length && ancestor.every((segment, index) => segment === descendant[index])
}

const pathsOverlap = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length === right.length) return left.every((segment, index) => segment === right[index])
  return isPathAncestor(left, right) || isPathAncestor(right, left)
}

/** Mirrors the existing Core dot/bracket lookup grammar for overlap comparison only. */
const splitSetPropertyPath = (path: string): readonly string[] => {
  const segments: string[] = []
  let remaining = path

  while (remaining.length > 0) {
    let entry = remaining
    let nest = ''
    const objectIndex = remaining.indexOf('.', 1)
    const arrayIndex = remaining.indexOf('[', 1)

    if (objectIndex > 0 && ((arrayIndex > 0 && objectIndex < arrayIndex) || arrayIndex < 0)) {
      entry = remaining.slice(0, objectIndex)
      nest = remaining.slice(objectIndex + 1)
    } else if (arrayIndex > 0) {
      entry = remaining.slice(0, arrayIndex)
      nest = remaining.slice(arrayIndex)
    }
    if (entry.startsWith('[')) entry = entry.slice(1, entry.length - 1)
    segments.push(entry)
    if (nest.length === 0) break
    remaining = nest
  }

  return segments
}

const validateUnsetPaths = (
  value: unknown,
  path: string,
  issues: CommandValidationIssue[],
): readonly NormalizedPropertyPath[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    issues.push({ code: 'unset.paths.type', message: 'unset paths must be an array', path })
    return []
  }
  if (value.length > MAX_UNSET_PATHS) {
    issues.push({
      code: 'unset.paths.limit',
      message: `unset paths cannot contain more than ${MAX_UNSET_PATHS} entries`,
      path,
    })
    return []
  }

  const normalized: NormalizedPropertyPath[] = []
  const firstIndexes = new Map<string, number>()
  let totalLength = 0

  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      issues.push({
        code: 'unset.path.missing',
        message: 'unset paths must be a dense array of own data values',
        path: itemPath,
      })
      continue
    }

    const parsed = parsePropertyPath(descriptor.value)
    if (!parsed.ok) {
      issues.push({ code: parsed.code, message: parsed.message, path: itemPath })
      continue
    }
    totalLength += parsed.path.length
    if (totalLength > MAX_UNSET_PATH_TOTAL_LENGTH) {
      issues.push({
        code: 'unset.paths.limit',
        message: `unset path characters cannot exceed ${MAX_UNSET_PATH_TOTAL_LENGTH} in total`,
        path,
      })
      return normalized
    }

    const firstIndex = firstIndexes.get(parsed.path)
    if (firstIndex !== undefined) {
      issues.push({
        code: 'unset.path.duplicate',
        message: `unset path duplicates ${path}[${firstIndex}]`,
        path: itemPath,
      })
      continue
    }
    firstIndexes.set(parsed.path, index)
    normalized.push({ index, path: parsed.path, segments: parsed.segments })
  }

  for (let index = 0; index < normalized.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < normalized.length; otherIndex += 1) {
      const left = normalized[index]
      const right = normalized[otherIndex]
      if (!isPathAncestor(left.segments, right.segments) && !isPathAncestor(right.segments, left.segments)) continue
      issues.push({
        code: 'unset.path.overlap',
        message: `unset paths cannot contain ancestor/descendant overlap between "${left.path}" and "${right.path}"`,
        path: `${path}[${right.index}]`,
      })
    }
  }

  return normalized
}

const validateSetUnsetOverlap = (
  setValue: unknown,
  unsetPaths: readonly NormalizedPropertyPath[],
  path: string,
  issues: CommandValidationIssue[],
): void => {
  if (!isRecord(setValue) || unsetPaths.length === 0) return

  const setPaths = Object.keys(setValue).map(key => ({ path: key, segments: splitSetPropertyPath(key) }))

  for (const unsetPath of unsetPaths) {
    const setPath = setPaths.find(candidate => pathsOverlap(candidate.segments, unsetPath.segments))
    if (!setPath) continue
    issues.push({
      code: 'updateProps.set-unset.overlap',
      message: `updateProps cannot set "${setPath.path}" and unset overlapping path "${unsetPath.path}"`,
      path: `${path}[${unsetPath.index}]`,
    })
  }
}

const COMMAND_FIELDS = {
  insertNode: new Set(['type', 'documentId', 'parentId', 'node', 'at']),
  updateProps: new Set(['type', 'documentId', 'nodeId', 'props', 'extras', 'unsetPropPaths', 'unsetExtraPaths']),
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
        if (
          command.props === undefined &&
          command.extras === undefined &&
          command.unsetPropPaths === undefined &&
          command.unsetExtraPaths === undefined
        ) {
          issues.push({
            code: 'updateProps.empty',
            message: 'updateProps requires at least one set or unset field',
            path,
          })
        }
        if (command.props !== undefined && !isRecord(command.props)) {
          issues.push({ code: 'props.type', message: 'props must be an object', path: `${path}.props` })
        }
        if (command.extras !== undefined && !isRecord(command.extras)) {
          issues.push({ code: 'extras.type', message: 'extras must be an object', path: `${path}.extras` })
        }
        {
          const unsetPropPaths = validateUnsetPaths(command.unsetPropPaths, `${path}.unsetPropPaths`, issues)
          const unsetExtraPaths = validateUnsetPaths(command.unsetExtraPaths, `${path}.unsetExtraPaths`, issues)
          validateSetUnsetOverlap(command.props, unsetPropPaths, `${path}.unsetPropPaths`, issues)
          validateSetUnsetOverlap(command.extras, unsetExtraPaths, `${path}.unsetExtraPaths`, issues)
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
