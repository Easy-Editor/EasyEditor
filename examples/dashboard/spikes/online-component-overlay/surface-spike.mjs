const FRAME_MESSAGE = 'easy-editor.overlay-spike.connect'
const PORT_READY = 'easy-editor.overlay-spike.ready'
const PORT_RENDER = 'easy-editor.overlay-spike.render'

export const ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT = Object.freeze({
  coordinateModel: 'surface-viewport-local',
  generatedPlane: 'above-normal-materials-and-below-editor-tools',
  iframeSandbox: 'allow-scripts',
  iframePointerEvents: 'none',
  editorInteraction: 'trusted-selection-shell',
  previewInteraction: 'allowlisted-normalized-runtime-events-only',
  authorityBoundary: 'sandboxed-generated-code-has-no-host-realm-authority',
  cpuBoundary: 'synchronous-cpu-containment-is-not-guaranteed',
})

const assertFiniteNumber = (value, name) => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`)
  return value
}

const normalizeRect = rect => {
  if (!rect || typeof rect !== 'object') throw new TypeError('rect must be an object')

  const normalized = {
    x: assertFiniteNumber(rect.x, 'rect.x'),
    y: assertFiniteNumber(rect.y, 'rect.y'),
    width: assertFiniteNumber(rect.width, 'rect.width'),
    height: assertFiniteNumber(rect.height, 'rect.height'),
  }
  if (normalized.width < 0 || normalized.height < 0) {
    throw new RangeError('rect width and height must be non-negative')
  }
  return normalized
}

const intersectRects = (left, right) => {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const rightEdge = Math.min(left.x + left.width, right.x + right.width)
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height)
  return {
    x,
    y,
    width: Math.max(0, rightEdge - x),
    height: Math.max(0, bottomEdge - y),
  }
}

/**
 * Reference projection for the selected viewport-local coordinate contract.
 * The browser spike mounts inside the transformed viewport so production code
 * can inherit the same transform instead of duplicating it in JavaScript.
 */
export const projectCanvasRectToViewport = (rect, viewport) => {
  const canvasRect = normalizeRect(rect)
  if (!viewport || typeof viewport !== 'object') throw new TypeError('viewport must be an object')

  const left = assertFiniteNumber(viewport.left, 'viewport.left')
  const top = assertFiniteNumber(viewport.top, 'viewport.top')
  const width = assertFiniteNumber(viewport.width, 'viewport.width')
  const height = assertFiniteNumber(viewport.height, 'viewport.height')
  const scale = assertFiniteNumber(viewport.scale, 'viewport.scale')
  const scrollLeft = assertFiniteNumber(viewport.scrollLeft ?? 0, 'viewport.scrollLeft')
  const scrollTop = assertFiniteNumber(viewport.scrollTop ?? 0, 'viewport.scrollTop')
  const deviceScaleFactor = assertFiniteNumber(viewport.deviceScaleFactor ?? 1, 'viewport.deviceScaleFactor')

  if (width < 0 || height < 0 || scale <= 0 || deviceScaleFactor <= 0) {
    throw new RangeError('viewport dimensions must be non-negative and scales must be positive')
  }

  const cssRect = {
    x: left + (canvasRect.x - scrollLeft) * scale,
    y: top + (canvasRect.y - scrollTop) * scale,
    width: canvasRect.width * scale,
    height: canvasRect.height * scale,
  }
  const visibleCssRect = intersectRects(cssRect, { x: left, y: top, width, height })
  const toDevicePixels = value => value * deviceScaleFactor

  return {
    cssRect,
    visibleCssRect,
    deviceRect: {
      x: toDevicePixels(cssRect.x),
      y: toDevicePixels(cssRect.y),
      width: toDevicePixels(cssRect.width),
      height: toDevicePixels(cssRect.height),
    },
    visible: visibleCssRect.width > 0 && visibleCssRect.height > 0,
  }
}

const createNonce = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `overlay-spike-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const assertActivationStore = store => {
  for (const method of ['read', 'write', 'clear', 'quarantine']) {
    if (typeof store?.[method] !== 'function') throw new TypeError(`activation marker store.${method} is required`)
  }
  return store
}

export const createOnlineComponentActivationLifecycle = options => {
  const {
    markerStore,
    revisionKey,
    surfaceId,
    safeBoot = false,
    now = () => Date.now(),
    nonce = createNonce(),
  } = options ?? {}
  const store = assertActivationStore(markerStore)
  if (typeof revisionKey !== 'string' || revisionKey.length === 0) throw new TypeError('revisionKey is required')
  if (typeof surfaceId !== 'string' || surfaceId.length === 0) throw new TypeError('surfaceId is required')
  if (typeof now !== 'function') throw new TypeError('now must be a function')

  let marker
  let state = 'idle'

  const begin = () => {
    if (state !== 'idle') throw new Error('activation lifecycle has already started')
    const staleMarker = store.read(revisionKey)
    if (staleMarker) {
      store.quarantine(revisionKey, staleMarker)
      state = safeBoot ? 'safe-boot-skipped' : 'quarantined'
      return Object.freeze({
        activate: false,
        state,
        reason: safeBoot ? 'safe-boot' : 'stale-pending-marker',
      })
    }
    if (safeBoot) {
      state = 'safe-boot-skipped'
      return Object.freeze({ activate: false, state, reason: 'safe-boot' })
    }

    marker = Object.freeze({
      state: 'pending',
      revisionKey,
      surfaceId,
      nonce,
      startedAt: assertFiniteNumber(now(), 'activation timestamp'),
    })
    store.write(revisionKey, marker)
    state = 'pending'
    return Object.freeze({ activate: true, state, marker })
  }

  const heartbeat = () => {
    if (state !== 'pending') return false
    store.clear(revisionKey, marker)
    state = 'heartbeat-cleared'
    marker = undefined
    return true
  }

  const dispose = () => {
    return false
  }

  return Object.freeze({
    begin,
    heartbeat,
    dispose,
    getDiagnostics: () => ({ state, revisionKey }),
  })
}

const createFrameDocument = nonce => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
    <style>
      html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
      #root { position: relative; pointer-events: none; }
      .instance { position: absolute; overflow: hidden; box-sizing: border-box; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      (() => {
        const expectedNonce = ${JSON.stringify(nonce)}
        const root = document.getElementById('root')
        let port

        const render = instances => {
          root.replaceChildren()
          for (const instance of instances) {
            const host = document.createElement('div')
            host.className = 'instance'
            host.style.left = instance.rect.x + 'px'
            host.style.top = instance.rect.y + 'px'
            host.style.width = instance.rect.width + 'px'
            host.style.height = instance.rect.height + 'px'
            host.dataset.instanceId = instance.id

            const shadow = host.attachShadow({ mode: 'closed' })
            const visual = document.createElement('div')
            visual.textContent = instance.label
            visual.style.cssText = [
              'width:100%',
              'height:100%',
              'display:grid',
              'place-items:center',
              'box-sizing:border-box',
              'border:2px solid rgba(255,255,255,.85)',
              'border-radius:8px',
              'background:' + instance.color,
              'color:white',
              'font:600 18px/1.2 system-ui,sans-serif',
              'box-shadow:0 8px 24px rgba(0,0,0,.24)',
            ].join(';')
            shadow.append(visual)
            root.append(host)
          }
        }

        window.addEventListener('message', event => {
          const message = event.data
          if (event.source !== parent || message?.kind !== ${JSON.stringify(FRAME_MESSAGE)} || message.nonce !== expectedNonce) return
          const nextPort = event.ports[0]
          if (!nextPort || port) return
          port = nextPort
          port.onmessage = portEvent => {
            const payload = portEvent.data
            if (payload?.kind !== ${JSON.stringify(PORT_RENDER)} || payload.nonce !== expectedNonce || !Array.isArray(payload.instances)) return
            render(payload.instances)
          }
          port.start()
          port.postMessage({ kind: ${JSON.stringify(PORT_READY)}, nonce: expectedNonce })
        })
      })()
    </script>
  </body>
</html>`

const assignRect = (element, rect) => {
  element.style.left = `${rect.x}px`
  element.style.top = `${rect.y}px`
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
}

export const createOnlineComponentOverlaySurfaceSpike = options => {
  const { mount, surfaceId, mode, onSelection = () => {}, onRuntimeEvent = () => {}, activation } = options ?? {}
  if (!(mount instanceof HTMLElement)) throw new TypeError('mount must be an HTMLElement')
  if (typeof surfaceId !== 'string' || surfaceId.length === 0) throw new TypeError('surfaceId is required')
  if (mode !== 'editor' && mode !== 'preview') throw new TypeError('mode must be editor or preview')
  if (mount.getAttribute('data-easy-editor-surface-overlay-mount') !== mode) {
    throw new Error(`mount must be the explicit ${mode} surface overlay seam`)
  }
  const viewport = mount.parentElement
  if (!(viewport instanceof HTMLElement))
    throw new Error('surface overlay mount must have an HTMLElement parent viewport')

  const nonce = createNonce()
  const activationLifecycle = activation
    ? createOnlineComponentActivationLifecycle({ ...activation, surfaceId, nonce })
    : undefined
  const activationDecision = activationLifecycle?.begin()
  if (activationDecision && !activationDecision.activate) {
    return Object.freeze({
      surfaceId,
      mode,
      registerInstance: () => () => {},
      updateInstanceRect: () => {},
      whenReady: () => Promise.resolve(),
      getDiagnostics: () => ({
        surfaceId,
        mode,
        ready: false,
        iframeCount: 0,
        instanceCount: 0,
        coordinateModel: ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT.coordinateModel,
        activation: activationLifecycle.getDiagnostics(),
      }),
      dispose: () => {},
    })
  }

  const instances = new Map()
  const shells = new Map()
  const originalPosition = viewport.style.position
  const computedPosition = getComputedStyle(viewport).position
  if (computedPosition === 'static') viewport.style.position = 'relative'

  const slot = document.createElement('div')
  slot.dataset.onlineComponentOverlaySlot = surfaceId
  slot.dataset.coordinateModel = ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT.coordinateModel
  Object.assign(slot.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '0',
    contain: 'layout paint style',
  })

  const frame = document.createElement('iframe')
  frame.dataset.onlineComponentSandbox = surfaceId
  frame.setAttribute('sandbox', ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT.iframeSandbox)
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  Object.assign(frame.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    border: '0',
    background: 'transparent',
    pointerEvents: ONLINE_COMPONENT_OVERLAY_SPIKE_CONTRACT.iframePointerEvents,
    zIndex: '0',
  })
  frame.srcdoc = createFrameDocument(nonce)
  slot.append(frame)
  mount.append(slot)

  let disposed = false
  let ready = false
  let resolveReady
  let rejectReady
  let channel
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  const render = () => {
    if (!ready || disposed) return
    channel.port1.postMessage({
      kind: PORT_RENDER,
      nonce,
      instances: [...instances.values()].map(instance => ({
        id: instance.id,
        label: instance.label,
        color: instance.color,
        rect: instance.rect,
      })),
    })
  }

  const connect = () => {
    if (disposed || channel) return
    channel = new MessageChannel()
    channel.port1.onmessage = event => {
      if (event.data?.kind !== PORT_READY || event.data.nonce !== nonce) return
      ready = true
      slot.dataset.ready = 'true'
      activationLifecycle?.heartbeat()
      resolveReady()
      render()
    }
    channel.port1.start()
    frame.contentWindow?.postMessage({ kind: FRAME_MESSAGE, nonce }, '*', [channel.port2])
  }

  frame.addEventListener('load', connect, { once: true })

  const createShell = instance => {
    const shell = document.createElement('div')
    shell.dataset.onlineComponentShell = instance.id
    shell.dataset.surfaceMode = mode
    shell.dataset.interaction = mode === 'editor' ? 'selection' : 'runtime-event'
    shell.setAttribute('aria-label', `${mode} generated component ${instance.id}`)
    Object.assign(shell.style, {
      position: 'absolute',
      pointerEvents: 'auto',
      background: 'transparent',
      zIndex: '1',
      touchAction: 'none',
    })
    assignRect(shell, instance.rect)

    shell.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      if (mode === 'editor') {
        shell.dataset.selected = 'true'
        onSelection({ surfaceId, instanceId: instance.id, __id: instance.id })
        return
      }
      onRuntimeEvent({
        surfaceId,
        instanceId: instance.id,
        type: 'activate',
        pointer: { button: event.button },
      })
    })

    slot.append(shell)
    shells.set(instance.id, shell)
  }

  const registerInstance = input => {
    if (disposed) throw new Error('surface spike is disposed')
    if (!input || typeof input.id !== 'string' || input.id.length === 0) throw new TypeError('instance id is required')
    if (instances.has(input.id)) throw new Error(`instance ${input.id} is already registered`)
    const instance = {
      id: input.id,
      label: typeof input.label === 'string' ? input.label : input.id,
      color: typeof input.color === 'string' ? input.color : '#2563eb',
      rect: normalizeRect(input.rect),
    }
    instances.set(instance.id, instance)
    createShell(instance)
    render()
    return () => {
      instances.delete(instance.id)
      shells.get(instance.id)?.remove()
      shells.delete(instance.id)
      render()
    }
  }

  const updateInstanceRect = (instanceId, rect) => {
    const current = instances.get(instanceId)
    if (!current) throw new Error(`unknown instance ${instanceId}`)
    const next = { ...current, rect: normalizeRect(rect) }
    instances.set(instanceId, next)
    assignRect(shells.get(instanceId), next.rect)
    render()
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    ready = false
    frame.removeEventListener('load', connect)
    channel?.port1.close()
    channel?.port2.close()
    activationLifecycle?.dispose()
    slot.remove()
    if (computedPosition === 'static') viewport.style.position = originalPosition
    rejectReady(new Error('surface spike disposed before sandbox became ready'))
  }

  return Object.freeze({
    surfaceId,
    mode,
    registerInstance,
    updateInstanceRect,
    whenReady: () => readyPromise,
    getDiagnostics: () => ({
      surfaceId,
      mode,
      ready,
      iframeCount: slot.querySelectorAll('iframe').length,
      instanceCount: instances.size,
      coordinateModel: slot.dataset.coordinateModel,
      activation: activationLifecycle?.getDiagnostics() ?? { state: 'not-configured' },
    }),
    dispose,
  })
}
