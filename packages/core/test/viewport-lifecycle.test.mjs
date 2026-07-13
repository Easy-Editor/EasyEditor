import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeWindow } from './helpers/fake-browser.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

const captureSyncFailure = operation => {
  try {
    operation()
  } catch (error) {
    return error
  }
  assert.fail('expected operation to fail')
}

test('Viewport listener cleanup remains retryable through Simulator teardown', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  let failScrollRemoval = true
  t.after(async () => {
    failScrollRemoval = false
    if (engine.lifecycleState !== 'disposed') await engine.destroy()
  })
  await engine.init()

  const simulator = new core.Simulator(engine.project, engine.designer)
  engine.project.mountSimulator(simulator)
  const frameWindow = createFakeWindow()
  await simulator.mountContentFrame(frameWindow.document.createElement('div'))

  assert.deepEqual(Object.fromEntries(['scroll', 'resize'].map(type => [type, frameWindow.listenerCount(type)])), {
    resize: 1,
    scroll: 1,
  })

  const removalAttempts = { resize: 0, scroll: 0 }
  const removeEventListener = frameWindow.removeEventListener.bind(frameWindow)
  frameWindow.removeEventListener = (type, listener, options) => {
    if (type in removalAttempts) removalAttempts[type] += 1
    if (type === 'scroll' && failScrollRemoval) throw new Error('scroll listener removal failed')
    return removeEventListener(type, listener, options)
  }

  await assert.rejects(engine.destroy(), /Engine disposal completed with errors/)
  assert.equal(engine.lifecycleState, 'failed')
  assert.strictEqual(engine.project.simulator, simulator)
  assert.deepEqual(Object.fromEntries(['scroll', 'resize'].map(type => [type, frameWindow.listenerCount(type)])), {
    resize: 0,
    scroll: 1,
  })
  assert.equal(removalAttempts.resize, 1)
  assert.ok(removalAttempts.scroll >= 1)
  assert.ok(simulator.viewport.scrollTarget, 'scroll target state must remain until every listener is removed')

  const failedScrollAttempts = removalAttempts.scroll
  failScrollRemoval = false
  await engine.destroy()

  assert.equal(engine.lifecycleState, 'disposed')
  assert.deepEqual(Object.fromEntries(['scroll', 'resize'].map(type => [type, frameWindow.listenerCount(type)])), {
    resize: 0,
    scroll: 0,
  })
  assert.equal(removalAttempts.scroll, failedScrollAttempts + 1)
  assert.equal(removalAttempts.resize, 1, 'a successfully removed resize listener must not be removed twice')
  assert.equal(frameWindow.addCount, frameWindow.removeCount)
  assert.equal(simulator.viewport.scrollTarget, undefined)
})

test('Viewport setup rolls back acquired listeners and retains incomplete rollback for retry', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  const viewport = new core.Viewport(engine.designer)
  let failScrollRollback = true
  t.after(async () => {
    failScrollRollback = false
    viewport.dispose()
    await engine.destroy()
  })

  const incompleteTarget = createFakeWindow()
  const addIncompleteListener = incompleteTarget.addEventListener.bind(incompleteTarget)
  incompleteTarget.addEventListener = (type, listener, options) => {
    if (type === 'resize') throw new Error('resize listener registration failed')
    return addIncompleteListener(type, listener, options)
  }
  const incompleteRemovalAttempts = { resize: 0, scroll: 0 }
  const removeIncompleteListener = incompleteTarget.removeEventListener.bind(incompleteTarget)
  incompleteTarget.removeEventListener = (type, listener, options) => {
    if (type in incompleteRemovalAttempts) incompleteRemovalAttempts[type] += 1
    if (type === 'scroll' && failScrollRollback) throw new Error('scroll listener rollback failed')
    return removeIncompleteListener(type, listener, options)
  }

  const incompleteRollback = captureSyncFailure(() => viewport.setScrollTarget(incompleteTarget))
  assert.equal(incompleteRollback.name, 'AggregateError')
  assert.match(incompleteRollback.message, /rollback was incomplete/)
  assert.equal(incompleteRollback.errors.length, 2)
  assert.match(incompleteRollback.errors[0].message, /resize listener registration failed/)
  assert.match(incompleteRollback.errors[1].message, /scroll target disposal failed/)
  assert.equal(incompleteTarget.listenerCount('scroll'), 1)
  assert.equal(incompleteTarget.listenerCount('resize'), 0)
  assert.equal(viewport.scrollTarget, undefined, 'a partially acquired target must never become observable')

  failScrollRollback = false
  viewport.clearScrollTarget()
  assert.equal(incompleteTarget.listenerCount(), 0)
  assert.deepEqual(incompleteRemovalAttempts, { resize: 0, scroll: 2 })
  assert.equal(incompleteTarget.addCount, incompleteTarget.removeCount)

  const rolledBackTarget = createFakeWindow()
  const addRolledBackListener = rolledBackTarget.addEventListener.bind(rolledBackTarget)
  rolledBackTarget.addEventListener = (type, listener, options) => {
    if (type === 'resize') throw new Error('clean resize listener registration failure')
    return addRolledBackListener(type, listener, options)
  }

  assert.throws(() => viewport.setScrollTarget(rolledBackTarget), /clean resize listener registration failure/)
  assert.equal(rolledBackTarget.listenerCount(), 0)
  assert.equal(rolledBackTarget.addCount, rolledBackTarget.removeCount)
  viewport.clearScrollTarget()
  assert.equal(rolledBackTarget.removeCount, 1, 'completed rollback must not be repeated')
})

test('Simulator frame acquisition rolls back partial event setup and permits a same-frame retry', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  let failMousemoveAcquisition = true
  t.after(async () => {
    failMousemoveAcquisition = false
    if (engine.lifecycleState !== 'disposed') await engine.destroy()
  })
  await engine.init()

  const simulator = new core.Simulator(engine.project, engine.designer)
  engine.project.mountSimulator(simulator)
  const frameWindow = createFakeWindow()
  const frame = frameWindow.document.createElement('div')
  const { document } = frameWindow
  const addEventListener = document.addEventListener.bind(document)
  document.addEventListener = (type, listener, options) => {
    if (type === 'mousemove' && failMousemoveAcquisition) {
      throw new Error('mousemove listener acquisition failed')
    }
    return addEventListener(type, listener, options)
  }

  await assert.rejects(simulator.mountContentFrame(frame), /mousemove listener acquisition failed/)
  assert.equal(simulator.iframe, undefined)
  assert.equal(simulator.contentDocument, undefined)
  assert.equal(simulator.contentWindow, undefined)
  assert.deepEqual(
    Object.fromEntries(
      ['mousedown', 'mouseover', 'mouseleave', 'mousemove'].map(type => [type, document.listenerCount(type)]),
    ),
    { mousedown: 0, mouseleave: 0, mousemove: 0, mouseover: 0 },
  )
  assert.deepEqual(Object.fromEntries(['scroll', 'resize'].map(type => [type, frameWindow.listenerCount(type)])), {
    resize: 0,
    scroll: 0,
  })
  assert.equal(document.addCount, document.removeCount)
  assert.equal(frameWindow.addCount, frameWindow.removeCount)

  failMousemoveAcquisition = false
  await simulator.mountContentFrame(frame)
  assert.strictEqual(simulator.iframe, frame)
  assert.strictEqual(simulator.contentDocument, document)
  assert.strictEqual(simulator.contentWindow, frameWindow)
  assert.deepEqual(
    Object.fromEntries(
      ['mousedown', 'mouseover', 'mouseleave', 'mousemove'].map(type => [type, document.listenerCount(type)]),
    ),
    { mousedown: 1, mouseleave: 1, mousemove: 1, mouseover: 1 },
  )

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(document.listenerCount(), 0)
  assert.equal(frameWindow.listenerCount(), 0)
  assert.equal(document.addCount, document.removeCount)
  assert.equal(frameWindow.addCount, frameWindow.removeCount)
})

test('Simulator retains failed frame-acquisition cleanup for engine destroy retry', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  let failMousemoveAcquisition = true
  let failMouseleaveRollback = true
  t.after(async () => {
    failMousemoveAcquisition = false
    failMouseleaveRollback = false
    if (engine.lifecycleState !== 'disposed') await engine.destroy()
  })
  await engine.init()

  const simulator = new core.Simulator(engine.project, engine.designer)
  engine.project.mountSimulator(simulator)
  const frameWindow = createFakeWindow()
  const frame = frameWindow.document.createElement('div')
  const { document } = frameWindow
  const addEventListener = document.addEventListener.bind(document)
  const removeEventListener = document.removeEventListener.bind(document)
  document.addEventListener = (type, listener, options) => {
    if (type === 'mousemove' && failMousemoveAcquisition) {
      throw new Error('mousemove listener acquisition failed')
    }
    return addEventListener(type, listener, options)
  }
  document.removeEventListener = (type, listener, options) => {
    if (type === 'mouseleave' && failMouseleaveRollback) {
      throw new Error('mouseleave listener rollback failed')
    }
    return removeEventListener(type, listener, options)
  }

  const error = await captureFailure(() => simulator.mountContentFrame(frame))
  assert.equal(error.name, 'AggregateError')
  assert.match(error.message, /rollback was incomplete/)
  assert.ok(error.errors.some(cause => /mousemove listener acquisition failed/.test(cause?.message)))
  assert.ok(error.errors.some(cause => /detecting listener disposal failed/.test(cause?.message)))
  assert.equal(simulator.iframe, undefined)
  assert.equal(simulator.contentDocument, undefined)
  assert.equal(simulator.contentWindow, undefined)
  assert.deepEqual(
    Object.fromEntries(
      ['mousedown', 'mouseover', 'mouseleave', 'mousemove'].map(type => [type, document.listenerCount(type)]),
    ),
    { mousedown: 0, mouseleave: 1, mousemove: 0, mouseover: 0 },
  )

  failMousemoveAcquisition = false
  failMouseleaveRollback = false
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(document.listenerCount(), 0)
  assert.equal(frameWindow.listenerCount(), 0)
  assert.equal(document.addCount, document.removeCount)
  assert.equal(frameWindow.addCount, frameWindow.removeCount)
})
