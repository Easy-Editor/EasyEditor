import { createHash, randomUUID } from 'node:crypto'
import { constants as fileSystemConstants } from 'node:fs'
import * as nodeFileSystem from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  createMaterialGcPlanHashInput,
  createMaterialGcPlanRequestDigestInput,
  createMaterialGcReleaseRequestDigestInput,
  validateMaterialGcPlan,
  validateMaterialGcPlanRequest,
  validateMaterialGcReleaseRequest,
  validateMaterialGcSweepRequest,
} from '../../shared/material-gc-contract.mjs'
import {
  createMaterialPromotionBinding,
  validateMaterialIdentity,
  validateMaterialPromotionRequest,
} from '../../shared/material-promotion-contract.mjs'
import { MaterialRegistryError, normalizeRegistryError, registryError } from './errors.mjs'

const REGISTRY_SCHEMA_VERSION = 1
const REGISTRY_INDEX_SCHEMA_VERSION = 2
const REGISTRY_BACKUP_SCHEMA_VERSION = 2
const STAGED_MANIFEST_NAME = 'staged.json'
const PUBLISHED_MANIFEST_NAME = 'published.json'
const BACKUP_MANIFEST_NAME = 'backup-manifest.json'
const PROMOTIONS_DIRECTORY_NAME = 'promotions'
const TRASH_DIRECTORY_NAME = 'trash'
const LOCK_FILE_NAME = '.registry.lock'
const FENCE_FILE_NAME = '.registry-fence.json'
const INDEX_FILE_NAME = 'registry-index.json'
const STREAM_CHUNK_BYTES = 64 * 1024
const REGISTRY_SCAN_MAX_ATTEMPTS = 4
const ROOT_ATOMIC_TEMPORARY_PATTERNS = Object.freeze([
  /^\.registry-fence\.json\.\d+\.[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.tmp$/u,
  /^\.registry-index\.json\.\d+\.[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.tmp$/u,
])
const PROMOTION_ATOMIC_TEMPORARY_PATTERNS = Object.freeze([
  /^\.published\.json\.\d+\.[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.tmp$/u,
])
const DEFAULT_LEASE = Object.freeze({
  acquireTimeoutMs: 2_000,
  heartbeatMs: 5_000,
  staleAfterMs: 30_000,
})
const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024,
  maxFiles: 512,
  maxTotalBytes: 64 * 1024 * 1024,
})

const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const cloneJson = value => JSON.parse(JSON.stringify(value))
const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))

const throwIfAborted = signal => {
  if (signal?.aborted) {
    throw registryError('promotion-aborted', 'Local material promotion was aborted', {
      status: 408,
      retryable: true,
    })
  }
}

const exactObject = (value, fields) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

const normalizeFailure = error => {
  if (error instanceof MaterialRegistryError) return error
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof error.code === 'string' &&
    typeof error.status === 'number'
  ) {
    return error
  }
  return normalizeRegistryError(error)
}

const throwFailure = error => {
  throw normalizeFailure(error)
}

const requireObject = (value, fields, label) => {
  if (!exactObject(value, fields)) {
    throw registryError('registry-corrupt', `${label} does not match the registry schema`, { status: 500 })
  }
  return value
}

const requireDirectoryPath = (value, label) => {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw registryError('invalid-request', `${label} must be a non-empty filesystem path`, { status: 400 })
  }
  return resolve(value)
}

const requirePromotionId = value => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw registryError('invalid-request', 'promotionId must be a bounded non-empty string', { status: 400 })
  }
  return value
}

const requireLeaseNumber = (value, fallback, label) => {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw registryError('invalid-request', `${label} must be a positive safe integer`, { status: 400 })
  }
  return result
}

const normalizeLease = lease => {
  const result = {
    acquireTimeoutMs: requireLeaseNumber(
      lease?.acquireTimeoutMs,
      DEFAULT_LEASE.acquireTimeoutMs,
      'lease.acquireTimeoutMs',
    ),
    heartbeatMs: requireLeaseNumber(lease?.heartbeatMs, DEFAULT_LEASE.heartbeatMs, 'lease.heartbeatMs'),
    staleAfterMs: requireLeaseNumber(lease?.staleAfterMs, DEFAULT_LEASE.staleAfterMs, 'lease.staleAfterMs'),
  }
  if (result.heartbeatMs >= result.staleAfterMs) {
    throw registryError('invalid-request', 'lease.heartbeatMs must be less than lease.staleAfterMs', { status: 400 })
  }
  return Object.freeze(result)
}

const normalizeLimits = limits =>
  Object.freeze({
    maxFiles: requireLeaseNumber(limits?.maxFiles ?? limits?.maxFileCount, DEFAULT_LIMITS.maxFiles, 'limits.maxFiles'),
    maxFileBytes: requireLeaseNumber(limits?.maxFileBytes, DEFAULT_LIMITS.maxFileBytes, 'limits.maxFileBytes'),
    maxTotalBytes: requireLeaseNumber(limits?.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes, 'limits.maxTotalBytes'),
  })

const identityKey = identity => `${identity.materialId}\0${identity.materialVersion}\0${identity.buildIntegrity}`
const storageKeyForPromotion = promotionId => sha256(promotionId).slice('sha256:'.length)
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const confinedPath = (rootDirectory, candidatePath) => {
  const pathFromRoot = relative(rootDirectory, candidatePath)
  return (
    pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  )
}

const stagedRecord = binding => Object.freeze({ ...cloneJson(binding), state: 'manifest-staged' })
const publishedRecord = binding => Object.freeze({ ...cloneJson(binding), state: 'active' })
const bindingFromRecord = record => {
  const { state: _state, ...binding } = record
  return createMaterialPromotionBinding({ ...binding, buildDirectory: 'registry-record' })
}

const validateBinding = value => {
  const request = validateMaterialPromotionRequest({ ...value, buildDirectory: 'registry-internal-build' })
  return createMaterialPromotionBinding(request)
}

const parseStagedManifest = value => {
  requireObject(value, ['binding', 'kind', 'schemaVersion'], 'staged manifest')
  if (value.schemaVersion !== REGISTRY_SCHEMA_VERSION || value.kind !== 'staged') {
    throw registryError('registry-corrupt', 'Staged manifest has an unsupported schema', { status: 500 })
  }
  return validateBinding(value.binding)
}

const parsePublishedManifest = value => {
  requireObject(value, ['binding', 'kind', 'schemaVersion'], 'published manifest')
  if (value.schemaVersion !== REGISTRY_SCHEMA_VERSION || value.kind !== 'published') {
    throw registryError('registry-corrupt', 'Published manifest has an unsupported schema', { status: 500 })
  }
  return validateBinding(value.binding)
}

const parseBackupMaterials = materials => {
  if (!Array.isArray(materials)) {
    throw registryError('backup-invalid', 'Backup manifest materials must be an array', { status: 400 })
  }
  const promotionIds = new Set()
  const storageKeys = new Set()
  const identities = new Set()
  return materials.map(entry => {
    requireObject(entry, ['binding', 'storageKey'], 'backup material')
    const binding = validateBinding(entry.binding)
    if (entry.storageKey !== storageKeyForPromotion(binding.promotionId)) {
      throw registryError('backup-invalid', 'Backup material storage key does not match its promotionId', {
        status: 400,
      })
    }
    const durableIdentity = identityKey(binding)
    if (promotionIds.has(binding.promotionId) || storageKeys.has(entry.storageKey) || identities.has(durableIdentity)) {
      throw registryError('backup-invalid', 'Backup manifest contains a duplicate material identity', { status: 400 })
    }
    promotionIds.add(binding.promotionId)
    storageKeys.add(entry.storageKey)
    identities.add(durableIdentity)
    return { binding, storageKey: entry.storageKey }
  })
}

const parseBackupManifest = value => {
  if (value?.schemaVersion === REGISTRY_SCHEMA_VERSION) {
    requireObject(value, ['createdAt', 'kind', 'materials', 'schemaVersion'], 'backup manifest')
    if (value.kind !== 'material-registry-backup' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
      throw registryError('backup-invalid', 'Backup manifest has an unsupported schema', { status: 400 })
    }
    return Object.freeze({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      entries: parseBackupMaterials(value.materials),
      gcState: null,
      sourceGeneration: null,
      sourceSnapshotHash: null,
    })
  }
  requireObject(
    value,
    [
      'createdAt',
      'gcState',
      'gcStateHash',
      'kind',
      'materials',
      'schemaVersion',
      'sourceGeneration',
      'sourceSnapshotHash',
    ],
    'backup manifest',
  )
  if (
    value.schemaVersion !== REGISTRY_BACKUP_SCHEMA_VERSION ||
    value.kind !== 'material-registry-backup' ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    !Number.isSafeInteger(value.sourceGeneration) ||
    value.sourceGeneration <= 0 ||
    typeof value.sourceSnapshotHash !== 'string' ||
    !/^sha256:[\da-f]{64}$/u.test(value.sourceSnapshotHash) ||
    typeof value.gcStateHash !== 'string' ||
    !/^sha256:[\da-f]{64}$/u.test(value.gcStateHash)
  ) {
    throw registryError('backup-invalid', 'Backup manifest has an unsupported schema', { status: 400 })
  }
  let gcState
  try {
    gcState = normalizeGcState(value.gcState)
  } catch {
    throw registryError('backup-invalid', 'Backup GC state is invalid', { status: 400 })
  }
  if (
    sha256(
      JSON.stringify({
        sourceGeneration: value.sourceGeneration,
        sourceSnapshotHash: value.sourceSnapshotHash,
        gcState,
      }),
    ) !== value.gcStateHash
  ) {
    throw registryError('backup-invalid', 'Backup GC state hash does not match its durable roots', { status: 400 })
  }
  return Object.freeze({
    schemaVersion: REGISTRY_BACKUP_SCHEMA_VERSION,
    entries: parseBackupMaterials(value.materials),
    gcState,
    sourceGeneration: value.sourceGeneration,
    sourceSnapshotHash: value.sourceSnapshotHash,
  })
}

const sortRecords = records =>
  [...records].sort((left, right) =>
    [left.projectId, left.materialId, left.materialVersion, left.buildIntegrity, left.promotionId]
      .join('\0')
      .localeCompare(
        [right.projectId, right.materialId, right.materialVersion, right.buildIntegrity, right.promotionId].join('\0'),
      ),
  )

const sortIdentities = identities =>
  [...identities].sort((left, right) => identityKey(left).localeCompare(identityKey(right)))

const normalizeRetainedMaterialRefs = value => {
  if (!Array.isArray(value)) {
    throw registryError('invalid-request', 'retainedMaterialRefs must be an array', { status: 400 })
  }
  const identities = sortIdentities(value.map(validateMaterialIdentity))
  const seen = new Set()
  for (const identity of identities) {
    const key = identityKey(identity)
    if (seen.has(key)) {
      throw registryError('invalid-request', 'retainedMaterialRefs must not contain duplicates', { status: 400 })
    }
    seen.add(key)
  }
  return identities
}

const gcIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u
const gcDigestPattern = /^sha256:[\da-f]{64}$/u

const requireGcIdentifier = (value, label) => {
  if (typeof value !== 'string' || !gcIdentifierPattern.test(value)) {
    throw registryError('invalid-request', `${label} must be a bounded identifier`, { status: 400 })
  }
  return value
}

const requireGcDigest = (value, label) => {
  if (typeof value !== 'string' || !gcDigestPattern.test(value)) {
    throw registryError('invalid-request', `${label} must be a sha256 digest`, { status: 400 })
  }
  return value
}

const requireGcGeneration = (value, label) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw registryError('invalid-request', `${label} must be a positive safe integer`, { status: 400 })
  }
  return value
}

const normalizePrincipal = value => {
  if (!exactObject(value, ['tenantId', 'userId'])) {
    throw registryError('invalid-request', 'trusted principal must contain tenantId and userId', { status: 400 })
  }
  return Object.freeze({
    tenantId: requireGcIdentifier(value.tenantId, 'principal.tenantId'),
    userId: requireGcIdentifier(value.userId, 'principal.userId'),
  })
}

const rootKey = root => [root.tenantId, root.userId, root.projectId, root.replicaId].join('\0')
const rootKeyDigest = root => sha256(rootKey(root))

const normalizeResolvedPromotions = value => {
  if (!Array.isArray(value) || value.length > 4096) {
    throw registryError('invalid-request', 'resolvedPromotions must be a bounded array', { status: 400 })
  }
  const resolved = value
    .map(entry => {
      if (!exactObject(entry, ['materialRef', 'promotionId'])) {
        throw registryError('invalid-request', 'resolved promotion does not match its schema', { status: 400 })
      }
      return Object.freeze({
        promotionId: requireGcDigest(entry.promotionId, 'resolvedPromotions.promotionId'),
        materialRef: validateMaterialIdentity(entry.materialRef),
      })
    })
    .sort((left, right) => left.promotionId.localeCompare(right.promotionId))
  if (resolved.some((entry, index) => index > 0 && entry.promotionId === resolved[index - 1].promotionId)) {
    throw registryError('invalid-request', 'resolvedPromotions must not contain duplicates', { status: 400 })
  }
  return Object.freeze(resolved)
}

const normalizeUnresolvedPromotionIds = value => {
  if (!Array.isArray(value) || value.length > 4096) {
    throw registryError('invalid-request', 'unresolvedPromotionIds must be a bounded array', { status: 400 })
  }
  const result = value.map(id => requireGcDigest(id, 'unresolvedPromotionIds entry')).sort()
  if (result.some((id, index) => index > 0 && id === result[index - 1])) {
    throw registryError('invalid-request', 'unresolvedPromotionIds must not contain duplicates', { status: 400 })
  }
  return Object.freeze(result)
}

const normalizeReplicaRoot = value => {
  requireObject(
    value,
    [
      'acceptedRequestDigest',
      'materialRefs',
      'projectId',
      'releasedAt',
      'replicaGeneration',
      'replicaId',
      'resolvedPromotions',
      'snapshotDigest',
      'state',
      'tenantId',
      'unresolvedPromotionIds',
      'updatedAt',
      'userId',
    ],
    'replica root',
  )
  if (!['active', 'released'].includes(value.state)) {
    throw registryError('invalid-request', 'replica root state is invalid', { status: 400 })
  }
  if (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) {
    throw registryError('invalid-request', 'replica root updatedAt is invalid', { status: 400 })
  }
  if (value.releasedAt !== null && (!Number.isSafeInteger(value.releasedAt) || value.releasedAt < 0)) {
    throw registryError('invalid-request', 'replica root releasedAt is invalid', { status: 400 })
  }
  const root = {
    tenantId: requireGcIdentifier(value.tenantId, 'replicaRoot.tenantId'),
    userId: requireGcIdentifier(value.userId, 'replicaRoot.userId'),
    projectId: requireGcIdentifier(value.projectId, 'replicaRoot.projectId'),
    replicaId: requireGcIdentifier(value.replicaId, 'replicaRoot.replicaId'),
    state: value.state,
    replicaGeneration: requireGcGeneration(value.replicaGeneration, 'replicaRoot.replicaGeneration'),
    acceptedRequestDigest: requireGcDigest(value.acceptedRequestDigest, 'replicaRoot.acceptedRequestDigest'),
    snapshotDigest: requireGcDigest(value.snapshotDigest, 'replicaRoot.snapshotDigest'),
    materialRefs: normalizeRetainedMaterialRefs(value.materialRefs),
    unresolvedPromotionIds: normalizeUnresolvedPromotionIds(value.unresolvedPromotionIds),
    resolvedPromotions: normalizeResolvedPromotions(value.resolvedPromotions),
    updatedAt: value.updatedAt,
    releasedAt: value.releasedAt,
  }
  if (root.state === 'active' && root.releasedAt !== null) {
    throw registryError('invalid-request', 'active replica root must not have releasedAt', { status: 400 })
  }
  if (
    root.state === 'released' &&
    (root.releasedAt === null ||
      root.materialRefs.length !== 0 ||
      root.unresolvedPromotionIds.length !== 0 ||
      root.resolvedPromotions.length !== 0)
  ) {
    throw registryError('invalid-request', 'released replica root must be an empty tombstone', { status: 400 })
  }
  return Object.freeze(root)
}

const normalizeReplicaRoots = value => {
  if (!Array.isArray(value) || value.length > 16384) {
    throw registryError('invalid-request', 'replicaRoots must be a bounded array', { status: 400 })
  }
  const roots = value.map(normalizeReplicaRoot).sort((left, right) => rootKey(left).localeCompare(rootKey(right)))
  if (roots.some((root, index) => index > 0 && rootKey(root) === rootKey(roots[index - 1]))) {
    throw registryError('invalid-request', 'replicaRoots must not contain duplicate authorities', { status: 400 })
  }
  return Object.freeze(roots)
}

const normalizeGcState = value => {
  requireObject(value, ['legacyRetainedMaterialRefs', 'replicaRoots'], 'registry GC state')
  return Object.freeze({
    legacyRetainedMaterialRefs: Object.freeze(normalizeRetainedMaterialRefs(value.legacyRetainedMaterialRefs)),
    replicaRoots: normalizeReplicaRoots(value.replicaRoots),
  })
}

const activeRootMaterialRefs = root => [
  ...root.materialRefs,
  ...root.resolvedPromotions.map(resolution => resolution.materialRef),
]

const retainedMaterialRefsForGcState = gcState => {
  const refs = new Map(gcState.legacyRetainedMaterialRefs.map(ref => [identityKey(ref), ref]))
  for (const root of gcState.replicaRoots) {
    if (root.state !== 'active') continue
    for (const ref of activeRootMaterialRefs(root)) refs.set(identityKey(ref), ref)
  }
  return sortIdentities(refs.values())
}

export const createFileMaterialRegistry = async (options = {}) => {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const checkpoint = typeof options.checkpoint === 'function' ? options.checkpoint : async () => undefined
  const now = typeof options.now === 'function' ? options.now : Date.now
  const lease = normalizeLease(options.lease)
  const limits = normalizeLimits(options.limits ?? options.budgets)
  const configuredRoot =
    options.rootDir ??
    process.env.EASY_EDITOR_MATERIAL_REGISTRY_DIR ??
    join(process.cwd(), '.easy-editor-data', 'materials')
  const rootDir = requireDirectoryPath(configuredRoot, 'rootDir')
  const workspaceRoot = requireDirectoryPath(
    options.workspaceRoot ?? process.env.EASY_EDITOR_MATERIAL_PROMOTION_WORKSPACE_DIR ?? dirname(rootDir),
    'workspaceRoot',
  )
  const promotionsDirectory = join(rootDir, PROMOTIONS_DIRECTORY_NAME)
  const trashDirectory = join(rootDir, TRASH_DIRECTORY_NAME)
  const lockPath = join(rootDir, LOCK_FILE_NAME)
  const fencePath = join(rootDir, FENCE_FILE_NAME)
  const indexPath = join(rootDir, INDEX_FILE_NAME)
  const registryId = sha256(rootDir)
  const localHostname = hostname()
  let queueTail = Promise.resolve()
  let materialIndex = new Map()
  let pendingIndex = new Map()
  let activeLease = null
  let physicalRegistryRoot = null
  let physicalWorkspaceRoot = null
  let verifyMutationLease = async () => undefined

  const callCheckpoint = async (name, details = undefined) => {
    await checkpoint(details === undefined ? { name } : { name, ...details })
  }

  const assertBuildBudgets = binding => {
    if (binding.files.length > limits.maxFiles) {
      throw registryError('registry-budget-exceeded', 'Build contains too many files', { status: 413 })
    }
    let totalBytes = 0
    for (const file of binding.files) {
      if (file.byteLength > limits.maxFileBytes) {
        throw registryError('registry-budget-exceeded', `Build file ${file.path} exceeds the per-file byte budget`, {
          status: 413,
        })
      }
      totalBytes += file.byteLength
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
        throw registryError('registry-budget-exceeded', 'Build exceeds the total byte budget', { status: 413 })
      }
    }
  }

  const enqueue = operation => {
    const result = queueTail.then(operation, operation)
    queueTail = result.catch(() => undefined)
    return result
  }

  const lstatOrNull = async path => {
    try {
      return await fileSystem.lstat(path)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  const assertDirectory = async (path, label) => {
    const stats = await lstatOrNull(path)
    if (!stats) {
      throw registryError('registry-record-not-found', `${label} does not exist`, { status: 404 })
    }
    if (stats.isSymbolicLink()) {
      throw registryError('registry-symlink-disallowed', `${label} must not be a symbolic link`, { status: 400 })
    }
    if (!stats.isDirectory()) {
      throw registryError('registry-path-invalid', `${label} must be a directory`, { status: 400 })
    }
    return stats
  }

  const ensureDirectory = async path => {
    const absolutePath = resolve(path)
    const missing = []
    let cursor = absolutePath
    while (true) {
      const stats = await lstatOrNull(cursor)
      if (stats) {
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw registryError(
            stats.isSymbolicLink() ? 'registry-symlink-disallowed' : 'registry-path-invalid',
            `Directory ${cursor} is not a confined directory`,
            { status: 400 },
          )
        }
        break
      }
      missing.push(cursor)
      const parent = dirname(cursor)
      if (parent === cursor) {
        throw registryError('registry-path-invalid', `Directory ${absolutePath} has no existing ancestor`, {
          status: 400,
        })
      }
      cursor = parent
    }

    const created = []
    for (const directory of missing.reverse()) {
      await verifyMutationLease()
      try {
        await fileSystem.mkdir(directory, { mode: 0o700 })
        await verifyMutationLease()
        await fileSystem.chmod(directory, 0o700)
        created.push(directory)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      await assertDirectory(directory, 'registry directory')
    }
    for (const directory of [...created].reverse()) await syncDirectory(directory)
    if (created.length > 0) await syncDirectory(dirname(created[0]))
    return created
  }

  const syncDirectory = async path => {
    let handle
    try {
      handle = await fileSystem.open(path, 'r')
      await handle.sync()
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error?.code)) throw error
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  const writeDurableFile = async (path, bytes) => {
    await verifyMutationLease()
    const handle = await fileSystem.open(path, 'wx', 0o600)
    try {
      await verifyMutationLease()
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  const cleanupTemporaryPath = async (path, options = { force: true }) => {
    try {
      await verifyMutationLease()
      await fileSystem.rm(path, options)
    } catch {
      // Recovery owns orphan cleanup if the lease or filesystem becomes unavailable.
    }
  }

  const writeAtomicJson = async ({ path, value, beforeRename, afterRename }) => {
    const parentDirectory = dirname(path)
    const temporaryPath = join(parentDirectory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await writeDurableFile(temporaryPath, `${JSON.stringify(value)}\n`)
      await syncDirectory(parentDirectory)
      if (beforeRename) await beforeRename()
      await verifyMutationLease()
      await fileSystem.rename(temporaryPath, path)
      await syncDirectory(parentDirectory)
      if (afterRename) await afterRename()
    } catch (error) {
      await cleanupTemporaryPath(temporaryPath)
      throw error
    }
  }

  const readJson = async path => {
    let handle
    try {
      const stats = await lstatOrNull(path)
      if (!stats) return null
      if (stats.isSymbolicLink()) {
        throw registryError('registry-symlink-disallowed', `Registry JSON ${basename(path)} is a symbolic link`, {
          status: 400,
        })
      }
      if (!stats.isFile()) {
        throw registryError('registry-corrupt', `Registry JSON ${basename(path)} is not a regular file`, {
          status: 500,
        })
      }
      if (stats.nlink !== 1) {
        throw registryError('registry-hardlink-disallowed', `Registry JSON ${basename(path)} must not be hardlinked`, {
          status: 400,
        })
      }
      handle = await fileSystem.open(path, fileSystemConstants.O_RDONLY | (fileSystemConstants.O_NOFOLLOW ?? 0))
      const openedStats = await handle.stat()
      if (
        !openedStats.isFile() ||
        openedStats.dev !== stats.dev ||
        openedStats.ino !== stats.ino ||
        openedStats.nlink !== 1
      ) {
        throw registryError('registry-source-changed', `Registry JSON ${basename(path)} changed while opening`, {
          status: 409,
          retryable: true,
        })
      }
      return JSON.parse(await handle.readFile('utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      if (error instanceof SyntaxError) {
        throw registryError('registry-corrupt', `Registry JSON is invalid at ${basename(path)}`, { status: 500 })
      }
      throw error
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  const assertConfinedDirectoryChain = async (rootDirectory, relativeDirectoryPath) => {
    let currentPath = rootDirectory
    for (const segment of relativeDirectoryPath.split('/')) {
      currentPath = join(currentPath, segment)
      const stats = await lstatOrNull(currentPath)
      if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) {
        throw registryError(
          stats?.isSymbolicLink() ? 'registry-symlink-disallowed' : 'registry-path-invalid',
          `Directory ${relativeDirectoryPath} is not confined to its declared root`,
          { status: 400 },
        )
      }
    }
    return currentPath
  }

  const assertTrustedBuildDirectory = async buildDirectory => {
    if (!confinedPath(workspaceRoot, buildDirectory)) {
      throw registryError('registry-workspace-escape', 'Build directory escapes the trusted author workspace', {
        status: 400,
      })
    }
    const relativeBuildDirectory = relative(workspaceRoot, buildDirectory)
    await assertConfinedDirectoryChain(workspaceRoot, relativeBuildDirectory)
    let physicalBuildDirectory
    try {
      physicalBuildDirectory = await fileSystem.realpath(buildDirectory)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw registryError('registry-record-not-found', 'Build directory does not exist', { status: 404 })
      }
      throw error
    }
    if (!physicalWorkspaceRoot || !confinedPath(physicalWorkspaceRoot, physicalBuildDirectory)) {
      throw registryError('registry-workspace-escape', 'Build directory escapes the physical author workspace', {
        status: 400,
      })
    }
    if (
      physicalRegistryRoot &&
      (confinedPath(physicalRegistryRoot, physicalBuildDirectory) ||
        confinedPath(physicalBuildDirectory, physicalRegistryRoot))
    ) {
      throw registryError('registry-workspace-conflict', 'Build directory must not overlap the material registry', {
        status: 400,
      })
    }
    return physicalBuildDirectory
  }

  const assertNoSymlinkSegments = async (rootDirectory, relativeFilePath) => {
    const segments = relativeFilePath.split('/')
    let currentPath = rootDirectory
    for (const [index, segment] of segments.entries()) {
      currentPath = join(currentPath, segment)
      const stats = await lstatOrNull(currentPath)
      if (!stats) {
        throw registryError('registry-record-not-found', `Build file ${relativeFilePath} does not exist`, {
          status: 404,
        })
      }
      if (stats.isSymbolicLink()) {
        throw registryError('registry-symlink-disallowed', `Build file ${relativeFilePath} crosses a symbolic link`, {
          status: 400,
        })
      }
      if (index < segments.length - 1 && !stats.isDirectory()) {
        throw registryError('registry-path-invalid', `Build path ${relativeFilePath} crosses a non-directory`, {
          status: 400,
        })
      }
      if (index === segments.length - 1 && !stats.isFile()) {
        throw registryError('registry-path-invalid', `Build path ${relativeFilePath} is not a regular file`, {
          status: 400,
        })
      }
    }
    return currentPath
  }

  const streamConfinedFile = async (directory, file, destinationPath, mismatchCode, signal) => {
    throwIfAborted(signal)
    const sourcePath = await assertNoSymlinkSegments(directory, file.path)
    if (!confinedPath(directory, sourcePath)) {
      throw registryError('registry-path-escape', `Build file ${file.path} escapes its build directory`, {
        status: 400,
      })
    }
    const pathStats = await fileSystem.lstat(sourcePath)
    if (!pathStats.isFile() || pathStats.isSymbolicLink() || pathStats.nlink !== 1) {
      throw registryError('registry-hardlink-disallowed', `Build file ${file.path} must be a unique regular file`, {
        status: 400,
      })
    }
    if (pathStats.size !== file.byteLength) {
      throw registryError(mismatchCode, `Build file ${file.path} does not match its declared byte length`, {
        status: 409,
      })
    }
    const sourceHandle = await fileSystem.open(
      sourcePath,
      fileSystemConstants.O_RDONLY | (fileSystemConstants.O_NOFOLLOW ?? 0),
    )
    let destinationHandle
    try {
      const openedStats = await sourceHandle.stat()
      if (
        !openedStats.isFile() ||
        openedStats.dev !== pathStats.dev ||
        openedStats.ino !== pathStats.ino ||
        openedStats.nlink !== 1
      ) {
        throw registryError('registry-source-changed', `Build file ${file.path} changed before it was opened`, {
          status: 409,
          retryable: true,
        })
      }
      if (destinationPath) {
        await verifyMutationLease()
        destinationHandle = await fileSystem.open(destinationPath, 'wx', 0o600)
      }
      const hash = createHash('sha256')
      const buffer = Buffer.allocUnsafe(Math.min(STREAM_CHUNK_BYTES, Math.max(1, file.byteLength)))
      let position = 0
      while (position < file.byteLength) {
        throwIfAborted(signal)
        const length = Math.min(buffer.byteLength, file.byteLength - position)
        const { bytesRead } = await sourceHandle.read(buffer, 0, length, position)
        if (bytesRead === 0) break
        const chunk = buffer.subarray(0, bytesRead)
        hash.update(chunk)
        if (destinationHandle) {
          let written = 0
          while (written < bytesRead) {
            await verifyMutationLease()
            const { bytesWritten } = await destinationHandle.write(
              chunk,
              written,
              bytesRead - written,
              position + written,
            )
            if (bytesWritten === 0) {
              throw registryError('registry-unavailable', `Could not persist build file ${file.path}`, {
                status: 503,
                retryable: true,
              })
            }
            written += bytesWritten
          }
        }
        position += bytesRead
      }
      const extra = Buffer.allocUnsafe(1)
      const { bytesRead: extraBytes } = await sourceHandle.read(extra, 0, 1, position)
      const after = await sourceHandle.stat()
      if (
        openedStats.dev !== after.dev ||
        openedStats.ino !== after.ino ||
        after.nlink !== 1 ||
        openedStats.size !== after.size ||
        openedStats.mtimeMs !== after.mtimeMs
      ) {
        throw registryError('registry-source-changed', `Build file ${file.path} changed while it was staged`, {
          status: 409,
          retryable: true,
        })
      }
      const integrity = `sha256:${hash.digest('hex')}`
      if (position !== file.byteLength || extraBytes !== 0 || integrity !== file.integrity) {
        throw registryError(mismatchCode, `Build file ${file.path} does not match its declared integrity`, {
          status: 409,
        })
      }
      if (destinationHandle) await destinationHandle.sync()
    } catch (error) {
      await destinationHandle?.close().catch(() => undefined)
      destinationHandle = null
      if (destinationPath) await cleanupTemporaryPath(destinationPath)
      throw error
    } finally {
      await destinationHandle?.close().catch(() => undefined)
      await sourceHandle.close()
    }
  }

  const verifyOrCopyBuild = async (
    buildDirectory,
    binding,
    { destinationBuildDirectory, mismatchCode = 'integrity-mismatch', signal } = {},
  ) => {
    throwIfAborted(signal)
    assertBuildBudgets(binding)
    await assertDirectory(buildDirectory, 'build directory')
    const entry = binding.files.find(file => file.path === binding.entryFile)
    const directories = new Set()
    if (destinationBuildDirectory) {
      await ensureDirectory(destinationBuildDirectory)
      directories.add(destinationBuildDirectory)
    }
    for (const file of binding.files) {
      let destinationPath
      if (destinationBuildDirectory) {
        destinationPath = join(destinationBuildDirectory, ...file.path.split('/'))
        const parentDirectory = dirname(destinationPath)
        await ensureDirectory(parentDirectory)
        directories.add(parentDirectory)
      }
      try {
        await streamConfinedFile(buildDirectory, file, destinationPath, mismatchCode, signal)
      } catch (error) {
        if (error?.code === 'integrity-mismatch' && mismatchCode !== 'integrity-mismatch') {
          throw registryError(mismatchCode, `Build file ${file.path} failed backup verification`, { status: 409 })
        }
        throw error
      }
    }
    if (!entry || entry.integrity !== binding.buildIntegrity) {
      throw registryError(mismatchCode, 'Entry file integrity does not match buildIntegrity', { status: 409 })
    }
    for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
      await syncDirectory(directory)
    }
  }

  const leaseContents = (token, fence = null) => ({
    fence,
    hostname: localHostname,
    pid: process.pid,
    token,
  })

  const leaseLostError = cause =>
    registryError('registry-lease-lost', 'Material registry lease ownership was lost', {
      status: 409,
      retryable: true,
      details: cause instanceof Error ? { cause: cause.message } : undefined,
    })

  const readFence = async () => {
    const value = await readJson(fencePath)
    if (value === null) return 0
    if (
      !exactObject(value, ['fence', 'kind', 'schemaVersion']) ||
      value.schemaVersion !== REGISTRY_SCHEMA_VERSION ||
      value.kind !== 'registry-fence' ||
      !Number.isSafeInteger(value.fence) ||
      value.fence < 0
    ) {
      throw registryError('registry-corrupt', 'Registry fence record is invalid', { status: 500 })
    }
    return value.fence
  }

  const writeNextFence = async context => {
    const currentFence = await readFence()
    if (currentFence >= Number.MAX_SAFE_INTEGER) {
      throw registryError('registry-unavailable', 'Registry fence counter is exhausted', { status: 503 })
    }
    const nextFence = currentFence + 1
    const temporaryPath = join(rootDir, `${FENCE_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await writeDurableFile(
        temporaryPath,
        `${JSON.stringify({
          schemaVersion: REGISTRY_SCHEMA_VERSION,
          kind: 'registry-fence',
          fence: nextFence,
        })}\n`,
      )
      const currentStats = await lstatOrNull(lockPath)
      const ownedStats = await context.handle.stat()
      if (!currentStats || currentStats.dev !== ownedStats.dev || currentStats.ino !== ownedStats.ino) {
        throw leaseLostError()
      }
      await callCheckpoint('before-registry-fence-rename', { fence: nextFence })
      await fileSystem.rename(temporaryPath, fencePath)
      await syncDirectory(rootDir)
      return nextFence
    } catch (error) {
      await fileSystem.rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  const tryReclaimStaleLease = async () => {
    const firstStats = await lstatOrNull(lockPath)
    if (!firstStats) return true
    if (firstStats.isSymbolicLink()) {
      throw registryError('registry-symlink-disallowed', 'Registry lease must not be a symbolic link', { status: 400 })
    }
    const heartbeatAt = firstStats.mtimeMs
    let ownerPid = null
    let ownerHostname = null
    try {
      const value = JSON.parse(await fileSystem.readFile(lockPath, 'utf8'))
      if (Number.isSafeInteger(value?.pid) && value.pid > 0) ownerPid = value.pid
      if (typeof value?.hostname === 'string') ownerHostname = value.hostname
    } catch {
      // A just-created lease may be briefly empty. Its mtime still protects a live owner.
    }
    let localOwnerIsAlive = false
    let localOwnerIsDead = false
    if (ownerHostname === localHostname && ownerPid !== null) {
      try {
        process.kill(ownerPid, 0)
        localOwnerIsAlive = true
      } catch (error) {
        if (error?.code === 'ESRCH') localOwnerIsDead = true
        else localOwnerIsAlive = true
      }
    }
    if (localOwnerIsAlive) return false
    if (!localOwnerIsDead && now() - heartbeatAt <= lease.staleAfterMs) return false
    const secondStats = await lstatOrNull(lockPath)
    if (!secondStats) return true
    if (
      secondStats.dev !== firstStats.dev ||
      secondStats.ino !== firstStats.ino ||
      secondStats.mtimeMs !== firstStats.mtimeMs ||
      (!localOwnerIsDead && now() - secondStats.mtimeMs <= lease.staleAfterMs)
    ) {
      return false
    }
    await fileSystem.unlink(lockPath).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
    await syncDirectory(rootDir)
    return true
  }

  const acquireLease = async signal => {
    const deadline = now() + lease.acquireTimeoutMs
    while (true) {
      throwIfAborted(signal)
      const token = randomUUID()
      let handle
      try {
        handle = await fileSystem.open(lockPath, 'wx', 0o600)
        const initialContents = Buffer.from(`${JSON.stringify(leaseContents(token))}\n`)
        await handle.write(initialContents, 0, initialContents.byteLength, 0)
        await handle.sync()
        await syncDirectory(rootDir)
        const context = { failure: null, fence: null, handle, stopped: false, token }
        context.fence = await writeNextFence(context)
        const finalContents = Buffer.from(`${JSON.stringify(leaseContents(token, context.fence))}\n`)
        await handle.truncate(0)
        await handle.write(finalContents, 0, finalContents.byteLength, 0)
        await handle.sync()
        let heartbeatTask = Promise.resolve()
        const heartbeat = () => {
          heartbeatTask = heartbeatTask
            .then(async () => {
              if (context.stopped || context.failure) return
              await verifyLeaseOwnership(context)
              const timestamp = new Date(now())
              await handle.utimes(timestamp, timestamp)
              await handle.sync()
            })
            .catch(error => {
              context.failure = leaseLostError(error)
            })
        }
        const timer = setInterval(heartbeat, lease.heartbeatMs)
        context.release = async () => {
          context.stopped = true
          clearInterval(timer)
          await heartbeatTask
          const ownedStats = await handle.stat().catch(() => null)
          await handle.close().catch(() => undefined)
          const currentStats = await lstatOrNull(lockPath)
          if (
            ownedStats &&
            currentStats &&
            ownedStats.dev === currentStats.dev &&
            ownedStats.ino === currentStats.ino
          ) {
            await fileSystem.unlink(lockPath).catch(error => {
              if (error?.code !== 'ENOENT') throw error
            })
            await syncDirectory(rootDir)
          }
        }
        return context
      } catch (error) {
        const ownedStats = await handle?.stat().catch(() => null)
        await handle?.close().catch(() => undefined)
        if (error?.code !== 'EEXIST') {
          const currentStats = await lstatOrNull(lockPath)
          if (
            ownedStats &&
            currentStats &&
            ownedStats.dev === currentStats.dev &&
            ownedStats.ino === currentStats.ino
          ) {
            await fileSystem.unlink(lockPath).catch(unlinkError => {
              if (unlinkError?.code !== 'ENOENT') throw unlinkError
            })
            await syncDirectory(rootDir)
          }
          throw error
        }
        if (await tryReclaimStaleLease()) continue
        if (now() >= deadline) {
          throw registryError('registry-locked', 'Material registry is locked by another live process', {
            status: 409,
            retryable: true,
          })
        }
        await sleep(Math.min(20, Math.max(1, deadline - now())))
        throwIfAborted(signal)
      }
    }
  }

  const verifyLeaseOwnership = async context => {
    if (!context || context.failure) throw context?.failure ?? leaseLostError()
    const ownedStats = await context.handle.stat().catch(error => {
      throw leaseLostError(error)
    })
    const currentStats = await lstatOrNull(lockPath)
    if (!currentStats || currentStats.dev !== ownedStats.dev || currentStats.ino !== ownedStats.ino) {
      throw leaseLostError()
    }
    let lockValue
    try {
      lockValue = await readJson(lockPath)
    } catch (error) {
      throw leaseLostError(error)
    }
    if (
      lockValue?.token !== context.token ||
      lockValue?.fence !== context.fence ||
      lockValue?.hostname !== localHostname ||
      lockValue?.pid !== process.pid ||
      (await readFence()) !== context.fence
    ) {
      throw leaseLostError()
    }
  }

  verifyMutationLease = async () => {
    if (activeLease) await verifyLeaseOwnership(activeLease)
  }

  const withLease = async (operation, signal) => {
    const acquired = await acquireLease(signal)
    if (activeLease) {
      await acquired.release()
      throw registryError('registry-locked', 'Nested registry lease acquisition is not allowed', { status: 409 })
    }
    activeLease = acquired
    try {
      await callCheckpoint('registry-lease-acquired', { fence: acquired.fence, token: acquired.token })
      throwIfAborted(signal)
      await verifyLeaseOwnership(acquired)
      const result = await operation()
      await verifyLeaseOwnership(acquired)
      return result
    } finally {
      activeLease = null
      await acquired.release()
    }
  }

  const promotionDirectoryFor = promotionId => join(promotionsDirectory, storageKeyForPromotion(promotionId))

  const loadPromotion = async (promotionDirectory, signal) => {
    throwIfAborted(signal)
    const stagedValue = await readJson(join(promotionDirectory, STAGED_MANIFEST_NAME))
    if (!stagedValue) return null
    const stagedBinding = parseStagedManifest(stagedValue)
    const expectedDirectory = promotionDirectoryFor(stagedBinding.promotionId)
    if (expectedDirectory !== promotionDirectory) {
      throw registryError('registry-corrupt', 'Promotion directory does not match its manifest identity', {
        status: 500,
      })
    }
    const publishedValue = await readJson(join(promotionDirectory, PUBLISHED_MANIFEST_NAME))
    let publishedBinding = null
    if (publishedValue) {
      publishedBinding = parsePublishedManifest(publishedValue)
      if (!sameJson(stagedBinding, publishedBinding)) {
        throw registryError('registry-corrupt', 'Published promotion does not match its staged manifest', {
          status: 500,
        })
      }
    }
    await verifyOrCopyBuild(join(promotionDirectory, 'build'), stagedBinding, { signal })
    return { binding: stagedBinding, published: publishedBinding !== null }
  }

  const registryObservation = async signal => {
    throwIfAborted(signal)
    const durable = await readDurableIndex()
    const entries = await fileSystem.readdir(promotionsDirectory, { withFileTypes: true })
    const fingerprint = sha256(
      JSON.stringify({
        durable: durable
          ? {
              fence: durable.fence,
              generation: durable.generation,
              snapshotHash: durable.snapshotHash,
            }
          : null,
        entries: entries
          .map(entry => ({
            directory: entry.isDirectory(),
            file: entry.isFile(),
            name: entry.name,
            symbolicLink: entry.isSymbolicLink(),
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      }),
    )
    return { entries, fingerprint }
  }

  const scanRegistryAttempt = async (entries, signal) => {
    const materials = new Map()
    const pendingPromotions = new Map()
    for (const entry of entries) {
      throwIfAborted(signal)
      if (entry.isSymbolicLink()) {
        throw registryError('registry-symlink-disallowed', 'Registry promotion entries must not be symbolic links', {
          status: 400,
        })
      }
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const promotionDirectory = join(promotionsDirectory, entry.name)
      const promotion = await loadPromotion(promotionDirectory, signal)
      if (!promotion) continue
      if (promotion.published) {
        const record = publishedRecord(promotion.binding)
        const key = identityKey(record)
        const existing = materials.get(key)
        if (existing && existing.promotionId !== record.promotionId) {
          throw registryError('promotion-conflict', 'Two promotions claim the same durable material identity', {
            status: 409,
          })
        }
        materials.set(key, record)
      } else {
        pendingPromotions.set(promotion.binding.promotionId, stagedRecord(promotion.binding))
      }
    }
    return { materials, pendingPromotions }
  }

  const scanRegistry = async signal => {
    for (let attempt = 1; attempt <= REGISTRY_SCAN_MAX_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal)
      const before = await registryObservation(signal)
      let scanned
      try {
        scanned = await scanRegistryAttempt(before.entries, signal)
      } catch (error) {
        const afterFailure = await registryObservation(signal)
        if (
          (error?.code === 'registry-record-not-found' || error?.code === 'ENOENT') &&
          before.fingerprint !== afterFailure.fingerprint &&
          attempt < REGISTRY_SCAN_MAX_ATTEMPTS
        ) {
          continue
        }
        throw error
      }
      const after = await registryObservation(signal)
      if (before.fingerprint !== after.fingerprint) {
        if (attempt < REGISTRY_SCAN_MAX_ATTEMPTS) continue
        throw registryError('registry-scan-unstable', 'Material registry changed repeatedly while it was read', {
          status: 409,
          retryable: true,
        })
      }
      materialIndex = scanned.materials
      pendingIndex = scanned.pendingPromotions
      return {
        materials: sortRecords(scanned.materials.values()).map(cloneJson),
        pendingPromotions: sortRecords(scanned.pendingPromotions.values()).map(cloneJson),
      }
    }
    throw registryError('registry-scan-unstable', 'Material registry could not produce a stable read', {
      status: 409,
      retryable: true,
    })
  }

  const registrySnapshotHash = gcState =>
    sha256(
      JSON.stringify({
        materials: sortRecords(materialIndex.values()).map(bindingFromRecord),
        pendingPromotions: sortRecords(pendingIndex.values()).map(bindingFromRecord),
        gcState: normalizeGcState(gcState),
      }),
    )

  const parseDurableIndex = value => {
    if (value === null) return null
    let gcState
    try {
      if (value.schemaVersion === REGISTRY_SCHEMA_VERSION) {
        requireObject(
          value,
          ['fence', 'generation', 'kind', 'retainedMaterialRefs', 'schemaVersion', 'snapshotHash'],
          'registry index',
        )
        gcState = normalizeGcState({
          legacyRetainedMaterialRefs: value.retainedMaterialRefs,
          replicaRoots: [],
        })
      } else {
        requireObject(
          value,
          [
            'fence',
            'gcStateHash',
            'generation',
            'kind',
            'legacyRetainedMaterialRefs',
            'replicaRoots',
            'schemaVersion',
            'snapshotHash',
          ],
          'registry index',
        )
        if (value.schemaVersion !== REGISTRY_INDEX_SCHEMA_VERSION) {
          throw registryError('registry-corrupt', 'Registry index has an unsupported schema', { status: 500 })
        }
        gcState = normalizeGcState({
          legacyRetainedMaterialRefs: value.legacyRetainedMaterialRefs,
          replicaRoots: value.replicaRoots,
        })
        if (typeof value.gcStateHash !== 'string' || value.gcStateHash !== sha256(JSON.stringify(gcState))) {
          throw registryError('registry-corrupt', 'Registry index GC state hash is invalid', { status: 500 })
        }
      }
    } catch {
      throw registryError('registry-corrupt', 'Registry index durable GC roots are invalid', { status: 500 })
    }
    if (
      value.kind !== 'material-registry-index' ||
      !Number.isSafeInteger(value.fence) ||
      value.fence <= 0 ||
      !Number.isSafeInteger(value.generation) ||
      value.generation <= 0 ||
      typeof value.snapshotHash !== 'string' ||
      !gcDigestPattern.test(value.snapshotHash)
    ) {
      throw registryError('registry-corrupt', 'Registry index has an unsupported schema', { status: 500 })
    }
    return Object.freeze({
      schemaVersion: value.schemaVersion,
      fence: value.fence,
      generation: value.generation,
      legacyRetainedMaterialRefs: gcState.legacyRetainedMaterialRefs,
      replicaRoots: gcState.replicaRoots,
      gcStateHash: value.schemaVersion === REGISTRY_INDEX_SCHEMA_VERSION ? value.gcStateHash : null,
      snapshotHash: value.snapshotHash,
    })
  }

  const readDurableIndex = async () => parseDurableIndex(await readJson(indexPath))

  const persistDurableIndex = async ({ generation, gcState: gcStateValue, snapshotHash }) => {
    if (!activeLease) throw leaseLostError()
    const gcState = normalizeGcState(gcStateValue)
    const value = {
      schemaVersion: REGISTRY_INDEX_SCHEMA_VERSION,
      kind: 'material-registry-index',
      fence: activeLease.fence,
      generation,
      snapshotHash,
      gcStateHash: sha256(JSON.stringify(gcState)),
      legacyRetainedMaterialRefs: gcState.legacyRetainedMaterialRefs.map(cloneJson),
      replicaRoots: gcState.replicaRoots.map(cloneJson),
    }
    await writeAtomicJson({
      path: indexPath,
      value,
      beforeRename: () => callCheckpoint('before-registry-index-rename', { generation }),
      afterRename: () => callCheckpoint('after-registry-index-rename', { generation }),
    })
    return parseDurableIndex(value)
  }

  const reconcileDurableIndex = async signal => {
    await scanRegistry(signal)
    const durable = await readDurableIndex()
    const gcState = normalizeGcState({
      legacyRetainedMaterialRefs: durable?.legacyRetainedMaterialRefs ?? [],
      replicaRoots: durable?.replicaRoots ?? [],
    })
    const snapshotHash = registrySnapshotHash(gcState)
    if (durable && durable.schemaVersion === REGISTRY_INDEX_SCHEMA_VERSION && durable.snapshotHash === snapshotHash) {
      return durable
    }
    return persistDurableIndex({
      generation: (durable?.generation ?? 0) + 1,
      gcState,
      snapshotHash,
    })
  }

  const setDurableGcState = async gcStateValue => {
    const durable = await reconcileDurableIndex()
    const gcState = normalizeGcState(gcStateValue)
    const snapshotHash = registrySnapshotHash(gcState)
    if (durable.snapshotHash === snapshotHash) return durable
    return persistDurableIndex({
      generation: durable.generation + 1,
      gcState,
      snapshotHash,
    })
  }

  const stagePromotionInternal = async (requestValue, signal) => {
    throwIfAborted(signal)
    const request = validateMaterialPromotionRequest(requestValue)
    const binding = createMaterialPromotionBinding(request)
    assertBuildBudgets(binding)
    await reconcileDurableIndex(signal)
    const promotionDirectory = promotionDirectoryFor(binding.promotionId)
    const existingStats = await lstatOrNull(promotionDirectory)
    if (existingStats) {
      if (existingStats.isSymbolicLink() || !existingStats.isDirectory()) {
        throw registryError('registry-symlink-disallowed', 'Existing promotion storage is not a confined directory', {
          status: 400,
        })
      }
      const existing = await loadPromotion(promotionDirectory, signal)
      if (!existing || !sameJson(existing.binding, binding)) {
        throw registryError('promotion-conflict', 'promotionId is already bound to different immutable inputs', {
          status: 409,
        })
      }
      const record = stagedRecord(existing.binding)
      if (existing.published) {
        materialIndex.set(identityKey(record), publishedRecord(existing.binding))
        pendingIndex.delete(record.promotionId)
      } else {
        pendingIndex.set(record.promotionId, record)
      }
      return cloneJson(record)
    }

    const buildDirectory = requireDirectoryPath(request.buildDirectory, 'buildDirectory')
    const trustedBuildDirectory = await assertTrustedBuildDirectory(buildDirectory)
    throwIfAborted(signal)
    const temporaryDirectory = join(
      promotionsDirectory,
      `.${storageKeyForPromotion(binding.promotionId)}.${process.pid}.${randomUUID()}.tmp`,
    )
    try {
      await ensureDirectory(temporaryDirectory)
      await verifyOrCopyBuild(trustedBuildDirectory, binding, {
        destinationBuildDirectory: join(temporaryDirectory, 'build'),
        signal,
      })
      await callCheckpoint('after-stage-nested-directory-fsync', { promotionId: binding.promotionId })
      throwIfAborted(signal)
      await writeDurableFile(
        join(temporaryDirectory, STAGED_MANIFEST_NAME),
        `${JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, kind: 'staged', binding })}\n`,
      )
      await syncDirectory(temporaryDirectory)
      await callCheckpoint('after-stage-fsync-before-stage-rename', { promotionId: binding.promotionId })
      throwIfAborted(signal)
      await verifyMutationLease()
      await fileSystem.rename(temporaryDirectory, promotionDirectory)
      await syncDirectory(promotionsDirectory)
      await callCheckpoint('after-stage-rename', { promotionId: binding.promotionId })
      await callCheckpoint('after-stage-rename-before-index-activation', { promotionId: binding.promotionId })
      throwIfAborted(signal)
    } catch (error) {
      await cleanupTemporaryPath(temporaryDirectory, { force: true, recursive: true })
      throw error
    }
    const record = stagedRecord(binding)
    pendingIndex.set(record.promotionId, record)
    await reconcileDurableIndex(signal)
    await callCheckpoint('after-stage-index-activation', { promotionId: binding.promotionId })
    return cloneJson(record)
  }

  const publishPromotionInternal = async (promotionIdValue, signal) => {
    throwIfAborted(signal)
    const promotionId = requirePromotionId(promotionIdValue)
    await reconcileDurableIndex(signal)
    throwIfAborted(signal)
    const promotionDirectory = promotionDirectoryFor(promotionId)
    const promotion = await loadPromotion(promotionDirectory, signal)
    if (!promotion) {
      throw registryError('promotion-not-found', `Promotion ${promotionId} is not staged`, { status: 404 })
    }
    if (promotion.binding.promotionId !== promotionId) {
      throw registryError('promotion-conflict', 'promotionId does not match its staged manifest', { status: 409 })
    }
    const record = publishedRecord(promotion.binding)
    const existingIdentity = materialIndex.get(identityKey(record))
    if (existingIdentity && existingIdentity.promotionId !== promotionId) {
      throw registryError('promotion-conflict', 'Durable material identity is already owned by another promotion', {
        status: 409,
      })
    }
    if (!promotion.published) {
      throwIfAborted(signal)
      await writeAtomicJson({
        path: join(promotionDirectory, PUBLISHED_MANIFEST_NAME),
        value: { schemaVersion: REGISTRY_SCHEMA_VERSION, kind: 'published', binding: promotion.binding },
        beforeRename: () => callCheckpoint('before-manifest-rename', { promotionId }),
        afterRename: () =>
          callCheckpoint('after-manifest-rename-before-index-activation', {
            promotionId,
          }),
      })
      throwIfAborted(signal)
    }
    materialIndex.set(identityKey(record), record)
    pendingIndex.delete(promotionId)
    await reconcileDurableIndex(signal)
    await callCheckpoint('after-registry-index-activation', { promotionId })
    return cloneJson(record)
  }

  const rebuildIndexInternal = () => scanRegistry()

  const cleanupAtomicTemporaryFiles = async (directory, patterns) => {
    let removed = false
    const entries = await fileSystem.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !patterns.some(pattern => pattern.test(entry.name))) continue
      await verifyMutationLease()
      await fileSystem.unlink(join(directory, entry.name)).catch(error => {
        if (error?.code !== 'ENOENT') throw error
      })
      removed = true
    }
    if (removed) await syncDirectory(directory)
  }

  const cleanupAtomicRecoveryTemporaries = async () => {
    await cleanupAtomicTemporaryFiles(rootDir, ROOT_ATOMIC_TEMPORARY_PATTERNS)
    const entries = await fileSystem.readdir(promotionsDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw registryError('registry-symlink-disallowed', 'Registry promotion entries must not be symbolic links', {
          status: 400,
        })
      }
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      await cleanupAtomicTemporaryFiles(join(promotionsDirectory, entry.name), PROMOTION_ATOMIC_TEMPORARY_PATTERNS)
    }
  }

  const recoverPendingPromotionsInternal = async () => {
    await cleanupAtomicRecoveryTemporaries()
    await reconcileDurableIndex()
    const entries = await fileSystem.readdir(promotionsDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('.') && entry.name.endsWith('.tmp')) {
        await verifyMutationLease()
        await fileSystem.rm(join(promotionsDirectory, entry.name), { force: true, recursive: true })
      }
    }
    const trashEntries = await fileSystem.readdir(trashDirectory, { withFileTypes: true })
    for (const entry of trashEntries) {
      if (entry.isSymbolicLink()) {
        throw registryError('registry-symlink-disallowed', 'Registry trash entries must not be symbolic links', {
          status: 400,
        })
      }
      await verifyMutationLease()
      await fileSystem.rm(join(trashDirectory, entry.name), { force: true, recursive: entry.isDirectory() })
    }
    await syncDirectory(promotionsDirectory)
    await syncDirectory(trashDirectory)
    await reconcileDurableIndex()
    return sortRecords(pendingIndex.values()).map(cloneJson)
  }

  const exportBackupInternal = async (destinationValue, durable) => {
    const destinationDir = requireDirectoryPath(destinationValue, 'destinationDir')
    if (confinedPath(rootDir, destinationDir) || confinedPath(destinationDir, rootDir)) {
      throw registryError('backup-path-conflict', 'Backup destination must be outside the registry root', {
        status: 400,
      })
    }
    if (await lstatOrNull(destinationDir)) {
      throw registryError('backup-destination-exists', 'Backup destination already exists', { status: 409 })
    }
    const parentDirectory = dirname(destinationDir)
    await ensureDirectory(parentDirectory)
    const temporaryDirectory = join(parentDirectory, `.${basename(destinationDir)}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await ensureDirectory(temporaryDirectory)
      const materials = sortRecords(materialIndex.values())
      const backupEntries = []
      for (const material of materials) {
        const binding = bindingFromRecord(material)
        const storageKey = storageKeyForPromotion(binding.promotionId)
        const sourceBuildDirectory = join(promotionDirectoryFor(binding.promotionId), 'build')
        await verifyOrCopyBuild(sourceBuildDirectory, binding, {
          destinationBuildDirectory: join(temporaryDirectory, 'materials', storageKey, 'build'),
        })
        backupEntries.push({ binding, storageKey })
      }
      const gcState = gcStateFromDurable(durable)
      const gcStateHash = sha256(
        JSON.stringify({
          sourceGeneration: durable.generation,
          sourceSnapshotHash: durable.snapshotHash,
          gcState,
        }),
      )
      await writeDurableFile(
        join(temporaryDirectory, BACKUP_MANIFEST_NAME),
        `${JSON.stringify({
          schemaVersion: REGISTRY_BACKUP_SCHEMA_VERSION,
          kind: 'material-registry-backup',
          createdAt: now(),
          materials: backupEntries,
          sourceGeneration: durable.generation,
          sourceSnapshotHash: durable.snapshotHash,
          gcState,
          gcStateHash,
        })}\n`,
      )
      await syncDirectory(temporaryDirectory)
      await verifyMutationLease()
      await fileSystem.rename(temporaryDirectory, destinationDir)
      await syncDirectory(parentDirectory)
      return {
        destinationDir,
        materials: materials.map(cloneJson),
        valid: true,
        sourceGeneration: durable.generation,
        gcStateHash,
      }
    } catch (error) {
      await cleanupTemporaryPath(temporaryDirectory, { force: true, recursive: true })
      throw error
    }
  }

  const verifyBackupInternal = async backupValue => {
    const backupDirectory = requireDirectoryPath(backupValue, 'backupDirectory')
    await assertDirectory(backupDirectory, 'backup directory')
    const manifestValue = await readJson(join(backupDirectory, BACKUP_MANIFEST_NAME))
    if (!manifestValue) {
      throw registryError('backup-invalid', 'Backup manifest is missing', { status: 400 })
    }
    const manifest = parseBackupManifest(manifestValue)
    const materials = []
    for (const entry of manifest.entries) {
      const relativeBuildDirectory = `materials/${entry.storageKey}/build`
      await assertConfinedDirectoryChain(backupDirectory, relativeBuildDirectory)
      await verifyOrCopyBuild(join(backupDirectory, ...relativeBuildDirectory.split('/')), entry.binding, {
        mismatchCode: 'backup-integrity-mismatch',
      })
      materials.push(publishedRecord(entry.binding))
    }
    return {
      valid: true,
      materials: sortRecords(materials).map(cloneJson),
      schemaVersion: manifest.schemaVersion,
      sourceGeneration: manifest.sourceGeneration,
      sourceSnapshotHash: manifest.sourceSnapshotHash,
      gcState: manifest.gcState,
    }
  }

  const gcStateFromDurable = durable =>
    normalizeGcState({
      legacyRetainedMaterialRefs: durable.legacyRetainedMaterialRefs,
      replicaRoots: durable.replicaRoots,
    })

  const resolvePromotionRoots = (projectId, promotionIds) =>
    promotionIds.map(promotionId => {
      const active = [...materialIndex.values()].find(material => material.promotionId === promotionId)
      if (!active || active.projectId !== projectId || active.state !== 'active') {
        throw registryError(
          'gc-promotion-unresolved',
          'An unresolved promotion is not an active material in the authorized project',
          { status: 409, retryable: true },
        )
      }
      return Object.freeze({
        promotionId,
        materialRef: validateMaterialIdentity({
          materialId: active.materialId,
          materialVersion: active.materialVersion,
          buildIntegrity: active.buildIntegrity,
        }),
      })
    })

  const gcCandidatesForProject = (projectId, retainedMaterialRefs) => {
    const retainedKeys = new Set(retainedMaterialRefs.map(identityKey))
    return sortIdentities(
      sortRecords(materialIndex.values())
        .filter(material => material.projectId === projectId && !retainedKeys.has(identityKey(material)))
        .map(material =>
          validateMaterialIdentity({
            materialId: material.materialId,
            materialVersion: material.materialVersion,
            buildIntegrity: material.buildIntegrity,
          }),
        ),
    )
  }

  const createGcPlan = ({ durable, principal, request, requestDigest, root }) => {
    const globalRetainedMaterialRefs = retainedMaterialRefsForGcState(gcStateFromDurable(durable))
    const base = {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      kind: 'material-gc-plan',
      registryId,
      registryGeneration: durable.generation,
      rootKeyDigest: rootKeyDigest({ ...principal, projectId: request.projectId, replicaId: request.replicaId }),
      projectId: request.projectId,
      replicaId: request.replicaId,
      replicaGeneration: root.replicaGeneration,
      requestDigest,
      snapshotDigest: request.snapshotDigest,
      globalRetainedMaterialRefs,
      deletionCandidates: gcCandidatesForProject(request.projectId, globalRetainedMaterialRefs),
    }
    return validateMaterialGcPlan({ ...base, planHash: sha256(JSON.stringify(base)) })
  }

  const planGarbageCollectionInternal = async input => {
    if (!exactObject(input, ['principal', 'request'])) {
      throw registryError('invalid-request', 'planGarbageCollection input is invalid', { status: 400 })
    }
    const { principal: principalValue, request: requestValue } = input
    const principal = normalizePrincipal(principalValue)
    const request = validateMaterialGcPlanRequest(requestValue)
    const durable = await reconcileDurableIndex()
    const gcState = gcStateFromDurable(durable)
    const key = rootKey({ ...principal, projectId: request.projectId, replicaId: request.replicaId })
    const current = gcState.replicaRoots.find(root => rootKey(root) === key) ?? null
    const requestDigest = sha256(JSON.stringify(createMaterialGcPlanRequestDigestInput(request)))
    const isExactReplay =
      current?.state === 'active' &&
      current.acceptedRequestDigest === requestDigest &&
      current.snapshotDigest === request.snapshotDigest &&
      (request.expectedReplicaGeneration === current.replicaGeneration ||
        request.expectedReplicaGeneration === current.replicaGeneration - 1)
    if (isExactReplay) {
      return createGcPlan({ durable, principal, request, requestDigest, root: current })
    }
    if (
      (!current && request.expectedReplicaGeneration !== 0) ||
      (current && request.expectedReplicaGeneration !== current.replicaGeneration)
    ) {
      throw registryError('gc-replica-generation-conflict', 'Replica GC generation does not match durable state', {
        status: 409,
        retryable: true,
      })
    }
    const resolvedPromotions = resolvePromotionRoots(request.projectId, request.unresolvedPromotionIds)
    const nextRoot = normalizeReplicaRoot({
      ...principal,
      projectId: request.projectId,
      replicaId: request.replicaId,
      state: 'active',
      replicaGeneration: (current?.replicaGeneration ?? 0) + 1,
      acceptedRequestDigest: requestDigest,
      snapshotDigest: request.snapshotDigest,
      materialRefs: request.materialRefs,
      unresolvedPromotionIds: request.unresolvedPromotionIds,
      resolvedPromotions,
      updatedAt: now(),
      releasedAt: null,
    })
    const nextGcState = normalizeGcState({
      legacyRetainedMaterialRefs: gcState.legacyRetainedMaterialRefs,
      replicaRoots: [...gcState.replicaRoots.filter(root => rootKey(root) !== key), nextRoot],
    })
    const nextDurable = await setDurableGcState(nextGcState)
    return createGcPlan({ durable: nextDurable, principal, request, requestDigest, root: nextRoot })
  }

  const sweepGarbageCollectionInternal = async input => {
    if (!exactObject(input, ['principal', 'request'])) {
      throw registryError('invalid-request', 'sweepGarbageCollection input is invalid', { status: 400 })
    }
    const { principal: principalValue, request: requestValue } = input
    const principal = normalizePrincipal(principalValue)
    const request = validateMaterialGcSweepRequest(requestValue)
    const plan = request.plan
    if (
      plan.registryId !== registryId ||
      plan.planHash !== sha256(JSON.stringify(createMaterialGcPlanHashInput(plan)))
    ) {
      throw registryError('gc-plan-invalid', 'Garbage collection plan integrity is invalid', { status: 400 })
    }
    const durable = await reconcileDurableIndex()
    const gcState = gcStateFromDurable(durable)
    const authority = { ...principal, projectId: plan.projectId, replicaId: plan.replicaId }
    const root = gcState.replicaRoots.find(candidate => rootKey(candidate) === rootKey(authority)) ?? null
    if (
      plan.rootKeyDigest !== rootKeyDigest(authority) ||
      !root ||
      root.state !== 'active' ||
      root.replicaGeneration !== plan.replicaGeneration ||
      root.snapshotDigest !== plan.snapshotDigest ||
      root.acceptedRequestDigest !== plan.requestDigest
    ) {
      throw registryError('gc-replica-generation-conflict', 'Replica GC root changed after planning', {
        status: 409,
        retryable: true,
      })
    }
    if (durable.generation !== plan.registryGeneration) {
      throw registryError('gc-generation-conflict', 'Registry changed after garbage collection was planned', {
        status: 409,
        retryable: true,
      })
    }
    const globalRetainedMaterialRefs = retainedMaterialRefsForGcState(gcState)
    const expectedCandidates = gcCandidatesForProject(plan.projectId, globalRetainedMaterialRefs)
    if (
      !sameJson(globalRetainedMaterialRefs, plan.globalRetainedMaterialRefs) ||
      !sameJson(expectedCandidates, plan.deletionCandidates)
    ) {
      throw registryError('gc-plan-invalid', 'Garbage collection plan roots or candidates were modified', {
        status: 400,
      })
    }

    const deletedMaterials = []
    for (const identity of expectedCandidates) {
      const record = materialIndex.get(identityKey(identity))
      if (!record || record.projectId !== plan.projectId) continue
      const sourceDirectory = promotionDirectoryFor(record.promotionId)
      const trashPath = join(trashDirectory, `${storageKeyForPromotion(record.promotionId)}.${randomUUID()}`)
      await callCheckpoint('before-gc-rename', { promotionId: record.promotionId })
      await verifyMutationLease()
      await fileSystem.rename(sourceDirectory, trashPath)
      await syncDirectory(promotionsDirectory)
      await syncDirectory(trashDirectory)
      await callCheckpoint('after-gc-rename-before-removal', { promotionId: record.promotionId })
      materialIndex.delete(identityKey(identity))
      pendingIndex.delete(record.promotionId)
      deletedMaterials.push(Object.freeze(cloneJson(identity)))
      await verifyMutationLease()
      await fileSystem.rm(trashPath, { force: true, recursive: true })
      await syncDirectory(trashDirectory)
      await callCheckpoint('after-gc-removal-before-index-activation', { promotionId: record.promotionId })
    }
    const nextDurable = await reconcileDurableIndex()
    return Object.freeze({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      deletedMaterials: Object.freeze(deletedMaterials),
      registryGeneration: nextDurable.generation,
      replicaGeneration: root.replicaGeneration,
      planHash: plan.planHash,
    })
  }

  const releaseGarbageCollectionRootInternal = async input => {
    if (!exactObject(input, ['principal', 'request'])) {
      throw registryError('invalid-request', 'releaseGarbageCollectionRoot input is invalid', { status: 400 })
    }
    const { principal: principalValue, request: requestValue } = input
    const principal = normalizePrincipal(principalValue)
    const request = validateMaterialGcReleaseRequest(requestValue)
    const durable = await reconcileDurableIndex()
    const gcState = gcStateFromDurable(durable)
    const authority = { ...principal, projectId: request.projectId, replicaId: request.replicaId }
    const key = rootKey(authority)
    const current = gcState.replicaRoots.find(root => rootKey(root) === key) ?? null
    const requestDigest = sha256(JSON.stringify(createMaterialGcReleaseRequestDigestInput(request)))
    const exactReplay =
      current?.state === 'released' &&
      current.acceptedRequestDigest === requestDigest &&
      current.snapshotDigest === request.snapshotDigest &&
      request.expectedReplicaGeneration === current.replicaGeneration - 1
    if (exactReplay) {
      return Object.freeze({
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        status: 'released',
        projectId: request.projectId,
        replicaId: request.replicaId,
        replicaGeneration: current.replicaGeneration,
        requestDigest,
        registryGeneration: durable.generation,
      })
    }
    if (
      !current ||
      current.state !== 'active' ||
      current.replicaGeneration !== request.expectedReplicaGeneration ||
      current.snapshotDigest !== request.snapshotDigest
    ) {
      throw registryError('gc-replica-generation-conflict', 'Replica GC root cannot be released from stale state', {
        status: 409,
        retryable: true,
      })
    }
    const releasedAt = now()
    const tombstone = normalizeReplicaRoot({
      ...authority,
      state: 'released',
      replicaGeneration: current.replicaGeneration + 1,
      acceptedRequestDigest: requestDigest,
      snapshotDigest: current.snapshotDigest,
      materialRefs: [],
      unresolvedPromotionIds: [],
      resolvedPromotions: [],
      updatedAt: releasedAt,
      releasedAt,
    })
    const nextDurable = await setDurableGcState({
      legacyRetainedMaterialRefs: gcState.legacyRetainedMaterialRefs,
      replicaRoots: [...gcState.replicaRoots.filter(root => rootKey(root) !== key), tombstone],
    })
    return Object.freeze({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      status: 'released',
      projectId: request.projectId,
      replicaId: request.replicaId,
      replicaGeneration: tombstone.replicaGeneration,
      requestDigest,
      registryGeneration: nextDurable.generation,
    })
  }

  await ensureDirectory(workspaceRoot)
  physicalWorkspaceRoot = await fileSystem.realpath(workspaceRoot)
  await ensureDirectory(rootDir)
  physicalRegistryRoot = await fileSystem.realpath(rootDir)
  await ensureDirectory(promotionsDirectory)
  await ensureDirectory(trashDirectory)
  await scanRegistry()

  return Object.freeze({
    rootDir,
    stagePromotion: (request, options = {}) =>
      enqueue(() => {
        const normalizedRequest = validateMaterialPromotionRequest(request)
        assertBuildBudgets(createMaterialPromotionBinding(normalizedRequest))
        return withLease(() => stagePromotionInternal(normalizedRequest, options.signal), options.signal)
      }).catch(error => throwFailure(error)),
    publishPromotion: (request, options = {}) =>
      enqueue(() =>
        withLease(() => {
          if (!exactObject(request, ['promotionId'])) {
            throw registryError('invalid-request', 'publishPromotion requires exactly promotionId', { status: 400 })
          }
          return publishPromotionInternal(request.promotionId, options.signal)
        }, options.signal),
      ).catch(error => throwFailure(error)),
    readMaterial: (identityValue, options = {}) =>
      enqueue(async () => {
        throwIfAborted(options.signal)
        const identity = validateMaterialIdentity(identityValue)
        await scanRegistry(options.signal)
        throwIfAborted(options.signal)
        return cloneJson(materialIndex.get(identityKey(identity)) ?? null)
      }).catch(error => throwFailure(error)),
    listMaterials: (filterValue, options = {}) =>
      enqueue(async () => {
        if (!exactObject(filterValue, ['projectId']) || typeof filterValue.projectId !== 'string') {
          throw registryError('invalid-request', 'listMaterials requires exactly projectId', { status: 400 })
        }
        await scanRegistry(options.signal)
        throwIfAborted(options.signal)
        return sortRecords(materialIndex.values())
          .filter(material => material.projectId === filterValue.projectId)
          .map(cloneJson)
      }).catch(error => throwFailure(error)),
    queryPromotion: (request, options = {}) =>
      enqueue(async () => {
        if (
          !exactObject(request, ['projectId', 'promotionId', 'schemaVersion']) ||
          request.schemaVersion !== 1 ||
          typeof request.projectId !== 'string'
        ) {
          throw registryError('invalid-request', 'queryPromotion request is invalid', { status: 400 })
        }
        const promotionId = requirePromotionId(request.promotionId)
        await scanRegistry(options.signal)
        throwIfAborted(options.signal)
        const record = [...materialIndex.values(), ...pendingIndex.values()].find(
          material => material.projectId === request.projectId && material.promotionId === promotionId,
        )
        return record ? cloneJson(record) : null
      }).catch(error => throwFailure(error)),
    rebuildIndex: () => enqueue(rebuildIndexInternal).catch(error => throwFailure(error)),
    recoverPendingPromotions: () =>
      enqueue(() => withLease(recoverPendingPromotionsInternal)).catch(error => throwFailure(error)),
    exportBackup: request =>
      enqueue(() =>
        withLease(async () => {
          if (!exactObject(request, ['destinationDir'])) {
            throw registryError('invalid-request', 'exportBackup requires exactly destinationDir', { status: 400 })
          }
          const durable = await reconcileDurableIndex()
          return exportBackupInternal(request.destinationDir, durable)
        }),
      ).catch(error => throwFailure(error)),
    verifyBackup: request =>
      enqueue(() => {
        if (!exactObject(request, ['backupDirectory'])) {
          throw registryError('invalid-request', 'verifyBackup requires exactly backupDirectory', { status: 400 })
        }
        return verifyBackupInternal(request.backupDirectory)
      }).catch(error => throwFailure(error)),
    planGarbageCollection: input =>
      enqueue(() => withLease(() => planGarbageCollectionInternal(input))).catch(error => throwFailure(error)),
    sweepGarbageCollection: input =>
      enqueue(() => withLease(() => sweepGarbageCollectionInternal(input))).catch(error => throwFailure(error)),
    releaseGarbageCollectionRoot: input =>
      enqueue(() => withLease(() => releaseGarbageCollectionRootInternal(input))).catch(error => throwFailure(error)),
  })
}
