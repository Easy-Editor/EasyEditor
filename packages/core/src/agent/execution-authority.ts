import { AgentCapabilityError } from './errors'

export const createAgentHostApprovalRequiredError = (): AgentCapabilityError =>
  new AgentCapabilityError({
    action: 'execute',
    code: 'agent.execution.hostApprovalRequired',
    message: 'The Agent plan requires explicit host approval before execution',
  })
