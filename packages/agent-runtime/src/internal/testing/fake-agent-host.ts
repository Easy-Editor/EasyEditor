import type {
  AgentHost,
  CapabilitySchema,
  CapabilitySchemaRequest,
  HostSnapshot,
  InvocationResult,
  ObserveRequest,
  ReceiptQueryRequest,
  SemanticCall,
  ToolReceipt,
} from '../../contracts.js'

export interface FakeInvocationStep {
  readonly result: InvocationResult
  readonly nextSnapshot?: HostSnapshot
  readonly receipt?: ToolReceipt | null
}

export interface FakeAgentHostOptions {
  readonly snapshot?: HostSnapshot
  readonly capabilities?: readonly CapabilitySchema[]
  readonly invocationSteps?: readonly FakeInvocationStep[]
  readonly receipts?: readonly ToolReceipt[]
}

const clone = <Value>(value: Value): Value => structuredClone(value)

export class FakeAgentHost implements AgentHost {
  #snapshot: HostSnapshot
  readonly #capabilities = new Map<string, CapabilitySchema>()
  readonly #invocationSteps: FakeInvocationStep[]
  readonly #receipts = new Map<string, ToolReceipt>()
  readonly observations: ObserveRequest[] = []
  readonly invocations: SemanticCall[] = []
  readonly receiptQueries: ReceiptQueryRequest[] = []

  constructor(options: FakeAgentHostOptions = {}) {
    this.#snapshot = clone(options.snapshot ?? { schemaVersion: 1, revision: 'revision-0', projection: {} })
    for (const capability of options.capabilities ?? []) {
      this.#capabilities.set(capability.capability, clone(capability))
    }
    this.#invocationSteps = [...clone(options.invocationSteps ?? [])]
    for (const receipt of options.receipts ?? []) this.#receipts.set(receipt.callId, clone(receipt))
  }

  setSnapshot(snapshot: HostSnapshot): void {
    this.#snapshot = clone(snapshot)
  }

  enqueueInvocation(step: FakeInvocationStep): void {
    this.#invocationSteps.push(clone(step))
  }

  async observe(request: ObserveRequest): Promise<HostSnapshot> {
    this.observations.push(clone(request))
    return clone(this.#snapshot)
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
