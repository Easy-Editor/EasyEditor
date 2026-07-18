import {
  MATERIAL_GC_SCHEMA_VERSION,
  createMaterialGcPlanHashInput,
  createMaterialGcPlanRequestDigestInput,
  createMaterialGcReleaseRequestDigestInput,
  validateMaterialGcPlan,
  validateMaterialGcPlanRequest,
  validateMaterialGcReleaseRequest,
  validateMaterialGcSweepRequest,
} from '../../../../../shared/material-gc-contract.mjs'
import { validateMaterialIdentity } from '../../../../../shared/material-promotion-contract.mjs'
import { canonicalJsonStringify } from '../../../../lib/storage/canonical-json.mjs'

export const DASHBOARD_MATERIAL_GC_REPLICA_STORAGE_KEY = 'easy-editor:material-gc:replica:v1'
export const DASHBOARD_MATERIAL_GC_PROJECT_STORAGE_PREFIX = 'easy-editor:material-gc:project:v1:'
export const DASHBOARD_MATERIAL_GC_PROJECT_STATE_VERSION = 2

const digestPattern = /^sha256:[\da-f]{64}$/u
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu
const projectIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u
const legacyProjectStateFields = Object.freeze([
  'pendingPlanRequest',
  'projectId',
  'replicaGeneration',
  'replicaId',
  'schemaVersion',
  'snapshotDigest',
  'status',
])
const projectStateFields = Object.freeze([
  'acceptedMaterialRefs',
  'pendingPlanRequest',
  'pendingSweepRequest',
  'projectId',
  'replicaGeneration',
  'replicaId',
  'schemaVersion',
  'snapshotDigest',
  'stateVersion',
  'status',
])

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const hasExactFields = (value, fields) => {
  if (!isPlainRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

const assertExactFields = (value, fields, label) => {
  if (!hasExactFields(value, fields)) throw new TypeError(`${label} fields must match the contract`)
}

const requireProjectId = value => {
  if (typeof value !== 'string' || !projectIdPattern.test(value)) throw new TypeError('projectId is invalid')
  return value
}

const requireReplicaId = value => {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new TypeError('replicaId is not a random UUID')
  return value
}

const requireDigestOrNull = value => {
  if (value !== null && (typeof value !== 'string' || !digestPattern.test(value))) {
    throw new TypeError('snapshotDigest must be null or a sha256 digest')
  }
  return value
}

const requireGeneration = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('replicaGeneration is invalid')
  return value
}

const deepFreeze = value => {
  if (!value || typeof value !== 'object') return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.isFrozen(value) ? value : Object.freeze(value)
}

const cloneFrozen = value => deepFreeze(structuredClone(value))

const sameJson = (left, right) => canonicalJsonStringify(left) === canonicalJsonStringify(right)
const identityKey = identity => `${identity.materialId}\0${identity.materialVersion}\0${identity.buildIntegrity}`
const compareIdentity = (left, right) => identityKey(left).localeCompare(identityKey(right))
const bytesToHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

const hashContractJson = async (value, crypto) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return `sha256:${bytesToHex(new Uint8Array(digest))}`
}

const normalizeMaterialRefs = (value, label) => {
  if (!Array.isArray(value) || value.length > 4096) throw new TypeError(`${label} must be a bounded array`)
  const refs = value.map(validateMaterialIdentity).sort(compareIdentity)
  const keys = refs.map(identityKey)
  if (new Set(keys).size !== keys.length) throw new TypeError(`${label} must not contain duplicates`)
  return cloneFrozen(refs)
}

const mergeMaterialRefs = (...groups) => {
  const refs = new Map()
  for (const group of groups) {
    for (const ref of group) refs.set(identityKey(ref), ref)
  }
  return cloneFrozen([...refs.values()].sort(compareIdentity))
}

const containsEveryMaterialRef = (superset, subset) => {
  const keys = new Set(superset.map(identityKey))
  return subset.every(ref => keys.has(identityKey(ref)))
}

export class DashboardMaterialGcReplicaStateError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'DashboardMaterialGcReplicaStateError'
    this.code = code
  }
}

const stateError = (code, message, cause) =>
  new DashboardMaterialGcReplicaStateError(code, message, cause === undefined ? undefined : { cause })

const projectStorageKey = projectId => `${DASHBOARD_MATERIAL_GC_PROJECT_STORAGE_PREFIX}${encodeURIComponent(projectId)}`

const parseJson = (serialized, label) => {
  try {
    return JSON.parse(serialized)
  } catch (error) {
    throw stateError('corrupt-state', `${label} is not valid JSON`, error)
  }
}

const normalizePendingSweep = (value, { projectId, replicaId, replicaGeneration, snapshotDigest }) => {
  if (value === null) return null
  const request = validateMaterialGcSweepRequest(value)
  if (
    request.plan.projectId !== projectId ||
    request.plan.replicaId !== replicaId ||
    request.plan.replicaGeneration !== replicaGeneration ||
    request.plan.snapshotDigest !== snapshotDigest
  ) {
    throw new TypeError('pending sweep request does not match project state authority')
  }
  return request
}

const normalizeProjectState = (value, { projectId, replicaId }) => {
  const legacy = hasExactFields(value, legacyProjectStateFields)
  if (!legacy && !hasExactFields(value, projectStateFields)) {
    throw new TypeError('material-gc-project-state fields must match the contract')
  }
  if (value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION) throw new TypeError('project state schema is unsupported')
  if (!legacy && value.stateVersion !== DASHBOARD_MATERIAL_GC_PROJECT_STATE_VERSION) {
    throw new TypeError('project state version is unsupported')
  }
  if (requireProjectId(value.projectId) !== projectId || requireReplicaId(value.replicaId) !== replicaId) {
    throw new TypeError('project state authority does not match this replica')
  }
  if (value.status !== 'active' && value.status !== 'released') throw new TypeError('project state status is invalid')
  const replicaGeneration = requireGeneration(value.replicaGeneration)
  const snapshotDigest = requireDigestOrNull(value.snapshotDigest)
  const acceptedMaterialRefs = legacy
    ? Object.freeze([])
    : normalizeMaterialRefs(value.acceptedMaterialRefs, 'acceptedMaterialRefs')
  const pendingPlanRequest =
    value.pendingPlanRequest === null ? null : validateMaterialGcPlanRequest(value.pendingPlanRequest)
  const pendingSweepRequest = legacy
    ? null
    : normalizePendingSweep(value.pendingSweepRequest, {
        projectId,
        replicaId,
        replicaGeneration,
        snapshotDigest,
      })
  if (pendingPlanRequest) {
    if (
      pendingPlanRequest.projectId !== projectId ||
      pendingPlanRequest.replicaId !== replicaId ||
      pendingPlanRequest.expectedReplicaGeneration !== replicaGeneration ||
      !containsEveryMaterialRef(pendingPlanRequest.materialRefs, acceptedMaterialRefs)
    ) {
      throw new TypeError('pending plan request does not match project state authority')
    }
  }
  if (pendingPlanRequest !== null && pendingSweepRequest !== null) {
    throw new TypeError('project state cannot contain pending plan and sweep requests together')
  }
  if (
    value.status === 'released' &&
    (pendingPlanRequest !== null ||
      pendingSweepRequest !== null ||
      acceptedMaterialRefs.length > 0 ||
      replicaGeneration <= 0 ||
      snapshotDigest === null)
  ) {
    throw new TypeError('released project state is not a durable tombstone')
  }
  if ((replicaGeneration === 0) !== (snapshotDigest === null)) {
    throw new TypeError('project state generation and snapshot digest are inconsistent')
  }
  return Object.freeze({
    state: cloneFrozen({
      schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
      stateVersion: DASHBOARD_MATERIAL_GC_PROJECT_STATE_VERSION,
      projectId,
      replicaId,
      replicaGeneration,
      snapshotDigest,
      acceptedMaterialRefs,
      pendingPlanRequest,
      pendingSweepRequest,
      status: value.status,
    }),
    migrated: legacy,
  })
}

const normalizeSweepResult = value => {
  assertExactFields(
    value,
    ['deletedMaterials', 'planHash', 'registryGeneration', 'replicaGeneration', 'schemaVersion'],
    'material-gc-sweep-result',
  )
  if (
    value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION ||
    typeof value.planHash !== 'string' ||
    !digestPattern.test(value.planHash) ||
    !Number.isSafeInteger(value.registryGeneration) ||
    value.registryGeneration <= 0 ||
    !Number.isSafeInteger(value.replicaGeneration) ||
    value.replicaGeneration <= 0
  ) {
    throw new TypeError('material-gc-sweep-result is invalid')
  }
  return cloneFrozen({
    schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
    deletedMaterials: normalizeMaterialRefs(value.deletedMaterials, 'deletedMaterials'),
    registryGeneration: value.registryGeneration,
    replicaGeneration: value.replicaGeneration,
    planHash: value.planHash,
  })
}

export const resolveDashboardMaterialGcEnabled = source => {
  const value = source?.VITE_DASHBOARD_MATERIAL_GC
  return value === true || value === 'true' || value === '1'
}

export const createDashboardMaterialGcReplicaState = options => {
  const storage = options?.storage
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw stateError('storage-unavailable', 'Material GC requires durable localStorage')
  }
  const crypto = options?.crypto
  if (!crypto || typeof crypto.randomUUID !== 'function' || typeof crypto.subtle?.digest !== 'function') {
    throw stateError('crypto-unavailable', 'Material GC requires crypto.randomUUID and SHA-256')
  }
  const coordinator = options?.coordinator
  if (
    !coordinator ||
    typeof coordinator.withIdentityExclusive !== 'function' ||
    typeof coordinator.withProjectReplicaExclusive !== 'function'
  ) {
    throw stateError('coordinator-unavailable', 'Material GC requires a cross-tab coordinator')
  }
  const withIdentityExclusive = coordinator.withIdentityExclusive.bind(coordinator)
  const withProjectReplicaExclusive = coordinator.withProjectReplicaExclusive.bind(coordinator)

  const read = key => {
    try {
      return storage.getItem(key)
    } catch (error) {
      throw stateError('storage-unavailable', 'Material GC local state could not be read', error)
    }
  }
  const write = (key, value) => {
    const serialized = canonicalJsonStringify(value)
    try {
      storage.setItem(key, serialized)
    } catch (error) {
      throw stateError('storage-unavailable', 'Material GC local state could not be persisted', error)
    }
    const durable = read(key)
    if (durable !== serialized) {
      throw stateError('storage-unavailable', 'Material GC local state did not round-trip durably')
    }
  }

  const projectIdentities = new Map()
  const createEmptyProjectState = (projectId, replicaId) =>
    cloneFrozen({
      schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
      stateVersion: DASHBOARD_MATERIAL_GC_PROJECT_STATE_VERSION,
      projectId,
      replicaId,
      replicaGeneration: 0,
      snapshotDigest: null,
      acceptedMaterialRefs: [],
      pendingPlanRequest: null,
      pendingSweepRequest: null,
      status: 'active',
    })

  const randomReplicaId = excluded => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const replicaId = requireReplicaId(crypto.randomUUID())
        if (replicaId !== excluded) return replicaId
      } catch (error) {
        throw stateError('crypto-unavailable', 'crypto.randomUUID did not return a valid UUID', error)
      }
    }
    throw stateError('crypto-unavailable', 'crypto.randomUUID did not rotate the project lifecycle identity')
  }

  const parseStoredProjectState = projectId => {
    const key = projectStorageKey(projectId)
    const serialized = read(key)
    if (serialized === null) return null
    try {
      const value = parseJson(serialized, 'Material GC project state')
      const replicaId = requireReplicaId(value?.replicaId)
      const normalized = normalizeProjectState(value, {
        projectId,
        replicaId,
      })
      if (normalized.migrated) write(key, normalized.state)
      return normalized.state
    } catch (error) {
      if (error instanceof DashboardMaterialGcReplicaStateError) throw error
      throw stateError('corrupt-state', 'Material GC project state is corrupt', error)
    }
  }

  const getProjectIdentity = (projectIdValue, requestOptions) => {
    const projectId = requireProjectId(projectIdValue)
    const cachedReplicaId = projectIdentities.get(projectId)
    if (cachedReplicaId) {
      return Promise.resolve(
        Object.freeze({ schemaVersion: MATERIAL_GC_SCHEMA_VERSION, projectId, replicaId: cachedReplicaId }),
      )
    }
    return withIdentityExclusive(() => {
      const cachedInsideLock = projectIdentities.get(projectId)
      if (cachedInsideLock) {
        return Object.freeze({ schemaVersion: MATERIAL_GC_SCHEMA_VERSION, projectId, replicaId: cachedInsideLock })
      }
      let state = parseStoredProjectState(projectId)
      if (state === null) {
        state = createEmptyProjectState(projectId, randomReplicaId())
        write(projectStorageKey(projectId), state)
      }
      projectIdentities.set(projectId, state.replicaId)
      return Object.freeze({ schemaVersion: MATERIAL_GC_SCHEMA_VERSION, projectId, replicaId: state.replicaId })
    }, requestOptions)
  }

  const beginNewProjectLifecycle = (projectIdValue, requestOptions) => {
    const projectId = requireProjectId(projectIdValue)
    return withIdentityExclusive(() => {
      const previous = parseStoredProjectState(projectId)
      if (previous === null || previous.status !== 'released') {
        throw stateError('state-conflict', 'A new Material GC lifecycle requires a released project tombstone')
      }
      const created = createEmptyProjectState(projectId, randomReplicaId(previous.replicaId))
      write(projectStorageKey(projectId), created)
      projectIdentities.set(projectId, created.replicaId)
      return created
    }, requestOptions)
  }

  const readProjectStateUnlocked = (projectId, replicaId) => {
    const state = parseStoredProjectState(projectId)
    if (state === null) throw stateError('state-conflict', 'Material GC project lifecycle disappeared')
    if (state.replicaId !== replicaId) {
      throw stateError('replica-rotated', 'Material GC project lifecycle rotated in another tab')
    }
    return state
  }

  const writeProjectStateUnlocked = state => {
    const normalized = normalizeProjectState(state, {
      projectId: state.projectId,
      replicaId: state.replicaId,
    }).state
    write(projectStorageKey(normalized.projectId), normalized)
    return normalized
  }

  const withProjectTransaction = async (projectIdValue, operation, requestOptions) => {
    const projectId = requireProjectId(projectIdValue)
    if (typeof operation !== 'function')
      throw new TypeError('Material GC project transaction operation must be a function')
    const { replicaId } = await getProjectIdentity(projectId, requestOptions)
    return withProjectReplicaExclusive(
      { projectId, replicaId },
      async () => {
        let active = true
        let state = readProjectStateUnlocked(projectId, replicaId)
        const requireActive = () => {
          if (!active) throw stateError('transaction-closed', 'Material GC project transaction is closed')
        }
        const requireWritable = () => {
          requireActive()
          if (state.status === 'released') throw stateError('replica-released', 'Material GC replica root was released')
        }
        const replaceState = next => {
          requireActive()
          state = writeProjectStateUnlocked(next)
          return state
        }
        const transaction = Object.freeze({
          getProjectState() {
            requireActive()
            return state
          },
          stagePlanRequest(requestValue) {
            requireWritable()
            const request = validateMaterialGcPlanRequest(requestValue)
            if (
              request.projectId !== projectId ||
              request.replicaId !== replicaId ||
              request.expectedReplicaGeneration !== state.replicaGeneration ||
              !containsEveryMaterialRef(request.materialRefs, state.acceptedMaterialRefs)
            ) {
              throw stateError('state-conflict', 'Material GC plan request does not match local replica generation')
            }
            if (state.pendingSweepRequest !== null) {
              throw stateError('state-conflict', 'A Material GC sweep request is already pending')
            }
            if (state.pendingPlanRequest !== null) {
              if (sameJson(state.pendingPlanRequest, request)) return state
              throw stateError('state-conflict', 'A different Material GC plan request is already pending')
            }
            return replaceState({ ...state, pendingPlanRequest: request })
          },
          async acknowledgePlan(requestValue, planValue) {
            requireWritable()
            const request = validateMaterialGcPlanRequest(requestValue)
            const plan = validateMaterialGcPlan(planValue)
            if (state.pendingPlanRequest === null || !sameJson(state.pendingPlanRequest, request)) {
              throw stateError('state-conflict', 'Material GC plan acknowledgement has no exact pending request')
            }
            const [requestDigest, planHash] = await Promise.all([
              hashContractJson(createMaterialGcPlanRequestDigestInput(request), crypto),
              hashContractJson(createMaterialGcPlanHashInput(plan), crypto),
            ])
            requireWritable()
            if (
              state.pendingPlanRequest === null ||
              !sameJson(state.pendingPlanRequest, request) ||
              plan.projectId !== request.projectId ||
              plan.replicaId !== request.replicaId ||
              plan.snapshotDigest !== request.snapshotDigest ||
              plan.replicaGeneration !== request.expectedReplicaGeneration + 1 ||
              plan.requestDigest !== requestDigest ||
              plan.planHash !== planHash
            ) {
              throw stateError(
                'state-conflict',
                'Material GC plan acknowledgement does not bind the exact pending request',
              )
            }
            return replaceState({
              ...state,
              replicaGeneration: plan.replicaGeneration,
              snapshotDigest: plan.snapshotDigest,
              acceptedMaterialRefs: mergeMaterialRefs(state.acceptedMaterialRefs, request.materialRefs),
              pendingPlanRequest: null,
              status: 'active',
            })
          },
          clearPendingPlan(requestValue) {
            requireWritable()
            const request = validateMaterialGcPlanRequest(requestValue)
            if (state.pendingPlanRequest === null) return state
            if (!sameJson(state.pendingPlanRequest, request)) {
              throw stateError('state-conflict', 'Material GC pending plan changed before it could be cleared')
            }
            return replaceState({ ...state, pendingPlanRequest: null })
          },
          stageSweepRequest(requestValue) {
            requireWritable()
            const request = validateMaterialGcSweepRequest(requestValue)
            const { plan } = request
            if (
              state.pendingPlanRequest !== null ||
              plan.projectId !== projectId ||
              plan.replicaId !== replicaId ||
              plan.replicaGeneration !== state.replicaGeneration ||
              plan.snapshotDigest !== state.snapshotDigest
            ) {
              throw stateError('state-conflict', 'Material GC sweep request does not match local replica generation')
            }
            if (state.pendingSweepRequest !== null) {
              if (sameJson(state.pendingSweepRequest, request)) return state
              throw stateError('state-conflict', 'A different Material GC sweep request is already pending')
            }
            return replaceState({ ...state, pendingSweepRequest: request })
          },
          acknowledgeSweep(requestValue, resultValue) {
            requireWritable()
            const request = validateMaterialGcSweepRequest(requestValue)
            const result = normalizeSweepResult(resultValue)
            if (state.pendingSweepRequest === null || !sameJson(state.pendingSweepRequest, request)) {
              throw stateError('state-conflict', 'Material GC sweep acknowledgement has no exact pending request')
            }
            if (
              result.planHash !== request.plan.planHash ||
              result.replicaGeneration !== request.plan.replicaGeneration ||
              result.registryGeneration < request.plan.registryGeneration
            ) {
              throw stateError('state-conflict', 'Material GC sweep acknowledgement does not match the pending plan')
            }
            const candidates = new Set(request.plan.deletionCandidates.map(identityKey))
            if (result.deletedMaterials.some(ref => !candidates.has(identityKey(ref)))) {
              throw stateError('state-conflict', 'Material GC sweep acknowledgement deleted a non-candidate material')
            }
            return replaceState({ ...state, pendingSweepRequest: null })
          },
          clearPendingSweep(requestValue) {
            requireWritable()
            const request = validateMaterialGcSweepRequest(requestValue)
            if (state.pendingSweepRequest === null) return state
            if (!sameJson(state.pendingSweepRequest, request)) {
              throw stateError('state-conflict', 'Material GC pending sweep changed before it could be cleared')
            }
            return replaceState({ ...state, pendingSweepRequest: null })
          },
          async commitRelease(requestValue, resultValue) {
            requireWritable()
            const request = validateMaterialGcReleaseRequest(requestValue)
            assertExactFields(
              resultValue,
              [
                'projectId',
                'registryGeneration',
                'replicaGeneration',
                'replicaId',
                'requestDigest',
                'schemaVersion',
                'status',
              ],
              'material-gc-release-result',
            )
            const requestDigest = await hashContractJson(createMaterialGcReleaseRequestDigestInput(request), crypto)
            requireWritable()
            if (
              state.pendingPlanRequest !== null ||
              state.pendingSweepRequest !== null ||
              request.replicaId !== state.replicaId ||
              request.expectedReplicaGeneration !== state.replicaGeneration ||
              request.snapshotDigest !== state.snapshotDigest ||
              resultValue.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION ||
              resultValue.status !== 'released' ||
              resultValue.projectId !== request.projectId ||
              resultValue.replicaId !== request.replicaId ||
              !Number.isSafeInteger(resultValue.replicaGeneration) ||
              resultValue.replicaGeneration !== state.replicaGeneration + 1 ||
              typeof resultValue.requestDigest !== 'string' ||
              resultValue.requestDigest !== requestDigest ||
              !Number.isSafeInteger(resultValue.registryGeneration) ||
              resultValue.registryGeneration <= 0
            ) {
              throw stateError('state-conflict', 'Material GC release acknowledgement is invalid')
            }
            return replaceState({
              ...state,
              replicaGeneration: resultValue.replicaGeneration,
              acceptedMaterialRefs: [],
              pendingPlanRequest: null,
              pendingSweepRequest: null,
              status: 'released',
            })
          },
        })
        try {
          return await operation(transaction)
        } finally {
          active = false
        }
      },
      requestOptions,
    )
  }

  const wrap =
    (method, projectIdOf = request => request.projectId) =>
    (request, ...values) =>
      withProjectTransaction(projectIdOf(request), transaction => transaction[method](request, ...values))
  const sweepProjectId = request => request?.plan?.projectId

  return Object.freeze({
    getProjectIdentity,
    beginNewProjectLifecycle,
    getProjectState: projectId => withProjectTransaction(projectId, transaction => transaction.getProjectState()),
    withProjectTransaction,
    stagePlanRequest: wrap('stagePlanRequest'),
    acknowledgePlan: wrap('acknowledgePlan'),
    clearPendingPlan: wrap('clearPendingPlan'),
    stageSweepRequest: wrap('stageSweepRequest', sweepProjectId),
    acknowledgeSweep: wrap('acknowledgeSweep', sweepProjectId),
    clearPendingSweep: wrap('clearPendingSweep', sweepProjectId),
    commitRelease: wrap('commitRelease'),
  })
}
