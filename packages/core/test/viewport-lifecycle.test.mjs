import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeWindow } from './helpers/fake-browser.mjs'
import { loadCore } from './helpers/kernel.mjs'

const captureFailure = operation => {
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

  const incompleteRollback = captureFailure(() => viewport.setScrollTarget(incompleteTarget))
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
