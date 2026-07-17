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
        const TrustedBlob = Blob
        const createObjectURL = URL.createObjectURL.bind(URL)
        const revokeObjectURL = URL.revokeObjectURL.bind(URL)
        const getOwnPropertyNames = Object.getOwnPropertyNames
        const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
        const resolvePromise = Promise.resolve.bind(Promise)
        const monotonicNow = performance.now.bind(performance)
        const lifecycleBudgetMs = 50
        let nextInstanceStyleId = 1
        let port
        let sendToHost
        let processing = Promise.resolve()
        let pendingTaskCount = 0
        let listenerCount = 1
        let faulted = false
        let emittedEventCount = 0

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
        const resourceSnapshot = () => ({
          instanceCount: instances.size,
          listenerCount,
          pendingTaskCount,
          objectUrlCount: liveObjectUrls.size,
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
          throw new Error('async-lifecycle-not-supported:' + method)
        }
        const invokeLifecycle = (method, callback) => {
          const startedAt = monotonicNow()
          const result = callback()
          assertSynchronousLifecycleResult(method, result)
          if (monotonicNow() - startedAt > lifecycleBudgetMs) {
            throw new Error('lifecycle-budget-exceeded:' + method)
          }
        }

        const guardedObjects = [
          globalThis,
          Object.prototype,
          Array.prototype,
          Function.prototype,
          EventTarget.prototype,
          Node.prototype,
          Element.prototype,
          HTMLElement.prototype,
          MessagePort.prototype,
          URL.prototype,
          Promise.prototype,
        ]
        const captureRealm = () => {
          const snapshot = []
          for (let objectIndex = 0; objectIndex < guardedObjects.length; objectIndex += 1) {
            const object = guardedObjects[objectIndex]
            const names = getOwnPropertyNames(object)
            const properties = []
            for (let propertyIndex = 0; propertyIndex < names.length; propertyIndex += 1) {
              const name = names[propertyIndex]
              const descriptor = getOwnPropertyDescriptor(object, name)
              properties.push([name, descriptor?.value, descriptor?.get, descriptor?.set, descriptor?.writable,
                descriptor?.enumerable, descriptor?.configurable])
            }
            snapshot.push(properties)
          }
          return snapshot
        }
        const cleanRealm = captureRealm()
        const assertRealmClean = () => {
          const current = captureRealm()
          if (current.length !== cleanRealm.length) throw new Error('global-pollution')
          for (let objectIndex = 0; objectIndex < current.length; objectIndex += 1) {
            const left = cleanRealm[objectIndex]
            const right = current[objectIndex]
            if (left.length !== right.length) throw new Error('global-pollution')
            for (let propertyIndex = 0; propertyIndex < left.length; propertyIndex += 1) {
              const before = left[propertyIndex]
              const after = right[propertyIndex]
              if (before.length !== after.length) throw new Error('global-pollution')
              for (let valueIndex = 0; valueIndex < before.length; valueIndex += 1) {
                if (before[valueIndex] !== after[valueIndex]) throw new Error('global-pollution')
              }
            }
          }
        }

        const lifecycleFaultCode = error =>
          error instanceof Error && error.message.startsWith('async-lifecycle-not-supported:')
            ? 'async-lifecycle'
            : error instanceof Error && error.message.startsWith('lifecycle-budget-exceeded:')
              ? 'lifecycle-timeout'
              : error instanceof Error && error.message === 'message-storm'
                ? 'message-storm'
            : error instanceof Error && error.message === 'global-pollution'
              ? 'global-pollution'
              : 'render-failed'

        const postFault = (error, instanceId) => {
          if (!sendToHost || faulted) return
          faulted = true
          sendToHost({
            kind: 'online-component.fault',
            protocolVersion,
            nonce: expectedNonce,
            surfaceId: expectedSurfaceId,
            generation: expectedGeneration,
            code: lifecycleFaultCode(error),
            instanceId,
            resources: resourceSnapshot(),
          })
        }

        const disposeInstance = instanceId => {
          const current = instances.get(instanceId)
          if (!current) return
          instances.delete(instanceId)
          try {
            if (current.mounted) {
              invokeLifecycle(
                'destroy',
                () => current.lifecycle.destroy(current.content, current.context),
              )
              assertRealmClean()
            }
          } finally {
            current.layoutStyle.remove()
            current.host.remove()
          }
        }

        const importModuleSource = async source => {
          if (typeof source !== 'string' || source.length === 0 || source.length > 131072) {
            throw new Error('invalid-module-source')
          }
          const url = createObjectURL(new TrustedBlob([source], { type: 'text/javascript' }))
          liveObjectUrls.add(url)
          try {
            const module = await import(url)
            assertRealmClean()
            return module
          } finally {
            revokeObjectURL(url)
            liveObjectUrls.delete(url)
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
            throw new Error('invalid-artifact-projection')
          }
          for (const dependency of artifact.dependencies) {
            if (
              !hasExactKeys(dependency, ['specifier', 'source']) ||
              !isDependencySpecifier(dependency.specifier) ||
              typeof dependency.source !== 'string'
            ) {
              throw new Error('invalid-dependency-projection')
            }
          }
          return artifact
        }

        const loadRenderer = async update => {
          const cached = moduleCache.get(update.revisionKey)
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
              throw new Error('invalid-default-lifecycle')
            }
            return Object.freeze({ lifecycle, css: artifact.css, dependencies: Object.freeze(dependencies) })
          })()
          moduleCache.set(update.revisionKey, loading)
          loading.catch(() => moduleCache.delete(update.revisionKey))
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
          instances.set(update.instanceId, instance)
          return instance
        }

        const emit = (instanceId, type, payload) => {
          if (!isIdentifier(instanceId) || !isEventType(type) || faulted) return false
          emittedEventCount += 1
          if (emittedEventCount > 1024) {
            postFault(new Error('message-storm'), instanceId)
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
          let current = instances.get(update.instanceId)
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
            invokeLifecycle('update', () => renderer.lifecycle.update(current.content, context))
          } else {
            invokeLifecycle('mount', () => renderer.lifecycle.mount(current.content, context))
            current.mounted = true
          }
          assertRealmClean()
          current.context = context
        }

        const applyBatch = async batch => {
          assertRealmClean()
          for (const instanceId of batch.removals) {
            try {
              disposeInstance(instanceId)
            } catch (error) {
              const fault = new Error(error instanceof Error ? error.message : 'render-failed')
              fault.instanceId = instanceId
              throw fault
            }
          }
          for (const update of batch.updates) {
            try {
              await applyUpdate(update)
            } catch (error) {
              const fault = new Error(error instanceof Error ? error.message : 'render-failed')
              fault.instanceId = update.instanceId
              throw fault
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
          window.removeEventListener('message', onConnect)
          listenerCount -= 1
          port = nextPort
          sendToHost = nextPort.postMessage.bind(nextPort)
          port.onmessage = portEvent => {
            if (faulted || !isBatch(portEvent.data)) return
            const batch = portEvent.data
            pendingTaskCount += 1
            processing = processing
              .then(async () => {
                let failure
                try {
                  await applyBatch(batch)
                } catch (error) {
                  failure = error
                }
                pendingTaskCount -= 1
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
        window.addEventListener('message', onConnect)
      })()
    </script>
  </body>
</html>`
}
