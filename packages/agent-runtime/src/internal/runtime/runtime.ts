import type {
  AgentRuntime,
  AgentRuntimeOptions,
  AgentRuntimeSnapshot,
  AgentWorkerEndpoint,
  Clock,
  IdFactory,
  JsonObject,
} from '../../contracts.js'
import { type RpcPeer, createAgentBoundaryRpcHandlers, createRpcPeer } from '../rpc/index.js'
import { runtimeRpcContracts } from './contracts.js'

export interface AgentRuntimeInternal extends AgentRuntime {
  ready(): Promise<void>
  waitForIdle(): Promise<void>
  restart(): Promise<void>
  diagnostics(): Promise<JsonObject>
}

export interface AgentRuntimeInternalOptions extends AgentRuntimeOptions {
  readonly clock?: Clock
  readonly idFactory?: IdFactory
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreeze(entry)
  return Object.freeze(value)
}

const frozenClone = <Value>(value: Value): Value => deepFreeze(structuredClone(value))
const systemClock: Clock = { now: () => Date.now() }

const createIdFactory = (): IdFactory => {
  let sequence = 0
  return { next: kind => `${kind}-${++sequence}` }
}

export const createAgentRuntimeInternal = (options: AgentRuntimeInternalOptions): AgentRuntimeInternal => {
  const clock = options.clock ?? systemClock
  const idFactory = options.idFactory ?? createIdFactory()
  const binding = frozenClone({
    ...options.binding,
    sessionId: options.binding.sessionId ?? idFactory.next('session'),
  })
  const listeners = new Set<(snapshot: AgentRuntimeSnapshot) => void>()
  const endpointFactory = typeof options.worker === 'function' ? options.worker : undefined
  let endpoint: AgentWorkerEndpoint | undefined
  let peer: RpcPeer<typeof runtimeRpcContracts> | undefined
  let disposed = false
  let current = frozenClone<AgentRuntimeSnapshot>({
    schemaVersion: 1,
    binding,
    status: 'initializing',
    phase: 'IDLE',
    revision: 0,
    tasks: [],
  })

  const mirror = (snapshot: AgentRuntimeSnapshot) => {
    if (disposed && snapshot.status !== 'disposed') return
    current = frozenClone(snapshot)
    for (const listener of [...listeners]) listener(current)
  }

  const nextEndpoint = () => {
    if (endpointFactory) return endpointFactory()
    if (!endpoint && typeof options.worker !== 'function') return options.worker
    throw new Error('runtime restart requires a worker endpoint factory')
  }

  const startTransport = async (recover: boolean) => {
    endpoint = nextEndpoint()
    peer = createRpcPeer({
      port: endpoint.port,
      contracts: runtimeRpcContracts,
      clock,
      idFactory,
      closePortOnDispose: true,
      handlers: {
        ...createAgentBoundaryRpcHandlers(options.host, options.persistence),
        'runtime.publishSnapshot'(snapshot) {
          mirror(snapshot)
          return null
        },
      },
    })
    const snapshot = await peer.request(
      'runtime.initialize',
      { binding, recover },
      { sessionId: binding.sessionId, taskId: 'runtime', stepId: 'initialize' },
    )
    mirror(snapshot)
  }

  let initialization = startTransport(true).catch(error => {
    mirror({
      ...current,
      status: 'failed',
      phase: 'FAILED',
      revision: current.revision + 1,
      failure: {
        code: 'worker-initialization-failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      },
    })
    throw error
  })

  const requirePeer = async () => {
    if (disposed) throw new Error('agent runtime is disposed')
    await initialization
    if (!peer) throw new Error('agent runtime transport is unavailable')
    return peer
  }

  const context = (taskId: string, stepId: string) => ({ sessionId: binding.sessionId, taskId, stepId })

  const runtime: AgentRuntimeInternal = {
    async submit(input) {
      return (await requirePeer()).request('runtime.submit', input, context('runtime', 'submit'))
    },
    async pause(taskId) {
      await (await requirePeer()).request('runtime.pause', { taskId }, context(taskId, 'pause'))
    },
    async resume(taskId) {
      await (await requirePeer()).request('runtime.resume', { taskId }, context(taskId, 'resume'))
    },
    async cancel(taskId) {
      await (await requirePeer()).request('runtime.cancel', { taskId }, context(taskId, 'cancel'))
    },
    async respond(taskId, response) {
      await (await requirePeer()).request('runtime.respond', { taskId, response }, context(taskId, 'respond'))
    },
    getSnapshot: () => current,
    subscribe(listener) {
      if (disposed) throw new Error('agent runtime is disposed')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ready: () => initialization,
    async waitForIdle() {
      await (await requirePeer()).request('runtime.waitForIdle', null, context('runtime', 'wait'))
    },
    async diagnostics() {
      return (await requirePeer()).request('runtime.diagnostics', null, context('runtime', 'diagnostics'))
    },
    async restart() {
      if (!endpointFactory) throw new Error('runtime restart requires a worker endpoint factory')
      if (disposed) throw new Error('agent runtime is disposed')
      mirror({ ...current, status: 'recovering', phase: 'RECOVERING', revision: current.revision + 1 })
      await peer?.dispose('worker restart')
      endpoint?.terminate()
      endpoint = undefined
      peer = undefined
      initialization = startTransport(true)
      await initialization
    },
    async dispose() {
      if (disposed) return
      try {
        await initialization
        await peer?.request('runtime.dispose', null, context('runtime', 'dispose'))
      } finally {
        disposed = true
        await peer?.dispose('runtime disposed')
        endpoint?.terminate()
        listeners.clear()
        if (current.status !== 'disposed') {
          current = frozenClone({
            ...current,
            status: 'disposed',
            revision: current.revision + 1,
          })
        }
      }
    },
  }

  return runtime
}

export const createAgentRuntime = (options: AgentRuntimeOptions): AgentRuntime => createAgentRuntimeInternal(options)
