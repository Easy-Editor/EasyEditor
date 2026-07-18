import {
  cloneFrozenJson,
  readCanonicalNodeArtifactRef,
  validateArtifactRecord,
  validateArtifactRef,
  validateLockedArtifactDependency,
} from '../../lib/storage/artifact-contracts.mjs'
import { createOnlineComponentSurfaceHost } from './surface-host.mjs'
import { normalizeRenderUpdate } from './surface-protocol.mjs'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/
const MARKER_SCHEMA_VERSION = 1
const UPDATE_KEYS = new Set(['projectId', 'node', 'rect', 'visible', 'generatedZ', 'payload'])
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const textEncoder = new TextEncoder()
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

const assertIdentifier = (value, name) => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) throw new TypeError(`${name} is invalid`)
  return value
}

const assertPlainObject = (value, name) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object`)
  return value
}

const assertStorage = storage => {
  for (const method of ['getItem', 'setItem', 'removeItem']) {
    if (typeof storage?.[method] !== 'function') throw new TypeError(`markerStore.${method} is required`)
  }
  return storage
}

const assertHashBytes = hashBytes => {
  if (typeof hashBytes !== 'function') throw new TypeError('hashBytes is required')
  return hashBytes
}

const emptyMarkerMap = () => Object.create(null)
const emptyMarkerRecord = () => ({
  schemaVersion: MARKER_SCHEMA_VERSION,
  pending: emptyMarkerMap(),
  quarantined: emptyMarkerMap(),
})

const normalizeActivationMarker = (value, name, identity) => {
  const marker = assertPlainObject(value, name)
  const fields = Object.keys(marker).sort()
  const expected = ['activationId', 'nonce', 'revisionKey', 'startedAt', 'state', 'surfaceId']
  if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) {
    throw new TypeError(`${name} fields are invalid`)
  }
  if (marker.state !== 'pending') throw new TypeError(`${name}.state is invalid`)
  assertIdentifier(marker.revisionKey, `${name}.revisionKey`)
  assertIdentifier(marker.surfaceId, `${name}.surfaceId`)
  assertIdentifier(marker.activationId, `${name}.activationId`)
  assertIdentifier(marker.nonce, `${name}.nonce`)
  if (!Number.isFinite(marker.startedAt)) throw new TypeError(`${name}.startedAt is invalid`)
  if (marker.surfaceId !== identity.surfaceId || marker.activationId !== identity.activationId) {
    throw new TypeError(`${name} is outside surface identity`)
  }
  return cloneFrozenJson(marker)
}

const normalizeMarkerMap = (value, name, identity, expectedKey) => {
  const source = assertPlainObject(value, name)
  const normalized = emptyMarkerMap()
  for (const [key, candidate] of Object.entries(source)) {
    const marker = normalizeActivationMarker(candidate, `${name}.${key}`, identity)
    if (key !== expectedKey(marker)) throw new TypeError(`${name}.${key} key is invalid`)
    normalized[key] = marker
  }
  return normalized
}

const parseMarkerRecord = (serialized, identity) => {
  if (serialized === null) return { record: emptyMarkerRecord(), corrupt: false }
  try {
    const value = JSON.parse(serialized)
    assertPlainObject(value, 'activation marker record')
    const fields = Object.keys(value).sort()
    const expected = ['pending', 'quarantined', 'schemaVersion']
    if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) {
      throw new TypeError('activation marker record fields are invalid')
    }
    if (value.schemaVersion !== MARKER_SCHEMA_VERSION) throw new TypeError('activation marker schema is unsupported')
    return {
      record: {
        schemaVersion: MARKER_SCHEMA_VERSION,
        pending: normalizeMarkerMap(
          value.pending,
          'activation marker pending map',
          identity,
          marker => `${marker.revisionKey}::${marker.surfaceId}`,
        ),
        quarantined: normalizeMarkerMap(
          value.quarantined,
          'activation marker quarantine map',
          identity,
          marker => marker.revisionKey,
        ),
      },
      corrupt: false,
    }
  } catch {
    return { record: emptyMarkerRecord(), corrupt: true }
  }
}

const markersEqual = (left, right) => {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  return ['state', 'revisionKey', 'surfaceId', 'activationId', 'nonce', 'startedAt'].every(
    field => left[field] === right[field],
  )
}

const encodeBase64 = bytes => {
  let result = ''
  for (let index = 0; index < bytes.byteLength; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.byteLength ? bytes[index + 1] : 0
    const third = index + 2 < bytes.byteLength ? bytes[index + 2] : 0
    const packed = (first << 16) | (second << 8) | third
    result += BASE64_ALPHABET[(packed >>> 18) & 63]
    result += BASE64_ALPHABET[(packed >>> 12) & 63]
    result += index + 1 < bytes.byteLength ? BASE64_ALPHABET[(packed >>> 6) & 63] : '='
    result += index + 2 < bytes.byteLength ? BASE64_ALPHABET[packed & 63] : '='
  }
  return result
}

const decodeCanonicalBase64 = value => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64_PATTERN.test(value)
  ) {
    throw new Error('artifact dependency bytes are not canonical base64')
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((value.length / 4) * 3 - padding)
  let offset = 0
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index])
    const second = BASE64_ALPHABET.indexOf(value[index + 1])
    const third = value[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 2])
    const fourth = value[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 3])
    const packed = (first << 18) | (second << 12) | (third << 6) | fourth
    if (offset < bytes.byteLength) bytes[offset++] = (packed >>> 16) & 255
    if (offset < bytes.byteLength) bytes[offset++] = (packed >>> 8) & 255
    if (offset < bytes.byteLength) bytes[offset++] = packed & 255
  }
  if (encodeBase64(bytes) !== value) throw new Error('artifact dependency bytes are not canonical base64')
  return bytes
}

const normalizeHash = value => {
  const bytes =
    value instanceof Uint8Array
      ? value
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null
  if (!bytes || bytes.byteLength !== 32) throw new Error('hashBytes must return exactly 32 bytes')
  return new Uint8Array(bytes)
}

const hashHex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')

const decodeUtf8 = bytes => {
  let source
  try {
    source = fatalTextDecoder.decode(bytes)
  } catch {
    throw new Error('artifact dependency source is not valid UTF-8')
  }
  const roundTrip = textEncoder.encode(source)
  if (roundTrip.byteLength !== bytes.byteLength || roundTrip.some((byte, index) => byte !== bytes[index])) {
    throw new Error('artifact dependency source is not canonical UTF-8')
  }
  return source
}

const hasEntries = value => Object.keys(value).length > 0

export const createOnlineComponentSurfaceMarkerStorageKey = input => {
  const value = assertPlainObject(input, 'surface marker identity')
  const projectId = assertIdentifier(value.projectId, 'projectId')
  const branchId = assertIdentifier(value.branchId, 'branchId')
  const surfaceId = assertIdentifier(value.surfaceId, 'surfaceId')
  return `easy-editor:online-component-activation:v1:${encodeURIComponent(projectId)}:${encodeURIComponent(branchId)}:${encodeURIComponent(surfaceId)}`
}

export const createBrowserOnlineComponentHashBytes = (crypto = globalThis.crypto) => {
  if (typeof crypto?.subtle?.digest !== 'function') throw new Error('Web Crypto SHA-256 is unavailable')
  return async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

const createPersistentMarkerAdapter = ({ storage, storageKey, surfaceId, activationId }) => {
  const parsed = parseMarkerRecord(storage.getItem(storageKey), { surfaceId, activationId })
  let record = parsed.record

  const persist = () => {
    if (!hasEntries(record.pending) && !hasEntries(record.quarantined)) {
      storage.removeItem(storageKey)
      return
    }
    storage.setItem(storageKey, JSON.stringify(record))
  }

  if (hasEntries(record.pending)) {
    const quarantined = Object.assign(emptyMarkerMap(), record.quarantined)
    for (const marker of Object.values(record.pending)) quarantined[marker.revisionKey] = marker
    record = {
      schemaVersion: MARKER_SCHEMA_VERSION,
      pending: {},
      quarantined,
    }
    persist()
  }

  const reset = () => {
    record = emptyMarkerRecord()
    storage.removeItem(storageKey)
  }

  return {
    failClosed: parsed.corrupt,
    isRevisionQuarantined: revisionKey => Object.hasOwn(record.quarantined, revisionKey),
    reset,
    store: Object.freeze({
      read: key =>
        record.pending[key] ??
        Object.values(record.quarantined).find(marker => `${marker.revisionKey}::${marker.surfaceId}` === key),
      write: (key, marker) => {
        record.pending[key] = cloneFrozenJson(marker)
        persist()
      },
      clear: (key, marker) => {
        if (!markersEqual(record.pending[key], marker)) return
        delete record.pending[key]
        persist()
      },
      quarantine: (revisionKey, marker) => {
        for (const [key, pendingMarker] of Object.entries(record.pending)) {
          if (pendingMarker?.revisionKey === revisionKey || markersEqual(pendingMarker, marker))
            delete record.pending[key]
        }
        record.quarantined[revisionKey] = cloneFrozenJson(marker)
        persist()
      },
    }),
  }
}

const normalizeRegistration = (input, projectId) => {
  const value = assertPlainObject(input, 'online component registration')
  if (value.projectId !== projectId) throw new Error('online component registration is outside project authority')
  const instanceId = assertIdentifier(value.instanceId, 'instanceId')
  if (value.node?.componentName !== 'GeneratedMaterialHost') {
    throw new Error('online component node must be a GeneratedMaterialHost')
  }
  const artifactRef = readCanonicalNodeArtifactRef(value.node)
  if (!artifactRef) throw new Error('online component node has no canonical artifact ref')
  const payload = assertPlainObject(value.payload, 'online component payload')
  if (Object.hasOwn(payload, 'artifact')) throw new Error('online component payload cannot provide artifact')
  return Object.freeze({
    projectId,
    instanceId,
    node: cloneFrozenJson(value.node),
    artifactRef,
    rect: cloneFrozenJson(value.rect),
    visible: value.visible,
    generatedZ: value.generatedZ,
    payload: cloneFrozenJson(payload),
  })
}

const mergeRegistration = (current, patch, projectId) => {
  const value = assertPlainObject(patch, 'online component update')
  for (const key of Object.keys(value)) {
    if (!UPDATE_KEYS.has(key)) throw new TypeError(`unsupported online component update field ${key}`)
  }
  return normalizeRegistration(
    {
      projectId: Object.hasOwn(value, 'projectId') ? value.projectId : projectId,
      instanceId: current.instanceId,
      node: Object.hasOwn(value, 'node') ? value.node : current.node,
      rect: Object.hasOwn(value, 'rect') ? value.rect : current.rect,
      visible: Object.hasOwn(value, 'visible') ? value.visible : current.visible,
      generatedZ: Object.hasOwn(value, 'generatedZ') ? value.generatedZ : current.generatedZ,
      payload: Object.hasOwn(value, 'payload') ? value.payload : current.payload,
    },
    projectId,
  )
}

export const createOnlineComponentSurfaceController = options => {
  const value = assertPlainObject(options ?? {}, 'online component surface controller options')
  const projectId = assertIdentifier(value.projectId, 'projectId')
  const branchId = assertIdentifier(value.branchId, 'branchId')
  const surfaceId = assertIdentifier(value.surfaceId, 'surfaceId')
  const activationId = assertIdentifier(`${projectId}:${branchId}:${surfaceId}`, 'activationId')
  const featureEnabled = value.featureEnabled === true
  const safeBoot = value.safeBoot === true
  const createSurfaceHost = value.createSurfaceHost ?? createOnlineComponentSurfaceHost
  if (typeof createSurfaceHost !== 'function') throw new TypeError('createSurfaceHost is required')

  let state = featureEnabled ? (safeBoot ? 'safe-boot' : 'idle') : 'disabled'
  let markerAdapter
  let failClosed = false
  let readArtifact
  let hashBytes
  if (state === 'idle') {
    const storage = assertStorage(value.markerStore)
    readArtifact = value.readArtifact
    if (typeof readArtifact !== 'function') throw new TypeError('readArtifact is required')
    hashBytes = assertHashBytes(value.hashBytes ?? createBrowserOnlineComponentHashBytes())
    markerAdapter = createPersistentMarkerAdapter({
      storage,
      storageKey: createOnlineComponentSurfaceMarkerStorageKey({ projectId, branchId, surfaceId }),
      surfaceId,
      activationId,
    })
    failClosed = markerAdapter.failClosed
    if (failClosed) state = 'quarantined'
  }

  const instances = new Map()
  const artifactProjections = new Map()
  let host
  let disposed = false
  let faultCount = 0

  const verifyArtifact = async normalizedRef => {
    const rawArtifact = await readArtifact(normalizedRef)
    if (rawArtifact === null || rawArtifact === undefined) throw new Error('artifact could not be read')
    const record = validateArtifactRecord(rawArtifact)
    if (record.projectId !== projectId) throw new Error('artifact is outside project authority')
    for (const field of ['artifactId', 'logicalComponentId', 'sourceRevision', 'sourceIntegrity']) {
      if (record[field] !== normalizedRef[field]) throw new Error(`artifact identity does not match ref field ${field}`)
    }

    const sourceHash = normalizeHash(await hashBytes(textEncoder.encode(record.source)))
    if (`sha256:${hashHex(sourceHash)}` !== record.sourceIntegrity) {
      throw new Error('artifact source digest does not match sourceIntegrity')
    }

    const dependencies = []
    const dependencyPackages = new Set()
    for (const candidate of record.lockedDependencies) {
      const dependency = validateLockedArtifactDependency(candidate)
      if (dependencyPackages.has(dependency.package)) throw new Error('artifact dependency package is duplicated')
      dependencyPackages.add(dependency.package)
      const bytes = decodeCanonicalBase64(dependency.module.bytes)
      const dependencyHash = normalizeHash(await hashBytes(bytes))
      if (`sha256-${encodeBase64(dependencyHash)}` !== dependency.integrity) {
        throw new Error(`artifact dependency integrity does not match SRI for ${dependency.package}`)
      }
      dependencies.push(Object.freeze({ specifier: dependency.package, source: decodeUtf8(bytes) }))
    }

    const projection = Object.freeze({
      source: record.source,
      css: record.css,
      dependencies: Object.freeze(dependencies),
    })
    const revisionHash = normalizeHash(await hashBytes(textEncoder.encode(JSON.stringify(projection))))
    return Object.freeze({ projection, revisionKey: `artifact-${hashHex(revisionHash)}` })
  }

  const materializeArtifact = artifactReference => {
    const normalizedRef = validateArtifactRef(artifactReference)
    const cacheKey = JSON.stringify(normalizedRef)
    const cached = artifactProjections.get(cacheKey)
    if (cached) return cached
    const pending = verifyArtifact(normalizedRef).catch(error => {
      if (artifactProjections.get(cacheKey) === pending) artifactProjections.delete(cacheKey)
      throw error
    })
    artifactProjections.set(cacheKey, pending)
    return pending
  }

  const ensureHost = () => {
    if (host) return host
    host = createSurfaceHost({
      ...(value.surfaceHostOptions ?? {}),
      enabled: true,
      safeBoot: false,
      surfaceId,
      activationId,
      markerStore: markerAdapter.store,
    })
    for (const method of ['register', 'update', 'unregister', 'dispose', 'getDiagnostics']) {
      if (typeof host?.[method] !== 'function') {
        host?.dispose?.()
        host = undefined
        throw new TypeError(`createSurfaceHost returned an invalid host: ${method} is required`)
      }
    }
    return host
  }

  const applyRecord = async record => {
    try {
      const materialized = await materializeArtifact(record.input.artifactRef)
      if (disposed || instances.get(record.input.instanceId) !== record) return false
      if (markerAdapter.isRevisionQuarantined(materialized.revisionKey)) {
        if (![...instances.values()].some(candidate => candidate !== record && candidate.registered)) {
          state = 'quarantined'
        }
        return false
      }
      const update = normalizeRenderUpdate({
        instanceId: record.input.instanceId,
        revisionKey: materialized.revisionKey,
        rect: record.input.rect,
        visible: record.input.visible,
        generatedZ: record.input.generatedZ,
        payload: { ...record.input.payload, artifact: materialized.projection },
      })
      if (disposed || instances.get(record.input.instanceId) !== record) return false
      const surfaceHost = ensureHost()
      if (!record.registered) {
        const registered = surfaceHost.register(update)
        if (registered === false) return false
        record.registered = true
        state = 'active'
        return true
      }
      const updated = surfaceHost.update(record.input.instanceId, {
        revisionKey: update.revisionKey,
        rect: update.rect,
        visible: update.visible,
        generatedZ: update.generatedZ,
        payload: update.payload,
      })
      if (updated) state = 'active'
      return updated
    } catch (error) {
      if (!disposed && instances.get(record.input.instanceId) === record) faultCount += 1
      throw error
    }
  }

  const register = async input => {
    if (disposed || state === 'disabled' || state === 'safe-boot' || failClosed) {
      return false
    }
    const normalized = normalizeRegistration(input, projectId)
    if (instances.has(normalized.instanceId)) throw new Error(`instance ${normalized.instanceId} is already registered`)
    const record = { input: normalized, registered: false }
    instances.set(normalized.instanceId, record)
    return applyRecord(record)
  }

  const update = async (instanceId, patch) => {
    if (disposed || state === 'disabled' || state === 'safe-boot' || failClosed) {
      return false
    }
    assertIdentifier(instanceId, 'instanceId')
    const current = instances.get(instanceId)
    if (!current) throw new Error(`unknown instance ${instanceId}`)
    const record = {
      input: mergeRegistration(current.input, patch, projectId),
      registered: current.registered,
    }
    instances.set(instanceId, record)
    return applyRecord(record)
  }

  const unregister = instanceId => {
    assertIdentifier(instanceId, 'instanceId')
    const current = instances.get(instanceId)
    if (!current) return false
    instances.delete(instanceId)
    if (current.registered && host) host.unregister(instanceId)
    if (instances.size === 0 && state === 'active') state = 'idle'
    return true
  }

  const clearQuarantine = () => {
    if (disposed || !failClosed || !markerAdapter) return false
    markerAdapter.reset()
    failClosed = false
    state = 'idle'
    return true
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    instances.clear()
    artifactProjections.clear()
    host?.dispose()
    state = 'disposed'
  }

  return Object.freeze({
    register,
    update,
    unregister,
    clearQuarantine,
    dispose,
    getDiagnostics: () =>
      Object.freeze({
        state,
        instanceCount: instances.size,
        iframeCount: host?.getDiagnostics?.().iframeCount ?? 0,
        hostCreated: host !== undefined,
        faultCount,
      }),
  })
}
