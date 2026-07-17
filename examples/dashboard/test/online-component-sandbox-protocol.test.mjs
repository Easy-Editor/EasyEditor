import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from '@playwright/test'
import { createOnlineComponentActivationLifecycle } from '../src/runtime/online-components/activation-lifecycle.mjs'
import { createOnlineComponentSandboxDocument } from '../src/runtime/online-components/sandbox-document.mjs'
import {
  ONLINE_COMPONENT_PROTOCOL_VERSION,
  OnlineComponentProtocolError,
  createConnectMessage,
  createRenderBatchMessage,
  parseSandboxMessage,
  validateConnectMessage,
} from '../src/runtime/online-components/surface-protocol.mjs'
import {
  createTrustedShellEventAdapter,
  normalizeTrustedShellEvent,
} from '../src/runtime/online-components/trusted-event-adapter.mjs'

const identity = Object.freeze({
  nonce: 'nonce-0123456789abcdef',
  surfaceId: 'editor-surface',
  generation: 3,
})

const resources = Object.freeze({
  instanceCount: 0,
  listenerCount: 1,
  pendingTaskCount: 0,
  objectUrlCount: 0,
})

const expectProtocolError = callback => {
  assert.throws(callback, error => error instanceof OnlineComponentProtocolError)
}

const runSandboxBatchInChromium = async (
  page,
  { removeAfterMount = false, source, surfaceId, waitForFaultAfterApply = false },
) => {
  const browserIdentity = Object.freeze({
    nonce: `nonce-${surfaceId}-0123456789`,
    surfaceId,
    generation: 1,
  })
  const sandboxDocument = createOnlineComponentSandboxDocument(browserIdentity)
  return page.evaluate(
    async ({
      identity: currentIdentity,
      removeAfterMount: shouldRemoveAfterMount,
      sandboxDocument: currentDocument,
      source: currentSource,
      waitForFaultAfterApply: shouldWaitForFaultAfterApply,
    }) => {
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.srcdoc = currentDocument
      const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
      document.body.append(frame)
      await loaded

      const channel = new MessageChannel()
      const messages = []
      channel.port1.onmessage = event => messages.push(event.data)
      channel.port1.start()
      frame.contentWindow?.postMessage(
        {
          kind: 'online-component.connect',
          protocolVersion: 1,
          ...currentIdentity,
        },
        '*',
        [channel.port2],
      )

      const waitForMessage = async predicate => {
        const timeoutAt = performance.now() + 3_000
        while (!messages.some(predicate)) {
          if (performance.now() >= timeoutAt) throw new Error('sandbox browser regression timed out')
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }
      await waitForMessage(message => message.kind === 'online-component.ready')
      channel.port1.postMessage({
        kind: 'online-component.render-batch',
        protocolVersion: 1,
        ...currentIdentity,
        sequence: 1,
        updates: [
          {
            instanceId: 'node-1',
            revisionKey: 'artifact-1@revision-1',
            rect: { x: 0, y: 0, width: 100, height: 100 },
            visible: true,
            generatedZ: 1,
            payload: {
              artifact: { source: currentSource, css: '', dependencies: [] },
              props: {},
              data: null,
              theme: {},
              size: { width: 100, height: 100 },
              assets: [],
            },
          },
        ],
        removals: [],
      })
      await waitForMessage(
        message => message.kind === 'online-component.batch-applied' || message.kind === 'online-component.fault',
      )
      if (shouldWaitForFaultAfterApply && messages.some(message => message.kind === 'online-component.batch-applied')) {
        await waitForMessage(message => message.kind === 'online-component.fault')
      }
      if (
        shouldRemoveAfterMount &&
        messages.some(message => message.kind === 'online-component.batch-applied' && message.sequence === 1)
      ) {
        channel.port1.postMessage({
          kind: 'online-component.render-batch',
          protocolVersion: 1,
          ...currentIdentity,
          sequence: 2,
          updates: [],
          removals: ['node-1'],
        })
        await waitForMessage(
          message =>
            message.kind === 'online-component.fault' ||
            (message.kind === 'online-component.batch-applied' && message.sequence === 2),
        )
      }
      channel.port1.close()
      frame.remove()
      return messages
    },
    {
      identity: browserIdentity,
      removeAfterMount,
      sandboxDocument,
      source,
      waitForFaultAfterApply,
    },
  )
}

test('connect and sandbox messages require the exact version, nonce, surface, generation, and keys', () => {
  const connect = createConnectMessage(identity)
  assert.deepEqual(connect, {
    kind: 'online-component.connect',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: identity.nonce,
    surfaceId: identity.surfaceId,
    generation: identity.generation,
  })
  assert.equal(Object.isFrozen(connect), true)
  assert.equal(validateConnectMessage(connect, identity), connect)

  for (const forged of [
    { ...connect, protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION + 1 },
    { ...connect, nonce: 'nonce-forged-0123456789' },
    { ...connect, surfaceId: 'preview-surface' },
    { ...connect, generation: identity.generation + 1 },
    { ...connect, unexpected: true },
  ]) {
    expectProtocolError(() => validateConnectMessage(forged, identity))
  }

  const ready = {
    kind: 'online-component.ready',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    ...identity,
    resources,
  }
  assert.deepEqual(parseSandboxMessage(ready, identity), ready)
  expectProtocolError(() => parseSandboxMessage({ ...ready, extra: 'forged' }, identity))
  expectProtocolError(() => parseSandboxMessage({ ...ready, nonce: 'nonce-forged-0123456789' }, identity))
  expectProtocolError(() =>
    parseSandboxMessage({ ...ready, resources: { ...resources, objectUrlCount: -1 } }, identity),
  )
  expectProtocolError(() => parseSandboxMessage({ ...ready, resources: { ...resources, hiddenCounter: 1 } }, identity))

  const applied = {
    kind: 'online-component.batch-applied',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    ...identity,
    sequence: 7,
    resources,
  }
  assert.deepEqual(parseSandboxMessage(applied, identity), applied)

  const fault = {
    kind: 'online-component.fault',
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    ...identity,
    code: 'render-failed',
    instanceId: 'node-1',
    resources,
  }
  assert.deepEqual(parseSandboxMessage(fault, identity), fault)
  expectProtocolError(() => parseSandboxMessage({ ...fault, message: 'raw generated stack' }, identity))
})

test('render batches accept only bounded exact JSON DTOs', () => {
  const batch = createRenderBatchMessage({
    ...identity,
    sequence: 9,
    updates: [
      {
        instanceId: 'node-1',
        revisionKey: 'artifact-1@revision-1',
        rect: { x: 10, y: 20, width: 300, height: 120 },
        visible: true,
        generatedZ: 4,
        payload: {
          props: { title: '在线 KPI' },
          data: { value: 42 },
          theme: { mode: 'dark' },
          size: { width: 300, height: 120 },
        },
      },
    ],
    removals: ['node-old'],
  })

  assert.equal(batch.kind, 'online-component.render-batch')
  assert.equal(batch.protocolVersion, ONLINE_COMPONENT_PROTOCOL_VERSION)
  assert.equal(batch.updates.length, 1)
  assert.equal(Object.isFrozen(batch), true)
  assert.equal(Object.isFrozen(batch.updates[0]), true)
  assert.equal(Object.isFrozen(batch.updates[0].rect), true)

  expectProtocolError(() =>
    createRenderBatchMessage({
      ...batch,
      updates: [{ ...batch.updates[0], arbitraryHostObject: true }],
    }),
  )
  expectProtocolError(() =>
    createRenderBatchMessage({
      ...batch,
      updates: [{ ...batch.updates[0], rect: { ...batch.updates[0].rect, top: 1 } }],
    }),
  )
  expectProtocolError(() =>
    createRenderBatchMessage({
      ...batch,
      updates: [{ ...batch.updates[0], payload: { callback: () => {} } }],
    }),
  )
  expectProtocolError(() =>
    createRenderBatchMessage({
      ...batch,
      updates: [{ ...batch.updates[0], payload: { title: 'x'.repeat(300_000) } }],
    }),
  )
})

test('sandbox document freezes the opaque-origin no-network boundary and per-instance closed roots', () => {
  const document = createOnlineComponentSandboxDocument(identity)

  assert.match(document, /default-src 'none'/)
  assert.match(document, new RegExp(`script-src 'nonce-${identity.nonce}' blob:`))
  assert.match(document, new RegExp(`style-src 'nonce-${identity.nonce}'`))
  assert.match(document, /connect-src 'none'/)
  assert.match(document, /frame-src 'none'/)
  assert.match(document, /worker-src 'none'/)
  assert.match(document, /object-src 'none'/)
  assert.match(document, /base-uri 'none'/)
  assert.match(document, /form-action 'none'/)
  assert.match(document, /attachShadow\(\{ mode: 'closed' \}\)/)
  assert.match(document, /event\.source !== parent/)
  assert.match(document, /Object\.keys\(value\)/)
  assert.match(document, /online-component\.render-batch/)
  assert.match(document, new RegExp(identity.nonce))
  assert.match(document, new RegExp(identity.surfaceId))
  assert.match(document, new RegExp(`<script nonce="${identity.nonce}">`))
  assert.match(document, new RegExp(`<style nonce="${identity.nonce}">`))
  assert.match(document, /lifecycle\.mount/)
  assert.match(document, /lifecycle\.update/)
  assert.match(document, /lifecycle\.destroy/)
  assert.match(document, /hasExactKeys\(lifecycle, \['mount', 'update', 'destroy'\]\)/)
  assert.match(document, /lifecycle\.mount\(current\.content, context\)/)
  assert.match(document, /lifecycle\.update\(current\.content, context\)/)
  assert.match(document, /lifecycle\.destroy\(current\.content, current\.context\)/)
  assert.match(document, /assertSynchronousLifecycleResult/)
  assert.match(document, /async-lifecycle-not-supported/)
  assert.doesNotMatch(document, /await current\.lifecycle\?\.destroy/)
  assert.doesNotMatch(document, /await current\.lifecycle\.update/)
  assert.doesNotMatch(document, /await renderer\.lifecycle\.mount/)
  assert.doesNotMatch(document, /controller/)
  assert.doesNotMatch(document, /unmount/)
  assert.match(document, /URL\.revokeObjectURL/)
  assert.match(document, /const ownKeys = Reflect\.ownKeys/)
  assert.match(document, /const getPrototypeOf = Object\.getPrototypeOf/)
  assert.match(document, /const maxRealmDepth = 3/)
  assert.match(document, /const maxRealmObjects = 4096/)
  assert.match(document, /const maxRealmDescriptors = 65536/)
  assert.match(document, /const guardedObjects = discoverGuardedObjects\(\)/)
  assert.match(document, /descriptor\.value/)
  assert.doesNotMatch(document, /descriptor\.get\(\)/)
  assert.doesNotMatch(document, /descriptor\.set\(\)/)
  assert.match(document, /replaceDataProperty\(EventTarget\.prototype, 'addEventListener'/)
  assert.match(document, /replaceDataProperty\(globalThis, 'setTimeout'/)
  assert.match(document, /replaceDataProperty\(URL, 'createObjectURL'/)
  assert.match(document, /componentResourceSnapshot/)
  assert.match(document, /assertOwnedResourcesReleased/)
  assert.match(document, /pendingTaskCount/)
  assert.match(document, /captureRealm/)
  assert.match(document, /global-pollution/)
  assert.match(document, /const sameValue = Object\.is/)
  assert.match(document, /const TrustedError = Error/)
  assert.match(document, /const stringStartsWith = String\.prototype\.startsWith/)
  assert.match(document, /!sameValue\(before\[1\], readDescriptorField\(descriptor, 'value'\)\)/)
  assert.doesNotMatch(document, /before\[valueIndex\] !== after\[valueIndex\]/)
  assert.doesNotMatch(document, /instanceof Error/)
  assert.doesNotMatch(document, /unsafe-inline/)
  assert.doesNotMatch(document, /unsafe-eval/)
  assert.doesNotMatch(document, /allow-same-origin/)
  assert.doesNotMatch(document, /window\.parent\.document/)
})

test('Chromium bounded realm checks accept clean code and fault mutations across reachable intrinsic families', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()

  const cleanMessages = await runSandboxBatchInChromium(page, {
    surfaceId: 'clean-surface',
    source: "export default { mount(root) { root.textContent = 'ok' }, update() {}, destroy() {} }",
  })
  assert.equal(
    cleanMessages.some(message => message.kind === 'online-component.fault'),
    false,
  )
  assert.deepEqual(
    cleanMessages.find(message => message.kind === 'online-component.batch-applied'),
    {
      kind: 'online-component.batch-applied',
      protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
      nonce: 'nonce-clean-surface-0123456789',
      surfaceId: 'clean-surface',
      generation: 1,
      sequence: 1,
      resources: {
        instanceCount: 1,
        listenerCount: 1,
        pendingTaskCount: 0,
        objectUrlCount: 0,
      },
    },
  )

  const mutations = [
    ['map', 'Map.prototype.__g008Pollution__ = true'],
    ['set', 'Set.prototype.__g008Pollution__ = true'],
    ['weak-map', 'WeakMap.prototype.__g008Pollution__ = true'],
    ['weak-set', 'WeakSet.prototype.__g008Pollution__ = true'],
    ['typed-array', 'Uint8Array.prototype.__g008Pollution__ = true'],
    ['data-view', 'DataView.prototype.__g008Pollution__ = true'],
    ['array-buffer', 'ArrayBuffer.prototype.__g008Pollution__ = true'],
    ['date', 'Date.prototype.__g008Pollution__ = true'],
    ['regexp', 'RegExp.prototype.__g008Pollution__ = true'],
    ['error', 'TypeError.prototype.__g008Pollution__ = true'],
    ['math-namespace', 'Math.__g008Pollution__ = true'],
    ['intl-namespace', 'Intl.DateTimeFormat.prototype.__g008Pollution__ = true'],
  ]
  for (const [surfaceId, mutation] of mutations) {
    const pollutedMessages = await runSandboxBatchInChromium(page, {
      surfaceId,
      source: `${mutation}; export default { mount() {}, update() {}, destroy() {} }`,
    })
    assert.equal(
      pollutedMessages.some(message => message.kind === 'online-component.batch-applied'),
      false,
      mutation,
    )
    assert.deepEqual(
      pollutedMessages.find(message => message.kind === 'online-component.fault'),
      {
        kind: 'online-component.fault',
        protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
        nonce: `nonce-${surfaceId}-0123456789`,
        surfaceId,
        generation: 1,
        code: 'global-pollution',
        instanceId: 'node-1',
        resources: {
          instanceCount: 1,
          listenerCount: 1,
          pendingTaskCount: 0,
          objectUrlCount: 0,
        },
      },
      mutation,
    )
  }
})

test('Chromium fault reporting survives polluted error intrinsics and guards object listener dispatch', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()

  for (const [surfaceId, mutation] of [
    ['fault-string-intrinsic', "String.prototype.startsWith = null; throw new Error('boom')"],
    ['fault-error-constructor', "globalThis.Error = 1; throw { message: 'boom' }"],
  ]) {
    const messages = await runSandboxBatchInChromium(page, {
      surfaceId,
      source: `export default {
        mount() { ${mutation} },
        update() {},
        destroy() {}
      }`,
    })
    assert.deepEqual(
      messages.find(message => message.kind === 'online-component.fault'),
      {
        kind: 'online-component.fault',
        protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
        nonce: `nonce-${surfaceId}-0123456789`,
        surfaceId,
        generation: 1,
        code: 'global-pollution',
        instanceId: 'node-1',
        resources: { instanceCount: 1, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 0 },
      },
    )
  }

  for (const [surfaceId, getterBody, code] of [
    ['listener-getter-throw', "throw new Error('getter-boom')", 'render-failed'],
    [
      'listener-getter-pollution',
      "Map.prototype.__g008ListenerPollution__ = true; throw new Error('getter-boom')",
      'global-pollution',
    ],
  ]) {
    const messages = await runSandboxBatchInChromium(page, {
      surfaceId,
      waitForFaultAfterApply: true,
      source: `export default {
        mount() {
          addEventListener('g008-listener', { get handleEvent() { ${getterBody} } }, { once: true })
          setTimeout(() => dispatchEvent(new Event('g008-listener')), 0)
        },
        update() {},
        destroy() {}
      }`,
    })
    assert.deepEqual(
      messages.find(message => message.kind === 'online-component.fault'),
      {
        kind: 'online-component.fault',
        protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
        nonce: `nonce-${surfaceId}-0123456789`,
        surfaceId,
        generation: 1,
        code,
        instanceId: 'node-1',
        resources: { instanceCount: 1, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 0 },
      },
    )
  }
})

test('Chromium resource ledger allows owned mounted resources, cleans destroy, and faults explicit leaks', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()

  const ownedSource = `
    let interval
    let listener
    export default {
      mount() {
        listener = () => undefined
        addEventListener('g008-owned', listener)
        interval = setInterval(() => undefined, 60000)
      },
      update() {},
      destroy() {
        clearInterval(interval)
        removeEventListener('g008-owned', listener)
      }
    }
  `
  const ownedMessages = await runSandboxBatchInChromium(page, {
    removeAfterMount: true,
    surfaceId: 'owned-resources',
    source: ownedSource,
  })
  assert.deepEqual(
    ownedMessages
      .filter(message => message.kind === 'online-component.batch-applied')
      .map(message => message.resources),
    [
      { instanceCount: 1, listenerCount: 2, pendingTaskCount: 1, objectUrlCount: 0 },
      { instanceCount: 0, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 0 },
    ],
  )

  const destroyLeakMessages = await runSandboxBatchInChromium(page, {
    removeAfterMount: true,
    surfaceId: 'destroy-leak',
    source: ownedSource.replace(
      "clearInterval(interval)\n        removeEventListener('g008-owned', listener)",
      'void interval; void listener',
    ),
  })
  assert.deepEqual(
    destroyLeakMessages.find(message => message.kind === 'online-component.fault'),
    {
      kind: 'online-component.fault',
      protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
      nonce: 'nonce-destroy-leak-0123456789',
      surfaceId: 'destroy-leak',
      generation: 1,
      code: 'resource-leak',
      instanceId: 'node-1',
      resources: { instanceCount: 0, listenerCount: 2, pendingTaskCount: 1, objectUrlCount: 0 },
    },
  )

  const objectUrlLeakMessages = await runSandboxBatchInChromium(page, {
    surfaceId: 'object-url-leak',
    source: `export default {
      mount() { URL.createObjectURL(new Blob(['leak'])) },
      update() {},
      destroy() {}
    }`,
  })
  assert.deepEqual(
    objectUrlLeakMessages.find(message => message.kind === 'online-component.fault'),
    {
      kind: 'online-component.fault',
      protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
      nonce: 'nonce-object-url-leak-0123456789',
      surfaceId: 'object-url-leak',
      generation: 1,
      code: 'resource-leak',
      instanceId: 'node-1',
      resources: { instanceCount: 1, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 1 },
    },
  )

  const cleanObjectUrlMessages = await runSandboxBatchInChromium(page, {
    surfaceId: 'object-url-clean',
    source: `export default {
      mount() {
        const url = URL.createObjectURL(new Blob(['clean']))
        URL.revokeObjectURL(url)
      },
      update() {},
      destroy() {}
    }`,
  })
  assert.equal(
    cleanObjectUrlMessages.some(message => message.kind === 'online-component.fault'),
    false,
  )
  assert.deepEqual(
    cleanObjectUrlMessages.find(message => message.kind === 'online-component.batch-applied')?.resources,
    { instanceCount: 1, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 0 },
  )

  const timerAndFrameMessages = await runSandboxBatchInChromium(page, {
    removeAfterMount: true,
    surfaceId: 'timer-frame-ledgers',
    source: `
      let interval
      let frame
      export default {
        mount() {
          interval = setInterval(() => undefined, 60000)
          frame = requestAnimationFrame(() => undefined)
        },
        update() {},
        destroy() {
          clearInterval(interval)
          cancelAnimationFrame(frame)
        }
      }
    `,
  })
  assert.deepEqual(
    timerAndFrameMessages
      .filter(message => message.kind === 'online-component.batch-applied')
      .map(message => message.resources),
    [
      { instanceCount: 1, listenerCount: 1, pendingTaskCount: 2, objectUrlCount: 0 },
      { instanceCount: 0, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 0 },
    ],
  )
})

test('activation lifecycle writes pending before activation, clears only on rehydrate, and quarantines stale markers', () => {
  const createMarkerStore = initial => {
    let marker = initial
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
      quarantine: (revisionKey, value) => events.push(['quarantine', revisionKey, value.state]),
      get marker() {
        return marker
      },
    }
  }

  const activeStore = createMarkerStore()
  const active = createOnlineComponentActivationLifecycle({
    markerStore: activeStore,
    revisionKey: 'artifact-1@revision-1',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    nonce: identity.nonce,
    now: () => 100,
  })
  const decision = active.begin()
  assert.equal(decision.activate, true)
  assert.equal(activeStore.marker.state, 'pending')
  assert.equal(active.heartbeat(), false)
  assert.equal(activeStore.marker.state, 'pending')
  assert.equal(active.completeRehydrate(), true)
  assert.equal(activeStore.marker, undefined)
  assert.equal(active.fail(), true)
  assert.equal(activeStore.marker.state, 'pending')
  assert.equal(active.getDiagnostics().state, 'quarantined')
  assert.deepEqual(
    activeStore.events.slice(-2).map(event => event[0]),
    ['write', 'quarantine'],
  )

  const stale = {
    state: 'pending',
    revisionKey: 'artifact-bad@revision-1',
    surfaceId: 'editor-surface',
    activationId: 'tab-a',
    nonce: 'nonce-stale-0123456789',
    startedAt: 1,
  }
  const staleStore = createMarkerStore(stale)
  const quarantined = createOnlineComponentActivationLifecycle({
    markerStore: staleStore,
    revisionKey: stale.revisionKey,
    surfaceId: stale.surfaceId,
    activationId: stale.activationId,
    nonce: identity.nonce,
    now: () => 200,
  })
  assert.deepEqual(quarantined.begin(), {
    activate: false,
    state: 'quarantined',
    reason: 'stale-pending-marker',
  })
  assert.deepEqual(
    staleStore.events.map(event => event[0]),
    ['read', 'quarantine'],
  )

  const safeBootStore = createMarkerStore()
  const safeBoot = createOnlineComponentActivationLifecycle({
    markerStore: safeBootStore,
    revisionKey: 'artifact-1@revision-2',
    surfaceId: 'preview-surface',
    activationId: 'tab-b',
    safeBoot: true,
    nonce: identity.nonce,
    now: () => 300,
  })
  assert.deepEqual(safeBoot.begin(), {
    activate: false,
    state: 'safe-boot-skipped',
    reason: 'safe-boot',
  })
  assert.deepEqual(
    safeBootStore.events.map(event => event[0]),
    ['read'],
  )
})

test('trusted shell adapter emits normalized mode-specific DTOs without forwarding DOM events', () => {
  const selections = []
  const runtimeEvents = []
  const editor = createTrustedShellEventAdapter({
    mode: 'editor',
    surfaceId: 'editor-surface',
    onSelection: event => selections.push(event),
    onRuntimeEvent: event => runtimeEvents.push(event),
  })

  const selected = editor.dispatch({
    instanceId: 'node-1',
    type: 'select',
    event: {
      button: 0,
      clientX: 12,
      clientY: 24,
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      target: { secretHostObject: true },
    },
  })
  assert.equal(selections.length, 1)
  assert.equal(runtimeEvents.length, 0)
  assert.equal(selected.kind, 'online-component.shell-event')
  assert.equal(selected.type, 'select')
  assert.equal('event' in selected, false)
  assert.equal('target' in selected.pointer, false)
  assert.equal(Object.isFrozen(selected.pointer), true)

  const preview = createTrustedShellEventAdapter({
    mode: 'preview',
    surfaceId: 'preview-surface',
    allowedRuntimeEvents: ['activate'],
    onSelection: event => selections.push(event),
    onRuntimeEvent: event => runtimeEvents.push(event),
  })
  const activated = preview.dispatch({
    instanceId: 'node-2',
    type: 'activate',
    event: { button: 0, clientX: 4, clientY: 8 },
  })
  assert.equal(activated.type, 'activate')
  assert.equal(runtimeEvents.length, 1)
  expectProtocolError(() => preview.dispatch({ instanceId: 'node-2', type: 'select', event: {} }))
  expectProtocolError(() => preview.dispatch({ instanceId: 'node-2', type: 'keydown', event: {} }))

  const normalized = normalizeTrustedShellEvent({
    mode: 'preview',
    surfaceId: 'preview-surface',
    instanceId: 'node-2',
    type: 'activate',
    event: {},
  })
  assert.deepEqual(Object.keys(normalized), [
    'kind',
    'protocolVersion',
    'surfaceId',
    'instanceId',
    'mode',
    'type',
    'pointer',
  ])
})
