import {
  ScriptedModelAdapter,
  createDeterministicClock,
  createDeterministicIdFactory,
} from '@easy-editor/agent-runtime/testing'
import { type ModelEvent, type ModelTurnPhase, startAgentWorker } from '@easy-editor/agent-runtime/worker'

type WorkerStep = Readonly<{
  expectedPhase: ModelTurnPhase
  events: readonly ModelEvent[]
}>

type StartMessage = Readonly<{
  kind: 'start'
  generation: number
  port: MessagePort
  steps: readonly WorkerStep[]
}>

type CrashMessage = Readonly<{ kind: 'crash' }>

self.addEventListener('message', event => {
  const message = event.data as StartMessage | CrashMessage
  if (message.kind === 'crash') throw new Error('intentional E2E module Worker crash')
  void startAgentWorker({
    port: message.port,
    model: new ScriptedModelAdapter(message.steps),
    clock: createDeterministicClock(),
    idFactory: createDeterministicIdFactory(`browser-worker-${message.generation}-`),
  })
})
