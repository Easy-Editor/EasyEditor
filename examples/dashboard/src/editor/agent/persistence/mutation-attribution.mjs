import {
  createChildrenOrderSlotKey,
  createFieldSlotAliases,
  createFieldSlotKey,
  createNodeStructuralSlotKeys,
  createNodeSubtreeSlotKey,
} from './provenance.mjs'

export const DASHBOARD_NODE_ADD_EVENT = 'node:add'
export const DASHBOARD_NODE_REMOVE_EVENT = 'node:remove'

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value
}

const requireFunction = (value, label) => {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`)
  return value
}

const freezeAttribution = (source, slotKeys, ambiguous = false) =>
  Object.freeze({
    source,
    slotKeys: Object.freeze([...new Set(slotKeys)].sort()),
    ...(ambiguous ? { ambiguous: true } : {}),
  })

const unknownAttribution = () => freezeAttribution('unknown', [], true)

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const safeNode = value => {
  if (typeof value !== 'object' || value === null) return null
  const id = value.id
  return typeof id === 'string' && id.length > 0 ? value : null
}

const resolveNode = value => {
  const direct = safeNode(value?.node)
  if (direct) return direct
  const prop = value?.prop
  const owner = safeNode(prop?.owner)
  if (owner) return owner
  if (typeof prop?.getNode !== 'function') return null
  try {
    return safeNode(prop.getNode())
  } catch {
    return null
  }
}

const convertFieldPath = value => {
  const prop = value?.prop
  if (!prop || !Array.isArray(prop.path) || prop.path.length === 0) return null
  if (prop.path.some(segment => typeof segment !== 'string')) return null
  const [first, ...rest] = prop.path
  if (first.startsWith('___')) {
    const extra = first.replaceAll('___', '')
    if (extra.length === 0) return null
    return { root: 'extras', path: [extra, ...rest] }
  }
  return { root: 'props', path: [...prop.path] }
}

const collectDescendantPaths = (value, path, result, visited) => {
  if (Array.isArray(value)) throw new TypeError('array provenance requires conservative invalidation')
  if (!isPlainRecord(value)) return
  if (visited.has(value)) throw new TypeError('cyclic provenance value is ambiguous')
  visited.add(value)
  try {
    for (const key of Object.keys(value).sort()) {
      const childPath = [...path, key]
      result.set(JSON.stringify(childPath), childPath)
      collectDescendantPaths(value[key], childPath, result, visited)
    }
  } finally {
    visited.delete(value)
  }
}

const collectFieldSlots = (authority, value) => {
  const node = resolveNode(value)
  const target = convertFieldPath(value)
  if (!node || !target) return null
  const slots = new Set(
    createFieldSlotAliases({
      ...authority,
      nodeId: node.id,
      root: target.root,
      path: target.path,
    }),
  )
  const descendants = new Map()
  collectDescendantPaths(value.oldValue, target.path, descendants, new Set())
  collectDescendantPaths(value.newValue, target.path, descendants, new Set())
  for (const path of descendants.values()) {
    slots.add(
      createFieldSlotKey({
        ...authority,
        nodeId: node.id,
        root: target.root,
        path,
      }),
    )
  }
  return slots
}

const collectAncestors = (authority, node, slots) => {
  const visited = new Set()
  let current = safeNode(node)
  while (current) {
    if (visited.has(current.id)) throw new TypeError('node ancestry is cyclic')
    visited.add(current.id)
    slots.add(createNodeSubtreeSlotKey({ ...authority, nodeId: current.id }))
    current = safeNode(current.parent)
  }
}

const collectNodeSubtree = (authority, node, slots, visited = new Set()) => {
  const current = safeNode(node)
  if (!current) throw new TypeError('structural mutation node is unavailable')
  if (visited.has(current.id)) throw new TypeError('node subtree is cyclic')
  visited.add(current.id)
  for (const slotKey of createNodeStructuralSlotKeys({ ...authority, nodeId: current.id })) slots.add(slotKey)
  const children = current.childrenNodes
  if (!Array.isArray(children)) throw new TypeError('node children are unavailable')
  if (children.length > 0) {
    slots.add(createChildrenOrderSlotKey({ ...authority, parentId: current.id }))
    for (const child of children) collectNodeSubtree(authority, child, slots, visited)
  }
}

const collectStructuralSlots = (authority, value, mode) => {
  const node = resolveNode(value)
  if (!node) return null
  const slots = new Set()
  if (mode === 'children') {
    slots.add(createChildrenOrderSlotKey({ ...authority, parentId: node.id }))
    collectAncestors(authority, node, slots)
    return slots
  }
  const parent = safeNode(node.parent)
  collectNodeSubtree(authority, node, slots)
  if (parent) {
    slots.add(createChildrenOrderSlotKey({ ...authority, parentId: parent.id }))
    collectAncestors(authority, parent, slots)
  }
  return slots
}

const collectBuiltinFieldSlots = (authority, nodeValue, key) => {
  const node = safeNode(nodeValue)
  if (!node) return null
  return new Set(
    createFieldSlotAliases({
      ...authority,
      nodeId: node.id,
      root: 'extras',
      path: [key],
    }),
  )
}

export const createDashboardMutationAttribution = options => {
  const projectId = requireNonEmptyString(options?.authority?.projectId, 'authority.projectId')
  const branchId = requireNonEmptyString(options?.authority?.branchId, 'authority.branchId')
  const isHumanActivityActive = requireFunction(options?.isHumanActivityActive, 'isHumanActivityActive')
  const authority = Object.freeze({ projectId, branchId })
  let activeAgentCallId = null

  const source = () => (isHumanActivityActive() ? 'human' : 'external')
  const exact = slotKeys => freezeAttribution(source(), slotKeys)

  const capture = collector => {
    if (activeAgentCallId !== null) return null
    try {
      const slotKeys = collector()
      return slotKeys && slotKeys.size > 0 ? exact(slotKeys) : unknownAttribution()
    } catch {
      return unknownAttribution()
    }
  }

  return Object.freeze({
    runAgentMutation(callId, operation) {
      const normalizedCallId = requireNonEmptyString(callId, 'callId')
      const run = requireFunction(operation, 'operation')
      if (activeAgentCallId !== null) throw new Error('Dashboard Agent mutation scopes cannot be nested')
      activeAgentCallId = normalizedCallId
      try {
        return run()
      } finally {
        activeAgentCallId = null
      }
    },
    captureFieldMutation(value) {
      return capture(() => collectFieldSlots(authority, value))
    },
    captureBuiltinFieldMutation(node, key) {
      return capture(() => collectBuiltinFieldSlots(authority, node, key))
    },
    captureStructuralMutation(value, mode = 'node') {
      return capture(() => collectStructuralSlots(authority, value, mode))
    },
    captureUnknownMutation() {
      return activeAgentCallId === null ? unknownAttribution() : null
    },
    get activeAgentCallId() {
      return activeAgentCallId
    },
  })
}
