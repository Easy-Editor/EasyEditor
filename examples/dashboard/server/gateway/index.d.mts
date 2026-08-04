import type { IncomingMessage, ServerResponse } from 'node:http'

export * from './vite-adapter.mjs'

export const MODEL_GATEWAY_PATH: '/api/agent/model/stream'
export const MODEL_GATEWAY_SCHEMA_VERSION: 1
export const MODEL_GATEWAY_MAX_BODY_BYTES: number
export const MODEL_GATEWAY_DEFAULT_TIMEOUT_MS: 165000
export const OPENAI_PROVIDER_DEFAULT_TIMEOUT_MS: 150000
export const AGENT_MODEL_GATEWAY_ENABLED_ENV: 'EASY_EDITOR_AGENT_GATEWAY_ENABLED'
export const AGENT_MODEL_GATEWAY_CONFIG_ENV: 'EASY_EDITOR_AGENT_GATEWAY_CONFIG_JSON'
export const AGENT_MODEL_GATEWAY_BASE_URL_ENV: 'EASY_EDITOR_AGENT_BASE_URL'
export const AGENT_MODEL_GATEWAY_API_KEY_ENV: 'EASY_EDITOR_AGENT_API_KEY'
export const AGENT_MODEL_GATEWAY_MODEL_ENV: 'EASY_EDITOR_AGENT_MODEL'
export const AGENT_MODEL_GATEWAY_PROVIDER_ID_ENV: 'EASY_EDITOR_AGENT_PROVIDER_ID'
export const AGENT_MODEL_GATEWAY_SESSION_COOKIE_NAME_ENV: 'EASY_EDITOR_AGENT_SESSION_COOKIE_NAME'
export const AGENT_MODEL_GATEWAY_SESSION_TOKEN_ENV: 'EASY_EDITOR_AGENT_SESSION_TOKEN'
export const AGENT_MODEL_GATEWAY_PROJECT_ID_ENV: 'EASY_EDITOR_AGENT_PROJECT_ID'

export interface ModelGatewayPrincipal {
  readonly tenantId: string
  readonly userId: string
}

export interface ModelGatewayRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
  readonly stepId: string
  readonly modelRequestId: string
  readonly providerId: string
  readonly model: string
  readonly phase: 'BLUEPRINT' | 'PLAN_STEP' | 'REPAIR'
  readonly messages: readonly Readonly<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>[]
  readonly maxOutputTokens?: number
}

export interface ModelGatewayTransportRequest {
  readonly method: string
  readonly path: string
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly body: Uint8Array
  readonly signal: AbortSignal
}

export interface ModelGatewayTransportResult {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: AsyncIterable<Uint8Array>
}

export interface ModelGatewayHandler {
  readonly path: typeof MODEL_GATEWAY_PATH
  handle(request: ModelGatewayTransportRequest): Promise<ModelGatewayTransportResult>
}

export interface ModelGatewayProviderTransport {
  stream(
    input: Readonly<{
      principal: ModelGatewayPrincipal
      request: ModelGatewayRequestV1
      signal: AbortSignal
    }>,
  ): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>
}

export type ModelGatewayPrincipalAuthorizer = (
  input: Readonly<{
    headers: Readonly<Record<string, string>>
    projectId: string
    signal: AbortSignal
  }>,
) => Promise<ModelGatewayPrincipal> | ModelGatewayPrincipal

export interface ModelGatewayHandlerOptions {
  authorizePrincipal: ModelGatewayPrincipalAuthorizer
  providerTransport: ModelGatewayProviderTransport
  maxConcurrent?: number
  timeoutMs?: number
  logger?: { warn(value: unknown): void }
}

export interface EnvironmentModelGatewayHandlerOptions
  extends Partial<
    Pick<
      ModelGatewayHandlerOptions,
      'authorizePrincipal' | 'providerTransport' | 'maxConcurrent' | 'timeoutMs' | 'logger'
    >
  > {
  env?: NodeJS.ProcessEnv
  handler?: ModelGatewayHandler
  fetchImpl?: typeof globalThis.fetch
  resolveSessionPrincipal?: (
    input: Readonly<{
      sessionId: string
      projectId: string
    }>,
  ) =>
    | Promise<Readonly<ModelGatewayPrincipal & { projectIds: readonly string[] }> | null>
    | Readonly<ModelGatewayPrincipal & { projectIds: readonly string[] }>
    | null
}

export interface ModelGatewayMiddlewareOptions extends EnvironmentModelGatewayHandlerOptions {
  inboundTimeoutMs?: number
  publicOrigins?: readonly string[]
}

export type ModelGatewayMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: () => void,
) => Promise<boolean>

export function createModelGatewayHandler(options: ModelGatewayHandlerOptions): ModelGatewayHandler
export function createEnvironmentModelGatewayHandler(
  options?: EnvironmentModelGatewayHandlerOptions,
): ModelGatewayHandler
export function isEnvironmentModelGatewayEnabled(env?: NodeJS.ProcessEnv): boolean
export function createNodeModelGatewayMiddleware(
  options: ModelGatewayMiddlewareOptions & { handler: ModelGatewayHandler },
): ModelGatewayMiddleware
export function createEnvironmentModelGatewayMiddleware(options?: ModelGatewayMiddlewareOptions): ModelGatewayMiddleware
export function createEnvironmentModelGatewayVitePlugin(options?: ModelGatewayMiddlewareOptions): import('vite').Plugin

export function createOpenAICompatibleProviderTransport(
  options: Readonly<{
    fetchImpl?: typeof globalThis.fetch
    baseUrl: string
    apiKey: string
    defaultModel?: string
    timeoutMs?: number
  }>,
): ModelGatewayProviderTransport
