import type { AgentEditorCommand } from '@easy-editor/core/agent'

export function parseAiCommands(content: string): AgentEditorCommand[]

export function filterMessageContent(content: string, aliases?: Iterable<string>): string
