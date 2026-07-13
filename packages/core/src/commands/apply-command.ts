import type { Document } from '../document'
import type { CommandResult, EditorCommand } from './types'

export interface ApplyCommandOptions {
  readonly invokeNodeCallbacks?: boolean
}

const requireNode = (document: Document, nodeId: string) => {
  const node = document.getNode(nodeId)
  if (!node) {
    throw new Error(`Command target node "${nodeId}" does not exist`)
  }
  return node
}

export const applyCommand = (
  document: Document,
  command: EditorCommand,
  options: ApplyCommandOptions = {},
): CommandResult => {
  if (command.documentId && command.documentId !== document.id) {
    throw new Error(`Cross-document command is not allowed in V1: ${command.documentId}`)
  }

  switch (command.type) {
    case 'insertNode': {
      const parent = requireNode(document, command.parentId)
      if (parent.isLocked) {
        throw new Error(`Cannot insert a node into locked parent "${parent.id}"`)
      }
      if (command.node.id && document.hasNode(command.node.id)) {
        throw new Error(`Command node id "${command.node.id}" already exists`)
      }
      const nodeSchema = structuredClone(command.node)
      const inserted =
        options.invokeNodeCallbacks === false
          ? document.createNode(nodeSchema, true, { invokeMaterialHooks: false })
          : undefined
      if (inserted) parent.children?.internalInsert(inserted, command.at, false)
      const committedNode = inserted ?? document.insertNode(parent, nodeSchema, command.at)
      if (!committedNode) {
        throw new Error(`Unable to insert node under "${command.parentId}"`)
      }
      return { affectedNodeIds: [committedNode.id], command }
    }
    case 'updateProps': {
      const node = requireNode(document, command.nodeId)
      if (node.isLocked) {
        throw new Error(`Cannot update locked node "${node.id}"`)
      }
      node.mergeProps(command.props ?? {}, command.extras)
      return { affectedNodeIds: [node.id], command }
    }
    case 'removeNode': {
      const node = requireNode(document, command.nodeId)
      if (node.isRoot) {
        throw new Error('The root node cannot be removed by a V1 command')
      }
      if (node.isLocked) {
        throw new Error(`Cannot remove locked node "${node.id}"`)
      }
      document.removeNode(node)
      return { affectedNodeIds: [command.nodeId], command }
    }
    case 'moveNode': {
      const node = requireNode(document, command.nodeId)
      const parent = requireNode(document, command.parentId)
      if (node.isRoot) {
        throw new Error('The root node cannot be moved')
      }
      if (node.isLocked || parent.isLocked) {
        throw new Error('Locked nodes and locked parents cannot participate in moveNode')
      }
      if (node.contains(parent)) {
        throw new Error(`Cannot move node "${node.id}" into itself or its descendant`)
      }
      if (options.invokeNodeCallbacks === false) {
        parent.children?.internalInsert(node, command.at, false)
      } else {
        document.insertNode(parent, node, command.at)
      }
      return { affectedNodeIds: [node.id, parent.id], command }
    }
  }
}
