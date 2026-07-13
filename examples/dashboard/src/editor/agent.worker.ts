import {
  AgentCapabilityError,
  type AgentMessagePort,
  type AgentPortCapability,
  connectAgentPort,
} from '@easy-editor/core/agent-channel'
import { filterMessageContent, parseAiCommands } from '../components/ai-chat/commands.mjs'
import { createCanvasProjection, createChatRequest, resolveCommandAliases } from '../components/ai-chat/privacy.mjs'
import { readResponseTextWithinBudget } from '../components/ai-chat/response-body-boundary.mjs'

const MAX_GATEWAY_RESPONSE_BYTES = 48 * 1024
const MAX_ASSISTANT_CONTENT_BYTES = 32 * 1024

interface WorkerChatMessage {
  readonly content: string
  readonly role: 'user' | 'assistant'
}

interface AgentWorkerRunRequest {
  readonly kind: 'run'
  readonly requestId: string
  readonly documentId: string
  readonly messages: readonly WorkerChatMessage[]
  readonly port: MessagePort
}

interface GatewayChatResponse {
  readonly id?: string
  readonly message: {
    readonly role: 'assistant'
    readonly content: string
  }
}

const workerScope = self as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
    options?: { once?: boolean },
  ): void
  postMessage(value: unknown): void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const assertExactKeys = (value: Record<string, unknown>, keys: readonly string[], message: string): void => {
  const allowed = new Set(keys)
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error(message)
}

const assertRunRequest = (value: unknown): AgentWorkerRunRequest => {
  if (!isRecord(value)) throw new Error('Invalid Agent Worker request')
  assertExactKeys(value, ['kind', 'requestId', 'documentId', 'messages', 'port'], 'Invalid Agent Worker request')
  if (
    value.kind !== 'run' ||
    typeof value.requestId !== 'string' ||
    value.requestId.length < 1 ||
    value.requestId.length > 128 ||
    typeof value.documentId !== 'string' ||
    value.documentId.length < 1 ||
    value.documentId.length > 256 ||
    !Array.isArray(value.messages) ||
    !value.port ||
    typeof (value.port as AgentMessagePort).postMessage !== 'function' ||
    typeof (value.port as AgentMessagePort).close !== 'function'
  ) {
    throw new Error('Invalid Agent Worker request')
  }
  return value as unknown as AgentWorkerRunRequest
}

const readGatewayResponse = async (response: Response): Promise<GatewayChatResponse> => {
  const text = await readResponseTextWithinBudget(response, MAX_GATEWAY_RESPONSE_BYTES)
  if (!response.ok) throw new Error('AI gateway request failed')

  const value = JSON.parse(text) as unknown
  if (!isRecord(value)) throw new Error('AI gateway response is invalid')
  assertExactKeys(value, value.id === undefined ? ['message'] : ['id', 'message'], 'AI gateway response is invalid')
  if (!isRecord(value.message)) throw new Error('AI gateway response is invalid')
  assertExactKeys(value.message, ['role', 'content'], 'AI gateway response is invalid')
  if (
    (value.id !== undefined && (typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 128)) ||
    value.message.role !== 'assistant' ||
    typeof value.message.content !== 'string' ||
    new TextEncoder().encode(value.message.content).byteLength > MAX_ASSISTANT_CONTENT_BYTES
  ) {
    throw new Error('AI gateway response is invalid')
  }

  return value as unknown as GatewayChatResponse
}

const toSafeFailure = (error: unknown): { code: string; message: string } => {
  if (error instanceof AgentCapabilityError) {
    return {
      code: error.code,
      message: 'Agent 提案被引擎安全边界拒绝。',
    }
  }
  return { code: 'dashboard.agent.failed', message: 'AI 请求或提案生成失败。' }
}

// One Worker serves one request. Retaining the client keeps its MessagePort and
// host-owned prepared plan alive until the host terminates the Worker.
let retainedCapability: AgentPortCapability | undefined

const executeRequest = async (request: AgentWorkerRunRequest): Promise<void> => {
  let proposed = false
  let capability: AgentPortCapability | undefined
  try {
    capability = await connectAgentPort(request.port, {
      connectTimeoutMs: 10_000,
      requestTimeoutMs: 30_000,
    })
    retainedCapability = capability
    const snapshot = await capability.snapshot(request.documentId)
    const projection = createCanvasProjection(snapshot.schema)
    const gatewayRequest = createChatRequest(request.messages, projection.canvas)
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gatewayRequest),
    })
    const gatewayResponse = await readGatewayResponse(response)
    const commands = resolveCommandAliases(parseAiCommands(gatewayResponse.message.content), projection.nodeIdsByAlias)
    const preview = await capability.preview({
      baseRevision: snapshot.revision,
      commands,
      documentId: snapshot.documentId,
    })

    workerScope.postMessage({
      kind: 'proposal',
      requestId: request.requestId,
      message: {
        content:
          filterMessageContent(gatewayResponse.message.content, projection.nodeIdsByAlias.keys()) ||
          '已生成画布修改提案，请确认后执行。',
        role: 'assistant',
      },
      planId: preview.planId,
    })
    proposed = true
  } catch (error) {
    try {
      workerScope.postMessage({
        kind: 'failure',
        requestId: request.requestId,
        error: toSafeFailure(error),
      })
    } catch {
      // The Worker never owns execution authority, so a lost proposal cannot mutate the document.
    }
  } finally {
    if (!proposed) {
      try {
        capability?.close()
      } catch {
        // Worker termination closes the host-side session even if local close fails.
      } finally {
        if (retainedCapability === capability) retainedCapability = undefined
      }
    }
  }
}

workerScope.addEventListener(
  'message',
  event => {
    try {
      void executeRequest(assertRunRequest(event.data))
    } catch (error) {
      workerScope.postMessage({
        kind: 'failure',
        requestId: isRecord(event.data) && typeof event.data.requestId === 'string' ? event.data.requestId : 'invalid',
        error: toSafeFailure(error),
      })
    }
  },
  { once: true },
)
