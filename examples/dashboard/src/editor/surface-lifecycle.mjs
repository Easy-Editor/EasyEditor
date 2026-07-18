const TRANSITIONS = Object.freeze({
  mounted: Object.freeze({ phase: 'suspending', target: 'suspended' }),
  suspended: Object.freeze({ phase: 'resuming', target: 'mounted' }),
})

const transitionError = (operation, phase) =>
  new Error(`Cannot ${operation} Dashboard editor surface while it is ${phase}`)

/**
 * Coordinates destructive Core project swaps with the React renderer surface.
 * A transition resolves only after every mounted surface participant confirms
 * that React has committed the corresponding unmount or remount.
 */
export const createDashboardEditorSurfaceLifecycle = () => {
  let phase = 'mounted'
  let activeTransition = null
  const listeners = new Set()
  const participants = new Set()

  const publish = () => {
    for (const listener of [...listeners]) listener()
  }

  const finishTransition = transition => {
    if (activeTransition !== transition || transition.pending.size) return
    phase = transition.target
    activeTransition = null
    publish()
    transition.resolve()
  }

  const beginTransition = (operation, sourcePhase) => {
    const definition = TRANSITIONS[sourcePhase]
    if (!definition) throw transitionError(operation, phase)
    if (phase !== sourcePhase) {
      if (activeTransition?.operation === operation) return activeTransition.promise
      throw transitionError(operation, phase)
    }

    let resolve
    const promise = new Promise(settle => {
      resolve = settle
    })
    const transition = {
      operation,
      phase: definition.phase,
      target: definition.target,
      pending: new Set(participants),
      promise,
      resolve,
    }
    activeTransition = transition
    phase = transition.phase
    publish()
    finishTransition(transition)
    return promise
  }

  return Object.freeze({
    getSnapshot: () => phase,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    registerParticipant() {
      const token = Object.freeze({})
      participants.add(token)
      activeTransition?.pending.add(token)
      let active = true
      return Object.freeze({
        acknowledge(observedPhase) {
          if (!active) return
          const transition = activeTransition
          if (!transition || transition.phase !== observedPhase) return
          transition.pending.delete(token)
          finishTransition(transition)
        },
        dispose() {
          if (!active) return
          active = false
          participants.delete(token)
          const transition = activeTransition
          if (!transition) return
          transition.pending.delete(token)
          finishTransition(transition)
        },
      })
    },
    suspend() {
      if (phase === 'suspended') return Promise.resolve()
      return beginTransition('suspend', 'mounted')
    },
    resume() {
      if (phase === 'mounted') return Promise.resolve()
      return beginTransition('resume', 'suspended')
    },
  })
}

export const dashboardEditorSurfaceLifecycle = createDashboardEditorSurfaceLifecycle()
