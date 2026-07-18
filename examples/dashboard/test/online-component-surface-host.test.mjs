import assert from 'node:assert/strict'
import test from 'node:test'
import { createOnlineComponentActivationLifecycle } from '../src/runtime/online-components/activation-lifecycle.mjs'
import { createOnlineComponentSurfaceHost } from '../src/runtime/online-components/surface-host.mjs'
import { ONLINE_COMPONENT_PROTOCOL_VERSION } from '../src/runtime/online-components/surface-protocol.mjs'

const createMarkerStore = initialMarkers => {
  const markers = new Map(initialMarkers)
  const quarantined = new Map()
  const events = []
  return {
    events,
    markers,
    quarantined,
    read(key) {
      events.push(['read', key])
      return markers.get(key)
    },
    write(key, marker) {
      events.push(['write', key, marker.revisionKey])
      markers.set(key, marker)
    },
    clear(key, marker) {
      events.push(['clear', key, marker.revisionKey])
      assert.equal(markers.get(key), marker)
      markers.delete(key)
    },
    quarantine(revisionKey, marker) {
      events.push(['quarantine', revisionKey])
      quarantined.set(revisionKey, marker)
    },
  }
}

const createFakePort = name => ({
  name,
  messages: [],
  closed: false,
  started: false,
  onmessage: undefined,
  postMessage(message) {
    if (this.closed) throw new Error(`${name} is closed`)
    this.messages.push(message)
  },
  start() {
    this.started = true
  },
  close() {
    this.closed = true
  },
  emit(message) {
    this.onmessage?.({ data: message })
  },
})

const createFakeEnvironment = () => {
  const frames = []
  const channels = []
  const animationFrames = new Map()
  const visibilityListeners = new Set()
  let nextAnimationFrame = 1
  let nextNonce = 1

  const environment = {
    frames,
    channels,
    animationFrames,
    visibilityListeners,
    createNonce() {
      return `nonce-${String(nextNonce++).padStart(20, '0')}`
    },
    createMessageChannel() {
      const channel = {
        port1: createFakePort(`host-${channels.length + 1}`),
        port2: createFakePort(`sandbox-${channels.length + 1}`),
      }
      channels.push(channel)
      return channel
    },
    createSandboxFrame(options) {
      const loadListeners = new Set()
      const shells = new Map()
      const frame = {
        options,
        loadListeners,
        shells,
        connections: [],
        disposed: false,
        onLoad(listener) {
          loadListeners.add(listener)
          return () => loadListeners.delete(listener)
        },
        postConnect(message, transferredPort) {
          this.connections.push({ message, transferredPort })
        },
        createShell(input) {
          const trustedElement = { instanceId: input.instanceId }
          const releaseTrustedBinding = input.bindTrustedShell?.(trustedElement, input.instanceId)
          const listenerCount = (options.mode === 'editor' ? 5 : 1) + (releaseTrustedBinding ? 1 : 0)
          const shell = {
            input,
            trustedElement,
            updates: [],
            disposed: false,
            update(next) {
              this.updates.push(next)
            },
            dispatch(type, event = {}) {
              return input.onEvent({ instanceId: input.instanceId, type, event })
            },
            dispose() {
              if (this.disposed) return
              this.disposed = true
              releaseTrustedBinding?.()
              shells.delete(input.instanceId)
            },
            getResourceCounts() {
              return {
                shellCount: this.disposed ? 0 : 1,
                listenerCount: this.disposed ? 0 : listenerCount,
              }
            },
          }
          shells.set(input.instanceId, shell)
          return shell
        },
        triggerLoad() {
          for (const listener of [...loadListeners]) listener()
        },
        getResourceCounts() {
          return {
            iframeCount: this.disposed ? 0 : 1,
            shellCount: [...shells.values()].reduce((count, shell) => count + shell.getResourceCounts().shellCount, 0),
            listenerCount:
              loadListeners.size +
              [...shells.values()].reduce((count, shell) => count + shell.getResourceCounts().listenerCount, 0),
          }
        },
        dispose() {
          this.disposed = true
          loadListeners.clear()
          for (const shell of [...shells.values()]) shell.dispose()
        },
      }
      frames.push(frame)
      return frame
    },
    requestAnimationFrame(callback) {
      const id = nextAnimationFrame++
      animationFrames.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id)
    },
    subscribeVisibility(listener) {
      visibilityListeners.add(listener)
      return () => visibilityListeners.delete(listener)
    },
    flushAnimationFrame() {
      const pending = [...animationFrames.entries()]
      animationFrames.clear()
      for (const [, callback] of pending) callback(16)
    },
    setVisible(visible) {
      for (const listener of [...visibilityListeners]) listener(visible)
    },
    activeResourceCounts() {
      return {
        frames: frames.filter(frame => !frame.disposed).length,
        ports: channels.flatMap(channel => [channel.port1, channel.port2]).filter(port => !port.closed).length,
        shells: frames.reduce((count, frame) => count + frame.shells.size, 0),
        visibilityListeners: visibilityListeners.size,
        animationFrames: animationFrames.size,
      }
    },
  }
  return environment
}

const createInstance = (index, revisionKey = 'artifact-kpi@revision-1') => ({
  instanceId: `node-${index}`,
  revisionKey,
  rect: { x: index * 10, y: index * 5, width: 160, height: 90 },
  visible: true,
  generatedZ: index,
  payload: {
    props: { title: `KPI ${index}` },
    data: { value: index },
    theme: { mode: 'dark' },
    size: { width: 160, height: 90 },
  },
})

const sandboxResources = (frame, instanceCount = frame.shells.size) => ({
  instanceCount,
  listenerCount: 1,
  pendingTaskCount: 0,
  objectUrlCount: 0,
})

const readyMessage = frame => ({
  kind: 'online-component.ready',
  protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
  nonce: frame.options.nonce,
  surfaceId: frame.options.surfaceId,
  generation: frame.options.generation,
  resources: sandboxResources(frame, 0),
})

const acknowledgeLastBatch = (environment, frame = environment.frames.at(-1)) => {
  const port = environment.channels.at(-1).port1
  const batch = port.messages.at(-1)
  port.emit({
    kind: 'online-component.batch-applied',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: frame.options.nonce,
    surfaceId: frame.options.surfaceId,
    generation: frame.options.generation,
    sequence: batch.sequence,
    resources: sandboxResources(frame),
  })
  return batch
}

const makeReady = environment => {
  const frame = environment.frames.at(-1)
  frame.triggerLoad()
  environment.channels.at(-1).port1.emit(readyMessage(frame))
  environment.flushAnimationFrame()
  return frame
}

test('default-off and safe-boot surfaces allocate zero resources', () => {
  const environment = createFakeEnvironment()
  const markerStore = createMarkerStore()
  const disabled = createOnlineComponentSurfaceHost({
    enabled: false,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment,
    markerStore,
  })
  disabled.register(createInstance(1))
  disabled.update('node-1', { payload: { title: 'ignored' } })
  disabled.restart('ignored')
  assert.deepEqual(environment.activeResourceCounts(), {
    frames: 0,
    ports: 0,
    shells: 0,
    visibilityListeners: 0,
    animationFrames: 0,
  })
  assert.deepEqual(disabled.getDiagnostics(), {
    state: 'disabled',
    surfaceId: 'editor-surface',
    mode: 'editor',
    generation: 0,
    iframeCount: 0,
    portCount: 0,
    shellCount: 0,
    instanceCount: 0,
    scheduledFrameCount: 0,
    batchCount: 0,
    pendingBatchCount: 0,
    restartCount: 0,
    faultCount: 0,
    rejectedMessageCount: 0,
    listenerCount: 0,
    pendingActivationCount: 0,
    quarantinedRevisionCount: 0,
    sandboxInstanceCount: 0,
    sandboxListenerCount: 0,
    sandboxPendingTaskCount: 0,
    objectUrlCount: 0,
  })

  const safeBoot = createOnlineComponentSurfaceHost({
    enabled: true,
    safeBoot: true,
    mount: {},
    mode: 'preview',
    surfaceId: 'preview-surface',
    activationId: 'tab-b',
    environment,
    markerStore,
  })
  assert.equal(safeBoot.register(createInstance(2)), false)
  assert.equal(safeBoot.getDiagnostics().state, 'safe-boot')
  assert.equal(environment.frames.length, 0)
  assert.equal(environment.channels.length, 0)
  assert.equal(environment.visibilityListeners.size, 0)
})

test('twenty instances share one iframe and one render batch per animation frame', () => {
  const environment = createFakeEnvironment()
  const markerStore = createMarkerStore()
  const runtimeEvents = []
  const selections = []
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment,
    markerStore,
    onSelection: event => selections.push(event),
    onRuntimeEvent: event => runtimeEvents.push(event),
  })

  for (let index = 0; index < 20; index += 1) host.register(createInstance(index))
  assert.equal(environment.frames.length, 1)
  assert.equal(environment.channels.length, 1)
  assert.equal(environment.frames[0].shells.size, 20)
  assert.equal(markerStore.events.filter(event => event[0] === 'write').length, 1)

  const frame = makeReady(environment)
  const firstBatch = environment.channels[0].port1.messages.at(-1)
  assert.equal(firstBatch.kind, 'online-component.render-batch')
  assert.equal(firstBatch.updates.length, 20)
  assert.equal(environment.channels[0].port1.messages.length, 1)
  assert.equal(host.getDiagnostics().listenerCount, 103)
  assert.equal(host.getDiagnostics().pendingBatchCount, 1)
  assert.equal(host.getDiagnostics().sandboxInstanceCount, 0)
  assert.equal(host.getDiagnostics().sandboxListenerCount, 1)
  acknowledgeLastBatch(environment, frame)
  assert.equal(markerStore.markers.size, 0)
  assert.equal(host.getDiagnostics().pendingActivationCount, 0)
  assert.equal(host.getDiagnostics().pendingBatchCount, 0)
  assert.equal(host.getDiagnostics().sandboxInstanceCount, 20)
  assert.equal(host.getDiagnostics().sandboxPendingTaskCount, 0)
  assert.equal(host.getDiagnostics().objectUrlCount, 0)

  for (let index = 0; index < 20; index += 1) {
    host.update(`node-${index}`, {
      rect: { x: index * 20, y: index * 10, width: 180, height: 100 },
      payload: { props: { title: `Updated ${index}` } },
    })
  }
  assert.equal(environment.animationFrames.size, 1)
  environment.flushAnimationFrame()
  assert.equal(environment.channels[0].port1.messages.length, 2)
  assert.equal(environment.channels[0].port1.messages.at(-1).updates.length, 20)
  assert.equal(host.getDiagnostics().batchCount, 2)

  environment.frames[0].shells.get('node-1').dispatch('select', { button: 0, clientX: 1, clientY: 2 })
  assert.equal(selections.length, 1)
  assert.equal(runtimeEvents.length, 0)
})

test('activation readiness settles only after the matching render batch clears the pending marker', async () => {
  const environment = createFakeEnvironment()
  const markerStore = createMarkerStore()
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment,
    markerStore,
  })

  host.register(createInstance(1))
  let settled = false
  const readiness = host.whenReady({ expectedInstanceIds: ['node-1'] }).then(value => {
    settled = true
    return value
  })
  const frame = makeReady(environment)
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(markerStore.markers.size, 1)
  assert.equal(host.getDiagnostics().pendingActivationCount, 1)

  acknowledgeLastBatch(environment, frame)
  assert.equal(await readiness, true)
  assert.equal(markerStore.markers.size, 0)
  assert.equal(host.getDiagnostics().pendingActivationCount, 0)
  assert.equal(await host.whenReady({ expectedInstanceIds: ['node-1'] }), true)
})

test('abortPending clears only its captured marker identity and never a replacement marker', () => {
  const markers = new Map()
  const store = {
    read: key => markers.get(key),
    write: (key, marker) => markers.set(key, marker),
    clear: (key, marker) => {
      if (markers.get(key) === marker) markers.delete(key)
    },
    quarantine: () => undefined,
  }
  const lifecycle = createOnlineComponentActivationLifecycle({
    markerStore: store,
    revisionKey: 'artifact-owned-revision',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    nonce: 'nonce-owned-0000000001',
    now: () => 1,
  })
  const decision = lifecycle.begin()
  assert.equal(decision.activate, true)
  const replacement = Object.freeze({ ...decision.marker, nonce: 'nonce-foreign-000000001' })
  markers.set('artifact-owned-revision::editor-surface', replacement)

  assert.equal(lifecycle.abortPending(), true)
  assert.equal(markers.get('artifact-owned-revision::editor-surface'), replacement)
  assert.equal(lifecycle.getDiagnostics().state, 'disposed')
  lifecycle.dispose()
  assert.equal(markers.get('artifact-owned-revision::editor-surface'), replacement)
})

test('abortOwnedActivation retires shells before clearing owned pending markers and ignores late ACKs', async () => {
  const environment = createFakeEnvironment()
  const markerStore = createMarkerStore()
  const createHost = () =>
    createOnlineComponentSurfaceHost({
      enabled: true,
      mount: {},
      mode: 'editor',
      surfaceId: 'editor-surface',
      activationId: 'tab-a',
      environment,
      markerStore,
    })
  const host = createHost()
  host.register(createInstance(1))
  const frame = makeReady(environment)
  const port = environment.channels.at(-1).port1
  const batch = port.messages.at(-1)
  assert.equal(markerStore.markers.size, 1)
  assert.equal(host.getDiagnostics().shellCount, 1)

  assert.equal(host.abortOwnedActivation(), true)
  assert.equal(markerStore.markers.size, 0)
  assert.equal(host.getDiagnostics().instanceCount, 0)
  assert.equal(host.getDiagnostics().iframeCount, 0)
  assert.equal(frame.disposed, true)
  port.emit({
    kind: 'online-component.batch-applied',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: frame.options.nonce,
    surfaceId: frame.options.surfaceId,
    generation: frame.options.generation,
    sequence: batch.sequence,
    resources: sandboxResources(frame),
  })
  assert.equal(markerStore.markers.size, 0)
  assert.equal(host.getDiagnostics().state, 'idle')
  host.dispose()

  const remounted = createHost()
  assert.equal(typeof remounted.register(createInstance(1)), 'function')
  const remountedFrame = makeReady(environment)
  acknowledgeLastBatch(environment, remountedFrame)
  assert.equal(await remounted.whenReady({ expectedInstanceIds: ['node-1'] }), true)
  remounted.dispose()
})

test('generic dispose preserves a pending marker so a reload quarantines the revision', () => {
  const markerStore = createMarkerStore()
  const first = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment: createFakeEnvironment(),
    markerStore,
  })
  first.register(createInstance(1))
  assert.equal(markerStore.markers.size, 1)
  first.dispose()
  assert.equal(markerStore.markers.size, 1)

  const reloaded = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment: createFakeEnvironment(),
    markerStore,
  })
  assert.equal(reloaded.register(createInstance(1)), false)
  assert.equal(reloaded.getDiagnostics().state, 'quarantined')
  assert.equal(markerStore.quarantined.has('artifact-kpi@revision-1'), true)
  reloaded.dispose()
})

test('pending activation readiness resolves false on unregister, dispose, fault, and quarantine', async t => {
  const createHost = (environment, markerStore = createMarkerStore()) =>
    createOnlineComponentSurfaceHost({
      enabled: true,
      mount: {},
      mode: 'editor',
      surfaceId: 'editor-surface',
      activationId: 'tab-a',
      environment,
      markerStore,
    })

  await t.test('unregister', async () => {
    const environment = createFakeEnvironment()
    const markerStore = createMarkerStore()
    const host = createHost(environment, markerStore)
    host.register(createInstance(1))
    assert.equal(markerStore.markers.size, 1)
    const readiness = host.whenReady({ expectedInstanceIds: ['node-1'] })
    assert.equal(host.unregister('node-1'), true)
    assert.equal(await readiness, false)
    assert.equal(await host.whenReady({ expectedInstanceIds: [] }), true)
    assert.equal(markerStore.markers.size, 0)
  })

  await t.test('dispose', async () => {
    const environment = createFakeEnvironment()
    const host = createHost(environment)
    host.register(createInstance(1))
    const readiness = host.whenReady({ expectedInstanceIds: ['node-1'] })
    host.dispose()
    assert.equal(await readiness, false)
    assert.equal(await host.whenReady({ expectedInstanceIds: [] }), false)
  })

  await t.test('fault', async () => {
    const environment = createFakeEnvironment()
    const host = createHost(environment)
    host.register(createInstance(1))
    const readiness = host.whenReady({ expectedInstanceIds: ['node-1'] })
    const frame = makeReady(environment)
    environment.channels[0].port1.emit({
      kind: 'online-component.fault',
      protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
      nonce: frame.options.nonce,
      surfaceId: frame.options.surfaceId,
      generation: frame.options.generation,
      code: 'render-failed',
      instanceId: 'node-1',
      resources: sandboxResources(frame, 0),
    })
    assert.equal(await readiness, false)
    assert.equal(host.getDiagnostics().state, 'quarantined')
  })

  await t.test('quarantine', async () => {
    const environment = createFakeEnvironment()
    const revisionKey = 'artifact-bad@revision-1'
    const markerStore = createMarkerStore([
      [
        `${revisionKey}::editor-surface`,
        {
          state: 'pending',
          revisionKey,
          surfaceId: 'editor-surface',
          activationId: 'tab-a',
          nonce: 'nonce-stale-0000000000',
          startedAt: 1,
        },
      ],
    ])
    const host = createHost(environment, markerStore)
    assert.equal(host.register(createInstance(1, revisionKey)), false)
    assert.equal(await host.whenReady({ expectedInstanceIds: ['node-1'] }), false)
  })
})

test('editor trusted shell bindings are surface-owned across restart, unregister, and dispose', () => {
  const environment = createFakeEnvironment()
  const events = []
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment,
    markerStore: createMarkerStore(),
    bindTrustedShell: (shell, instanceId) => {
      events.push(['bind', instanceId, shell])
      let active = true
      return () => {
        if (!active) return
        active = false
        events.push(['release', instanceId, shell])
      }
    },
  })

  host.register(createInstance(1))
  const firstShell = environment.frames[0].shells.get('node-1').trustedElement
  assert.deepEqual(events, [['bind', 'node-1', firstShell]])
  const firstFrame = makeReady(environment)
  acknowledgeLastBatch(environment, firstFrame)
  host.restart('test-restart')
  environment.flushAnimationFrame()
  const secondShell = environment.frames.at(-1).shells.get('node-1').trustedElement
  assert.notEqual(secondShell, firstShell)
  assert.deepEqual(events, [
    ['bind', 'node-1', firstShell],
    ['release', 'node-1', firstShell],
    ['bind', 'node-1', secondShell],
  ])

  const secondFrame = makeReady(environment)
  acknowledgeLastBatch(environment, secondFrame)
  host.unregister('node-1')
  assert.deepEqual(events.at(-1), ['release', 'node-1', secondShell])
  host.register(createInstance(1))
  const thirdShell = environment.frames.at(-1).shells.get('node-1').trustedElement
  host.dispose()
  assert.deepEqual(events.at(-1), ['release', 'node-1', thirdShell])
  assert.equal(events.filter(([type]) => type === 'bind').length, 3)
  assert.equal(events.filter(([type]) => type === 'release').length, 3)

  assert.throws(
    () =>
      createOnlineComponentSurfaceHost({
        enabled: true,
        mount: {},
        mode: 'preview',
        surfaceId: 'preview-surface',
        activationId: 'tab-b',
        environment: createFakeEnvironment(),
        markerStore: createMarkerStore(),
        bindTrustedShell: () => () => undefined,
      }),
    /preview surfaces cannot bind trusted drag shells/,
  )
})

test('out-of-order acknowledgements are rejected and reported object URL leaks quarantine activation', () => {
  const environment = createFakeEnvironment()
  const markerStore = createMarkerStore()
  const telemetry = []
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'preview',
    surfaceId: 'preview-surface',
    activationId: 'tab-b',
    environment,
    markerStore,
    telemetry: { record: event => telemetry.push(structuredClone(event)) },
    telemetryNow: () => 123,
  })
  host.register(createInstance(1))
  const frame = makeReady(environment)
  const port = environment.channels[0].port1
  const batch = port.messages.at(-1)

  port.emit({
    kind: 'online-component.batch-applied',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: frame.options.nonce,
    surfaceId: frame.options.surfaceId,
    generation: frame.options.generation,
    sequence: batch.sequence + 1,
    resources: sandboxResources(frame, 1),
  })
  assert.equal(host.getDiagnostics().rejectedMessageCount, 1)
  assert.equal(host.getDiagnostics().pendingBatchCount, 1)

  port.emit({
    kind: 'online-component.batch-applied',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: frame.options.nonce,
    surfaceId: frame.options.surfaceId,
    generation: frame.options.generation,
    sequence: batch.sequence,
    resources: { ...sandboxResources(frame, 1), objectUrlCount: 1 },
  })
  assert.equal(host.getDiagnostics().state, 'quarantined')
  assert.equal(host.getDiagnostics().faultCount, 1)
  assert.equal(host.getDiagnostics().objectUrlCount, 0)
  assert.equal(markerStore.markers.size, 1)
  assert.equal(frame.disposed, true)
  assert.deepEqual(
    telemetry.map(event => [event.eventType, event.status]),
    [
      ['dashboard.iframe.batch', 'scheduled'],
      ['dashboard.iframe.fault', 'failed'],
    ],
  )
  assert.equal(telemetry[0].batchSize, 1)
  assert.equal(telemetry[0].instanceCount, 1)
  assert.equal(telemetry[1].diagnosticCode, 'resource-leak')
  assert.doesNotMatch(JSON.stringify(telemetry), /payload|sourceText|cssText/u)
})

test('unknown sandbox fault codes collapse to a finite telemetry diagnostic', () => {
  const environment = createFakeEnvironment()
  const telemetry = []
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'preview',
    surfaceId: 'preview-surface',
    activationId: 'tab-b',
    environment,
    markerStore: createMarkerStore(),
    telemetry: { record: event => telemetry.push(structuredClone(event)) },
    telemetryNow: () => 123,
  })
  host.register(createInstance(1))
  const frame = makeReady(environment)

  environment.channels[0].port1.emit({
    kind: 'online-component.fault',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: frame.options.nonce,
    surfaceId: frame.options.surfaceId,
    generation: frame.options.generation,
    code: 'sk-live-secret',
    instanceId: null,
    resources: sandboxResources(frame, 1),
  })

  const fault = telemetry.find(event => event.eventType === 'dashboard.iframe.fault')
  assert.equal(fault?.diagnosticCode, 'sandbox-fault')
  assert.doesNotMatch(JSON.stringify(telemetry), /sk-live-secret/u)
  host.dispose()
})

test('editor and preview allocate independent iframe, port, generation, and fault state', () => {
  const editorEnvironment = createFakeEnvironment()
  const previewEnvironment = createFakeEnvironment()
  const editor = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment: editorEnvironment,
    markerStore: createMarkerStore(),
  })
  const preview = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'preview',
    surfaceId: 'preview-surface',
    activationId: 'tab-b',
    environment: previewEnvironment,
    markerStore: createMarkerStore(),
  })
  editor.register(createInstance(1))
  preview.register(createInstance(1))
  const editorFrame = makeReady(editorEnvironment)
  const previewFrame = makeReady(previewEnvironment)

  editorEnvironment.channels[0].port1.emit({
    kind: 'online-component.fault',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: editorFrame.options.nonce,
    surfaceId: editorFrame.options.surfaceId,
    generation: editorFrame.options.generation,
    code: 'global-pollution',
    instanceId: null,
    resources: sandboxResources(editorFrame, 1),
  })

  assert.equal(editorEnvironment.frames.length, 1)
  assert.equal(editorFrame.disposed, true)
  assert.equal(editor.getDiagnostics().generation, 1)
  assert.equal(editor.getDiagnostics().restartCount, 0)
  assert.equal(editor.getDiagnostics().faultCount, 1)
  assert.equal(editor.getDiagnostics().quarantinedRevisionCount, 1)
  assert.equal(previewEnvironment.frames.length, 1)
  assert.equal(preview.getDiagnostics().generation, 1)
  assert.equal(preview.getDiagnostics().restartCount, 0)
  assert.equal(previewFrame.disposed, false)
})

test('hidden surfaces pause and coalesce work until visible', () => {
  const environment = createFakeEnvironment()
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'preview',
    surfaceId: 'preview-surface',
    activationId: 'tab-b',
    environment,
    markerStore: createMarkerStore(),
  })
  host.register(createInstance(1))
  makeReady(environment)
  acknowledgeLastBatch(environment)
  const messageCount = environment.channels[0].port1.messages.length

  environment.setVisible(false)
  host.update('node-1', { payload: { props: { title: 'hidden-1' } } })
  host.update('node-1', { payload: { props: { title: 'hidden-2' } } })
  assert.equal(environment.animationFrames.size, 0)
  assert.equal(environment.channels[0].port1.messages.length, messageCount)

  environment.setVisible(true)
  assert.equal(environment.animationFrames.size, 1)
  environment.flushAnimationFrame()
  assert.equal(environment.channels[0].port1.messages.length, messageCount + 1)
  assert.deepEqual(environment.channels[0].port1.messages.at(-1).updates[0].payload, {
    props: { title: 'hidden-2' },
  })
})

test('a revision restart supersedes an already scheduled batch without leaking it to the old frame', () => {
  const environment = createFakeEnvironment()
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment,
    markerStore: createMarkerStore(),
  })
  host.register(createInstance(1))
  const firstFrame = makeReady(environment)
  acknowledgeLastBatch(environment, firstFrame)
  const firstChannel = environment.channels[0]
  const firstGenerationMessageCount = firstChannel.port1.messages.length

  host.update('node-1', {
    rect: { x: 70, y: 35, width: 180, height: 100 },
  })
  host.update('node-1', {
    revisionKey: 'artifact-kpi@revision-2',
    payload: { props: { title: 'new revision wins' } },
  })
  assert.equal(environment.animationFrames.size, 1)

  environment.flushAnimationFrame()

  assert.equal(firstFrame.disposed, true)
  assert.equal(firstChannel.port1.closed, true)
  assert.equal(firstChannel.port2.closed, true)
  assert.equal(firstChannel.port1.messages.length, firstGenerationMessageCount)
  assert.equal(environment.frames.length, 2)
  assert.equal(host.getDiagnostics().generation, 2)
  assert.equal(host.getDiagnostics().restartCount, 1)

  const secondFrame = makeReady(environment)
  const rehydrate = environment.channels[1].port1.messages.at(-1)
  assert.equal(rehydrate.updates.length, 1)
  assert.equal(rehydrate.updates[0].revisionKey, 'artifact-kpi@revision-2')
  assert.deepEqual(rehydrate.updates[0].rect, { x: 70, y: 35, width: 180, height: 100 })
  assert.deepEqual(rehydrate.updates[0].payload, { props: { title: 'new revision wins' } })
  acknowledgeLastBatch(environment, secondFrame)
})

test('a second frame load after rehydrate quarantines the active revision and releases every resource', () => {
  const environment = createFakeEnvironment()
  const markerStore = createMarkerStore()
  const revisionKey = 'artifact-reload@revision-1'
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment,
    markerStore,
  })
  host.register(createInstance(1, revisionKey))
  const frame = makeReady(environment)
  acknowledgeLastBatch(environment, frame)
  assert.equal(markerStore.markers.size, 0)
  assert.equal(host.getDiagnostics().state, 'ready')
  assert.deepEqual(environment.activeResourceCounts(), {
    frames: 1,
    ports: 2,
    shells: 1,
    visibilityListeners: 1,
    animationFrames: 0,
  })

  frame.triggerLoad()

  assert.equal(environment.frames.length, 1)
  assert.equal(frame.disposed, true)
  assert.equal(frame.loadListeners.size, 0)
  assert.equal(frame.shells.size, 0)
  assert.equal(environment.channels[0].port1.onmessage, undefined)
  assert.equal(environment.channels[0].port1.closed, true)
  assert.equal(environment.channels[0].port2.closed, true)
  assert.equal(markerStore.markers.size, 1)
  assert.equal(markerStore.quarantined.has(revisionKey), true)
  assert.deepEqual(environment.activeResourceCounts(), {
    frames: 0,
    ports: 0,
    shells: 0,
    visibilityListeners: 0,
    animationFrames: 0,
  })
  assert.deepEqual(host.getDiagnostics(), {
    state: 'quarantined',
    surfaceId: 'editor-surface',
    mode: 'editor',
    generation: 1,
    iframeCount: 0,
    portCount: 0,
    shellCount: 0,
    instanceCount: 1,
    scheduledFrameCount: 0,
    batchCount: 1,
    pendingBatchCount: 0,
    restartCount: 0,
    faultCount: 1,
    rejectedMessageCount: 0,
    listenerCount: 0,
    pendingActivationCount: 0,
    quarantinedRevisionCount: 1,
    sandboxInstanceCount: 0,
    sandboxListenerCount: 0,
    sandboxPendingTaskCount: 0,
    objectUrlCount: 0,
  })
})

test('revision changes and valid faults replace the entire iframe then deterministically rehydrate', () => {
  const environment = createFakeEnvironment()
  const markerStore = createMarkerStore()
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment,
    markerStore,
  })
  for (let index = 0; index < 3; index += 1) host.register(createInstance(index))
  const firstFrame = makeReady(environment)
  acknowledgeLastBatch(environment, firstFrame)
  const firstChannel = environment.channels[0]

  host.update('node-1', {
    revisionKey: 'artifact-kpi@revision-2',
    payload: { props: { title: 'new revision' } },
  })
  host.update('node-2', {
    revisionKey: 'artifact-kpi@revision-2',
    payload: { props: { title: 'same new revision' } },
  })
  assert.equal(firstFrame.disposed, false)
  assert.equal(environment.animationFrames.size, 1)
  environment.flushAnimationFrame()
  assert.equal(firstFrame.disposed, true)
  assert.equal(firstChannel.port1.closed, true)
  assert.equal(firstChannel.port2.closed, true)
  assert.equal(environment.frames.length, 2)
  assert.equal(host.getDiagnostics().generation, 2)
  assert.equal(host.getDiagnostics().restartCount, 1)
  assert.equal(markerStore.markers.size, 2)

  const secondFrame = makeReady(environment)
  const rehydrate = environment.channels[1].port1.messages.at(-1)
  assert.deepEqual(
    rehydrate.updates.map(update => update.instanceId),
    ['node-0', 'node-1', 'node-2'],
  )
  acknowledgeLastBatch(environment, secondFrame)
  assert.equal(markerStore.markers.size, 0)

  environment.channels[1].port1.emit({
    kind: 'online-component.fault',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: 'nonce-forged-0000000000',
    surfaceId: secondFrame.options.surfaceId,
    generation: secondFrame.options.generation,
    code: 'render-failed',
    instanceId: 'node-1',
    resources: sandboxResources(secondFrame, 3),
  })
  assert.equal(environment.frames.length, 2)
  assert.equal(host.getDiagnostics().rejectedMessageCount, 1)

  environment.channels[1].port1.emit({
    kind: 'online-component.fault',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: secondFrame.options.nonce,
    surfaceId: secondFrame.options.surfaceId,
    generation: secondFrame.options.generation,
    code: 'render-failed',
    instanceId: 'node-1',
    resources: sandboxResources(secondFrame, 3),
  })
  assert.equal(environment.frames.length, 3)
  assert.equal(host.getDiagnostics().restartCount, 2)
  assert.equal(host.getDiagnostics().quarantinedRevisionCount, 1)
  assert.deepEqual([...environment.frames[2].shells.keys()], ['node-0'])
})

test('a faulted active revision is persisted as quarantined and cannot reactivate after reload', () => {
  const markerStore = createMarkerStore()
  const firstEnvironment = createFakeEnvironment()
  const firstHost = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment: firstEnvironment,
    markerStore,
  })
  firstHost.register(createInstance(1, 'artifact-bad@revision-1'))
  const firstFrame = makeReady(firstEnvironment)
  acknowledgeLastBatch(firstEnvironment, firstFrame)
  assert.equal(markerStore.markers.size, 0)

  firstEnvironment.channels[0].port1.emit({
    kind: 'online-component.fault',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: firstFrame.options.nonce,
    surfaceId: firstFrame.options.surfaceId,
    generation: firstFrame.options.generation,
    code: 'async-lifecycle',
    instanceId: 'node-1',
    resources: sandboxResources(firstFrame, 1),
  })
  assert.equal(firstHost.getDiagnostics().state, 'quarantined')
  assert.equal(firstHost.getDiagnostics().faultCount, 1)
  assert.equal(markerStore.markers.size, 1)
  assert.equal(markerStore.quarantined.has('artifact-bad@revision-1'), true)
  firstHost.dispose()

  const reloadEnvironment = createFakeEnvironment()
  const reloadedHost = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-reloaded',
    environment: reloadEnvironment,
    markerStore,
  })
  assert.equal(reloadedHost.register(createInstance(1, 'artifact-bad@revision-1')), false)
  assert.equal(reloadedHost.getDiagnostics().state, 'quarantined')
  assert.equal(reloadEnvironment.frames.length, 0)
  assert.equal(reloadEnvironment.channels.length, 0)
  assert.equal(reloadEnvironment.visibilityListeners.size, 0)
})

test('a stale activation marker quarantines the revision before frame, port, listener, or shell creation', () => {
  const environment = createFakeEnvironment()
  const markerKey = 'artifact-bad@revision-1::editor-surface'
  const markerStore = createMarkerStore([
    [
      markerKey,
      {
        state: 'pending',
        revisionKey: 'artifact-bad@revision-1',
        surfaceId: 'editor-surface',
        activationId: 'tab-a',
        nonce: 'nonce-stale-0000000000',
        startedAt: 1,
      },
    ],
  ])
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'editor',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    environment,
    markerStore,
  })

  assert.equal(host.register(createInstance(1, 'artifact-bad@revision-1')), false)
  assert.equal(markerStore.quarantined.has('artifact-bad@revision-1'), true)
  assert.deepEqual(environment.activeResourceCounts(), {
    frames: 0,
    ports: 0,
    shells: 0,
    visibilityListeners: 0,
    animationFrames: 0,
  })
  assert.equal(host.getDiagnostics().state, 'quarantined')
})

test('dispose cancels scheduling and releases registrations, frames, ports, shells, and listeners', () => {
  const environment = createFakeEnvironment()
  const host = createOnlineComponentSurfaceHost({
    enabled: true,
    mount: {},
    mode: 'preview',
    surfaceId: 'preview-surface',
    activationId: 'tab-b',
    environment,
    markerStore: createMarkerStore(),
  })
  host.register(createInstance(1))
  host.register(createInstance(2))
  makeReady(environment)
  host.update('node-1', { payload: { props: { title: 'pending frame' } } })
  assert.equal(environment.animationFrames.size, 1)

  host.dispose()
  assert.deepEqual(environment.activeResourceCounts(), {
    frames: 0,
    ports: 0,
    shells: 0,
    visibilityListeners: 0,
    animationFrames: 0,
  })
  assert.deepEqual(host.getDiagnostics(), {
    state: 'disposed',
    surfaceId: 'preview-surface',
    mode: 'preview',
    generation: 1,
    iframeCount: 0,
    portCount: 0,
    shellCount: 0,
    instanceCount: 0,
    scheduledFrameCount: 0,
    batchCount: 1,
    pendingBatchCount: 0,
    restartCount: 0,
    faultCount: 0,
    rejectedMessageCount: 0,
    listenerCount: 0,
    pendingActivationCount: 0,
    quarantinedRevisionCount: 0,
    sandboxInstanceCount: 0,
    sandboxListenerCount: 0,
    sandboxPendingTaskCount: 0,
    objectUrlCount: 0,
  })
  assert.throws(() => host.register(createInstance(3)), /disposed/)
})
