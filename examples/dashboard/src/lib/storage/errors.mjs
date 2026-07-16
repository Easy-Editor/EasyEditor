export const DASHBOARD_STORAGE_ERROR_CODE = Object.freeze({
  generationConflict: 'generation-conflict',
  validationFailed: 'validation-failed',
  readOnlyCompatibility: 'read-only-compatibility',
  storageUnavailable: 'storage-unavailable',
  databaseBlocked: 'database-blocked',
  quotaExceeded: 'quota-exceeded',
  transactionAborted: 'transaction-aborted',
  integrityMismatch: 'integrity-mismatch',
  migrationFailed: 'migration-failed',
  disposed: 'disposed',
})

export class DashboardStorageError extends Error {
  constructor(code, reason, details = {}, options = {}) {
    super(`Dashboard storage failed: ${reason}`, options)
    this.name = 'DashboardStorageError'
    this.code = code
    this.reason = reason
    this.details = Object.freeze({ ...details })
  }

  toJSON() {
    return {
      schemaVersion: 1,
      code: this.code,
      reason: this.reason,
      details: this.details,
    }
  }
}

export const isDashboardStorageError = value => value instanceof DashboardStorageError
