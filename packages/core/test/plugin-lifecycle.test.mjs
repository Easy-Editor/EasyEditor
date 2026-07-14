import assert from 'node:assert/strict'
import test from 'node:test'
import { assertKernelApi, captureFailure, loadCore } from './helpers/kernel.mjs'

async function createPluginEngine(t) {
  const core = await loadCore()
  assertKernelApi(core)
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  return engine
}

test('a missing plugin dependency fails before any plugin initializes', async t => {
  const engine = await createPluginEngine(t)
  let initialized = false
  await engine.plugins.register({
    name: 'dependent',
    deps: ['missing'],
    init() {
      initialized = true
    },
  })

  const error = await captureFailure(() => engine.init())
  assert.match(error.message, /missing|dependency/i)
  assert.equal(initialized, false)
  assert.notEqual(engine.lifecycleState, 'ready')
})

test('a plugin dependency cycle fails before any plugin initializes', async t => {
  const engine = await createPluginEngine(t)
  const initialized = []
  await engine.plugins.register({ name: 'a', deps: ['b'], init: () => initialized.push('a') })
  await engine.plugins.register({ name: 'b', deps: ['a'], init: () => initialized.push('b') })

  const error = await captureFailure(() => engine.init())
  assert.match(error.message, /cycle|recursive|dependency/i)
  assert.deepEqual(initialized, [])
  assert.notEqual(engine.lifecycleState, 'ready')
})

test('plugin init failure rolls back initialized plugins in reverse order', async t => {
  const engine = await createPluginEngine(t)
  const calls = []
  await engine.plugins.register({
    name: 'a',
    init: () => calls.push('init:a'),
    destroy: () => calls.push('destroy:a'),
  })
  await engine.plugins.register({
    name: 'b',
    deps: ['a'],
    init: () => calls.push('init:b'),
    destroy: () => calls.push('destroy:b'),
  })
  await engine.plugins.register({
    name: 'c',
    deps: ['b'],
    init() {
      calls.push('init:c')
      throw new Error('c exploded')
    },
  })

  const error = await captureFailure(() => engine.init())
  assert.match(error.message, /c exploded|plugin.*c/i)
  assert.deepEqual(calls, ['init:a', 'init:b', 'init:c', 'destroy:b', 'destroy:a'])
  assert.equal(engine.innerPlugins.get('a').isInited(), false)
  assert.equal(engine.innerPlugins.get('b').isInited(), false)
  assert.equal(engine.innerPlugins.get('c').isInited(), false)
  assert.notEqual(engine.lifecycleState, 'ready')
})

test('engine initialization retries plugin cleanup after rollback disposal fails once', async t => {
  const engine = await createPluginEngine(t)
  let destroyCalls = 0
  await engine.plugins.register({
    name: 'retry-cleanup',
    init() {},
    destroy() {
      destroyCalls += 1
      if (destroyCalls === 1) throw new Error('transient cleanup failure')
    },
  })
  await engine.plugins.register({
    name: 'fail-init',
    deps: ['retry-cleanup'],
    init() {
      throw new Error('init failed')
    },
  })

  const error = await captureFailure(() => engine.init())
  assert.match(error.message, /init failed|rollback/i)
  assert.equal(destroyCalls, 2)
  assert.equal(engine.innerPlugins.get('retry-cleanup').isInited(), false)
  assert.equal(engine.lifecycleState, 'created')
})

test('dependency preflight runs before any prototype extension', async t => {
  const engine = await createPluginEngine(t)
  let extended = false
  await engine.plugins.register({
    name: 'unsafe-order',
    deps: ['missing'],
    extend() {
      extended = true
    },
    init() {},
  })

  const error = await captureFailure(() => engine.init())
  assert.match(error.message, /missing|dependency/i)
  assert.equal(extended, false)
})

test('autoInit cannot bypass manager readiness or extension preflight', async t => {
  const engine = await createPluginEngine(t)
  let initialized = false
  const error = await captureFailure(() =>
    engine.plugins.register(
      {
        name: 'too-early',
        extend() {},
        init() {
          initialized = true
        },
      },
      { autoInit: true },
    ),
  )

  assert.match(error.message, /autoInit|initialized/i)
  assert.equal(initialized, false)
  assert.equal(engine.plugins.has('too-early'), false)
})

test('plugin dependency preflight runs before remote adapter initialization', async t => {
  const core = await loadCore()
  let adapterInitCalls = 0
  const engine = core.createEngine({
    trustPolicy: 'legacyTrusted',
    hostWindow: null,
    remoteAdapter: {
      init() {
        adapterInitCalls += 1
      },
      dispose() {},
    },
  })
  t.after(() => engine.destroy())
  await engine.plugins.register({ name: 'dependent', deps: ['missing'], init() {} })

  await captureFailure(() => engine.init())
  assert.equal(adapterInitCalls, 0)
})
