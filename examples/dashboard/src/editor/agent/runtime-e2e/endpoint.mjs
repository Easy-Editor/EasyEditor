import { createMainThreadWorkerTelemetryDelivery } from '../../../agent-runtime/worker-telemetry-control.mjs'
import {
  AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION,
  AgentRuntimeE2EWorkerError,
  cloneAgentRuntimeE2ESteps,
  parseAgentRuntimeE2EWorkerControlMessage,
} from './protocol.mjs'

let nextWorkerGeneration = 0

const isViteE2EEnabled = () => import.meta.env?.VITE_E2E === '1'

const browserPlatform = Object.freeze({
  createMessageChannel: () => new MessageChannel(),
  createWorker: generation =>
    new Worker(new URL('./worker.mjs', import.meta.url), {
      name: `easy-editor-agent-runtime-e2e-${generation}`,
      type: 'module',
    }),
  queueMicrotask: callback => queueMicrotask(callback),
})

const workerFault = (message, cause) =>
  new AgentRuntimeE2EWorkerError('worker-fault', message, cause === undefined ? undefined : { cause })

const eventError = event =>
  event.error instanceof Error ? event.error : workerFault(event.message || 'Agent Runtime E2E module Worker failed')

const createEndpoint = (options, platform) => {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.getPrototypeOf(options) !== Object.prototype ||
    Reflect.ownKeys(options).some(key => key !== 'steps' && key !== 'telemetry') ||
    !Object.hasOwn(options, 'steps') ||
    Reflect.ownKeys(options).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(options, key)
      return typeof key !== 'string' || descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')
    })
  ) {
    throw new AgentRuntimeE2EWorkerError('invalid-steps', 'Worker endpoint options are invalid')
  }
  const values = Object.fromEntries(
    Reflect.ownKeys(options).map(key => [key, Object.getOwnPropertyDescriptor(options, key).value]),
  )
  const steps = cloneAgentRuntimeE2ESteps(values.steps)
  const telemetry = createMainThreadWorkerTelemetryDelivery(values.telemetry)
  const generation = (nextWorkerGeneration += 1)
  const channel = platform.createMessageChannel()
  let worker
  try {
    worker = platform.createWorker(generation)
  } catch (error) {
    channel.port1.close()
    channel.port2.close()
    throw error
  }

  const faultListeners = new Set()
  let lastFault
  let readySettled = false
  let terminated = false
  let resolveReady
  let rejectReady
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  void readyPromise.catch(() => {
    // Consumers opt into handshake observation through ready(); faults also flow through onFault.
  })

  const settleReadyFailure = error => {
    if (readySettled) return
    readySettled = true
    rejectReady(error)
  }
  const publishFault = error => {
    if (terminated) return
    const normalized = error instanceof Error ? error : workerFault(String(error))
    lastFault = normalized
    settleReadyFailure(normalized)
    for (const listener of [...faultListeners]) listener(normalized)
  }
  const onError = event => publishFault(eventError(event))
  const onMessageError = () =>
    publishFault(workerFault('Agent Runtime E2E module Worker message deserialization failed'))
  const onMessage = event => {
    let control
    try {
      control = parseAgentRuntimeE2EWorkerControlMessage(event.data)
    } catch (error) {
      publishFault(error)
      return
    }
    if (control.generation !== generation) {
      publishFault(workerFault('Agent Runtime E2E module Worker generation does not match its endpoint'))
      return
    }
    if (control.kind === 'telemetry') {
      telemetry.emit(control.event)
      return
    }
    if (control.kind === 'fault') {
      publishFault(workerFault(control.message))
      return
    }
    if (readySettled) {
      publishFault(workerFault('Agent Runtime E2E module Worker sent a duplicate ready handshake'))
      return
    }
    readySettled = true
    resolveReady()
  }

  worker.addEventListener('error', onError)
  worker.addEventListener('messageerror', onMessageError)
  worker.addEventListener('message', onMessage)

  const detachWorkerListeners = () => {
    worker.removeEventListener('error', onError)
    worker.removeEventListener('messageerror', onMessageError)
    worker.removeEventListener('message', onMessage)
  }

  try {
    worker.postMessage(
      {
        schemaVersion: AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION,
        kind: 'start',
        generation,
        port: channel.port2,
        steps,
      },
      [channel.port2],
    )
  } catch (error) {
    detachWorkerListeners()
    worker.terminate()
    channel.port1.close()
    channel.port2.close()
    settleReadyFailure(error)
    throw error
  }

  return Object.freeze({
    port: channel.port1,
    onFault(listener) {
      if (terminated) return () => {}
      faultListeners.add(listener)
      if (lastFault) {
        platform.queueMicrotask(() => {
          if (!terminated && faultListeners.has(listener)) listener(lastFault)
        })
      }
      return () => {
        faultListeners.delete(listener)
      }
    },
    ready: () => readyPromise,
    terminate() {
      if (terminated) return
      terminated = true
      detachWorkerListeners()
      settleReadyFailure(
        new AgentRuntimeE2EWorkerError(
          'terminated-before-ready',
          'Agent Runtime E2E module Worker terminated before its ready handshake',
        ),
      )
      faultListeners.clear()
      worker.terminate()
      channel.port1.close()
      try {
        channel.port2.close()
      } catch {
        // The browser detaches the transferred port; closing it is best-effort.
      }
    },
  })
}

/** @internal Pure factory seam for endpoint contract tests. */
export const createAgentRuntimeE2EWorkerEndpointForPlatform = (options, platform) => createEndpoint(options, platform)

export const createAgentRuntimeE2EWorkerEndpoint = options => {
  if (!isViteE2EEnabled()) {
    throw new AgentRuntimeE2EWorkerError(
      'disabled',
      'Agent Runtime scripted module Workers are available only when VITE_E2E=1',
    )
  }
  return createEndpoint(options, browserPlatform)
}
