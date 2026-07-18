import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from '@playwright/test'
import { createOnlineComponentActivationLifecycle } from '../src/runtime/online-components/activation-lifecycle.mjs'
import { resolveDashboardOnlineComponentContext } from '../src/runtime/online-components/context-resolver.mjs'
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

const DASHBOARD_PARENT_FRAME_CSP = "frame-src 'none'"

const readDashboardParentFrameCsp = async () => {
  const indexDocument = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const match = indexDocument.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/?>/i)
  assert.ok(match, 'dashboard index must declare its parent frame CSP')
  const metaIndex = match.index
  const firstLinkOrScriptIndex = indexDocument.search(/<(?:link|script)\b/i)
  assert.ok(metaIndex !== undefined && metaIndex >= 0)
  assert.ok(firstLinkOrScriptIndex === -1 || metaIndex < firstLinkOrScriptIndex)
  assert.equal(match[1], DASHBOARD_PARENT_FRAME_CSP)
  return match[1]
}

const expectProtocolError = callback => {
  assert.throws(callback, error => error instanceof OnlineComponentProtocolError)
}

const runSandboxBatchInChromium = async (
  page,
  {
    disableNativeAnimationFrame = false,
    removeAfterMount = false,
    source,
    surfaceId,
    waitForEventType,
    waitForFaultAfterApply = false,
  },
) => {
  const browserIdentity = Object.freeze({
    nonce: `nonce-${surfaceId}-0123456789`,
    surfaceId,
    generation: 1,
  })
  const scriptOpening = `<script nonce="${browserIdentity.nonce}">`
  const sandboxDocument = disableNativeAnimationFrame
    ? createOnlineComponentSandboxDocument(browserIdentity).replace(
        scriptOpening,
        `${scriptOpening}
          Object.defineProperty(globalThis, 'requestAnimationFrame', { value: undefined, configurable: true })
          Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: undefined, configurable: true })
        </script>
        ${scriptOpening}`,
      )
    : createOnlineComponentSandboxDocument(browserIdentity)
  return page.evaluate(
    async ({
      identity: currentIdentity,
      removeAfterMount: shouldRemoveAfterMount,
      sandboxDocument: currentDocument,
      source: currentSource,
      waitForEventType: currentWaitForEventType,
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
      if (currentWaitForEventType && messages.some(message => message.kind === 'online-component.batch-applied')) {
        await waitForMessage(
          message =>
            message.kind === 'online-component.fault' ||
            (message.kind === 'online-component.event' && message.event?.type === currentWaitForEventType),
        )
      }
      if (
        shouldRemoveAfterMount &&
        !messages.some(message => message.kind === 'online-component.fault') &&
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
      waitForEventType,
      waitForFaultAfterApply,
    },
  )
}

const runHostileSandboxInChromium = async (page, payload) => {
  const browserIdentity = Object.freeze({
    nonce: 'nonce-hostile-boundary-0123456789',
    surfaceId: 'hostile-boundary',
    generation: 1,
  })
  const sandboxDocument = createOnlineComponentSandboxDocument(browserIdentity)
  const source = `
    const attempt = callback => {
      try {
        return { blocked: false, value: String(callback()) }
      } catch (error) {
        return { blocked: true, name: String(error?.name ?? 'Error') }
      }
    }
    export default {
      mount(root, context) {
        root.textContent = 'hostile-mounted'
        const results = {
          opaqueOrigin: location.origin,
          parentDom: attempt(() => parent.document.querySelector('#host-secret').textContent),
          topDom: attempt(() => top.document.documentElement.outerHTML),
          openerIsNull: opener === null,
          parentAuthority: attempt(() => parent.__G008_HOST_AUTHORITY__.accessToken),
          localStorage: attempt(() => localStorage.getItem('g008-host-token')),
          sessionStorage: attempt(() => sessionStorage.getItem('g008-host-token')),
          topNavigation: attempt(() => { top.location.href = 'https://attacker.invalid/g008-navigation'; return top.location.href }),
          popupBlocked: open('https://attacker.invalid/g008-popup', '_blank') === null,
          contextContainsAuthority: JSON.stringify({
            props: context.props,
            data: context.data,
            theme: context.theme,
            assets: context.assets,
          }).includes('g008-secret'),
          safeContextValue: context.props.public.safe,
        }
        const navigationLink = document.createElement('a')
        navigationLink.href = 'https://attacker.invalid/g008-anchor-navigation'
        navigationLink.target = '_top'
        navigationLink.click()
        const downloadLink = document.createElement('a')
        downloadLink.href = 'data:text/plain,g008-download'
        downloadLink.download = 'g008-hostile.txt'
        downloadLink.click()
        parent.postMessage({ kind: 'online-component.fault', nonce: 'forged-from-sandbox' }, '*')
        fetch('https://attacker.invalid/g008-fetch')
          .then(() => false, () => true)
          .then(networkBlocked => context.emit('hostile-probe', { ...results, networkBlocked }))
      },
      update(root, context) {
        root.textContent = 'hostile-updated'
        context.emit('hostile-update', { usable: true })
      },
      destroy() {}
    }
  `

  return page.evaluate(
    async ({ currentDocument, currentIdentity, currentPayload, currentSource }) => {
      document.body.replaceChildren()
      const hostSecret = document.createElement('div')
      hostSecret.id = 'host-secret'
      hostSecret.textContent = 'host-usable'
      hostSecret.style.color = 'rgb(1, 2, 3)'
      hostSecret.style.backgroundColor = 'rgb(4, 5, 6)'
      const hostButton = document.createElement('button')
      hostButton.textContent = '0'
      hostButton.addEventListener('click', () => {
        hostButton.textContent = String(Number(hostButton.textContent) + 1)
      })
      document.body.append(hostSecret, hostButton)
      window.__G008_HOST_AUTHORITY__ = { accessToken: 'g008-secret-host-access-token' }

      const windowMessages = []
      const onWindowMessage = event => windowMessages.push(event.data)
      window.addEventListener('message', onWindowMessage)

      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.srcdoc = currentDocument
      const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
      document.body.append(frame)
      await loaded

      const forgedChannel = new MessageChannel()
      const forgedReplies = []
      forgedChannel.port1.onmessage = event => forgedReplies.push(event.data)
      forgedChannel.port1.start()
      frame.contentWindow?.postMessage(
        {
          kind: 'online-component.connect',
          protocolVersion: 1,
          ...currentIdentity,
          nonce: 'nonce-forged-0123456789',
        },
        '*',
        [forgedChannel.port2],
      )
      await new Promise(resolve => setTimeout(resolve, 50))

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
        const timeoutAt = performance.now() + 5_000
        while (!messages.some(predicate)) {
          if (performance.now() >= timeoutAt) throw new Error('hostile sandbox browser regression timed out')
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }
      await waitForMessage(message => message.kind === 'online-component.ready')

      const createBatch = sequence => ({
        kind: 'online-component.render-batch',
        protocolVersion: 1,
        ...currentIdentity,
        sequence,
        updates: [
          {
            instanceId: 'node-hostile',
            revisionKey: 'artifact-hostile@revision-1',
            rect: { x: 0, y: 0, width: 100, height: 100 },
            visible: true,
            generatedZ: 1,
            payload: {
              artifact: {
                source: currentSource,
                css:
                  '@import url("https://attacker.invalid/g008-css-import");' +
                  ':root,html,body,#host-secret{color:rgb(255,0,0)!important;background:rgb(255,0,0)!important}',
                dependencies: [],
              },
              ...currentPayload,
              size: { width: 100, height: 100 },
            },
          },
        ],
        removals: [],
      })

      channel.port1.postMessage({
        ...createBatch(99),
        nonce: 'nonce-forged-0123456789',
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      channel.port1.postMessage(createBatch(1))
      await waitForMessage(message => message.kind === 'online-component.batch-applied' && message.sequence === 1)
      await waitForMessage(
        message => message.kind === 'online-component.event' && message.event?.type === 'hostile-probe',
      )

      channel.port1.postMessage(createBatch(2))
      await waitForMessage(message => message.kind === 'online-component.batch-applied' && message.sequence === 2)
      await waitForMessage(
        message => message.kind === 'online-component.event' && message.event?.type === 'hostile-update',
      )
      hostButton.click()

      const result = {
        acceptedSequences: messages
          .filter(message => message.kind === 'online-component.batch-applied')
          .map(message => message.sequence),
        faultCodes: messages.filter(message => message.kind === 'online-component.fault').map(message => message.code),
        forgedReplies,
        hostileProbe: messages.find(
          message => message.kind === 'online-component.event' && message.event?.type === 'hostile-probe',
        )?.event.payload,
        hostileUpdate: messages.find(
          message => message.kind === 'online-component.event' && message.event?.type === 'hostile-update',
        )?.event.payload,
        forgedWindowMessageSeen: windowMessages.some(message => message?.nonce === 'forged-from-sandbox'),
        hostButtonText: hostButton.textContent,
        hostSecretText: hostSecret.textContent,
        hostSecretColor: getComputedStyle(hostSecret).color,
        hostSecretBackground: getComputedStyle(hostSecret).backgroundColor,
      }

      channel.port1.close()
      forgedChannel.port1.close()
      frame.remove()
      window.removeEventListener('message', onWindowMessage)
      window.__G008_HOST_AUTHORITY__ = undefined
      return result
    },
    {
      currentDocument: sandboxDocument,
      currentIdentity: browserIdentity,
      currentPayload: payload,
      currentSource: source,
    },
  )
}

const runSelfNavigationVectorInChromium = async (page, { attackUrl, navigationBody, surfaceId }) => {
  const browserIdentity = Object.freeze({
    nonce: `nonce-${surfaceId}-0123456789`,
    surfaceId,
    generation: 1,
  })
  const sandboxDocument = createOnlineComponentSandboxDocument(browserIdentity)
  const source = `
    export default {
      mount(root, context) {
        root.textContent = 'navigation-mounted'
        context.emit('navigation-mounted', { vector: '${surfaceId}' })
        ${navigationBody}
      },
      update() {},
      destroy() {}
    }
  `

  return page.evaluate(
    async ({ currentAttackUrl, currentDocument, currentIdentity, currentSource }) => {
      document.body.replaceChildren()
      const hostMarker = document.createElement('div')
      hostMarker.id = 'navigation-host-marker'
      hostMarker.textContent = 'host-usable'
      const hostButton = document.createElement('button')
      hostButton.textContent = '0'
      hostButton.addEventListener('click', () => {
        hostButton.textContent = String(Number(hostButton.textContent) + 1)
      })
      document.body.append(hostMarker, hostButton)

      const violations = []
      const onViolation = event => {
        violations.push({
          blockedURI: event.blockedURI,
          effectiveDirective: event.effectiveDirective,
        })
      }
      window.addEventListener('securitypolicyviolation', onViolation)

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

      const waitFor = async (predicate, label) => {
        const timeoutAt = performance.now() + 5_000
        while (!predicate()) {
          if (performance.now() >= timeoutAt) throw new Error(`navigation containment timed out: ${label}`)
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }
      await waitFor(() => messages.some(message => message.kind === 'online-component.ready'), 'sandbox ready')

      channel.port1.postMessage({
        kind: 'online-component.render-batch',
        protocolVersion: 1,
        ...currentIdentity,
        sequence: 1,
        updates: [
          {
            instanceId: 'node-navigation',
            revisionKey: `artifact-${currentIdentity.surfaceId}@revision-1`,
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
      await waitFor(
        () =>
          messages.some(
            message => message.kind === 'online-component.event' && message.event?.type === 'navigation-mounted',
          ),
        'artifact mount',
      )
      await waitFor(
        () =>
          violations.some(
            violation =>
              violation.effectiveDirective === 'frame-src' &&
              violation.blockedURI.startsWith(new URL(currentAttackUrl).origin),
          ),
        'parent frame-src violation',
      )
      await new Promise(resolve => setTimeout(resolve, 100))
      hostButton.click()

      const result = {
        ready: messages.some(message => message.kind === 'online-component.ready'),
        mounted: messages.some(
          message => message.kind === 'online-component.event' && message.event?.type === 'navigation-mounted',
        ),
        hostButtonText: hostButton.textContent,
        hostMarkerText: hostMarker.textContent,
        iframeCount: document.querySelectorAll('iframe').length,
        parentUrl: location.href,
        violations,
      }

      channel.port1.close()
      frame.remove()
      window.removeEventListener('securitypolicyviolation', onViolation)
      return result
    },
    {
      currentAttackUrl: attackUrl,
      currentDocument: sandboxDocument,
      currentIdentity: browserIdentity,
      currentSource: source,
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
  assert.match(document, /const stopEventBudgetEpoch/)
  assert.match(document, /eventBudgetEpochCancel = nativeCancelAnimationFrame/)
  assert.match(document, /eventBudgetEpochCancel = nativeClearTimeout/)
  assert.match(document, /advanceEpoch, 16/)
  assert.match(document, /if \(readMapSize\(instances\) === 0\) stopEventBudgetEpoch\(\)/)
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

test('Chromium opaque sandbox contains hostile DOM, authority, storage, network, navigation, message, and CSS probes', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const startUrl = page.url()
  const externalRequests = []
  const popups = []
  const downloads = []
  page.on('request', request => {
    if (request.url().includes('attacker.invalid')) externalRequests.push(request.url())
  })
  page.on('popup', popup => {
    popups.push(popup.url())
    void popup.close()
  })
  page.on('download', download => downloads.push(download.suggestedFilename()))

  const context = resolveDashboardOnlineComponentContext({
    public: {
      safe: 'retained',
      nested: { accessToken: 'g008-secret-prop-access-token' },
    },
    data: { nested: { authorization: 'g008-secret-data-authorization' } },
    theme: { nested: { refreshToken: 'g008-secret-theme-refresh-token' } },
    assets: [{ nested: { credentialRef: 'g008-secret-asset-credential' } }],
  })
  const result = await runHostileSandboxInChromium(page, context)
  await page.waitForTimeout(100)

  assert.deepEqual(result.acceptedSequences, [1, 2])
  assert.deepEqual(result.faultCodes, [])
  assert.deepEqual(result.forgedReplies, [])
  assert.equal(result.forgedWindowMessageSeen, true)
  assert.deepEqual(result.hostileProbe, {
    opaqueOrigin: 'null',
    parentDom: { blocked: true, name: 'SecurityError' },
    topDom: { blocked: true, name: 'SecurityError' },
    openerIsNull: true,
    parentAuthority: { blocked: true, name: 'SecurityError' },
    localStorage: { blocked: true, name: 'SecurityError' },
    sessionStorage: { blocked: true, name: 'SecurityError' },
    topNavigation: { blocked: true, name: 'SecurityError' },
    popupBlocked: true,
    contextContainsAuthority: false,
    safeContextValue: 'retained',
    networkBlocked: true,
  })
  assert.deepEqual(result.hostileUpdate, { usable: true })
  assert.equal(result.hostButtonText, '1')
  assert.equal(result.hostSecretText, 'host-usable')
  assert.equal(result.hostSecretColor, 'rgb(1, 2, 3)')
  assert.equal(result.hostSecretBackground, 'rgb(4, 5, 6)')
  assert.equal(page.url(), startUrl)
  assert.deepEqual(externalRequests, [])
  assert.deepEqual(popups, [])
  assert.deepEqual(downloads, [])
})

test('Dashboard parent CSP contains every generated sandbox self-navigation vector without a request', async t => {
  const parentFrameCsp = await readDashboardParentFrameCsp()
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const externalRequests = []
  page.on('request', request => {
    if (request.url().includes('attacker.invalid')) externalRequests.push(request.url())
  })
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <meta http-equiv="Content-Security-Policy" content="${parentFrameCsp}" />
      </head>
      <body></body>
    </html>`)
  assert.equal(
    await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),
    DASHBOARD_PARENT_FRAME_CSP,
  )
  const parentUrl = page.url()

  const vectors = [
    {
      surfaceId: 'navigation-href',
      attackUrl: 'https://attacker.invalid/g008-navigation-href',
      navigationBody: `location.href = 'https://attacker.invalid/g008-navigation-href'`,
    },
    {
      surfaceId: 'navigation-assign',
      attackUrl: 'https://attacker.invalid/g008-navigation-assign',
      navigationBody: `location.assign('https://attacker.invalid/g008-navigation-assign')`,
    },
    {
      surfaceId: 'navigation-replace',
      attackUrl: 'https://attacker.invalid/g008-navigation-replace',
      navigationBody: `location.replace('https://attacker.invalid/g008-navigation-replace')`,
    },
    {
      surfaceId: 'navigation-anchor-self',
      attackUrl: 'https://attacker.invalid/g008-navigation-anchor-self',
      navigationBody: `
        const link = document.createElement('a')
        link.href = 'https://attacker.invalid/g008-navigation-anchor-self'
        link.target = '_self'
        document.body.append(link)
        link.click()
      `,
    },
    {
      surfaceId: 'navigation-open-self',
      attackUrl: 'https://attacker.invalid/g008-navigation-open-self',
      navigationBody: `open('https://attacker.invalid/g008-navigation-open-self', '_self')`,
    },
  ]

  for (const vector of vectors) {
    const requestCountBeforeVector = externalRequests.length
    const result = await runSelfNavigationVectorInChromium(page, vector)

    assert.equal(result.ready, true, `${vector.surfaceId} must preserve initial srcdoc readiness`)
    assert.equal(result.mounted, true, `${vector.surfaceId} must mount through the artifact protocol`)
    assert.equal(result.iframeCount, 1, `${vector.surfaceId} must use exactly one child frame`)
    assert.equal(result.hostMarkerText, 'host-usable')
    assert.equal(result.hostButtonText, '1')
    assert.equal(result.parentUrl, parentUrl)
    assert.ok(
      result.violations.some(
        violation =>
          violation.effectiveDirective === 'frame-src' &&
          violation.blockedURI.startsWith(new URL(vector.attackUrl).origin),
      ),
      `${vector.surfaceId} must report the parent frame-src violation`,
    )
    assert.deepEqual(externalRequests.slice(requestCountBeforeVector), [])
  }

  assert.deepEqual(externalRequests, [])
  assert.equal(page.url(), parentUrl)
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

test('Chromium event budget recovers across animation frames and releases resources on destroy', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()

  const messages = await runSandboxBatchInChromium(page, {
    removeAfterMount: true,
    surfaceId: 'event-budget-frames',
    waitForEventType: 'event-budget-complete',
    source: `
      let frame
      export default {
        mount(root, context) {
          let emitted = 0
          const emitFrame = () => {
            for (let index = 0; index < 300; index += 1) {
              context.emit('event-budget-tick', { index: emitted })
              emitted += 1
            }
            if (emitted < 1_200) {
              frame = requestAnimationFrame(emitFrame)
              return
            }
            context.emit('event-budget-complete', { emitted })
          }
          frame = requestAnimationFrame(emitFrame)
        },
        update() {},
        destroy() {
          if (frame !== undefined) cancelAnimationFrame(frame)
        }
      }
    `,
  })

  assert.deepEqual(
    messages.filter(message => message.kind === 'online-component.fault'),
    [],
  )
  assert.equal(
    messages.filter(message => message.kind === 'online-component.event' && message.event.type === 'event-budget-tick')
      .length,
    1_200,
  )
  assert.deepEqual(
    messages.find(
      message => message.kind === 'online-component.event' && message.event.type === 'event-budget-complete',
    )?.event.payload,
    { emitted: 1_200 },
  )
  assert.deepEqual(
    messages.filter(message => message.kind === 'online-component.batch-applied').map(message => message.resources),
    [
      { instanceCount: 1, listenerCount: 1, pendingTaskCount: 1, objectUrlCount: 0 },
      { instanceCount: 0, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 0 },
    ],
  )
})

test('Chromium event budget resets before schedule-first animation callbacks', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()

  const messages = await runSandboxBatchInChromium(page, {
    removeAfterMount: true,
    surfaceId: 'event-budget-schedule-first',
    waitForEventType: 'event-budget-complete',
    source: `
      let frame
      export default {
        mount(root, context) {
          let emitted = 0
          const emitFrame = () => {
            if (emitted >= 1_200) return
            frame = requestAnimationFrame(emitFrame)
            const target = emitted + 600
            while (emitted < target) {
              context.emit('event-budget-tick', { index: emitted })
              emitted += 1
            }
            if (emitted === 1_200) context.emit('event-budget-complete', { emitted })
          }
          frame = requestAnimationFrame(emitFrame)
        },
        update() {},
        destroy() {
          if (frame !== undefined) cancelAnimationFrame(frame)
        }
      }
    `,
  })

  assert.deepEqual(
    messages.filter(message => message.kind === 'online-component.fault'),
    [],
  )
  assert.equal(
    messages.filter(message => message.kind === 'online-component.event' && message.event.type === 'event-budget-tick')
      .length,
    1_200,
  )
  assert.deepEqual(
    messages.find(
      message => message.kind === 'online-component.event' && message.event.type === 'event-budget-complete',
    )?.event.payload,
    { emitted: 1_200 },
  )
  assert.deepEqual(
    messages.filter(message => message.kind === 'online-component.batch-applied').map(message => message.resources),
    [
      { instanceCount: 1, listenerCount: 1, pendingTaskCount: 1, objectUrlCount: 0 },
      { instanceCount: 0, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 0 },
    ],
  )
})

test('Chromium event budget uses a leak-free trusted timer epoch without animation-frame APIs', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()

  const messages = await runSandboxBatchInChromium(page, {
    disableNativeAnimationFrame: true,
    removeAfterMount: true,
    surfaceId: 'event-budget-timer-fallback',
    waitForEventType: 'event-budget-complete',
    source: `
      let timer
      export default {
        mount(root, context) {
          let emitted = 0
          const emit = count => {
            const target = emitted + count
            while (emitted < target) {
              context.emit('event-budget-tick', { index: emitted })
              emitted += 1
            }
          }
          timer = setTimeout(() => {
            emit(600)
            timer = setTimeout(() => {
              emit(600)
              context.emit('event-budget-complete', { emitted })
            }, 40)
          }, 20)
        },
        update() {},
        destroy() {
          if (timer !== undefined) clearTimeout(timer)
        }
      }
    `,
  })

  assert.deepEqual(
    messages.filter(message => message.kind === 'online-component.fault'),
    [],
  )
  assert.equal(
    messages.filter(message => message.kind === 'online-component.event' && message.event.type === 'event-budget-tick')
      .length,
    1_200,
  )
  assert.deepEqual(
    messages.find(
      message => message.kind === 'online-component.event' && message.event.type === 'event-budget-complete',
    )?.event.payload,
    { emitted: 1_200 },
  )
  assert.deepEqual(
    messages.filter(message => message.kind === 'online-component.batch-applied').map(message => message.resources),
    [
      { instanceCount: 1, listenerCount: 1, pendingTaskCount: 1, objectUrlCount: 0 },
      { instanceCount: 0, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 0 },
    ],
  )
})

test('Chromium event budget faults a same-frame storm and starts clean in a replacement sandbox', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()

  const stormMessages = await runSandboxBatchInChromium(page, {
    surfaceId: 'event-budget-storm',
    source: `export default {
      mount(root, context) {
        for (let index = 0; index < 1_025; index += 1) context.emit('storm-tick', { index })
      },
      update() {},
      destroy() {}
    }`,
  })
  assert.equal(
    stormMessages.filter(message => message.kind === 'online-component.event' && message.event.type === 'storm-tick')
      .length,
    1_024,
  )
  assert.deepEqual(
    stormMessages.find(message => message.kind === 'online-component.fault'),
    {
      kind: 'online-component.fault',
      protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
      nonce: 'nonce-event-budget-storm-0123456789',
      surfaceId: 'event-budget-storm',
      generation: 1,
      code: 'message-storm',
      instanceId: 'node-1',
      resources: { instanceCount: 1, listenerCount: 1, pendingTaskCount: 1, objectUrlCount: 0 },
    },
  )

  const restartedMessages = await runSandboxBatchInChromium(page, {
    removeAfterMount: true,
    surfaceId: 'event-budget-restarted',
    waitForEventType: 'restart-ok',
    source: `export default {
      mount(root, context) { context.emit('restart-ok', { accepted: true }) },
      update() {},
      destroy() {}
    }`,
  })
  assert.equal(
    restartedMessages.some(message => message.kind === 'online-component.fault'),
    false,
  )
  assert.deepEqual(
    restartedMessages.find(message => message.kind === 'online-component.event' && message.event.type === 'restart-ok')
      ?.event.payload,
    { accepted: true },
  )
  assert.deepEqual(
    restartedMessages.find(message => message.kind === 'online-component.batch-applied' && message.sequence === 2)
      ?.resources,
    { instanceCount: 0, listenerCount: 1, pendingTaskCount: 0, objectUrlCount: 0 },
  )
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
