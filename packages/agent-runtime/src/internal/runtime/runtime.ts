import type {
  AgentRuntime,
  AgentRuntimeOptions,
  AgentRuntimeSnapshot,
  AgentWorkerEndpoint,
  Clock,
  IdFactory,
  JsonObject,
} from '../../contracts.js'
import { createProductionIdFactory } from '../production-id-factory.js'
import { ProtocolValidationError } from '../protocol/index.js'
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

const observeRejection = <Value>(promise: Promise<Value>): Promise<Value> => {
  void promise.catch(() => {
    // Lifecycle failures remain visible to API callers through the original promise.
  })
  return promise
}

export const createAgentRuntimeInternal = (options: AgentRuntimeInternalOptions): AgentRuntimeInternal => {
  const clock = options.clock ?? systemClock
  const idFactory = options.idFactory ?? createProductionIdFactory()
  const binding = frozenClone({
    ...options.binding,
    sessionId: options.binding.sessionId ?? idFactory.next('session'),
  })
  const listeners = new Set<(snapshot: AgentRuntimeSnapshot) => void>()
  const endpointFactory = typeof options.worker === 'function' ? options.worker : undefined
  type RuntimeTransport = {
    readonly generation: number
    readonly endpoint: AgentWorkerEndpoint
    readonly peer: RpcPeer<typeof runtimeRpcContracts>
    unsubscribeFault: () => void
    closed: boolean
  }
  let transport: RuntimeTransport | undefined
  let transportGeneration = 0
  let singleEndpointConsumed = false
  let disposed = false
  let disposing = false
  let disposalPromise: Promise<void> | undefined
  let current = frozenClone<AgentRuntimeSnapshot>({
    schemaVersion: 1,
    binding,
    status: 'initializing',
    phase: 'IDLE',
    revision: 0,
    tasks: [],
  })

  const assertSnapshotAuthority = (snapshot: AgentRuntimeSnapshot, envelopeSessionId = binding.sessionId) => {
    const assertMatches = (actual: string, expected: string, field: string) => {
      if (actual !== expected) {
        throw new ProtocolValidationError('invalid-field', `${field} must match the bound runtime`)
      }
    }
    assertMatches(envelopeSessionId, binding.sessionId, 'ProtocolEnvelope.sessionId')
    assertMatches(snapshot.binding.projectId, binding.projectId, 'AgentRuntimeSnapshot.binding.projectId')
    assertMatches(snapshot.binding.branchId, binding.branchId, 'AgentRuntimeSnapshot.binding.branchId')
    assertMatches(snapshot.binding.sessionId, binding.sessionId, 'AgentRuntimeSnapshot.binding.sessionId')
    snapshot.tasks.forEach((task, index) => {
      assertMatches(task.sessionId, binding.sessionId, `AgentRuntimeSnapshot.tasks[${index}].sessionId`)
    })
    if (snapshot.activeTask) {
      assertMatches(snapshot.activeTask.sessionId, binding.sessionId, 'AgentRuntimeSnapshot.activeTask.sessionId')
    }
  }

  const mirror = (snapshot: AgentRuntimeSnapshot) => {
    if (disposed && snapshot.status !== 'disposed') return
    current = frozenClone({
      ...snapshot,
      revision: Math.max(current.revision + 1, snapshot.revision),
    })
    for (const listener of [...listeners]) listener(current)
  }

  const mirrorFailure = (code: string, error: unknown, retryable: boolean) => {
    if (disposed) return
    mirror({
      ...current,
      status: 'failed',
      phase: 'FAILED',
      revision: current.revision + 1,
      failure: {
        code,
        message: error instanceof Error ? error.message : String(error),
        retryable,
      },
    })
  }

  const nextEndpoint = () => {
    if (endpointFactory) return endpointFactory()
    if (!singleEndpointConsumed && typeof options.worker !== 'function') {
      singleEndpointConsumed = true
      return options.worker
    }
    throw new Error('runtime restart requires a worker endpoint factory')
  }

  const closeTransport = async (candidate: RuntimeTransport, reason: string) => {
    if (candidate.closed) return
    candidate.closed = true
    candidate.unsubscribeFault()
    try {
      await candidate.peer.dispose(reason)
    } catch {
      // Cleanup is best-effort; the lifecycle failure remains authoritative.
    }
    try {
      candidate.endpoint.terminate()
    } catch {
      // Cleanup is best-effort; the lifecycle failure remains authoritative.
    }
  }

  const cleanupTransport = async (reason: string, expectedGeneration = transportGeneration) => {
    if (expectedGeneration !== transportGeneration) return
    transportGeneration += 1
    const active = transport
    transport = undefined
    if (active) await closeTransport(active, reason)
  }

  let initialization: Promise<void> = Promise.resolve()
  let lifecycleTail: Promise<void> = Promise.resolve()

  const enqueueLifecycle = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const result = observeRejection(lifecycleTail.then(operation))
    lifecycleTail = observeRejection(
      result.then(
        () => undefined,
        () => undefined,
      ),
    )
    return result
  }

  const handleEndpointFault = (candidate: RuntimeTransport, error: unknown) => {
    if (
      disposed ||
      disposing ||
      candidate.closed ||
      candidate.generation !== transportGeneration ||
      transport !== candidate
    ) {
      return
    }
    const cleanup = cleanupTransport(
      `worker fault: ${error instanceof Error ? error.message : String(error)}`,
      candidate.generation,
    )
    const recovery = enqueueLifecycle(async () => {
      await cleanup
      if (disposed) return
      mirror({
        ...current,
        status: 'recovering',
        phase: 'RECOVERING',
        revision: current.revision + 1,
      })
      if (!endpointFactory) {
        const unavailable = new Error('runtime crash recovery requires a worker endpoint factory')
        mirrorFailure('worker-restart-unavailable', unavailable, false)
        throw unavailable
      }
      await initializeTransport(true)
    })
    initialization = observeRejection(recovery)
  }

  const startTransport = async (recover: boolean, generation: number) => {
    const endpoint = nextEndpoint()
    let candidate: RuntimeTransport
    let peer: RpcPeer<typeof runtimeRpcContracts>
    try {
      peer = createRpcPeer({
        port: endpoint.port,
        contracts: runtimeRpcContracts,
        clock,
        idFactory,
        closePortOnDispose: true,
        handlers: {
          ...createAgentBoundaryRpcHandlers(options.host, options.persistence),
          async 'runtime.publishSnapshot'(snapshot, context) {
            if (!disposed && generation === transportGeneration && transport === candidate && !candidate.closed) {
              assertSnapshotAuthority(snapshot, context.sessionId)
              mirror(snapshot)
            }
            return null
          },
        },
      })
    } catch (error) {
      try {
        endpoint.terminate()
      } catch {
        // Preserve the transport construction failure as the authoritative error.
      }
      throw error
    }
    candidate = {
      generation,
      endpoint,
      peer,
      unsubscribeFault: () => {},
      closed: false,
    }
    transport = candidate
    const unsubscribeFault = endpoint.onFault(error => handleEndpointFault(candidate, error))
    candidate.unsubscribeFault = unsubscribeFault
    if (candidate.closed) unsubscribeFault()
    const snapshot = await candidate.peer.request(
      'runtime.initialize',
      { binding, recover },
      { sessionId: binding.sessionId, taskId: 'runtime', stepId: 'initialize' },
    )
    if (disposed || generation !== transportGeneration || transport !== candidate || candidate.closed) {
      await closeTransport(candidate, 'stale worker initialization')
      throw new Error('agent runtime transport generation was superseded')
    }
    assertSnapshotAuthority(snapshot)
    mirror(snapshot)
  }

  const initializeTransport = (recover: boolean) =>
    observeRejection(
      (async () => {
        const generation = transportGeneration + 1
        transportGeneration = generation
        try {
          await startTransport(recover, generation)
        } catch (error) {
          if (generation === transportGeneration) {
            await cleanupTransport('worker initialization failed', generation)
            mirrorFailure('worker-initialization-failed', error, true)
          }
          throw error
        }
      })(),
    )

  initialization = observeRejection(initializeTransport(true))
  lifecycleTail = observeRejection(
    initialization.then(
      () => undefined,
      () => undefined,
    ),
  )

  const requirePeer = async () => {
    if (disposed || disposing) throw new Error('agent runtime is disposed')
    await initialization
    if (!transport || transport.closed) throw new Error('agent runtime transport is unavailable')
    return transport.peer
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
      if (disposed || disposing) throw new Error('agent runtime is disposed')
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
    restart() {
      if (disposed || disposing) return observeRejection(Promise.reject(new Error('agent runtime is disposed')))
      if (!endpointFactory) {
        return observeRejection(Promise.reject(new Error('runtime restart requires a worker endpoint factory')))
      }
      const restart = enqueueLifecycle(async () => {
        if (disposed) throw new Error('agent runtime is disposed')
        mirror({ ...current, status: 'recovering', phase: 'RECOVERING', revision: current.revision + 1 })
        await cleanupTransport('worker restart')
        if (disposed) throw new Error('agent runtime is disposed')
        await initializeTransport(true)
      })
      initialization = observeRejection(restart)
      return restart
    },
    dispose() {
      if (disposed) return Promise.resolve()
      if (disposalPromise) return disposalPromise
      disposing = true
      const priorInitialization = initialization
      const disposal = enqueueLifecycle(async () => {
        let initializationError: unknown
        try {
          await priorInitialization
        } catch (error) {
          initializationError = error
        }
        if (initializationError) {
          disposed = true
          await cleanupTransport('runtime disposed')
          listeners.clear()
          if (current.status !== 'disposed') {
            current = frozenClone({
              ...current,
              status: 'disposed',
              revision: current.revision + 1,
            })
          }
          throw initializationError
        }

        await transport?.peer.request('runtime.dispose', null, context('runtime', 'dispose'))
        disposed = true
        await cleanupTransport('runtime disposed')
        listeners.clear()
        if (current.status !== 'disposed') {
          current = frozenClone({
            ...current,
            status: 'disposed',
            revision: current.revision + 1,
          })
        }
      })
      const tracked = disposal.finally(() => {
        if (!disposed && disposalPromise === tracked) disposalPromise = undefined
      })
      disposalPromise = observeRejection(tracked)
      return disposalPromise
    },
  }

  return runtime
}

export const createAgentRuntime = (options: AgentRuntimeOptions): AgentRuntime => createAgentRuntimeInternal(options)
