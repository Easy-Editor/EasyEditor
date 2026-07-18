import { verifyArtifactRecordIntegrity } from '../../online-components/artifact-contracts.mjs'
import {
  DashboardLocalMaterialCatalogClientError,
  normalizeLocalMaterialCatalogItem,
  normalizeLocalMaterialCatalogList,
} from './catalog-client.mjs'

const SOURCE_IDENTITY_FIELDS = Object.freeze(['artifactId', 'sourceRevision', 'logicalComponentId', 'sourceIntegrity'])

const freezeSnapshot = ({ status, projectId = null, materials = [], failure = null }) =>
  Object.freeze({
    schemaVersion: 1,
    status,
    projectId,
    materials: Object.freeze(materials),
    failure: failure ? Object.freeze({ ...failure }) : null,
  })

const disabledSnapshot = freezeSnapshot({ status: 'disabled' })
const disabledRuntime = Object.freeze({
  getSnapshot: () => disabledSnapshot,
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Catalog listener must be a function')
    return () => {}
  },
  refresh: async () => disabledSnapshot,
  dispose() {},
})

const sameSourceIdentity = (left, right) => SOURCE_IDENTITY_FIELDS.every(field => left[field] === right[field])

const requireMethod = (value, method, label) => {
  if (!value || typeof value[method] !== 'function') throw new TypeError(`${label}.${method} must be a function`)
  return value[method].bind(value)
}

const unavailableMaterial = (material, reason) =>
  Object.freeze({ ...material, availability: 'unavailable', unavailableReason: reason })

const availableMaterial = material => Object.freeze({ ...material, availability: 'available', unavailableReason: null })

const failureOf = error =>
  Object.freeze({
    code: typeof error?.code === 'string' && error.code ? error.code : 'catalog-refresh-failed',
    message: error instanceof Error && error.message ? error.message : 'Local material catalog refresh failed',
    retryable: error?.retryable === true,
  })

const persistenceSignature = snapshot =>
  [snapshot?.state ?? 'unknown', snapshot?.projectId ?? '', snapshot?.branchId ?? ''].join('\0')

const currentScope = getPersistenceSnapshot => {
  const snapshot = getPersistenceSnapshot()
  return {
    ready: snapshot?.state === 'ready',
    projectId: typeof snapshot?.projectId === 'string' && snapshot.projectId ? snapshot.projectId : null,
    signature: persistenceSignature(snapshot),
  }
}

const validateLocalArtifactPresence = async ({ material, projectId, readArtifact, hashBytes }) => {
  let artifact
  try {
    artifact = await readArtifact({
      schemaVersion: 1,
      projectId,
      artifactId: material.artifactRef.artifactId,
      sourceRevision: material.artifactRef.sourceRevision,
    })
  } catch {
    return unavailableMaterial(material, 'artifact-unreadable')
  }
  if (artifact === null) return unavailableMaterial(material, 'artifact-missing')
  try {
    const verified = await verifyArtifactRecordIntegrity(artifact, hashBytes ? { hashBytes } : undefined)
    if (verified.projectId !== projectId || !sameSourceIdentity(verified, material.artifactRef)) {
      return unavailableMaterial(material, 'artifact-identity-mismatch')
    }
    return availableMaterial(material)
  } catch {
    return unavailableMaterial(material, 'artifact-invalid')
  }
}

export const createDurableMaterialSnippet = materialValue => {
  const material = normalizeLocalMaterialCatalogItem(
    materialValue?.availability === undefined
      ? materialValue
      : {
          schemaVersion: materialValue.schemaVersion,
          componentName: materialValue.componentName,
          title: materialValue.title,
          createdAt: materialValue.createdAt,
          promotionId: materialValue.promotionId,
          artifactRef: materialValue.artifactRef,
        },
  )
  return Object.freeze({
    title: material.title,
    schema: Object.freeze({
      componentName: 'GeneratedMaterialHost',
      props: Object.freeze({}),
      $agent: Object.freeze({ schemaVersion: 1, artifactRef: material.artifactRef }),
      $dashboard: Object.freeze({ rect: Object.freeze({ width: 400, height: 240 }) }),
      children: Object.freeze([]),
    }),
  })
}

export const createDashboardLocalMaterialCatalogRuntime = options => {
  const enabled = options?.enabled === true
  if (!enabled) return disabledRuntime
  const listMaterials = requireMethod(options?.client, 'listMaterials', 'client')
  const readArtifact = requireMethod(options?.persistence, 'readArtifact', 'persistence')
  const getPersistenceSnapshot = requireMethod(options?.persistence, 'getSnapshot', 'persistence')
  const subscribePersistence = requireMethod(options?.persistence, 'subscribe', 'persistence')
  const hashBytes = options?.hashBytes
  if (hashBytes !== undefined && typeof hashBytes !== 'function') throw new TypeError('hashBytes must be a function')

  const listeners = new Set()
  let disposed = false
  let runGeneration = 0
  let activeController = null
  let refreshQueued = false
  let observedSignature = currentScope(getPersistenceSnapshot).signature
  let snapshot = freezeSnapshot({ status: 'loading' })

  const publish = next => {
    if (snapshot === next || disposed) return
    snapshot = next
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // Observers cannot affect catalog authority or refresh transitions.
      }
    }
  }

  const refresh = async () => {
    if (disposed || !enabled) return snapshot
    const scope = currentScope(getPersistenceSnapshot)
    observedSignature = scope.signature
    if (!scope.ready || scope.projectId === null) {
      activeController?.abort()
      activeController = null
      runGeneration += 1
      publish(freezeSnapshot({ status: 'loading' }))
      return snapshot
    }

    const generation = ++runGeneration
    activeController?.abort()
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    activeController = controller
    publish(freezeSnapshot({ status: 'loading', projectId: scope.projectId }))

    try {
      const response = normalizeLocalMaterialCatalogList(
        await listMaterials({
          projectId: scope.projectId,
          ...(controller ? { signal: controller.signal } : {}),
        }),
      )
      const materials = []
      for (const catalogItem of response.materials) {
        if (disposed || generation !== runGeneration) return snapshot
        const material = normalizeLocalMaterialCatalogItem(catalogItem)
        materials.push(
          await validateLocalArtifactPresence({
            material,
            projectId: scope.projectId,
            readArtifact,
            hashBytes,
          }),
        )
      }
      const latestScope = currentScope(getPersistenceSnapshot)
      if (disposed || generation !== runGeneration || latestScope.projectId !== scope.projectId || !latestScope.ready) {
        return snapshot
      }
      publish(freezeSnapshot({ status: 'ready', projectId: scope.projectId, materials }))
    } catch (error) {
      if (disposed || generation !== runGeneration || error?.code === 'aborted') return snapshot
      const status =
        error instanceof DashboardLocalMaterialCatalogClientError && error.code !== 'invalid-response'
          ? 'error'
          : 'fail-closed'
      publish(freezeSnapshot({ status, projectId: scope.projectId, failure: failureOf(error) }))
    } finally {
      if (activeController === controller) activeController = null
    }
    return snapshot
  }

  const scheduleRefresh = () => {
    if (refreshQueued || disposed || !enabled) return
    refreshQueued = true
    queueMicrotask(() => {
      refreshQueued = false
      void refresh()
    })
  }

  const releasePersistence = subscribePersistence(() => {
    const signature = currentScope(getPersistenceSnapshot).signature
    if (signature === observedSignature) return
    observedSignature = signature
    scheduleRefresh()
  })

  if (enabled) scheduleRefresh()

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Catalog listener must be a function')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      runGeneration += 1
      activeController?.abort()
      activeController = null
      releasePersistence()
      listeners.clear()
    },
  })
}
