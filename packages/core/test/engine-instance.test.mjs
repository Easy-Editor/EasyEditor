import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoadedResource, createProjectSchema } from './fixtures/project-schema.mjs'
import { createFakeWindow } from './helpers/fake-browser.mjs'
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
  assert.notStrictEqual(a.innerPlugins.get('same-name').ctx, b.innerPlugins.get('same-name').ctx)
})

test('destroying engine A leaves engine B usable across every instance-owned mutable service', async t => {
  const core = await loadCore()
  const aWindow = createFakeWindow()
  const bWindow = createFakeWindow()
  const aRemoteCalls = []
  const bRemoteCalls = []
  const a = core.createEngine({
    trustPolicy: 'legacyTrusted',
    hostWindow: aWindow,
    remoteAdapter: {
      request(request) {
        aRemoteCalls.push(request.name)
      },
    },
  })
  const b = core.createEngine({
    trustPolicy: 'legacyTrusted',
    hostWindow: bWindow,
    remoteAdapter: {
      request(request) {
        bRemoteCalls.push(request.name)
      },
    },
  })
  t.after(async () => {
    await a.destroy()
    await b.destroy()
  })

  await a.init()
  await b.init()
  const bListenerCount = bWindow.document.listenerCount()
  let aEvents = 0
  let bEvents = 0
  a.event.on('common:shared-event', () => {
    aEvents += 1
  })
  b.event.on('common:shared-event', () => {
    bEvents += 1
  })

  a.materials.createComponentMeta({ componentName: 'SharedMaterial' })
  a.setters.registerSetter('SharedSetter', function SharedSetterA() {})
  a.clipboard.injectCopyPaster(aWindow.document)
  a.hotkey.bind('ctrl+a', () => {})
  await a.plugins.register({ name: 'shared-plugin', init() {} }, { autoInit: true })
  a.remote.registry.register(createLoadedResource('shared-remote'))
  a.remote.loadingState.startLoading('shared-loading', 'material', 'shared-loading')
  a.remote.request({ name: 'shared-request', type: 'material' })
  a.project.load(createProjectSchema({ id: 'project-a' }), true)
  a.config.set('shared-config', 'a')
  a.event.emit('shared-event')

  assert.equal(a.materials.getComponentMetasMap().has('SharedMaterial'), true)
  assert.equal(b.materials.getComponentMetasMap().has('SharedMaterial'), false)
  assert.equal(b.setters.getSetter('SharedSetter'), undefined)
  assert.equal(aWindow.document.body.children.length, 1)
  assert.equal(bWindow.document.body.children.length, 0)
  assert.equal(a.hotkey.callBacks.a?.length, 1)
  assert.equal(b.hotkey.callBacks.a, undefined)
  assert.equal(b.plugins.has('shared-plugin'), false)
  assert.equal(b.remote.registry.has('material', 'shared-remote'), false)
  assert.equal(b.remote.loadingState.getState('shared-loading'), undefined)
  assert.deepEqual(aRemoteCalls, ['shared-request'])
  assert.deepEqual(bRemoteCalls, [])
  assert.equal(a.project.documents.length, 1)
  assert.equal(b.project.documents.length, 0)
  assert.equal(b.config.get('shared-config'), undefined)
  assert.equal(aEvents, 1)
  assert.equal(bEvents, 0)

  await a.destroy()
  assert.equal(a.lifecycleState, 'disposed')
  assert.equal(b.lifecycleState, 'ready')
  assert.equal(bWindow.document.listenerCount(), bListenerCount)

  let postDestroyEvents = 0
  b.materials.createComponentMeta({ componentName: 'SharedMaterial' })
  b.setters.registerSetter('SharedSetter', function SharedSetterB() {})
  b.clipboard.injectCopyPaster(bWindow.document)
  b.hotkey.bind('ctrl+a', () => {})
  await b.plugins.register({ name: 'shared-plugin', init() {} }, { autoInit: true })
  b.remote.registry.register(createLoadedResource('shared-remote'))
  b.remote.loadingState.startLoading('shared-loading', 'material', 'shared-loading')
  b.remote.request({ name: 'shared-request', type: 'material' })
  b.project.load(createProjectSchema({ id: 'project-b' }), true)
  b.config.set('shared-config', 'b')
  b.event.on('common:post-destroy', () => {
    postDestroyEvents += 1
  })
  b.event.emit('shared-event')
  b.event.emit('post-destroy')

  assert.equal(b.materials.getComponentMetasMap().has('SharedMaterial'), true)
  assert.ok(b.setters.getSetter('SharedSetter'))
  assert.equal(bWindow.document.body.children.length, 1)
  assert.equal(b.hotkey.callBacks.a?.length, 1)
  assert.equal(b.innerPlugins.get('shared-plugin').isInited(), true)
  assert.equal(b.remote.registry.has('material', 'shared-remote'), true)
  assert.equal(b.remote.loadingState.getState('shared-loading')?.name, 'shared-loading')
  assert.deepEqual(bRemoteCalls, ['shared-request'])
  assert.equal(b.project.get('id'), 'project-b')
  assert.equal(b.project.documents.length, 1)
  assert.equal(b.config.get('shared-config'), 'b')
  assert.equal(bEvents, 1)
  assert.equal(postDestroyEvents, 1)
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
