import { DisposalLedger, type Disposer } from '../lifecycle/disposal-ledger'
import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import { assertPublicLifecycleTeardownAllowed, installLifecycleTeardownOperation } from '../lifecycle/teardown-boundary'

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

  private injectedDocuments = new Map<Document, { dispose: Disposer; ready: boolean }>()

  private listenerDisposals = new DisposalLedger()

  private waitFn?: (data: any, e: ClipboardEvent) => void

  constructor() {
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
  }

  isCopyPasteEvent(e: Event) {
    return this.isCopyPaster(e.target)
  }

  private isCopyPaster(el: any) {
    return this.copyPasters.includes(el)
  }

  initCopyPaster(el: HTMLTextAreaElement): Disposer {
    assertLifecycleMutationAllowed(this, 'clipboard.initCopyPaster')
    const listenerDisposals = this.#getListenerDisposals()

    const onPaste = (e: ClipboardEvent) => {
      if (this.waitFn) {
        this.waitFn(getDataFromPasteEvent(e), e)
        this.waitFn = undefined
      }
      el.blur()
    }

    let listenerRegistered = false
    const dispose = listenerDisposals.add(() => {
      if (listenerRegistered) {
        el.removeEventListener('paste', onPaste, false)
        listenerRegistered = false
      }

      const i = this.copyPasters.indexOf(el)
      if (i > -1) {
        this.copyPasters.splice(i, 1)
      }
    }, 'clipboard.paste')
    try {
      listenerRegistered = true
      el.addEventListener('paste', onPaste, false)
      this.copyPasters.push(el)
      return dispose
    } catch (error) {
      void Promise.resolve(dispose()).catch(() => undefined)
      throw error
    }
  }

  injectCopyPaster(document: Document): Disposer {
    assertLifecycleMutationAllowed(this, 'clipboard.injectCopyPaster')
    const existing = this.injectedDocuments.get(document)
    if (existing) {
      if (!existing.ready) throw new Error('Clipboard injection cleanup is still pending for this document')
      return existing.dispose
    }

    const listenerDisposals = this.#getListenerDisposals()
    const copyPaster = document.createElement<'textarea'>('textarea')
    copyPaster.style.cssText = 'position: absolute;left: -9999px;top:-100px'

    const append = () => {
      if (document.body && !copyPaster.parentNode) {
        document.body.appendChild(copyPaster)
      }
    }

    let removeReadyListener: Disposer | undefined
    let disposeCopyPaster: Disposer | undefined
    let dispose!: Disposer
    const registration: { dispose: Disposer; ready: boolean } = {
      dispose: () => undefined,
      ready: false,
    }
    dispose = listenerDisposals.add(async () => {
      const failures: unknown[] = []
      try {
        copyPaster.remove()
      } catch (error) {
        failures.push(error)
      }
      for (const release of [removeReadyListener, disposeCopyPaster]) {
        if (!release) continue
        try {
          await release()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Clipboard injection disposal failed')
      }
      if (this.injectedDocuments.get(document) === registration) this.injectedDocuments.delete(document)
    }, 'clipboard.injection')
    registration.dispose = dispose
    // Publish provisional ownership before DOM or listener acquisition. A
    // partially initialized injection is therefore still reachable by the
    // engine disposal retry path.
    this.injectedDocuments.set(document, registration)

    try {
      if (document.body) {
        append()
      } else {
        const onReady = () => {
          try {
            append()
          } finally {
            void Promise.resolve(removeReadyListener?.()).catch(() => undefined)
          }
        }
        let listenerRegistered = false
        removeReadyListener = listenerDisposals.add(() => {
          if (!listenerRegistered) return
          document.removeEventListener('DOMContentLoaded', onReady)
          listenerRegistered = false
        }, 'clipboard.DOMContentLoaded')
        try {
          listenerRegistered = true
          document.addEventListener('DOMContentLoaded', onReady)
        } catch (error) {
          void Promise.resolve(removeReadyListener()).catch(() => undefined)
          throw error
        }
      }

      disposeCopyPaster = this.initCopyPaster(copyPaster)
      registration.ready = true
      return dispose
    } catch (error) {
      const rollbackErrors: unknown[] = []
      try {
        copyPaster.remove()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      // Mark the provisional ledger entry complete when cleanup succeeds, or
      // retain it automatically when any cleanup step still fails.
      void Promise.resolve(dispose()).catch(() => undefined)
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], 'Clipboard injection acquisition rollback failed')
      }
      throw error
    }
  }

  async setData(data: any): Promise<void> {
    assertLifecycleMutationAllowed(this, 'clipboard.setData')
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
    assertLifecycleMutationAllowed(this, 'clipboard.waitPasteData')
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

  dispose(): Promise<void> {
    assertPublicLifecycleTeardownAllowed(this, 'clipboard.dispose')
    return this.#disposeInternal()
  }

  async #disposeInternal(): Promise<void> {
    this.waitFn = undefined
    await this.listenerDisposals.dispose()
    this.injectedDocuments.clear()
    this.copyPasters = []
  }

  #getListenerDisposals(): DisposalLedger {
    if (this.listenerDisposals.isDisposed) this.listenerDisposals = new DisposalLedger()
    return this.listenerDisposals
  }
}
