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

const createMeasurementContext = mount => {
  const mountRect = mount.getBoundingClientRect()
  const scaleX = mount.clientWidth > 0 && mountRect.width > 0 ? mountRect.width / mount.clientWidth : 1
  const scaleY = mount.clientHeight > 0 && mountRect.height > 0 ? mountRect.height / mount.clientHeight : 1
  return { mountRect, scaleX, scaleY }
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
      binding.element.isConnected !== false &&
      style?.display !== 'none' &&
      style?.visibility !== 'hidden' &&
      elementRect.width > 0 &&
      elementRect.height > 0,
  })
}

export const createDashboardOnlineComponentSurfaceBridge = (options = {}) => {
  const requestFrame = options.requestAnimationFrame ?? globalThis.requestAnimationFrame?.bind(globalThis)
  const cancelFrame = options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis)
  const getComputedStyle = options.getComputedStyle ?? globalThis.getComputedStyle?.bind(globalThis)
  const onError = options.onError ?? (() => undefined)
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new TypeError('surface bridge animation frame functions are required')
  }
  if (typeof onError !== 'function') throw new TypeError('surface bridge onError must be a function')

  const bindings = new Map()
  let controller
  let projectId
  let mount
  let frame
  let nextGeneratedZ = 0

  const report = error => {
    try {
      onError(error)
    } catch {
      // Diagnostics cannot change runtime ownership.
    }
  }

  const schedule = () => {
    if (frame !== undefined || !controller || !mount || bindings.size === 0) return
    frame = requestFrame(flush)
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
    binding.pending = true
    const pendingToken = Object.freeze({})
    binding.pendingToken = pendingToken
    const activeController = controller
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
      binding.pending = false
      binding.pendingToken = undefined
      report(error)
      return
    }
    void Promise.resolve(operation).then(
      applied => {
        if (binding.pendingToken === pendingToken) {
          binding.pending = false
          binding.pendingToken = undefined
        }
        if (controller !== activeController || bindings.get(binding.instanceId) !== binding) {
          if (applied) activeController.unregister(binding.instanceId)
          return
        }
        binding.registered ||= applied === true
        schedule()
      },
      error => {
        if (binding.pendingToken === pendingToken) {
          binding.pending = false
          binding.pendingToken = undefined
        }
        report(error)
        schedule()
      },
    )
  }

  function flush() {
    frame = undefined
    if (!controller || !mount) return
    const measurementContext = createMeasurementContext(mount)
    for (const binding of bindings.values()) {
      applyBinding(binding, measureBinding(binding, measurementContext, getComputedStyle))
    }
    schedule()
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
    for (const binding of bindings.values()) {
      binding.registered = false
      binding.pending = false
      binding.pendingToken = undefined
      binding.lastAttempt = undefined
    }
    schedule()
    return () => detach(value.controller)
  }

  const detach = expectedController => {
    if (!controller || (expectedController && controller !== expectedController)) return false
    if (frame !== undefined) cancelFrame(frame)
    frame = undefined
    const previous = controller
    controller = undefined
    projectId = undefined
    mount = undefined
    for (const binding of bindings.values()) {
      previous.unregister(binding.instanceId)
      binding.registered = false
      binding.pending = false
      binding.pendingToken = undefined
      binding.lastAttempt = undefined
    }
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
      generatedZ: nextGeneratedZ++,
      registered: false,
      pending: false,
      pendingToken: undefined,
    }
    bindings.set(instanceId, binding)
    schedule()

    let active = true
    return Object.freeze({
      update: patch => {
        if (!active) return false
        const next = assertPlainObject(patch, 'surface bridge update')
        if (next.node?.componentName !== 'GeneratedMaterialHost') {
          throw new TypeError('binding node must be GeneratedMaterialHost')
        }
        if (typeof next.element?.getBoundingClientRect !== 'function') throw new TypeError('binding element is invalid')
        binding.node = next.node
        binding.context = resolveDashboardOnlineComponentContext(next.props ?? {})
        binding.element = next.element
        schedule()
        return true
      },
      dispose: () => {
        if (!active) return false
        active = false
        bindings.delete(instanceId)
        controller?.unregister(instanceId)
        if (bindings.size === 0 && frame !== undefined) {
          cancelFrame(frame)
          frame = undefined
        }
        return true
      },
    })
  }

  return Object.freeze({
    attach,
    detach,
    connect,
    getDiagnostics: () =>
      Object.freeze({
        attached: controller !== undefined,
        instanceCount: bindings.size,
        scheduledFrameCount: frame === undefined ? 0 : 1,
      }),
  })
}

export const startDashboardOnlineComponentSurface = options => {
  const enabled = options?.enabled === true
  if (!enabled) {
    return Object.freeze({
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
  if (typeof bridge?.attach !== 'function') throw new TypeError('surface bridge is required')
  if (typeof options.persistence?.readArtifact !== 'function') throw new TypeError('artifact persistence is required')
  const document = options.document
  if (typeof document?.querySelector !== 'function') throw new TypeError('surface document is required')
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
  let observer
  let frame
  let disposed = false

  const stopDiscovery = () => {
    observer?.disconnect()
    observer = undefined
    if (frame !== undefined) cancelFrame(frame)
    frame = undefined
  }

  const scheduleDiscovery = () => {
    if (frame !== undefined || disposed || controller) return
    frame = requestFrame(() => {
      frame = undefined
      discover()
    })
  }

  const discover = () => {
    if (disposed || controller) return
    const mount = document.querySelector(selector)
    if (mount) {
      stopDiscovery()
      controller = createController({
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
          ...(options.onSelection ? { onSelection: options.onSelection } : {}),
          ...(options.onRuntimeEvent ? { onRuntimeEvent: options.onRuntimeEvent } : {}),
          ...(options.bindTrustedShell ? { bindTrustedShell: options.bindTrustedShell } : {}),
        },
      })
      releaseBridge = bridge.attach({ controller, projectId, mount })
      state = options.safeBoot === true ? 'safe-boot' : 'active'
      return
    }
    scheduleDiscovery()
  }

  if (typeof MutationObserverClass === 'function') {
    observer = new MutationObserverClass(discover)
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }
  discover()

  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      stopDiscovery()
      releaseBridge?.()
      releaseBridge = undefined
      controller?.dispose()
      controller = undefined
      state = 'disposed'
    },
    getDiagnostics: () => Object.freeze({ state, controllerCreated: controller !== undefined }),
  })
}
