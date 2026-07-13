function getDataFromPasteEvent(event: ClipboardEvent) {
  const { clipboardData } = event
  if (!clipboardData) {
    return null
  }

  const data = JSON.parse(clipboardData.getData('text/plain'))
  if (!data) {
    return {}
  }

  if (data.componentsTree) {
    return data
  }

  if (data.componentName) {
    return {
      componentsTree: [data],
    }
  }
}

export class Clipboard {
  private copyPasters: HTMLTextAreaElement[] = []

  private injectedDocuments = new Map<Document, () => void>()

  private waitFn?: (data: any, e: ClipboardEvent) => void

  isCopyPasteEvent(e: Event) {
    return this.isCopyPaster(e.target)
  }

  private isCopyPaster(el: any) {
    return this.copyPasters.includes(el)
  }

  initCopyPaster(el: HTMLTextAreaElement) {
    this.copyPasters.push(el)

    const onPaste = (e: ClipboardEvent) => {
      if (this.waitFn) {
        this.waitFn(getDataFromPasteEvent(e), e)
        this.waitFn = undefined
      }
      el.blur()
    }

    el.addEventListener('paste', onPaste, false)

    return () => {
      el.removeEventListener('paste', onPaste, false)

      const i = this.copyPasters.indexOf(el)
      if (i > -1) {
        this.copyPasters.splice(i, 1)
      }
    }
  }

  injectCopyPaster(document: Document): () => void {
    const existingDispose = this.injectedDocuments.get(document)
    if (existingDispose) {
      return existingDispose
    }

    const copyPaster = document.createElement<'textarea'>('textarea')
    copyPaster.style.cssText = 'position: absolute;left: -9999px;top:-100px'

    const append = () => {
      if (document.body && !copyPaster.parentNode) {
        document.body.appendChild(copyPaster)
      }
    }

    let removeReadyListener: (() => void) | undefined
    if (document.body) {
      append()
    } else {
      const onReady = () => append()
      document.addEventListener('DOMContentLoaded', onReady)
      removeReadyListener = () => document.removeEventListener('DOMContentLoaded', onReady)
    }

    const disposeCopyPaster = this.initCopyPaster(copyPaster)

    let disposed = false
    const dispose = () => {
      if (disposed) {
        return
      }
      disposed = true
      removeReadyListener?.()
      disposeCopyPaster()
      copyPaster.remove()
      this.injectedDocuments.delete(document)
    }
    this.injectedDocuments.set(document, dispose)
    return dispose
  }

  async setData(data: any): Promise<void> {
    const copyPaster = this.copyPasters.find(x => x.ownerDocument)
    if (!copyPaster) {
      return
    }

    copyPaster.value = typeof data === 'string' ? data : JSON.stringify(data)
    copyPaster.select()
    await copyPaster.ownerDocument.defaultView?.navigator.clipboard?.writeText(copyPaster.value)

    copyPaster.blur()
  }

  waitPasteData(keyboardEvent: KeyboardEvent, cb: (data: any, e: ClipboardEvent) => void) {
    const win = keyboardEvent.view
    if (!win) {
      return
    }
    const copyPaster = this.copyPasters.find(cp => cp.ownerDocument === win.document)
    if (copyPaster) {
      copyPaster.select()
      this.waitFn = cb
    }
  }

  dispose(): void {
    for (const dispose of [...this.injectedDocuments.values()]) {
      dispose()
    }
    this.injectedDocuments.clear()
    this.copyPasters = []
    this.waitFn = undefined
  }
}

export const clipboard = new Clipboard()
