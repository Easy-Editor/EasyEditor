export {
  HumanActivityLease,
  HumanActivityLeaseDisposedError,
  createHumanActivityLease,
} from './human-activity-lease.mjs'
export { createDashboardInvocationActivity } from './invocation-activity.mjs'

const requireEventTarget = target => {
  if (!target || typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') {
    throw new TypeError('human activity tracking requires an EventTarget')
  }
  return target
}

const pointerKey = event => {
  const value = event && typeof event === 'object' ? event.pointerId : undefined
  return Number.isInteger(value) && value >= 0 ? value : 0
}

export const installHumanActivityTracking = ({ lease, target }) => {
  requireEventTarget(target)
  if (
    !lease ||
    typeof lease.acquire !== 'function' ||
    typeof lease.recordActivity !== 'function' ||
    typeof lease.dispose !== 'function'
  ) {
    throw new TypeError('human activity tracking requires a HumanActivityLease')
  }

  const pointerHolds = new Map()
  let disposed = false
  const releasePointer = event => {
    const key = pointerKey(event)
    const hold = pointerHolds.get(key)
    if (!hold) return
    pointerHolds.delete(key)
    hold.release()
  }
  const releaseAllPointers = () => {
    for (const hold of pointerHolds.values()) hold.release()
    pointerHolds.clear()
  }
  const onPointerDown = event => {
    const key = pointerKey(event)
    pointerHolds.get(key)?.release()
    pointerHolds.set(key, lease.acquire('pointer'))
  }
  const onPointerMove = event => pointerHolds.get(pointerKey(event))?.renew()
  const onKeyDown = () => lease.recordActivity('keyboard')

  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', releasePointer],
    ['pointercancel', releasePointer],
    ['blur', releaseAllPointers],
    ['keydown', onKeyDown],
  ]
  for (const [type, listener] of listeners) target.addEventListener(type, listener, true)

  return () => {
    if (disposed) return
    disposed = true
    for (const [type, listener] of listeners) target.removeEventListener(type, listener, true)
    releaseAllPointers()
  }
}
