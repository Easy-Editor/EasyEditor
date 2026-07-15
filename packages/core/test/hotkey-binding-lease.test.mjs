import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

const countHotkeyCallbacks = hotkey =>
  Object.values(hotkey.callBacks).reduce((count, callbacks) => count + callbacks.length, 0)

const assertRevoked = (operation, label) => {
  assert.throws(operation, /disposed|generation|lifecycle/i, label)
}

test('plugin hotkey binding leases survive internal teardown but stay revoked from retired plugins', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  const generations = []
  const callback = () => undefined
  const plugin = {
    name: 'hotkey-binding-lease',
    init(ctx) {
      const lease = ctx.hotkey.acquireBinding('ctrl+shift+l', callback)
      ctx.onDispose(lease)
      generations.push({ hotkey: ctx.hotkey, lease })
    },
  }
  t.after(async () => engine.destroy())

  await engine.plugins.register(plugin)
  await engine.init()

  assert.equal(countHotkeyCallbacks(engine.hotkey), 1)
  const first = generations[0]

  assert.equal(await engine.plugins.delete(plugin.name), true)
  assert.equal(countHotkeyCallbacks(engine.hotkey), 0, 'plugin deletion must release its engine-owned binding')
  assertRevoked(() => first.lease(), 'a retired plugin must not invoke its retained lease')
  assertRevoked(
    () => first.hotkey.acquireBinding('ctrl+shift+x', callback),
    'a retired plugin must not acquire another binding',
  )

  await engine.plugins.register(plugin, { autoInit: true })
  assert.equal(generations.length, 2)
  assert.equal(countHotkeyCallbacks(engine.hotkey), 1)
  const second = generations[1]

  await engine.destroy()

  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(
    countHotkeyCallbacks(engine.hotkey),
    0,
    'engine destroy must release plugin bindings before Hotkey teardown',
  )
  assertRevoked(() => second.lease(), 'a destroyed generation must not invoke its retained lease')
  assertRevoked(
    () => second.hotkey.bind('ctrl+shift+y', callback),
    'a destroyed generation must not mutate the retained Hotkey capability',
  )

  await engine.init()

  assert.equal(generations.length, 3, 'restart must create a fresh plugin generation')
  assert.equal(countHotkeyCallbacks(engine.hotkey), 1)
  assertRevoked(() => second.lease(), 'restart must not revive an old lease')

  await engine.destroy()
  assert.equal(countHotkeyCallbacks(engine.hotkey), 0)
})

test('Hotkey binding leases acquire atomically and release exact ownership with retry', async t => {
  const core = await loadCore()
  const hotkey = new core.Hotkey('binding-lease-retry')
  const callback = () => undefined
  const existingCallback = () => undefined
  const invalidCombo = {
    replace() {
      throw new Error('invalid second binding')
    },
  }
  t.after(() => hotkey.dispose())

  hotkey.bind('ctrl+k', existingCallback)
  assert.throws(() => hotkey.acquireBinding(['ctrl+k', invalidCombo], callback), /invalid second binding/)
  assert.equal(countHotkeyCallbacks(hotkey), 1, 'a partially acquired binding batch must roll back')
  assert.equal(
    hotkey.callBacks.k[0].callback,
    existingCallback,
    'rollback must restore the binding replaced before a later acquisition failed',
  )
  hotkey.unbind('ctrl+k', existingCallback)

  const staleLease = hotkey.acquireBinding('ctrl+l', callback)
  const lease = hotkey.acquireBinding('ctrl+l', callback)
  assert.equal(countHotkeyCallbacks(hotkey), 1)
  staleLease()
  assert.equal(countHotkeyCallbacks(hotkey), 1, 'an older lease must not remove a replacement owner')

  const originalSplice = Array.prototype.splice
  let failedRelease = false
  Array.prototype.splice = function (...args) {
    if (!failedRelease && this.some(binding => binding?.callback === callback)) {
      failedRelease = true
      throw new Error('transient binding release failure')
    }
    return Reflect.apply(originalSplice, this, args)
  }
  try {
    assert.throws(
      () => lease(),
      error =>
        error instanceof AggregateError &&
        error.errors.some(
          failure => failure instanceof Error && /transient binding release failure/.test(failure.message),
        ),
    )
  } finally {
    Array.prototype.splice = originalSplice
  }
  assert.equal(countHotkeyCallbacks(hotkey), 1, 'a failed release must retain ownership for retry')

  lease()
  assert.equal(countHotkeyCallbacks(hotkey), 0)

  lease()
  assert.equal(countHotkeyCallbacks(hotkey), 0, 'a successful lease release must be idempotent')
})

test('releasing one sequence action preserves another action sharing the sequence state', async t => {
  const core = await loadCore()
  const hotkey = new core.Hotkey('binding-lease-sequence-actions')
  let keydownCalls = 0
  const keydownLease = hotkey.acquireBinding(
    'g i',
    () => {
      keydownCalls += 1
    },
    'keydown',
  )
  const keyupLease = hotkey.acquireBinding('g i', () => undefined, 'keyup')
  t.after(() => hotkey.dispose())

  assert.equal(countHotkeyCallbacks(hotkey), 4)
  keyupLease()
  assert.equal(countHotkeyCallbacks(hotkey), 2)

  const event = {
    type: 'keydown',
    keyCode: 0,
    which: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
  }
  hotkey.handleKey('g', [], event)
  hotkey.handleKey('i', [], event)
  assert.equal(keydownCalls, 1, 'the surviving action must retain usable sequence progress')

  keydownLease()
  assert.equal(countHotkeyCallbacks(hotkey), 0)
})
