import { ONLINE_COMPONENT_PROTOCOL_VERSION, createConnectMessage } from './surface-protocol.mjs'

const scriptLiteral = value => JSON.stringify(value).replaceAll('<', '\\u003c')

export const createOnlineComponentSandboxCsp = nonce =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' blob:`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    'img-src data: blob:',
    "media-src 'none'",
    "font-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

export const createOnlineComponentSandboxDocument = identity => {
  const connect = createConnectMessage(identity)
  const csp = createOnlineComponentSandboxCsp(connect.nonce)
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <style nonce="${connect.nonce}">
      html, body, #online-component-root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
      #online-component-root { position: relative; pointer-events: none; contain: strict; }
      .online-component-instance { position: absolute; box-sizing: border-box; overflow: hidden; pointer-events: none; contain: layout paint style; }
    </style>
  </head>
  <body>
    <div id="online-component-root"></div>
    <script nonce="${connect.nonce}">
      (() => {
        'use strict'
        const protocolVersion = ${ONLINE_COMPONENT_PROTOCOL_VERSION}
        const expectedNonce = ${scriptLiteral(connect.nonce)}
        const expectedSurfaceId = ${scriptLiteral(connect.surfaceId)}
        const expectedGeneration = ${connect.generation}
        const maxMessageBytes = 262144
        const root = document.getElementById('online-component-root')
        const instances = new Map()
        const moduleCache = new Map()
        const liveObjectUrls = new Set()
        const generatedObjectUrls = new Map()
        const generatedTimerTasks = new Map()
        const generatedAnimationFrameTasks = new Map()
        const generatedListeners = new Set()
        const TrustedBlob = Blob
        const TrustedError = Error
        const applyFunction = Reflect.apply
        const ownKeys = Reflect.ownKeys
        const getPrototypeOf = Object.getPrototypeOf
        const createObjectURL = URL.createObjectURL.bind(URL)
        const revokeObjectURL = URL.revokeObjectURL.bind(URL)
        const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
        const defineProperty = Object.defineProperty
        const isExtensible = Object.isExtensible
        const sameValue = Object.is
        const mapGet = Map.prototype.get
        const mapSet = Map.prototype.set
        const mapDelete = Map.prototype.delete
        const mapForEach = Map.prototype.forEach
        const mapSize = getOwnPropertyDescriptor(Map.prototype, 'size').get
        const setAdd = Set.prototype.add
        const setDelete = Set.prototype.delete
        const setForEach = Set.prototype.forEach
        const setSize = getOwnPropertyDescriptor(Set.prototype, 'size').get
        const nativeAddEventListener = EventTarget.prototype.addEventListener
        const nativeRemoveEventListener = EventTarget.prototype.removeEventListener
        const nativeSetTimeout = globalThis.setTimeout
        const nativeClearTimeout = globalThis.clearTimeout
        const nativeSetInterval = globalThis.setInterval
        const nativeClearInterval = globalThis.clearInterval
        const nativeRequestAnimationFrame = globalThis.requestAnimationFrame
        const nativeCancelAnimationFrame = globalThis.cancelAnimationFrame
        const nativeQueueMicrotask = globalThis.queueMicrotask
        const stringStartsWith = String.prototype.startsWith
        const resolvePromise = Promise.resolve.bind(Promise)
        const monotonicNow = performance.now.bind(performance)
        const lifecycleBudgetMs = 50
        const maxEmittedEventsPerFrame = 1024
        let nextInstanceStyleId = 1
        let port
        let sendToHost
        let processing = Promise.resolve()
        let pendingBatchCount = 0
        let pendingMicrotaskCount = 0
        let listenerCount = 1
        let activeInstanceId = null
        let faulted = false
        let componentResourcesFaulted = false
        let emittedEventCount = 0
        let eventBudgetEpochHandle
        let eventBudgetEpochCancel
        let eventBudgetEpochGeneration = 0

        const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
        const hasExactKeys = (value, keys) => {
          if (!isRecord(value)) return false
          const actual = Object.keys(value).sort()
          const expected = [...keys].sort()
          return actual.length === expected.length && actual.every((key, index) => key === expected[index])
        }
        const hasIdentity = value =>
          value.protocolVersion === protocolVersion &&
          value.nonce === expectedNonce &&
          value.surfaceId === expectedSurfaceId &&
          value.generation === expectedGeneration
        const withinBudget = value => {
          try {
            return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxMessageBytes
          } catch {
            return false
          }
        }
        const readMapSize = value => applyFunction(mapSize, value, [])
        const readSetSize = value => applyFunction(setSize, value, [])
        const resourceSnapshot = () => ({
          instanceCount: readMapSize(instances),
          listenerCount: listenerCount + readSetSize(generatedListeners),
          pendingTaskCount:
            pendingBatchCount +
            pendingMicrotaskCount +
            readMapSize(generatedTimerTasks) +
            readMapSize(generatedAnimationFrameTasks),
          objectUrlCount: readSetSize(liveObjectUrls) + readMapSize(generatedObjectUrls),
        })
        const isIdentifier = value =>
          typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(value)
        const isDependencySpecifier = value =>
          typeof value === 'string' && /^(?:@[A-Za-z0-9._-]+\\/)?[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(value)
        const isEventType = value =>
          typeof value === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(value)
        const isRect = value =>
          hasExactKeys(value, ['x', 'y', 'width', 'height']) &&
          [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
          value.width >= 0 &&
          value.height >= 0
        const isUpdate = value =>
          hasExactKeys(value, ['instanceId', 'revisionKey', 'rect', 'visible', 'generatedZ', 'payload']) &&
          isIdentifier(value.instanceId) &&
          isIdentifier(value.revisionKey) &&
          isRect(value.rect) &&
          typeof value.visible === 'boolean' &&
          Number.isSafeInteger(value.generatedZ) &&
          isRecord(value.payload)
        const isBatch = value =>
          hasExactKeys(value, [
            'kind',
            'protocolVersion',
            'nonce',
            'surfaceId',
            'generation',
            'sequence',
            'updates',
            'removals',
          ]) &&
          value.kind === 'online-component.render-batch' &&
          hasIdentity(value) &&
          Number.isSafeInteger(value.sequence) &&
          value.sequence > 0 &&
          Array.isArray(value.updates) &&
          value.updates.length <= 256 &&
          value.updates.every(isUpdate) &&
          Array.isArray(value.removals) &&
          value.removals.length <= 256 &&
          value.removals.every(isIdentifier) &&
          withinBudget(value)

        const setLayout = (instance, update) => {
          const rect = update.rect
          instance.layoutStyle.textContent =
            '#' + instance.domId + '{' +
            'left:' + rect.x + 'px;' +
            'top:' + rect.y + 'px;' +
            'width:' + rect.width + 'px;' +
            'height:' + rect.height + 'px;' +
            'display:' + (update.visible ? 'block' : 'none') + ';' +
            'z-index:' + update.generatedZ + ';' +
            '}'
        }

        const assertSynchronousLifecycleResult = (method, result) => {
          const isThenable =
            result !== null &&
            (typeof result === 'object' || typeof result === 'function') &&
            typeof result.then === 'function'
          if (!isThenable) return
          resolvePromise(result).catch(() => undefined)
          throw new TrustedError('async-lifecycle-not-supported:' + method)
        }
        const invokeLifecycle = (method, instanceId, callback) => {
          const startedAt = monotonicNow()
          const previousInstanceId = activeInstanceId
          activeInstanceId = instanceId
          try {
            const result = callback()
            assertSynchronousLifecycleResult(method, result)
            if (monotonicNow() - startedAt > lifecycleBudgetMs) {
              throw new TrustedError('lifecycle-budget-exceeded:' + method)
            }
          } finally {
            activeInstanceId = previousInstanceId
          }
        }

        const replaceDataProperty = (target, key, value) => {
          const descriptor = getOwnPropertyDescriptor(target, key)
          if (!descriptor || !('value' in descriptor)) return false
          defineProperty(target, key, {
            value,
            writable: descriptor.writable,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          })
          return true
        }
        const listenerOptions = options => ({
          capture: options === true || (options !== null && typeof options === 'object' && options.capture === true),
          once: options !== null && typeof options === 'object' && options.once === true,
          signal: options !== null && typeof options === 'object' ? options.signal : undefined,
        })
        const findGeneratedListener = (target, type, listener, capture) => {
          let found
          applyFunction(setForEach, generatedListeners, [record => {
            if (
              !found &&
              sameValue(record.target, target) &&
              record.type === type &&
              sameValue(record.listener, listener) &&
              record.capture === capture
            ) {
              found = record
            }
          }])
          return found
        }
        const deleteGeneratedListener = (record, removeNative) => {
          if (!record || !applyFunction(setDelete, generatedListeners, [record])) return false
          if (removeNative) {
            applyFunction(nativeRemoveEventListener, record.target, [record.type, record.wrapped, record.capture])
          }
          if (record.signal && record.abortHandler) {
            applyFunction(nativeRemoveEventListener, record.signal, ['abort', record.abortHandler, false])
          }
          return true
        }
        const runOwnedCallback = (instanceId, callback, receiver, args) => {
          if (faulted || componentResourcesFaulted) return
          const previousInstanceId = activeInstanceId
          activeInstanceId = instanceId
          try {
            applyFunction(callback, receiver, args)
            assertRealmClean()
            assertNoOwnedObjectUrls(instanceId)
          } catch (error) {
            postFault(error, instanceId)
          } finally {
            activeInstanceId = previousInstanceId
          }
        }
        const addGeneratedEventListener = function (type, listener, options) {
          if (typeof type !== 'string') throw new TypeError('generated listener type must be a string')
          if (listener === null || listener === undefined) return
          if (typeof listener !== 'function' && typeof listener !== 'object') {
            throw new TypeError('generated listener must be callable or an event listener object')
          }
          const normalized = listenerOptions(options)
          if (findGeneratedListener(this, type, listener, normalized.capture)) return
          const instanceId = activeInstanceId
          let record
          const wrapped = function (...args) {
            if (record.once) deleteGeneratedListener(record, false)
            const receiver = this
            runOwnedCallback(instanceId, () => {
              if (typeof listener === 'function') {
                applyFunction(listener, receiver, args)
                return
              }
              const handleEvent = listener.handleEvent
              if (typeof handleEvent === 'function') applyFunction(handleEvent, listener, args)
            }, undefined, [])
          }
          record = {
            target: this,
            type,
            listener,
            wrapped,
            capture: normalized.capture,
            once: normalized.once,
            signal: normalized.signal,
            abortHandler: undefined,
            instanceId,
          }
          applyFunction(nativeAddEventListener, this, [type, wrapped, options])
          if (normalized.signal?.aborted === true) return
          applyFunction(setAdd, generatedListeners, [record])
          if (normalized.signal instanceof EventTarget) {
            record.abortHandler = () => deleteGeneratedListener(record, false)
            applyFunction(nativeAddEventListener, normalized.signal, ['abort', record.abortHandler, { once: true }])
          }
        }
        const removeGeneratedEventListener = function (type, listener, options) {
          if (typeof type !== 'string') throw new TypeError('generated listener type must be a string')
          const normalized = listenerOptions(options)
          const record = findGeneratedListener(this, type, listener, normalized.capture)
          if (record) {
            deleteGeneratedListener(record, true)
            return
          }
          applyFunction(nativeRemoveEventListener, this, [type, listener, options])
        }
        replaceDataProperty(EventTarget.prototype, 'addEventListener', addGeneratedEventListener)
        replaceDataProperty(EventTarget.prototype, 'removeEventListener', removeGeneratedEventListener)

        const trackGeneratedTask = (ledger, handle, record) => {
          applyFunction(mapSet, ledger, [handle, record])
          return handle
        }
        const deleteGeneratedTask = (ledger, handle) => applyFunction(mapDelete, ledger, [handle])
        const scheduleGeneratedTask = (ledger, kind, schedule, cancel, callback, delay, args, repeating) => {
          if (typeof callback !== 'function') throw new TypeError('generated timer callback must be a function')
          const instanceId = activeInstanceId
          let handle
          const wrapped = (...callbackArgs) => {
            if (!repeating) deleteGeneratedTask(ledger, handle)
            runOwnedCallback(instanceId, callback, undefined, callbackArgs)
          }
          const scheduleArgs = [wrapped, delay]
          for (let index = 0; index < args.length; index += 1) scheduleArgs[index + 2] = args[index]
          handle = applyFunction(schedule, globalThis, scheduleArgs)
          return trackGeneratedTask(ledger, handle, { kind, cancel, instanceId })
        }
        const clearGeneratedTask = (ledger, handle, cancel, acceptedKinds) => {
          applyFunction(cancel, globalThis, [handle])
          const record = applyFunction(mapGet, ledger, [handle])
          let accepted = false
          for (let index = 0; index < acceptedKinds.length; index += 1) {
            if (acceptedKinds[index] === record?.kind) accepted = true
          }
          if (record && accepted) deleteGeneratedTask(ledger, handle)
        }
        const generatedSetTimeout = (callback, delay, ...args) =>
          scheduleGeneratedTask(
            generatedTimerTasks,
            'timeout',
            nativeSetTimeout,
            nativeClearTimeout,
            callback,
            delay,
            args,
            false,
          )
        const generatedSetInterval = (callback, delay, ...args) =>
          scheduleGeneratedTask(
            generatedTimerTasks,
            'interval',
            nativeSetInterval,
            nativeClearInterval,
            callback,
            delay,
            args,
            true,
          )
        const generatedClearTimeout = handle =>
          clearGeneratedTask(generatedTimerTasks, handle, nativeClearTimeout, ['timeout', 'interval'])
        const generatedClearInterval = handle =>
          clearGeneratedTask(generatedTimerTasks, handle, nativeClearInterval, ['timeout', 'interval'])
        replaceDataProperty(globalThis, 'setTimeout', generatedSetTimeout)
        replaceDataProperty(globalThis, 'clearTimeout', generatedClearTimeout)
        replaceDataProperty(globalThis, 'setInterval', generatedSetInterval)
        replaceDataProperty(globalThis, 'clearInterval', generatedClearInterval)
        if (typeof nativeRequestAnimationFrame === 'function' && typeof nativeCancelAnimationFrame === 'function') {
          const generatedRequestAnimationFrame = callback =>
            scheduleGeneratedTask(
              generatedAnimationFrameTasks,
              'animation-frame',
              nativeRequestAnimationFrame,
              nativeCancelAnimationFrame,
              callback,
              undefined,
              [],
              false,
            )
          const generatedCancelAnimationFrame = handle =>
            clearGeneratedTask(
              generatedAnimationFrameTasks,
              handle,
              nativeCancelAnimationFrame,
              ['animation-frame'],
            )
          replaceDataProperty(globalThis, 'requestAnimationFrame', generatedRequestAnimationFrame)
          replaceDataProperty(globalThis, 'cancelAnimationFrame', generatedCancelAnimationFrame)
        }
        if (typeof nativeQueueMicrotask === 'function') {
          const generatedQueueMicrotask = callback => {
            if (typeof callback !== 'function') throw new TypeError('generated microtask callback must be a function')
            const instanceId = activeInstanceId
            pendingMicrotaskCount += 1
            applyFunction(nativeQueueMicrotask, globalThis, [() => {
              pendingMicrotaskCount -= 1
              runOwnedCallback(instanceId, callback, undefined, [])
            }])
          }
          replaceDataProperty(globalThis, 'queueMicrotask', generatedQueueMicrotask)
        }

        const createGeneratedObjectURL = value => {
          const url = createObjectURL(value)
          applyFunction(mapSet, generatedObjectUrls, [url, activeInstanceId])
          return url
        }
        const revokeGeneratedObjectURL = url => {
          revokeObjectURL(url)
          applyFunction(mapDelete, generatedObjectUrls, [url])
        }
        replaceDataProperty(URL, 'createObjectURL', createGeneratedObjectURL)
        replaceDataProperty(URL, 'revokeObjectURL', revokeGeneratedObjectURL)

        const countOwnedResources = instanceId => {
          const counts = { listenerCount: 0, taskCount: 0, objectUrlCount: 0 }
          applyFunction(setForEach, generatedListeners, [record => {
            if (sameValue(record.instanceId, instanceId)) counts.listenerCount += 1
          }])
          applyFunction(mapForEach, generatedTimerTasks, [record => {
            if (sameValue(record.instanceId, instanceId)) counts.taskCount += 1
          }])
          applyFunction(mapForEach, generatedAnimationFrameTasks, [record => {
            if (sameValue(record.instanceId, instanceId)) counts.taskCount += 1
          }])
          applyFunction(mapForEach, generatedObjectUrls, [owner => {
            if (sameValue(owner, instanceId)) counts.objectUrlCount += 1
          }])
          return counts
        }
        const cleanupOwnedResources = instanceId => {
          applyFunction(setForEach, generatedListeners, [record => {
            if (sameValue(record.instanceId, instanceId)) deleteGeneratedListener(record, true)
          }])
          applyFunction(mapForEach, generatedTimerTasks, [(record, handle) => {
            if (!sameValue(record.instanceId, instanceId)) return
            applyFunction(record.cancel, globalThis, [handle])
            deleteGeneratedTask(generatedTimerTasks, handle)
          }])
          applyFunction(mapForEach, generatedAnimationFrameTasks, [(record, handle) => {
            if (!sameValue(record.instanceId, instanceId)) return
            applyFunction(record.cancel, globalThis, [handle])
            deleteGeneratedTask(generatedAnimationFrameTasks, handle)
          }])
          applyFunction(mapForEach, generatedObjectUrls, [(owner, url) => {
            if (!sameValue(owner, instanceId)) return
            revokeObjectURL(url)
            applyFunction(mapDelete, generatedObjectUrls, [url])
          }])
        }
        const componentResourceSnapshot = () => ({
          instanceCount: readMapSize(instances),
          listenerCount: listenerCount + readSetSize(generatedListeners),
          pendingTaskCount:
            pendingMicrotaskCount +
            readMapSize(generatedTimerTasks) +
            readMapSize(generatedAnimationFrameTasks),
          objectUrlCount: readMapSize(generatedObjectUrls),
        })
        const resourceLeak = instanceId => {
          const error = new TrustedError('resource-leak')
          defineProperty(error, 'resourceSnapshot', {
            value: componentResourceSnapshot(),
            writable: true,
            enumerable: true,
            configurable: true,
          })
          componentResourcesFaulted = true
          cleanupOwnedResources(instanceId)
          return error
        }
        const assertNoUnownedResources = () => {
          const counts = countOwnedResources(null)
          if (counts.listenerCount > 0 || counts.taskCount > 0 || counts.objectUrlCount > 0) {
            throw resourceLeak(null)
          }
        }
        const assertNoOwnedObjectUrls = instanceId => {
          if (countOwnedResources(instanceId).objectUrlCount > 0) throw resourceLeak(instanceId)
        }
        const assertOwnedResourcesReleased = instanceId => {
          const counts = countOwnedResources(instanceId)
          if (counts.listenerCount > 0 || counts.taskCount > 0 || counts.objectUrlCount > 0) {
            throw resourceLeak(instanceId)
          }
        }

        const appendArray = (array, value) => {
          defineProperty(array, String(array.length), {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          })
        }
        const maxRealmDepth = 3
        const maxRealmObjects = 4096
        const maxRealmDescriptors = 65536
        const discoverGuardedObjects = () => {
          const discovered = []
          const queue = []
          const seen = new WeakSet()
          let cursor = 0
          let descriptorCount = 0
          appendArray(queue, [globalThis, 0, 'namespace'])
          while (cursor < queue.length) {
            const entry = queue[cursor]
            cursor += 1
            const object = entry[0]
            const depth = entry[1]
            const traversal = entry[2]
            if ((object === null || (typeof object !== 'object' && typeof object !== 'function')) || seen.has(object)) {
              continue
            }
            if (discovered.length >= maxRealmObjects) throw new TrustedError('realm-discovery-object-limit')
            seen.add(object)
            appendArray(discovered, object)
            const keys = ownKeys(object)
            descriptorCount += keys.length
            if (descriptorCount > maxRealmDescriptors) throw new TrustedError('realm-discovery-descriptor-limit')
            if (depth >= maxRealmDepth) continue
            appendArray(queue, [getPrototypeOf(object), depth + 1, 'prototype'])
            if (traversal !== 'namespace' && traversal !== 'constructor') continue
            for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
              const key = keys[keyIndex]
              const descriptor = getOwnPropertyDescriptor(object, key)
              if (!descriptor) continue
              const candidate = descriptor.value
              const candidatePrototype =
                candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function')
                  ? getPrototypeOf(candidate)
                  : undefined
              if (
                traversal === 'constructor' &&
                key === 'prototype' &&
                candidate !== null &&
                (typeof candidate === 'object' || typeof candidate === 'function')
              ) {
                appendArray(queue, [candidate, depth + 1, 'prototype'])
              } else if (typeof candidate === 'function' && getOwnPropertyDescriptor(candidate, 'prototype')) {
                appendArray(queue, [candidate, depth + 1, 'constructor'])
              } else if (
                candidate !== null &&
                typeof candidate === 'object' &&
                (candidatePrototype === Object.prototype || candidatePrototype === null)
              ) {
                appendArray(queue, [candidate, depth + 1, 'namespace'])
              }
            }
          }
          return discovered
        }
        const guardedObjects = discoverGuardedObjects()
        const readDescriptorField = (descriptor, key) => {
          if (!descriptor) return undefined
          const fieldDescriptor = getOwnPropertyDescriptor(descriptor, key)
          return fieldDescriptor?.value
        }
        const captureRealm = () => {
          const snapshot = []
          for (let objectIndex = 0; objectIndex < guardedObjects.length; objectIndex += 1) {
            const object = guardedObjects[objectIndex]
            const keys = ownKeys(object)
            const properties = []
            for (let propertyIndex = 0; propertyIndex < keys.length; propertyIndex += 1) {
              const key = keys[propertyIndex]
              const descriptor = getOwnPropertyDescriptor(object, key)
              appendArray(properties, [
                key,
                readDescriptorField(descriptor, 'value'),
                readDescriptorField(descriptor, 'get'),
                readDescriptorField(descriptor, 'set'),
                readDescriptorField(descriptor, 'writable'),
                readDescriptorField(descriptor, 'enumerable'),
                readDescriptorField(descriptor, 'configurable'),
              ])
            }
            appendArray(snapshot, [getPrototypeOf(object), isExtensible(object), properties])
          }
          return snapshot
        }
        const cleanRealm = captureRealm()
        const assertRealmClean = () => {
          for (let objectIndex = 0; objectIndex < guardedObjects.length; objectIndex += 1) {
            const object = guardedObjects[objectIndex]
            const beforeObject = cleanRealm[objectIndex]
            if (!sameValue(beforeObject[0], getPrototypeOf(object)) || beforeObject[1] !== isExtensible(object)) {
              throw new TrustedError('global-pollution')
            }
            const keys = ownKeys(object)
            const leftProperties = beforeObject[2]
            if (leftProperties.length !== keys.length) throw new TrustedError('global-pollution')
            for (let propertyIndex = 0; propertyIndex < leftProperties.length; propertyIndex += 1) {
              const before = leftProperties[propertyIndex]
              const key = keys[propertyIndex]
              const descriptor = getOwnPropertyDescriptor(object, key)
              if (
                !descriptor ||
                !sameValue(before[0], key) ||
                !sameValue(before[1], readDescriptorField(descriptor, 'value')) ||
                !sameValue(before[2], readDescriptorField(descriptor, 'get')) ||
                !sameValue(before[3], readDescriptorField(descriptor, 'set')) ||
                before[4] !== readDescriptorField(descriptor, 'writable') ||
                before[5] !== readDescriptorField(descriptor, 'enumerable') ||
                before[6] !== readDescriptorField(descriptor, 'configurable')
              ) {
                throw new TrustedError('global-pollution')
              }
            }
          }
        }

        const readOwnDataProperty = (value, key) => {
          if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
          try {
            return readDescriptorField(getOwnPropertyDescriptor(value, key), 'value')
          } catch {
            return undefined
          }
        }
        const hasStringPrefix = (value, prefix) =>
          typeof value === 'string' && applyFunction(stringStartsWith, value, [prefix])
        const preferRealmFault = error => {
          try {
            assertRealmClean()
            return error
          } catch (realmError) {
            return realmError
          }
        }
        const lifecycleFaultCode = error => {
          const message = readOwnDataProperty(error, 'message')
          return hasStringPrefix(message, 'async-lifecycle-not-supported:')
            ? 'async-lifecycle'
            : hasStringPrefix(message, 'lifecycle-budget-exceeded:')
              ? 'lifecycle-timeout'
              : message === 'message-storm'
                ? 'message-storm'
                : message === 'global-pollution'
                  ? 'global-pollution'
                  : message === 'resource-leak'
                    ? 'resource-leak'
                    : 'render-failed'
        }

        const createInstanceFault = (error, instanceId) => {
          const message = readOwnDataProperty(error, 'message')
          const fault = new TrustedError(typeof message === 'string' ? message : 'render-failed')
          defineProperty(fault, 'instanceId', {
            value: instanceId,
            writable: true,
            enumerable: true,
            configurable: true,
          })
          const capturedResources = readOwnDataProperty(error, 'resourceSnapshot')
          if (capturedResources !== undefined) {
            defineProperty(fault, 'resourceSnapshot', {
              value: capturedResources,
              writable: true,
              enumerable: true,
              configurable: true,
            })
          }
          return fault
        }

        const postFault = (error, instanceId) => {
          if (!sendToHost || faulted) return
          const failure = preferRealmFault(error)
          const capturedResources =
            readOwnDataProperty(failure, 'resourceSnapshot') ?? readOwnDataProperty(error, 'resourceSnapshot')
          const code = lifecycleFaultCode(failure)
          const resources = capturedResources ?? resourceSnapshot()
          faulted = true
          stopEventBudgetEpoch()
          sendToHost({
            kind: 'online-component.fault',
            protocolVersion,
            nonce: expectedNonce,
            surfaceId: expectedSurfaceId,
            generation: expectedGeneration,
            code,
            instanceId,
            resources,
          })
        }

        const disposeInstance = instanceId => {
          const current = applyFunction(mapGet, instances, [instanceId])
          if (!current) return
          applyFunction(mapDelete, instances, [instanceId])
          let failure
          try {
            if (current.mounted) {
              invokeLifecycle(
                'destroy',
                instanceId,
                () => current.lifecycle.destroy(current.content, current.context),
              )
              assertRealmClean()
            }
            assertOwnedResourcesReleased(instanceId)
          } catch (error) {
            failure = error
          } finally {
            cleanupOwnedResources(instanceId)
            current.layoutStyle.remove()
            current.host.remove()
            if (readMapSize(instances) === 0) stopEventBudgetEpoch()
          }
          if (failure) throw failure
        }

        const importModuleSource = async source => {
          if (typeof source !== 'string' || source.length === 0 || source.length > 131072) {
            throw new TrustedError('invalid-module-source')
          }
          const url = createObjectURL(new TrustedBlob([source], { type: 'text/javascript' }))
          applyFunction(setAdd, liveObjectUrls, [url])
          try {
            const module = await import(url)
            assertRealmClean()
            assertNoUnownedResources()
            return module
          } finally {
            revokeObjectURL(url)
            applyFunction(setDelete, liveObjectUrls, [url])
          }
        }

        const validateArtifactProjection = artifact => {
          if (
            !hasExactKeys(artifact, ['source', 'css', 'dependencies']) ||
            typeof artifact.source !== 'string' ||
            typeof artifact.css !== 'string' ||
            !Array.isArray(artifact.dependencies) ||
            artifact.dependencies.length > 32
          ) {
            throw new TrustedError('invalid-artifact-projection')
          }
          for (const dependency of artifact.dependencies) {
            if (
              !hasExactKeys(dependency, ['specifier', 'source']) ||
              !isDependencySpecifier(dependency.specifier) ||
              typeof dependency.source !== 'string'
            ) {
              throw new TrustedError('invalid-dependency-projection')
            }
          }
          return artifact
        }

        const loadRenderer = async update => {
          const cached = applyFunction(mapGet, moduleCache, [update.revisionKey])
          if (cached) return cached
          const artifact = validateArtifactProjection(update.payload.artifact)
          const loading = (async () => {
            const dependencies = Object.create(null)
            for (const dependency of artifact.dependencies) {
              dependencies[dependency.specifier] = await importModuleSource(dependency.source)
            }
            const module = await importModuleSource(artifact.source)
            const lifecycle = module.default
            if (
              !isRecord(lifecycle) ||
              !hasExactKeys(lifecycle, ['mount', 'update', 'destroy']) ||
              typeof lifecycle.mount !== 'function' ||
              typeof lifecycle.update !== 'function' ||
              typeof lifecycle.destroy !== 'function'
            ) {
              throw new TrustedError('invalid-default-lifecycle')
            }
            return Object.freeze({ lifecycle, css: artifact.css, dependencies: Object.freeze(dependencies) })
          })()
          applyFunction(mapSet, moduleCache, [update.revisionKey, loading])
          loading.catch(() => applyFunction(mapDelete, moduleCache, [update.revisionKey]))
          return loading
        }

        const createInstance = update => {
          const host = document.createElement('div')
          host.className = 'online-component-instance'
          host.dataset.instanceId = update.instanceId
          const domId = 'online-component-instance-' + nextInstanceStyleId++
          host.id = domId
          const layoutStyle = document.createElement('style')
          layoutStyle.nonce = expectedNonce
          document.head.append(layoutStyle)
          const shadow = host.attachShadow({ mode: 'closed' })
          const style = document.createElement('style')
          style.nonce = expectedNonce
          const content = document.createElement('div')
          content.className = 'online-component-content'
          shadow.append(style, content)
          root.append(host)
          const instance = {
            host,
            domId,
            layoutStyle,
            style,
            content,
            revisionKey: update.revisionKey,
            lifecycle: undefined,
            context: undefined,
            mounted: false,
          }
          applyFunction(mapSet, instances, [update.instanceId, instance])
          ensureEventBudgetEpoch()
          return instance
        }

        const stopEventBudgetEpoch = () => {
          eventBudgetEpochGeneration += 1
          if (eventBudgetEpochHandle !== undefined && eventBudgetEpochCancel) {
            applyFunction(eventBudgetEpochCancel, globalThis, [eventBudgetEpochHandle])
          }
          eventBudgetEpochHandle = undefined
          eventBudgetEpochCancel = undefined
          emittedEventCount = 0
        }
        const scheduleEventBudgetEpoch = generation => {
          if (
            generation !== eventBudgetEpochGeneration ||
            eventBudgetEpochHandle !== undefined ||
            faulted ||
            readMapSize(instances) === 0
          ) {
            return
          }
          const advanceEpoch = () => {
            if (generation !== eventBudgetEpochGeneration) return
            eventBudgetEpochHandle = undefined
            eventBudgetEpochCancel = undefined
            if (faulted || readMapSize(instances) === 0) {
              emittedEventCount = 0
              return
            }
            emittedEventCount = 0
            scheduleEventBudgetEpoch(generation)
          }
          if (
            typeof nativeRequestAnimationFrame === 'function' &&
            typeof nativeCancelAnimationFrame === 'function'
          ) {
            eventBudgetEpochCancel = nativeCancelAnimationFrame
            eventBudgetEpochHandle = applyFunction(nativeRequestAnimationFrame, globalThis, [advanceEpoch])
            return
          }
          eventBudgetEpochCancel = nativeClearTimeout
          eventBudgetEpochHandle = applyFunction(nativeSetTimeout, globalThis, [advanceEpoch, 16])
        }
        const ensureEventBudgetEpoch = () => {
          if (faulted || readMapSize(instances) === 0 || eventBudgetEpochHandle !== undefined) return
          scheduleEventBudgetEpoch(eventBudgetEpochGeneration)
        }

        const emit = (instanceId, type, payload) => {
          if (!isIdentifier(instanceId) || !isEventType(type) || faulted) return false
          emittedEventCount += 1
          if (emittedEventCount > maxEmittedEventsPerFrame) {
            postFault(new TrustedError('message-storm'), instanceId)
            return false
          }
          const event = {
            kind: 'online-component.event',
            protocolVersion,
            nonce: expectedNonce,
            surfaceId: expectedSurfaceId,
            generation: expectedGeneration,
            instanceId,
            event: { type, payload: payload ?? null },
          }
          if (!withinBudget(event)) return false
          try {
            assertRealmClean()
          } catch (error) {
            postFault(error, instanceId)
            return false
          }
          sendToHost?.(event)
          return true
        }

        const applyUpdate = async update => {
          let current = applyFunction(mapGet, instances, [update.instanceId])
          if (current && current.revisionKey !== update.revisionKey) {
            disposeInstance(update.instanceId)
            current = undefined
          }
          current ??= createInstance(update)
          setLayout(current, update)

          if (!update.payload.artifact) {
            current.content.textContent = String(update.payload.props?.title ?? update.instanceId)
            return
          }
          const renderer = await loadRenderer(update)
          current.style.textContent =
            '.online-component-content{width:100%;height:100%;box-sizing:border-box;overflow:hidden;}' +
            renderer.css
          const context = Object.freeze({
            props: update.payload.props ?? Object.freeze({}),
            data: update.payload.data ?? null,
            theme: update.payload.theme ?? Object.freeze({}),
            size: update.payload.size ?? Object.freeze({ width: update.rect.width, height: update.rect.height }),
            assets: update.payload.assets ?? Object.freeze([]),
            dependencies: renderer.dependencies,
            emit: (type, payload) => emit(update.instanceId, type, payload),
          })
          current.lifecycle = renderer.lifecycle
          if (!update.visible) {
            current.context = context
            return
          }
          if (current.mounted) {
            invokeLifecycle('update', update.instanceId, () => renderer.lifecycle.update(current.content, context))
          } else {
            invokeLifecycle('mount', update.instanceId, () => renderer.lifecycle.mount(current.content, context))
            current.mounted = true
          }
          assertRealmClean()
          assertNoOwnedObjectUrls(update.instanceId)
          current.context = context
        }

        const applyBatch = async batch => {
          assertRealmClean()
          for (const instanceId of batch.removals) {
            try {
              disposeInstance(instanceId)
            } catch (error) {
              throw createInstanceFault(error, instanceId)
            }
          }
          for (const update of batch.updates) {
            try {
              await applyUpdate(update)
            } catch (error) {
              throw createInstanceFault(error, update.instanceId)
            }
          }
          assertRealmClean()
        }

        const onConnect = event => {
          const message = event.data
          if (
            event.source !== parent ||
            port ||
            !hasExactKeys(message, ['kind', 'protocolVersion', 'nonce', 'surfaceId', 'generation']) ||
            message.kind !== 'online-component.connect' ||
            !hasIdentity(message) ||
            event.ports.length !== 1
          ) {
            return
          }
          const nextPort = event.ports[0]
          if (!nextPort) return
          applyFunction(nativeRemoveEventListener, window, ['message', onConnect, false])
          listenerCount -= 1
          port = nextPort
          sendToHost = nextPort.postMessage.bind(nextPort)
          port.onmessage = portEvent => {
            if (faulted || !isBatch(portEvent.data)) return
            const batch = portEvent.data
            pendingBatchCount += 1
            processing = processing
              .then(async () => {
                let failure
                try {
                  await applyBatch(batch)
                } catch (error) {
                  failure = error
                }
                pendingBatchCount -= 1
                if (failure) {
                  postFault(failure, failure?.instanceId ?? null)
                  return
                }
                sendToHost({
                  kind: 'online-component.batch-applied',
                  protocolVersion,
                  nonce: expectedNonce,
                  surfaceId: expectedSurfaceId,
                  generation: expectedGeneration,
                  sequence: batch.sequence,
                  resources: resourceSnapshot(),
                })
              })
              .catch(error => postFault(error, null))
          }
          listenerCount += 1
          port.start()
          sendToHost({
            kind: 'online-component.ready',
            protocolVersion,
            nonce: expectedNonce,
            surfaceId: expectedSurfaceId,
            generation: expectedGeneration,
            resources: resourceSnapshot(),
          })
        }
        applyFunction(nativeAddEventListener, window, ['message', onConnect, false])
      })()
    </script>
  </body>
</html>`
}
