import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeWindow } from './helpers/fake-browser.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

const dispatchCtrlA = document => {
  document.dispatchEvent({
    altKey: false,
    ctrlKey: true,
    keyCode: 65,
    metaKey: false,
    preventDefault() {},
    shiftKey: false,
    stopPropagation() {},
    type: 'keydown',
    which: 65,
  })
}

test('Hotkey exposes frozen detached callback snapshots that cannot revive a restarted engine', async t => {
  const core = await loadCore()
  const hostWindow = createFakeWindow()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow })
  t.after(async () => engine.destroy())
  await engine.init()

  let staleCalls = 0
  const staleCallback = () => {
    staleCalls += 1
  }
  engine.hotkey.bind('ctrl+a', staleCallback)
  const retainedSnapshot = engine.hotkey.callBacks

  assert.equal(engine.hotkey.callBacksInternal, undefined)
  assert.equal(Object.isFrozen(retainedSnapshot), true)
  assert.equal(Object.isFrozen(retainedSnapshot.a), true)
  assert.equal(Object.isFrozen(retainedSnapshot.a[0]), true)
  assert.equal(Object.isFrozen(retainedSnapshot.a[0].modifiers), true)
  assert.throws(() => retainedSnapshot.a.push(retainedSnapshot.a[0]), TypeError)
  assert.throws(() => {
    retainedSnapshot.a[0].callback = () => undefined
  }, TypeError)

  await engine.destroy()
  assert.throws(() => engine.hotkey.bind('ctrl+a', staleCallback), /disposed/)
  assert.throws(() => engine.hotkey.unbind('ctrl+a', staleCallback), /disposed/)

  await engine.init()
  let currentCalls = 0
  const currentCallback = () => {
    currentCalls += 1
  }
  engine.hotkey.bind('ctrl+a', currentCallback)
  assert.notStrictEqual(engine.hotkey.callBacks, retainedSnapshot)
  assert.throws(() => {
    retainedSnapshot.a[0].callback = currentCallback
  }, TypeError)

  dispatchCtrlA(hostWindow.document)
  assert.deepEqual({ currentCalls, staleCalls }, { currentCalls: 1, staleCalls: 0 })
})

test('Hotkey disposal retries only failed listener removals across engine destroy attempts', async t => {
  const core = await loadCore()
  const hostWindow = createFakeWindow()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow })
  let failKeypressRemoval = true
  t.after(async () => {
    failKeypressRemoval = false
    if (engine.lifecycleState !== 'disposed') await engine.destroy()
  })
  await engine.init()

  const { document } = hostWindow
  const secondWindow = createFakeWindow()
  engine.hotkey.mount(secondWindow)
  assert.deepEqual(
    Object.fromEntries(['keypress', 'keydown', 'keyup'].map(type => [type, document.listenerCount(type)])),
    { keydown: 1, keypress: 1, keyup: 1 },
  )

  const removalAttempts = { keydown: 0, keypress: 0, keyup: 0 }
  const removeEventListener = document.removeEventListener.bind(document)
  document.removeEventListener = (type, listener, options) => {
    if (type in removalAttempts) removalAttempts[type] += 1
    if (type === 'keypress' && failKeypressRemoval) throw new Error('keypress listener removal failed')
    return removeEventListener(type, listener, options)
  }

  await assert.rejects(engine.destroy(), /Engine disposal completed with errors/)
  assert.equal(engine.lifecycleState, 'failed')
  assert.deepEqual(
    Object.fromEntries(['keypress', 'keydown', 'keyup'].map(type => [type, document.listenerCount(type)])),
    { keydown: 0, keypress: 1, keyup: 0 },
  )
  assert.equal(removalAttempts.keydown, 1)
  assert.equal(removalAttempts.keyup, 1)
  assert.equal(secondWindow.document.listenerCount(), 0, 'one failed document must not block later mounted documents')

  failKeypressRemoval = false
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.deepEqual(
    Object.fromEntries(['keypress', 'keydown', 'keyup'].map(type => [type, document.listenerCount(type)])),
    { keydown: 0, keypress: 0, keyup: 0 },
  )
  assert.equal(removalAttempts.keydown, 1, 'a successfully removed keydown listener must not be removed twice')
  assert.equal(removalAttempts.keyup, 1, 'a successfully removed keyup listener must not be removed twice')
  assert.equal(document.addCount, document.removeCount)
  assert.equal(secondWindow.document.addCount, secondWindow.document.removeCount)
})

test('Hotkey retains partially acquired listeners when mount rollback fails', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  let failKeydownAcquisition = true
  let failKeypressRollback = true
  t.after(async () => {
    failKeydownAcquisition = false
    failKeypressRollback = false
    if (engine.lifecycleState !== 'disposed') await engine.destroy()
  })
  await engine.init()

  const hostWindow = createFakeWindow()
  const { document } = hostWindow
  const addEventListener = document.addEventListener.bind(document)
  const removeEventListener = document.removeEventListener.bind(document)
  document.addEventListener = (type, listener, options) => {
    if (type === 'keydown' && failKeydownAcquisition) throw new Error('keydown listener acquisition failed')
    return addEventListener(type, listener, options)
  }
  document.removeEventListener = (type, listener, options) => {
    if (type === 'keypress' && failKeypressRollback) throw new Error('keypress acquisition rollback failed')
    return removeEventListener(type, listener, options)
  }

  const error = await captureFailure(() => engine.hotkey.mount(hostWindow))
  assert.equal(error.name, 'AggregateError')
  assert.ok(error.errors.some(cause => /keydown listener acquisition failed/.test(cause?.message)))
  assert.ok(error.errors.some(cause => /keypress acquisition rollback failed/.test(cause?.message)))
  assert.equal(document.listenerCount('keypress'), 1)
  assert.equal(document.listenerCount('keydown'), 0)
  assert.equal(document.listenerCount('keyup'), 0)

  failKeydownAcquisition = false
  failKeypressRollback = false
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(document.listenerCount(), 0)
  assert.equal(document.addCount, document.removeCount)
})

test('engine init cannot report ready with an incomplete Hotkey mount', async t => {
  const core = await loadCore()
  const hostWindow = createFakeWindow()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow })
  let failKeydownAcquisition = true
  let failKeypressRollback = true
  t.after(async () => {
    failKeydownAcquisition = false
    failKeypressRollback = false
    if (engine.lifecycleState !== 'disposed') await engine.destroy()
  })

  const { document } = hostWindow
  const addEventListener = document.addEventListener.bind(document)
  const removeEventListener = document.removeEventListener.bind(document)
  document.addEventListener = (type, listener, options) => {
    if (type === 'keydown' && failKeydownAcquisition) throw new Error('init keydown acquisition failed')
    return addEventListener(type, listener, options)
  }
  document.removeEventListener = (type, listener, options) => {
    if (type === 'keypress' && failKeypressRollback) throw new Error('init keypress rollback failed')
    return removeEventListener(type, listener, options)
  }

  await assert.rejects(engine.init(), /Engine initialization and rollback both failed/)
  assert.equal(engine.lifecycleState, 'failed')
  assert.deepEqual(
    Object.fromEntries(['keypress', 'keydown', 'keyup'].map(type => [type, document.listenerCount(type)])),
    { keydown: 0, keypress: 1, keyup: 0 },
  )

  failKeydownAcquisition = false
  failKeypressRollback = false
  await assert.rejects(engine.init(), /failed generation must be destroyed before it can restart/)
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(document.listenerCount(), 0)

  await engine.init()
  assert.equal(engine.lifecycleState, 'ready')
  assert.deepEqual(
    Object.fromEntries(['keypress', 'keydown', 'keyup'].map(type => [type, document.listenerCount(type)])),
    { keydown: 1, keypress: 1, keyup: 1 },
  )

  await engine.destroy()
  assert.equal(document.listenerCount(), 0)
  assert.equal(document.addCount, document.removeCount)
})

test('Clipboard reuses one injection and centrally releases paste and readiness listeners', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()

  const hostWindow = createFakeWindow()
  const { document } = hostWindow
  const body = document.body
  document.body = null

  const firstRelease = engine.clipboard.injectCopyPaster(document)
  const secondRelease = engine.clipboard.injectCopyPaster(document)
  assert.strictEqual(secondRelease, firstRelease)
  assert.equal(document.listenerCount('DOMContentLoaded'), 1)

  document.body = body
  document.dispatchEvent({ type: 'DOMContentLoaded' })
  await Promise.resolve()
  const copyPaster = document.body.children[0]
  assert.equal(document.listenerCount('DOMContentLoaded'), 0)
  assert.equal(copyPaster.listenerCount('paste'), 1)
  assert.equal(document.body.children.length, 1)

  await engine.destroy()
  assert.equal(document.listenerCount('DOMContentLoaded'), 0)
  assert.equal(copyPaster.listenerCount('paste'), 0)
  assert.equal(document.body.children.length, 0)
  assert.equal(document.addCount, document.removeCount)
  assert.equal(copyPaster.addCount, copyPaster.removeCount)
})

test('Clipboard centrally owns direct copy-paster registrations across restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()

  const firstWindow = createFakeWindow()
  const firstCopyPaster = firstWindow.document.createElement('textarea')
  engine.clipboard.initCopyPaster(firstCopyPaster)
  assert.equal(firstCopyPaster.listenerCount('paste'), 1)

  await engine.destroy()
  assert.equal(firstCopyPaster.listenerCount('paste'), 0)
  assert.equal(firstCopyPaster.addCount, firstCopyPaster.removeCount)

  await engine.init()
  const secondWindow = createFakeWindow()
  const secondCopyPaster = secondWindow.document.createElement('textarea')
  engine.clipboard.initCopyPaster(secondCopyPaster)
  assert.equal(secondCopyPaster.listenerCount('paste'), 1)

  await engine.destroy()
  assert.equal(secondCopyPaster.listenerCount('paste'), 0)
  assert.equal(secondCopyPaster.addCount, secondCopyPaster.removeCount)
})

test('Clipboard retains an appended copy-paster when acquisition rollback fails', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  let failPasteAcquisition = true
  let failDomRollback = true
  t.after(async () => {
    failPasteAcquisition = false
    failDomRollback = false
    if (engine.lifecycleState !== 'disposed') await engine.destroy()
  })
  await engine.init()

  const hostWindow = createFakeWindow()
  const { document } = hostWindow
  const createElement = document.createElement.bind(document)
  let copyPaster
  document.createElement = (...args) => {
    copyPaster = createElement(...args)
    const addEventListener = copyPaster.addEventListener.bind(copyPaster)
    const remove = copyPaster.remove.bind(copyPaster)
    copyPaster.addEventListener = (type, listener, options) => {
      if (type === 'paste' && failPasteAcquisition) throw new Error('paste listener acquisition failed')
      return addEventListener(type, listener, options)
    }
    copyPaster.remove = () => {
      if (failDomRollback) throw new Error('copy-paster DOM rollback failed')
      return remove()
    }
    return copyPaster
  }

  const error = await captureFailure(() => engine.clipboard.injectCopyPaster(document))
  assert.equal(error.name, 'AggregateError')
  assert.ok(error.errors.some(cause => /paste listener acquisition failed/.test(cause?.message)))
  assert.ok(error.errors.some(cause => /copy-paster DOM rollback failed/.test(cause?.message)))
  assert.equal(document.body.children.length, 1)
  assert.equal(copyPaster.listenerCount('paste'), 0)

  failPasteAcquisition = false
  failDomRollback = false
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(document.body.children.length, 0)
  assert.equal(copyPaster.listenerCount(), 0)
})

test('Clipboard disposal retains failed listener cleanup for a later destroy retry', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => {
    if (engine.lifecycleState !== 'disposed') await engine.destroy()
  })
  await engine.init()

  const hostWindow = createFakeWindow()
  const { document } = hostWindow
  engine.clipboard.injectCopyPaster(document)
  const copyPaster = document.body.children[0]
  const removeEventListener = copyPaster.removeEventListener.bind(copyPaster)
  let failPasteRemoval = true
  copyPaster.removeEventListener = (type, listener, options) => {
    if (type === 'paste' && failPasteRemoval) throw new Error('paste listener removal failed')
    return removeEventListener(type, listener, options)
  }

  await assert.rejects(engine.destroy(), /Engine disposal completed with errors/)
  assert.equal(engine.lifecycleState, 'failed')
  assert.equal(copyPaster.listenerCount('paste'), 1)

  failPasteRemoval = false
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(copyPaster.listenerCount('paste'), 0)
  assert.equal(document.body.children.length, 0)
  assert.equal(copyPaster.addCount, copyPaster.removeCount)
})
