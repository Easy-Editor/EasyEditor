export type DashboardStorageErrorCode =
  | 'generation-conflict'
  | 'validation-failed'
  | 'read-only-compatibility'
  | 'storage-unavailable'
  | 'database-blocked'
  | 'quota-exceeded'
  | 'transaction-aborted'
  | 'integrity-mismatch'
  | 'migration-failed'
  | 'disposed'

export declare const DASHBOARD_STORAGE_ERROR_CODE: Readonly<{
  generationConflict: 'generation-conflict'
  validationFailed: 'validation-failed'
  readOnlyCompatibility: 'read-only-compatibility'
  storageUnavailable: 'storage-unavailable'
  databaseBlocked: 'database-blocked'
  quotaExceeded: 'quota-exceeded'
  transactionAborted: 'transaction-aborted'
  integrityMismatch: 'integrity-mismatch'
  migrationFailed: 'migration-failed'
  disposed: 'disposed'
}>

export declare class DashboardStorageError extends Error {
  readonly code: DashboardStorageErrorCode
  readonly reason: string
  readonly details: Readonly<Record<string, string | number | boolean | null>>
  constructor(
    code: DashboardStorageErrorCode,
    reason: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
    options?: ErrorOptions,
  )
  toJSON(): Readonly<{
    schemaVersion: 1
    code: DashboardStorageErrorCode
    reason: string
    details: Readonly<Record<string, string | number | boolean | null>>
  }>
}

export declare const isDashboardStorageError: (value: unknown) => value is DashboardStorageError
