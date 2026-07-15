import type { ModelAdapter, ModelEvent, ModelTurnPhase, ModelTurnRequest } from '../../contracts.js'

export type ScriptedModelFault = 'disconnect' | 'malformed' | 'timeout'

export interface ScriptedModelStep {
  readonly expectedPhase: ModelTurnPhase
  readonly matchRequest?: (request: ModelTurnRequest) => boolean
  readonly events: readonly ModelEvent[]
  readonly delayMs?: number
  readonly fault?: ScriptedModelFault
}

export interface ScriptedModelAdapterOptions {
  readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export class ScriptedModelError extends Error {
  readonly code:
    | 'script-exhausted'
    | 'script-not-consumed'
    | 'unexpected-phase'
    | 'request-mismatch'
    | ScriptedModelFault

  constructor(code: ScriptedModelError['code'], message: string) {
    super(message)
    this.name = 'ScriptedModelError'
    this.code = code
  }
}

const abortError = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : new DOMException('The model turn was aborted', 'AbortError')

const defaultDelay = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(abortError(signal))
      },
      { once: true },
    )
  })

const waitForAbort = (signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    signal.addEventListener('abort', () => reject(abortError(signal)), { once: true })
  })

export class ScriptedModelAdapter implements ModelAdapter {
  readonly #delay: NonNullable<ScriptedModelAdapterOptions['delay']>
  readonly #steps: readonly ScriptedModelStep[]
  #consumed = 0

  constructor(steps: readonly ScriptedModelStep[], options: ScriptedModelAdapterOptions = {}) {
    this.#steps = [...steps]
    this.#delay = options.delay ?? defaultDelay
  }

  get consumedSteps(): number {
    return this.#consumed
  }

  get remainingSteps(): number {
    return this.#steps.length - this.#consumed
  }

  assertFullyConsumed(): void {
    if (this.remainingSteps !== 0) {
      throw new ScriptedModelError(
        'script-not-consumed',
        `${this.remainingSteps} scripted model step(s) were not consumed`,
      )
    }
  }

  async *run(request: ModelTurnRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const step = this.#steps[this.#consumed]
    if (!step) throw new ScriptedModelError('script-exhausted', 'scripted model has no remaining step')
    this.#consumed += 1

    if (request.phase !== step.expectedPhase) {
      throw new ScriptedModelError(
        'unexpected-phase',
        `expected model phase ${step.expectedPhase}, received ${request.phase}`,
      )
    }
    if (step.matchRequest && !step.matchRequest(request)) {
      throw new ScriptedModelError('request-mismatch', 'model request did not match the scripted predicate')
    }
    if (step.delayMs !== undefined) await this.#delay(step.delayMs, signal)
    if (signal.aborted) throw abortError(signal)

    if (step.fault === 'disconnect') {
      throw new ScriptedModelError('disconnect', 'scripted model disconnected')
    }
    if (step.fault === 'timeout') await waitForAbort(signal)
    if (step.fault === 'malformed') {
      yield { schemaVersion: 1, kind: 'complete', unexpected: true } as unknown as ModelEvent
      return
    }

    for (const event of step.events) {
      if (signal.aborted) throw abortError(signal)
      yield structuredClone(event)
    }
  }
}
