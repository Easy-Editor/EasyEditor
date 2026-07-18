import { createDashboardTelemetryChannel } from '../telemetry-channel.mjs'
import { createOnlineComponentActivationLifecycle } from './activation-lifecycle.mjs'
import { createOnlineComponentSandboxDocument } from './sandbox-document.mjs'
import {
  OnlineComponentProtocolError,
  createConnectMessage,
  createRenderBatchMessage,
  normalizeRenderUpdate,
  parseSandboxMessage,
} from './surface-protocol.mjs'
import { createTrustedShellEventAdapter } from './trusted-event-adapter.mjs'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/
const UPDATE_PATCH_KEYS = new Set(['revisionKey', 'rect', 'visible', 'generatedZ', 'payload'])
const SANDBOX_FAULT_DIAGNOSTIC_CODES = new Set([
  'async-lifecycle',
  'global-pollution',
  'lifecycle-timeout',
  'message-storm',
  'render-failed',
  'resource-leak',
  'unexpected-frame-reload',
])

const assertIdentifier = (value, name) => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${name} is invalid`)
  }
  return value
}

const assertMode = mode => {
  if (mode !== 'editor' && mode !== 'preview') throw new TypeError('mode must be editor or preview')
  return mode
}

const normalizeReadinessInput = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('surface host readiness input is required')
  }
  if (Object.keys(value).length !== 1 || !Object.hasOwn(value, 'expectedInstanceIds')) {
    throw new TypeError('surface host readiness input fields are invalid')
  }
  if (!Array.isArray(value.expectedInstanceIds)) {
    throw new TypeError('surface host readiness expectedInstanceIds must be an array')
  }
  const expectedInstanceIds = value.expectedInstanceIds.map((instanceId, index) =>
    assertIdentifier(instanceId, `expectedInstanceIds[${index}]`),
  )
  if (new Set(expectedInstanceIds).size !== expectedInstanceIds.length) {
    throw new TypeError('surface host readiness expectedInstanceIds must be unique')
  }
  return Object.freeze({ expectedInstanceIds: Object.freeze([...expectedInstanceIds].sort()) })
}

const sameIds = (actual, expected) =>
  actual.length === expected.length && actual.every((instanceId, index) => instanceId === expected[index])

const assertEnvironment = environment => {
  for (const method of [
    'createNonce',
    'createMessageChannel',
    'createSandboxFrame',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'subscribeVisibility',
  ]) {
    if (typeof environment?.[method] !== 'function') throw new TypeError(`environment.${method} is required`)
  }
  return environment
}

const assertMarkerStore = markerStore => {
  for (const method of ['read', 'write', 'clear', 'quarantine']) {
    if (typeof markerStore?.[method] !== 'function') throw new TypeError(`markerStore.${method} is required`)
  }
  return markerStore
}

const assignShellRect = (element, rect) => {
  element.style.left = `${rect.x}px`
  element.style.top = `${rect.y}px`
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
}

export const createBrowserOnlineComponentSurfaceEnvironment = () => {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined' || typeof MessageChannel === 'undefined') {
    throw new Error('browser surface environment is unavailable')
  }

  return Object.freeze({
    createNonce: () => {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
      if (!globalThis.crypto?.getRandomValues) throw new Error('secure nonce generation is unavailable')
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
      return `surface-${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
    },
    createMessageChannel: () => new MessageChannel(),
    createSandboxFrame: options => {
      const { mount, mode, surfaceId, document: sandboxDocument } = options
      if (!(mount instanceof HTMLElement)) throw new TypeError('mount must be an HTMLElement')
      if (mount.getAttribute('data-easy-editor-surface-overlay-mount') !== mode) {
        throw new Error(`mount must be the explicit ${mode} surface overlay seam`)
      }

      const slot = globalThis.document.createElement('div')
      slot.dataset.onlineComponentSurface = surfaceId
      slot.dataset.surfaceMode = mode
      Object.assign(slot.style, {
        position: 'absolute',
        inset: '0',
        overflow: 'hidden',
        pointerEvents: 'none',
        contain: 'layout paint style',
        zIndex: '0',
      })

      const frame = globalThis.document.createElement('iframe')
      frame.dataset.onlineComponentSandbox = surfaceId
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('aria-hidden', 'true')
      frame.tabIndex = -1
      frame.srcdoc = sandboxDocument
      Object.assign(frame.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        border: '0',
        background: 'transparent',
        pointerEvents: 'none',
        zIndex: '0',
      })
      slot.append(frame)
      mount.append(slot)

      const loadCleanups = new Set()
      const shellHandles = new Set()
      let disposed = false

      const createShell = input => {
        if (disposed) throw new Error('sandbox frame is disposed')
        const shell = globalThis.document.createElement('div')
        shell.dataset.onlineComponentShell = input.instanceId
        shell.dataset.surfaceMode = mode
        shell.setAttribute('aria-label', `${mode} generated component ${input.instanceId}`)
        Object.assign(shell.style, {
          position: 'absolute',
          pointerEvents: 'auto',
          background: 'transparent',
          touchAction: 'none',
        })

        let dragging = false
        const onClick = event => {
          event.preventDefault()
          event.stopPropagation()
          input.onEvent({
            instanceId: input.instanceId,
            type: mode === 'editor' ? 'select' : 'activate',
            event,
          })
        }
        const onPointerDown = event => {
          if (mode !== 'editor') return
          dragging = true
          input.onEvent({ instanceId: input.instanceId, type: 'drag-start', event })
        }
        const onPointerMove = event => {
          if (mode !== 'editor' || !dragging) return
          input.onEvent({ instanceId: input.instanceId, type: 'drag-move', event })
        }
        const onPointerUp = event => {
          if (mode !== 'editor' || !dragging) return
          dragging = false
          input.onEvent({ instanceId: input.instanceId, type: 'drag-end', event })
        }
        const listeners = [['click', onClick]]
        if (mode === 'editor') {
          listeners.push(
            ['pointerdown', onPointerDown],
            ['pointermove', onPointerMove],
            ['pointerup', onPointerUp],
            ['pointercancel', onPointerUp],
          )
        }
        for (const [type, listener] of listeners) shell.addEventListener(type, listener)
        slot.append(shell)

        let releaseTrustedBinding
        try {
          if (input.bindTrustedShell) {
            releaseTrustedBinding = input.bindTrustedShell(shell, input.instanceId)
            if (typeof releaseTrustedBinding !== 'function') {
              throw new TypeError('trusted shell binder must return a disposer')
            }
          }
        } catch (error) {
          for (const [type, listener] of listeners) shell.removeEventListener(type, listener)
          shell.remove()
          throw error
        }

        const update = next => {
          assignShellRect(shell, next.rect)
          shell.style.zIndex = String(next.generatedZ + 1)
          shell.style.display = next.visible ? 'block' : 'none'
        }
        update(input)

        let shellDisposed = false
        const handle = Object.freeze({
          update,
          dispose: () => {
            if (shellDisposed) return
            shellDisposed = true
            dragging = false
            try {
              releaseTrustedBinding?.()
            } catch {
              // A trusted editor binding cannot retain shell-owned resources.
            } finally {
              releaseTrustedBinding = undefined
              for (const [type, listener] of listeners) shell.removeEventListener(type, listener)
              shell.remove()
              shellHandles.delete(handle)
            }
          },
          getResourceCounts: () =>
            Object.freeze({
              shellCount: shellDisposed ? 0 : 1,
              listenerCount: shellDisposed ? 0 : listeners.length + (releaseTrustedBinding ? 1 : 0),
            }),
        })
        shellHandles.add(handle)
        return handle
      }

      return Object.freeze({
        onLoad: listener => {
          if (disposed) throw new Error('sandbox frame is disposed')
          let active = true
          frame.addEventListener('load', listener)
          const cleanup = () => {
            if (!active) return
            active = false
            frame.removeEventListener('load', listener)
            loadCleanups.delete(cleanup)
          }
          loadCleanups.add(cleanup)
          return cleanup
        },
        postConnect: (message, transferredPort) => {
          frame.contentWindow?.postMessage(message, '*', [transferredPort])
        },
        createShell,
        getResourceCounts: () =>
          Object.freeze({
            iframeCount: disposed ? 0 : 1,
            shellCount: [...shellHandles].reduce((count, handle) => count + handle.getResourceCounts().shellCount, 0),
            listenerCount:
              loadCleanups.size +
              [...shellHandles].reduce((count, handle) => count + handle.getResourceCounts().listenerCount, 0),
          }),
        dispose: () => {
          if (disposed) return
          disposed = true
          for (const cleanup of [...loadCleanups]) cleanup()
          for (const shellHandle of [...shellHandles]) shellHandle.dispose()
          slot.remove()
        },
      })
    },
    requestAnimationFrame: callback => globalThis.requestAnimationFrame(callback),
    cancelAnimationFrame: handle => globalThis.cancelAnimationFrame(handle),
    subscribeVisibility: listener => {
      const onVisibilityChange = () => listener(globalThis.document.visibilityState !== 'hidden')
      globalThis.document.addEventListener('visibilitychange', onVisibilityChange)
      onVisibilityChange()
      return () => globalThis.document.removeEventListener('visibilitychange', onVisibilityChange)
    },
  })
}

const createInertSurfaceHost = ({ state, mode, surfaceId }) => {
  let currentState = state
  const diagnostics = () =>
    Object.freeze({
      state: currentState,
      surfaceId,
      mode,
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
  return Object.freeze({
    surfaceId,
    mode,
    register: () => false,
    update: () => false,
    unregister: () => false,
    restart: () => false,
    setSurfaceVisible: () => false,
    whenReady: () => Promise.resolve(false),
    dispose: () => {
      currentState = 'disposed'
    },
    getDiagnostics: diagnostics,
  })
}

export const createOnlineComponentSurfaceHost = options => {
  const {
    enabled = false,
    safeBoot = false,
    mount,
    mode: requestedMode,
    surfaceId: requestedSurfaceId,
    activationId: requestedActivationId,
    environment: injectedEnvironment,
    markerStore: injectedMarkerStore,
    now = () => Date.now(),
    telemetry,
    telemetryNow = () => Date.now(),
    allowedRuntimeEvents = ['activate'],
    onSelection = () => {},
    onRuntimeEvent = () => {},
    bindTrustedShell,
  } = options ?? {}

  const mode = requestedMode ?? 'editor'
  const surfaceId = requestedSurfaceId ?? 'online-component-surface'
  if (enabled !== true) return createInertSurfaceHost({ state: 'disabled', mode, surfaceId })

  assertMode(mode)
  if (bindTrustedShell !== undefined && typeof bindTrustedShell !== 'function') {
    throw new TypeError('bindTrustedShell must be a function')
  }
  if (mode === 'preview' && bindTrustedShell !== undefined) {
    throw new TypeError('preview surfaces cannot bind trusted drag shells')
  }
  assertIdentifier(surfaceId, 'surfaceId')
  if (safeBoot) return createInertSurfaceHost({ state: 'safe-boot', mode, surfaceId })
  const activationId = assertIdentifier(requestedActivationId, 'activationId')
  const environment = assertEnvironment(injectedEnvironment ?? createBrowserOnlineComponentSurfaceEnvironment())
  const markerStore = assertMarkerStore(injectedMarkerStore)
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (typeof telemetryNow !== 'function') throw new TypeError('telemetryNow must be a function')
  const telemetryChannel = createDashboardTelemetryChannel(telemetry, telemetryNow)
  const emitTelemetry = event => telemetryChannel.emit({ surfaceId, ...event })

  const eventAdapter = createTrustedShellEventAdapter({
    mode,
    surfaceId,
    allowedRuntimeEvents,
    onSelection,
    onRuntimeEvent,
  })
  const instances = new Map()
  const shells = new Map()
  const activationLifecycles = new Map()
  const pendingActivationSequences = new Map()
  const pendingBatches = new Map()
  const quarantinedRevisions = new Set()
  const dirtyInstances = new Set()
  const removedInstances = new Set()
  const readyWaiters = new Set()
  const runtimeEventAllowlist = new Set(allowedRuntimeEvents)
  const emptySandboxResources = Object.freeze({
    instanceCount: 0,
    listenerCount: 0,
    pendingTaskCount: 0,
    objectUrlCount: 0,
  })

  let state = safeBoot ? 'safe-boot' : 'idle'
  let generation = 0
  let sequence = 0
  let batchCount = 0
  let restartCount = 0
  let faultCount = 0
  let rejectedMessageCount = 0
  let disposed = false
  let surfaceVisible = true
  let ready = false
  let frameHandle
  let frameLoadCleanup
  let channel
  let identity
  let scheduledFrame
  let scheduledWork
  let pendingRestartReason
  let visibilityCleanup
  let sandboxResources = emptySandboxResources

  const assertActive = () => {
    if (disposed) throw new Error('online component surface host is disposed')
  }

  const hasPendingActivation = () =>
    [...activationLifecycles.values()].some(lifecycle => lifecycle.getDiagnostics().state === 'pending')

  const readinessStatus = expectedInstanceIds => {
    if (disposed || state === 'quarantined' || state === 'safe-boot') return false
    if (!sameIds([...instances.keys()].sort(), expectedInstanceIds)) return undefined
    if (expectedInstanceIds.length === 0) return true
    return ready && !hasPendingActivation() ? true : undefined
  }

  const settleReadyWaiters = forcedValue => {
    for (const waiter of [...readyWaiters]) {
      const status = forcedValue ?? readinessStatus(waiter.expectedInstanceIds)
      if (status === undefined) continue
      readyWaiters.delete(waiter)
      waiter.resolve(status)
    }
  }

  const activeInstances = () =>
    [...instances.values()].filter(instance => !quarantinedRevisions.has(instance.revisionKey))

  const compareInstances = (left, right) =>
    left.generatedZ - right.generatedZ || left.instanceId.localeCompare(right.instanceId)

  const activeRevisionKeys = () => [...new Set(activeInstances().map(instance => instance.revisionKey))].sort()

  const retireLifecycle = revisionKey => {
    const lifecycle = activationLifecycles.get(revisionKey)
    lifecycle?.abortPending()
    lifecycle?.dispose()
    activationLifecycles.delete(revisionKey)
    pendingActivationSequences.delete(revisionKey)
  }

  const beginRevisionActivation = (revisionKey, nonce) => {
    if (quarantinedRevisions.has(revisionKey)) return false
    const current = activationLifecycles.get(revisionKey)
    const currentState = current?.getDiagnostics().state
    if (currentState === 'pending' || currentState === 'active') return true

    const lifecycle = createOnlineComponentActivationLifecycle({
      markerStore,
      revisionKey,
      surfaceId,
      activationId,
      nonce,
      safeBoot,
      now,
    })
    const decision = lifecycle.begin()
    activationLifecycles.set(revisionKey, lifecycle)
    if (!decision.activate) {
      quarantinedRevisions.add(revisionKey)
      if (activeInstances().length === 0) {
        state = decision.reason === 'safe-boot' ? 'safe-boot' : 'quarantined'
      }
      return false
    }
    return true
  }

  const beginFrameActivationRound = nonce => {
    for (const lifecycle of activationLifecycles.values()) lifecycle.dispose()
    activationLifecycles.clear()
    pendingActivationSequences.clear()
    for (const revisionKey of activeRevisionKeys()) beginRevisionActivation(revisionKey, nonce)
    return activeInstances().length > 0
  }

  const frameResourceCounts = () => {
    if (!frameHandle) return Object.freeze({ iframeCount: 0, shellCount: 0, listenerCount: 0 })
    if (typeof frameHandle.getResourceCounts !== 'function') {
      throw new Error('sandbox frame must expose getResourceCounts for leak diagnostics')
    }
    return frameHandle.getResourceCounts()
  }

  const clearScheduledWork = () => {
    if (scheduledFrame !== undefined) environment.cancelAnimationFrame(scheduledFrame)
    scheduledFrame = undefined
    scheduledWork = undefined
  }

  const clearFrameResources = () => {
    clearScheduledWork()
    pendingRestartReason = undefined
    for (const shell of shells.values()) shell.dispose()
    shells.clear()
    frameLoadCleanup?.()
    frameLoadCleanup = undefined
    if (channel) {
      channel.port1.onmessage = undefined
      channel.port1.close()
      channel.port2.close()
      channel = undefined
    }
    frameHandle?.dispose()
    frameHandle = undefined
    identity = undefined
    ready = false
    pendingBatches.clear()
    pendingActivationSequences.clear()
    sandboxResources = emptySandboxResources
    settleReadyWaiters(false)
  }

  const createShell = instance => {
    if (!frameHandle || quarantinedRevisions.has(instance.revisionKey)) return
    const shell = frameHandle.createShell({
      instanceId: instance.instanceId,
      rect: instance.rect,
      visible: instance.visible,
      generatedZ: instance.generatedZ,
      mode,
      onEvent: eventAdapter.dispatch,
      ...(bindTrustedShell ? { bindTrustedShell } : {}),
    })
    shells.set(instance.instanceId, shell)
  }

  const applySandboxResources = resources => {
    sandboxResources = Object.freeze({ ...resources })
  }

  const scheduleWork = () => {
    if (disposed || !surfaceVisible) return
    if (pendingRestartReason) {
      scheduledWork = 'restart'
    } else if (scheduledFrame !== undefined) {
      return
    } else if (ready && (dirtyInstances.size > 0 || removedInstances.size > 0)) {
      scheduledWork = 'batch'
    } else {
      return
    }
    if (scheduledFrame === undefined) scheduledFrame = environment.requestAnimationFrame(flushScheduledWork)
  }

  const flushBatch = () => {
    if (disposed || !ready || !surfaceVisible || !channel || !identity) return
    const updates = [...dirtyInstances]
      .map(instanceId => instances.get(instanceId))
      .filter(instance => instance && !quarantinedRevisions.has(instance.revisionKey))
      .sort(compareInstances)
    const removals = [...removedInstances].sort()
    if (updates.length === 0 && removals.length === 0) return

    sequence += 1
    const message = createRenderBatchMessage({
      ...identity,
      sequence,
      updates,
      removals,
    })
    dirtyInstances.clear()
    removedInstances.clear()
    const revisionKeys = [...new Set(updates.map(update => update.revisionKey))]
    pendingBatches.set(sequence, {
      instanceCount: activeInstances().length,
      batchSize: updates.length + removals.length,
      ...(revisionKeys.length === 1 ? { revisionKey: revisionKeys[0] } : {}),
    })
    for (const update of updates) {
      const lifecycle = activationLifecycles.get(update.revisionKey)
      if (lifecycle?.getDiagnostics().state === 'pending' && !pendingActivationSequences.has(update.revisionKey)) {
        pendingActivationSequences.set(update.revisionKey, sequence)
      }
    }
    channel.port1.postMessage(message)
    batchCount += 1
    emitTelemetry({
      eventType: 'dashboard.iframe.batch',
      status: 'scheduled',
      batchSize: updates.length + removals.length,
      instanceCount: activeInstances().length,
      ...(revisionKeys.length === 1 ? { revisionKey: revisionKeys[0] } : {}),
    })
  }

  const setSurfaceVisible = visible => {
    if (disposed || typeof visible !== 'boolean' || surfaceVisible === visible) return false
    surfaceVisible = visible
    if (!visible) {
      state = ready ? 'hidden' : state
      clearScheduledWork()
      return true
    }
    state = ready ? 'ready' : state
    scheduleWork()
    return true
  }

  const ensureVisibilitySubscription = () => {
    visibilityCleanup ??= environment.subscribeVisibility(setSurfaceVisible)
  }

  const handleBatchApplied = message => {
    applySandboxResources(message.resources)
    const firstPendingSequence = pendingBatches.keys().next().value
    if (firstPendingSequence !== message.sequence) {
      rejectedMessageCount += 1
      return
    }
    const pendingBatch = pendingBatches.get(message.sequence)
    if (pendingBatch === undefined) {
      rejectedMessageCount += 1
      return
    }
    pendingBatches.delete(message.sequence)
    if (message.resources.objectUrlCount !== 0 || message.resources.instanceCount !== pendingBatch.instanceCount) {
      handleSandboxFault({ code: 'resource-leak', instanceId: null })
      return
    }
    emitTelemetry({
      eventType: 'dashboard.iframe.batch',
      status: 'completed',
      batchSize: pendingBatch.batchSize,
      instanceCount: pendingBatch.instanceCount,
      ...(pendingBatch.revisionKey === undefined ? {} : { revisionKey: pendingBatch.revisionKey }),
    })
    for (const [revisionKey, activationSequence] of pendingActivationSequences) {
      if (activationSequence > message.sequence) continue
      activationLifecycles.get(revisionKey)?.completeRehydrate()
      pendingActivationSequences.delete(revisionKey)
    }
    settleReadyWaiters()
  }

  const quarantineRevision = revisionKey => {
    if (quarantinedRevisions.has(revisionKey)) return false
    quarantinedRevisions.add(revisionKey)
    activationLifecycles.get(revisionKey)?.fail()
    pendingActivationSequences.delete(revisionKey)
    for (const instance of instances.values()) {
      if (instance.revisionKey !== revisionKey) continue
      dirtyInstances.delete(instance.instanceId)
      const shell = shells.get(instance.instanceId)
      shell?.dispose()
      shells.delete(instance.instanceId)
    }
    return true
  }

  const startFrame = nonce => {
    if (disposed || instances.size === 0) return false
    if (!beginFrameActivationRound(nonce)) {
      state = safeBoot ? 'safe-boot' : quarantinedRevisions.size > 0 ? 'quarantined' : 'idle'
      return false
    }

    generation += 1
    sequence = 0
    ready = false
    state = 'starting'
    identity = Object.freeze({ nonce, surfaceId, generation })
    channel = environment.createMessageChannel()
    channel.port1.onmessage = handlePortMessage
    channel.port1.start()
    frameHandle = environment.createSandboxFrame({
      mount,
      mode,
      surfaceId,
      generation,
      nonce,
      sandbox: 'allow-scripts',
      pointerEvents: 'none',
      document: createOnlineComponentSandboxDocument(identity),
    })
    for (const method of ['onLoad', 'postConnect', 'createShell', 'getResourceCounts', 'dispose']) {
      if (typeof frameHandle?.[method] !== 'function') throw new TypeError(`sandbox frame.${method} is required`)
    }
    for (const instance of activeInstances().sort(compareInstances)) {
      dirtyInstances.add(instance.instanceId)
      createShell(instance)
    }
    removedInstances.clear()

    const frameGeneration = generation
    let connected = false
    frameLoadCleanup = frameHandle.onLoad(() => {
      if (!frameHandle || !channel || !identity || disposed || generation !== frameGeneration) return
      if (connected) {
        handleSandboxFault({ code: 'unexpected-frame-reload', instanceId: null })
        return
      }
      connected = true
      frameHandle.postConnect(createConnectMessage(identity), channel.port2)
    })
    return true
  }

  const restartInternal = reason => {
    if (disposed || instances.size === 0) return false
    if (typeof reason !== 'string' || reason.length === 0) throw new TypeError('restart reason is required')
    clearFrameResources()
    restartCount += 1
    const started = startFrame(environment.createNonce())
    if (!started && quarantinedRevisions.size === 0) state = 'idle'
    emitTelemetry({
      eventType: 'dashboard.iframe.restart',
      status: started ? 'restarted' : 'failed',
      diagnosticCode: 'surface-restart',
      instanceCount: activeInstances().length,
    })
    return started
  }

  const handleSandboxFault = message => {
    faultCount += 1
    const revisions = new Set()
    const instance = message.instanceId === null ? undefined : instances.get(message.instanceId)
    if (instance) revisions.add(instance.revisionKey)
    if (message.instanceId === null || revisions.size === 0) {
      for (const revisionKey of activeRevisionKeys()) revisions.add(revisionKey)
    }
    for (const revisionKey of revisions) quarantineRevision(revisionKey)
    emitTelemetry({
      eventType: 'dashboard.iframe.fault',
      status: 'failed',
      diagnosticCode: SANDBOX_FAULT_DIAGNOSTIC_CODES.has(message.code) ? message.code : 'sandbox-fault',
      ...(revisions.size === 1 ? { revisionKey: [...revisions][0] } : {}),
    })

    clearFrameResources()
    if (activeInstances().length === 0) {
      visibilityCleanup?.()
      visibilityCleanup = undefined
      state = 'quarantined'
      return
    }
    restartCount += 1
    if (surfaceVisible) startFrame(environment.createNonce())
    else {
      state = 'hidden'
      pendingRestartReason = `sandbox-fault:${message.code}`
    }
  }

  const handlePortMessage = event => {
    if (!identity || disposed) return
    let message
    try {
      message = parseSandboxMessage(event.data, identity)
    } catch (error) {
      if (error instanceof OnlineComponentProtocolError) {
        rejectedMessageCount += 1
        return
      }
      throw error
    }

    if (message.kind === 'online-component.ready') {
      if (ready) {
        rejectedMessageCount += 1
        return
      }
      applySandboxResources(message.resources)
      if (
        message.resources.instanceCount !== 0 ||
        message.resources.pendingTaskCount !== 0 ||
        message.resources.objectUrlCount !== 0
      ) {
        handleSandboxFault({ code: 'resource-leak', instanceId: null })
        return
      }
      ready = true
      state = surfaceVisible ? 'ready' : 'hidden'
      for (const instance of activeInstances()) dirtyInstances.add(instance.instanceId)
      scheduleWork()
      return
    }
    if (message.kind === 'online-component.batch-applied') {
      handleBatchApplied(message)
      return
    }
    if (message.kind === 'online-component.fault') {
      applySandboxResources(message.resources)
      handleSandboxFault(message)
      return
    }
    if (message.kind === 'online-component.event') {
      if (!instances.has(message.instanceId) || !runtimeEventAllowlist.has(message.event.type)) {
        rejectedMessageCount += 1
        return
      }
      onRuntimeEvent(
        Object.freeze({
          kind: 'online-component.runtime-event',
          surfaceId,
          instanceId: message.instanceId,
          type: message.event.type,
          payload: message.event.payload,
        }),
      )
    }
  }

  function flushScheduledWork() {
    const work = scheduledWork
    const restartReason = pendingRestartReason
    scheduledFrame = undefined
    scheduledWork = undefined
    if (work === 'restart') {
      pendingRestartReason = undefined
      restartInternal(restartReason)
      return
    }
    flushBatch()
  }

  const register = input => {
    assertActive()
    const instance = normalizeRenderUpdate(input)
    if (instances.has(instance.instanceId)) throw new Error(`instance ${instance.instanceId} is already registered`)
    if (quarantinedRevisions.has(instance.revisionKey)) return false

    if (frameHandle && !beginRevisionActivation(instance.revisionKey, identity.nonce)) return false
    instances.set(instance.instanceId, instance)
    settleReadyWaiters()
    dirtyInstances.add(instance.instanceId)
    removedInstances.delete(instance.instanceId)
    ensureVisibilitySubscription()
    if (frameHandle) {
      createShell(instance)
      scheduleWork()
    } else {
      if (!startFrame(environment.createNonce())) {
        instances.delete(instance.instanceId)
        dirtyInstances.delete(instance.instanceId)
        if (instances.size === 0) {
          visibilityCleanup?.()
          visibilityCleanup = undefined
        }
        return false
      }
    }
    return () => unregister(instance.instanceId)
  }

  const update = (instanceId, patch) => {
    assertActive()
    const current = instances.get(instanceId)
    if (!current) throw new Error(`unknown instance ${instanceId}`)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('update patch is required')
    for (const key of Object.keys(patch)) {
      if (!UPDATE_PATCH_KEYS.has(key)) throw new TypeError(`unsupported update field ${key}`)
    }
    const next = normalizeRenderUpdate({ ...current, ...patch, instanceId })
    const revisionChanged = next.revisionKey !== current.revisionKey
    instances.set(instanceId, next)
    dirtyInstances.add(instanceId)
    removedInstances.delete(instanceId)
    shells.get(instanceId)?.update(next)

    if (revisionChanged) {
      if (![...instances.values()].some(instance => instance.revisionKey === current.revisionKey)) {
        retireLifecycle(current.revisionKey)
      }
      pendingRestartReason = 'revision-changed'
      scheduleWork()
      return true
    }
    if (!quarantinedRevisions.has(next.revisionKey)) scheduleWork()
    return !quarantinedRevisions.has(next.revisionKey)
  }

  const unregister = instanceId => {
    assertActive()
    assertIdentifier(instanceId, 'instanceId')
    const current = instances.get(instanceId)
    if (!current || !instances.delete(instanceId)) return false
    settleReadyWaiters(false)
    dirtyInstances.delete(instanceId)
    removedInstances.add(instanceId)
    shells.get(instanceId)?.dispose()
    shells.delete(instanceId)
    if (![...instances.values()].some(instance => instance.revisionKey === current.revisionKey)) {
      retireLifecycle(current.revisionKey)
    }
    if (instances.size === 0) {
      clearFrameResources()
      visibilityCleanup?.()
      visibilityCleanup = undefined
      removedInstances.clear()
      state = 'idle'
      return true
    }
    scheduleWork()
    return true
  }

  const restart = reason => {
    assertActive()
    if (typeof reason !== 'string' || reason.length === 0) throw new TypeError('restart reason is required')
    pendingRestartReason ??= reason
    scheduleWork()
    return true
  }

  const abortOwnedActivation = () => {
    if (disposed) return false
    clearFrameResources()
    visibilityCleanup?.()
    visibilityCleanup = undefined
    instances.clear()
    dirtyInstances.clear()
    removedInstances.clear()
    let aborted = false
    for (const lifecycle of activationLifecycles.values()) {
      aborted = lifecycle.abortPending() || aborted
    }
    state = 'idle'
    return aborted
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    clearFrameResources()
    visibilityCleanup?.()
    visibilityCleanup = undefined
    instances.clear()
    dirtyInstances.clear()
    removedInstances.clear()
    pendingBatches.clear()
    pendingActivationSequences.clear()
    for (const lifecycle of activationLifecycles.values()) lifecycle.dispose()
    activationLifecycles.clear()
    quarantinedRevisions.clear()
    state = 'disposed'
  }

  const getDiagnostics = () => {
    const frameResources = frameResourceCounts()
    return Object.freeze({
      state,
      surfaceId,
      mode,
      generation,
      iframeCount: frameResources.iframeCount,
      portCount: channel ? 2 : 0,
      shellCount: frameResources.shellCount,
      instanceCount: instances.size,
      scheduledFrameCount: scheduledFrame === undefined ? 0 : 1,
      batchCount,
      pendingBatchCount: pendingBatches.size,
      restartCount,
      faultCount,
      rejectedMessageCount,
      listenerCount: frameResources.listenerCount + (visibilityCleanup ? 1 : 0) + (channel ? 1 : 0),
      pendingActivationCount: [...activationLifecycles.values()].filter(
        lifecycle => lifecycle.getDiagnostics().state === 'pending',
      ).length,
      quarantinedRevisionCount: quarantinedRevisions.size,
      sandboxInstanceCount: sandboxResources.instanceCount,
      sandboxListenerCount: sandboxResources.listenerCount,
      sandboxPendingTaskCount: sandboxResources.pendingTaskCount,
      objectUrlCount: sandboxResources.objectUrlCount,
    })
  }

  return Object.freeze({
    surfaceId,
    mode,
    register,
    update,
    unregister,
    restart,
    setSurfaceVisible,
    abortOwnedActivation,
    whenReady: rawInput => {
      const { expectedInstanceIds } = normalizeReadinessInput(rawInput)
      const status = readinessStatus(expectedInstanceIds)
      if (status !== undefined) return Promise.resolve(status)
      const waiter = { expectedInstanceIds, resolve: undefined }
      return new Promise(resolve => {
        waiter.resolve = resolve
        readyWaiters.add(waiter)
      })
    },
    dispose,
    getDiagnostics,
  })
}
