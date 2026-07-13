import type { IncomingMessage, ServerResponse } from 'node:http'

export const AI_SYSTEM_PROMPT: string

export interface AiChatGatewayOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
}

export type AiChatGateway = (request: IncomingMessage, response: ServerResponse, next?: () => void) => Promise<void>

export function createAiChatGateway(options?: AiChatGatewayOptions): AiChatGateway
