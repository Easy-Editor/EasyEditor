import type { AgentExtraValuePolicies, AgentPortSession } from '@easy-editor/core'
import { AgentCapabilityError } from '@easy-editor/core/instance'
import { type DashboardAgentPlanSummary, createAgentPlanSummary } from '../components/ai-chat/agent-plan-summary.mjs'
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
const AGENT_CONFIRMATION_TIMEOUT_MS = 2 * 60_000

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

export interface DashboardAgentProposal {
  readonly proposalId: string
  readonly expiresAt: number
  readonly message: {
    readonly content: string
    readonly role: 'assistant'
  }
  readonly summary: DashboardAgentPlanSummary
}

export interface DashboardAgentRequestOptions {
  readonly signal?: AbortSignal
  readonly confirmProposal: (
    proposal: DashboardAgentProposal,
    options: { readonly signal: AbortSignal },
  ) => Promise<boolean>
}

interface AgentWorkerFailure {
  readonly kind: 'failure'
  readonly requestId: string
  readonly error: {
    readonly code: string
    readonly message: string
  }
}

interface AgentWorkerProposal {
  readonly kind: 'proposal'
  readonly requestId: string
  readonly message: DashboardAgentProposal['message']
  readonly planId: string
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key)) && keys.every(key => Object.hasOwn(value, key))
}

const parseWorkerResponse = (value: unknown, requestId: string): AgentWorkerFailure | AgentWorkerProposal => {
  if (!isRecord(value) || value.requestId !== requestId || typeof value.kind !== 'string') {
    throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。')
  }

  if (value.kind === 'failure') {
    if (!hasExactKeys(value, ['kind', 'requestId', 'error']) || !isRecord(value.error)) {
      throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。')
    }
    if (
      !hasExactKeys(value.error, ['code', 'message']) ||
      typeof value.error.code !== 'string' ||
      typeof value.error.message !== 'string'
    ) {
      throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。')
    }
    return value as unknown as AgentWorkerFailure
  }

  if (
    value.kind !== 'proposal' ||
    !hasExactKeys(value, ['kind', 'requestId', 'message', 'planId']) ||
    !isRecord(value.message) ||
    !hasExactKeys(value.message, ['content', 'role']) ||
    value.message.role !== 'assistant' ||
    typeof value.message.content !== 'string' ||
    new TextEncoder().encode(value.message.content).byteLength > 32 * 1024 ||
    typeof value.planId !== 'string' ||
    value.planId.length < 1 ||
    value.planId.length > 256
  ) {
    throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。')
  }

  return {
    kind: 'proposal',
    message: Object.freeze({ content: value.message.content, role: 'assistant' }),
    planId: value.planId,
    requestId,
  }
}

const awaitProposalConfirmation = async (
  confirmProposal: DashboardAgentRequestOptions['confirmProposal'],
  proposal: DashboardAgentProposal,
  signal: AbortSignal,
): Promise<boolean> =>
  new Promise<boolean>((resolve, reject) => {
    let settled = false
    const settle = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', handleAbort)
      operation()
    }
    const handleAbort = () =>
      settle(() => reject(new DashboardAgentError('dashboard.agent.aborted', 'Agent 请求已取消。')))
    const timeout = setTimeout(
      () =>
        settle(() =>
          reject(new DashboardAgentError('dashboard.agent.confirmationExpired', 'Agent 提案已过期，请重新生成。')),
        ),
      Math.max(0, proposal.expiresAt - Date.now()),
    )

    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) {
      handleAbort()
      return
    }
    let confirmation: Promise<boolean>
    try {
      confirmation = Promise.resolve(confirmProposal(proposal, { signal }))
    } catch (error) {
      settle(() => reject(error))
      return
    }
    confirmation.then(
      decision =>
        settle(() => {
          if (typeof decision !== 'boolean') {
            reject(
              new DashboardAgentError('dashboard.agent.invalidConfirmation', 'Agent 提案确认回调必须返回明确决定。'),
            )
            return
          }
          resolve(decision)
        }),
      error => settle(() => reject(error)),
    )
  })

const toExecutionFailure = (error: unknown): DashboardAgentError => {
  if (error instanceof DashboardAgentError) return error
  if (error instanceof AgentCapabilityError) {
    if (error.committed || error.rollbackComplete === false) {
      return new DashboardAgentError(
        error.code,
        'Agent 提交结果无法确定且不会自动重试，请重新读取画布确认。',
        'unknown',
      )
    }
    if (error.code === 'agent.plan.stale') {
      return new DashboardAgentError(error.code, '画布已发生变化，提案未执行；请重新生成。')
    }
    return new DashboardAgentError(error.code, 'Agent 提案未执行：引擎安全边界拒绝了本次提交。')
  }
  return new DashboardAgentError('dashboard.agent.executeFailed', 'Agent 提案执行失败。')
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
  options: DashboardAgentRequestOptions,
): Promise<DashboardAgentResult> => {
  if (!options || typeof options.confirmProposal !== 'function') {
    throw new DashboardAgentError('dashboard.agent.confirmationRequired', 'Agent 请求必须提供显式的提案确认回调。')
  }
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
      { executionAuthority: 'host', signal: controller.signal },
    )

    const response = await new Promise<AgentWorkerFailure | AgentWorkerProposal>((resolve, reject) => {
      let settled = false
      const settle = (operation: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        controller.signal.removeEventListener('abort', handleAbort)
        worker.removeEventListener('message', handleMessage)
        worker.removeEventListener('error', handleWorkerError)
        worker.removeEventListener('messageerror', handleMessageError)
        operation()
      }
      const handleAbort = () =>
        settle(() => reject(new DashboardAgentError('dashboard.agent.aborted', 'Agent 请求已取消。')))
      const timeout = setTimeout(
        () => settle(() => reject(new DashboardAgentError('dashboard.agent.timeout', 'Agent 请求超时。'))),
        AGENT_REQUEST_TIMEOUT_MS,
      )
      const handleMessage = (event: MessageEvent<unknown>) => {
        settle(() => {
          try {
            resolve(parseWorkerResponse(event.data, requestId))
          } catch (error) {
            reject(
              error instanceof DashboardAgentError
                ? error
                : new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了无效响应。'),
            )
          }
        })
      }
      const handleWorkerError = () =>
        settle(() => reject(new DashboardAgentError('dashboard.agent.workerFailed', 'Agent Worker 提案生成失败。')))
      const handleMessageError = () =>
        settle(() => reject(new DashboardAgentError('dashboard.agent.workerProtocol', 'Agent Worker 通信失败。')))

      controller.signal.addEventListener('abort', handleAbort, { once: true })
      worker.addEventListener('message', handleMessage)
      worker.addEventListener('error', handleWorkerError)
      worker.addEventListener('messageerror', handleMessageError)

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
      } catch {
        settle(() => reject(new DashboardAgentError('dashboard.agent.workerProtocol', 'Agent Worker 请求无法发送。')))
      }
    })

    if (response.kind === 'failure') {
      throw new DashboardAgentError(response.error.code, response.error.message)
    }

    let preview: ReturnType<AgentPortSession['getPreparedPlanPreview']>
    try {
      preview = session.getPreparedPlanPreview(response.planId)
    } catch (error) {
      if (error instanceof AgentCapabilityError) {
        throw new DashboardAgentError(error.code, 'Agent 提案已不可用，画布未发生变化。')
      }
      throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 返回了未知提案。')
    }
    if (preview.documentId !== documentId || preview.planId !== response.planId) {
      throw new DashboardAgentError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 提案不属于当前请求。')
    }
    const proposal = Object.freeze({
      expiresAt: Date.now() + AGENT_CONFIRMATION_TIMEOUT_MS,
      message: response.message,
      proposalId: requestId,
      summary: createAgentPlanSummary(preview),
    }) satisfies DashboardAgentProposal
    const confirmed = await awaitProposalConfirmation(options.confirmProposal, proposal, controller.signal)
    if (!confirmed) {
      throw new DashboardAgentError('dashboard.agent.rejected', '已取消执行，画布未发生变化。')
    }
    if (controller.signal.aborted) {
      throw new DashboardAgentError('dashboard.agent.aborted', 'Agent 请求已取消。')
    }
    if (Date.now() >= proposal.expiresAt) {
      throw new DashboardAgentError('dashboard.agent.confirmationExpired', 'Agent 提案已过期，请重新生成。')
    }

    let receipt: ReturnType<AgentPortSession['approveAndExecute']>
    try {
      receipt = session.approveAndExecute(preview.planId)
    } catch (error) {
      throw toExecutionFailure(error)
    }
    return Object.freeze({
      execution: Object.freeze({
        commandCount: receipt.commandCount,
        observerErrorCount: receipt.observerErrorCount,
        status: receipt.status,
      }),
      message: Object.freeze({ ...response.message }),
    })
  } finally {
    options.signal?.removeEventListener('abort', abortFromCaller)
    controller.abort()
    try {
      session?.close()
    } finally {
      worker.terminate()
    }
  }
}
