import { AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION } from './protocol.mjs'

export const startAgentRuntimeE2EWorkerRuntime = ({
  start,
  port,
  model,
  clock,
  idFactory,
  generation,
  postControl,
}) => {
  const telemetry = Object.freeze({
    emit(event) {
      try {
        postControl({
          schemaVersion: AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION,
          kind: 'telemetry',
          generation,
          event,
        })
      } catch {
        // Telemetry is observability only; control transport failures cannot gate Worker execution.
      }
    },
  })
  return start({ port, model, clock, idFactory, telemetry })
}
