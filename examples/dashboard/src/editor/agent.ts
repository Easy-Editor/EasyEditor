import type { AgentExtraValuePolicies, AgentPortSession } from '@easy-editor/core'
import { AgentRequestBoundaryError, prepareAgentWorkerMessages } from '../components/ai-chat/agent-request-boundary.mjs'
import { engine } from './runtime'

const DASHBOARD_AGENT_COMPONENT_NAMES = [
  'AreaChart',
  'BarChart',
  'Group',
  'Image',
  'LineChart',
  'PieChart',
  'RadarChart',
  'RadialChart',
  'Text',
] as const

const DASHBOARD_AGENT_COMPONENT_PROPS = Object.freeze({
  AreaChart: Object.freeze({}),
  BarChart: Object.freeze({}),
  Group: Object.freeze({}),
  Image: Object.freeze({}),
  LineChart: Object.freeze({}),
  PieChart: Object.freeze({}),
  RadarChart: Object.freeze({}),
  RadialChart: Object.freeze({}),
  Text: Object.freeze({
    text: Object.freeze({ maxBytes: 8 * 1024, type: 'string' as const }),
  }),
}) satisfies Readonly<
  Record<
    (typeof DASHBOARD_AGENT_COMPONENT_NAMES)[number],
    Readonly<Record<string, Readonly<{ maxBytes: number; type: 'string' }>>>
  >
>

const DASHBOARD_AGENT_EXTRA_VALUES = Object.freeze({
  $dashboard: Object.freeze({
    requiredOnInsert: true,
    policy: Object.freeze({
      type: 'object' as const,
      properties: Object.freeze({
        rect: Object.freeze({
          type: 'object' as const,
          properties: Object.freeze({
            x: Object.freeze({ type: 'number' as const, minimum: -100_000, maximum: 100_000 }),
            y: Object.freeze({ type: 'number' as const, minimum: -100_000, maximum: 100_000 }),
            width: Object.freeze({
              type: 'number' as const,
              minimum: 0,
              maximum: 16_384,
              exclusiveMinimum: true,
            }),
            height: Object.freeze({
              type: 'number' as const,
              minimum: 0,
              maximum: 16_384,
              exclusiveMinimum: true,
            }),
          }),
          required: Object.freeze(['x', 'y', 'width', 'height']),
          additionalProperties: false as const,
        }),
      }),
      required: Object.freeze(['rect']),
      additionalProperties: false as const,
    }),
  }),
}) satisfies AgentExtraValuePolicies

const AGENT_REQUEST_TIMEOUT_MS = 75_000

export interface DashboardAgentMessageInput {
  readonly content: string
  readonly role: 'user' | 'assistant'
}

export interface DashboardAgentResult {
  readonly message: {
    readonly content: string
    readonly role: 'assistant'
  }
  readonly execution: {
    readonly commandCount: number
    readonly observerErrorCount: number
    readonly status: 'committed' | 'committed_with_observer_errors'
  }
}

export interface DashboardAgentRequestOptions {
  readonly signal?: AbortSignal
}

interface AgentWorkerFailure {
  readonly kind: 'failure'
  readonly requestId: string
  readonly error: {
    readonly code: string
    readonly message: string
    readonly outcome?: 'unknown'
  }
}

interface AgentWorkerResult extends DashboardAgentResult {
  readonly kind: 'result'
  readonly requestId: string
}

export class DashboardAgentError extends Error {
  readonly name = 'DashboardAgentError'

  constructor(
    readonly code: string,
    message: string,
    readonly outcome?: 'unknown',
  ) {
    super(message)
  }
}

const toTransportFailure = (error: DashboardAgentError, dispatched: boolean): DashboardAgentError => {
  if (!dispatched || error.outcome === 'unknown') return error
  return new DashboardAgentError(
    error.code,
    `${error.message} 提交结果可能未知且不会自动重试，请重新读取画布确认。`,
    'unknown',
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key)) && keys.every(key => Object.hasOwn(value, key))
}

const parseWorkerResponse = (value: unknown, requestId: string): AgentWorkerFailure | AgentWorkerResult => {
  if (!isRecord(value) || value.requestId !== requestId || typeof value.kind !== 'string') {
    throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。')
  }

  if (value.kind === 'failure') {
    if (!hasExactKeys(value, ['kind', 'requestId', 'error']) || !isRecord(value.error)) {
      throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。')
    }
    const errorKeys = value.error.outcome === undefined ? ['code', 'message'] : ['code', 'message', 'outcome']
    if (
      !hasExactKeys(value.error, errorKeys) ||
      typeof value.error.code !== 'string' ||
      typeof value.error.message !== 'string' ||
      (value.error.outcome !== undefined && value.error.outcome !== 'unknown')
    ) {
      throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。')
    }
    return value as unknown as AgentWorkerFailure
  }

  if (
    value.kind !== 'result' ||
    !hasExactKeys(value, ['kind', 'requestId', 'message', 'execution']) ||
    !isRecord(value.message) ||
    !isRecord(value.execution) ||
    !hasExactKeys(value.message, ['content', 'role']) ||
    !hasExactKeys(value.execution, ['commandCount', 'observerErrorCount', 'status']) ||
    value.message.role !== 'assistant' ||
    typeof value.message.content !== 'string' ||
    !Number.isSafeInteger(value.execution.commandCount) ||
    (value.execution.commandCount as number) < 1 ||
    !Number.isSafeInteger(value.execution.observerErrorCount) ||
    (value.execution.observerErrorCount as number) < 0 ||
    !['committed', 'committed_with_observer_errors'].includes(value.execution.status as string)
  ) {
    throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。')
  }

  return value as unknown as AgentWorkerResult
}

const createRequestId = (): string => {
  if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
    throw new DashboardAgentError('dashboard.agent.secureRandomUnavailable', '当前环境无法创建安全的 Agent 请求。')
  }
  return globalThis.crypto.randomUUID()
}

/**
 * Creates one request-scoped Worker capability. The UI receives only a safe
 * result DTO; raw snapshots, node IDs, aliases, plans, and the Engine stay on
 * the host/Worker capability boundary.
 */
export const runDashboardAgentRequest = async (
  messages: readonly DashboardAgentMessageInput[],
  options: DashboardAgentRequestOptions = {},
): Promise<DashboardAgentResult> => {
  let workerMessages: ReturnType<typeof prepareAgentWorkerMessages>
  try {
    workerMessages = prepareAgentWorkerMessages(messages)
  } catch (error) {
    if (error instanceof AgentRequestBoundaryError) {
      throw new DashboardAgentError(error.code, error.message)
    }
    throw error
  }
  const currentDocument = engine.project.currentDocument
  if (!currentDocument) throw new DashboardAgentError('dashboard.agent.noDocument', '当前没有可编辑的文档。')
  if (options.signal?.aborted) throw new DashboardAgentError('dashboard.agent.aborted', 'Agent 请求已取消。')

  const requestId = createRequestId()
  const documentId = currentDocument.id
  const worker = new Worker(new URL('./agent.worker.ts', import.meta.url), {
    name: `easy-editor-agent-${requestId}`,
    type: 'module',
  })
  const channel = new MessageChannel()
  const controller = new AbortController()
  let session: AgentPortSession | undefined
  const abortFromCaller = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    session = engine.agentCapabilities.issuePort(
      {
        commandTypes: ['insertNode', 'updateProps', 'removeNode', 'moveNode'],
        componentNames: DASHBOARD_AGENT_COMPONENT_NAMES,
        componentProps: DASHBOARD_AGENT_COMPONENT_PROPS,
        documentIds: [documentId],
        extraKeys: ['$dashboard'],
        extraValues: DASHBOARD_AGENT_EXTRA_VALUES,
        limits: {
          maxCommands: 24,
          maxInsertedNodes: 120,
          maxPayloadBytes: 128 * 1024,
          maxSnapshotBytes: 1024 * 1024,
          maxTreeDepth: 48,
        },
        subjectId: `dashboard-ai-worker:${requestId}`,
      },
      channel.port1,
      { signal: controller.signal },
    )

    const response = await new Promise<AgentWorkerFailure | AgentWorkerResult>((resolve, reject) => {
      let dispatched = false
      let settled = false
      const settle = (operation: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        controller.signal.removeEventListener('abort', handleAbort)
        operation()
      }
      const handleAbort = () =>
        settle(() =>
          reject(
            toTransportFailure(new DashboardAgentError('dashboard.agent.aborted', 'Agent 请求已取消。'), dispatched),
          ),
        )
      const timeout = setTimeout(
        () =>
          settle(() =>
            reject(
              toTransportFailure(new DashboardAgentError('dashboard.agent.timeout', 'Agent 请求超时。'), dispatched),
            ),
          ),
        AGENT_REQUEST_TIMEOUT_MS,
      )

      controller.signal.addEventListener('abort', handleAbort, { once: true })
      worker.addEventListener('message', event => {
        settle(() => {
          try {
            resolve(parseWorkerResponse(event.data, requestId))
          } catch (error) {
            reject(
              toTransportFailure(
                error instanceof DashboardAgentError
                  ? error
                  : new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。'),
                dispatched,
              ),
            )
          }
        })
      })
      worker.addEventListener('error', () => {
        settle(() =>
          reject(
            toTransportFailure(
              new DashboardAgentError('dashboard.agent.workerFailed', 'Agent Worker 执行失败。'),
              dispatched,
            ),
          ),
        )
      })
      worker.addEventListener('messageerror', () => {
        settle(() =>
          reject(
            toTransportFailure(
              new DashboardAgentError('dashboard.agent.workerProtocol', 'Agent Worker 通信失败。'),
              dispatched,
            ),
          ),
        )
      })

      if (controller.signal.aborted) {
        handleAbort()
        return
      }
      try {
        worker.postMessage(
          {
            kind: 'run',
            requestId,
            documentId,
            messages: workerMessages,
            port: channel.port2,
          },
          [channel.port2],
        )
        dispatched = true
      } catch {
        settle(() => reject(new DashboardAgentError('dashboard.agent.workerProtocol', 'Agent Worker 请求无法发送。')))
      }
    })

    if (response.kind === 'failure') {
      throw new DashboardAgentError(response.error.code, response.error.message, response.error.outcome)
    }
    return Object.freeze({
      execution: Object.freeze({ ...response.execution }),
      message: Object.freeze({ ...response.message }),
    })
  } finally {
    options.signal?.removeEventListener('abort', abortFromCaller)
    controller.abort()
    session?.close()
    worker.terminate()
  }
}
