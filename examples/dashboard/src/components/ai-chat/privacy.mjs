const textEncoder = new TextEncoder()

export const MAX_CHAT_MESSAGES = 10

const MAX_CHAT_CONTENT_BYTES = 2 * 1024
const MAX_CHAT_HISTORY_BYTES = 12 * 1024
const MAX_CHAT_REQUEST_BYTES = 48 * 1024
const MAX_CANVAS_BYTES = 32 * 1024
const MAX_CANVAS_NODES = 200
const MAX_CANVAS_DEPTH = 24
const MAX_PROP_BYTES = 256

const SAFE_PROP_KEYS = new Set(['alt', 'description', 'label', 'placeholder', 'text', 'title'])
const SENSITIVE_VALUE_PATTERN =
  /(?:https?:\/\/|www\.|\bbearer\s+|\bsk-[a-z0-9_-]{6,}|api[_-]?key|access[_-]?token|secret|password)/i

const byteLength = value => textEncoder.encode(value).byteLength

const truncateUtf8 = (value, limit) => {
  if (byteLength(value) <= limit) return value
  let result = ''
  for (const character of value) {
    if (byteLength(result + character) > limit) break
    result += character
  }
  return result
}

const sanitizeNonce = nonce => {
  if (typeof nonce === 'string') {
    const normalized = nonce
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 16)
    if (normalized) return normalized
  }

  const crypto = globalThis.crypto
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  }

  throw new Error('Secure random node aliases are unavailable')
}

const sanitizeProps = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const props = {}
  for (const key of [...SAFE_PROP_KEYS].sort()) {
    const candidate = value[key]
    if (typeof candidate !== 'string' || candidate.length === 0 || SENSITIVE_VALUE_PATTERN.test(candidate)) continue
    const sanitized = truncateUtf8(candidate, MAX_PROP_BYTES)
    if (sanitized) props[key] = sanitized
  }
  return Object.keys(props).length > 0 ? props : undefined
}

const sanitizeRect = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const rect = {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  }
  if (Object.values(rect).some(item => typeof item !== 'number' || !Number.isFinite(item))) return undefined
  return rect
}

const createProjectedNode = (node, alias, parentAlias) => {
  if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.componentName !== 'string') {
    return undefined
  }

  const projected = {
    alias,
    componentName: truncateUtf8(node.componentName, 128),
  }
  if (parentAlias) projected.parentAlias = parentAlias
  if (node.locked === true) projected.locked = true

  const rect = sanitizeRect(node.$dashboard?.rect)
  if (rect) projected.rect = rect

  const props = sanitizeProps(node.props)
  if (props) projected.props = props

  return projected
}

/**
 * Builds the only canvas representation allowed to leave the browser. Raw
 * document/node identifiers and executable editor state stay in the capability
 * realm; the model sees fresh aliases that are resolved only for this request.
 */
export const createCanvasProjection = (schema, options = {}) => {
  const nonce = sanitizeNonce(options.nonce)
  const nodes = []
  const nodeIdsByAlias = new Map()
  const pending = [{ node: schema, parentAlias: undefined, depth: 0 }]
  let sequence = 0

  while (pending.length > 0 && nodes.length < MAX_CANVAS_NODES) {
    const current = pending.pop()
    if (!current || current.depth > MAX_CANVAS_DEPTH) continue

    sequence += 1
    const alias = `n_${nonce}_${sequence}`
    const projected = createProjectedNode(current.node, alias, current.parentAlias)
    if (!projected) continue

    const candidateCanvas = { version: 1, nodes: [...nodes, projected] }
    if (byteLength(JSON.stringify(candidateCanvas)) > MAX_CANVAS_BYTES) break

    nodes.push(projected)
    if (typeof current.node.id === 'string' && current.node.id.length > 0) {
      nodeIdsByAlias.set(alias, current.node.id)
    }

    const children = Array.isArray(current.node.children) ? current.node.children : []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index], parentAlias: alias, depth: current.depth + 1 })
    }
  }

  return {
    canvas: { version: 1, nodes },
    nodeIdsByAlias,
  }
}

const sanitizeMessage = message => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
  if (message.role !== 'user' && message.role !== 'assistant') return undefined
  if (typeof message.content !== 'string') return undefined
  const content = truncateUtf8(message.content.trim(), MAX_CHAT_CONTENT_BYTES)
  return content ? { role: message.role, content } : undefined
}

/** Creates a strict, bounded gateway DTO. System instructions are server-owned. */
export const createChatRequest = (messages, canvas) => {
  const sanitized = []
  let historyBytes = 0

  for (let index = messages.length - 1; index >= 0 && sanitized.length < MAX_CHAT_MESSAGES; index -= 1) {
    const message = sanitizeMessage(messages[index])
    if (!message) continue
    const messageBytes = byteLength(JSON.stringify(message))
    if (historyBytes + messageBytes > MAX_CHAT_HISTORY_BYTES && sanitized.length > 0) continue
    sanitized.unshift(message)
    historyBytes += messageBytes
  }

  const request = { messages: sanitized, canvas }
  while (sanitized.length > 1 && byteLength(JSON.stringify(request)) > MAX_CHAT_REQUEST_BYTES) {
    sanitized.shift()
  }
  if (byteLength(JSON.stringify(request)) > MAX_CHAT_REQUEST_BYTES) {
    throw new Error('AI request exceeds the client privacy budget')
  }
  return request
}

/** Resolves model-visible aliases at the last possible moment inside the host. */
export const resolveCommandAliases = (commands, nodeIdsByAlias) => {
  const resolveAlias = (alias, path) => {
    const nodeId = nodeIdsByAlias.get(alias)
    if (!nodeId) throw new Error(`${path} must reference a node alias from this request`)
    return nodeId
  }

  return commands.map((command, index) => {
    switch (command.type) {
      case 'insertNode':
        return { ...command, parentId: resolveAlias(command.parentId, `commands[${index}].parentId`) }
      case 'updateProps':
      case 'removeNode':
        return { ...command, nodeId: resolveAlias(command.nodeId, `commands[${index}].nodeId`) }
      case 'moveNode':
        return {
          ...command,
          nodeId: resolveAlias(command.nodeId, `commands[${index}].nodeId`),
          parentId: resolveAlias(command.parentId, `commands[${index}].parentId`),
        }
      default:
        throw new Error(`commands[${index}].type is not supported`)
    }
  })
}
