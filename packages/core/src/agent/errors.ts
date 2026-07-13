export interface AgentCapabilityErrorOptions {
  readonly code: string
  readonly message: string
  readonly action?: string
  readonly committed?: boolean
  readonly rollbackComplete?: boolean
  readonly terminal?: boolean
}

export class AgentCapabilityError extends Error {
  readonly name: string = 'AgentCapabilityError'

  readonly code: string

  readonly action?: string

  readonly committed: boolean

  readonly rollbackComplete?: boolean

  readonly terminal: boolean

  constructor(options: AgentCapabilityErrorOptions) {
    super(options.message)
    this.code = options.code
    this.action = options.action
    this.committed = options.committed ?? false
    this.rollbackComplete = options.rollbackComplete
    this.terminal = options.terminal ?? false
  }
}

export class AgentPlanStaleError extends AgentCapabilityError {
  readonly name: string = 'AgentPlanStaleError'

  readonly currentRevision?: string

  constructor(message = 'The prepared agent plan is stale', currentRevision?: string) {
    super({ action: 'execute', code: 'agent.plan.stale', message })
    this.currentRevision = currentRevision
  }
}

export const toAgentCapabilityError = (
  error: unknown,
  fallback: Pick<AgentCapabilityErrorOptions, 'action' | 'code' | 'message'>,
): AgentCapabilityError => {
  if (error instanceof AgentCapabilityError) return error
  return new AgentCapabilityError(fallback)
}
