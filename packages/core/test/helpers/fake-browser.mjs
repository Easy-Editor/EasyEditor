class FakeEventTarget {
  #listeners = new Map()

  addCount = 0

  removeCount = 0

  addEventListener(type, listener) {
    let listeners = this.#listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.#listeners.set(type, listeners)
    }
    if (!listeners.has(listener)) {
      listeners.add(listener)
      this.addCount += 1
    }
  }

  removeEventListener(type, listener) {
    const listeners = this.#listeners.get(type)
    if (listeners?.delete(listener)) {
      this.removeCount += 1
    }
  }

  dispatchEvent(event) {
    for (const listener of this.#listeners.get(event.type) || []) {
      listener.call(this, event)
    }
    return true
  }

  listenerCount(type) {
    if (type) {
      return this.#listeners.get(type)?.size || 0
    }
    let count = 0
    for (const listeners of this.#listeners.values()) {
      count += listeners.size
    }
    return count
  }
}

class FakeElement extends FakeEventTarget {
  children = []

  ownerDocument

  parentNode = null

  style = { cssText: '' }

  value = ''

  constructor(ownerDocument) {
    super()
    this.ownerDocument = ownerDocument
  }

  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
      child.parentNode = null
    }
    return child
  }

  remove() {
    this.parentNode?.removeChild(this)
  }

  blur() {}

  focus() {}

  select() {}

  setAttribute() {}
}

class FakeDocument extends FakeEventTarget {
  body

  documentElement

  defaultView

  constructor() {
    super()
    this.body = new FakeElement(this)
    this.documentElement = new FakeElement(this)
  }

  createElement() {
    return new FakeElement(this)
  }

  removeChild(child) {
    return child.parentNode?.removeChild(child)
  }
}

export function createFakeWindow() {
  const windowTarget = new FakeEventTarget()
  const document = new FakeDocument()
  const window = Object.assign(windowTarget, {
    document,
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    requestAnimationFrame(callback) {
      return setTimeout(callback, 0)
    },
    cancelAnimationFrame(handle) {
      clearTimeout(handle)
    },
  })
  window.window = window
  document.defaultView = window
  return window
}

export function installLegacyBrowserGlobals(window = createFakeWindow()) {
  Object.defineProperties(globalThis, {
    location: {
      configurable: true,
      value: { href: 'http://localhost/' },
      writable: true,
    },
    window: { configurable: true, value: window, writable: true },
    document: { configurable: true, value: window.document, writable: true },
    navigator: { configurable: true, value: window.navigator, writable: true },
  })
  return window
}
