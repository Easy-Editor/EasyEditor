import {
  ScriptedModelAdapter,
  createDeterministicClock,
  createDeterministicIdFactory,
} from '@easy-editor/agent-runtime/testing'
import { startAgentWorker } from '@easy-editor/agent-runtime/worker'
import { AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION, cloneAgentRuntimeE2ESteps } from './protocol.mjs'

let started = false

const postControl = message => self.postMessage(Object.freeze(message))

const assertStartMessage = message => {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('Agent Runtime E2E Worker start message must be an object')
  }
  const fields = Object.keys(message).sort()
  if (fields.join(',') !== 'generation,kind,port,schemaVersion,steps') {
    throw new Error('Agent Runtime E2E Worker start message has unexpected fields')
  }
  if (message.schemaVersion !== AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION || message.kind !== 'start') {
    throw new Error('Agent Runtime E2E Worker start message is invalid')
  }
  if (!Number.isSafeInteger(message.generation) || message.generation < 1) {
    throw new Error('Agent Runtime E2E Worker generation is invalid')
  }
  if (
    message.port === null ||
    typeof message.port !== 'object' ||
    typeof message.port.postMessage !== 'function' ||
    typeof message.port.addEventListener !== 'function'
  ) {
    throw new Error('Agent Runtime E2E Worker requires a transferred MessagePort')
  }
  return {
    generation: message.generation,
    port: message.port,
    steps: cloneAgentRuntimeE2ESteps(message.steps),
  }
}

self.addEventListener('message', event => {
  if (started) throw new Error('Agent Runtime E2E Worker can be started only once')
  const start = assertStartMessage(event.data)
  started = true

  void startAgentWorker({
    port: start.port,
    model: new ScriptedModelAdapter(start.steps),
    clock: createDeterministicClock(start.generation * 1_000_000),
    idFactory: createDeterministicIdFactory(`dashboard-e2e-worker-${start.generation}-`),
  }).then(
    () => {
      postControl({
        schemaVersion: AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION,
        kind: 'ready',
        generation: start.generation,
      })
    },
    error => {
      postControl({
        schemaVersion: AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION,
        kind: 'fault',
        generation: start.generation,
        message: error instanceof Error ? error.message : String(error),
      })
    },
  )
})
