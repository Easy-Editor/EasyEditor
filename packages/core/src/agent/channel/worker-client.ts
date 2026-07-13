import { AgentCapabilityError } from '../errors'
import { createAgentHostApprovalRequiredError } from '../execution-authority'
import { deepFreezeAgentData, prepareAgentSnapshotData } from '../strict-data-validator'
import type {
  AgentDocumentSnapshot,
  AgentDomainEvent,
  AgentDomainEventListener,
  AgentExecutionReceipt,
  AgentMessagePort,
  AgentPlanPreview,
  AgentPlanRequest,
  AgentPortCapability,
  AgentPortClientOptions,
  AgentPortSessionDescriptor,
} from '../types'
import { listenToAgentMessagePort } from './message-port'
import { AGENT_PORT_MAX_MESSAGE_BYTES, AGENT_PORT_PROTOCOL } from './protocol'

type ClientState = 'connecting' | 'open' | 'closing' | 'closed'

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 2_147_483_647

interface NormalizedAgentPortClientOptions {
  readonly signal?: AbortSignal
  readonly connectTimeoutMs: number
  readonly requestTimeoutMs: number
}

interface PendingRequest {
  readonly operation: 'snapshot' | 'preview' | 'execute'
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export class AgentTransportOutcomeUnknownError extends Error {
  readonly name = 'AgentTransportOutcomeUnknownError'

  readonly code = 'agent.transport.outcomeUnknown'

  readonly operation = 'execute'

  readonly committed = 'unknown' as const

  constructor() {
    super('The Agent execute outcome is unknown because its transport closed before a receipt arrived')
  }
}

const closedError = (reason = 'The Agent transport is closed'): AgentCapabilityError =>
  new AgentCapabilityError({ code: 'agent.transport.closed', message: reason, terminal: true })

const transportError = (code: string, message: string): AgentCapabilityError =>
  new AgentCapabilityError({ code, message, terminal: true })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const assertExactKeys = (record: Record<string, unknown>, keys: readonly string[], message: string): void => {
  const allowed = new Set(keys)
  if (Object.keys(record).some(key => !allowed.has(key))) throw closedError(message)
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const assertSnapshotResult = (value: unknown): void => {
  if (!isRecord(value)) throw closedError('The Agent snapshot response is invalid')
  assertExactKeys(value, ['documentId', 'revision', 'schema'], 'The Agent snapshot response is invalid')
  if (typeof value.documentId !== 'string' || typeof value.revision !== 'string' || !isRecord(value.schema)) {
    throw closedError('The Agent snapshot response is invalid')
  }
}

const assertPreviewResult = (value: unknown): void => {
  if (!isRecord(value)) throw closedError('The Agent preview response is invalid')
  assertExactKeys(
    value,
    ['planId', 'state', 'documentId', 'baseRevision', 'commandCount', 'effects'],
    'The Agent preview response is invalid',
  )
  if (
    typeof value.planId !== 'string' ||
    value.state !== 'prepared' ||
    typeof value.documentId !== 'string' ||
    typeof value.baseRevision !== 'string' ||
    !Number.isSafeInteger(value.commandCount) ||
    (value.commandCount as number) < 0 ||
    !Array.isArray(value.effects)
  ) {
    throw closedError('The Agent preview response is invalid')
  }
  for (const effect of value.effects) {
    if (
      !isRecord(effect) ||
      !Number.isSafeInteger(effect.commandIndex) ||
      (effect.commandIndex as number) < 0 ||
      typeof effect.type !== 'string' ||
      !isStringArray(effect.nodeIds) ||
      (effect.parentId !== undefined && typeof effect.parentId !== 'string')
    ) {
      throw closedError('The Agent preview response is invalid')
    }
    assertExactKeys(effect, ['commandIndex', 'type', 'nodeIds', 'parentId'], 'The Agent preview response is invalid')
  }
}

const assertExecuteResult = (value: unknown): void => {
  if (!isRecord(value)) throw closedError('The Agent execute response is invalid')
  assertExactKeys(
    value,
    [
      'planId',
      'documentId',
      'status',
      'committed',
      'revision',
      'commandCount',
      'affectedNodeIds',
      'observerErrorCount',
    ],
    'The Agent execute response is invalid',
  )
  if (
    typeof value.planId !== 'string' ||
    typeof value.documentId !== 'string' ||
    !['committed', 'committed_with_observer_errors'].includes(value.status as string) ||
    value.committed !== true ||
    (value.revision !== undefined && typeof value.revision !== 'string') ||
    !Number.isSafeInteger(value.commandCount) ||
    (value.commandCount as number) < 0 ||
    !isStringArray(value.affectedNodeIds) ||
    !Number.isSafeInteger(value.observerErrorCount) ||
    (value.observerErrorCount as number) < 0
  ) {
    throw closedError('The Agent execute response is invalid')
  }
}

const assertResponseResult = (operation: PendingRequest['operation'], value: unknown): void => {
  if (operation === 'snapshot') {
    assertSnapshotResult(value)
  } else if (operation === 'preview') {
    assertPreviewResult(value)
  } else {
    assertExecuteResult(value)
  }
}

const assertSafeError = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw closedError('The Agent response error is invalid')
  assertExactKeys(
    value,
    ['name', 'code', 'message', 'action', 'committed', 'rollbackComplete', 'terminal'],
    'The Agent response error is invalid',
  )
  if (
    typeof value.name !== 'string' ||
    typeof value.code !== 'string' ||
    typeof value.message !== 'string' ||
    typeof value.committed !== 'boolean' ||
    typeof value.terminal !== 'boolean' ||
    (value.action !== undefined && typeof value.action !== 'string') ||
    (value.rollbackComplete !== undefined && typeof value.rollbackComplete !== 'boolean')
  ) {
    throw closedError('The Agent response error is invalid')
  }
  return value
}

const normalizeTimeout = (value: unknown, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_TIMEOUT_MS) {
    throw new AgentCapabilityError({
      code: 'agent.transport.invalidOptions',
      message: `${name} must be a positive integer no greater than ${MAX_TIMEOUT_MS}`,
    })
  }
  return value as number
}

const normalizeClientOptions = (value: AgentPortClientOptions | undefined): NormalizedAgentPortClientOptions => {
  const options = value ?? {}
  if (!isRecord(options)) {
    throw new AgentCapabilityError({
      code: 'agent.transport.invalidOptions',
      message: 'Agent MessagePort client options must be an object',
    })
  }
  const allowedKeys = new Set(['signal', 'connectTimeoutMs', 'requestTimeoutMs'])
  if (Object.keys(options).some(key => !allowedKeys.has(key))) {
    throw new AgentCapabilityError({
      code: 'agent.transport.invalidOptions',
      message: 'Agent MessagePort client options contain unknown fields',
    })
  }
  const signal = options.signal
  if (
    signal !== undefined &&
    (!isRecord(signal) ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function')
  ) {
    throw new AgentCapabilityError({
      code: 'agent.transport.invalidOptions',
      message: 'Agent MessagePort client signal must be an AbortSignal',
    })
  }
  return {
    connectTimeoutMs: normalizeTimeout(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS, 'connectTimeoutMs'),
    requestTimeoutMs: normalizeTimeout(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs'),
    signal: signal as AbortSignal | undefined,
  }
}

const cloneInbound = <T>(value: T, path: string): Readonly<T> =>
  prepareAgentSnapshotData(value, path, {
    limitCode: 'agent.transport.limitExceeded',
    limitMessage: 'Agent transport response exceeds the protocol budget',
    maxBytes: AGENT_PORT_MAX_MESSAGE_BYTES * 4,
    maxDepth: 256,
    maxNodes: 262_144,
  }).value

class AgentPortClient implements AgentPortCapability {
  descriptor!: AgentPortSessionDescriptor

  private currentState: ClientState = 'connecting'

  private sessionId?: string

  private sequence = 0

  private readonly listeners = new Set<AgentDomainEventListener>()

  private readonly pending = new Map<number, PendingRequest>()

  private serial: Promise<void> = Promise.resolve()

  private readonly connected: Promise<AgentPortCapability>

  private resolveConnected!: (capability: AgentPortCapability) => void

  private rejectConnected!: (error: unknown) => void

  private removePortListeners: () => void = () => {}

  private connectTimer?: ReturnType<typeof setTimeout>

  private readonly handleAbort = () =>
    this.fail(transportError('agent.transport.aborted', 'The Agent transport was aborted'))

  constructor(
    private readonly port: AgentMessagePort,
    private readonly options: NormalizedAgentPortClientOptions,
  ) {
    this.connected = new Promise((resolve, reject) => {
      this.resolveConnected = resolve
      this.rejectConnected = reject
    })
    const removePortListeners = listenToAgentMessagePort(
      port,
      value => this.receive(value),
      () => this.fail(closedError('The Agent transport could not deserialize a message')),
      () => this.fail(closedError('The Agent transport peer closed')),
    )
    if (this.currentState === 'closed') {
      removePortListeners()
      return
    }
    this.removePortListeners = removePortListeners
    options.signal?.addEventListener('abort', this.handleAbort, { once: true })
    if (options.signal?.aborted) {
      this.fail(transportError('agent.transport.aborted', 'The Agent transport was aborted'))
      return
    }
    if (this.currentState !== 'connecting') return
    this.connectTimer = setTimeout(() => {
      this.fail(
        transportError(
          'agent.transport.connectTimeout',
          'The Agent transport host did not complete its handshake in time',
        ),
      )
    }, options.connectTimeoutMs)
  }

  waitUntilConnected(): Promise<AgentPortCapability> {
    return this.connected
  }

  snapshot(documentId: string): Promise<AgentDocumentSnapshot> {
    return this.call('snapshot', { documentId }) as Promise<AgentDocumentSnapshot>
  }

  preview(request: AgentPlanRequest): Promise<AgentPlanPreview> {
    return this.call('preview', request) as Promise<AgentPlanPreview>
  }

  execute(planId: string): Promise<AgentExecutionReceipt> {
    return this.call('execute', { planId }) as Promise<AgentExecutionReceipt>
  }

  subscribe(listener: AgentDomainEventListener): () => void {
    if (this.currentState !== 'open') throw closedError()
    if (typeof listener !== 'function') {
      throw new AgentCapabilityError({
        code: 'agent.transport.listenerInvalid',
        message: 'Agent domain event listener must be a function',
      })
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    if (this.currentState === 'closed' || this.currentState === 'closing') return
    this.currentState = 'closing'
    if (!this.sessionId) {
      this.fail(closedError())
      return
    }
    try {
      this.port.postMessage({
        kind: 'close',
        sessionId: this.sessionId,
        version: AGENT_PORT_PROTOCOL,
      })
    } catch {
      // Local close below remains fail-closed even when notification fails.
    }
    this.fail(closedError())
  }

  private call(operation: PendingRequest['operation'], payload: unknown): Promise<unknown> {
    const task = this.serial.then(() => this.send(operation, payload))
    this.serial = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private send(operation: PendingRequest['operation'], payload: unknown): Promise<unknown> {
    if (this.currentState !== 'open' || !this.sessionId) return Promise.reject(closedError())
    this.sequence += 1
    const sequence = this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(sequence)) return
        this.fail(
          transportError(
            'agent.transport.requestTimeout',
            `The Agent ${operation} response did not arrive before its deadline`,
          ),
        )
      }, this.options.requestTimeoutMs)
      this.pending.set(sequence, { operation, reject, resolve, timer })
      try {
        this.port.postMessage({
          kind: 'request',
          operation,
          payload,
          sequence,
          sessionId: this.sessionId,
          version: AGENT_PORT_PROTOCOL,
        })
      } catch {
        this.fail(closedError())
      }
    })
  }

  private receive(value: unknown): void {
    if (this.currentState === 'closed') return
    try {
      if (!isRecord(value) || value.version !== AGENT_PORT_PROTOCOL || typeof value.kind !== 'string') {
        throw closedError('The Agent host sent an invalid protocol message')
      }
      if (value.kind === 'ready') {
        this.receiveReady(value)
        return
      }
      if (typeof value.sessionId !== 'string' || value.sessionId !== this.sessionId) {
        throw closedError('The Agent host session does not match this client')
      }
      if (value.kind === 'response') {
        this.receiveResponse(value)
      } else if (value.kind === 'event') {
        this.receiveEvent(value)
      } else if (value.kind === 'closed') {
        this.fail(closedError(typeof value.reason === 'string' ? value.reason : undefined))
      } else {
        throw closedError('The Agent host sent an unsupported message kind')
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : closedError())
    }
  }

  private receiveReady(message: Record<string, unknown>): void {
    if (this.currentState !== 'connecting') throw closedError('The Agent host sent a duplicate ready message')
    if (typeof message.sessionId !== 'string' || !isRecord(message.descriptor)) {
      throw closedError('The Agent ready message is invalid')
    }
    const clonedDescriptor = cloneInbound(message.descriptor, '$.ready.descriptor') as Record<string, unknown>
    const executionAuthority = clonedDescriptor.executionAuthority ?? 'peer'
    if (executionAuthority !== 'peer' && executionAuthority !== 'host') {
      throw closedError('The Agent host execution authority is unsupported')
    }
    const descriptor = { ...clonedDescriptor, executionAuthority } as unknown as AgentPortSessionDescriptor
    if (
      descriptor.protocol !== AGENT_PORT_PROTOCOL ||
      descriptor.transport !== 'message-port' ||
      descriptor.isolation !== 'structured-clone-object-capability'
    ) {
      throw closedError('The Agent host descriptor is unsupported')
    }
    this.sessionId = message.sessionId
    this.descriptor = deepFreezeAgentData(descriptor) as AgentPortSessionDescriptor
    this.currentState = 'open'
    this.clearConnectTimer()
    this.resolveConnected(this)
  }

  private receiveResponse(message: Record<string, unknown>): void {
    if (!Number.isSafeInteger(message.sequence) || (message.sequence as number) < 1) {
      throw closedError('The Agent response sequence is invalid')
    }
    const sequence = message.sequence as number
    const request = this.pending.get(sequence)
    if (!request) throw closedError('The Agent response does not match a pending request')
    if (message.ok === true) {
      assertExactKeys(
        message,
        ['version', 'kind', 'sessionId', 'sequence', 'ok', 'result'],
        'The Agent response envelope is invalid',
      )
      const result = cloneInbound(message.result, '$.response.result')
      assertResponseResult(request.operation, result)
      this.settleRequest(sequence, request)
      request.resolve(result)
      return
    }
    if (message.ok !== false) throw closedError('The Agent response status is invalid')
    assertExactKeys(
      message,
      ['version', 'kind', 'sessionId', 'sequence', 'ok', 'error'],
      'The Agent response envelope is invalid',
    )
    const safeError = assertSafeError(cloneInbound(message.error, '$.response.error'))
    this.settleRequest(sequence, request)
    request.reject(
      new AgentCapabilityError({
        action: typeof safeError.action === 'string' ? safeError.action : undefined,
        code: typeof safeError.code === 'string' ? safeError.code : 'agent.transport.operationFailed',
        committed: safeError.committed === true,
        message: typeof safeError.message === 'string' ? safeError.message : 'The Agent capability operation failed',
        rollbackComplete: typeof safeError.rollbackComplete === 'boolean' ? safeError.rollbackComplete : undefined,
        terminal: safeError.terminal === true,
      }),
    )
  }

  private receiveEvent(message: Record<string, unknown>): void {
    if (!Number.isSafeInteger(message.eventSequence) || !isRecord(message.event)) {
      throw closedError('The Agent domain event is invalid')
    }
    const event = cloneInbound(message.event, '$.event') as unknown as AgentDomainEvent
    if (event.sequence !== message.eventSequence || event.type !== 'agent.transaction.committed') {
      throw closedError('The Agent domain event sequence is invalid')
    }
    try {
      for (const listener of [...this.listeners]) {
        try {
          listener(event)
        } catch {
          // Worker observers cannot affect the host transaction or later listeners.
        }
      }
    } finally {
      this.port.postMessage({
        eventSequence: event.sequence,
        kind: 'event-ack',
        sessionId: this.sessionId,
        version: AGENT_PORT_PROTOCOL,
      })
    }
  }

  private fail(error: Error): void {
    if (this.currentState === 'closed') return
    this.currentState = 'closed'
    this.clearConnectTimer()
    this.options.signal?.removeEventListener('abort', this.handleAbort)
    this.removePortListeners()
    this.removePortListeners = () => {}
    this.listeners.clear()
    if (!this.sessionId) this.rejectConnected(error)
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(
        request.operation === 'execute'
          ? this.descriptor?.executionAuthority === 'host'
            ? createAgentHostApprovalRequiredError()
            : new AgentTransportOutcomeUnknownError()
          : error,
      )
    }
    this.pending.clear()
    try {
      this.port.close()
    } catch {
      // The endpoint may already be closed by the host.
    }
  }

  private settleRequest(sequence: number, request: PendingRequest): void {
    if (this.pending.get(sequence) !== request) return
    this.pending.delete(sequence)
    clearTimeout(request.timer)
  }

  private clearConnectTimer(): void {
    if (this.connectTimer === undefined) return
    clearTimeout(this.connectTimer)
    this.connectTimer = undefined
  }
}

export const connectAgentPort = (
  port: AgentMessagePort,
  options?: AgentPortClientOptions,
): Promise<AgentPortCapability> => {
  if (!port || typeof port.postMessage !== 'function' || typeof port.close !== 'function') {
    return Promise.reject(
      new AgentCapabilityError({ code: 'agent.transport.invalidPort', message: 'A dedicated MessagePort is required' }),
    )
  }
  try {
    return new AgentPortClient(port, normalizeClientOptions(options)).waitUntilConnected()
  } catch (error) {
    return Promise.reject(error)
  }
}
