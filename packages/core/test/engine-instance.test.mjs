import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoadedResource, createProjectSchema } from './fixtures/project-schema.mjs'
import { assertKernelApi, loadCore } from './helpers/kernel.mjs'

test('createEngine owns isolated mutable services', async t => {
  const core = await loadCore()
  assertKernelApi(core)

  const a = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const b = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => {
    await a.destroy()
    await b.destroy()
  })

  for (const service of ['config', 'project', 'materials', 'setters', 'plugins', 'event', 'hotkey', 'clipboard']) {
    assert.notStrictEqual(a[service], b[service], `${service} must be instance-owned`)
  }
  assert.notStrictEqual(a.remote, b.remote)
  assert.notStrictEqual(a.remote.registry, b.remote.registry)
  assert.notStrictEqual(a.remote.loadingState, b.remote.loadingState)

  a.config.set('locale', 'en-US')
  assert.equal(b.config.get('locale'), undefined)

  a.project.load(createProjectSchema(), true)
  assert.equal(a.project.documents.length, 1)
  assert.equal(b.project.documents.length, 0)

  a.remote.registry.register(createLoadedResource('only-a'))
  a.remote.loadingState.startLoading('only-a', 'material', 'only-a')
  assert.equal(b.remote.registry.has('material', 'only-a'), false)
  assert.equal(b.remote.loadingState.getState('only-a'), undefined)

  let aEvents = 0
  let bEvents = 0
  a.event.on('common:isolation', () => {
    aEvents += 1
  })
  b.event.on('common:isolation', () => {
    bEvents += 1
  })
  a.event.emit('isolation')
  assert.equal(aEvents, 1)
  assert.equal(bEvents, 0)

  await a.plugins.register({ name: 'same-name', init() {} })
  await b.plugins.register({ name: 'same-name', init() {} })
  assert.notStrictEqual(a.plugins.get('same-name').ctx, b.plugins.get('same-name').ctx)
})

test('legacy exports are references to the one defaultEngine facade', async () => {
  const core = await loadCore()
  assertKernelApi(core)

  assert.strictEqual(core.project, core.defaultEngine.project)
  assert.strictEqual(core.config, core.defaultEngine.config)
  assert.strictEqual(core.event, core.defaultEngine.event)
  assert.strictEqual(core.hotkey, core.defaultEngine.hotkey)
  assert.strictEqual(core.materials, core.defaultEngine.materials)
  assert.strictEqual(core.setters, core.defaultEngine.setters)
  assert.strictEqual(core.plugins, core.defaultEngine.plugins)
  assert.strictEqual(core.resourceRegistry, core.defaultEngine.remote.registry)
  assert.strictEqual(core.loadingState, core.defaultEngine.remote.loadingState)
})
