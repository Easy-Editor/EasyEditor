export const MAX_AGENT_MESSAGES: 10
export const MAX_AGENT_MESSAGE_BYTES: number
export const MAX_AGENT_HISTORY_BYTES: number

export class AgentRequestBoundaryError extends Error {
  readonly code: string
  constructor(code: string, message: string)
}

export interface PreparedAgentMessage {
  readonly content: string
  readonly role: 'user' | 'assistant'
}

export function prepareAgentWorkerMessages(messages: unknown): readonly PreparedAgentMessage[]
