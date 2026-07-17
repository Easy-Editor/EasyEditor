const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

const normalizeTargetNodeIds = value => {
  if (!Array.isArray(value)) throw new TypeError('Invocation targetNodeIds must be an array')
  const unique = new Set()
  for (const nodeId of value) unique.add(requireNonEmptyString(nodeId, 'Invocation target node id'))
  return Object.freeze([...unique].sort(compareCodeUnits))
}

const requireFiniteNumber = (value, label, minimum = Number.NEGATIVE_INFINITY) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new TypeError(`${label} must be a finite number greater than or equal to ${minimum}`)
  }
  return value
}

const normalizeTargets = value => {
  if (!Array.isArray(value)) throw new TypeError('Invocation targets must be an array')
  const targets = new Map()
  for (const target of value) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new TypeError('Invocation target must be an object')
    }
    const nodeId = requireNonEmptyString(target.nodeId, 'Invocation target nodeId')
    if (targets.has(nodeId)) throw new TypeError('Invocation target nodeId must be unique')
    const rect = target.rect
    if (!rect || typeof rect !== 'object' || Array.isArray(rect)) {
      throw new TypeError('Invocation target rect must be an object')
    }
    targets.set(
      nodeId,
      Object.freeze({
        nodeId,
        label: requireNonEmptyString(target.label, 'Invocation target label'),
        rect: Object.freeze({
          x: requireFiniteNumber(rect.x, 'Invocation target rect.x'),
          y: requireFiniteNumber(rect.y, 'Invocation target rect.y'),
          width: requireFiniteNumber(rect.width, 'Invocation target rect.width', 0),
          height: requireFiniteNumber(rect.height, 'Invocation target rect.height', 0),
        }),
      }),
    )
  }
  return Object.freeze([...targets.values()].sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId)))
}

const cloneCall = call =>
  Object.freeze({
    callId: call.callId,
    capability: call.capability,
    taskId: call.taskId,
    startedAt: call.startedAt,
    targetNodeIds: Object.freeze([...call.targetNodeIds]),
    targets: Object.freeze(
      call.targets.map(target =>
        Object.freeze({
          nodeId: target.nodeId,
          label: target.label,
          rect: Object.freeze({ ...target.rect }),
        }),
      ),
    ),
  })

export const createDashboardInvocationActivity = ({ now = Date.now } = {}) => {
  if (typeof now !== 'function') throw new TypeError('Invocation activity clock must be a function')
  const active = new Map()
  const listeners = new Set()
  let revision = 0

  const notify = () => {
    revision += 1
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // UI observers cannot affect Host invocation authority.
      }
    }
  }

  return Object.freeze({
    begin(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('Invocation activity input must be an object')
      }
      const callId = requireNonEmptyString(input.callId, 'Invocation callId')
      if (active.has(callId)) throw new Error('Invocation activity callId is already active')
      const call = Object.freeze({
        callId,
        capability: requireNonEmptyString(input.capability, 'Invocation capability'),
        taskId: requireNonEmptyString(input.taskId, 'Invocation taskId'),
        startedAt: now(),
        targetNodeIds: normalizeTargetNodeIds(input.targetNodeIds ?? []),
        targets: normalizeTargets(input.targets ?? []),
      })
      active.set(callId, call)
      notify()
      let finished = false
      return () => {
        if (finished) return
        finished = true
        if (active.delete(callId)) notify()
      }
    },
    getSnapshot() {
      return Object.freeze({
        revision,
        activeCalls: Object.freeze(
          [...active.values()]
            .sort((left, right) => left.startedAt - right.startedAt || compareCodeUnits(left.callId, right.callId))
            .map(cloneCall),
        ),
      })
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Invocation activity listener must be a function')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      if (active.size === 0 && listeners.size === 0) return
      active.clear()
      listeners.clear()
      revision += 1
    },
  })
}
