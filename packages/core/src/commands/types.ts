import type { PropsMap } from '../document'
import type { NodeSchema } from '../types'

interface DocumentScopedCommand {
  documentId?: string
}

export interface InsertNodeCommand extends DocumentScopedCommand {
  type: 'insertNode'
  parentId: string
  node: NodeSchema
  at?: number
}

export interface UpdatePropsCommand extends DocumentScopedCommand {
  type: 'updateProps'
  nodeId: string
  props?: PropsMap
  extras?: PropsMap
}

export interface RemoveNodeCommand extends DocumentScopedCommand {
  type: 'removeNode'
  nodeId: string
}

export interface MoveNodeCommand extends DocumentScopedCommand {
  type: 'moveNode'
  nodeId: string
  parentId: string
  at?: number
}

/** Replace a non-root node with a newly-created node tree at the same index. */
export interface ReplaceNodeCommand extends DocumentScopedCommand {
  type: 'replace'
  nodeId: string
  node: NodeSchema
}

/** Insert a newly-created node tree immediately before a non-root reference node. */
export interface InsertBeforeCommand extends DocumentScopedCommand {
  type: 'insertBefore'
  nodeId: string
  node: NodeSchema
}

/** Insert a newly-created node tree immediately after a non-root reference node. */
export interface InsertAfterCommand extends DocumentScopedCommand {
  type: 'insertAfter'
  nodeId: string
  node: NodeSchema
}

/** Wrap a non-root node with a newly-created, initially-empty wrapper node. */
export interface WrapNodeCommand extends DocumentScopedCommand {
  type: 'wrap'
  nodeId: string
  node: NodeSchema
}

/** Remove a non-root wrapper and promote its children in-place, preserving order and identity. */
export interface UnwrapNodeCommand extends DocumentScopedCommand {
  type: 'unwrap'
  nodeId: string
}

export interface EditorCommandMap {
  insertNode: InsertNodeCommand
  updateProps: UpdatePropsCommand
  removeNode: RemoveNodeCommand
  moveNode: MoveNodeCommand
  replace: ReplaceNodeCommand
  insertBefore: InsertBeforeCommand
  insertAfter: InsertAfterCommand
  wrap: WrapNodeCommand
  unwrap: UnwrapNodeCommand
}

export type EditorCommandType = keyof EditorCommandMap

export type EditorCommand = EditorCommandMap[EditorCommandType]

const EDITOR_COMMAND_TYPE_CATALOG = Object.freeze({
  insertNode: true,
  updateProps: true,
  removeNode: true,
  moveNode: true,
  replace: true,
  insertBefore: true,
  insertAfter: true,
  wrap: true,
  unwrap: true,
} satisfies Record<EditorCommandType, true>)

/** Runtime command allowlists derive from the same catalog as the TypeScript union. */
export const EDITOR_COMMAND_TYPES = Object.freeze(Object.keys(EDITOR_COMMAND_TYPE_CATALOG) as EditorCommandType[])

export const isEditorCommandType = (value: unknown): value is EditorCommandType => {
  return typeof value === 'string' && Object.hasOwn(EDITOR_COMMAND_TYPE_CATALOG, value)
}

export interface CommandResult {
  affectedNodeIds: string[]
  command: EditorCommand
}

export interface TransactionResult {
  affectedNodeIds: string[]
  commandCount: number
  ok: true
}
