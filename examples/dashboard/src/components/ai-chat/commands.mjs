const findJsonObjectRanges = content => {
  const ranges = []
  let depth = 0
  let escaped = false
  let inString = false
  let start = -1

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"' && depth > 0) {
      inString = true
    } else if (character === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (character === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        ranges.push({ start, end: index + 1 })
        start = -1
      }
    }
  }

  return ranges
}

const isCommandEnvelope = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'commands')

const findCommandEnvelopes = content => {
  const envelopes = []
  for (const range of findJsonObjectRanges(content)) {
    const json = content.slice(range.start, range.end)
    try {
      if (isCommandEnvelope(JSON.parse(json))) envelopes.push({ json, range })
    } catch {
      // Prose can contain unrelated brace pairs before the command envelope.
    }
  }
  return envelopes
}

const extractJsonObject = content => {
  const codeBlockPattern = /```(?:json)?[ \t]*(?:\r?\n)?([\s\S]*?)```/gi
  const envelopes = []
  const codeBlocks = content.matchAll(codeBlockPattern)
  for (const codeBlock of codeBlocks) {
    envelopes.push(...findCommandEnvelopes(codeBlock[1] ?? ''))
  }

  envelopes.push(...findCommandEnvelopes(content.replace(codeBlockPattern, '')))

  if (envelopes.length === 0) throw new Error('AI 响应中没有找到 JSON 指令')
  if (envelopes.length > 1) throw new Error('AI 响应只能包含一个 JSON 指令块')
  return envelopes[0].json
}

/** Pure parser used inside the Agent Worker. It never reads editor state. */
export const parseAiCommands = content => {
  const payload = JSON.parse(extractJsonObject(content))
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AI 指令必须是包含 commands 的 JSON 对象')
  }

  const keys = Object.keys(payload)
  if (keys.length !== 1 || keys[0] !== 'commands') {
    throw new Error('AI 指令只允许包含 commands 字段')
  }

  const commands = payload.commands
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('commands 必须是非空数组')
  }

  const allowedTypes = new Set(['insertNode', 'updateProps', 'removeNode', 'moveNode'])
  for (const [index, command] of commands.entries()) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new Error(`commands[${index}] 必须是命令对象`)
    }
    const commandType = command.type
    if (typeof commandType !== 'string' || !allowedTypes.has(commandType)) {
      throw new Error(`commands[${index}] 包含未知操作`)
    }
    if (Object.hasOwn(command, 'documentId')) {
      throw new Error(`commands[${index}] 不允许指定 documentId`)
    }
  }

  return commands
}

/** Removes model commands and request-local aliases before content crosses into the UI realm. */
export const filterMessageContent = (content, aliases = []) => {
  let filteredContent = content.replace(/```(?:json)?[ \t]*(?:\r?\n)?[\s\S]*?```/gi, '')

  const envelopes = findCommandEnvelopes(filteredContent)
  for (let index = envelopes.length - 1; index >= 0; index -= 1) {
    const envelope = envelopes[index]
    filteredContent = filteredContent.slice(0, envelope.range.start) + filteredContent.slice(envelope.range.end)
  }

  for (const alias of aliases) {
    if (typeof alias === 'string' && alias.length > 0) filteredContent = filteredContent.replaceAll(alias, '节点')
  }

  return filteredContent.replace(/\n{3,}/g, '\n\n').trim()
}
