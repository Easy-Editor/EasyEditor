import type { IncomingMessage, ServerResponse } from 'node:http'

export const ONLINE_COMPONENT_DEPENDENCY_ROUTE: '/api/online-components/dependencies/resolve'
export const ONLINE_COMPONENT_DEPENDENCY_ENABLED_ENV: 'EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_ENABLED'
export const ONLINE_COMPONENT_DEPENDENCY_CONFIG_ENV: 'EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_CONFIG_JSON'

export interface OnlineComponentDependencyLimits {
  readonly maxMetadataBytes: number
  readonly maxBundleBytes: number
  readonly maxRedirects: number
  readonly timeoutMs: number
}

export interface OnlineComponentDependencyConfig {
  readonly registryOrigins: readonly string[]
  readonly cdnOrigins: readonly string[]
  readonly cacheDir: string
  readonly limits: OnlineComponentDependencyLimits
}

export interface OnlineComponentDependencyLookupRecord {
  address: string
  family: 4 | 6
}

export type OnlineComponentDependencyLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<OnlineComponentDependencyLookupRecord[] | OnlineComponentDependencyLookupRecord>

export interface OnlineComponentDependencyTransportRequest {
  kind: 'registry' | 'bundle'
  url: URL
  headers: Readonly<Record<string, string>>
  signal: AbortSignal
  lookup: (...args: unknown[]) => unknown
  maxBytes: number
}

export interface OnlineComponentDependencyTransportResponse {
  status: number
  headers: Readonly<Record<string, string | readonly string[] | undefined>>
  body: Uint8Array
  url: string
  remoteAddress: string
}

export type OnlineComponentDependencyTransport = (
  request: OnlineComponentDependencyTransportRequest,
) => Promise<OnlineComponentDependencyTransportResponse>

export interface OnlineComponentDependencyRequest {
  method: string
  path: string
  headers: Readonly<Record<string, string | readonly string[] | undefined>>
  expectedOrigins: readonly string[]
  body: Uint8Array | string
  signal?: AbortSignal
}

export interface OnlineComponentDependencyResult {
  status: number
  body: unknown
}

export interface OnlineComponentDependencyHandler {
  handle(request: OnlineComponentDependencyRequest): Promise<OnlineComponentDependencyResult>
}

export interface OnlineComponentDependencyCache {
  read(packageName: string, range: string): Promise<unknown | null>
  write(packageName: string, range: string, record: unknown): Promise<unknown>
}

export interface OnlineComponentDependencyHandlerOptions {
  config: OnlineComponentDependencyConfig | unknown
  lookup?: OnlineComponentDependencyLookup
  transport?: OnlineComponentDependencyTransport
  cache?: OnlineComponentDependencyCache
  totalTimeoutMs?: number
  logger?: { info(value: unknown): void; warn(value: unknown): void }
}

export interface EnvironmentOnlineComponentDependencyHandlerOptions
  extends Omit<OnlineComponentDependencyHandlerOptions, 'config'> {
  env?: NodeJS.ProcessEnv
}

export interface OnlineComponentDependencyMiddlewareOptions extends EnvironmentOnlineComponentDependencyHandlerOptions {
  handler?: OnlineComponentDependencyHandler
  inboundTimeoutMs?: number
  publicOrigins?: string[]
}

export type OnlineComponentDependencyMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: () => void,
) => Promise<boolean>

export function compileOnlineComponentDependencyConfig(value: unknown): OnlineComponentDependencyConfig
export function createOnlineComponentDependencyCache(options: { directory: string }): OnlineComponentDependencyCache
export function createOnlineComponentDependencyHandler(
  options: OnlineComponentDependencyHandlerOptions,
): OnlineComponentDependencyHandler
export function createDisabledOnlineComponentDependencyHandler(): OnlineComponentDependencyHandler
export function createNodeOnlineComponentDependencyMiddleware(options: {
  handler: OnlineComponentDependencyHandler
  inboundTimeoutMs?: number
  publicOrigins?: string[]
}): OnlineComponentDependencyMiddleware
export function isEnvironmentOnlineComponentDependencyEnabled(env?: NodeJS.ProcessEnv): boolean
export function createEnvironmentOnlineComponentDependencyHandler(
  options?: EnvironmentOnlineComponentDependencyHandlerOptions,
): OnlineComponentDependencyHandler
export function createEnvironmentOnlineComponentDependencyMiddleware(
  options?: OnlineComponentDependencyMiddlewareOptions,
): OnlineComponentDependencyMiddleware
