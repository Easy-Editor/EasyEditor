import type { Document } from '../document'
import type { Node } from '../document'
import type { NodeSchema } from '../types'
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

const requireNonRootParent = (node: Node, operation: EditorCommand['type']): Node => {
  if (node.isRoot || !node.parent) {
    throw new Error(`The root node cannot participate in ${operation}`)
  }
  if (!node.parent.children) {
    throw new Error(`Command parent "${node.parent.id}" cannot contain children`)
  }
  return node.parent
}

const collectSchemaIds = (schema: NodeSchema, ids: string[] = []): string[] => {
  if (schema.id) ids.push(schema.id)
  schema.children?.forEach(child => collectSchemaIds(child, ids))
  return ids
}

const collectNodeIds = (node: Node, ids: string[] = []): string[] => {
  ids.push(node.id)
  node.childrenNodes.forEach(child => collectNodeIds(child, ids))
  return ids
}

const assertNodeTreeIdsAvailable = (document: Document, schema: NodeSchema): void => {
  for (const id of collectSchemaIds(schema)) {
    if (document.hasNode(id)) {
      throw new Error(`Command node id "${id}" already exists`)
    }
  }
}

const createDetachedNode = (document: Document, schema: NodeSchema, invokeNodeCallbacks: boolean): Node => {
  assertNodeTreeIdsAvailable(document, schema)
  return document.createNode(structuredClone(schema), true, {
    invokeMaterialHooks: invokeNodeCallbacks,
  })
}

const insertAt = (parent: Node, node: Node, at: number | undefined, invokeNodeCallbacks: boolean): void => {
  const children = parent.children
  if (!children) throw new Error(`Command parent "${parent.id}" cannot contain children`)
  children.internalInsert(node, at, invokeNodeCallbacks)
}

const removeNode = (document: Document, node: Node, invokeNodeCallbacks: boolean): void => {
  if (invokeNodeCallbacks) document.removeNode(node)
  else node.remove(true, false)
}

export const applyCommand = (
  document: Document,
  command: EditorCommand,
  options: ApplyCommandOptions = {},
): CommandResult => {
  if (command.documentId && command.documentId !== document.id) {
    throw new Error(`Cross-document command is not allowed in V1: ${command.documentId}`)
  }
  const invokeNodeCallbacks = options.invokeNodeCallbacks !== false

  switch (command.type) {
    case 'insertNode': {
      const parent = requireNode(document, command.parentId)
      if (parent.isLocked) {
        throw new Error(`Cannot insert a node into locked parent "${parent.id}"`)
      }
      const inserted = createDetachedNode(document, command.node, invokeNodeCallbacks)
      insertAt(parent, inserted, command.at, invokeNodeCallbacks)
      return { affectedNodeIds: collectNodeIds(inserted), command }
    }
    case 'updateProps': {
      const node = requireNode(document, command.nodeId)
      if (node.isLocked) {
        throw new Error(`Cannot update locked node "${node.id}"`)
      }
      node.mergeProps(command.props ?? {}, command.extras)
      command.unsetPropPaths?.forEach(path => node.clearPropValue(path))
      command.unsetExtraPaths?.forEach(path => node.clearExtraPropValue(path))
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
      removeNode(document, node, invokeNodeCallbacks)
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
      insertAt(parent, node, command.at ?? -1, invokeNodeCallbacks)
      return { affectedNodeIds: [node.id, parent.id], command }
    }
    case 'replace': {
      const target = requireNode(document, command.nodeId)
      const parent = requireNonRootParent(target, command.type)
      if (target.isLocked || parent.isLocked) {
        throw new Error('Locked nodes and locked parents cannot participate in replace')
      }
      const targetIndex = target.index
      const wasSelected = document.designer.selection.has(target.id)
      const replacement = createDetachedNode(document, command.node, invokeNodeCallbacks)
      insertAt(parent, replacement, targetIndex, invokeNodeCallbacks)
      removeNode(document, target, invokeNodeCallbacks)
      if (wasSelected) document.designer.selection.select(replacement.id)
      return { affectedNodeIds: [target.id, ...collectNodeIds(replacement), parent.id], command }
    }
    case 'insertBefore':
    case 'insertAfter': {
      const reference = requireNode(document, command.nodeId)
      const parent = requireNonRootParent(reference, command.type)
      if (parent.isLocked) {
        throw new Error(`Cannot ${command.type} under locked parent "${parent.id}"`)
      }
      const inserted = createDetachedNode(document, command.node, invokeNodeCallbacks)
      const offset = command.type === 'insertAfter' ? 1 : 0
      insertAt(parent, inserted, reference.index + offset, invokeNodeCallbacks)
      return { affectedNodeIds: [...collectNodeIds(inserted), parent.id], command }
    }
    case 'wrap': {
      const target = requireNode(document, command.nodeId)
      const parent = requireNonRootParent(target, command.type)
      if (target.isLocked || parent.isLocked) {
        throw new Error('Locked nodes and locked parents cannot participate in wrap')
      }
      const wrapper = createDetachedNode(
        document,
        { ...structuredClone(command.node), children: [] },
        invokeNodeCallbacks,
      )
      insertAt(parent, wrapper, target.index, invokeNodeCallbacks)
      insertAt(wrapper, target, -1, invokeNodeCallbacks)
      return { affectedNodeIds: [wrapper.id, target.id, parent.id], command }
    }
    case 'unwrap': {
      const wrapper = requireNode(document, command.nodeId)
      const parent = requireNonRootParent(wrapper, command.type)
      const promoted = wrapper.childrenNodes.slice()
      if (wrapper.isLocked || parent.isLocked || promoted.some(child => child.isLocked)) {
        throw new Error('Locked wrappers, children, and parents cannot participate in unwrap')
      }
      const wrapperIndex = wrapper.index
      promoted.forEach((child, index) => {
        insertAt(parent, child, wrapperIndex + index, invokeNodeCallbacks)
      })
      removeNode(document, wrapper, invokeNodeCallbacks)
      return { affectedNodeIds: [wrapper.id, ...promoted.map(child => child.id), parent.id], command }
    }
  }
}
