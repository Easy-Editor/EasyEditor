const textEncoder = new TextEncoder()

export const MAX_AGENT_MESSAGES = 10
export const MAX_AGENT_MESSAGE_BYTES = 2 * 1024
export const MAX_AGENT_HISTORY_BYTES = 12 * 1024

export class AgentRequestBoundaryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AgentRequestBoundaryError'
    this.code = code
  }
}

const byteLength = value => textEncoder.encode(value).byteLength

const readMessage = (value, newest) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (newest) throw new AgentRequestBoundaryError('dashboard.agent.invalidMessages', 'Agent 消息格式无效。')
    return undefined
  }
  if (value.role !== 'user' && value.role !== 'assistant') {
    if (newest) throw new AgentRequestBoundaryError('dashboard.agent.invalidMessages', 'Agent 消息角色无效。')
    return undefined
  }
  if (typeof value.content !== 'string' || value.content.length > MAX_AGENT_MESSAGE_BYTES) {
    if (newest) throw new AgentRequestBoundaryError('dashboard.agent.messageTooLarge', '最新请求超过 Agent 消息上限。')
    return undefined
  }
  const content = value.content.trim()
  if (!content) {
    if (newest) throw new AgentRequestBoundaryError('dashboard.agent.invalidMessages', '最新请求不能为空。')
    return undefined
  }
  const bytes = byteLength(content)
  if (bytes > MAX_AGENT_MESSAGE_BYTES) {
    if (newest) throw new AgentRequestBoundaryError('dashboard.agent.messageTooLarge', '最新请求超过 Agent 消息上限。')
    return undefined
  }
  return { bytes, message: Object.freeze({ content, role: value.role }) }
}

/**
 * Creates the only message list that may cross into the Worker. It reads at
 * most the newest bounded window, never clones the caller's complete history,
 * and never truncates the newest user request silently.
 */
export const prepareAgentWorkerMessages = messages => {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AgentRequestBoundaryError('dashboard.agent.invalidMessages', 'Agent 消息列表不能为空。')
  }

  const prepared = []
  let totalBytes = 0
  const oldestAllowedIndex = Math.max(0, messages.length - MAX_AGENT_MESSAGES)
  for (let index = messages.length - 1; index >= oldestAllowedIndex; index -= 1) {
    const newest = index === messages.length - 1
    const entry = readMessage(messages[index], newest)
    if (!entry) continue
    if (newest && entry.message.role !== 'user') {
      throw new AgentRequestBoundaryError('dashboard.agent.invalidMessages', '最新 Agent 消息必须来自用户。')
    }
    if (totalBytes + entry.bytes > MAX_AGENT_HISTORY_BYTES) {
      if (newest)
        throw new AgentRequestBoundaryError('dashboard.agent.messageTooLarge', '最新请求超过 Agent 消息上限。')
      continue
    }
    prepared.unshift(entry.message)
    totalBytes += entry.bytes
  }

  if (prepared.length === 0 || prepared.at(-1)?.role !== 'user') {
    throw new AgentRequestBoundaryError('dashboard.agent.invalidMessages', 'Agent 消息列表无效。')
  }
  return Object.freeze(prepared)
}
