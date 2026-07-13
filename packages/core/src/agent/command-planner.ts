import { isEditorCommandType, validateCommands } from '../commands'
import type { EditorCommand } from '../commands'
import type { NodeSchema, RootSchema } from '../types'
import { uniqueId } from '../utils/unique-id'
import { AgentCapabilityError } from './errors'
import { AGENT_NODE_STANDARD_KEYS, isSafeAgentExtraKey, isSafeAgentPropKey } from './policy'
import { deepFreezeAgentData, prepareAgentData, serializeCanonicalAgentSnapshotData } from './strict-data-validator'
import type { AgentCapabilityGrant, AgentCommandAuditSummary, AgentCommandEffect, AgentEditorCommand } from './types'

const NODE_STANDARD_KEYS = new Set<string>(AGENT_NODE_STANDARD_KEYS)

interface ProjectedNode {
  id: string
  parentId?: string
  children: string[]
  componentName: string
  locked: boolean
}

export interface PlannedAgentCommands {
  readonly commands: readonly EditorCommand[]
  readonly effects: readonly AgentCommandEffect[]
  readonly expectedSerialized: string
  readonly summary: AgentCommandAuditSummary
}

interface MutableSchemaEntry {
  node: NodeSchema
  parent?: NodeSchema
}

const violation = (code: string, message: string): never => {
  throw new AgentCapabilityError({ action: 'preview', code, message })
}

const assertKnownCommandFields = (command: Record<string, unknown>, index: number): void => {
  const common = new Set(['type'])
  let allowed = common
  switch (command.type) {
    case 'insertNode':
      allowed = new Set([...common, 'parentId', 'node', 'at'])
      break
    case 'updateProps':
      allowed = new Set([...common, 'nodeId', 'props', 'extras'])
      break
    case 'removeNode':
    case 'unwrap':
      allowed = new Set([...common, 'nodeId'])
      break
    case 'moveNode':
      allowed = new Set([...common, 'nodeId', 'parentId', 'at'])
      break
    case 'replace':
    case 'insertBefore':
    case 'insertAfter':
    case 'wrap':
      allowed = new Set([...common, 'nodeId', 'node'])
      break
  }
  for (const key of Object.keys(command)) {
    if (key === 'documentId') {
      violation('agent.command.documentScope', `Agent commands cannot override documentId at $.commands[${index}]`)
    }
    if (!allowed.has(key)) {
      violation('agent.command.fieldDenied', `Unsupported command field at $.commands[${index}].${key}`)
    }
  }
}

const collectInsertedNodes = (node: NodeSchema, path: string, result: NodeSchema[] = []): NodeSchema[] => {
  result.push(node)
  if (Array.isArray(node.children)) {
    node.children.forEach((child, index) => collectInsertedNodes(child, `${path}.children[${index}]`, result))
  }
  return result
}

const assertGrantPreflight = (
  commands: readonly EditorCommand[],
  grant: AgentCapabilityGrant,
): { insertedCount: number } => {
  let insertedCount = 0
  commands.forEach((command, index) => {
    if (!grant.commandTypes.includes(command.type)) {
      violation('agent.grant.commandDenied', `Command type is not granted at $.commands[${index}].type`)
    }
    if (command.type === 'updateProps' && command.extras) {
      for (const key of Object.keys(command.extras)) {
        if (!isSafeAgentExtraKey(key)) {
          violation('agent.command.reservedExtra', 'Agent extras must use direct canonical non-structural keys')
        }
        if (!grant.extraKeys.includes(key)) {
          violation('agent.grant.extraDenied', `Extra key is not granted at $.commands[${index}].extras.${key}`)
        }
      }
    }
    if (command.type === 'updateProps' && command.props) {
      for (const key of Object.keys(command.props)) {
        if (!isSafeAgentPropKey(key)) {
          violation('agent.command.propPathDenied', 'Agent props must use direct canonical property keys')
        }
      }
    }
    if (
      command.type !== 'insertNode' &&
      command.type !== 'replace' &&
      command.type !== 'insertBefore' &&
      command.type !== 'insertAfter' &&
      command.type !== 'wrap'
    ) {
      return
    }

    const inserted = collectInsertedNodes(command.node, `$.commands[${index}].node`)
    insertedCount += inserted.length
    inserted.forEach((node, nodeIndex) => {
      if (!grant.componentNames.includes(node.componentName)) {
        violation(
          'agent.grant.componentDenied',
          `Component is not granted at $.commands[${index}].node[${nodeIndex}].componentName`,
        )
      }
      const props = node.props
      if (!props || typeof props !== 'object' || Array.isArray(props)) {
        violation(
          'agent.command.propsRequired',
          `Inserted nodes require an explicit props object at index ${nodeIndex}`,
        )
      }
      for (const key of Object.keys(props as Record<string, unknown>)) {
        if (!isSafeAgentPropKey(key)) {
          violation('agent.command.propPathDenied', 'Inserted node props must use direct canonical property keys')
        }
      }
      for (const key of Object.keys(node)) {
        if (!NODE_STANDARD_KEYS.has(key) && !grant.extraKeys.includes(key)) {
          violation('agent.grant.extraDenied', `Extra key is not granted at $.commands[${index}].node.${key}`)
        }
      }
    })
  })
  return { insertedCount }
}

const normalizeExportValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeExportValue)
  if (!value || typeof value !== 'object') return value
  const normalized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const exported = normalizeExportValue(child)
    if (exported !== null) normalized[key] = exported
  }
  return normalized
}

const normalizePropsMap = (value: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const exported = normalizeExportValue(child)
    if (exported !== null) normalized[key] = exported
  }
  return normalized
}

const canonicalizeInsertedNode = (node: NodeSchema): NodeSchema => {
  const source = node as unknown as Record<string, unknown>
  const result: Record<string, unknown> = {
    componentName: node.componentName,
    id: node.id,
  }
  const props = normalizePropsMap((node.props ?? {}) as unknown as Record<string, unknown>)
  result.props = props

  for (const [key, value] of Object.entries(source)) {
    if (key === 'componentName' || key === 'id' || key === 'props' || key === 'children') continue
    const exported = normalizeExportValue(value)
    if (exported !== null) result[key] = exported
  }

  const defaults: Record<string, unknown> = { condition: true, hidden: false, locked: false, title: '' }
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(source, key)) result[key] = value
  }

  const children = (node.children ?? []).map(canonicalizeInsertedNode)
  if (children.length > 0) result.children = children
  return result as unknown as NodeSchema
}

const projectExpectedSchema = (schema: RootSchema, commands: readonly EditorCommand[]): RootSchema => {
  const expected = JSON.parse(JSON.stringify(schema)) as RootSchema
  const entries = new Map<string, MutableSchemaEntry>()
  const indexTree = (node: NodeSchema, parent?: NodeSchema): void => {
    entries.set(node.id!, { node, parent })
    node.children?.forEach(child => indexTree(child, node))
  }
  indexTree(expected)

  const requireEntry = (id: string): MutableSchemaEntry => {
    const entry = entries.get(id)
    if (!entry) violation('agent.plan.nodeMissing', `Projected schema node does not exist: ${id}`)
    return entry as MutableSchemaEntry
  }
  const childrenOf = (node: NodeSchema): NodeSchema[] => {
    if (!node.children) node.children = []
    return node.children
  }
  const removeEntryTree = (node: NodeSchema): void => {
    node.children?.forEach(removeEntryTree)
    entries.delete(node.id!)
  }

  for (const command of commands) {
    switch (command.type) {
      case 'insertNode': {
        const parent = requireEntry(command.parentId).node
        const node = canonicalizeInsertedNode(command.node)
        const children = childrenOf(parent)
        children.splice(normalizeAt(command.at, children.length), 0, node)
        indexTree(node, parent)
        break
      }
      case 'updateProps': {
        const node = requireEntry(command.nodeId).node as unknown as Record<string, unknown>
        if (command.props) {
          const props = ((node.props as Record<string, unknown> | undefined) ??= {})
          for (const [key, value] of Object.entries(command.props)) {
            const exported = normalizeExportValue(value)
            if (exported === null) delete props[key]
            else props[key] = exported
          }
        }
        if (command.extras) {
          for (const [key, value] of Object.entries(command.extras)) {
            const exported = normalizeExportValue(value)
            if (exported === null) delete node[key]
            else node[key] = exported
          }
        }
        break
      }
      case 'removeNode': {
        const { node, parent } = requireEntry(command.nodeId)
        if (parent?.children) parent.children = parent.children.filter(child => child.id !== node.id)
        removeEntryTree(node)
        break
      }
      case 'moveNode': {
        const entry = requireEntry(command.nodeId)
        const parent = requireEntry(command.parentId).node
        if (entry.parent?.children)
          entry.parent.children = entry.parent.children.filter(child => child.id !== entry.node.id)
        const children = childrenOf(parent)
        children.splice(normalizeAt(command.at, children.length), 0, entry.node)
        entry.parent = parent
        break
      }
      case 'replace': {
        const entry = requireEntry(command.nodeId)
        const parent = entry.parent
        if (!parent) violation('agent.plan.rootMutation', 'The root node cannot be replaced')
        const children = childrenOf(parent as NodeSchema)
        const index = children.indexOf(entry.node)
        if (index < 0) violation('agent.plan.disconnected', `Node is detached from its parent: ${command.nodeId}`)
        const node = canonicalizeInsertedNode(command.node)
        children.splice(index, 1, node)
        removeEntryTree(entry.node)
        indexTree(node, parent)
        break
      }
      case 'insertBefore':
      case 'insertAfter': {
        const reference = requireEntry(command.nodeId)
        const parent = reference.parent
        if (!parent) violation('agent.plan.rootMutation', `The root node cannot participate in ${command.type}`)
        const children = childrenOf(parent as NodeSchema)
        const referenceIndex = children.indexOf(reference.node)
        if (referenceIndex < 0) {
          violation('agent.plan.disconnected', `Node is detached from its parent: ${command.nodeId}`)
        }
        const node = canonicalizeInsertedNode(command.node)
        const offset = command.type === 'insertAfter' ? 1 : 0
        children.splice(referenceIndex + offset, 0, node)
        indexTree(node, parent)
        break
      }
      case 'wrap': {
        const entry = requireEntry(command.nodeId)
        const parent = entry.parent
        if (!parent) violation('agent.plan.rootMutation', 'The root node cannot be wrapped')
        const siblings = childrenOf(parent as NodeSchema)
        const index = siblings.indexOf(entry.node)
        if (index < 0) violation('agent.plan.disconnected', `Node is detached from its parent: ${command.nodeId}`)
        const wrapper = canonicalizeInsertedNode(command.node)
        wrapper.children = [entry.node]
        siblings.splice(index, 1, wrapper)
        indexTree(wrapper, parent)
        break
      }
      case 'unwrap': {
        const entry = requireEntry(command.nodeId)
        const parent = entry.parent
        if (!parent) violation('agent.plan.rootMutation', 'The root node cannot be unwrapped')
        const siblings = childrenOf(parent as NodeSchema)
        const index = siblings.indexOf(entry.node)
        if (index < 0) violation('agent.plan.disconnected', `Node is detached from its parent: ${command.nodeId}`)
        const promoted = entry.node.children ?? []
        siblings.splice(index, 1, ...promoted)
        promoted.forEach(child => {
          const childEntry = requireEntry(child.id!)
          childEntry.parent = parent
        })
        entries.delete(entry.node.id!)
        break
      }
    }
  }

  const pruneEmptyChildren = (node: NodeSchema): void => {
    node.children?.forEach(pruneEmptyChildren)
    if (node.children?.length === 0) node.children = undefined
  }
  pruneEmptyChildren(expected)
  return expected
}

const buildProjection = (schema: RootSchema): { nodes: Map<string, ProjectedNode>; rootId: string } => {
  const nodes = new Map<string, ProjectedNode>()
  const visit = (node: NodeSchema, parentId?: string): string => {
    if (!node.id) violation('agent.schema.nodeIdRequired', 'Snapshot nodes must have stable IDs')
    const id = node.id as string
    if (nodes.has(id)) violation('agent.schema.duplicateNodeId', `Duplicate node ID in snapshot: ${id}`)
    const projected: ProjectedNode = {
      children: [],
      componentName: node.componentName,
      id,
      locked: node.locked === true,
      parentId,
    }
    nodes.set(id, projected)
    projected.children = (node.children ?? []).map(child => visit(child, id))
    return id
  }
  const rootId = visit(schema)
  return { nodes, rootId }
}

const requireProjectedNode = (nodes: Map<string, ProjectedNode>, id: string): ProjectedNode => {
  const node = nodes.get(id)
  if (!node) violation('agent.plan.nodeMissing', `Command target node does not exist: ${id}`)
  return node as ProjectedNode
}

const requireProjectedParent = (nodes: Map<string, ProjectedNode>, node: ProjectedNode): ProjectedNode => {
  if (!node.parentId) violation('agent.plan.disconnected', `Node is detached from its parent: ${node.id}`)
  return requireProjectedNode(nodes, node.parentId as string)
}

const normalizeAt = (at: number | undefined, length: number): number => {
  if (at === undefined || at === -1 || at >= length) return length
  return at
}

const removeProjectedSubtree = (nodes: Map<string, ProjectedNode>, id: string): void => {
  const node = requireProjectedNode(nodes, id)
  node.children.slice().forEach(childId => removeProjectedSubtree(nodes, childId))
  nodes.delete(id)
}

const assignAndProjectInsertedTree = (
  schema: NodeSchema,
  nodes: Map<string, ProjectedNode>,
  parentId: string,
  assignedIds: string[],
): NodeSchema => {
  const id = schema.id || uniqueId('node')
  if (nodes.has(id)) violation('agent.plan.duplicateNodeId', `Inserted node ID already exists: ${id}`)
  const normalized: NodeSchema = { ...schema, id }
  const projected: ProjectedNode = {
    children: [],
    componentName: normalized.componentName,
    id,
    locked: normalized.locked === true,
    parentId,
  }
  nodes.set(id, projected)
  assignedIds.push(id)
  normalized.children = (schema.children ?? []).map(child => {
    const normalizedChild = assignAndProjectInsertedTree(child, nodes, id, assignedIds)
    projected.children.push(normalizedChild.id!)
    return normalizedChild
  })
  return normalized
}

const assertProjectionDepth = (nodes: Map<string, ProjectedNode>, rootId: string, maxDepth: number): void => {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, depth: number): void => {
    if (depth > maxDepth) violation('agent.limit.treeDepth', `Projected tree exceeds depth limit ${maxDepth}`)
    if (visiting.has(id)) violation('agent.plan.cycle', `Projected tree contains a cycle at ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    const node = requireProjectedNode(nodes, id)
    node.children.forEach(childId => visit(childId, depth + 1))
    visiting.delete(id)
    visited.add(id)
  }
  visit(rootId, 1)
  if (visited.size !== nodes.size) violation('agent.plan.disconnected', 'Projected tree contains disconnected nodes')
}

export const summarizeAgentCommands = (commands: readonly EditorCommand[]): AgentCommandAuditSummary => {
  const types = new Set<string>()
  const nodeIds = new Set<string>()
  const componentNames = new Set<string>()
  const propKeys = new Set<string>()
  const extraKeys = new Set<string>()
  const inspectNode = (node: NodeSchema): void => {
    if (node.id) nodeIds.add(node.id)
    componentNames.add(node.componentName)
    Object.keys(node.props ?? {}).forEach(key => propKeys.add(key))
    Object.keys(node).forEach(key => {
      if (!NODE_STANDARD_KEYS.has(key)) extraKeys.add(key)
    })
    node.children?.forEach(inspectNode)
  }
  commands.forEach(command => {
    types.add(command.type)
    if ('nodeId' in command) nodeIds.add(command.nodeId)
    if ('parentId' in command) nodeIds.add(command.parentId)
    if ('node' in command) inspectNode(command.node)
    if (command.type === 'updateProps') {
      Object.keys(command.props ?? {}).forEach(key => propKeys.add(key))
      Object.keys(command.extras ?? {}).forEach(key => extraKeys.add(key))
    }
  })
  return deepFreezeAgentData({
    componentNames: [...componentNames].sort(),
    count: commands.length,
    extraKeys: [...extraKeys].sort(),
    nodeIds: [...nodeIds].sort(),
    propKeys: [...propKeys].sort(),
    types: [...types].sort(),
  })
}

export const planAgentCommands = (
  schema: RootSchema,
  agentCommands: readonly AgentEditorCommand[],
  documentId: string,
  grant: AgentCapabilityGrant,
): PlannedAgentCommands => {
  if (!Array.isArray(agentCommands) || agentCommands.length < 1) {
    violation('agent.command.empty', 'An agent plan requires at least one command')
  }
  if (agentCommands.length > grant.limits.maxCommands) {
    violation('agent.limit.commands', `Agent command count exceeds limit ${grant.limits.maxCommands}`)
  }

  const prepared = prepareAgentData(agentCommands, '$.commands', {
    limitCode: 'agent.limit.payloadBytes',
    limitMessage: `Agent payload exceeds limit ${grant.limits.maxPayloadBytes}`,
    maxBytes: grant.limits.maxPayloadBytes,
    maxDepth: Math.max(16, grant.limits.maxTreeDepth + 8),
    maxNodes: Math.min(65_536, grant.limits.maxPayloadBytes),
  })
  const mutable = JSON.parse(prepared.serialized) as Record<string, unknown>[]
  mutable.forEach(assertKnownCommandFields)
  mutable.forEach(command => {
    if (!isEditorCommandType(command.type)) {
      violation('agent.command.unsupported', `Unsupported command type: ${String(command.type)}`)
    }
  })
  try {
    validateCommands(mutable)
  } catch {
    violation('agent.command.invalid', 'Agent commands failed structural validation')
  }

  const commands = mutable as unknown as EditorCommand[]
  const { insertedCount } = assertGrantPreflight(commands, grant)
  if (insertedCount > grant.limits.maxInsertedNodes) {
    violation('agent.limit.insertedNodes', `Inserted node count exceeds limit ${grant.limits.maxInsertedNodes}`)
  }

  const { nodes, rootId } = buildProjection(schema)
  const normalized: EditorCommand[] = []
  const effects: AgentCommandEffect[] = []

  commands.forEach((command, commandIndex) => {
    switch (command.type) {
      case 'insertNode': {
        const parent = requireProjectedNode(nodes, command.parentId)
        if (parent.locked) violation('agent.plan.locked', `Cannot insert into locked node: ${parent.id}`)
        const assignedIds: string[] = []
        const node = assignAndProjectInsertedTree(command.node, nodes, parent.id, assignedIds)
        parent.children.splice(normalizeAt(command.at, parent.children.length), 0, node.id!)
        normalized.push({ ...command, documentId, node })
        effects.push({ commandIndex, nodeIds: assignedIds, parentId: parent.id, type: command.type })
        break
      }
      case 'updateProps': {
        const node = requireProjectedNode(nodes, command.nodeId)
        if (node.locked) violation('agent.plan.locked', `Cannot update locked node: ${node.id}`)
        if (command.extras && typeof command.extras.locked === 'boolean') node.locked = command.extras.locked
        normalized.push({ ...command, documentId })
        effects.push({ commandIndex, nodeIds: [node.id], type: command.type })
        break
      }
      case 'removeNode': {
        const node = requireProjectedNode(nodes, command.nodeId)
        if (node.id === rootId) violation('agent.plan.rootMutation', 'The root node cannot be removed')
        if (node.locked) violation('agent.plan.locked', `Cannot remove locked node: ${node.id}`)
        const parent = node.parentId ? requireProjectedNode(nodes, node.parentId) : undefined
        if (parent) parent.children = parent.children.filter(id => id !== node.id)
        removeProjectedSubtree(nodes, node.id)
        normalized.push({ ...command, documentId })
        effects.push({ commandIndex, nodeIds: [node.id], parentId: parent?.id, type: command.type })
        break
      }
      case 'moveNode': {
        const node = requireProjectedNode(nodes, command.nodeId)
        const parent = requireProjectedNode(nodes, command.parentId)
        if (node.id === rootId) violation('agent.plan.rootMutation', 'The root node cannot be moved')
        if (node.locked || parent.locked) violation('agent.plan.locked', 'Locked nodes cannot participate in moveNode')
        let cursor: ProjectedNode | undefined = parent
        while (cursor) {
          if (cursor.id === node.id) violation('agent.plan.cycle', `Cannot move ${node.id} into its descendant`)
          cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined
        }
        const oldParent = node.parentId ? requireProjectedNode(nodes, node.parentId) : undefined
        if (oldParent) oldParent.children = oldParent.children.filter(id => id !== node.id)
        parent.children.splice(normalizeAt(command.at, parent.children.length), 0, node.id)
        node.parentId = parent.id
        normalized.push({ ...command, documentId })
        effects.push({ commandIndex, nodeIds: [node.id], parentId: parent.id, type: command.type })
        break
      }
      case 'replace': {
        const target = requireProjectedNode(nodes, command.nodeId)
        if (target.id === rootId) violation('agent.plan.rootMutation', 'The root node cannot be replaced')
        const parent = requireProjectedParent(nodes, target)
        if (target.locked || parent.locked) {
          violation('agent.plan.locked', 'Locked nodes cannot participate in replace')
        }
        const targetIndex = parent.children.indexOf(target.id)
        if (targetIndex < 0) violation('agent.plan.disconnected', `Node is detached from its parent: ${target.id}`)
        const assignedIds: string[] = []
        const node = assignAndProjectInsertedTree(command.node, nodes, parent.id, assignedIds)
        parent.children.splice(targetIndex, 1, node.id!)
        removeProjectedSubtree(nodes, target.id)
        normalized.push({ ...command, documentId, node })
        effects.push({
          commandIndex,
          nodeIds: [target.id, ...assignedIds],
          parentId: parent.id,
          type: command.type,
        })
        break
      }
      case 'insertBefore':
      case 'insertAfter': {
        const reference = requireProjectedNode(nodes, command.nodeId)
        if (reference.id === rootId) {
          violation('agent.plan.rootMutation', `The root node cannot participate in ${command.type}`)
        }
        const parent = requireProjectedParent(nodes, reference)
        if (parent.locked) violation('agent.plan.locked', `Cannot ${command.type} under locked node: ${parent.id}`)
        const referenceIndex = parent.children.indexOf(reference.id)
        if (referenceIndex < 0) {
          violation('agent.plan.disconnected', `Node is detached from its parent: ${reference.id}`)
        }
        const assignedIds: string[] = []
        const node = assignAndProjectInsertedTree(command.node, nodes, parent.id, assignedIds)
        const offset = command.type === 'insertAfter' ? 1 : 0
        parent.children.splice(referenceIndex + offset, 0, node.id!)
        normalized.push({ ...command, documentId, node })
        effects.push({ commandIndex, nodeIds: assignedIds, parentId: parent.id, type: command.type })
        break
      }
      case 'wrap': {
        const target = requireProjectedNode(nodes, command.nodeId)
        if (target.id === rootId) violation('agent.plan.rootMutation', 'The root node cannot be wrapped')
        const parent = requireProjectedParent(nodes, target)
        if (target.locked || parent.locked) {
          violation('agent.plan.locked', 'Locked nodes cannot participate in wrap')
        }
        const targetIndex = parent.children.indexOf(target.id)
        if (targetIndex < 0) violation('agent.plan.disconnected', `Node is detached from its parent: ${target.id}`)
        const assignedIds: string[] = []
        const wrapper = assignAndProjectInsertedTree(command.node, nodes, parent.id, assignedIds)
        const projectedWrapper = requireProjectedNode(nodes, wrapper.id!)
        if (projectedWrapper.children.length > 0) {
          violation('agent.command.invalid', 'wrap node must be initially empty')
        }
        parent.children.splice(targetIndex, 1, wrapper.id!)
        projectedWrapper.children.push(target.id)
        target.parentId = projectedWrapper.id
        normalized.push({ ...command, documentId, node: wrapper })
        effects.push({
          commandIndex,
          nodeIds: [wrapper.id!, target.id],
          parentId: parent.id,
          type: command.type,
        })
        break
      }
      case 'unwrap': {
        const wrapper = requireProjectedNode(nodes, command.nodeId)
        if (wrapper.id === rootId) violation('agent.plan.rootMutation', 'The root node cannot be unwrapped')
        const parent = requireProjectedParent(nodes, wrapper)
        const promoted = wrapper.children.map(id => requireProjectedNode(nodes, id))
        if (wrapper.locked || parent.locked || promoted.some(child => child.locked)) {
          violation('agent.plan.locked', 'Locked wrappers, children, and parents cannot participate in unwrap')
        }
        const wrapperIndex = parent.children.indexOf(wrapper.id)
        if (wrapperIndex < 0) violation('agent.plan.disconnected', `Node is detached from its parent: ${wrapper.id}`)
        parent.children.splice(wrapperIndex, 1, ...wrapper.children)
        promoted.forEach(child => {
          child.parentId = parent.id
        })
        nodes.delete(wrapper.id)
        normalized.push({ ...command, documentId })
        effects.push({
          commandIndex,
          nodeIds: [wrapper.id, ...promoted.map(child => child.id)],
          parentId: parent.id,
          type: command.type,
        })
        break
      }
    }
  })

  assertProjectionDepth(nodes, rootId, grant.limits.maxTreeDepth)
  const frozenCommands = deepFreezeAgentData(normalized)
  return deepFreezeAgentData({
    commands: frozenCommands,
    effects,
    expectedSerialized: serializeCanonicalAgentSnapshotData(
      projectExpectedSchema(schema, frozenCommands),
      '$.expectedSchema',
    ),
    summary: summarizeAgentCommands(frozenCommands),
  })
}
