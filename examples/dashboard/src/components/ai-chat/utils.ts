import type { DashboardAgentContext } from '@/editor/agent'
import type { AgentEditorCommand, AgentExecutionReceipt } from '@easy-editor/core'

interface TextRange {
  readonly end: number
  readonly start: number
}

const findJsonObjectRanges = (content: string): TextRange[] => {
  const ranges: TextRange[] = []
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

const isCommandEnvelope = (value: unknown): value is { commands: unknown } =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'commands')

const findCommandEnvelope = (content: string): { json: string; range: TextRange } | undefined => {
  for (const range of findJsonObjectRanges(content)) {
    const json = content.slice(range.start, range.end)
    try {
      if (isCommandEnvelope(JSON.parse(json))) return { json, range }
    } catch {
      // Continue scanning: prose can contain brace pairs before the command envelope.
    }
  }
}

const extractJsonObject = (content: string): string => {
  const codeBlocks = content.matchAll(/```(?:json)?[ \t]*(?:\r?\n)?([\s\S]*?)```/gi)
  for (const codeBlock of codeBlocks) {
    const envelope = findCommandEnvelope(codeBlock[1] ?? '')
    if (envelope) return envelope.json
  }

  const envelope = findCommandEnvelope(content)
  if (envelope) return envelope.json

  throw new Error('AI 响应中没有找到 JSON 指令')
}

/** Pure parser: it never reads editor state or mutates the document. */
export const parseAiCommands = (content: string): AgentEditorCommand[] => {
  const payload = JSON.parse(extractJsonObject(content)) as unknown
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AI 指令必须是包含 commands 的 JSON 对象')
  }

  const keys = Object.keys(payload)
  if (keys.length !== 1 || keys[0] !== 'commands') {
    throw new Error('AI 指令只允许包含 commands 字段')
  }

  const commands = (payload as { commands?: unknown }).commands
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('commands 必须是非空数组')
  }

  const allowedTypes = new Set(['insertNode', 'updateProps', 'removeNode', 'moveNode'])
  for (const [index, command] of commands.entries()) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new Error(`commands[${index}] 必须是命令对象`)
    }
    const commandType = (command as { type?: unknown }).type
    if (typeof commandType !== 'string' || !allowedTypes.has(commandType)) {
      throw new Error(`commands[${index}] 包含未知操作`)
    }
    if (Object.hasOwn(command, 'documentId')) {
      throw new Error(`commands[${index}] 不允许指定 documentId`)
    }
  }

  return commands as AgentEditorCommand[]
}

export const executeAiCommands = (
  content: string,
  { capability, snapshot }: DashboardAgentContext,
): AgentExecutionReceipt => {
  const preview = capability.preview({
    baseRevision: snapshot.revision,
    commands: parseAiCommands(content),
    documentId: snapshot.documentId,
  })

  return capability.execute(preview.planId)
}

// 过滤消息内容，移除 JSON 代码只保留文字
export const filterMessageContent = (content: string): string => {
  // Code fences are presentation details; never render a command payload back to the user.
  let filteredContent = content.replace(/```(?:json)?[ \t]*(?:\r?\n)?[\s\S]*?```/gi, '')

  const envelope = findCommandEnvelope(filteredContent)
  if (envelope) {
    filteredContent = filteredContent.slice(0, envelope.range.start) + filteredContent.slice(envelope.range.end)
  }

  // 移除多余的空行，保持最多两个连续的换行
  filteredContent = filteredContent.replace(/\n{3,}/g, '\n\n')

  // 移除开头和结尾的空白字符
  filteredContent = filteredContent.trim()

  return filteredContent
}
