import { uniqueId } from '../../utils/unique-id'
import { deepFreezeAgentData } from '../strict-data-validator'
import type {
  AgentCapability,
  AgentDomainEvent,
  AgentDomainEventListener,
  AgentMessagePort,
  AgentPortSession,
  AgentPortSessionDescriptor,
  AgentPortSessionOptions,
} from '../types'
import { listenToAgentMessagePort } from './message-port'
import {
  AGENT_PORT_PROTOCOL,
  type AgentPortEventMessage,
  AgentPortProtocolError,
  type AgentPortRequestMessage,
  parseAgentPortInboundMessage,
  toAgentPortSafeError,
} from './protocol'

const MAX_UNACKNOWLEDGED_EVENTS = 16
const MAX_QUEUED_EVENTS = 128
const MAX_QUEUED_EVENT_BYTES = 256 * 1024

export interface AgentPortHostSessionDependencies {
  readonly capability: AgentCapability
  readonly port: AgentMessagePort
  readonly options: AgentPortSessionOptions
  readonly subscribeEvents: (listener: AgentDomainEventListener) => () => void
  readonly onClose: (session: AgentPortHostSession) => void
}

export class AgentPortHostSession implements AgentPortSession {
  readonly descriptor: AgentPortSessionDescriptor

  private readonly sessionId = uniqueId('agent-port')

  private currentState: AgentPortSession['state'] = 'open'

  private expectedSequence = 1

  private readonly unacknowledgedEvents = new Set<number>()

  private readonly queuedEvents: Array<{ bytes: number; event: AgentDomainEvent }> = []

  private queuedEventBytes = 0

  private unsubscribeEvents: () => void = () => {}

  private removePortListeners: () => void = () => {}

  private readonly handleAbort = () => this.terminate('agent.transport.aborted')

  constructor(private readonly dependencies: AgentPortHostSessionDependencies) {
    this.descriptor = deepFreezeAgentData({
      capability: dependencies.capability.descriptor,
      isolation: 'structured-clone-object-capability' as const,
      protocol: AGENT_PORT_PROTOCOL,
      transport: 'message-port' as const,
    }) as AgentPortSessionDescriptor

    const { port, options } = dependencies
    const removePortListeners = listenToAgentMessagePort(
      port,
      value => this.receive(value),
      () => this.terminate('agent.transport.messageerror'),
      () => this.terminate('agent.transport.peerClosed', false),
    )
    if (this.currentState === 'closed') {
      removePortListeners()
      return
    }
    this.removePortListeners = removePortListeners
    options.signal.addEventListener('abort', this.handleAbort, { once: true })
    this.unsubscribeEvents = dependencies.subscribeEvents(event => {
      if (event.capabilityId === this.descriptor.capability.capabilityId) this.enqueueEvent(event)
    })
    if (options.signal.aborted) {
      this.terminate('agent.transport.aborted', false)
      return
    }
    try {
      port.postMessage({
        descriptor: this.descriptor,
        kind: 'ready',
        sessionId: this.sessionId,
        version: AGENT_PORT_PROTOCOL,
      })
    } catch {
      this.terminate('agent.transport.deliveryFailed', false)
    }
  }

  get state(): AgentPortSession['state'] {
    return this.currentState
  }

  close(): void {
    this.terminate('agent.transport.closed')
  }

  terminate(reason: string, notify = true): void {
    if (this.currentState === 'closed' || this.currentState === 'closing') return
    this.currentState = 'closing'
    const { capability, onClose, options, port } = this.dependencies
    this.unsubscribeEvents()
    this.unsubscribeEvents = () => {}
    options.signal.removeEventListener('abort', this.handleAbort)
    this.removePortListeners()
    this.removePortListeners = () => {}
    this.queuedEvents.length = 0
    this.queuedEventBytes = 0
    this.unacknowledgedEvents.clear()
    try {
      capability.close()
    } catch {
      // Closing the transport remains best-effort and fail-closed.
    }
    if (notify) {
      try {
        port.postMessage({ kind: 'closed', reason, sessionId: this.sessionId, version: AGENT_PORT_PROTOCOL })
      } catch {
        // The peer may already be gone.
      }
    }
    try {
      port.close()
    } finally {
      this.currentState = 'closed'
      onClose(this)
    }
  }

  private receive(value: unknown): void {
    if (this.currentState !== 'open') return
    try {
      const message = parseAgentPortInboundMessage(value)
      if (message.sessionId !== this.sessionId) throw new AgentPortProtocolError('Agent port session mismatch')
      if (message.kind === 'close') {
        this.terminate('agent.transport.closed')
        return
      }
      if (message.kind === 'event-ack') {
        this.acknowledgeEvent(message.eventSequence)
        return
      }
      if (message.sequence !== this.expectedSequence) {
        throw new AgentPortProtocolError('Agent port request sequence is not strictly monotonic')
      }
      this.expectedSequence += 1
      this.dispatch(message)
    } catch (error) {
      if (error instanceof AgentPortProtocolError) {
        this.terminate('agent.transport.protocol')
        return
      }
      this.terminate('agent.transport.internal')
    }
  }

  private dispatch(message: AgentPortRequestMessage): void {
    const { capability, port } = this.dependencies
    let result: unknown
    try {
      if (message.operation === 'snapshot') {
        const payload = this.requirePayload(message.payload, ['documentId'])
        if (typeof payload.documentId !== 'string') throw new AgentPortProtocolError('snapshot documentId is required')
        result = capability.snapshot(payload.documentId)
      } else if (message.operation === 'preview') {
        result = capability.preview(message.payload as never)
      } else {
        const payload = this.requirePayload(message.payload, ['planId'])
        if (typeof payload.planId !== 'string') throw new AgentPortProtocolError('execute planId is required')
        result = capability.execute(payload.planId)
      }
    } catch (error) {
      if (error instanceof AgentPortProtocolError) throw error
      try {
        port.postMessage({
          error: toAgentPortSafeError(error),
          kind: 'response',
          ok: false,
          sequence: message.sequence,
          sessionId: this.sessionId,
          version: AGENT_PORT_PROTOCOL,
        })
      } catch {
        this.terminate('agent.transport.deliveryFailed', false)
      }
      return
    }
    try {
      port.postMessage({
        kind: 'response',
        ok: true,
        result,
        sequence: message.sequence,
        sessionId: this.sessionId,
        version: AGENT_PORT_PROTOCOL,
      })
    } catch {
      // In particular, never convert a committed execute with a lost response
      // into a false negative that the worker could retry.
      this.terminate('agent.transport.deliveryFailed', false)
    }
  }

  private requirePayload(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentPortProtocolError('Agent operation payload must be an object')
    }
    const record = value as Record<string, unknown>
    const allowed = new Set(keys)
    if (Object.keys(record).some(key => !allowed.has(key))) {
      throw new AgentPortProtocolError('Agent operation payload contains unknown fields')
    }
    return record
  }

  private enqueueEvent(event: AgentDomainEvent): void {
    if (this.currentState !== 'open') return
    if (this.unacknowledgedEvents.size < MAX_UNACKNOWLEDGED_EVENTS) {
      this.sendEvent(event)
      return
    }
    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength
    if (this.queuedEvents.length >= MAX_QUEUED_EVENTS || bytes > MAX_QUEUED_EVENT_BYTES - this.queuedEventBytes) {
      this.terminate('agent.transport.backpressure')
      return
    }
    this.queuedEvents.push({ bytes, event })
    this.queuedEventBytes += bytes
  }

  private sendEvent(event: AgentDomainEvent): void {
    const message: AgentPortEventMessage = {
      event,
      eventSequence: event.sequence,
      kind: 'event',
      sessionId: this.sessionId,
      version: AGENT_PORT_PROTOCOL,
    }
    try {
      this.dependencies.port.postMessage(message)
      this.unacknowledgedEvents.add(event.sequence)
    } catch {
      this.terminate('agent.transport.deliveryFailed', false)
    }
  }

  private acknowledgeEvent(sequence: number): void {
    if (!this.unacknowledgedEvents.delete(sequence)) {
      throw new AgentPortProtocolError('Unknown Agent event acknowledgement')
    }
    while (this.queuedEvents.length && this.unacknowledgedEvents.size < MAX_UNACKNOWLEDGED_EVENTS) {
      const queued = this.queuedEvents.shift()!
      this.queuedEventBytes -= queued.bytes
      this.sendEvent(queued.event)
    }
  }
}
