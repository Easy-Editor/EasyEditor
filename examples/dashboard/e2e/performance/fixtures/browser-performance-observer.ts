import type { Page } from '@playwright/test'

export interface ObservedRenderBatch {
  readonly frameId: number
  readonly sequence: number
  readonly timestampMs: number
  readonly updateCount: number
  readonly removalCount: number
}

export interface ObservedLongTask {
  readonly durationMs: number
  readonly name: string
  readonly startTimeMs: number
}

export interface BrowserOperationMeasurement {
  readonly frameTimestampsMs: readonly number[]
  readonly longTaskSupported: boolean
  readonly longTasks: readonly ObservedLongTask[]
  readonly renderBatches: readonly ObservedRenderBatch[]
  readonly run: number
}

export interface BrowserBoundarySnapshot {
  readonly activePortCount: number
  readonly closedPortCount: number
  readonly createdPortCount: number
  readonly frameId: number
  readonly latestSandboxResources: Readonly<{
    instanceCount: number
    listenerCount: number
    objectUrlCount: number
    pendingTaskCount: number
  }> | null
  readonly mainThreadModelRequests: readonly string[]
  readonly renderBatches: readonly ObservedRenderBatch[]
  readonly workers: readonly Readonly<{ name: string | null; timestampMs: number; url: string }>[]
}

export interface OnlineResourceDiagnostics {
  readonly activePortCount: number
  readonly bridge: Readonly<{
    attached: boolean
    instanceCount: number
    listenerCount: number
    mutationObserverCount: number
    observedElementCount: number
    resizeObserverCount: number
    scheduledFrameCount: number
  }>
  readonly closedPortCount: number
  readonly createdPortCount: number
  readonly objectUrlCount: number | null
  readonly sandboxInstanceCount: number | null
  readonly sandboxListenerCount: number | null
  readonly sandboxPendingTaskCount: number | null
}

const OBSERVER_KEY = '__EASY_EDITOR_G010_BROWSER_OBSERVER__'
const MEASUREMENT_KEY = '__EASY_EDITOR_G010_ACTIVE_MEASUREMENT__'

export const installBrowserPerformanceObserver = (page: Page) =>
  page.addInitScript(
    ({ measurementKey, observerKey }) => {
      if (window !== window.top) return
      const target = window as typeof window & Record<string, unknown>
      if (target[observerKey]) return

      const state = {
        frameId: 0,
        createdPortCount: 0,
        closedPortCount: 0,
        renderBatches: [] as ObservedRenderBatch[],
        workers: [] as { name: string | null; timestampMs: number; url: string }[],
        mainThreadModelRequests: [] as string[],
        latestSandboxResources: null as BrowserBoundarySnapshot['latestSandboxResources'],
      }
      target[observerKey] = state

      const tick = () => {
        state.frameId += 1
        window.requestAnimationFrame(tick)
      }
      window.requestAnimationFrame(tick)

      const trackedPorts = new WeakSet<MessagePort>()
      const closedPorts = new WeakSet<MessagePort>()
      const observePort = (port: MessagePort) => {
        if (trackedPorts.has(port)) return
        trackedPorts.add(port)
        state.createdPortCount += 1
        port.addEventListener('message', event => {
          const message = event.data as {
            kind?: unknown
            resources?: BrowserBoundarySnapshot['latestSandboxResources']
          }
          if (message?.kind !== 'online-component.batch-applied' || !message.resources) return
          state.latestSandboxResources = {
            instanceCount: message.resources.instanceCount,
            listenerCount: message.resources.listenerCount,
            objectUrlCount: message.resources.objectUrlCount,
            pendingTaskCount: message.resources.pendingTaskCount,
          }
        })
      }

      const NativeMessageChannel = window.MessageChannel
      window.MessageChannel = new Proxy(NativeMessageChannel, {
        construct(channelTarget, argumentsList, newTarget) {
          const channel = Reflect.construct(channelTarget, argumentsList, newTarget) as MessageChannel
          observePort(channel.port1)
          observePort(channel.port2)
          return channel
        },
      })

      const nativeClose = MessagePort.prototype.close
      MessagePort.prototype.close = function () {
        if (trackedPorts.has(this) && !closedPorts.has(this)) {
          closedPorts.add(this)
          state.closedPortCount += 1
        }
        return Reflect.apply(nativeClose, this, [])
      }

      const nativePostMessage = MessagePort.prototype.postMessage
      const instrumentedPostMessage = function (
        this: MessagePort,
        ...args: [message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions]
      ) {
        const message = args[0] as {
          kind?: unknown
          removals?: readonly unknown[]
          sequence?: unknown
          updates?: readonly unknown[]
        }
        if (message?.kind === 'online-component.render-batch' && Number.isSafeInteger(message.sequence)) {
          state.renderBatches.push({
            frameId: state.frameId,
            sequence: message.sequence as number,
            timestampMs: performance.now(),
            updateCount: Array.isArray(message.updates) ? message.updates.length : 0,
            removalCount: Array.isArray(message.removals) ? message.removals.length : 0,
          })
        }
        return Reflect.apply(
          nativePostMessage as (
            message: unknown,
            transferOrOptions?: Transferable[] | StructuredSerializeOptions,
          ) => void,
          this,
          args,
        )
      }
      MessagePort.prototype.postMessage = instrumentedPostMessage as MessagePort['postMessage']

      const NativeWorker = window.Worker
      window.Worker = new Proxy(NativeWorker, {
        construct(workerTarget, argumentsList, newTarget) {
          const worker = Reflect.construct(workerTarget, argumentsList, newTarget) as Worker
          const options = argumentsList[1] as WorkerOptions | undefined
          state.workers.push({
            name: options?.name ?? null,
            timestampMs: performance.now(),
            url: String(argumentsList[0]),
          })
          return worker
        },
      })

      const nativeFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
        if (url.origin === window.location.origin && url.pathname.startsWith('/api/agent/model')) {
          state.mainThreadModelRequests.push(url.href)
        }
        return nativeFetch(input, init)
      }

      target[measurementKey] = undefined
    },
    { measurementKey: MEASUREMENT_KEY, observerKey: OBSERVER_KEY },
  )

export const beginBrowserOperationMeasurement = (page: Page, run: number): Promise<void> =>
  page.evaluate(
    async ({ measurementKey, observerKey, run }) => {
      const target = window as typeof window & Record<string, unknown>
      const state = target[observerKey] as BrowserBoundarySnapshot | undefined
      if (!state) throw new Error('G010 browser observer is unavailable')
      if (target[measurementKey]) throw new Error('G010 browser measurement is already active')
      const measurement = {
        active: true,
        batchStartIndex: state.renderBatches.length,
        frameTimestampsMs: [] as number[],
        longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
        longTasks: [] as ObservedLongTask[],
        observer: undefined as PerformanceObserver | undefined,
        run,
      }
      if (measurement.longTaskSupported) {
        measurement.observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            measurement.longTasks.push({
              durationMs: entry.duration,
              name: entry.name,
              startTimeMs: entry.startTime,
            })
          }
        })
        measurement.observer.observe({ type: 'longtask' })
      }
      target[measurementKey] = measurement
      await new Promise<void>(resolve => {
        window.requestAnimationFrame(() => {
          const sample = (timestamp: number) => {
            if (!measurement.active) return
            measurement.frameTimestampsMs.push(timestamp)
            window.requestAnimationFrame(sample)
          }
          window.requestAnimationFrame(sample)
          resolve()
        })
      })
    },
    { measurementKey: MEASUREMENT_KEY, observerKey: OBSERVER_KEY, run },
  )

export const finishBrowserOperationMeasurement = (page: Page): Promise<BrowserOperationMeasurement> =>
  page.evaluate(
    async ({ measurementKey, observerKey }) => {
      const target = window as typeof window & Record<string, unknown>
      const state = target[observerKey] as BrowserBoundarySnapshot | undefined
      const measurement = target[measurementKey] as
        | {
            active: boolean
            batchStartIndex: number
            frameTimestampsMs: number[]
            longTaskSupported: boolean
            longTasks: ObservedLongTask[]
            observer?: PerformanceObserver
            run: number
          }
        | undefined
      if (!state || !measurement) throw new Error('G010 browser measurement is unavailable')
      await new Promise<void>(resolve =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
      )
      for (const entry of measurement.observer?.takeRecords() ?? []) {
        measurement.longTasks.push({
          durationMs: entry.duration,
          name: entry.name,
          startTimeMs: entry.startTime,
        })
      }
      measurement.observer?.disconnect()
      measurement.active = false
      target[measurementKey] = undefined
      return {
        frameTimestampsMs: measurement.frameTimestampsMs,
        longTaskSupported: measurement.longTaskSupported,
        longTasks: measurement.longTasks,
        renderBatches: state.renderBatches.slice(measurement.batchStartIndex),
        run: measurement.run,
      }
    },
    { measurementKey: MEASUREMENT_KEY, observerKey: OBSERVER_KEY },
  )

export const readBrowserBoundarySnapshot = (page: Page): Promise<BrowserBoundarySnapshot> =>
  page.evaluate(observerKey => {
    const target = window as typeof window & Record<string, unknown>
    const state = target[observerKey] as BrowserBoundarySnapshot | undefined
    if (!state) throw new Error('G010 browser observer is unavailable')
    return {
      activePortCount: state.createdPortCount - state.closedPortCount,
      closedPortCount: state.closedPortCount,
      createdPortCount: state.createdPortCount,
      frameId: state.frameId,
      latestSandboxResources: state.latestSandboxResources,
      mainThreadModelRequests: [...state.mainThreadModelRequests],
      renderBatches: [...state.renderBatches],
      workers: [...state.workers],
    }
  }, OBSERVER_KEY)

export const readOnlineResourceDiagnostics = (page: Page): Promise<OnlineResourceDiagnostics> =>
  page.evaluate(async observerKey => {
    const runtime = await import('/src/editor/runtime.ts')
    const bridge = runtime.engine.project.simulator.appHelper?.onlineComponentSurfaceBridge as
      | { getDiagnostics(): OnlineResourceDiagnostics['bridge'] }
      | undefined
    if (!bridge) throw new Error('G010 online component surface bridge is unavailable')
    const target = window as typeof window & Record<string, unknown>
    const state = target[observerKey] as BrowserBoundarySnapshot | undefined
    if (!state) throw new Error('G010 browser observer is unavailable')
    return {
      activePortCount: state.createdPortCount - state.closedPortCount,
      bridge: bridge.getDiagnostics(),
      closedPortCount: state.closedPortCount,
      createdPortCount: state.createdPortCount,
      objectUrlCount: state.latestSandboxResources?.objectUrlCount ?? null,
      sandboxInstanceCount: state.latestSandboxResources?.instanceCount ?? null,
      sandboxListenerCount: state.latestSandboxResources?.listenerCount ?? null,
      sandboxPendingTaskCount: state.latestSandboxResources?.pendingTaskCount ?? null,
    }
  }, OBSERVER_KEY)
