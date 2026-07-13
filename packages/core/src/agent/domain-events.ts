import { uniqueId } from '../utils/unique-id'
import { deepFreezeAgentData } from './strict-data-validator'
import type { AgentDomainEvent, AgentDomainEventListener, AgentTransactionCommittedEvent } from './types'

const MAX_PENDING_EVENTS = 256
const MAX_PENDING_BYTES = 512 * 1024

interface Subscription {
  listener?: AgentDomainEventListener
  readonly startSequence: number
}

interface Delivery {
  readonly bytes: number
  readonly event: AgentDomainEvent
}

export type AgentCommittedEventInput = Omit<
  AgentTransactionCommittedEvent,
  'eventId' | 'sequence' | 'timestamp' | 'type' | 'version'
>

export class AgentDomainEventPublisher {
  private readonly listeners = new Set<Subscription>()

  private readonly queue: Delivery[] = []

  private queuedBytes = 0

  private scheduled = false

  private sequence = 0

  private deliveryGeneration = 0

  subscribe(listener: AgentDomainEventListener): () => void {
    const subscription: Subscription = { listener, startSequence: this.sequence + 1 }
    this.listeners.add(subscription)
    return () => {
      subscription.listener = undefined
      this.listeners.delete(subscription)
    }
  }

  publishCommitted(input: AgentCommittedEventInput): AgentTransactionCommittedEvent {
    this.sequence += 1
    const event = deepFreezeAgentData({
      ...input,
      eventId: uniqueId('agent-event'),
      sequence: this.sequence,
      timestamp: Date.now(),
      type: 'agent.transaction.committed' as const,
      version: 1 as const,
    }) as AgentTransactionCommittedEvent
    if (this.listeners.size === 0) return event

    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength
    this.queue.push({ bytes, event })
    this.queuedBytes += bytes
    while (this.queue.length > MAX_PENDING_EVENTS || this.queuedBytes > MAX_PENDING_BYTES) {
      this.queuedBytes -= this.queue.shift()?.bytes ?? 0
    }
    if (!this.scheduled) this.schedule()
    return event
  }

  clear(): void {
    this.deliveryGeneration += 1
    for (const subscription of this.listeners) subscription.listener = undefined
    this.listeners.clear()
    this.queue.length = 0
    this.queuedBytes = 0
    this.scheduled = false
  }

  private schedule(): void {
    this.scheduled = true
    const generation = this.deliveryGeneration
    try {
      queueMicrotask(() => {
        if (generation === this.deliveryGeneration) this.flush()
      })
    } catch {
      this.scheduled = false
      this.queue.length = 0
      this.queuedBytes = 0
    }
  }

  private flush(): void {
    this.scheduled = false
    const deliveries = this.queue.splice(0)
    this.queuedBytes = 0
    for (const { event } of deliveries) {
      for (const subscription of [...this.listeners]) {
        if (subscription.startSequence > event.sequence) continue
        const listener = subscription.listener
        if (!listener) continue
        try {
          listener(event)
        } catch {
          // Domain observers are isolated from committed model operations.
        }
      }
    }
  }
}
