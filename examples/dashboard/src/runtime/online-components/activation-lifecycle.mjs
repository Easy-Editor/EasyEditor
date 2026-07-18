const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/

const assertIdentifier = (value, name) => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${name} is invalid`)
  }
  return value
}

const assertMarkerStore = markerStore => {
  for (const method of ['read', 'write', 'clear', 'quarantine']) {
    if (typeof markerStore?.[method] !== 'function') {
      throw new TypeError(`markerStore.${method} is required`)
    }
  }
  return markerStore
}

export const createActivationMarkerKey = ({ revisionKey, surfaceId }) =>
  `${assertIdentifier(revisionKey, 'revisionKey')}::${assertIdentifier(surfaceId, 'surfaceId')}`

export const createOnlineComponentActivationLifecycle = options => {
  const {
    markerStore,
    revisionKey,
    surfaceId,
    activationId,
    nonce,
    safeBoot = false,
    now = () => Date.now(),
  } = options ?? {}
  const store = assertMarkerStore(markerStore)
  const key = createActivationMarkerKey({ revisionKey, surfaceId })
  assertIdentifier(nonce, 'nonce')
  if (typeof now !== 'function') throw new TypeError('now must be a function')

  let state = 'idle'
  let marker

  const createPendingMarker = () => {
    const startedAt = now()
    if (!Number.isFinite(startedAt)) throw new TypeError('activation timestamp must be finite')
    return Object.freeze({
      state: 'pending',
      revisionKey,
      surfaceId,
      activationId,
      nonce,
      startedAt,
    })
  }

  const begin = () => {
    if (state !== 'idle') throw new Error('activation lifecycle has already started')
    const staleMarker = store.read(key)
    if (staleMarker) {
      store.quarantine(revisionKey, staleMarker)
      state = safeBoot ? 'safe-boot-skipped' : 'quarantined'
      return Object.freeze({
        activate: false,
        state,
        reason: safeBoot ? 'safe-boot' : 'stale-pending-marker',
      })
    }
    if (safeBoot) {
      state = 'safe-boot-skipped'
      return Object.freeze({ activate: false, state, reason: 'safe-boot' })
    }

    marker = createPendingMarker()
    store.write(key, marker)
    state = 'pending'
    return Object.freeze({ activate: true, state, marker })
  }

  const heartbeat = () => false

  const completeRehydrate = () => {
    if (state !== 'pending' || !marker) return false
    store.clear(key, marker)
    marker = undefined
    state = 'active'
    return true
  }

  const abortPending = () => {
    if (state !== 'pending' || !marker) return false
    store.clear(key, marker)
    marker = undefined
    state = 'disposed'
    return true
  }

  const fail = () => {
    if (state === 'quarantined') return false
    if (state !== 'pending' && state !== 'active') return false
    if (!marker) {
      marker = createPendingMarker()
      store.write(key, marker)
    }
    store.quarantine(revisionKey, marker)
    state = 'quarantined'
    return true
  }

  const dispose = () => {
    if (state === 'active') state = 'disposed'
  }

  return Object.freeze({
    begin,
    heartbeat,
    completeRehydrate,
    abortPending,
    fail,
    dispose,
    getDiagnostics: () => Object.freeze({ state, revisionKey, key }),
  })
}
