import type { JsonValue } from '../../contracts.js'
import { ProtocolValidationError, assertExactFields, assertJsonValue } from '../protocol/index.js'

export interface RpcRequestPayload {
  readonly requestId: string
  readonly operation: string
  readonly value: JsonValue
}

export interface RpcResponsePayload {
  readonly requestId: string
  readonly value: JsonValue
}

export interface RpcErrorPayload {
  readonly requestId: string
  readonly error: {
    readonly code: string
    readonly message: string
  }
}

export interface RpcAbortPayload {
  readonly requestId: string
  readonly reason?: string
}

const nonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProtocolValidationError('invalid-field', `${field} must be a non-empty string`)
  }
  return value
}

export const parseRpcRequestPayload = (value: unknown): RpcRequestPayload => {
  assertExactFields(value, ['requestId', 'operation', 'value'], [], 'rpc request payload')
  nonEmptyString(value.requestId, 'rpc request payload.requestId')
  nonEmptyString(value.operation, 'rpc request payload.operation')
  assertJsonValue(value.value, 'rpc request payload.value')
  return value as unknown as RpcRequestPayload
}

export const parseRpcResponsePayload = (value: unknown): RpcResponsePayload => {
  assertExactFields(value, ['requestId', 'value'], [], 'rpc response payload')
  nonEmptyString(value.requestId, 'rpc response payload.requestId')
  assertJsonValue(value.value, 'rpc response payload.value')
  return value as unknown as RpcResponsePayload
}

export const parseRpcErrorPayload = (value: unknown): RpcErrorPayload => {
  assertExactFields(value, ['requestId', 'error'], [], 'rpc error payload')
  nonEmptyString(value.requestId, 'rpc error payload.requestId')
  assertExactFields(value.error, ['code', 'message'], [], 'rpc error payload.error')
  nonEmptyString(value.error.code, 'rpc error payload.error.code')
  nonEmptyString(value.error.message, 'rpc error payload.error.message')
  return value as unknown as RpcErrorPayload
}

export const parseRpcAbortPayload = (value: unknown): RpcAbortPayload => {
  assertExactFields(value, ['requestId'], ['reason'], 'rpc abort payload')
  nonEmptyString(value.requestId, 'rpc abort payload.requestId')
  if (value.reason !== undefined) nonEmptyString(value.reason, 'rpc abort payload.reason')
  return value as unknown as RpcAbortPayload
}
