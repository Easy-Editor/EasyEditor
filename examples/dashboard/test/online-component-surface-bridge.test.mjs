import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DASHBOARD_ONLINE_COMPONENT_RUNTIME_EVENT,
  createDashboardOnlineComponentSurfaceBridge,
  dispatchDashboardOnlineComponentRuntimeEvent,
  isDashboardOnlineComponentSurfaceEnabled,
  resolveDashboardOnlineComponentContext,
  resolveDashboardOnlineComponentSafeBoot,
  resolveDashboardOnlineComponentSurfaceFeatureFlags,
  sanitizeDashboardOnlineComponentProps,
  startDashboardOnlineComponentSurface,
} from '../src/runtime/online-components/surface-bridge.mjs'
import { createOnlineComponentSurfaceController } from '../src/runtime/online-components/surface-controller.mjs'

const createFrames = () => {
  let nextId = 1
  const callbacks = new Map()
  return {
    requestAnimationFrame(callback) {
      const id = nextId++
      callbacks.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) {
      callbacks.delete(id)
    },
    flush() {
      const current = [...callbacks.entries()]
      callbacks.clear()
      for (const [, callback] of current) callback(0)
    },
    size: () => callbacks.size,
  }
}

const createElement = rect => ({
  isConnected: true,
  rect,
  reads: 0,
  getBoundingClientRect() {
    this.reads += 1
    return this.rect
  },
})

const createMount = () => ({
  clientWidth: 1000,
  clientHeight: 500,
  reads: 0,
  getBoundingClientRect() {
    this.reads += 1
    return { left: 100, top: 50, width: 500, height: 250 }
  },
})

const createCancelableController = () => {
  const events = []
  const pending = []
  const records = new Map()
  return {
    controller: {
      register(input) {
        if (records.has(input.instanceId)) throw new Error(`instance ${input.instanceId} is already registered`)
        let resolve
        let reject
        const operation = new Promise((operationResolve, operationReject) => {
          resolve = operationResolve
          reject = operationReject
        })
        const record = { input, reject, resolve }
        records.set(input.instanceId, record)
        pending.push(record)
        events.push(`register:${input.payload.props.title}`)
        return operation.then(applied => (records.get(input.instanceId) === record ? applied : false))
      },
      update: () => Promise.resolve(true),
      unregister(instanceId) {
        const current = records.get(instanceId)
        events.push(`unregister:${current?.input.payload.props.title ?? 'missing'}`)
        return records.delete(instanceId)
      },
    },
    events,
    pending,
    records,
  }
}

const flushPromiseJobs = () => new Promise(resolve => setImmediate(resolve))

const node = Object.freeze({ componentName: 'GeneratedMaterialHost', $agent: { schemaVersion: 1, artifactRef: {} } })

test('surface props keep JSON data while dropping callbacks, renderer internals, cycles, and prototype objects', () => {
  const cycle = {}
  cycle.self = cycle
  const sanitized = sanitizeDashboardOnlineComponentProps({
    title: 'KPI',
    count: 2,
    onClick: () => undefined,
    ref: () => undefined,
    __schema: { forged: true },
    nested: { ok: true, callback: () => undefined, cycle },
    date: new Date(0),
  })
  assert.deepEqual(sanitized, {})
  assert.doesNotMatch(JSON.stringify(sanitized), /onClick|callback|__schema|date/)
})

test('shared context resolver projects resolved data, theme, and asset handles without host authority', () => {
  let getterReads = 0
  const props = {
    title: 'KPI',
    accessToken: 'host-access-token',
    authorization: 'Bearer host',
    credentialRef: 'credential://host',
    token: 'business-prop-token',
    onClick: () => undefined,
    data: { value: 'manual' },
    dataBindings: {
      schemaVersion: 1,
      fields: { data: { sourceId: 'rows', transform: [{ op: 'take', count: 1 }] } },
    },
    __dataSource: {
      page: { rows: [{ value: 7, token: 'business-data-token' }, { value: 8 }] },
    },
    __appHelper: { dataSourceEngine: { fetch: () => undefined }, engine: { forged: true } },
    theme: { mode: 'dark', designTokens: { token: 'business-theme-token', spacing: 8 } },
    assets: [{ id: 'asset-a', handle: 'asset://a' }],
    dom: new Date(0),
  }
  const context = resolveDashboardOnlineComponentContext(props)
  assert.equal(getterReads, 0)
  assert.deepEqual(context.data, [{ value: 7, token: 'business-data-token' }])
  assert.deepEqual(context.theme, {
    mode: 'dark',
    designTokens: { token: 'business-theme-token', spacing: 8 },
  })
  assert.deepEqual(context.assets, [{ id: 'asset-a', handle: 'asset://a' }])
  assert.equal(context.props.title, 'KPI')
  assert.equal(context.props.token, 'business-prop-token')
  assert.equal(context.props.data, undefined)
  assert.equal(context.props.dom, undefined)
  const serialized = JSON.stringify(context)
  assert.doesNotMatch(serialized, /host-access-token|Bearer host|credential:\/\/host|onClick/)
  assert.doesNotMatch(serialized, /dataSourceEngine|__appHelper/)

  const accessorProps = { title: 'hidden-on-invalid-props' }
  Object.defineProperty(accessorProps, 'getterSecret', {
    enumerable: true,
    get() {
      getterReads += 1
      return 'stolen'
    },
  })
  assert.deepEqual(resolveDashboardOnlineComponentContext(accessorProps).props, {})
  assert.equal(getterReads, 0)
})

test('context fields fail closed as a whole on cycles, accessors, and byte-budget overflow', () => {
  let getterReads = 0
  const cycle = { ok: true }
  cycle.self = cycle
  const asset = { id: 'asset-a' }
  Object.defineProperty(asset, 'secret', {
    enumerable: true,
    get() {
      getterReads += 1
      return 'stolen'
    },
  })
  const context = resolveDashboardOnlineComponentContext({
    data: cycle,
    theme: { label: 'x'.repeat(50 * 1024) },
    assets: [asset],
  })
  assert.equal(getterReads, 0)
  assert.equal(context.data, null)
  assert.deepEqual(context.theme, {})
  assert.deepEqual(context.assets, [])
})

test('runtime and online flags are both required and URL safe-boot is explicit', () => {
  assert.equal(isDashboardOnlineComponentSurfaceEnabled({ runtime: true, online: true }), true)
  assert.equal(isDashboardOnlineComponentSurfaceEnabled({ runtime: true, online: false }), false)
  assert.equal(isDashboardOnlineComponentSurfaceEnabled({ runtime: false, online: true }), false)
  assert.equal(resolveDashboardOnlineComponentSafeBoot('?easy-editor-online-safe-boot=1'), true)
  assert.equal(resolveDashboardOnlineComponentSafeBoot('?easy-editor-online-safe-boot=true'), true)
  assert.equal(resolveDashboardOnlineComponentSafeBoot('?easy-editor-online-safe-boot=0'), false)
})

test('preview surface flags use the strict shared runtime and online environment mapping', () => {
  assert.deepEqual(resolveDashboardOnlineComponentSurfaceFeatureFlags(), { runtime: false, online: false })
  for (const enabled of [true, 'true', '1']) {
    assert.deepEqual(
      resolveDashboardOnlineComponentSurfaceFeatureFlags({
        VITE_DASHBOARD_AGENT_RUNTIME: enabled,
        VITE_DASHBOARD_AGENT_ONLINE: enabled,
      }),
      { runtime: true, online: true },
    )
  }
  for (const disabled of [false, 'false', '0', 1, null, undefined]) {
    assert.deepEqual(
      resolveDashboardOnlineComponentSurfaceFeatureFlags({
        VITE_DASHBOARD_AGENT_RUNTIME: disabled,
        VITE_DASHBOARD_AGENT_ONLINE: disabled,
      }),
      { runtime: false, online: false },
    )
  }
})

test('runtime CustomEvent exposes only the stable safe DTO', () => {
  let dispatched
  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init.detail
    }
  }
  dispatchDashboardOnlineComponentRuntimeEvent(
    {
      dispatchEvent(event) {
        dispatched = event
        return true
      },
    },
    {
      surfaceId: 'dashboard-preview-online',
      instanceId: 'node-1',
      type: 'activate',
      payload: { value: 1, callback: () => undefined, __schema: { forged: true } },
    },
    FakeCustomEvent,
  )
  assert.equal(dispatched.type, DASHBOARD_ONLINE_COMPONENT_RUNTIME_EVENT)
  assert.deepEqual(dispatched.detail, {
    schemaVersion: 1,
    surfaceId: 'dashboard-preview-online',
    instanceId: 'node-1',
    type: 'activate',
    payload: { value: 1 },
  })
})

test('disabled production composition performs no DOM query, controller construction, marker access, or artifact read', () => {
  let queries = 0
  let controllers = 0
  const handle = startDashboardOnlineComponentSurface({
    enabled: false,
    document: { querySelector: () => (queries += 1) },
    createController: () => (controllers += 1),
  })
  assert.deepEqual(handle.getDiagnostics(), { state: 'disabled', controllerCreated: false })
  assert.equal(queries, 0)
  assert.equal(controllers, 0)
})

test('twenty bindings share one animation-frame sampler and one mount measurement per frame', async () => {
  const frames = createFrames()
  const mount = createMount()
  const registrations = []
  const controller = {
    register(input) {
      registrations.push(input)
      return Promise.resolve(true)
    },
    update: () => Promise.resolve(true),
    unregister: () => true,
  }
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  bridge.attach({ controller, projectId: 'project-a', mount })
  const bindings = Array.from({ length: 20 }, (_, index) =>
    bridge.connect({
      instanceId: `node-${index}`,
      node,
      props: { title: `node-${index}`, onClick: () => undefined },
      element: createElement({ left: 110 + index, top: 60, width: 50, height: 25 }),
    }),
  )
  assert.equal(frames.size(), 1)
  frames.flush()
  await Promise.resolve()
  assert.equal(registrations.length, 20)
  assert.equal(mount.reads, 1)
  assert.ok(registrations.every(input => !Object.hasOwn(input.payload.props, 'onClick')))
  assert.deepEqual(registrations[0].rect, { x: 20, y: 20, width: 100, height: 50 })
  for (const binding of bindings) binding.dispose()
  assert.equal(frames.size(), 0)
})

test('editor and preview bridge composition produce identical resolved context payloads', async () => {
  const payloads = new Map()
  const handles = []
  for (const mode of ['editor', 'preview']) {
    const frames = createFrames()
    const bridge = createDashboardOnlineComponentSurfaceBridge({
      ...frames,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    })
    const mount = createMount()
    const surface = startDashboardOnlineComponentSurface({
      enabled: true,
      mode,
      projectId: 'project-a',
      branchId: 'main',
      surfaceId: `dashboard-${mode}-online`,
      bridge,
      markerStore: {},
      persistence: { readArtifact: async () => null },
      document: { documentElement: {}, querySelector: () => mount },
      ...frames,
      createController: options => ({
        register(input) {
          assert.equal(options.surfaceHostOptions.mode, mode)
          payloads.set(mode, input.payload)
          return Promise.resolve(true)
        },
        update: () => Promise.resolve(true),
        unregister: () => true,
        dispose: () => undefined,
      }),
    })
    const binding = bridge.connect({
      instanceId: 'node',
      node,
      props: {
        label: 'shared',
        data: { value: 0 },
        dataBindings: { schemaVersion: 1, fields: { data: { sourceId: 'kpi' } } },
        __dataSource: { page: { kpi: { value: 42 } } },
        theme: { mode: 'dark' },
        assets: [{ id: 'logo', handle: 'asset://logo' }],
      },
      element: createElement({ left: 110, top: 60, width: 50, height: 25 }),
    })
    frames.flush()
    handles.push({ binding, surface })
  }
  await Promise.resolve()
  assert.deepEqual(payloads.get('editor'), payloads.get('preview'))
  assert.deepEqual(payloads.get('editor'), {
    props: {
      label: 'shared',
    },
    data: { value: 42 },
    theme: { mode: 'dark' },
    assets: [{ id: 'logo', handle: 'asset://logo' }],
    size: { width: 100, height: 50 },
  })
  for (const handle of handles) {
    handle.binding.dispose()
    handle.surface.dispose()
  }
})

test('pending register retains dirty state and dispatches only the latest props and rect after resolution', async () => {
  const frames = createFrames()
  const mount = createMount()
  const element = createElement({ left: 110, top: 60, width: 50, height: 25 })
  let resolveRegister
  const registerPromise = new Promise(resolve => {
    resolveRegister = resolve
  })
  const updates = []
  const controller = {
    register: () => registerPromise,
    update(_instanceId, patch) {
      updates.push(patch)
      return Promise.resolve(true)
    },
    unregister: () => true,
  }
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  bridge.attach({ controller, projectId: 'project-a', mount })
  const binding = bridge.connect({ instanceId: 'node', node, props: { title: 'old' }, element })
  frames.flush()
  binding.update({ node, props: { title: 'middle' }, element })
  element.rect = { left: 130, top: 70, width: 60, height: 30 }
  binding.update({ node, props: { title: 'final' }, element })
  frames.flush()
  resolveRegister(true)
  await Promise.resolve()
  frames.flush()
  await Promise.resolve()
  assert.equal(updates.length, 1)
  assert.equal(updates[0].payload.props.title, 'final')
  assert.deepEqual(updates[0].rect, { x: 60, y: 40, width: 120, height: 60 })
  binding.dispose()
})

test('same-ID reconnect cancels stale registration before old resolve or reject can affect the replacement', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const frames = createFrames()
    const model = createCancelableController()
    const errors = []
    const bridge = createDashboardOnlineComponentSurfaceBridge({
      ...frames,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      onError: error => errors.push(error),
    })
    bridge.attach({ controller: model.controller, projectId: 'project-a', mount: createMount() })

    const first = bridge.connect({
      instanceId: 'node',
      node,
      props: { title: 'first' },
      element: createElement({ left: 110, top: 60, width: 50, height: 25 }),
    })
    frames.flush()
    first.dispose()

    const replacement = bridge.connect({
      instanceId: 'node',
      node,
      props: { title: 'replacement' },
      element: createElement({ left: 130, top: 70, width: 60, height: 30 }),
    })
    frames.flush()
    assert.deepEqual(model.events, ['register:first', 'unregister:first', 'register:replacement'])
    assert.equal(model.records.get('node'), model.pending[1])

    if (outcome === 'resolve') model.pending[0].resolve(true)
    else model.pending[0].reject(new Error('stale registration failed'))
    await flushPromiseJobs()
    assert.deepEqual(model.events, ['register:first', 'unregister:first', 'register:replacement'])
    assert.equal(model.records.get('node'), model.pending[1])
    assert.equal(errors.length, outcome === 'reject' ? 1 : 0)

    model.pending[1].resolve(true)
    await flushPromiseJobs()
    replacement.dispose()
    assert.deepEqual(model.events, [
      'register:first',
      'unregister:first',
      'register:replacement',
      'unregister:replacement',
    ])
    assert.equal(model.records.size, 0)
  }
})

test('surface detach cancels controller-owned pending registrations', async () => {
  const frames = createFrames()
  const model = createCancelableController()
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  const detach = bridge.attach({ controller: model.controller, projectId: 'project-a', mount: createMount() })
  const binding = bridge.connect({
    instanceId: 'node',
    node,
    props: { title: 'pending' },
    element: createElement({ left: 110, top: 60, width: 50, height: 25 }),
  })
  frames.flush()

  assert.equal(detach(), true)
  assert.deepEqual(model.events, ['register:pending', 'unregister:pending'])
  assert.equal(model.records.size, 0)
  model.pending[0].resolve(true)
  await flushPromiseJobs()
  assert.deepEqual(model.events, ['register:pending', 'unregister:pending'])

  binding.dispose()
})

test('safe-boot composition preserves bindings but performs zero artifact reads and creates no host or iframe', async () => {
  const frames = createFrames()
  const mount = createMount()
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  let reads = 0
  let controller
  const handle = startDashboardOnlineComponentSurface({
    enabled: true,
    safeBoot: true,
    mode: 'preview',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-preview-online',
    bridge,
    markerStore: {
      getItem: () => {
        throw new Error('safe boot must not read markers')
      },
      setItem: () => {
        throw new Error('safe boot must not write markers')
      },
      removeItem: () => {
        throw new Error('safe boot must not clear markers')
      },
    },
    persistence: {
      readArtifact: async () => {
        reads += 1
        return null
      },
    },
    document: { documentElement: {}, querySelector: () => mount },
    ...frames,
    createController: options => {
      controller = createOnlineComponentSurfaceController(options)
      return controller
    },
  })
  const binding = bridge.connect({
    instanceId: 'safe-node',
    node,
    props: { title: 'retained' },
    element: createElement({ left: 110, top: 60, width: 50, height: 25 }),
  })
  frames.flush()
  await Promise.resolve()
  assert.equal(reads, 0)
  assert.deepEqual(controller.getDiagnostics(), {
    state: 'safe-boot',
    instanceCount: 0,
    iframeCount: 0,
    hostCreated: false,
    faultCount: 0,
  })
  assert.equal(bridge.getDiagnostics().instanceCount, 1)
  binding.dispose()
  handle.dispose()
})

test('editor and preview composition own independent controller, mount, marker, and artifact resolver state', async () => {
  const frames = createFrames()
  const surfaces = []
  const createSurface = (mode, surfaceId) => {
    const mount = createMount()
    const bridge = createDashboardOnlineComponentSurfaceBridge({
      ...frames,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    })
    const reads = []
    let controllerOptions
    const controller = {
      register: () => Promise.resolve(true),
      update: () => Promise.resolve(true),
      unregister: () => true,
      dispose: () => undefined,
      getDiagnostics: () => ({ iframeCount: 0 }),
    }
    const handle = startDashboardOnlineComponentSurface({
      enabled: true,
      mode,
      projectId: 'project-a',
      branchId: 'main',
      surfaceId,
      bridge,
      markerStore: {},
      persistence: {
        readArtifact(request) {
          reads.push(request)
          return Promise.resolve(null)
        },
      },
      document: { documentElement: {}, querySelector: () => mount },
      ...frames,
      createController(options) {
        controllerOptions = options
        return controller
      },
    })
    return { bridge, controller, controllerOptions, handle, mount, reads }
  }
  surfaces.push(createSurface('editor', 'dashboard-editor-online'))
  surfaces.push(createSurface('preview', 'dashboard-preview-online'))
  assert.notEqual(surfaces[0].bridge, surfaces[1].bridge)
  assert.notEqual(surfaces[0].controller, surfaces[1].controller)
  assert.notEqual(surfaces[0].mount, surfaces[1].mount)
  assert.equal(surfaces[0].controllerOptions.surfaceHostOptions.mode, 'editor')
  assert.equal(surfaces[1].controllerOptions.surfaceHostOptions.mode, 'preview')
  await surfaces[1].controllerOptions.readArtifact({ artifactId: 'a', sourceRevision: 'r' })
  assert.deepEqual(surfaces[1].reads, [
    { schemaVersion: 1, projectId: 'project-a', artifactId: 'a', sourceRevision: 'r' },
  ])
  for (const surface of surfaces) surface.handle.dispose()
})

test('trusted host is registered in component/meta maps without a palette snippet', () => {
  const component = readFileSync(
    new URL('../src/editor/materials/inner/generated-material-host/component.tsx', import.meta.url),
    'utf8',
  )
  const meta = readFileSync(
    new URL('../src/editor/materials/inner/generated-material-host/meta.ts', import.meta.url),
    'utf8',
  )
  const components = readFileSync(new URL('../src/editor/materials/component.ts', import.meta.url), 'utf8')
  const metas = readFileSync(new URL('../src/editor/materials/meta.ts', import.meta.url), 'utf8')
  assert.match(component, /DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY/)
  assert.match(component, /const instanceId = __id \?\? node\?\.id/)
  assert.match(component, /data-easy-editor-generated-material-host/)
  assert.match(component, /pointerEvents:\s*'none'/)
  assert.match(meta, /componentName:\s*'GeneratedMaterialHost'/)
  assert.doesNotMatch(meta, /snippets/)
  assert.match(components, /GeneratedMaterialHost/)
  assert.match(metas, /GeneratedMaterialHost/)
})

test('editor and preview wire the top-level bridge behind runtime plus online flags using public overlay mounts', () => {
  const editor = readFileSync(new URL('../src/editor/index.ts', import.meta.url), 'utf8')
  const preview = readFileSync(new URL('../src/pages/preview/index.tsx', import.meta.url), 'utf8')
  const editorOverlay = readFileSync(
    new URL(
      '../../../packages/react-renderer-dashboard/src/simulator-renderer/SimulatorRenderer/SimulatorView.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  const previewOverlay = readFileSync(
    new URL('../../../packages/react-renderer-dashboard/src/renderer/index.tsx', import.meta.url),
    'utf8',
  )
  for (const source of [editor, preview]) {
    assert.match(source, /isDashboardOnlineComponentSurfaceEnabled/)
    assert.match(source, /DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY/)
    assert.match(source, /resolveDashboardOnlineComponentSafeBoot\(window\.location\.search\)/)
    assert.match(source, /dispatchDashboardOnlineComponentRuntimeEvent\(window, event\)/)
  }
  assert.match(editor, /mode:\s*'editor'/)
  assert.match(editor, /surfaceId:\s*'dashboard-editor-online'/)
  assert.match(editor, /persistence:\s*dashboardPersistence/)
  assert.match(editor, /onSelection:/)
  assert.match(editor, /engine\.designer\.selection\.select\(event\.instanceId\)/)
  assert.match(editor, /engine\.designer\.dragon\.from\(/)
  assert.match(editor, /type:\s*DragObjectType\.Node/)
  assert.match(editor, /bindTrustedShell:/)
  assert.match(preview, /mode:\s*'preview'/)
  assert.match(preview, /surfaceId:\s*'dashboard-preview-online'/)
  assert.doesNotMatch(preview, /onSelection:/)
  assert.doesNotMatch(preview, /bindTrustedShell:/)
  assert.match(editorOverlay, /data-easy-editor-surface-overlay-mount='editor'/)
  assert.match(previewOverlay, /data-easy-editor-surface-overlay-mount='preview'/)
})
