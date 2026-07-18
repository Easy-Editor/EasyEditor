import {
  type AgentHost,
  type AgentPersistencePort,
  type AgentRuntime,
  type AgentRuntimeBinding,
  type AgentRuntimeSnapshot,
  createAgentRuntime,
} from '@easy-editor/agent-runtime'
import type { ModelEvent, ModelTurnPhase } from '@easy-editor/agent-runtime/worker'

type WorkerStep = Readonly<{
  expectedPhase: ModelTurnPhase
  events: readonly ModelEvent[]
}>

type ControllableRuntime = AgentRuntime &
  Readonly<{
    ready(): Promise<void>
    waitForIdle(): Promise<void>
  }>

export type BrowserAgentRuntimeHarness = Readonly<{
  runtime: ControllableRuntime
  crashActiveWorker(): Promise<void>
  getWorkerCount(): number
  getLiveWorkerCount(): number
  getStatuses(): readonly AgentRuntimeSnapshot['status'][]
}>

export const createBrowserAgentRuntimeHarness = (options: {
  binding: AgentRuntimeBinding
  host: AgentHost
  persistence: AgentPersistencePort
  scripts: readonly (readonly WorkerStep[])[]
}): BrowserAgentRuntimeHarness => {
  const scripts = options.scripts.map(script => [...script])
  const workers: Worker[] = []
  const statuses: AgentRuntimeSnapshot['status'][] = []
  let liveWorkerCount = 0

  const runtime = createAgentRuntime({
    binding: options.binding,
    host: options.host,
    persistence: options.persistence,
    worker() {
      const generation = workers.length + 1
      const worker = new Worker(new URL('./agent-runtime-worker.ts', import.meta.url), { type: 'module' })
      const channel = new MessageChannel()
      const faultListeners = new Set<(error: unknown) => void>()
      let terminated = false
      const publishFault = (error: unknown) => {
        for (const listener of [...faultListeners]) listener(error)
      }
      worker.addEventListener('error', event => {
        publishFault(event.error ?? new Error(event.message || 'module Worker failed'))
      })
      worker.addEventListener('messageerror', () => {
        publishFault(new Error('module Worker message deserialization failed'))
      })
      worker.postMessage({ kind: 'start', generation, port: channel.port2, steps: scripts.shift() ?? [] }, [
        channel.port2,
      ])
      workers.push(worker)
      liveWorkerCount += 1
      return {
        port: channel.port1,
        terminate() {
          if (terminated) return
          terminated = true
          liveWorkerCount -= 1
          worker.terminate()
        },
        onFault(listener: (error: unknown) => void) {
          faultListeners.add(listener)
          return () => {
            faultListeners.delete(listener)
          }
        },
      }
    },
  }) as ControllableRuntime
  runtime.subscribe(snapshot => statuses.push(snapshot.status))

  return Object.freeze({
    runtime,
    crashActiveWorker() {
      const worker = workers.at(-1)
      if (!worker) return Promise.reject(new Error('No module Worker is active'))
      return new Promise<void>((resolve, reject) => {
        let unsubscribe: (() => void) | undefined
        let postSucceeded = false
        let recoveringSeen = false
        let settled = false
        const cleanup = () => {
          const active = unsubscribe
          unsubscribe = undefined
          try {
            active?.()
          } catch {}
        }
        const resolveIfRecovered = () => {
          if (settled || !postSucceeded || !recoveringSeen) return
          settled = true
          cleanup()
          resolve()
        }
        try {
          unsubscribe = runtime.subscribe(snapshot => {
            if (snapshot.status !== 'recovering') return
            recoveringSeen = true
            resolveIfRecovered()
          })
          worker.postMessage({ kind: 'crash' })
          postSucceeded = true
          resolveIfRecovered()
        } catch (error) {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        }
      })
    },
    getWorkerCount: () => workers.length,
    getLiveWorkerCount: () => liveWorkerCount,
    getStatuses: () => [...statuses],
  })
}
