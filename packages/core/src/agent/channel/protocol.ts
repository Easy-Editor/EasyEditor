import { AgentCapabilityError } from '../errors'
import { prepareAgentData } from '../strict-data-validator'
import type { AgentDomainEvent, AgentPortSessionDescriptor } from '../types'

export const AGENT_PORT_PROTOCOL = 1 as const
export const AGENT_PORT_MAX_MESSAGE_BYTES = 512 * 1024

export type AgentPortOperation = 'snapshot' | 'preview' | 'execute'

export interface AgentPortReadyMessage {
  readonly version: 1
  readonly kind: 'ready'
  readonly sessionId: string
  readonly descriptor: AgentPortSessionDescriptor
}

export interface AgentPortRequestMessage {
  readonly version: 1
  readonly kind: 'request'
  readonly sessionId: string
  readonly sequence: number
  readonly operation: AgentPortOperation
  readonly payload: unknown
}

export interface AgentPortCloseMessage {
  readonly version: 1
  readonly kind: 'close'
  readonly sessionId: string
}

export interface AgentPortEventAckMessage {
  readonly version: 1
  readonly kind: 'event-ack'
  readonly sessionId: string
  readonly eventSequence: number
}

export type AgentPortInboundMessage = AgentPortRequestMessage | AgentPortCloseMessage | AgentPortEventAckMessage

export interface AgentPortSafeError {
  readonly name: string
  readonly code: string
  readonly message: string
  readonly action?: string
  readonly committed: boolean
  readonly rollbackComplete?: boolean
  readonly terminal: boolean
}

export interface AgentPortResponseMessage {
  readonly version: 1
  readonly kind: 'response'
  readonly sessionId: string
  readonly sequence: number
  readonly ok: boolean
  readonly result?: unknown
  readonly error?: AgentPortSafeError
}

export interface AgentPortEventMessage {
  readonly version: 1
  readonly kind: 'event'
  readonly sessionId: string
  readonly eventSequence: number
  readonly event: AgentDomainEvent
}

export interface AgentPortClosedMessage {
  readonly version: 1
  readonly kind: 'closed'
  readonly sessionId: string
  readonly reason: string
}

export type AgentPortOutboundMessage =
  | AgentPortReadyMessage
  | AgentPortResponseMessage
  | AgentPortEventMessage
  | AgentPortClosedMessage

export class AgentPortProtocolError extends Error {
  readonly name = 'AgentPortProtocolError'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const assertExactKeys = (record: Record<string, unknown>, allowed: readonly string[]): void => {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(record).find(key => !allowedSet.has(key))
  if (unknown) throw new AgentPortProtocolError(`Unknown Agent port field: ${unknown}`)
}

const assertEnvelope = (value: unknown): Record<string, unknown> => {
  let prepared: unknown
  try {
    prepared = prepareAgentData(value, '$.message', {
      limitCode: 'agent.transport.limitExceeded',
      limitMessage: 'Agent transport message exceeds the protocol budget',
      maxBytes: AGENT_PORT_MAX_MESSAGE_BYTES,
      maxDepth: 96,
      maxNodes: 65_536,
    }).value
  } catch (error) {
    throw new AgentPortProtocolError(error instanceof Error ? error.message : 'Invalid Agent transport message')
  }
  if (!isRecord(prepared)) throw new AgentPortProtocolError('Agent port message must be a plain object')
  if (prepared.version !== AGENT_PORT_PROTOCOL)
    throw new AgentPortProtocolError('Unsupported Agent port protocol version')
  if (typeof prepared.kind !== 'string') throw new AgentPortProtocolError('Agent port message kind is required')
  if (typeof prepared.sessionId !== 'string' || prepared.sessionId.length === 0) {
    throw new AgentPortProtocolError('Agent port sessionId is required')
  }
  return prepared
}

export const parseAgentPortInboundMessage = (value: unknown): AgentPortInboundMessage => {
  const record = assertEnvelope(value)
  if (record.kind === 'close') {
    assertExactKeys(record, ['version', 'kind', 'sessionId'])
    return record as unknown as AgentPortCloseMessage
  }
  if (record.kind === 'event-ack') {
    assertExactKeys(record, ['version', 'kind', 'sessionId', 'eventSequence'])
    if (!Number.isSafeInteger(record.eventSequence) || (record.eventSequence as number) < 1) {
      throw new AgentPortProtocolError('eventSequence must be a positive integer')
    }
    return record as unknown as AgentPortEventAckMessage
  }
  if (record.kind !== 'request') throw new AgentPortProtocolError('Unsupported Agent port message kind')
  assertExactKeys(record, ['version', 'kind', 'sessionId', 'sequence', 'operation', 'payload'])
  if (!Number.isSafeInteger(record.sequence) || (record.sequence as number) < 1) {
    throw new AgentPortProtocolError('sequence must be a positive integer')
  }
  if (!['snapshot', 'preview', 'execute'].includes(record.operation as string)) {
    throw new AgentPortProtocolError('Unsupported Agent port operation')
  }
  return record as unknown as AgentPortRequestMessage
}

export const toAgentPortSafeError = (error: unknown): AgentPortSafeError => {
  const capabilityError = error instanceof AgentCapabilityError ? error : undefined
  return Object.freeze({
    action: capabilityError?.action,
    code: capabilityError?.code ?? 'agent.transport.operationFailed',
    committed: capabilityError?.committed ?? false,
    message: capabilityError?.message ?? 'The Agent capability operation failed',
    name: capabilityError?.name ?? 'AgentCapabilityError',
    rollbackComplete: capabilityError?.rollbackComplete,
    terminal: capabilityError?.terminal ?? false,
  })
}
