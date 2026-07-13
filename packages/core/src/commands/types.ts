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
  props: PropsMap
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

export type EditorCommand = InsertNodeCommand | UpdatePropsCommand | RemoveNodeCommand | MoveNodeCommand

export interface CommandResult {
  affectedNodeIds: string[]
  command: EditorCommand
}

export interface TransactionResult {
  affectedNodeIds: string[]
  commandCount: number
  ok: true
}
