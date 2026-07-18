const lockPrefix = 'easy-editor:agent-runtime:material-gc-cross-tab:v1'
const identityLockName = `${lockPrefix}:identity`

const disabledUnavailableResult = Object.freeze({
  status: 'unavailable',
  reason: 'disabled',
})
const locksUnavailableResult = Object.freeze({
  status: 'unavailable',
  reason: 'web-locks-unavailable',
})
const disposedUnavailableResult = Object.freeze({
  status: 'unavailable',
  reason: 'coordinator-disposed',
})

export const DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE = Object.freeze({
  disabled: 'disabled',
  invalidInput: 'invalid-input',
  lockNotGranted: 'lock-not-granted',
  locksUnavailable: 'web-locks-unavailable',
  disposed: 'coordinator-disposed',
})

export const DASHBOARD_MATERIAL_GC_LOCK_ORDER = Object.freeze({
  identity: Object.freeze(['identity-exclusive']),
  normalGcOrAdmission: Object.freeze([
    'local-mutation-quiescence',
    'project-material-fence',
    'project-replica-exclusive',
    'server-authority',
  ]),
  terminalRelease: Object.freeze([
    'local-mutation-terminal-close',
    'drop-own-shared-presence',
    'project-presence-exclusive',
    'project-material-fence',
    'project-replica-exclusive',
    'server-authority',
  ]),
})

export class DashboardMaterialGcCrossTabCoordinatorError extends Error {
  constructor(code, reason, options) {
    super(reason, options)
    this.name = 'DashboardMaterialGcCrossTabCoordinatorError'
    this.code = code
    this.reason = reason
  }
}

const fail = (code, reason, options) => new DashboardMaterialGcCrossTabCoordinatorError(code, reason, options)

const requireObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.invalidInput, `${label}-must-be-an-object`)
  }
  return value
}

const containsControlCharacter = value =>
  [...value].some(character => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 31 || codePoint === 127
  })

const requireIdentifier = (value, label) => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value !== value.trim() ||
    containsControlCharacter(value)
  ) {
    throw fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.invalidInput, `${label}-must-be-a-canonical-non-empty-string`)
  }
  return value
}

const requireOperation = operation => {
  if (typeof operation !== 'function') {
    throw fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.invalidInput, 'cross-tab-lock-operation-must-be-a-function')
  }
  return operation
}

const optionalSignal = options => {
  if (options === undefined) return undefined
  const value = requireObject(options, 'cross-tab-lock-options').signal
  if (
    value !== undefined &&
    (!value ||
      typeof value !== 'object' ||
      typeof value.aborted !== 'boolean' ||
      typeof value.addEventListener !== 'function' ||
      typeof value.removeEventListener !== 'function')
  ) {
    throw fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.invalidInput, 'cross-tab-lock-signal-is-invalid')
  }
  return value
}

const createRequestOptions = (mode, options, extra = undefined) => {
  const signal = optionalSignal(options)
  const requestOptions = { mode, ...extra }
  if (signal !== undefined) requestOptions.signal = signal
  return requestOptions
}

const projectPresenceLockName = (projectId, replicaId) =>
  `${lockPrefix}:project-presence:${encodeURIComponent(
    requireIdentifier(projectId, 'projectId'),
  )}:${encodeURIComponent(requireIdentifier(replicaId, 'replicaId'))}`

const projectReplicaLockName = (projectId, replicaId) =>
  `${lockPrefix}:project-replica:${encodeURIComponent(
    requireIdentifier(projectId, 'projectId'),
  )}:${encodeURIComponent(requireIdentifier(replicaId, 'replicaId'))}`

export const createDashboardMaterialGcCrossTabLockNames = value => {
  const scope = requireObject(value, 'material-gc-cross-tab-lock-scope')
  const projectId = requireIdentifier(scope.projectId, 'projectId')
  const replicaId = requireIdentifier(scope.replicaId, 'replicaId')
  return Object.freeze({
    identity: identityLockName,
    projectPresence: projectPresenceLockName(projectId, replicaId),
    projectReplica: projectReplicaLockName(projectId, replicaId),
  })
}

const createLockContext = (name, mode) => Object.freeze({ name, mode })

const createDeferred = () => {
  let resolve
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const disabledCoordinator = Object.freeze({
  enabled: false,
  withIdentityExclusive() {
    return Promise.reject(
      fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.disabled, 'material-gc-cross-tab-coordinator-is-disabled'),
    )
  },
  withProjectReplicaExclusive() {
    return Promise.reject(
      fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.disabled, 'material-gc-cross-tab-coordinator-is-disabled'),
    )
  },
  acquireProjectPresenceLease() {
    return Promise.reject(
      fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.disabled, 'material-gc-cross-tab-coordinator-is-disabled'),
    )
  },
  tryWithProjectPresenceExclusive() {
    return Promise.resolve(disabledUnavailableResult)
  },
  dispose() {
    return Promise.resolve(false)
  },
})

export const createDashboardMaterialGcCrossTabCoordinator = options => {
  const input = requireObject(options, 'material-gc-cross-tab-coordinator-options')
  const enabled = input.enabled === true
  if (!enabled) return disabledCoordinator

  const injectedLockManager = input.lockManager
  const lockManager = injectedLockManager ?? globalThis.navigator?.locks
  const locksAvailable = Boolean(lockManager && typeof lockManager.request === 'function')
  const presenceLeases = new Set()
  let disposed = false

  const unavailableError = () =>
    fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.locksUnavailable, 'material-gc-cross-tab-web-locks-are-unavailable')

  const requireReadyLockManager = () => {
    if (disposed) {
      throw fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.disposed, 'material-gc-cross-tab-coordinator-is-disposed')
    }
    if (!locksAvailable) throw unavailableError()
    return lockManager
  }

  const requestExclusive = async (name, operation, requestOptions) => {
    const manager = requireReadyLockManager()
    const callback = requireOperation(operation)
    return manager.request(name, requestOptions, async lock => {
      if (!lock) {
        throw fail(
          DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.lockNotGranted,
          'material-gc-cross-tab-exclusive-lock-was-not-granted',
        )
      }
      if (disposed) {
        throw fail(DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.disposed, 'material-gc-cross-tab-coordinator-is-disposed')
      }
      return callback(createLockContext(name, 'exclusive'))
    })
  }

  const coordinator = {
    enabled: true,

    withIdentityExclusive(operation, requestOptions) {
      return requestExclusive(identityLockName, operation, createRequestOptions('exclusive', requestOptions))
    },

    withProjectReplicaExclusive(value, operation, requestOptions) {
      const scope = requireObject(value, 'material-gc-project-replica-scope')
      const name = projectReplicaLockName(scope.projectId, scope.replicaId)
      return requestExclusive(name, operation, createRequestOptions('exclusive', requestOptions))
    },

    async acquireProjectPresenceLease(value, requestOptions) {
      const scope = requireObject(value, 'material-gc-project-presence-scope')
      const projectId = requireIdentifier(scope.projectId, 'projectId')
      const replicaId = requireIdentifier(scope.replicaId, 'replicaId')
      const name = projectPresenceLockName(projectId, replicaId)
      const manager = requireReadyLockManager()
      const released = createDeferred()
      const acquired = createDeferred()
      const closed = createDeferred()
      let releaseRequested = false
      let lease

      const requestPromise = (() => {
        try {
          return Promise.resolve(
            manager.request(name, createRequestOptions('shared', requestOptions), async lock => {
              if (!lock) {
                const error = fail(
                  DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.lockNotGranted,
                  'material-gc-cross-tab-presence-lock-was-not-granted',
                )
                acquired.resolve({ status: 'failed', error })
                throw error
              }
              if (disposed) {
                const error = fail(
                  DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.disposed,
                  'material-gc-cross-tab-coordinator-is-disposed',
                )
                acquired.resolve({ status: 'failed', error })
                throw error
              }
              lease = Object.freeze({
                kind: 'dashboard-material-gc-project-presence-lease',
                projectId,
                replicaId,
                lockName: name,
                get released() {
                  return releaseRequested
                },
                release() {
                  if (releaseRequested) return false
                  releaseRequested = true
                  released.resolve()
                  return true
                },
                closed: closed.promise,
              })
              presenceLeases.add(lease)
              acquired.resolve({ status: 'acquired', lease })
              await released.promise
            }),
          )
        } catch (error) {
          return Promise.reject(error)
        }
      })()

      requestPromise.then(
        () => {
          if (lease) presenceLeases.delete(lease)
          closed.resolve(Object.freeze({ status: 'released' }))
          if (!lease) {
            acquired.resolve({
              status: 'failed',
              error: fail(
                DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE.lockNotGranted,
                'material-gc-cross-tab-presence-lock-ended-before-acquisition',
              ),
            })
          }
        },
        error => {
          if (lease) presenceLeases.delete(lease)
          closed.resolve(Object.freeze({ status: 'failed', error }))
          acquired.resolve({ status: 'failed', error })
        },
      )

      const result = await acquired.promise
      if (result.status === 'failed') throw result.error
      return result.lease
    },

    async tryWithProjectPresenceExclusive(value, operation, requestOptions) {
      const scope = requireObject(value, 'material-gc-project-presence-scope')
      const projectId = requireIdentifier(scope.projectId, 'projectId')
      const replicaId = requireIdentifier(scope.replicaId, 'replicaId')
      const name = projectPresenceLockName(projectId, replicaId)
      const callback = requireOperation(operation)
      if (disposed) return disposedUnavailableResult
      if (!locksAvailable) return locksUnavailableResult

      return lockManager.request(
        name,
        createRequestOptions('exclusive', requestOptions, { ifAvailable: true }),
        async lock => {
          if (disposed) return disposedUnavailableResult
          if (!lock) {
            return Object.freeze({
              status: 'in-use',
              projectId,
              replicaId,
              lockName: name,
            })
          }
          const value = await callback(createLockContext(name, 'exclusive'))
          return Object.freeze({
            status: 'acquired',
            projectId,
            replicaId,
            lockName: name,
            value,
          })
        },
      )
    },

    async dispose() {
      if (disposed) return false
      disposed = true
      const leases = [...presenceLeases]
      for (const lease of leases) lease.release()
      await Promise.all(leases.map(lease => lease.closed))
      return true
    },
  }

  return Object.freeze(coordinator)
}
