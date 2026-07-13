export class AgentRequestSlot {
  #active

  begin() {
    if (this.#active) return undefined
    const controller = new AbortController()
    this.#active = controller
    return controller
  }

  cancel() {
    this.#active?.abort()
  }

  release(controller) {
    if (this.#active !== controller) return false
    this.#active = undefined
    return true
  }
}
