import { createAgentPlanSummary } from '../components/ai-chat/agent-plan-summary.mjs'

const defaultClock = Object.freeze({
  clearTimeout: handle => globalThis.clearTimeout(handle),
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
})

export class AgentPlanCoordinatorError extends Error {
  name = 'AgentPlanCoordinatorError'

  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const waitForConfirmation = (confirmProposal, proposal, signal, clock) =>
  new Promise((resolve, reject) => {
    let settled = false
    const settle = operation => {
      if (settled) return
      settled = true
      clock.clearTimeout(timeoutHandle)
      signal.removeEventListener('abort', handleAbort)
      operation()
    }
    const handleAbort = () =>
      settle(() => reject(new AgentPlanCoordinatorError('dashboard.agent.aborted', 'Agent 请求已取消。')))

    const timeoutHandle = clock.setTimeout(
      () =>
        settle(() =>
          reject(
            new AgentPlanCoordinatorError('dashboard.agent.confirmationExpired', 'Agent 提案已过期，请重新生成。'),
          ),
        ),
      Math.max(0, proposal.expiresAt - clock.now()),
    )
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) {
      handleAbort()
      return
    }

    let confirmation
    try {
      confirmation = Promise.resolve(confirmProposal(proposal, { signal }))
    } catch (error) {
      settle(() => reject(error))
      return
    }
    confirmation.then(
      decision =>
        settle(() => {
          if (typeof decision !== 'boolean') {
            reject(
              new AgentPlanCoordinatorError(
                'dashboard.agent.invalidConfirmation',
                'Agent 提案确认回调必须返回明确决定。',
              ),
            )
            return
          }
          resolve(decision)
        }),
      error => settle(() => reject(error)),
    )
  })

/**
 * Coordinates one host-owned prepared plan. The caller retains Worker/session
 * lifecycle ownership; this function owns only lookup, confirmation and the
 * single host-approved commit decision.
 */
export const coordinatePreparedAgentPlan = async input => {
  const clock = input.clock ?? defaultClock
  const preview = input.authority.getPreparedPlanPreview(input.planId)
  if (
    !preview ||
    preview.state !== 'prepared' ||
    preview.planId !== input.planId ||
    preview.documentId !== input.documentId
  ) {
    throw new AgentPlanCoordinatorError('dashboard.agent.invalidWorkerResponse', 'Agent Worker 提案不属于当前请求。')
  }

  const proposal = Object.freeze({
    expiresAt: clock.now() + input.confirmationTimeoutMs,
    message: input.message,
    proposalId: input.proposalId,
    summary: createAgentPlanSummary(preview),
  })
  const confirmed = await waitForConfirmation(input.confirmProposal, proposal, input.signal, clock)
  if (!confirmed) {
    throw new AgentPlanCoordinatorError('dashboard.agent.rejected', '已取消执行，画布未发生变化。')
  }
  if (input.signal.aborted) {
    throw new AgentPlanCoordinatorError('dashboard.agent.aborted', 'Agent 请求已取消。')
  }
  if (clock.now() >= proposal.expiresAt) {
    throw new AgentPlanCoordinatorError('dashboard.agent.confirmationExpired', 'Agent 提案已过期，请重新生成。')
  }

  return input.authority.approveAndExecute(preview.planId)
}
