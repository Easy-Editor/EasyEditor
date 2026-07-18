import { resolveDashboardOnlineComponentContext, sanitizeDashboardOnlineComponentProps } from './context-resolver.mjs'
import { createOnlineComponentSurfaceController } from './surface-controller.mjs'

export { resolveDashboardOnlineComponentContext, sanitizeDashboardOnlineComponentProps }

export const DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY = 'onlineComponentSurfaceBridge'
export const DASHBOARD_ONLINE_COMPONENT_SAFE_BOOT_QUERY = 'easy-editor-online-safe-boot'
export const DASHBOARD_ONLINE_COMPONENT_RUNTIME_EVENT = 'easy-editor:online-component-runtime-event'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const isFeatureEnabled = value => value === true || value === 'true' || value === '1'

const assertIdentifier = (value, name) => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) throw new TypeError(`${name} is invalid`)
  return value
}

const assertPlainObject = (value, name) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${name} is required`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object`)
  return value
}

const normalizeExpectedInstanceIds = value => {
  if (!Array.isArray(value)) throw new TypeError('expectedInstanceIds must be an array')
  const expected = value.map((instanceId, index) => assertIdentifier(instanceId, `expectedInstanceIds[${index}]`))
  if (new Set(expected).size !== expected.length) throw new TypeError('expectedInstanceIds must be unique')
  return Object.freeze([...expected].sort())
}

const normalizeSurfaceReadinessInput = value => {
  const input = assertPlainObject(value, 'surface readiness input')
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'expectedInstanceIds')) {
    throw new TypeError('surface readiness input fields are invalid')
  }
  return Object.freeze({ expectedInstanceIds: normalizeExpectedInstanceIds(input.expectedInstanceIds) })
}

const normalizeBridgeReadinessInput = value => {
  const input = assertPlainObject(value, 'surface bridge readiness input')
  const fields = Object.keys(input).sort()
  if (fields.length !== 2 || fields[0] !== 'expectedInstanceIds' || fields[1] !== 'requireRegistered') {
    throw new TypeError('surface bridge readiness input fields are invalid')
  }
  if (typeof input.requireRegistered !== 'boolean') {
    throw new TypeError('surface bridge readiness requireRegistered must be a boolean')
  }
  return Object.freeze({
    expectedInstanceIds: normalizeExpectedInstanceIds(input.expectedInstanceIds),
    requireRegistered: input.requireRegistered,
  })
}

const sameInstanceIds = (actual, expected) =>
  actual.length === expected.length && actual.every((instanceId, index) => instanceId === expected[index])

const sanitizeJsonValue = (value, depth, seen) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'object' || depth > 16 || seen.has(value)) return undefined
  seen.add(value)
  if (Array.isArray(value)) {
    const sanitized = value.map(item => sanitizeJsonValue(item, depth + 1, seen) ?? null)
    seen.delete(value)
    return sanitized
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value)
    return undefined
  }
  const sanitized = {}
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_JSON_KEYS.has(key) || key.startsWith('__')) continue
    const next = sanitizeJsonValue(child, depth + 1, seen)
    if (next !== undefined) sanitized[key] = next
  }
  seen.delete(value)
  return sanitized
}

export const resolveDashboardOnlineComponentSafeBoot = search => {
  if (typeof search !== 'string' || search.length === 0) return false
  const value = new URLSearchParams(search).get(DASHBOARD_ONLINE_COMPONENT_SAFE_BOOT_QUERY)
  return value === '1' || value === 'true'
}

export const resolveDashboardOnlineComponentSurfaceFeatureFlags = (source = {}) =>
  Object.freeze({
    runtime: isFeatureEnabled(source.VITE_DASHBOARD_AGENT_RUNTIME),
    online: isFeatureEnabled(source.VITE_DASHBOARD_AGENT_ONLINE),
  })

export const isDashboardOnlineComponentSurfaceEnabled = flags => flags?.runtime === true && flags?.online === true

export const dispatchDashboardOnlineComponentRuntimeEvent = (
  target,
  event,
  CustomEventClass = globalThis.CustomEvent,
) => {
  if (typeof target?.dispatchEvent !== 'function' || typeof CustomEventClass !== 'function') {
    throw new TypeError('runtime event target is unavailable')
  }
  const surfaceId = assertIdentifier(event?.surfaceId, 'surfaceId')
  const instanceId = assertIdentifier(event?.instanceId, 'instanceId')
  if (typeof event.type !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/u.test(event.type)) {
    throw new TypeError('runtime event type is invalid')
  }
  const payload = sanitizeJsonValue(event.payload ?? null, 0, new Set()) ?? null
  const detail = Object.freeze({ schemaVersion: 1, surfaceId, instanceId, type: event.type, payload })
  return target.dispatchEvent(new CustomEventClass(DASHBOARD_ONLINE_COMPONENT_RUNTIME_EVENT, { detail }))
}

const isLayoutVisible = style =>
  style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse'

const hasPositiveArea = rect => rect.width > 0 && rect.height > 0

const CLIPPING_OVERFLOW_VALUES = new Set(['auto', 'clip', 'hidden', 'scroll'])
const DOCUMENT_POSITION_DISCONNECTED = 0x01
const DOCUMENT_POSITION_PRECEDING = 0x02
const DOCUMENT_POSITION_FOLLOWING = 0x04

const clipsAxis = (style, axis) => {
  const value = axis === 'x' ? (style?.overflowX ?? style?.overflow) : (style?.overflowY ?? style?.overflow)
  return CLIPPING_OVERFLOW_VALUES.has(value)
}

const getRectEnd = (rect, axis) =>
  axis === 'x' ? (rect.right ?? rect.left + rect.width) : (rect.bottom ?? rect.top + rect.height)

const intersectsAxis = (first, second, axis) => {
  const start = axis === 'x' ? 'left' : 'top'
  return Math.min(getRectEnd(first, axis), getRectEnd(second, axis)) > Math.max(first[start], second[start])
}

const createClipDescriptor = (element, getComputedStyle) => {
  const style = getComputedStyle?.(element)
  const clipX = clipsAxis(style, 'x')
  const clipY = clipsAxis(style, 'y')
  return clipX || clipY ? { element, clipX, clipY, style } : undefined
}

const collectSurfaceAncestors = mount => {
  const ancestors = []
  const seen = new Set([mount])
  let current = mount.parentElement
  while (current && !seen.has(current)) {
    ancestors.push(current)
    seen.add(current)
    current = current.parentElement
  }
  return ancestors
}

const compareBindingDocumentOrder = (first, second) => {
  if (first === second) return 0
  if (
    first.element?.isConnected !== false &&
    second.element?.isConnected !== false &&
    typeof first.element?.compareDocumentPosition === 'function'
  ) {
    try {
      const position = first.element.compareDocumentPosition(second.element)
      if ((position & DOCUMENT_POSITION_DISCONNECTED) === 0) {
        if ((position & DOCUMENT_POSITION_FOLLOWING) !== 0) return -1
        if ((position & DOCUMENT_POSITION_PRECEDING) !== 0) return 1
      }
    } catch {
      // Non-DOM test doubles and cross-document nodes retain deterministic connection order.
    }
  }
  return first.connectionOrder - second.connectionOrder
}

const createMeasurementContext = (mount, clipAncestors, getComputedStyle) => {
  const mountRect = mount.getBoundingClientRect()
  const clipRects = clipAncestors.map(clip => ({ ...clip, rect: clip.element.getBoundingClientRect() }))
  const scaleX = mount.clientWidth > 0 && mountRect.width > 0 ? mountRect.width / mount.clientWidth : 1
  const scaleY = mount.clientHeight > 0 && mountRect.height > 0 ? mountRect.height / mount.clientHeight : 1
  return {
    mountRect,
    clipRects,
    scaleX,
    scaleY,
    surfaceVisible:
      mount.isConnected !== false &&
      hasPositiveArea(mountRect) &&
      isLayoutVisible(getComputedStyle?.(mount)) &&
      clipRects.every(
        clip =>
          clip.element.isConnected !== false &&
          isLayoutVisible(clip.style) &&
          (!clip.clipX || clip.rect.width > 0) &&
          (!clip.clipY || clip.rect.height > 0),
      ),
  }
}

const measureBinding = (binding, context, getComputedStyle) => {
  const elementRect = binding.element.getBoundingClientRect()
  const style = getComputedStyle?.(binding.element)
  return Object.freeze({
    rect: Object.freeze({
      x: (elementRect.left - context.mountRect.left) / context.scaleX,
      y: (elementRect.top - context.mountRect.top) / context.scaleY,
      width: elementRect.width / context.scaleX,
      height: elementRect.height / context.scaleY,
    }),
    visible:
      context.surfaceVisible &&
      binding.node?.hidden !== true &&
      binding.element.isConnected !== false &&
      isLayoutVisible(style) &&
      hasPositiveArea(elementRect) &&
      intersectsAxis(elementRect, context.mountRect, 'x') &&
      intersectsAxis(elementRect, context.mountRect, 'y') &&
      context.clipRects.every(
        clip =>
          (!clip.clipX || intersectsAxis(elementRect, clip.rect, 'x')) &&
          (!clip.clipY || intersectsAxis(elementRect, clip.rect, 'y')),
      ),
  })
}

export const createDashboardOnlineComponentSurfaceBridge = (options = {}) => {
  const requestFrame = options.requestAnimationFrame ?? globalThis.requestAnimationFrame?.bind(globalThis)
  const cancelFrame = options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis)
  const getComputedStyle = options.getComputedStyle ?? globalThis.getComputedStyle?.bind(globalThis)
  const ResizeObserverClass = options.ResizeObserver ?? globalThis.ResizeObserver
  const MutationObserverClass = options.MutationObserver ?? globalThis.MutationObserver
  const eventTarget = options.eventTarget ?? globalThis.window
  const onError = options.onError ?? (() => undefined)
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new TypeError('surface bridge animation frame functions are required')
  }
  if (typeof onError !== 'function') throw new TypeError('surface bridge onError must be a function')

  const bindings = new Map()
  let controller
  let projectId
  let mount
  let attachmentToken
  let surfaceAncestors = []
  let clipAncestors = []
  let frame
  let resizeObserver
  let mutationObserver
  let listenerCount = 0
  let nextConnectionOrder = 0
  const readinessWaiters = new Set()

  const report = error => {
    try {
      onError(error)
    } catch {
      // Diagnostics cannot change runtime ownership.
    }
  }

  const safely = action => {
    try {
      action()
    } catch (error) {
      report(error)
    }
  }

  const cancelScheduledFrame = () => {
    if (frame === undefined) return
    const scheduledFrame = frame
    frame = undefined
    safely(() => cancelFrame(scheduledFrame))
    settleReadinessWaiters()
  }

  const safelyUnregister = (ownedController, instanceId) => {
    if (typeof ownedController?.unregister !== 'function') return
    safely(() => ownedController.unregister(instanceId))
  }

  const bindingsMatch = expectedInstanceIds =>
    bindings.size === expectedInstanceIds.length && expectedInstanceIds.every(instanceId => bindings.has(instanceId))

  const readinessStatus = (input, expectedAttachmentToken = attachmentToken) => {
    if (expectedAttachmentToken !== attachmentToken || !controller || !mount) return false
    if (!bindingsMatch(input.expectedInstanceIds)) return undefined
    const expectedBindings = input.expectedInstanceIds.map(instanceId => bindings.get(instanceId))
    if (input.requireRegistered && expectedBindings.some(binding => binding.failed)) return false
    if (frame !== undefined || expectedBindings.some(binding => binding.pending)) return undefined
    if (input.requireRegistered && expectedBindings.some(binding => !binding.registered)) return undefined
    return true
  }

  function settleReadinessWaiters() {
    for (const waiter of [...readinessWaiters]) {
      const status = readinessStatus(waiter.input, waiter.attachmentToken)
      if (status === undefined) continue
      readinessWaiters.delete(waiter)
      waiter.resolve(status)
    }
  }

  const matchesReadyCensus = rawInput => readinessStatus(normalizeBridgeReadinessInput(rawInput)) === true

  const whenReady = rawInput => {
    const input = normalizeBridgeReadinessInput(rawInput)
    const status = readinessStatus(input)
    if (status !== undefined) return Promise.resolve(status)
    const waiter = {
      attachmentToken,
      input,
      resolve: undefined,
    }
    return new Promise(resolve => {
      waiter.resolve = resolve
      readinessWaiters.add(waiter)
    })
  }

  const schedule = () => {
    if (frame !== undefined || !controller || !mount || bindings.size === 0) return
    frame = requestFrame(flush)
    settleReadinessWaiters()
  }

  const isObservedByAnotherBinding = (element, ignoredBinding) => {
    for (const binding of bindings.values()) {
      if (binding !== ignoredBinding && binding.element === element) return true
    }
    return false
  }

  const sameElements = (first, second) =>
    first.length === second.length && first.every((element, index) => element === second[index])

  const isBindingElement = element => {
    for (const binding of bindings.values()) {
      if (binding.element === element) return true
    }
    return false
  }

  const refreshSurfaceTopology = () => {
    if (!mount) return
    const nextAncestors = collectSurfaceAncestors(mount)
    const nextClipAncestors = nextAncestors
      .map(element => createClipDescriptor(element, getComputedStyle))
      .filter(Boolean)

    if (resizeObserver) {
      for (const clip of clipAncestors) {
        if (
          !nextClipAncestors.some(next => next.element === clip.element) &&
          clip.element !== mount &&
          !isBindingElement(clip.element)
        ) {
          resizeObserver.unobserve(clip.element)
        }
      }
      for (const clip of nextClipAncestors) resizeObserver.observe(clip.element)
    }

    if (mutationObserver && !sameElements(surfaceAncestors, nextAncestors)) {
      mutationObserver.disconnect()
      const [surfaceParent, ...outerAncestors] = nextAncestors
      if (surfaceParent) {
        mutationObserver.observe(surfaceParent, { attributes: true, childList: true, subtree: true })
        for (const ancestor of outerAncestors) {
          mutationObserver.observe(ancestor, { attributes: true, childList: true })
        }
      }
    }
    surfaceAncestors = nextAncestors
    clipAncestors = nextClipAncestors
  }

  const refreshGeneratedZ = () => {
    const orderedBindings = [...bindings.values()].sort(compareBindingDocumentOrder)
    for (const [generatedZ, binding] of orderedBindings.entries()) binding.generatedZ = generatedZ
  }

  const stopInvalidationSources = () => {
    const activeResizeObserver = resizeObserver
    resizeObserver = undefined
    const activeMutationObserver = mutationObserver
    mutationObserver = undefined
    const activeListenerCount = listenerCount
    listenerCount = 0
    surfaceAncestors = []
    clipAncestors = []
    if (activeResizeObserver) safely(() => activeResizeObserver.disconnect())
    if (activeMutationObserver) safely(() => activeMutationObserver.disconnect())
    if (activeListenerCount > 0) {
      safely(() => eventTarget.removeEventListener('resize', schedule))
      safely(() => eventTarget.removeEventListener('scroll', schedule, true))
    }
  }

  const startInvalidationSources = () => {
    if (!controller || !mount || bindings.size === 0 || resizeObserver || mutationObserver || listenerCount > 0) return
    if (typeof ResizeObserverClass === 'function') {
      resizeObserver = new ResizeObserverClass(schedule)
      resizeObserver.observe(mount)
      for (const binding of bindings.values()) resizeObserver.observe(binding.element)
    }
    if (typeof MutationObserverClass === 'function') {
      mutationObserver = new MutationObserverClass(records => {
        const hasExternalMutation = records.some(record => {
          if (record.target === mount) return record.type !== 'childList'
          return typeof mount.contains !== 'function' || !mount.contains(record.target)
        })
        if (hasExternalMutation) schedule()
      })
    }
    refreshSurfaceTopology()
    if (typeof eventTarget?.addEventListener === 'function' && typeof eventTarget?.removeEventListener === 'function') {
      eventTarget.addEventListener('resize', schedule)
      eventTarget.addEventListener('scroll', schedule, true)
      listenerCount = 2
    }
  }

  const applyBinding = (binding, measurement) => {
    const payload = Object.freeze({
      ...binding.context,
      size: Object.freeze({ width: measurement.rect.width, height: measurement.rect.height }),
    })
    const fingerprint = JSON.stringify({
      node: binding.node,
      rect: measurement.rect,
      visible: measurement.visible,
      generatedZ: binding.generatedZ,
      payload,
    })
    if (binding.pending || binding.lastAttempt === fingerprint) return
    binding.lastAttempt = fingerprint
    binding.failed = false
    binding.pending = true
    settleReadinessWaiters()
    const pendingToken = Object.freeze({})
    binding.pendingToken = pendingToken
    const activeController = controller
    const activeAttachmentToken = attachmentToken
    const isCurrentOperation = () =>
      binding.pendingToken === pendingToken &&
      attachmentToken === activeAttachmentToken &&
      controller === activeController &&
      bindings.get(binding.instanceId) === binding
    let operation
    try {
      operation = binding.registered
        ? activeController.update(binding.instanceId, {
            node: binding.node,
            rect: measurement.rect,
            visible: measurement.visible,
            generatedZ: binding.generatedZ,
            payload,
          })
        : activeController.register({
            projectId,
            instanceId: binding.instanceId,
            node: binding.node,
            rect: measurement.rect,
            visible: measurement.visible,
            generatedZ: binding.generatedZ,
            payload,
          })
    } catch (error) {
      if (!isCurrentOperation()) return
      binding.pending = false
      binding.pendingToken = undefined
      binding.failed = true
      report(error)
      settleReadinessWaiters()
      return
    }
    void Promise.resolve(operation).then(
      applied => {
        if (!isCurrentOperation()) return
        binding.pending = false
        binding.pendingToken = undefined
        binding.registered ||= applied === true
        binding.failed = applied !== true
        schedule()
        settleReadinessWaiters()
      },
      error => {
        if (!isCurrentOperation()) return
        binding.pending = false
        binding.pendingToken = undefined
        binding.failed = true
        report(error)
        schedule()
        settleReadinessWaiters()
      },
    )
  }

  function flush() {
    frame = undefined
    if (!controller || !mount) return
    refreshSurfaceTopology()
    refreshGeneratedZ()
    const measurementContext = createMeasurementContext(mount, clipAncestors, getComputedStyle)
    for (const binding of bindings.values()) {
      applyBinding(binding, measureBinding(binding, measurementContext, getComputedStyle))
    }
    settleReadinessWaiters()
  }

  const attach = input => {
    const value = assertPlainObject(input, 'surface bridge attachment')
    if (controller) throw new Error('surface bridge already has a controller')
    if (typeof value.controller?.register !== 'function' || typeof value.controller?.update !== 'function') {
      throw new TypeError('surface bridge controller is invalid')
    }
    if (typeof value.mount?.getBoundingClientRect !== 'function') throw new TypeError('surface bridge mount is invalid')
    projectId = assertIdentifier(value.projectId, 'projectId')
    controller = value.controller
    mount = value.mount
    attachmentToken = Object.freeze({})
    for (const binding of bindings.values()) {
      binding.registered = false
      binding.pending = false
      binding.pendingToken = undefined
      binding.lastAttempt = undefined
      binding.failed = false
    }
    startInvalidationSources()
    schedule()
    settleReadinessWaiters()
    const attachedToken = attachmentToken
    return () => detach(value.controller, attachedToken)
  }

  const detach = (expectedController, expectedAttachmentToken) => {
    if (
      !controller ||
      (expectedController && controller !== expectedController) ||
      (expectedAttachmentToken && attachmentToken !== expectedAttachmentToken)
    ) {
      return false
    }
    const previous = controller
    const previousBindings = [...bindings.values()]
    attachmentToken = undefined
    controller = undefined
    projectId = undefined
    mount = undefined
    cancelScheduledFrame()
    stopInvalidationSources()
    for (const binding of previousBindings) {
      binding.registered = false
      binding.pending = false
      binding.pendingToken = undefined
      binding.lastAttempt = undefined
      binding.failed = false
    }
    for (const binding of previousBindings) safelyUnregister(previous, binding.instanceId)
    settleReadinessWaiters()
    return true
  }

  const connect = input => {
    const value = assertPlainObject(input, 'surface bridge binding')
    const instanceId = assertIdentifier(value.instanceId, 'instanceId')
    if (bindings.has(instanceId)) throw new Error(`surface bridge instance ${instanceId} is already connected`)
    if (value.node?.componentName !== 'GeneratedMaterialHost')
      throw new TypeError('binding node must be GeneratedMaterialHost')
    if (typeof value.element?.getBoundingClientRect !== 'function') throw new TypeError('binding element is invalid')
    const binding = {
      instanceId,
      node: value.node,
      context: resolveDashboardOnlineComponentContext(value.props ?? {}),
      element: value.element,
      connectionOrder: nextConnectionOrder++,
      generatedZ: 0,
      registered: false,
      pending: false,
      pendingToken: undefined,
      failed: false,
    }
    bindings.set(instanceId, binding)
    if (bindings.size === 1) startInvalidationSources()
    else resizeObserver?.observe(binding.element)
    schedule()
    settleReadinessWaiters()

    let active = true
    return Object.freeze({
      update: patch => {
        if (!active) return false
        const next = assertPlainObject(patch, 'surface bridge update')
        if (next.node?.componentName !== 'GeneratedMaterialHost') {
          throw new TypeError('binding node must be GeneratedMaterialHost')
        }
        if (typeof next.element?.getBoundingClientRect !== 'function') throw new TypeError('binding element is invalid')
        const previousElement = binding.element
        binding.node = next.node
        binding.context = resolveDashboardOnlineComponentContext(next.props ?? {})
        binding.element = next.element
        binding.failed = false
        if (resizeObserver && previousElement !== next.element) {
          if (!isObservedByAnotherBinding(previousElement, binding)) resizeObserver.unobserve(previousElement)
          resizeObserver.observe(next.element)
        }
        schedule()
        settleReadinessWaiters()
        return true
      },
      dispose: () => {
        if (!active) return false
        active = false
        const activeController = controller
        bindings.delete(instanceId)
        binding.registered = false
        binding.pending = false
        binding.pendingToken = undefined
        binding.lastAttempt = undefined
        binding.failed = false
        if (bindings.size === 0) {
          cancelScheduledFrame()
          stopInvalidationSources()
        } else if (resizeObserver && !isObservedByAnotherBinding(binding.element, binding)) {
          safely(() => resizeObserver.unobserve(binding.element))
        }
        safelyUnregister(activeController, instanceId)
        settleReadinessWaiters()
        return true
      },
    })
  }

  return Object.freeze({
    attach,
    detach,
    connect,
    matchesReadyCensus,
    whenReady,
    getDiagnostics: () =>
      Object.freeze({
        attached: controller !== undefined,
        instanceCount: bindings.size,
        scheduledFrameCount: frame === undefined ? 0 : 1,
        resizeObserverCount: resizeObserver ? 1 : 0,
        mutationObserverCount: mutationObserver ? 1 : 0,
        listenerCount,
        observedElementCount:
          resizeObserver === undefined
            ? 0
            : new Set([
                mount,
                ...[...bindings.values()].map(binding => binding.element),
                ...clipAncestors.map(clip => clip.element),
              ]).size,
      }),
  })
}

export const startDashboardOnlineComponentSurface = options => {
  const enabled = options?.enabled === true
  if (!enabled) {
    return Object.freeze({
      whenReady: rawInput => {
        normalizeSurfaceReadinessInput(rawInput)
        return Promise.resolve(false)
      },
      abortOwnedActivation: () => false,
      dispose: () => undefined,
      getDiagnostics: () => Object.freeze({ state: 'disabled', controllerCreated: false }),
    })
  }
  const mode = options.mode
  if (mode !== 'editor' && mode !== 'preview') throw new TypeError('surface mode must be editor or preview')
  if (options.bindTrustedShell !== undefined && typeof options.bindTrustedShell !== 'function') {
    throw new TypeError('bindTrustedShell must be a function')
  }
  if (mode === 'preview' && options.bindTrustedShell !== undefined) {
    throw new TypeError('preview surfaces cannot bind trusted drag shells')
  }
  const projectId = assertIdentifier(options.projectId, 'projectId')
  const branchId = assertIdentifier(options.branchId, 'branchId')
  const surfaceId = assertIdentifier(options.surfaceId, 'surfaceId')
  const bridge = options.bridge
  if (
    typeof bridge?.attach !== 'function' ||
    typeof bridge?.matchesReadyCensus !== 'function' ||
    typeof bridge?.whenReady !== 'function' ||
    typeof bridge?.getDiagnostics !== 'function'
  ) {
    throw new TypeError('surface bridge readiness contract is required')
  }
  if (typeof options.persistence?.readArtifact !== 'function') throw new TypeError('artifact persistence is required')
  const document = options.document
  if (typeof document?.querySelector !== 'function' || typeof document?.querySelectorAll !== 'function') {
    throw new TypeError('surface document is required')
  }
  const requestFrame = options.requestAnimationFrame ?? globalThis.requestAnimationFrame?.bind(globalThis)
  const cancelFrame = options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis)
  const MutationObserverClass = options.MutationObserver ?? globalThis.MutationObserver
  const createController = options.createController ?? createOnlineComponentSurfaceController
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new TypeError('surface discovery animation frame functions are required')
  }

  const selector = `[data-easy-editor-surface-overlay-mount="${mode}"]`
  let state = 'discovering'
  let controller
  let releaseBridge
  let currentMount
  let observer
  let frame
  const readinessEpochWaiters = new Set()
  const domCensusWaiters = new Set()
  let activationEpoch = 0
  let disposed = false

  const readDomCensus = () => {
    const instanceIds = [...document.querySelectorAll('[data-easy-editor-generated-material-host]')].map(
      (element, index) => {
        const instanceId = element.getAttribute?.('data-easy-editor-generated-material-host')
        return assertIdentifier(instanceId, `generated material host census[${index}]`)
      },
    )
    if (new Set(instanceIds).size !== instanceIds.length) {
      throw new Error('generated material host census contains duplicate instance ids')
    }
    return instanceIds.sort()
  }

  const domCensusMatches = expectedInstanceIds => sameInstanceIds(readDomCensus(), expectedInstanceIds)

  const settleDomCensusWaiters = forcedValue => {
    for (const waiter of [...domCensusWaiters]) {
      const status = forcedValue ?? (domCensusMatches(waiter.expectedInstanceIds) ? true : undefined)
      if (status === undefined) continue
      domCensusWaiters.delete(waiter)
      waiter.resolve(status)
    }
  }

  const whenDomCensusMatches = expectedInstanceIds => {
    if (disposed) return Promise.resolve(false)
    if (domCensusMatches(expectedInstanceIds)) return Promise.resolve(true)
    const waiter = { expectedInstanceIds, resolve: undefined }
    return new Promise(resolve => {
      waiter.resolve = resolve
      domCensusWaiters.add(waiter)
    })
  }

  const advanceActivationEpoch = () => {
    activationEpoch += 1
    for (const resolve of readinessEpochWaiters) resolve()
    readinessEpochWaiters.clear()
    settleDomCensusWaiters(false)
  }

  const raceActivationEpoch = async (promise, expectedEpoch) => {
    let resolveEpochChange
    const epochChanged = new Promise(resolve => {
      resolveEpochChange = resolve
      readinessEpochWaiters.add(resolve)
    })
    let result
    try {
      result = await Promise.race([
        promise.then(value => ({ status: 'settled', value })),
        epochChanged.then(() => ({ status: 'epoch-changed' })),
      ])
    } finally {
      readinessEpochWaiters.delete(resolveEpochChange)
    }
    return activationEpoch === expectedEpoch ? result : { status: 'epoch-changed' }
  }

  const stopDiscovery = () => {
    observer?.disconnect()
    observer = undefined
    if (frame !== undefined) cancelFrame(frame)
    frame = undefined
  }

  const scheduleDiscovery = () => {
    if (frame !== undefined || disposed) return
    frame = requestFrame(() => {
      frame = undefined
      discover()
    })
  }

  const releaseCurrentSurface = abortOwned => {
    advanceActivationEpoch()
    const previousRelease = releaseBridge
    const previousController = controller
    releaseBridge = undefined
    controller = undefined
    currentMount = undefined
    try {
      if (abortOwned) previousController?.abortOwnedActivation()
      previousRelease?.()
    } finally {
      previousController?.dispose()
    }
  }

  const activate = mount => {
    const nextController = createController({
      projectId,
      branchId,
      surfaceId,
      featureEnabled: true,
      safeBoot: options.safeBoot === true,
      markerStore: options.markerStore,
      readArtifact: artifactRef =>
        options.persistence.readArtifact({
          schemaVersion: 1,
          projectId,
          artifactId: artifactRef.artifactId,
          sourceRevision: artifactRef.sourceRevision,
        }),
      surfaceHostOptions: {
        mode,
        mount,
        ...(options.telemetry ? { telemetry: options.telemetry } : {}),
        ...(options.onSelection ? { onSelection: options.onSelection } : {}),
        ...(options.onRuntimeEvent ? { onRuntimeEvent: options.onRuntimeEvent } : {}),
        ...(options.bindTrustedShell ? { bindTrustedShell: options.bindTrustedShell } : {}),
      },
    })
    if (
      typeof nextController?.whenReady !== 'function' ||
      typeof nextController?.matchesReadyCensus !== 'function' ||
      typeof nextController?.abortOwnedActivation !== 'function' ||
      typeof nextController?.getDiagnostics !== 'function'
    ) {
      nextController?.dispose?.()
      throw new TypeError('surface controller readiness contract is required')
    }
    let nextRelease
    try {
      nextRelease = bridge.attach({ controller: nextController, projectId, mount })
    } catch (error) {
      nextController.dispose()
      throw error
    }
    controller = nextController
    releaseBridge = nextRelease
    currentMount = mount
    state = options.safeBoot === true ? 'safe-boot' : 'active'
    advanceActivationEpoch()
  }

  const discover = () => {
    if (disposed) return
    const nextMount = document.querySelector(selector)
    if (nextMount === currentMount) return
    if (currentMount || controller || releaseBridge) releaseCurrentSurface(true)
    state = 'discovering'
    if (nextMount) activate(nextMount)
  }

  if (typeof MutationObserverClass === 'function') {
    observer = new MutationObserverClass(() => {
      scheduleDiscovery()
      settleDomCensusWaiters()
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }
  discover()

  return Object.freeze({
    whenReady: async rawInput => {
      const { expectedInstanceIds } = normalizeSurfaceReadinessInput(rawInput)
      while (true) {
        discover()
        const expectedEpoch = activationEpoch
        const activeController = controller
        const activeMount = currentMount
        if (disposed || activationEpoch !== expectedEpoch || !activeController || !activeMount) return false
        const controllerState = activeController.getDiagnostics().state
        const bridgeReadinessInput = {
          expectedInstanceIds,
          requireRegistered: controllerState !== 'safe-boot',
        }
        const readiness = await raceActivationEpoch(
          Promise.all([
            whenDomCensusMatches(expectedInstanceIds),
            bridge.whenReady(bridgeReadinessInput),
            activeController.whenReady({ expectedInstanceIds }),
          ]).then(results => results.every(result => result === true)),
          expectedEpoch,
        )
        if (readiness.status === 'epoch-changed') {
          if (disposed) return false
          continue
        }
        const ready = readiness.value
        if (
          disposed ||
          activationEpoch !== expectedEpoch ||
          controller !== activeController ||
          currentMount !== activeMount
        ) {
          return false
        }
        if (ready !== true) return false
        const controllerDiagnostics = activeController.getDiagnostics()
        if (!domCensusMatches(expectedInstanceIds)) continue
        if (!bridge.matchesReadyCensus(bridgeReadinessInput)) continue
        if (
          controllerDiagnostics.state !== 'safe-boot' &&
          !activeController.matchesReadyCensus({ expectedInstanceIds })
        ) {
          continue
        }
        return true
      }
    },
    abortOwnedActivation: () => controller?.abortOwnedActivation?.() ?? false,
    dispose: () => {
      if (disposed) return
      disposed = true
      stopDiscovery()
      releaseCurrentSurface(false)
      state = 'disposed'
    },
    getDiagnostics: () => Object.freeze({ state, controllerCreated: controller !== undefined }),
  })
}
