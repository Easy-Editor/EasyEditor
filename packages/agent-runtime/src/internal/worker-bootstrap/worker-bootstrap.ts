import type {
  AgentHost,
  AgentPersistencePort,
  AgentRuntimeSnapshot,
  AgentWorkerOptions,
  Clock,
} from '../../contracts.js'
import { createProductionIdFactory } from '../production-id-factory.js'
import { ProtocolValidationError } from '../protocol/index.js'
import { type RpcPeer, type RpcPeerStats, RpcRemoteError, createRpcPeer } from '../rpc/index.js'
import { runtimeRpcContracts } from '../runtime/contracts.js'
import { type WorkerStateMachine, WorkerStateMachineError, createWorkerStateMachine } from '../state-machine/index.js'

export interface StartedAgentWorker {
  dispose(): Promise<void>
  getRpcStats(): RpcPeerStats
}

const systemClock: Clock = { now: () => Date.now() }

export const startAgentWorkerInternal = (options: AgentWorkerOptions): StartedAgentWorker => {
  const clock = options.clock ?? systemClock
  const idFactory = options.idFactory ?? createProductionIdFactory()
  let machine: WorkerStateMachine | undefined
  let publishTail = Promise.resolve()
  let publishFailure: unknown
  // biome-ignore lint/style/useConst: callbacks capture the peer before transport construction completes.
  let peer: RpcPeer<typeof runtimeRpcContracts>

  const activeContext = (stepId: string) => {
    const snapshot = machine?.getSnapshot()
    return {
      sessionId: snapshot?.binding.sessionId ?? 'uninitialized',
      taskId: snapshot?.activeTask?.taskId ?? 'runtime',
      stepId,
    }
  }

  const publish = (snapshot: AgentRuntimeSnapshot) => {
    publishTail = publishTail
      .then(() =>
        peer.request('runtime.publishSnapshot', snapshot, {
          sessionId: snapshot.binding.sessionId,
          taskId: snapshot.activeTask?.taskId ?? 'runtime',
          stepId: `snapshot-${snapshot.revision}`,
        }),
      )
      .then(() => undefined)
      .catch(error => {
        publishFailure = error
      })
  }

  const flushPublishes = async () => {
    await publishTail
    if (publishFailure) throw publishFailure
  }

  const requireMachine = () => {
    if (!machine) throw new Error('agent worker is not initialized')
    return machine
  }

  const exposeRecoveryLock = async <Value>(operation: () => Promise<Value>) => {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof WorkerStateMachineError && error.code === 'applied-undurable-recovery-locked') {
        throw new RpcRemoteError(error.code, error.message)
      }
      throw error
    }
  }

  const host: AgentHost = {
    observe: request =>
      peer.request('host.observe', request, {
        sessionId: request.sessionId,
        taskId: request.taskId,
        stepId: 'observe',
      }),
    describeCapability: request => peer.request('host.describeCapability', request, activeContext('describe')),
    invoke: (call, context) =>
      peer.request(
        'host.invoke',
        { schemaVersion: 1, call, context },
        {
          sessionId: call.sessionId,
          taskId: call.taskId,
          stepId: call.stepId,
        },
      ),
    queryReceipt: request => peer.request('host.queryReceipt', request, activeContext(`receipt-${request.callId}`)),
  }

  const persistence: AgentPersistencePort = {
    read: request =>
      peer.request('persistence.read', request, {
        sessionId: request.sessionId,
        taskId: activeContext('read').taskId,
        stepId: 'persistence-read',
      }),
    commit: batch =>
      peer.request('persistence.commit', batch, {
        sessionId: batch.sessionId,
        taskId: activeContext('commit').taskId,
        stepId: batch.batchId,
      }),
  }

  peer = createRpcPeer({
    port: options.port,
    contracts: runtimeRpcContracts,
    clock,
    idFactory,
    closePortOnDispose: true,
    handlers: {
      async 'runtime.initialize'(request) {
        if (machine) throw new Error('agent worker is already initialized')
        machine = createWorkerStateMachine({
          binding: request.binding,
          model: options.model,
          host,
          persistence,
          clock,
          idFactory,
          sessionContextBudget: options.sessionContextBudget,
          telemetrySink: options.telemetry,
          onSnapshot: publish,
        })
        if (request.recover) {
          await machine.recover()
          await machine.waitForIdle()
        }
        publish(machine.getSnapshot())
        await flushPublishes()
        return machine.getSnapshot()
      },
      'runtime.submit': input => exposeRecoveryLock(() => requireMachine().submit(input)),
      async 'runtime.compensate'({ targetTaskId }, context) {
        const activeMachine = requireMachine()
        const runtimeBinding = activeMachine.getSnapshot().binding
        if (
          context.sessionId !== runtimeBinding.sessionId ||
          context.taskId !== targetTaskId ||
          context.stepId !== 'compensate'
        ) {
          throw new ProtocolValidationError(
            'invalid-field',
            'runtime.compensate RPC context does not match the bound runtime and target task',
          )
        }
        await exposeRecoveryLock(() => activeMachine.compensate(targetTaskId))
        await flushPublishes()
        return null
      },
      async 'runtime.pause'({ taskId }) {
        await requireMachine().pause(taskId)
        await flushPublishes()
        return null
      },
      async 'runtime.resume'({ taskId }) {
        await exposeRecoveryLock(() => requireMachine().resume(taskId))
        return null
      },
      async 'runtime.cancel'({ taskId }) {
        await exposeRecoveryLock(() => requireMachine().cancel(taskId))
        await flushPublishes()
        return null
      },
      async 'runtime.respond'({ taskId, response }) {
        await exposeRecoveryLock(() => requireMachine().respond(taskId, response))
        return null
      },
      async 'runtime.waitForIdle'() {
        await requireMachine().waitForIdle()
        await flushPublishes()
        return null
      },
      async 'runtime.dispose'() {
        await requireMachine().dispose()
        await flushPublishes()
        return null
      },
      'runtime.diagnostics': () => ({ ...peer.getStats() }),
    },
  })

  return {
    async dispose() {
      await machine?.dispose()
      await peer.dispose('worker disposed')
    },
    getRpcStats: () => peer.getStats(),
  }
}

export const startAgentWorker = async (options: AgentWorkerOptions): Promise<void> => {
  startAgentWorkerInternal(options)
}
