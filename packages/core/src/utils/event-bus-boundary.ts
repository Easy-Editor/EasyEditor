import type { EventBus, EventDeliveryScheduler } from './event-bus'

interface EventBusDeliveryOperations {
  claimEngineScheduler(scheduleDelivery: EventDeliveryScheduler): void
}

const deliveryOperations = new WeakMap<EventBus, EventBusDeliveryOperations>()

/** Install the private scheduler mutation seam while the EventBus is constructed. */
export function installEventBusDeliveryOperations(eventBus: EventBus, operations: EventBusDeliveryOperations): void {
  if (deliveryOperations.has(eventBus)) throw new Error('EventBus delivery operations are already installed')
  deliveryOperations.set(eventBus, operations)
}

/** Package-private one-way claim used only when an Engine adopts a compatibility EventBus. */
export function claimEngineEventBusDeliveryScheduler(
  eventBus: EventBus,
  scheduleDelivery: EventDeliveryScheduler,
): void {
  const operations = deliveryOperations.get(eventBus)
  if (!operations) throw new TypeError('Engine services require an EventBus created by the core runtime')
  operations.claimEngineScheduler(scheduleDelivery)
}
