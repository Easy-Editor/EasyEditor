import { startAgentWorker } from '@easy-editor/agent-runtime/worker'
import { GatewayModelAdapter } from '../gateway-model-adapter.mjs'
import { PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION, parseProductionAgentWorkerStartMessage } from './protocol.mjs'
import { startProductionAgentWorkerRuntime } from './worker-runtime.mjs'

let started = false

const postControl = message => self.postMessage(Object.freeze(message))

self.addEventListener('message', event => {
  if (started) throw new Error('Production Agent Worker can be started only once')
  const start = parseProductionAgentWorkerStartMessage(event.data)
  started = true

  void startProductionAgentWorkerRuntime({
    start: startAgentWorker,
    port: start.port,
    model: new GatewayModelAdapter(start.config),
    generation: start.generation,
    postControl,
  }).then(
    () => {
      postControl({
        schemaVersion: PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION,
        kind: 'ready',
        generation: start.generation,
      })
    },
    () => {
      postControl({
        schemaVersion: PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION,
        kind: 'fault',
        generation: start.generation,
        message: 'Production Agent Worker bootstrap failed',
      })
    },
  )
})
