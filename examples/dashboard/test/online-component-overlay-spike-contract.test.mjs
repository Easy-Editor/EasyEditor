import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT,
  createOnlineComponentActivationLifecycle,
  projectCanvasRectToViewport,
} from '../spikes/online-component-overlay/surface-spike.mjs'

const spikeSourcePath = resolve(
  new URL('..', import.meta.url).pathname,
  'spikes/online-component-overlay/surface-spike.mjs',
)

test('viewport-local projection covers zoom, scroll, clipping, and device scale', () => {
  const projection = projectCanvasRectToViewport(
    { x: 90, y: 60, width: 100, height: 80 },
    {
      left: 10,
      top: 20,
      width: 100,
      height: 75,
      scale: 0.5,
      scrollLeft: 10,
      scrollTop: 20,
      deviceScaleFactor: 2,
    },
  )

  assert.deepEqual(projection.cssRect, { x: 50, y: 40, width: 50, height: 40 })
  assert.deepEqual(projection.visibleCssRect, { x: 50, y: 40, width: 50, height: 40 })
  assert.deepEqual(projection.deviceRect, { x: 100, y: 80, width: 100, height: 80 })
  assert.equal(projection.visible, true)

  const clipped = projectCanvasRectToViewport(
    { x: 190, y: 120, width: 80, height: 40 },
    { left: 10, top: 20, width: 100, height: 75, scale: 0.5, scrollLeft: 10, scrollTop: 20 },
  )
  assert.deepEqual(clipped.visibleCssRect, { x: 100, y: 70, width: 10, height: 20 })

  const outside = projectCanvasRectToViewport(
    { x: 400, y: 400, width: 20, height: 20 },
    { left: 10, top: 20, width: 100, height: 75, scale: 0.5 },
  )
  assert.equal(outside.visible, false)
})

test('spike source freezes the sandbox and trusted-shell boundary without private selector discovery', async () => {
  const source = await readFile(spikeSourcePath, 'utf8')

  assert.equal(ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT.coordinateModel, 'surface-viewport-local')
  assert.equal(ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT.iframeSandbox, 'allow-scripts')
  assert.equal(ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT.iframePointerEvents, 'none')
  assert.equal(ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT.cpuBoundary, 'synchronous-cpu-containment-is-not-guaranteed')
  assert.match(source, /new MessageChannel\(\)/)
  assert.match(source, /frame\.setAttribute\('sandbox'/)
  assert.match(source, /event\.source !== parent/)
  assert.doesNotMatch(source, /querySelector\(['"`]\.lc-/)
  assert.doesNotMatch(source, /allow-same-origin/)
})

test('injected activation markers clear on heartbeat, quarantine stale revisions, and skip activation in safe boot', () => {
  const createStore = initialMarker => {
    let marker = initialMarker
    const events = []
    return {
      events,
      read: key => {
        events.push(['read', key])
        return marker
      },
      write: (key, value) => {
        marker = value
        events.push(['write', key, value.state])
      },
      clear: (key, value) => {
        assert.equal(value, marker)
        marker = undefined
        events.push(['clear', key])
      },
      quarantine: (key, value) => events.push(['quarantine', key, value.state]),
      get marker() {
        return marker
      },
    }
  }

  const activeStore = createStore()
  const active = createOnlineComponentActivationLifecycle({
    markerStore: activeStore,
    revisionKey: 'artifact@active',
    surfaceId: 'editor-surface',
    nonce: 'nonce-active',
    now: () => 1_000,
  })
  assert.deepEqual(active.begin(), {
    activate: true,
    state: 'pending',
    marker: {
      state: 'pending',
      revisionKey: 'artifact@active',
      surfaceId: 'editor-surface',
      nonce: 'nonce-active',
      startedAt: 1_000,
    },
  })
  assert.equal(activeStore.marker.state, 'pending')
  assert.equal(active.heartbeat(), true)
  assert.equal(activeStore.marker, undefined)
  assert.equal(active.getDiagnostics().state, 'heartbeat-cleared')

  const staleMarker = { state: 'pending', revisionKey: 'artifact@bad', startedAt: 100 }
  const quarantinedStore = createStore(staleMarker)
  const quarantined = createOnlineComponentActivationLifecycle({
    markerStore: quarantinedStore,
    revisionKey: 'artifact@bad',
    surfaceId: 'preview-surface',
    nonce: 'nonce-quarantined',
    now: () => 2_000,
  })
  assert.deepEqual(quarantined.begin(), {
    activate: false,
    state: 'quarantined',
    reason: 'stale-pending-marker',
  })
  assert.equal(quarantinedStore.marker, staleMarker)
  assert.deepEqual(
    quarantinedStore.events.map(event => event[0]),
    ['read', 'quarantine'],
  )

  const pendingStore = createStore()
  const pending = createOnlineComponentActivationLifecycle({
    markerStore: pendingStore,
    revisionKey: 'artifact@pending',
    surfaceId: 'editor-surface',
    nonce: 'nonce-pending',
    now: () => 2_500,
  })
  assert.equal(pending.begin().activate, true)
  assert.equal(pending.dispose(), false)
  assert.equal(pendingStore.marker.state, 'pending')
  const reload = createOnlineComponentActivationLifecycle({
    markerStore: pendingStore,
    revisionKey: 'artifact@pending',
    surfaceId: 'editor-surface',
    nonce: 'nonce-reload',
    now: () => 2_600,
  })
  assert.deepEqual(reload.begin(), {
    activate: false,
    state: 'quarantined',
    reason: 'stale-pending-marker',
  })

  const safeBootStore = createStore(staleMarker)
  const safeBoot = createOnlineComponentActivationLifecycle({
    markerStore: safeBootStore,
    revisionKey: 'artifact@bad',
    surfaceId: 'preview-surface',
    safeBoot: true,
    nonce: 'nonce-safe-boot',
    now: () => 3_000,
  })
  const safeBootDecision = safeBoot.begin()
  assert.deepEqual(safeBootDecision, {
    activate: false,
    state: 'safe-boot-skipped',
    reason: 'safe-boot',
  })
  assert.equal(safeBootStore.marker, staleMarker)
  assert.deepEqual(
    safeBootStore.events.map(event => event[0]),
    ['read', 'quarantine'],
  )
  assert.equal(safeBoot.heartbeat(), false)
})
