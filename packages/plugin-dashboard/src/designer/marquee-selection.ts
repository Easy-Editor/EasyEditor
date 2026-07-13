import {
  type Designer,
  type Simulator,
  type Viewport,
  createEventBus,
  makeEventsHandler,
} from '@easy-editor/core/instance'

export interface MarqueeRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MarqueeEvent {
  startX: number
  startY: number
  currentX: number
  currentY: number
  rect: MarqueeRect
  isCtrlPressed: boolean
}

interface DocumentListenerRegistration {
  document: Document
  event: 'mousemove' | 'mouseup'
  listener: (event: MouseEvent) => void
}

interface MarqueeDisposeOptions {
  restoreDetecting?: boolean
}

const disposeMarqueeSelection = Symbol('disposeMarqueeSelection')
const marqueeOwnerDisposers = new WeakMap<MarqueeSelection, () => void>()

interface MarqueeRuntimeDisposer {
  [disposeMarqueeSelection](options?: MarqueeDisposeOptions): void
}

/** @internal Registers cache eviction for a runtime-owned helper. */
export const registerMarqueeSelectionOwner = (marquee: MarqueeSelection, onDisposed: () => void) => {
  marqueeOwnerDisposers.set(marquee, onDisposed)
}

/** @internal Engine teardown entry; public callers receive dispose() without policy controls. */
export const disposeMarqueeSelectionRuntime = (marquee: MarqueeSelection, restoreDetecting: boolean) => {
  const runtimeMarquee = marquee as unknown as MarqueeRuntimeDisposer
  runtimeMarquee[disposeMarqueeSelection]({ restoreDetecting })
}

const collectError = (errors: unknown[], error: unknown) => {
  if (error instanceof AggregateError) {
    for (const nestedError of error.errors) collectError(errors, nestedError)
  } else {
    errors.push(error)
  }
}

const throwCollectedErrors = (errors: unknown[], message: string) => {
  if (errors.length > 0) throw new AggregateError(errors, message)
}

/**
 * 框选引擎
 * 用于在画布空白区域拖拽框选多个组件
 */
export class MarqueeSelection {
  private emitter = createEventBus('MarqueeEngine')

  private isMarqueeSelecting = false

  private readonly bindingDisposers = new Set<(options?: MarqueeDisposeOptions) => void>()

  private disposeStarted = false

  private disposeCompleted = false

  private emitterDisposed = false

  enabled = true

  constructor(readonly designer: Designer) {}

  isSelecting() {
    return this.isMarqueeSelecting
  }

  /**
   * 绑定框选事件到指定元素
   * @param shell 画布容器元素
   * @param viewport 视口对象，用于坐标转换
   * @param isClickOnNode 检测点击是否在节点上的函数
   */
  from(shell: HTMLElement, viewport: Viewport, isClickOnNode: (target: Element) => boolean) {
    this.assertActive()
    if (!shell) return () => {}

    let startX = 0
    let startY = 0
    let isCtrlPressed = false
    let ownsActiveSelection = false
    let detectingRestorePending = false
    let previousDetectingState = true
    let shellListenerAttached = false
    let bindingDisposeStarted = false
    let bindingDisposed = false
    let documentListeners: DocumentListenerRegistration[] = []

    const masterSensors = this.getMasterSensors()

    const calculateRect = (x1: number, y1: number, x2: number, y2: number): MarqueeRect => ({
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    })

    const releaseActiveSelection = (restoreDetecting = true) => {
      const errors: unknown[] = []
      if (ownsActiveSelection) {
        ownsActiveSelection = false
        this.isMarqueeSelecting = false
      }
      if (!restoreDetecting) {
        detectingRestorePending = false
      } else if (detectingRestorePending) {
        try {
          this.designer.detecting.enable = previousDetectingState
          detectingRestorePending = false
        } catch (error) {
          collectError(errors, error)
        }
      }
      return errors
    }

    const clearDocumentListeners = () => {
      const errors: unknown[] = []
      const failedRegistrations: DocumentListenerRegistration[] = []

      for (const registration of documentListeners) {
        try {
          registration.document.removeEventListener(registration.event, registration.listener, true)
        } catch (error) {
          failedRegistrations.push(registration)
          collectError(errors, error)
        }
      }

      documentListeners = failedRegistrations
      throwCollectedErrors(errors, 'Failed to remove marquee document listeners')
    }

    const abortActiveSelection = (cause: unknown, message: string): never => {
      const errors: unknown[] = []
      collectError(errors, cause)
      errors.push(...releaseActiveSelection())
      try {
        clearDocumentListeners()
      } catch (error) {
        collectError(errors, error)
      }
      throw new AggregateError(errors, message)
    }

    const move = (e: MouseEvent) => {
      if (!ownsActiveSelection || this.disposeStarted || bindingDisposeStarted) return

      try {
        const localPoint = viewport.toLocalPoint(e)
        const currentX = localPoint.clientX
        const currentY = localPoint.clientY

        this.emitter.emit('marquee', {
          startX,
          startY,
          currentX,
          currentY,
          rect: calculateRect(startX, startY, currentX, currentY),
          isCtrlPressed: e.ctrlKey || e.metaKey,
        } as MarqueeEvent)
      } catch (error) {
        abortActiveSelection(error, 'Failed while updating marquee selection')
      }
    }

    const over = (e: MouseEvent) => {
      if (!ownsActiveSelection || this.disposeStarted || bindingDisposeStarted) return

      const errors: unknown[] = []
      errors.push(...releaseActiveSelection())

      try {
        clearDocumentListeners()
      } catch (error) {
        collectError(errors, error)
      }

      let localPoint: ReturnType<Viewport['toLocalPoint']> | undefined
      try {
        localPoint = viewport.toLocalPoint(e)
      } catch (error) {
        collectError(errors, error)
      }

      if (localPoint) {
        const currentX = localPoint.clientX
        const currentY = localPoint.clientY
        try {
          this.emitter.emit('marqueeEnd', {
            startX,
            startY,
            currentX,
            currentY,
            rect: calculateRect(startX, startY, currentX, currentY),
            isCtrlPressed: e.ctrlKey || e.metaKey,
          } as MarqueeEvent)
        } catch (error) {
          collectError(errors, error)
        }
      }

      throwCollectedErrors(errors, 'Failed while completing marquee selection')
    }

    const addDocumentListeners = (e: MouseEvent) => {
      const documents: Document[] = []
      makeEventsHandler(e, masterSensors)(document => documents.push(document))

      try {
        for (const document of documents) {
          document.addEventListener('mousemove', move, true)
          documentListeners.push({ document, event: 'mousemove', listener: move })
          document.addEventListener('mouseup', over, true)
          documentListeners.push({ document, event: 'mouseup', listener: over })
        }
      } catch (addError) {
        const errors: unknown[] = []
        collectError(errors, addError)
        try {
          clearDocumentListeners()
        } catch (cleanupError) {
          collectError(errors, cleanupError)
        }
        throw new AggregateError(errors, 'Failed to register marquee document listeners')
      }
    }

    const mousedown = (e: MouseEvent) => {
      if (this.disposeStarted || bindingDisposeStarted) return
      if (e.button !== 0 || !this.enabled || this.isMarqueeSelecting) return
      throwCollectedErrors(releaseActiveSelection(), 'Failed to restore detecting before marquee selection')

      const target = e.target as Element
      if (isClickOnNode(target)) return

      e.preventDefault()

      const localPoint = viewport.toLocalPoint(e)
      startX = localPoint.clientX
      startY = localPoint.clientY
      isCtrlPressed = e.ctrlKey || e.metaKey

      if (documentListeners.length > 0) clearDocumentListeners()
      try {
        previousDetectingState = this.designer.detecting.enable
      } catch (error) {
        abortActiveSelection(error, 'Failed while reading detecting state')
      }
      addDocumentListeners(e)

      ownsActiveSelection = true
      detectingRestorePending = true
      this.isMarqueeSelecting = true
      try {
        this.designer.detecting.enable = false
      } catch (error) {
        abortActiveSelection(error, 'Failed while activating marquee selection')
      }

      try {
        this.emitter.emit('marqueeStart', {
          startX,
          startY,
          currentX: startX,
          currentY: startY,
          rect: { x: startX, y: startY, width: 0, height: 0 },
          isCtrlPressed,
        } as MarqueeEvent)
      } catch (error) {
        abortActiveSelection(error, 'Failed while starting marquee selection')
      }
    }

    const disposeBinding = (options: MarqueeDisposeOptions = {}) => {
      if (bindingDisposed) return

      const { restoreDetecting = true } = options
      bindingDisposeStarted = true
      const errors: unknown[] = []

      if (shellListenerAttached) {
        try {
          shell.removeEventListener('mousedown', mousedown)
          shellListenerAttached = false
        } catch (error) {
          collectError(errors, error)
        }
      }

      errors.push(...releaseActiveSelection(restoreDetecting))
      try {
        clearDocumentListeners()
      } catch (error) {
        collectError(errors, error)
      }

      if (!shellListenerAttached && documentListeners.length === 0 && !detectingRestorePending) {
        bindingDisposed = true
        this.bindingDisposers.delete(disposeBinding)
      }

      throwCollectedErrors(errors, 'Failed to dispose marquee binding')
    }

    shell.addEventListener('mousedown', mousedown)
    shellListenerAttached = true
    this.bindingDisposers.add(disposeBinding)
    return () => disposeBinding()
  }

  onMarqueeStart(func: (evt: MarqueeEvent) => void) {
    this.assertActive()
    return this.emitter.on('marqueeStart', func)
  }

  onMarquee(func: (evt: MarqueeEvent) => void) {
    this.assertActive()
    return this.emitter.on('marquee', func)
  }

  onMarqueeEnd(func: (evt: MarqueeEvent) => void) {
    this.assertActive()
    return this.emitter.on('marqueeEnd', func)
  }

  /** Releases a standalone helper or evicts a runtime-owned helper from its cache. */
  dispose() {
    this[disposeMarqueeSelection]()
  }

  private [disposeMarqueeSelection](options: MarqueeDisposeOptions = {}) {
    if (this.disposeCompleted) return

    this.disposeStarted = true
    const errors: unknown[] = []

    for (const disposeBinding of [...this.bindingDisposers]) {
      try {
        disposeBinding(options)
      } catch (error) {
        collectError(errors, error)
      }
    }

    if (!this.emitterDisposed) {
      try {
        this.emitter.dispose()
        this.emitterDisposed = true
      } catch (error) {
        collectError(errors, error)
      }
    }

    if (errors.length === 0 && this.bindingDisposers.size === 0 && this.emitterDisposed) {
      const releaseOwner = marqueeOwnerDisposers.get(this)
      if (releaseOwner) {
        try {
          releaseOwner()
          marqueeOwnerDisposers.delete(this)
        } catch (error) {
          throw new AggregateError([error], 'Failed to release marquee selection ownership')
        }
      }
      this.disposeCompleted = true
      return
    }

    throw new AggregateError(errors, 'Failed to dispose marquee selection')
  }

  private assertActive() {
    if (this.disposeStarted) throw new Error('MarqueeSelection has been disposed')
  }

  private getMasterSensors(): Simulator[] {
    return this.designer.project.documents
      .map(doc => {
        if (doc.opened && doc.simulator?.sensorAvailable) return doc.simulator
        return null
      })
      .filter(Boolean) as Simulator[]
  }
}
