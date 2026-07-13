export interface AiChatMessageInput {
  readonly content: string
  readonly role: 'user' | 'assistant' | 'system'
}

export interface GatewayChatMessage {
  readonly content: string
  readonly role: 'user' | 'assistant'
}

export interface CanvasProjectionNode {
  readonly alias: string
  readonly componentName: string
  readonly parentAlias?: string
  readonly locked?: true
  readonly rect?: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly props?: Readonly<Record<string, string>>
}

export interface CanvasProjection {
  readonly version: 1
  readonly nodes: readonly CanvasProjectionNode[]
}

export interface CanvasProjectionResult {
  readonly canvas: CanvasProjection
  readonly nodeIdsByAlias: ReadonlyMap<string, string>
}

export interface GatewayChatRequest {
  readonly messages: readonly GatewayChatMessage[]
  readonly canvas: CanvasProjection
}

export const MAX_CHAT_MESSAGES: number

export function createCanvasProjection(schema: unknown, options?: { readonly nonce?: string }): CanvasProjectionResult

export function createChatRequest(messages: readonly AiChatMessageInput[], canvas: CanvasProjection): GatewayChatRequest

export function resolveCommandAliases<T>(commands: readonly T[], nodeIdsByAlias: ReadonlyMap<string, string>): T[]
