import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'

const legacySnapshotLockPrefix = 'easy-editor:storage:legacy-snapshot-lock:v1:'
const legacyIdentityLockName = 'easy-editor:storage:legacy-identity-lock:v1'
const localTails = new Map()

const localLockManager = Object.freeze({
  request(name, _options, operation) {
    const previous = localTails.get(name) ?? Promise.resolve()
    const task = previous.then(() => operation({ name, mode: 'exclusive' }))
    const settled = task.then(
      () => undefined,
      () => undefined,
    )
    localTails.set(name, settled)
    settled.then(() => {
      if (localTails.get(name) === settled) localTails.delete(name)
    })
    return task
  },
})

const requireAuthority = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
      `${label}-must-be-a-non-empty-string`,
    )
  }
  return value
}

const lockName = scope =>
  `${legacySnapshotLockPrefix}${encodeURIComponent(requireAuthority(scope.projectId, 'snapshot-lock.projectId'))}:${encodeURIComponent(requireAuthority(scope.branchId, 'snapshot-lock.branchId'))}`

const requestExclusiveLock = ({ name, lockManager }, operation) => {
  if (typeof operation !== 'function') {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
      'snapshot-lock-operation-must-be-a-function',
    )
  }
  const resolvedLockManager =
    lockManager ?? (typeof globalThis.window === 'undefined' ? localLockManager : globalThis.navigator?.locks)
  if (!resolvedLockManager || typeof resolvedLockManager.request !== 'function') {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.storageUnavailable,
      'cross-runtime-legacy-snapshot-lock-is-unavailable',
    )
  }
  return resolvedLockManager.request(name, { mode: 'exclusive' }, async lock => operation(lock))
}

export const requestLegacyIdentityLock = ({ lockManager }, operation) =>
  requestExclusiveLock({ name: legacyIdentityLockName, lockManager }, operation)

export const requestLegacySnapshotLock = ({ scope, lockManager }, operation) =>
  requestExclusiveLock({ name: lockName(scope), lockManager }, operation)
