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

const createInvalidationHarness = () => {
  const resizeObservers = []
  const mutationObservers = []
  const listeners = new Map()

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback
      this.observed = new Set()
      this.disconnected = false
      resizeObservers.push(this)
    }

    observe(target) {
      this.observed.add(target)
    }

    unobserve(target) {
      this.observed.delete(target)
    }

    disconnect() {
      this.disconnected = true
      this.observed.clear()
    }

    trigger() {
      this.callback(
        [...this.observed].map(target => ({ target })),
        this,
      )
    }
  }

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      this.observations = []
      mutationObservers.push(this)
    }

    observe(target, options) {
      this.target = target
      this.options = options
      this.observations.push({ target, options })
    }

    disconnect() {
      this.disconnected = true
    }

    trigger(records) {
      this.callback(records, this)
    }
  }

  const eventTarget = {
    addEventListener(type, callback, capture = false) {
      const entries = listeners.get(type) ?? []
      entries.push({ callback, capture })
      listeners.set(type, entries)
    },
    removeEventListener(type, callback, capture = false) {
      const entries = listeners.get(type) ?? []
      listeners.set(
        type,
        entries.filter(entry => entry.callback !== callback || entry.capture !== capture),
      )
    },
    emit(type) {
      for (const entry of listeners.get(type) ?? []) entry.callback({ type })
    },
    listenerCount: () => [...listeners.values()].reduce((count, entries) => count + entries.length, 0),
  }

  return {
    ResizeObserver: FakeResizeObserver,
    MutationObserver: FakeMutationObserver,
    eventTarget,
    resizeObservers,
    mutationObservers,
  }
}

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

const emptySurfaceReadinessBridge = Object.freeze({
  matchesReadyCensus: () => true,
  whenReady: () => Promise.resolve(true),
})

const emptySurfaceReadinessController = Object.freeze({
  matchesReadyCensus: () => true,
  abortOwnedActivation: () => false,
})

const createHostCensusElement = instanceId => ({
  getAttribute: name => (name === 'data-easy-editor-generated-material-host' ? instanceId : null),
})

const createSurfaceDocument = (getMount, instanceIds = []) => ({
  documentElement: {},
  querySelector: getMount,
  querySelectorAll: () => instanceIds.map(createHostCensusElement),
})

const readinessInput = expectedInstanceIds => ({ expectedInstanceIds })

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

test('disabled production composition performs no DOM query, controller construction, marker access, or artifact read', async () => {
  let queries = 0
  let controllers = 0
  const handle = startDashboardOnlineComponentSurface({
    enabled: false,
    document: { querySelector: () => (queries += 1) },
    createController: () => (controllers += 1),
  })
  assert.deepEqual(handle.getDiagnostics(), { state: 'disabled', controllerCreated: false })
  assert.equal(await handle.whenReady(readinessInput([])), false)
  assert.equal(queries, 0)
  assert.equal(controllers, 0)
})

test('surface discovery without MutationObserver is one-shot when the public mount is absent', () => {
  const frames = createFrames()
  let queries = 0
  let controllers = 0
  const handle = startDashboardOnlineComponentSurface({
    enabled: true,
    mode: 'editor',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-editor-online',
    bridge: {
      ...emptySurfaceReadinessBridge,
      attach() {
        throw new Error('an absent mount cannot attach the bridge')
      },
      getDiagnostics: () => ({ instanceCount: 0, scheduledFrameCount: 0 }),
    },
    markerStore: {},
    persistence: { readArtifact: async () => null },
    document: createSurfaceDocument(() => {
      queries += 1
      return null
    }),
    ...frames,
    MutationObserver: false,
    createController() {
      controllers += 1
      throw new Error('an absent mount cannot create a controller')
    },
  })

  assert.equal(queries, 1)
  assert.equal(controllers, 0)
  assert.equal(frames.size(), 0)
  assert.deepEqual(handle.getDiagnostics(), { state: 'discovering', controllerCreated: false })
  frames.flush()
  assert.equal(queries, 1)
  assert.equal(frames.size(), 0)

  handle.dispose()
  assert.equal(frames.size(), 0)
  assert.deepEqual(handle.getDiagnostics(), { state: 'disposed', controllerCreated: false })
})

test('surface discovery keeps mount identity live and replaces controllers only when the public mount changes', () => {
  const frames = createFrames()
  const invalidations = createInvalidationHarness()
  const mountA = { id: 'mount-a' }
  const mountB = { id: 'mount-b' }
  const mountC = { id: 'mount-c' }
  let currentMount = mountA
  const events = []
  const bridge = {
    ...emptySurfaceReadinessBridge,
    attach({ controller, mount }) {
      events.push(`attach:${mount.id}`)
      assert.equal(controller.mount, mount)
      return () => {
        events.push(`release:${mount.id}`)
        return true
      }
    },
    getDiagnostics: () => ({ instanceCount: 0, scheduledFrameCount: 0 }),
  }
  const handle = startDashboardOnlineComponentSurface({
    enabled: true,
    mode: 'editor',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-editor-online',
    bridge,
    markerStore: {},
    persistence: { readArtifact: async () => null },
    document: createSurfaceDocument(() => currentMount),
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    MutationObserver: invalidations.MutationObserver,
    createController: options => {
      const controller = {
        ...emptySurfaceReadinessController,
        mount: options.surfaceHostOptions.mount,
        whenReady() {
          return Promise.resolve(true)
        },
        getDiagnostics() {
          return { state: 'active', instanceCount: 0 }
        },
        abortOwnedActivation() {
          events.push(`abort:${this.mount.id}`)
          return true
        },
        dispose() {
          events.push(`dispose:${this.mount.id}`)
        },
      }
      events.push(`create:${controller.mount.id}`)
      return controller
    },
  })
  const observer = invalidations.mutationObservers[0]
  assert.deepEqual(events, ['create:mount-a', 'attach:mount-a'])
  assert.deepEqual(handle.getDiagnostics(), { state: 'active', controllerCreated: true })
  assert.equal(observer.disconnected, false)

  observer.trigger([{ type: 'childList', target: {} }])
  observer.trigger([{ type: 'childList', target: {} }])
  assert.equal(frames.size(), 1)
  frames.flush()
  assert.deepEqual(events, ['create:mount-a', 'attach:mount-a'])

  currentMount = mountB
  observer.trigger([{ type: 'childList', target: {} }])
  observer.trigger([{ type: 'childList', target: {} }])
  assert.equal(frames.size(), 1)
  frames.flush()
  assert.deepEqual(events, [
    'create:mount-a',
    'attach:mount-a',
    'abort:mount-a',
    'release:mount-a',
    'dispose:mount-a',
    'create:mount-b',
    'attach:mount-b',
  ])

  currentMount = null
  observer.trigger([{ type: 'childList', target: {} }])
  frames.flush()
  assert.deepEqual(events.slice(-3), ['abort:mount-b', 'release:mount-b', 'dispose:mount-b'])
  assert.deepEqual(handle.getDiagnostics(), { state: 'discovering', controllerCreated: false })
  assert.equal(observer.disconnected, false)

  currentMount = mountC
  observer.trigger([{ type: 'childList', target: {} }])
  frames.flush()
  assert.deepEqual(events.slice(-2), ['create:mount-c', 'attach:mount-c'])
  assert.deepEqual(handle.getDiagnostics(), { state: 'active', controllerCreated: true })

  observer.trigger([{ type: 'childList', target: {} }])
  assert.equal(frames.size(), 1)
  handle.dispose()
  assert.equal(frames.size(), 0)
  assert.equal(observer.disconnected, true)
  assert.deepEqual(events.slice(-2), ['release:mount-c', 'dispose:mount-c'])
  assert.deepEqual(handle.getDiagnostics(), { state: 'disposed', controllerCreated: false })
})

test('surface readiness synchronizes a committed mount replacement before binding its activation epoch', async () => {
  const frames = createFrames()
  const invalidations = createInvalidationHarness()
  const mountA = { id: 'mount-a' }
  const mountB = { id: 'mount-b' }
  let currentMount = mountA
  const events = []
  const handle = startDashboardOnlineComponentSurface({
    enabled: true,
    mode: 'editor',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-editor-online',
    bridge: {
      ...emptySurfaceReadinessBridge,
      attach({ mount }) {
        events.push(`attach:${mount.id}`)
        return () => events.push(`release:${mount.id}`)
      },
      getDiagnostics: () => ({ instanceCount: 0, scheduledFrameCount: 0 }),
    },
    markerStore: {},
    persistence: { readArtifact: async () => null },
    document: createSurfaceDocument(() => currentMount),
    ...frames,
    MutationObserver: invalidations.MutationObserver,
    createController: options => {
      const mount = options.surfaceHostOptions.mount
      events.push(`create:${mount.id}`)
      return {
        ...emptySurfaceReadinessController,
        whenReady: () => Promise.resolve(mount === mountB),
        getDiagnostics: () => ({ state: 'active', instanceCount: 0 }),
        dispose: () => events.push(`dispose:${mount.id}`),
      }
    },
  })
  assert.deepEqual(events, ['create:mount-a', 'attach:mount-a'])

  currentMount = mountB
  assert.equal(await handle.whenReady(readinessInput([])), true)
  assert.deepEqual(events, [
    'create:mount-a',
    'attach:mount-a',
    'release:mount-a',
    'dispose:mount-a',
    'create:mount-b',
    'attach:mount-b',
  ])

  handle.dispose()
})

test('surface readiness follows a controlled mount handoff without accepting either mixed epoch', async () => {
  const frames = createFrames()
  const invalidations = createInvalidationHarness()
  const mountA = { id: 'mount-a' }
  const mountB = { id: 'mount-b' }
  let currentMount = mountA
  const events = []
  const neverReady = new Promise(() => undefined)
  const handle = startDashboardOnlineComponentSurface({
    enabled: true,
    mode: 'editor',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-editor-online',
    bridge: {
      ...emptySurfaceReadinessBridge,
      attach({ mount }) {
        events.push(`attach:${mount.id}`)
        return () => events.push(`release:${mount.id}`)
      },
      getDiagnostics: () => ({ instanceCount: 0, scheduledFrameCount: 0 }),
    },
    markerStore: {},
    persistence: { readArtifact: async () => null },
    document: createSurfaceDocument(() => currentMount),
    ...frames,
    MutationObserver: invalidations.MutationObserver,
    createController: options => {
      const mount = options.surfaceHostOptions.mount
      events.push(`create:${mount.id}`)
      return {
        ...emptySurfaceReadinessController,
        whenReady: () => (mount === mountA ? neverReady : Promise.resolve(true)),
        getDiagnostics: () => ({ state: 'active', instanceCount: 0 }),
        abortOwnedActivation: () => {
          events.push(`abort:${mount.id}`)
          return true
        },
        dispose: () => events.push(`dispose:${mount.id}`),
      }
    },
  })

  const readiness = handle.whenReady(readinessInput([]))
  await Promise.resolve()
  currentMount = mountB
  invalidations.mutationObservers[0].trigger([{ type: 'childList', target: {} }])
  frames.flush()

  assert.equal(await readiness, true)
  assert.deepEqual(events, [
    'create:mount-a',
    'attach:mount-a',
    'abort:mount-a',
    'release:mount-a',
    'dispose:mount-a',
    'create:mount-b',
    'attach:mount-b',
  ])
  handle.dispose()
})

test('surface handle forwards activation readiness and fails closed after release or dispose', async () => {
  const frames = createFrames()
  const mount = { id: 'mount' }
  let resolveReady
  const pendingReady = new Promise(resolve => {
    resolveReady = resolve
  })
  const controller = {
    ...emptySurfaceReadinessController,
    whenReady: () => pendingReady,
    getDiagnostics: () => ({ state: 'active', instanceCount: 1 }),
    dispose: () => undefined,
  }
  const handle = startDashboardOnlineComponentSurface({
    enabled: true,
    mode: 'editor',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-editor-online',
    bridge: {
      ...emptySurfaceReadinessBridge,
      attach: () => () => true,
      getDiagnostics: () => ({ instanceCount: 1, scheduledFrameCount: 0 }),
    },
    markerStore: {},
    persistence: { readArtifact: async () => null },
    document: createSurfaceDocument(() => mount),
    ...frames,
    MutationObserver: false,
    createController: () => controller,
  })

  const pendingSurfaceReadiness = handle.whenReady(readinessInput([]))
  handle.dispose()
  resolveReady(true)
  assert.equal(await pendingSurfaceReadiness, false)
  assert.equal(await handle.whenReady(readinessInput([])), false)

  const readyHandle = startDashboardOnlineComponentSurface({
    enabled: true,
    mode: 'editor',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-editor-online-ready',
    bridge: {
      ...emptySurfaceReadinessBridge,
      attach: () => () => true,
      getDiagnostics: () => ({ instanceCount: 0, scheduledFrameCount: 0 }),
    },
    markerStore: {},
    persistence: { readArtifact: async () => null },
    document: createSurfaceDocument(() => mount),
    ...frames,
    MutationObserver: false,
    createController: () => ({
      ...emptySurfaceReadinessController,
      whenReady: () => Promise.resolve(true),
      getDiagnostics: () => ({ state: 'active', instanceCount: 0 }),
      dispose: () => undefined,
    }),
  })
  assert.equal(await readyHandle.whenReady(readinessInput([])), true)
  readyHandle.dispose()
})

test('surface readiness keeps a transient zero census pending until bridge and controller match the committed host', async () => {
  const mount = { id: 'mount' }
  let bridgeMatches = false
  let controllerMatches = false
  let resolveBridge
  let resolveController
  const bridgeReady = new Promise(resolve => {
    resolveBridge = resolve
  })
  const controllerReady = new Promise(resolve => {
    resolveController = resolve
  })
  const bridge = {
    matchesReadyCensus: () => bridgeMatches,
    whenReady: () => bridgeReady,
    attach: () => () => true,
    getDiagnostics: () => ({ instanceCount: bridgeMatches ? 1 : 0, scheduledFrameCount: 0 }),
  }
  const handle = startDashboardOnlineComponentSurface({
    enabled: true,
    mode: 'editor',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-editor-online',
    bridge,
    markerStore: {},
    persistence: { readArtifact: async () => null },
    document: createSurfaceDocument(() => mount, ['node-1']),
    ...createFrames(),
    MutationObserver: false,
    createController: () => ({
      matchesReadyCensus: () => controllerMatches,
      whenReady: () => controllerReady,
      abortOwnedActivation: () => false,
      getDiagnostics: () => ({ state: 'active', instanceCount: controllerMatches ? 1 : 0 }),
      dispose: () => undefined,
    }),
  })

  let settled = false
  const activationReadiness = handle.whenReady({ expectedInstanceIds: ['node-1'] }).then(value => {
    settled = true
    return value
  })
  await Promise.resolve()
  assert.equal(settled, false)

  bridgeMatches = true
  controllerMatches = true
  resolveBridge(true)
  resolveController(true)
  assert.equal(await activationReadiness, true)
  handle.dispose()
})

test('surface disposal interrupts census readiness without polling or leaked epoch work', async () => {
  const frames = createFrames()
  const mount = { id: 'mount' }
  const never = new Promise(() => undefined)
  const handle = startDashboardOnlineComponentSurface({
    enabled: true,
    mode: 'editor',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-editor-online',
    bridge: {
      matchesReadyCensus: () => false,
      whenReady: () => never,
      attach: () => () => true,
      getDiagnostics: () => ({ instanceCount: 0, scheduledFrameCount: 0 }),
    },
    markerStore: {},
    persistence: { readArtifact: async () => null },
    document: createSurfaceDocument(() => mount, ['node-1']),
    ...frames,
    MutationObserver: false,
    createController: () => ({
      matchesReadyCensus: () => false,
      whenReady: () => never,
      abortOwnedActivation: () => false,
      getDiagnostics: () => ({ state: 'active', instanceCount: 0 }),
      dispose: () => undefined,
    }),
  })
  const activationReadiness = handle.whenReady({ expectedInstanceIds: ['node-1'] })
  handle.dispose()
  assert.equal(frames.size(), 0)
  assert.equal(await activationReadiness, false)
})

test('a synchronous controller register failure leaves a quiescent binding fail-closed', async () => {
  const frames = createFrames()
  const errors = []
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    onError: error => errors.push(error),
  })
  const mount = createMount()
  const handle = startDashboardOnlineComponentSurface({
    enabled: true,
    mode: 'editor',
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'dashboard-editor-online',
    bridge,
    markerStore: {},
    persistence: { readArtifact: async () => null },
    document: createSurfaceDocument(() => mount, ['failed']),
    ...frames,
    MutationObserver: false,
    createController: () => ({
      ...emptySurfaceReadinessController,
      register: () => {
        throw new Error('synchronous register failure')
      },
      update: () => Promise.resolve(false),
      unregister: () => true,
      whenReady: () => Promise.resolve(true),
      getDiagnostics: () => ({ state: 'active', instanceCount: 0 }),
      dispose: () => undefined,
    }),
  })
  const binding = bridge.connect({
    instanceId: 'failed',
    node,
    props: { title: 'failed' },
    element: createElement({ left: 110, top: 60, width: 50, height: 25 }),
  })
  frames.flush()
  assert.equal(errors.length, 1)
  assert.equal(bridge.getDiagnostics().scheduledFrameCount, 0)
  assert.equal(await handle.whenReady({ expectedInstanceIds: ['failed'] }), false)
  assert.equal(frames.size(), 0)
  binding.dispose()
  handle.dispose()
})

test('bridge readiness requires the exact registered census and zero pending or scheduled work', async () => {
  const frames = createFrames()
  const harness = createCancelableController()
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  const mount = createMount()
  bridge.attach({ controller: harness.controller, projectId: 'project-a', mount })
  const binding = bridge.connect({
    instanceId: 'node-1',
    node,
    props: { title: 'pending' },
    element: createElement({ left: 110, top: 60, width: 50, height: 25 }),
  })
  const input = { expectedInstanceIds: ['node-1'], requireRegistered: true }
  let settled = false
  const bridgeReadiness = bridge.whenReady(input).then(value => {
    settled = true
    return value
  })
  assert.equal(bridge.matchesReadyCensus(input), false)
  frames.flush()
  assert.equal(harness.pending.length, 1)
  assert.equal(settled, false)

  harness.pending[0].resolve(true)
  await flushPromiseJobs()
  assert.equal(frames.size(), 1)
  assert.equal(bridge.matchesReadyCensus(input), false)
  frames.flush()
  assert.equal(await bridgeReadiness, true)
  assert.equal(bridge.matchesReadyCensus(input), true)
  binding.dispose()
  bridge.detach()
})

test('bridge readiness never substitutes a same-sized wrong binding census', async () => {
  const frames = createFrames()
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  const mount = createMount()
  const controller = {
    register: () => Promise.resolve(true),
    update: () => Promise.resolve(true),
    unregister: () => true,
  }
  const detach = bridge.attach({ controller, projectId: 'project-a', mount })
  const wrong = bridge.connect({
    instanceId: 'wrong-node',
    node,
    props: {},
    element: createElement({ left: 110, top: 60, width: 50, height: 25 }),
  })
  const input = { expectedInstanceIds: ['expected-node'], requireRegistered: true }
  let settled = false
  const bridgeReadiness = bridge.whenReady(input).then(value => {
    settled = true
    return value
  })
  frames.flush()
  await flushPromiseJobs()
  frames.flush()
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(bridge.matchesReadyCensus(input), false)
  assert.equal(detach(), true)
  assert.equal(await bridgeReadiness, false)
  wrong.dispose()
})

test('abortOwnedActivation is explicit and generic surface dispose never invokes it', () => {
  const frames = createFrames()
  const mount = { id: 'mount' }
  let abortCount = 0
  const createHandle = () =>
    startDashboardOnlineComponentSurface({
      enabled: true,
      mode: 'editor',
      projectId: 'project-a',
      branchId: 'main',
      surfaceId: 'dashboard-editor-online',
      bridge: {
        ...emptySurfaceReadinessBridge,
        attach: () => () => true,
        getDiagnostics: () => ({ instanceCount: 0, scheduledFrameCount: 0 }),
      },
      markerStore: {},
      persistence: { readArtifact: async () => null },
      document: createSurfaceDocument(() => mount),
      ...frames,
      MutationObserver: false,
      createController: () => ({
        ...emptySurfaceReadinessController,
        whenReady: () => Promise.resolve(true),
        abortOwnedActivation: () => {
          abortCount += 1
          return true
        },
        getDiagnostics: () => ({ state: 'active', instanceCount: 0 }),
        dispose: () => undefined,
      }),
    })

  const controlled = createHandle()
  assert.equal(controlled.abortOwnedActivation(), true)
  controlled.dispose()
  assert.equal(abortCount, 1)

  const generic = createHandle()
  generic.dispose()
  assert.equal(abortCount, 1)
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
  assert.deepEqual(
    registrations.map(input => input.generatedZ),
    Array.from({ length: 20 }, (_, index) => index),
    'non-DOM bindings retain deterministic connection-order fallback',
  )
  assert.equal(frames.size(), 1, 'twenty pending settlements must coalesce into one follow-up frame')
  frames.flush()
  assert.equal(frames.size(), 0, 'a stable surface must not retain an animation frame')
  for (const binding of bindings) binding.dispose()
  assert.equal(frames.size(), 0)
})

test('twenty bindings batch resize, scroll, and external mutations into one invalidation frame', async () => {
  const frames = createFrames()
  const invalidations = createInvalidationHarness()
  const root = createElement({ left: 100, top: 50, width: 500, height: 250 })
  const mount = createMount()
  const overlayChild = { overlay: true }
  mount.parentElement = root
  mount.isConnected = true
  mount.contains = target => target?.overlay === true
  const controller = {
    register: () => Promise.resolve(true),
    update: () => Promise.resolve(true),
    unregister: () => true,
  }
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    ...invalidations,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  bridge.attach({ controller, projectId: 'project-a', mount })
  const bindings = Array.from({ length: 20 }, (_, index) =>
    bridge.connect({
      instanceId: `node-${index}`,
      node,
      props: { title: `node-${index}` },
      element: createElement({ left: 110 + index, top: 60, width: 50, height: 25 }),
    }),
  )
  assert.deepEqual(bridge.getDiagnostics(), {
    attached: true,
    instanceCount: 20,
    scheduledFrameCount: 1,
    resizeObserverCount: 1,
    mutationObserverCount: 1,
    listenerCount: 2,
    observedElementCount: 21,
  })
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(frames.size(), 0)

  mount.reads = 0
  root.reads = 0
  invalidations.resizeObservers[0].trigger()
  invalidations.eventTarget.emit('scroll')
  invalidations.eventTarget.emit('resize')
  invalidations.mutationObservers[0].trigger([{ type: 'attributes', target: root }])
  assert.equal(frames.size(), 1)
  frames.flush()
  assert.equal(mount.reads, 1)
  assert.equal(root.reads, 0, 'non-clipping ancestors do not add layout reads')
  assert.equal(frames.size(), 0)

  invalidations.mutationObservers[0].trigger([{ type: 'attributes', target: overlayChild }])
  invalidations.mutationObservers[0].trigger([{ type: 'childList', target: mount }])
  assert.equal(frames.size(), 0, 'overlay-owned DOM mutations must not feed back into layout sampling')
  invalidations.mutationObservers[0].trigger([{ type: 'attributes', target: mount }])
  assert.equal(frames.size(), 1, 'mount visibility mutations remain external invalidations')
  frames.flush()
  assert.equal(frames.size(), 0)

  for (const binding of bindings) binding.dispose()
  assert.deepEqual(bridge.getDiagnostics(), {
    attached: true,
    instanceCount: 0,
    scheduledFrameCount: 0,
    resizeObserverCount: 0,
    mutationObserverCount: 0,
    listenerCount: 0,
    observedElementCount: 0,
  })
  assert.equal(invalidations.eventTarget.listenerCount(), 0)
})

test('generated z-order follows keyed DOM order and recomputes after reorder without reconnecting', async () => {
  const frames = createFrames()
  const invalidations = createInvalidationHarness()
  const root = createElement({ left: 100, top: 50, width: 500, height: 250 })
  const mount = createMount()
  mount.parentElement = root
  mount.isConnected = true
  mount.contains = () => false

  const documentOrder = []
  const createOrderedElement = (id, rect) => {
    const element = { ...createElement(rect), id }
    element.compareDocumentPosition = other => {
      const ownIndex = documentOrder.indexOf(element)
      const otherIndex = documentOrder.indexOf(other)
      if (ownIndex < 0 || otherIndex < 0) return 0x01
      if (ownIndex < otherIndex) return 0x04
      if (ownIndex > otherIndex) return 0x02
      return 0
    }
    return element
  }
  const firstElement = createOrderedElement('first', { left: 110, top: 60, width: 50, height: 25 })
  const secondElement = createOrderedElement('second', { left: 170, top: 60, width: 50, height: 25 })
  documentOrder.push(firstElement, secondElement)

  const registrations = []
  const updates = []
  const unregistered = []
  const controller = {
    register(input) {
      registrations.push(input)
      return Promise.resolve(true)
    },
    update(instanceId, patch) {
      updates.push({ instanceId, ...patch })
      return Promise.resolve(true)
    },
    unregister(instanceId) {
      unregistered.push(instanceId)
      return true
    },
  }
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    ...invalidations,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  bridge.attach({ controller, projectId: 'project-a', mount })

  const secondBinding = bridge.connect({
    instanceId: 'second',
    node,
    props: { title: 'second' },
    element: secondElement,
  })
  const firstBinding = bridge.connect({
    instanceId: 'first',
    node,
    props: { title: 'first' },
    element: firstElement,
  })
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.deepEqual(
    Object.fromEntries(registrations.map(input => [input.instanceId, input.generatedZ])),
    { second: 1, first: 0 },
    'initial z-order follows the DOM rather than connection order',
  )

  documentOrder.splice(0, documentOrder.length, secondElement, firstElement)
  invalidations.mutationObservers[0].trigger([{ type: 'childList', target: root }])
  assert.equal(frames.size(), 1)
  frames.flush()
  await Promise.resolve()
  assert.deepEqual(Object.fromEntries(updates.slice(-2).map(input => [input.instanceId, input.generatedZ])), {
    second: 0,
    first: 1,
  })
  assert.equal(registrations.length, 2)
  assert.deepEqual(unregistered, [])

  frames.flush()
  documentOrder.splice(0, documentOrder.length, firstElement, secondElement)
  assert.equal(
    firstBinding.update({ node, props: { title: 'first' }, element: firstElement }),
    true,
    'normal binding updates invalidate document-order sampling',
  )
  frames.flush()
  await Promise.resolve()
  assert.deepEqual(Object.fromEntries(updates.slice(-2).map(input => [input.instanceId, input.generatedZ])), {
    second: 1,
    first: 0,
  })
  assert.equal(registrations.length, 2)
  assert.deepEqual(unregistered, [])

  firstBinding.dispose()
  secondBinding.dispose()
  assert.deepEqual(unregistered, ['first', 'second'])
})

test('visibility is invalidated by clipping, hidden state, scrolling, resize, and viewport mutation', async () => {
  const frames = createFrames()
  const invalidations = createInvalidationHarness()
  const root = createElement({ left: 100, top: 50, width: 500, height: 250 })
  const mount = createMount()
  mount.parentElement = root
  mount.isConnected = true
  mount.contains = () => false
  const element = createElement({ left: 110, top: 60, width: 50, height: 25 })
  const styles = new Map([
    [root, { display: 'block', visibility: 'visible', overflow: 'hidden' }],
    [mount, { display: 'block', visibility: 'visible' }],
    [element, { display: 'block', visibility: 'visible' }],
  ])
  const patches = []
  const controller = {
    register(input) {
      patches.push(input)
      return Promise.resolve(true)
    },
    update(_instanceId, patch) {
      patches.push(patch)
      return Promise.resolve(true)
    },
    unregister: () => true,
  }
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    ...invalidations,
    getComputedStyle: target => styles.get(target),
  })
  bridge.attach({ controller, projectId: 'project-a', mount })
  const binding = bridge.connect({ instanceId: 'node', node, props: { title: 'visible' }, element })
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(patches.at(-1).visible, true)

  binding.update({ node: { ...node, hidden: true }, props: { title: 'hidden by schema' }, element })
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(patches.at(-1).visible, false, 'the trusted node hidden state must override visible DOM geometry')

  binding.update({ node, props: { title: 'visible' }, element })
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(patches.at(-1).visible, true)

  element.rect = { left: 700, top: 60, width: 50, height: 25 }
  invalidations.eventTarget.emit('scroll')
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(patches.at(-1).visible, false, 'the element must intersect the overlay mount')

  element.rect = { left: 300, top: 60, width: 50, height: 25 }
  root.rect = { left: 100, top: 50, width: 100, height: 250 }
  invalidations.mutationObservers[0].trigger([{ type: 'attributes', target: root }])
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(patches.at(-1).visible, false, 'the element must also intersect the stable viewport clip')

  root.rect = { left: 100, top: 50, width: 500, height: 250 }
  styles.set(element, { display: 'none', visibility: 'visible' })
  invalidations.eventTarget.emit('resize')
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(patches.at(-1).visible, false)

  styles.set(element, { display: 'block', visibility: 'visible' })
  invalidations.resizeObservers[0].trigger()
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(patches.at(-1).visible, true)
  assert.equal(frames.size(), 0)
  binding.dispose()
})

test('overflow clipping ancestors outside the immediate surface parent constrain visibility and are observed', async () => {
  const frames = createFrames()
  const invalidations = createInvalidationHarness()
  const documentRoot = createElement({ left: 0, top: 0, width: 1000, height: 800 })
  const outerClip = createElement({ left: 100, top: 50, width: 100, height: 250 })
  const immediateParent = createElement({ left: 100, top: 50, width: 500, height: 250 })
  immediateParent.parentElement = outerClip
  outerClip.parentElement = documentRoot
  const mount = createMount()
  mount.parentElement = immediateParent
  mount.isConnected = true
  mount.contains = () => false
  const element = createElement({ left: 300, top: 60, width: 50, height: 25 })
  const styles = new Map([
    [documentRoot, { display: 'block', visibility: 'visible', overflow: 'visible' }],
    [outerClip, { display: 'block', visibility: 'visible', overflow: 'hidden' }],
    [immediateParent, { display: 'block', visibility: 'visible', overflow: 'visible' }],
    [mount, { display: 'block', visibility: 'visible', overflow: 'hidden' }],
    [element, { display: 'block', visibility: 'visible' }],
  ])
  const patches = []
  const controller = {
    register(input) {
      patches.push(input)
      return Promise.resolve(true)
    },
    update(_instanceId, patch) {
      patches.push(patch)
      return Promise.resolve(true)
    },
    unregister: () => true,
  }
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    ...invalidations,
    getComputedStyle: target => styles.get(target),
  })
  bridge.attach({ controller, projectId: 'project-a', mount })
  const binding = bridge.connect({ instanceId: 'node', node, props: { title: 'clipped' }, element })
  assert.equal(invalidations.resizeObservers[0].observed.has(outerClip), true)
  assert.equal(invalidations.resizeObservers[0].observed.has(immediateParent), false)
  assert.deepEqual(
    invalidations.mutationObservers[0].observations.map(observation => observation.target),
    [immediateParent, outerClip, documentRoot],
  )
  assert.equal(bridge.getDiagnostics().observedElementCount, 3)
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(patches.at(-1).visible, false)

  element.rect = { left: 120, top: 60, width: 50, height: 25 }
  invalidations.resizeObservers[0].trigger()
  invalidations.mutationObservers[0].trigger([{ type: 'attributes', target: outerClip }])
  assert.equal(frames.size(), 1)
  frames.flush()
  await Promise.resolve()
  frames.flush()
  assert.equal(patches.at(-1).visible, true)
  binding.dispose()
})

test('detach and last-binding disposal release invalidation resources and reconnect cleanly', async () => {
  const frames = createFrames()
  const invalidations = createInvalidationHarness()
  const root = createElement({ left: 100, top: 50, width: 500, height: 250 })
  const mount = createMount()
  mount.parentElement = root
  mount.isConnected = true
  mount.contains = () => false
  const controller = {
    register: () => Promise.resolve(true),
    update: () => Promise.resolve(true),
    unregister: () => true,
  }
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    ...invalidations,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  const detach = bridge.attach({ controller, projectId: 'project-a', mount })
  const binding = bridge.connect({
    instanceId: 'node',
    node,
    props: { title: 'node' },
    element: createElement({ left: 110, top: 60, width: 50, height: 25 }),
  })
  assert.equal(detach(), true)
  assert.equal(frames.size(), 0)
  assert.equal(invalidations.resizeObservers[0].disconnected, true)
  assert.equal(invalidations.mutationObservers[0].disconnected, true)
  assert.equal(invalidations.eventTarget.listenerCount(), 0)
  assert.deepEqual(bridge.getDiagnostics(), {
    attached: false,
    instanceCount: 1,
    scheduledFrameCount: 0,
    resizeObserverCount: 0,
    mutationObserverCount: 0,
    listenerCount: 0,
    observedElementCount: 0,
  })

  bridge.attach({ controller, projectId: 'project-a', mount })
  assert.equal(invalidations.resizeObservers.length, 2)
  assert.equal(invalidations.mutationObservers.length, 2)
  assert.equal(invalidations.eventTarget.listenerCount(), 2)
  frames.flush()
  await Promise.resolve()
  binding.dispose()
  assert.equal(frames.size(), 0)
  assert.equal(invalidations.resizeObservers[1].disconnected, true)
  assert.equal(invalidations.mutationObservers[1].disconnected, true)
  assert.equal(invalidations.eventTarget.listenerCount(), 0)
  assert.equal(bridge.getDiagnostics().attached, true)
  assert.equal(bridge.getDiagnostics().observedElementCount, 0)
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
      document: createSurfaceDocument(() => mount, ['node']),
      ...frames,
      createController: options => ({
        ...emptySurfaceReadinessController,
        register(input) {
          assert.equal(options.surfaceHostOptions.mode, mode)
          payloads.set(mode, input.payload)
          return Promise.resolve(true)
        },
        update: () => Promise.resolve(true),
        unregister: () => true,
        whenReady: () => Promise.resolve(true),
        getDiagnostics: () => ({ state: 'active', instanceCount: 1 }),
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
  assert.equal(updates.length, 0)
  assert.equal(frames.size(), 0, 'dirty state waits without polling while registration is pending')
  resolveRegister(true)
  await Promise.resolve()
  assert.equal(frames.size(), 1, 'pending settlement invalidates the latest dirty snapshot once')
  frames.flush()
  await Promise.resolve()
  assert.equal(updates.length, 1)
  assert.equal(updates[0].payload.props.title, 'final')
  assert.deepEqual(updates[0].rect, { x: 60, y: 40, width: 120, height: 60 })
  assert.equal(frames.size(), 1)
  frames.flush()
  assert.equal(frames.size(), 0)
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
    assert.equal(errors.length, 0, 'stale settlements cannot report into the replacement lifecycle')

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

test('stale true registration cannot unregister a same-ID replacement', async () => {
  const frames = createFrames()
  const events = []
  const pending = []
  const records = new Map()
  const controller = {
    register(input) {
      let resolve
      const operation = new Promise(operationResolve => {
        resolve = operationResolve
      })
      const record = { input, resolve }
      records.set(input.instanceId, record)
      pending.push(record)
      events.push(`register:${input.payload.props.title}`)
      return operation
    },
    update: () => Promise.resolve(true),
    unregister(instanceId) {
      events.push(`unregister:${records.get(instanceId)?.input.payload.props.title ?? 'missing'}`)
      return records.delete(instanceId)
    },
  }
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  bridge.attach({ controller, projectId: 'project-a', mount: createMount() })
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
  pending[0].resolve(true)
  await flushPromiseJobs()
  assert.deepEqual(events, ['register:first', 'unregister:first', 'register:replacement'])
  assert.equal(records.get('node'), pending[1])
  pending[1].resolve(true)
  await flushPromiseJobs()
  replacement.dispose()
  assert.deepEqual(events, ['register:first', 'unregister:first', 'register:replacement', 'unregister:replacement'])
})

test('pending completion from a detached attachment cannot mutate a same-controller reattachment', async () => {
  const frames = createFrames()
  const pending = []
  const updates = []
  const controller = {
    register(input) {
      let resolve
      const operation = new Promise(operationResolve => {
        resolve = operationResolve
      })
      pending.push({ input, resolve })
      return operation
    },
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
  const mount = createMount()
  const element = createElement({ left: 110, top: 60, width: 50, height: 25 })
  const detach = bridge.attach({ controller, projectId: 'project-a', mount })
  const binding = bridge.connect({ instanceId: 'node', node, props: { title: 'initial' }, element })
  frames.flush()
  assert.equal(detach(), true)
  bridge.attach({ controller, projectId: 'project-a', mount })
  frames.flush()
  assert.equal(pending.length, 2)

  pending[0].resolve(true)
  await flushPromiseJobs()
  assert.equal(frames.size(), 0)
  binding.update({ node, props: { title: 'latest' }, element })
  frames.flush()
  assert.equal(updates.length, 0, 'the new attachment remains pending after the stale completion')

  pending[1].resolve(true)
  await flushPromiseJobs()
  frames.flush()
  await flushPromiseJobs()
  assert.equal(updates.length, 1)
  assert.equal(updates[0].payload.props.title, 'latest')
  binding.dispose()
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

test('throwing unregister cannot interrupt frame, observer, listener, or remaining binding cleanup', () => {
  const frames = createFrames()
  const invalidations = createInvalidationHarness()
  const errors = []
  const unregistered = []
  const root = createElement({ left: 100, top: 50, width: 500, height: 250 })
  const mount = createMount()
  mount.parentElement = root
  mount.isConnected = true
  mount.contains = () => false
  const controller = {
    register: () => Promise.resolve(true),
    update: () => Promise.resolve(true),
    unregister(instanceId) {
      unregistered.push(instanceId)
      throw new Error(`unregister failed: ${instanceId}`)
    },
  }
  const bridge = createDashboardOnlineComponentSurfaceBridge({
    ...frames,
    ...invalidations,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    onError: error => errors.push(error),
  })
  const detach = bridge.attach({ controller, projectId: 'project-a', mount })
  const first = bridge.connect({
    instanceId: 'first',
    node,
    props: { title: 'first' },
    element: createElement({ left: 110, top: 60, width: 50, height: 25 }),
  })
  first.dispose()
  assert.equal(frames.size(), 0)
  assert.equal(invalidations.eventTarget.listenerCount(), 0)

  bridge.connect({
    instanceId: 'second',
    node,
    props: { title: 'second' },
    element: createElement({ left: 120, top: 60, width: 50, height: 25 }),
  })
  bridge.connect({
    instanceId: 'third',
    node,
    props: { title: 'third' },
    element: createElement({ left: 130, top: 60, width: 50, height: 25 }),
  })
  assert.equal(detach(), true)
  assert.deepEqual(unregistered, ['first', 'second', 'third'])
  assert.equal(errors.length, 3)
  assert.deepEqual(bridge.getDiagnostics(), {
    attached: false,
    instanceCount: 2,
    scheduledFrameCount: 0,
    resizeObserverCount: 0,
    mutationObserverCount: 0,
    listenerCount: 0,
    observedElementCount: 0,
  })
  assert.equal(invalidations.eventTarget.listenerCount(), 0)
  assert.equal(
    invalidations.resizeObservers.every(observer => observer.disconnected),
    true,
  )
  assert.equal(
    invalidations.mutationObservers.every(observer => observer.disconnected),
    true,
  )
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
    document: createSurfaceDocument(() => mount, ['safe-node']),
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
  let activationReady
  const safeBootReadiness = handle.whenReady({ expectedInstanceIds: ['safe-node'] }).then(value => {
    activationReady = value
  })
  for (let attempt = 0; attempt < 10 && activationReady === undefined; attempt += 1) {
    await Promise.resolve()
    frames.flush()
  }
  await safeBootReadiness
  assert.equal(activationReady, true)
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
      ...emptySurfaceReadinessController,
      register: () => Promise.resolve(true),
      update: () => Promise.resolve(true),
      unregister: () => true,
      whenReady: () => Promise.resolve(true),
      dispose: () => undefined,
      getDiagnostics: () => ({ state: 'active', instanceCount: 0, iframeCount: 0 }),
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
      document: createSurfaceDocument(() => mount),
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
