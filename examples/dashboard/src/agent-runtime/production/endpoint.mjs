import { createMainThreadWorkerTelemetryDelivery } from '../worker-telemetry-control.mjs'
import {
  PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION,
  ProductionAgentWorkerError,
  cloneProductionAgentModelConfig,
  parseProductionAgentWorkerControlMessage,
} from './protocol.mjs'

let nextWorkerGeneration = 0

const browserPlatform = Object.freeze({
  createMessageChannel: () => new MessageChannel(),
  createWorker: generation =>
    new Worker(new URL('./worker.mjs', import.meta.url), {
      name: `easy-editor-agent-runtime-production-${generation}`,
      type: 'module',
    }),
  queueMicrotask: callback => queueMicrotask(callback),
})

const workerFault = message => new ProductionAgentWorkerError('worker-fault', message)

const createEndpoint = (options, platform) => {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.getPrototypeOf(options) !== Object.prototype ||
    Reflect.ownKeys(options).some(key => key !== 'config' && key !== 'telemetry') ||
    !Object.hasOwn(options, 'config') ||
    Reflect.ownKeys(options).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(options, key)
      return typeof key !== 'string' || descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')
    })
  ) {
    throw new ProductionAgentWorkerError('invalid-config', 'Production Agent model configuration is invalid')
  }
  const config = cloneProductionAgentModelConfig(options.config)
  const telemetry = createMainThreadWorkerTelemetryDelivery(options.telemetry)
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
    const normalized =
      error instanceof ProductionAgentWorkerError ? error : workerFault('Production Agent module Worker failed')
    lastFault = normalized
    settleReadyFailure(normalized)
    for (const listener of [...faultListeners]) listener(normalized)
  }
  const onError = () => publishFault(workerFault('Production Agent module Worker failed'))
  const onMessageError = () =>
    publishFault(workerFault('Production Agent module Worker message deserialization failed'))
  const onMessage = event => {
    let control
    try {
      control = parseProductionAgentWorkerControlMessage(event.data)
    } catch (error) {
      publishFault(error)
      return
    }
    if (control.generation !== generation) {
      publishFault(workerFault('Production Agent module Worker generation does not match its endpoint'))
      return
    }
    if (control.kind === 'telemetry') {
      telemetry.emit(control.event)
      return
    }
    if (control.kind === 'fault') {
      publishFault(workerFault('Production Agent module Worker reported a bootstrap fault'))
      return
    }
    if (readySettled) {
      publishFault(workerFault('Production Agent module Worker sent a duplicate ready handshake'))
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
        schemaVersion: PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION,
        kind: 'start',
        generation,
        port: channel.port2,
        config,
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
      return () => faultListeners.delete(listener)
    },
    ready: () => readyPromise,
    terminate() {
      if (terminated) return
      terminated = true
      detachWorkerListeners()
      settleReadyFailure(
        new ProductionAgentWorkerError(
          'terminated-before-ready',
          'Production Agent module Worker terminated before its ready handshake',
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

/** @internal Pure factory seam for endpoint lifecycle tests. */
export const createProductionAgentWorkerEndpointForPlatform = (options, platform) => createEndpoint(options, platform)

export const createProductionAgentWorkerEndpoint = options => createEndpoint(options, browserPlatform)
