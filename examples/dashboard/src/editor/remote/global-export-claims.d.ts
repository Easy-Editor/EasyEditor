import type { RemoteAccessRequest } from '@easy-editor/core'
import type { DashboardRemoteServices } from './runtime-services'

export declare class GlobalExportClaims {
  constructor(services: DashboardRemoteServices)
  prepare(globalName: string, identity: string, request: RemoteAccessRequest): void
  read<T>(globalName: string): T | undefined
  clearClaims(): void
}
