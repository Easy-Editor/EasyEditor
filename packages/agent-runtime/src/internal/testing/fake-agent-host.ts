import type {
  AgentHost,
  CapabilitySchema,
  CapabilitySchemaRequest,
  HostSnapshot,
  HostSnapshotDelta,
  InvocationResult,
  ObserveRequest,
  ReceiptQueryRequest,
  SemanticCall,
  ToolReceipt,
} from '../../contracts.js'
import { applyHostSnapshotDelta } from '../snapshot/index.js'

export interface FakeInvocationStep {
  readonly result: InvocationResult
  readonly nextSnapshot?: HostSnapshot
  readonly receipt?: ToolReceipt | null
}

export interface FakeAgentHostOptions {
  readonly snapshot?: HostSnapshot
  readonly observationSteps?: readonly (HostSnapshot | HostSnapshotDelta)[]
  readonly capabilities?: readonly CapabilitySchema[]
  readonly invocationSteps?: readonly FakeInvocationStep[]
  readonly receipts?: readonly ToolReceipt[]
}

const clone = <Value>(value: Value): Value => structuredClone(value)

export class FakeAgentHost implements AgentHost {
  #snapshot: HostSnapshot
  readonly #observationSteps: (HostSnapshot | HostSnapshotDelta)[]
  readonly #capabilities = new Map<string, CapabilitySchema>()
  readonly #invocationSteps: FakeInvocationStep[]
  readonly #receipts = new Map<string, ToolReceipt>()
  readonly observations: ObserveRequest[] = []
  readonly invocations: SemanticCall[] = []
  readonly receiptQueries: ReceiptQueryRequest[] = []

  constructor(options: FakeAgentHostOptions = {}) {
    this.#snapshot = clone(
      options.snapshot ?? { schemaVersion: 1, revision: 'revision-0', providerGenerations: {}, projection: {} },
    )
    this.#observationSteps = [...clone(options.observationSteps ?? [])]
    for (const capability of options.capabilities ?? []) {
      this.#capabilities.set(capability.capability, clone(capability))
    }
    this.#invocationSteps = [...clone(options.invocationSteps ?? [])]
    for (const receipt of options.receipts ?? []) this.#receipts.set(receipt.callId, clone(receipt))
  }

  setSnapshot(snapshot: HostSnapshot): void {
    this.#snapshot = clone(snapshot)
  }

  enqueueObservation(observation: HostSnapshot | HostSnapshotDelta): void {
    this.#observationSteps.push(clone(observation))
  }

  enqueueInvocation(step: FakeInvocationStep): void {
    this.#invocationSteps.push(clone(step))
  }

  async observe(request: ObserveRequest): Promise<HostSnapshot | HostSnapshotDelta> {
    this.observations.push(clone(request))
    const scripted = this.#observationSteps.shift()
    if (!scripted) return clone(this.#snapshot)
    const observation = clone(scripted)
    if (Object.hasOwn(observation, 'projection')) {
      this.#snapshot = clone(observation as HostSnapshot)
    } else {
      try {
        this.#snapshot = clone(applyHostSnapshotDelta(this.#snapshot, observation as HostSnapshotDelta))
      } catch {
        // Invalid scripted deltas remain observable so fallback paths can be tested.
      }
    }
    return observation
  }

  async describeCapability(request: CapabilitySchemaRequest): Promise<CapabilitySchema> {
    const capability = this.#capabilities.get(request.capability)
    return clone(
      capability ?? {
        schemaVersion: 1,
        capability: request.capability,
        revision: 'capability-1',
        input: {},
      },
    )
  }

  async invoke(call: SemanticCall): Promise<InvocationResult> {
    this.invocations.push(clone(call))
    const step = this.#invocationSteps.shift()
    const result: InvocationResult = clone(
      step?.result ?? {
        schemaVersion: 1 as const,
        callId: call.callId,
        status: 'applied' as const,
        revision: this.#snapshot.revision,
      },
    )
    if (step?.nextSnapshot) this.#snapshot = clone(step.nextSnapshot)
    if (step?.receipt) this.#receipts.set(step.receipt.callId, clone(step.receipt))
    return result
  }

  async queryReceipt(request: ReceiptQueryRequest): Promise<ToolReceipt | null> {
    this.receiptQueries.push(clone(request))
    return clone(this.#receipts.get(request.callId) ?? null)
  }
}
