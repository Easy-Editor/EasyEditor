const confirmationError = (code, message) => {
  const error = new Error(message)
  error.name = 'AgentPlanConfirmationError'
  error.code = code
  return error
}

export class AgentPlanConfirmationSlot {
  #pending

  get pendingProposalId() {
    return this.#pending?.proposalId
  }

  request(proposalId, signal) {
    if (typeof proposalId !== 'string' || proposalId.length === 0) {
      return Promise.reject(confirmationError('dashboard.agent.confirmation.invalid', 'proposalId is required'))
    }
    if (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function') {
      return Promise.reject(
        confirmationError('dashboard.agent.confirmation.invalid', 'An AbortSignal is required for confirmation'),
      )
    }
    if (signal.aborted) {
      return Promise.reject(confirmationError('dashboard.agent.confirmation.aborted', 'Confirmation was aborted'))
    }

    this.cancel('dashboard.agent.confirmation.superseded')

    return new Promise((resolve, reject) => {
      const handleAbort = () => {
        if (this.#pending?.proposalId !== proposalId) return
        this.#consume()
        reject(confirmationError('dashboard.agent.confirmation.aborted', 'Confirmation was aborted'))
      }
      this.#pending = { handleAbort, proposalId, reject, resolve, signal }
      signal.addEventListener('abort', handleAbort, { once: true })
      if (signal.aborted) handleAbort()
    })
  }

  approve(proposalId) {
    return this.#settle(proposalId, true)
  }

  reject(proposalId) {
    return this.#settle(proposalId, false)
  }

  cancel(code = 'dashboard.agent.confirmation.cancelled') {
    const pending = this.#consume()
    if (!pending) return false
    pending.reject(confirmationError(code, 'Confirmation was cancelled'))
    return true
  }

  #settle(proposalId, decision) {
    if (this.#pending?.proposalId !== proposalId) return false
    const pending = this.#consume()
    pending.resolve(decision)
    return true
  }

  #consume() {
    const pending = this.#pending
    if (!pending) return undefined
    this.#pending = undefined
    pending.signal.removeEventListener('abort', pending.handleAbort)
    return pending
  }
}
