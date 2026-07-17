import type { IncomingMessage, ServerResponse } from 'node:http'

export const DATA_PROXY_ROUTE: '/api/data/credentialed-json'
export const DATA_PROXY_ENABLED_ENV: 'EASY_EDITOR_DATA_PROXY_ENABLED'

export interface DataProxyPrincipal {
  tenantId: string
  userId: string
  projectIds: string[]
}

export interface DataProxyHandlerOptions {
  env?: NodeJS.ProcessEnv
  lookup?: (...args: unknown[]) => unknown
  transport?: (...args: unknown[]) => unknown
  logger?: {
    info(value: unknown): void
    warn(value: unknown): void
  }
  monotonicNow?: () => number
  now?: () => number
  totalTimeoutMs?: number
  resolveSessionPrincipal?: (input: {
    sessionId: string
    projectId: string
  }) => Promise<DataProxyPrincipal | null> | DataProxyPrincipal | null
}

export interface DataProxyMiddlewareOptions extends DataProxyHandlerOptions {
  handler?: DataProxyHandler
  inboundTimeoutMs?: number
  publicOrigins?: string[]
}

export interface DataProxyHandler {
  handle(request: unknown): Promise<{ status: number; body: unknown }>
}

export type DataProxyMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: () => void,
) => Promise<boolean>

export function isEnvironmentDataProxyEnabled(env?: NodeJS.ProcessEnv): boolean
export function createEnvironmentDataProxyHandler(options?: DataProxyHandlerOptions): DataProxyHandler
export function createEnvironmentDataProxyMiddleware(options?: DataProxyMiddlewareOptions): DataProxyMiddleware
