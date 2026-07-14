import { assertLifecycleMutationAllowed, inheritLifecycleMutationGuard } from '../lifecycle/mutation-barrier'
import { withoutProjectMutationAuthority } from '../project/mutation-authority'
import { type EventBus, type EventDeliveryScheduler, createEventBus } from '../utils/event-bus'
import type { Designer } from './designer'

const designerEventDelivery = new WeakMap<Designer, EventDeliveryScheduler | undefined>()

/** Package-internal installation; the raw scheduler never becomes a Designer property. */
export function installDesignerEventDelivery(
  designer: Designer,
  eventDelivery: EventDeliveryScheduler | undefined,
): void {
  if (designerEventDelivery.has(designer)) throw new Error('Designer event delivery is already installed')
  designerEventDelivery.set(designer, eventDelivery)
}

/** Package-internal finite operation for non-EventBus domain publishers. */
export function deferDesignerEvent(designer: Designer, deliver: () => void): boolean {
  return designerEventDelivery.get(designer)?.(deliver) ?? false
}

/** Package-internal factory for event buses that inherit one Designer lifecycle. */
export function createDesignerEventBus(designer: Designer, name: string, maxListeners?: number): EventBus {
  assertLifecycleMutationAllowed(designer, 'designer.eventBus.create')
  const eventBus = createEventBus(
    name,
    maxListeners,
    deliver => deferDesignerEvent(designer, deliver),
    callback => {
      // Project is assigned after its constructor returns. Event delivery and
      // listener teardown happen only after that point, but keep construction
      // safe for the Project-owned bus created inside that constructor.
      const project = designer.project
      return project ? withoutProjectMutationAuthority(project, callback) : callback()
    },
  )
  inheritLifecycleMutationGuard(designer, eventBus)
  return eventBus
}
