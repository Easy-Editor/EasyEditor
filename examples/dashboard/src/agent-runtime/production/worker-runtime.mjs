import { GATEWAY_MODEL_TOKEN_BUDGET } from '../gateway-model-adapter.mjs'
import { PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION } from './protocol.mjs'

export const startProductionAgentWorkerRuntime = ({ start, port, model, generation, postControl }) => {
  const telemetry = Object.freeze({
    emit(event) {
      try {
        postControl({
          schemaVersion: PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION,
          kind: 'telemetry',
          generation,
          event,
        })
      } catch {
        // Telemetry is observability only; control transport failures cannot gate Worker execution.
      }
    },
  })
  return start({ port, model, modelTokenBudget: GATEWAY_MODEL_TOKEN_BUDGET, telemetry })
}
