import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'

const legacySnapshotLockPrefix = 'easy-editor:storage:legacy-snapshot-lock:v1:'
const legacyIdentityLockName = 'easy-editor:storage:legacy-identity-lock:v1'
const projectMaterialLockPrefix = 'easy-editor:storage:project-material-lock:v1:'
const localLocks = new Map()

const finishLocalLock = (name, state, mode) => {
  if (mode === 'exclusive') state.writer = false
  else state.readers -= 1
  drainLocalLock(name, state)
}

const runLocalLock = (name, state, entry) => {
  if (entry.mode === 'exclusive') state.writer = true
  else state.readers += 1
  Promise.resolve()
    .then(() => entry.operation({ name, mode: entry.mode }))
    .then(entry.resolve, entry.reject)
    .finally(() => finishLocalLock(name, state, entry.mode))
}

const drainLocalLock = (name, state) => {
  if (state.writer) return
  const next = state.queue[0]
  if (!next) {
    if (state.readers === 0) localLocks.delete(name)
    return
  }
  if (next.mode === 'exclusive') {
    if (state.readers !== 0) return
    state.queue.shift()
    runLocalLock(name, state, next)
    return
  }
  while (state.queue[0]?.mode === 'shared' && !state.writer) {
    runLocalLock(name, state, state.queue.shift())
  }
}

const localLockManager = Object.freeze({
  request(name, options, operation) {
    const mode = options?.mode ?? 'exclusive'
    const state = localLocks.get(name) ?? { readers: 0, writer: false, queue: [] }
    localLocks.set(name, state)
    return new Promise((resolve, reject) => {
      state.queue.push({ mode, operation, resolve, reject })
      drainLocalLock(name, state)
    })
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

const requestLock = ({ name, lockManager, mode }, operation) => {
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
  return resolvedLockManager.request(name, { mode }, async lock => operation(lock))
}

export const requestLegacyIdentityLock = ({ lockManager }, operation) =>
  requestLock({ name: legacyIdentityLockName, lockManager, mode: 'exclusive' }, operation)

export const requestLegacySnapshotLock = ({ scope, lockManager }, operation) =>
  requestLock({ name: lockName(scope), lockManager, mode: 'exclusive' }, operation)

export const requestProjectMaterialLock = ({ projectId, lockManager, mode = 'shared' }, operation) => {
  if (mode !== 'shared' && mode !== 'exclusive') {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
      'project-material-lock-mode-is-invalid',
    )
  }
  const name = `${projectMaterialLockPrefix}${encodeURIComponent(
    requireAuthority(projectId, 'project-material-lock.projectId'),
  )}`
  return requestLock({ name, lockManager, mode }, operation)
}
