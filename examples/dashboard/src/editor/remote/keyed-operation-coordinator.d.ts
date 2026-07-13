export declare class OperationInvalidatedError extends Error {
  constructor(key: string)
}

export interface KeyedOperation {
  readonly key: string
  readonly signal: AbortSignal
}

export declare class LatestOperationRegistry {
  begin(key: string): KeyedOperation
  isCurrent(operation: KeyedOperation): boolean
  assertCurrent(operation: KeyedOperation): void
  finish(operation: KeyedOperation): void
  invalidate(key: string): void
  invalidateAll(): void
}

export declare class SingleFlight {
  run<T>(key: string, task: () => T | Promise<T>): Promise<T>
  forget(key: string): void
  clear(): void
}
