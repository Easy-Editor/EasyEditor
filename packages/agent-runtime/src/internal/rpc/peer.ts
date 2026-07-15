import type { Clock, IdFactory } from '../../contracts.js'
import {
  MAX_PROTOCOL_DEDUPE_ENTRIES,
  ProtocolValidationError,
  type ProtocolEnvelope,
  createProtocolEnvelope,
  parseProtocolEnvelope,
} from '../protocol/index.js'
import type {
  RpcContractMap,
  RpcContractRequest,
  RpcContractResponse,
  RpcValueContract,
} from './contracts.js'
import {
  type RpcAbortPayload,
  type RpcErrorPayload,
  type RpcRequestPayload,
  type RpcResponsePayload,
  parseRpcAbortPayload,
  parseRpcErrorPayload,
  parseRpcRequestPayload,
  parseRpcResponsePayload,
} from './payload.js'

export interface RpcMessageEvent {
  readonly data: unknown
}

export interface RpcMessagePort {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: RpcMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: RpcMessageEvent) => void): void
  start?(): void
  close?(): void
}

export interface RpcRequestContext {
  readonly sessionId: string
  readonly taskId: string
  readonly stepId: string
}

export interface RpcRequestOptions extends RpcRequestContext {
  readonly signal?: AbortSignal
}

export interface RpcHandlerContext extends RpcRequestContext {
  readonly requestId: string
  readonly signal: AbortSignal
}

export type RpcHandlers<Contracts extends RpcContractMap> = {
  readonly [Operation in keyof Contracts]?: (
    value: RpcContractRequest<Contracts[Operation]>,
    context: RpcHandlerContext,
  ) => RpcContractResponse<Contracts[Operation]> | Promise<RpcContractResponse<Contracts[Operation]>>
}

export interface RpcPeerStats {
  readonly sentMessages: number
  readonly receivedMessages: number
  readonly rejectedMessages: number
  readonly deduplicatedMessages: number
  readonly replayedResponses: number
  readonly outOfOrderResponses: number
  readonly abortedRequests: number
  readonly pendingRequests: number
  readonly activeHandlers: number
  readonly transferredObjects: 0
}

export interface RpcPeer<Contracts extends RpcContractMap> {
  request<Operation extends Extract<keyof Contracts, string>>(
    operation: Operation,
    value: RpcContractRequest<Contracts[Operation]>,
    options: RpcRequestOptions,
  ): Promise<RpcContractResponse<Contracts[Operation]>>
  dispose(reason?: string): Promise<void>
  getStats(): RpcPeerStats
}

export interface CreateRpcPeerOptions<Contracts extends RpcContractMap> {
  readonly port: RpcMessagePort
  readonly contracts: Contracts
  readonly handlers?: RpcHandlers<Contracts>
  readonly clock: Clock
  readonly idFactory: IdFactory
  readonly closePortOnDispose?: boolean
  readonly onProtocolError?: (error: ProtocolValidationError) => void
}

export class RpcAbortError extends Error {
  constructor(message = 'RPC request aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

export class RpcDisposedError extends Error {
  constructor(message = 'RPC peer disposed') {
    super(message)
    this.name = 'RpcDisposedError'
  }
}

export class RpcRemoteError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RpcRemoteError'
    this.code = code
  }
}

interface PendingRequest {
  readonly contract: RpcValueContract
  readonly context: RpcRequestContext
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  readonly removeAbortListener: () => void
}

interface ActiveHandler {
  readonly controller: AbortController
}

class BoundedMap<Key, Value> {
  readonly #values = new Map<Key, Value>()
  readonly #limit: number

  constructor(limit: number) {
    this.#limit = limit
  }

  get(key: Key): Value | undefined {
    return this.#values.get(key)
  }

  has(key: Key): boolean {
    return this.#values.has(key)
  }

  set(key: Key, value: Value): void {
    if (this.#values.has(key)) this.#values.delete(key)
    this.#values.set(key, value)
    const oldest = this.#values.keys().next()
    if (this.#values.size > this.#limit && !oldest.done) this.#values.delete(oldest.value)
  }

  clear(): void {
    this.#values.clear()
  }
}

class BoundedSet<Value> {
  readonly #values = new BoundedMap<Value, true>(MAX_PROTOCOL_DEDUPE_ENTRIES)

  add(value: Value): boolean {
    const duplicate = this.#values.has(value)
    this.#values.set(value, true)
    return duplicate
  }

  clear(): void {
    this.#values.clear()
  }
}

const contextsMatch = (left: RpcRequestContext, right: RpcRequestContext) =>
  left.sessionId === right.sessionId && left.taskId === right.taskId && left.stepId === right.stepId

const errorPayload = (requestId: string, error: unknown): RpcErrorPayload => ({
  requestId,
  error: {
    code: error instanceof ProtocolValidationError ? error.code : 'rpc-handler-failed',
    message: error instanceof Error ? error.message : 'RPC handler failed',
  },
})

export const createRpcPeer = <Contracts extends RpcContractMap>(
  options: CreateRpcPeerOptions<Contracts>,
): RpcPeer<Contracts> => {
  const pending = new Map<string, PendingRequest>()
  const active = new Map<string, ActiveHandler>()
  const seenMessageIds = new BoundedSet<string>()
  const completedResponses = new BoundedMap<string, ProtocolEnvelope>(MAX_PROTOCOL_DEDUPE_ENTRIES)
  let disposed = false
  const stats = {
    sentMessages: 0,
    receivedMessages: 0,
    rejectedMessages: 0,
    deduplicatedMessages: 0,
    replayedResponses: 0,
    outOfOrderResponses: 0,
    abortedRequests: 0,
  }

  const nextMessageId = () => options.idFactory.next('message')

  const post = (envelope: ProtocolEnvelope) => {
    if (disposed) throw new RpcDisposedError()
    options.port.postMessage(envelope)
    stats.sentMessages += 1
  }

  const createEnvelope = <Kind extends ProtocolEnvelope['kind'], Payload>(
    kind: Kind,
    context: RpcRequestContext,
    payload: Payload,
  ) =>
    createProtocolEnvelope({
      ...context,
      messageId: nextMessageId(),
      kind,
      sentAt: options.clock.now(),
      payload,
    })

  const reportProtocolError = (error: unknown) => {
    stats.rejectedMessages += 1
    const protocolError =
      error instanceof ProtocolValidationError
        ? error
        : new ProtocolValidationError(
            'invalid-envelope',
            error instanceof Error ? error.message : 'invalid protocol message',
          )
    options.onProtocolError?.(protocolError)
  }

  const sendError = (context: RpcRequestContext, requestId: string, error: unknown) => {
    const response = createEnvelope('rpc.error', context, errorPayload(requestId, error))
    completedResponses.set(requestId, response)
    post(response)
  }

  const handleRequest = (envelope: ProtocolEnvelope) => {
    const payload = parseRpcRequestPayload(envelope.payload)
    const duplicateMessage = seenMessageIds.add(envelope.messageId)
    const completed = completedResponses.get(payload.requestId)
    if (completed) {
      stats.deduplicatedMessages += 1
      stats.replayedResponses += 1
      post(completed)
      return
    }
    if (duplicateMessage || active.has(payload.requestId)) {
      stats.deduplicatedMessages += 1
      return
    }

    const contract = options.contracts[payload.operation] as RpcValueContract | undefined
    const handler = options.handlers?.[payload.operation] as
      | ((value: unknown, context: RpcHandlerContext) => unknown | Promise<unknown>)
      | undefined
    const context: RpcRequestContext = {
      sessionId: envelope.sessionId,
      taskId: envelope.taskId,
      stepId: envelope.stepId,
    }
    if (!contract || !handler) {
      sendError(context, payload.requestId, new RpcRemoteError('unknown-operation', `unsupported RPC operation ${payload.operation}`))
      return
    }

    let requestValue: unknown
    try {
      requestValue = contract.parseRequest(payload.value)
    } catch (error) {
      sendError(context, payload.requestId, error)
      return
    }

    const controller = new AbortController()
    active.set(payload.requestId, { controller })
    const handlerContext: RpcHandlerContext = { ...context, requestId: payload.requestId, signal: controller.signal }

    void Promise.resolve(handler(requestValue, handlerContext))
      .then(result => {
        if (controller.signal.aborted || disposed) return
        const responseValue = contract.parseResponse(result)
        const response = createEnvelope('rpc.response', context, {
          requestId: payload.requestId,
          value: responseValue,
        })
        completedResponses.set(payload.requestId, response)
        post(response)
      })
      .catch(error => {
        if (controller.signal.aborted || disposed) return
        sendError(context, payload.requestId, error)
      })
      .finally(() => {
        active.delete(payload.requestId)
      })
  }

  const settlePending = (
    envelope: ProtocolEnvelope,
    payload: RpcResponsePayload | RpcErrorPayload,
    isError: boolean,
  ) => {
    if (seenMessageIds.add(envelope.messageId)) {
      stats.deduplicatedMessages += 1
      return
    }
    const request = pending.get(payload.requestId)
    if (!request) {
      stats.deduplicatedMessages += 1
      return
    }
    const responseContext: RpcRequestContext = {
      sessionId: envelope.sessionId,
      taskId: envelope.taskId,
      stepId: envelope.stepId,
    }
    if (!contextsMatch(request.context, responseContext)) {
      stats.outOfOrderResponses += 1
      return
    }

    try {
      if (isError) {
        const remote = payload as RpcErrorPayload
        request.reject(new RpcRemoteError(remote.error.code, remote.error.message))
      } else {
        const response = payload as RpcResponsePayload
        request.resolve(request.contract.parseResponse(response.value))
      }
    } catch (error) {
      request.reject(error)
    } finally {
      pending.delete(payload.requestId)
      request.removeAbortListener()
    }
  }

  const handleAbort = (envelope: ProtocolEnvelope) => {
    const payload = parseRpcAbortPayload(envelope.payload)
    if (seenMessageIds.add(envelope.messageId)) {
      stats.deduplicatedMessages += 1
      return
    }
    const running = active.get(payload.requestId)
    if (!running || running.controller.signal.aborted) return
    stats.abortedRequests += 1
    running.controller.abort(payload.reason)
  }

  const onMessage = (event: RpcMessageEvent) => {
    stats.receivedMessages += 1
    try {
      const envelope = parseProtocolEnvelope(event.data)
      switch (envelope.kind) {
        case 'rpc.request':
          handleRequest(envelope)
          break
        case 'rpc.response':
          settlePending(envelope, parseRpcResponsePayload(envelope.payload), false)
          break
        case 'rpc.error':
          settlePending(envelope, parseRpcErrorPayload(envelope.payload), true)
          break
        case 'rpc.abort':
          handleAbort(envelope)
          break
      }
    } catch (error) {
      reportProtocolError(error)
    }
  }

  options.port.addEventListener('message', onMessage)
  options.port.start?.()

  const request: RpcPeer<Contracts>['request'] = (operation, value, requestOptions) => {
    if (disposed) return Promise.reject(new RpcDisposedError())
    const contract = options.contracts[operation] as RpcValueContract | undefined
    if (!contract) return Promise.reject(new RpcRemoteError('unknown-operation', `unsupported RPC operation ${operation}`))
    if (requestOptions.signal?.aborted) return Promise.reject(new RpcAbortError())

    let requestValue: unknown
    try {
      requestValue = contract.parseRequest(value)
    } catch (error) {
      return Promise.reject(error)
    }

    const requestId = options.idFactory.next('request')
    const context: RpcRequestContext = {
      sessionId: requestOptions.sessionId,
      taskId: requestOptions.taskId,
      stepId: requestOptions.stepId,
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!pending.has(requestId)) return
        stats.abortedRequests += 1
        try {
          post(
            createEnvelope('rpc.abort', context, {
              requestId,
              reason: requestOptions.signal?.reason
                ? String(requestOptions.signal.reason)
                : 'caller-aborted',
            } satisfies RpcAbortPayload),
          )
        } catch {
          // The local rejection remains authoritative when transport is already closed.
        }
        pending.delete(requestId)
        requestOptions.signal?.removeEventListener('abort', onAbort)
        reject(new RpcAbortError())
      }
      requestOptions.signal?.addEventListener('abort', onAbort, { once: true })
      pending.set(requestId, {
        contract,
        context,
        resolve,
        reject,
        removeAbortListener: () => requestOptions.signal?.removeEventListener('abort', onAbort),
      })

      try {
        post(
          createEnvelope('rpc.request', context, {
            requestId,
            operation,
            value: requestValue,
          } satisfies Omit<RpcRequestPayload, 'value'> & { readonly value: unknown }),
        )
      } catch (error) {
        pending.delete(requestId)
        requestOptions.signal?.removeEventListener('abort', onAbort)
        reject(error)
      }
    })
  }

  return {
    request,
    async dispose(reason = 'peer-disposed') {
      if (disposed) return
      for (const [requestId, request] of pending) {
        try {
          post(createEnvelope('rpc.abort', request.context, { requestId, reason } satisfies RpcAbortPayload))
        } catch {
          // Disposal still rejects local work when transport shutdown races the abort message.
        }
        request.removeAbortListener()
        request.reject(new RpcDisposedError(reason))
      }
      pending.clear()
      for (const running of active.values()) running.controller.abort(reason)
      active.clear()
      options.port.removeEventListener('message', onMessage)
      if (options.closePortOnDispose) options.port.close?.()
      seenMessageIds.clear()
      completedResponses.clear()
      disposed = true
    },
    getStats() {
      return Object.freeze({
        ...stats,
        pendingRequests: pending.size,
        activeHandlers: active.size,
        transferredObjects: 0 as const,
      })
    },
  }
}
