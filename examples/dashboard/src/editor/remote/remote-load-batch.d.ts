export interface RemotePackageConfig {
  package: string
  version?: string
  globalName: string
}

export interface RemotePackageLoadFailure extends Required<RemotePackageConfig> {
  error: Error
}

export interface RemotePackageLoadResult {
  total: number
  succeeded: number
  failed: number
  failures: RemotePackageLoadFailure[]
}

export declare const settleRemotePackageLoads: <T extends RemotePackageConfig>(
  configs: readonly T[],
  load: (config: T) => unknown | Promise<unknown>,
) => Promise<RemotePackageLoadResult>
