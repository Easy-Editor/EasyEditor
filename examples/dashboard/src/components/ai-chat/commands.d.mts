import type { AgentEditorCommand } from '@easy-editor/core'

export function parseAiCommands(content: string): AgentEditorCommand[]

export function filterMessageContent(content: string, aliases?: Iterable<string>): string
