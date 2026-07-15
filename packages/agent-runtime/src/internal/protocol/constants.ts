export const AGENT_PROTOCOL_VERSION = 1 as const

export const MAX_PROTOCOL_MESSAGE_BYTES = 1024 * 1024
export const MAX_PROTOCOL_STRING_BYTES = 64 * 1024
export const MAX_PROTOCOL_ARRAY_LENGTH = 1024
export const MAX_PROTOCOL_NESTING_DEPTH = 32
export const MAX_PROTOCOL_DEDUPE_ENTRIES = 4096

export const RPC_MESSAGE_KINDS = ['rpc.request', 'rpc.response', 'rpc.error', 'rpc.abort'] as const

export type RpcMessageKind = (typeof RPC_MESSAGE_KINDS)[number]
