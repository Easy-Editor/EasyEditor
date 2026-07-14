import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import { sealLifecycleMutations } from '../lifecycle/mutation-barrier'
import { lockPrototypeAccessors, lockReadonlyProperties } from '../lifecycle/readonly-properties'
import { installLifecycleTeardownOperation } from '../lifecycle/teardown-boundary'
import { isElementNode } from '../utils'

export interface Scrollable {
  scrollTarget?: ScrollTarget | Element
  bounds?: DOMRect | null
  scale?: number
}

export class ScrollTarget {
  get left() {
    return 'scrollX' in this.target ? this.target.scrollX : this.target.scrollLeft
  }

  get top() {
    return 'scrollY' in this.target ? this.target.scrollY : this.target.scrollTop
  }

  private doc?: HTMLElement

  constructor(private target: Window | Element) {
    if (isWindow(target)) {
      this.doc = target.document.documentElement
    }
    lockReadonlyProperties(this, ['doc', 'target'])
  }

  scrollTo(options: { left?: number; top?: number }) {
    this.target.scrollTo(options)
  }

  scrollToXY(x: number, y: number) {
    this.target.scrollTo(x, y)
  }

  get scrollHeight(): number {
    return ((this.doc || this.target) as any).scrollHeight
  }

  get scrollWidth(): number {
    return ((this.doc || this.target) as any).scrollWidth
  }
}

const isWindow = (obj: any): obj is Window => {
  return obj && obj.document
}

const easing = (n: number) => {
  return Math.sin((n * Math.PI) / 2)
}

const SCROLL_ACCURACY = 30

export class Scroller {
  private pid: number | undefined

  private animationEpoch = 0

  private lifecycleState: 'active' | 'disposing' | 'disposed' = 'active'

  scrollable: Scrollable

  constructor(scrollable: Scrollable) {
    this.scrollable = scrollable
    lockReadonlyProperties(this, ['scrollable'])
    lockPrototypeAccessors(this, ['scrollTarget'])
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
  }

  get scrollTarget(): ScrollTarget | null {
    this.#assertActive('scroller.scrollTarget')
    let target = this.scrollable.scrollTarget
    if (!target) {
      return null
    }
    if (isElementNode(target)) {
      target = new ScrollTarget(target)
      this.scrollable.scrollTarget = target
    }
    return target
  }

  scrollTo(options: { left?: number; top?: number }) {
    this.#assertActive('scroller.scrollTo')
    this.cancel()

    const { scrollTarget } = this
    if (!scrollTarget) {
      return
    }

    let pid: number
    const { left } = scrollTarget
    const { top } = scrollTarget
    const end = () => {
      this.cancel()
    }

    if ((left === options.left || options.left == null) && top === options.top) {
      end()
      return
    }

    const duration = 200
    const start = +new Date()
    const animationEpoch = this.animationEpoch

    const animate = () => {
      if (this.lifecycleState !== 'active' || animationEpoch !== this.animationEpoch || pid !== this.pid) {
        return
      }

      const now = +new Date()
      const time = Math.min(1, (now - start) / duration)
      const eased = easing(time)
      const opt: any = {}
      if (options.left != null) {
        opt.left = eased * (options.left - left) + left
      }
      if (options.top != null) {
        opt.top = eased * (options.top - top) + top
      }

      scrollTarget.scrollTo(opt)

      if (time < 1) {
        this.pid = requestAnimationFrame(animate)
        pid = this.pid
      } else {
        end()
      }
    }

    this.pid = requestAnimationFrame(animate)
    pid = this.pid
  }

  scrolling(point: { globalX: number; globalY: number }) {
    this.#assertActive('scroller.scrolling')
    this.cancel()

    const { bounds, scale = 1 } = this.scrollable
    const { scrollTarget } = this
    if (!scrollTarget || !bounds) {
      return
    }

    const x = point.globalX
    const y = point.globalY

    const maxScrollHeight = scrollTarget.scrollHeight - bounds.height / scale
    const maxScrollWidth = scrollTarget.scrollWidth - bounds.width / scale
    let sx = scrollTarget.left
    let sy = scrollTarget.top
    let ax = 0
    let ay = 0
    const animationEpoch = this.animationEpoch
    if (y < bounds.top + SCROLL_ACCURACY) {
      ay = -Math.min(Math.max(bounds.top + SCROLL_ACCURACY - y, 10), 50) / scale
    } else if (y > bounds.bottom - SCROLL_ACCURACY) {
      ay = Math.min(Math.max(y + SCROLL_ACCURACY - bounds.bottom, 10), 50) / scale
    }
    if (x < bounds.left + SCROLL_ACCURACY) {
      ax = -Math.min(Math.max(bounds.top + SCROLL_ACCURACY - y, 10), 50) / scale
    } else if (x > bounds.right - SCROLL_ACCURACY) {
      ax = Math.min(Math.max(x + SCROLL_ACCURACY - bounds.right, 10), 50) / scale
    }

    if (!ax && !ay) {
      return
    }

    const animate = () => {
      if (this.lifecycleState !== 'active' || animationEpoch !== this.animationEpoch) {
        return
      }
      let scroll = false
      if ((ay > 0 && sy < maxScrollHeight) || (ay < 0 && sy > 0)) {
        sy += ay
        sy = Math.min(Math.max(sy, 0), maxScrollHeight)
        scroll = true
      }
      if ((ax > 0 && sx < maxScrollWidth) || (ax < 0 && sx > 0)) {
        sx += ax
        sx = Math.min(Math.max(sx, 0), maxScrollWidth)
        scroll = true
      }
      if (!scroll) {
        return
      }

      scrollTarget.scrollTo({ left: sx, top: sy })
      this.pid = requestAnimationFrame(animate)
    }

    animate()
  }

  cancel() {
    this.#assertActive('scroller.cancel')
    this.#cancelInternal()
  }

  #assertActive(origin: string): void {
    assertLifecycleMutationAllowed(this, origin)
    if (this.lifecycleState !== 'active') {
      throw new Error(`Cannot ${origin}; scroller generation is ${this.lifecycleState}`)
    }
  }

  #cancelInternal(): void {
    this.animationEpoch += 1
    const pid = this.pid
    if (pid === undefined) return
    cancelAnimationFrame(pid)
    if (this.pid === pid) this.pid = undefined
  }

  #disposeInternal(): void {
    if (this.lifecycleState === 'disposed') return
    this.lifecycleState = 'disposing'
    this.#cancelInternal()
    this.lifecycleState = 'disposed'
    sealLifecycleMutations(this, 'scroller generation is disposed')
  }
}
