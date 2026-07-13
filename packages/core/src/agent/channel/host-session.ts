import { uniqueId } from '../../utils/unique-id'
import { AgentCapabilityError } from '../errors'
import { deepFreezeAgentData } from '../strict-data-validator'
import type {
  AgentCapability,
  AgentDomainEvent,
  AgentDomainEventListener,
  AgentMessagePort,
  AgentPlanPreview,
  AgentPortSession,
  AgentPortSessionDescriptor,
  AgentPortSessionOptions,
} from '../types'
import { createAgentMessagePortListenerLease } from './message-port'
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
  readonly denyPeerExecution?: (planId: string) => AgentCapabilityError
  readonly executeHostApproved: (planId: string) => ReturnType<AgentCapability['execute']>
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

  private preparedPlanPreview?: AgentPlanPreview

  private terminalPlanId?: string

  private unsubscribeEvents?: () => void

  private removePortListeners?: () => void

  private abortListenerRegistered = false

  private capabilityClosed = false

  private portClosed = false

  private terminationReason?: string

  private notifyOnTermination = false

  private closeNotificationAttempted = false

  private terminationInProgress = false

  private initializationFailure?: unknown

  private readonly handleAbort = () => this.terminate('agent.transport.aborted')

  constructor(private readonly dependencies: AgentPortHostSessionDependencies) {
    this.descriptor = deepFreezeAgentData({
      capability: dependencies.capability.descriptor,
      executionAuthority: dependencies.options.executionAuthority ?? 'peer',
      isolation: 'structured-clone-object-capability' as const,
      protocol: AGENT_PORT_PROTOCOL,
      transport: 'message-port' as const,
    }) as AgentPortSessionDescriptor

    const { port, options } = dependencies
    const portListenerLease = createAgentMessagePortListenerLease(
      port,
      value => this.receive(value),
      () => this.terminate('agent.transport.messageerror'),
      () => this.terminate('agent.transport.peerClosed', false),
    )
    // Retain the lease before acquiring any registration. If a listener API
    // partially succeeds and rollback fails, engine teardown can retry it.
    this.removePortListeners = portListenerLease.dispose
    try {
      portListenerLease.listen()
    } catch (error) {
      this.failInitialization(error, 'agent.transport.listenerFailed')
      return
    }
    if (this.currentState === 'closed') return
    try {
      // Mark the listener provisionally before acquisition so a signal
      // implementation that registers and then throws is still cleaned up.
      this.abortListenerRegistered = true
      options.signal.addEventListener('abort', this.handleAbort, { once: true })
      this.unsubscribeEvents = dependencies.subscribeEvents(event => {
        if (event.capabilityId === this.descriptor.capability.capabilityId) this.enqueueEvent(event)
      })
    } catch (error) {
      this.failInitialization(error, 'agent.transport.listenerFailed')
      return
    }
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

  get initializationError(): unknown {
    return this.initializationFailure
  }

  approveAndExecute(planId: string) {
    if (this.currentState !== 'open') {
      throw new AgentCapabilityError({
        action: 'execute',
        code: 'agent.transport.closed',
        message: 'Cannot approve an Agent plan on a closed MessagePort session',
        terminal: true,
      })
    }
    try {
      return this.dependencies.executeHostApproved(planId)
    } finally {
      this.retirePreparedPlan(planId)
    }
  }

  getPreparedPlanPreview(planId: string): AgentPlanPreview {
    if (this.currentState !== 'open') {
      throw new AgentCapabilityError({
        action: 'preview',
        code: 'agent.transport.closed',
        message: 'Cannot inspect an Agent plan on a closed MessagePort session',
        terminal: true,
      })
    }
    if (typeof planId !== 'string' || planId.length === 0) {
      throw new AgentCapabilityError({
        action: 'preview',
        code: 'agent.plan.invalid',
        message: 'planId is required',
      })
    }
    if (this.preparedPlanPreview?.planId === planId) return this.preparedPlanPreview
    if (this.terminalPlanId === planId) {
      throw new AgentCapabilityError({
        action: 'preview',
        code: 'agent.plan.terminal',
        message: 'The Agent plan is no longer prepared',
      })
    }
    throw new AgentCapabilityError({
      action: 'preview',
      code: 'agent.plan.notFound',
      message: 'The Agent plan was not prepared by this MessagePort session',
    })
  }

  close(): void {
    this.terminate('agent.transport.closed')
  }

  terminate(reason: string, notify = true): void {
    if (this.currentState === 'closed' || this.terminationInProgress) return
    this.terminationInProgress = true
    try {
      if (this.currentState === 'open') {
        this.currentState = 'closing'
        this.terminationReason = reason
        this.notifyOnTermination = notify
      }
      const { capability, onClose, options, port } = this.dependencies
      const failures: unknown[] = []
      const cleanup = (operation: () => void, completed: () => void) => {
        try {
          operation()
          completed()
        } catch (error) {
          failures.push(error)
        }
      }

      if (this.unsubscribeEvents) {
        cleanup(this.unsubscribeEvents, () => {
          this.unsubscribeEvents = undefined
        })
      }
      if (this.abortListenerRegistered) {
        cleanup(
          () => options.signal.removeEventListener('abort', this.handleAbort),
          () => {
            this.abortListenerRegistered = false
          },
        )
      }
      if (this.removePortListeners) {
        cleanup(this.removePortListeners, () => {
          this.removePortListeners = undefined
        })
      }
      this.queuedEvents.length = 0
      this.queuedEventBytes = 0
      this.unacknowledgedEvents.clear()
      this.preparedPlanPreview = undefined
      this.terminalPlanId = undefined
      if (!this.capabilityClosed) {
        cleanup(
          () => capability.close(),
          () => {
            this.capabilityClosed = true
          },
        )
      }
      if (this.notifyOnTermination && !this.closeNotificationAttempted) {
        this.closeNotificationAttempted = true
        try {
          port.postMessage({
            kind: 'closed',
            reason: this.terminationReason ?? reason,
            sessionId: this.sessionId,
            version: AGENT_PORT_PROTOCOL,
          })
        } catch {
          // The peer may already be gone.
        }
      }
      if (!this.portClosed) {
        cleanup(
          () => port.close(),
          () => {
            this.portClosed = true
          },
        )
      }
      if (failures.length) throw new AggregateError(failures, 'Agent MessagePort session termination failed')
      this.currentState = 'closed'
      onClose(this)
    } finally {
      this.terminationInProgress = false
    }
  }

  private failInitialization(error: unknown, reason: string): void {
    try {
      this.terminate(reason, false)
      this.initializationFailure = error
    } catch (cleanupError) {
      const cleanupFailures = cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError]
      this.initializationFailure = new AggregateError(
        [error, ...cleanupFailures],
        'Agent MessagePort session initialization rollback failed',
      )
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
        const preview = capability.preview(message.payload as never)
        this.rememberPreparedPlan(preview)
        result = preview
      } else {
        const payload = this.requirePayload(message.payload, ['planId'])
        if (typeof payload.planId !== 'string') throw new AgentPortProtocolError('execute planId is required')
        if (this.descriptor.executionAuthority === 'host') {
          throw (
            this.dependencies.denyPeerExecution?.(payload.planId) ??
            new AgentCapabilityError({
              action: 'execute',
              code: 'agent.execution.hostApprovalRequired',
              message: 'The Agent plan requires explicit host approval before execution',
            })
          )
        }
        try {
          result = capability.execute(payload.planId)
        } finally {
          this.retirePreparedPlan(payload.planId)
        }
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

  private rememberPreparedPlan(preview: AgentPlanPreview): void {
    if (this.preparedPlanPreview && this.preparedPlanPreview.planId !== preview.planId) {
      this.terminalPlanId = this.preparedPlanPreview.planId
    }
    this.preparedPlanPreview = preview
  }

  private retirePreparedPlan(planId: string): void {
    if (this.preparedPlanPreview?.planId !== planId) return
    this.preparedPlanPreview = undefined
    this.terminalPlanId = planId
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
