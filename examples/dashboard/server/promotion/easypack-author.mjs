import { createHash, randomUUID } from 'node:crypto'
import { constants as fileSystemConstants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { verifyArtifactRecordIntegrity } from '../../src/lib/storage/artifact-contracts.mjs'
import { checkEasypackRuntimeReadiness, loadEasypackRuntime } from './easypack-runtime-loader.mjs'
import { promotionError, throwIfPromotionAborted } from './promotion-error.mjs'
import { createCanonicalDurableMaterialIdentity, validateMaterialPromotionCall } from './request-contract.mjs'

const EASYPACK_ENTRY_FILE = 'dist/index.esm.js'
const WORKSPACE_MARKER_FILE = '.easy-editor-workspace-owner.json'
const WORKSPACE_KIND = 'easy-editor-easypack-promotion-workspace'
const WORKSPACE_SCHEMA_VERSION = 1
const WORKSPACE_MARKER_MAX_BYTES = 4 * 1024
const PROCESS_LEASE_KIND = 'easy-editor-easypack-process-lease'
const PROCESS_LEASE_SCHEMA_VERSION = 1
const PROCESS_INSTANCE_TOKEN = randomUUID()
const PROCESS_LEASE_STATES = new Map()
const DEFAULT_WORKSPACE_LEASE = Object.freeze({ heartbeatMs: 30_000, staleAfterMs: 10 * 60_000 })
const UUID_PATTERN = '[\\da-f]{8}-[\\da-f]{4}-4[\\da-f]{3}-[89ab][\\da-f]{3}-[\\da-f]{12}'
const UUID_VALUE_PATTERN = new RegExp(`^${UUID_PATTERN}$`, 'u')
const WORKSPACE_NAME_PATTERN = new RegExp(`^promotion-v2-(${UUID_PATTERN})-(${UUID_PATTERN})-([A-Za-z0-9]{6})$`, 'u')
const RECOVERY_NAME_PATTERN = new RegExp(
  `^\\.promotion-recovery-v2-(${UUID_PATTERN})-(${UUID_PATTERN})-(promotion-v2-.+)$`,
  'u',
)
const PROCESS_LEASE_NAME_PATTERN = new RegExp(`^\\.promotion-process-v1-(${UUID_PATTERN})\\.lease\\.json$`, 'u')
const PROCESS_LEASE_TEMP_NAME_PATTERN = new RegExp(`^\\.promotion-process-v1-(${UUID_PATTERN})\\.lease\\.tmp$`, 'u')

const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const hashBytes = bytes => createHash('sha256').update(bytes).digest()
const hostnameKey = value => createHash('sha256').update(value).digest('hex').slice(0, 16)

const isInside = (root, candidate) => {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  )
}

const requireNodeMajor = version => {
  const match = String(version).match(/^(?:v)?(\d+)/u)
  return match ? Number.parseInt(match[1], 10) : 0
}

const exactObject = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

const lstatOrNull = async path => {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

const processIsAlive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

const requirePositiveSafeInteger = (value, fallback, label) => {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return normalized
}

const normalizeWorkspaceLease = value => {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new TypeError('workspaceLease must be an object')
  }
  const heartbeatMs = requirePositiveSafeInteger(
    value?.heartbeatMs,
    DEFAULT_WORKSPACE_LEASE.heartbeatMs,
    'workspaceLease.heartbeatMs',
  )
  const staleAfterMs = requirePositiveSafeInteger(
    value?.staleAfterMs,
    DEFAULT_WORKSPACE_LEASE.staleAfterMs,
    'workspaceLease.staleAfterMs',
  )
  if (heartbeatMs >= staleAfterMs) {
    throw new TypeError('workspaceLease.heartbeatMs must be less than workspaceLease.staleAfterMs')
  }
  if (value?.now !== undefined && typeof value.now !== 'function') {
    throw new TypeError('workspaceLease.now must be a function')
  }
  return Object.freeze({ heartbeatMs, staleAfterMs, now: value?.now ?? Date.now })
}

const removeTreeWithoutFollowingSymlinks = async path => {
  const stats = await lstatOrNull(path)
  if (!stats) return
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    await unlink(path).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
    return
  }
  let entries
  try {
    entries = await readdir(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) await removeTreeWithoutFollowingSymlinks(join(path, entry))
  await rmdir(path).catch(error => {
    if (error?.code !== 'ENOENT') throw error
  })
}

const readWorkspaceMarker = async markerPath => {
  let handle
  try {
    handle = await open(markerPath, fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW)
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size > WORKSPACE_MARKER_MAX_BYTES) return null
    const value = JSON.parse(await handle.readFile('utf8'))
    if (
      !exactObject(value, [
        'createdAt',
        'hostname',
        'hostnameKey',
        'instanceToken',
        'kind',
        'pid',
        'schemaVersion',
        'workspaceName',
        'workspaceToken',
      ]) ||
      value.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
      value.kind !== WORKSPACE_KIND ||
      typeof value.hostname !== 'string' ||
      hostnameKey(value.hostname) !== value.hostnameKey ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      !Number.isSafeInteger(value.createdAt) ||
      value.createdAt < 0 ||
      typeof value.instanceToken !== 'string' ||
      !UUID_VALUE_PATTERN.test(value.instanceToken) ||
      typeof value.workspaceName !== 'string' ||
      !WORKSPACE_NAME_PATTERN.test(value.workspaceName) ||
      typeof value.workspaceToken !== 'string' ||
      !UUID_VALUE_PATTERN.test(value.workspaceToken)
    ) {
      return null
    }
    return value
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ELOOP' || error instanceof SyntaxError) return null
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const readProcessLease = async leasePath => {
  let handle
  try {
    handle = await open(leasePath, fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW)
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size > WORKSPACE_MARKER_MAX_BYTES) return null
    const value = JSON.parse(await handle.readFile('utf8'))
    if (
      !exactObject(value, [
        'heartbeatAt',
        'hostname',
        'hostnameKey',
        'instanceToken',
        'kind',
        'pid',
        'schemaVersion',
      ]) ||
      value.schemaVersion !== PROCESS_LEASE_SCHEMA_VERSION ||
      value.kind !== PROCESS_LEASE_KIND ||
      typeof value.hostname !== 'string' ||
      hostnameKey(value.hostname) !== value.hostnameKey ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      !Number.isSafeInteger(value.heartbeatAt) ||
      value.heartbeatAt < 0 ||
      typeof value.instanceToken !== 'string' ||
      !UUID_VALUE_PATTERN.test(value.instanceToken)
    ) {
      return null
    }
    return value
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ELOOP' || error instanceof SyntaxError) return null
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const sameFile = (left, right) => left && right && left.dev === right.dev && left.ino === right.ino

const packageSlug = logicalComponentId => {
  const value = logicalComponentId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 96)
  return value || sha256(logicalComponentId).slice('sha256:'.length, 'sha256:'.length + 16)
}

const packageVersion = sourceRevision => {
  const value = sourceRevision
    .replace(/[^0-9A-Za-z.-]+/gu, '-')
    .replaceAll('.', '-')
    .replace(/^[.-]+|[.-]+$/gu, '')
    .slice(0, 64)
  const suffix = sha256(sourceRevision).slice('sha256:'.length, 'sha256:'.length + 16)
  return `0.0.0-rev-${value || 'source'}-${suffix}`
}

const sourceRevisionOf = artifact => ({
  artifactId: artifact.artifactId,
  sourceRevision: artifact.sourceRevision,
  logicalComponentId: artifact.logicalComponentId,
  sourceIntegrity: artifact.sourceIntegrity,
})

const trustedWrapperSource = artifact => {
  const descriptor = {
    schemaVersion: 1,
    componentName: 'GeneratedMaterialHost',
    runtime: 'sandbox-proxy',
    sourceRevision: sourceRevisionOf(artifact),
    dependencyLockDigest: artifact.dependencyLockDigest,
  }
  return [
    `export const generatedMaterialDescriptor = Object.freeze(${JSON.stringify(descriptor)})`,
    "export const componentName = 'GeneratedMaterialHost'",
    "export const runtime = 'sandbox-proxy'",
    'export default generatedMaterialDescriptor',
    '',
  ].join('\n')
}

const normalizeArtifactFiles = async (buildDirectory, buildResult) => {
  if (!buildResult || !Array.isArray(buildResult.artifacts)) {
    throw promotionError('promotion-build-invalid', 503, 'Easypack returned an invalid build result')
  }
  const files = []
  const paths = new Set()
  for (const artifact of buildResult.artifacts) {
    if (
      !artifact ||
      typeof artifact.path !== 'string' ||
      artifact.path.includes('\\') ||
      artifact.path.includes('\0') ||
      isAbsolute(artifact.path) ||
      artifact.path.split('/').some(segment => segment === '' || segment === '.' || segment === '..') ||
      paths.has(artifact.path)
    ) {
      throw promotionError('promotion-build-invalid', 503, 'Easypack returned an invalid build artifact')
    }
    const outputPath = resolve(buildDirectory, ...artifact.path.split('/'))
    if (!isInside(buildDirectory, outputPath)) {
      throw promotionError('path-escape', 400, 'Build artifact escaped its trusted workspace')
    }
    const stats = await lstat(outputPath)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw promotionError('promotion-build-invalid', 503, 'Easypack build artifact is not a regular file')
    }
    const bytes = await readFile(outputPath)
    paths.add(artifact.path)
    files.push({ path: artifact.path, byteLength: bytes.byteLength, integrity: sha256(bytes) })
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  if (!paths.has(EASYPACK_ENTRY_FILE)) {
    throw promotionError('promotion-build-invalid', 503, 'Easypack did not produce the trusted wrapper entry')
  }
  return files
}

export const createEasypackTrustedWrapperAuthor = ({
  workspaceRoot,
  nodeVersion = process.versions.node,
  loadEasypack = loadEasypackRuntime,
  now,
  workspaceLease: workspaceLeaseValue,
} = {}) => {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0 || workspaceRoot.includes('\0')) {
    throw new TypeError('workspaceRoot must be a non-empty filesystem path')
  }
  if (typeof loadEasypack !== 'function') throw new TypeError('loadEasypack must be a function')
  if (now !== undefined && typeof now !== 'function') throw new TypeError('now must be a function')
  const resolvedWorkspaceRoot = resolve(workspaceRoot)
  const nodeMajor = requireNodeMajor(nodeVersion)
  const localHostname = hostname()
  const localHostnameKey = hostnameKey(localHostname)
  const workspaceLease = normalizeWorkspaceLease(workspaceLeaseValue)
  const leasePathFor = instanceToken => join(resolvedWorkspaceRoot, `.promotion-process-v1-${instanceToken}.lease.json`)
  const leaseTempPathFor = instanceToken =>
    join(resolvedWorkspaceRoot, `.promotion-process-v1-${instanceToken}.lease.tmp`)
  const lifecycleOwner = Symbol('easypack-trusted-wrapper-author')
  let lifecycleState = 'open'
  let activeOperations = 0
  let resolveOperationsIdle
  let operationsIdle = Promise.resolve()
  let disposeTask

  const leaseNow = () => {
    const value = workspaceLease.now()
    if (!Number.isSafeInteger(value) || value < 0) {
      throw promotionError('promotion-build-invalid', 503, 'Promotion lease clock returned an invalid timestamp')
    }
    return value
  }

  const ensureWorkspaceRoot = async ({ create = true } = {}) => {
    if (create) await mkdir(resolvedWorkspaceRoot, { recursive: true })
    const stats = await lstatOrNull(resolvedWorkspaceRoot)
    if (!stats && !create) return false
    if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) {
      throw promotionError('path-escape', 400, 'Promotion workspace root must be a confined directory')
    }
    return true
  }

  const stateHasReferences = state => state.owners.size > 0 || state.activeWorkspaces.size > 0

  const writeCurrentProcessLease = async state => {
    if ((state.phase !== 'starting' && state.phase !== 'active') || !stateHasReferences(state)) return
    await ensureWorkspaceRoot()
    if ((state.phase !== 'starting' && state.phase !== 'active') || !stateHasReferences(state)) return
    const temporaryPath = leaseTempPathFor(PROCESS_INSTANCE_TOKEN)
    let handle
    try {
      handle = await open(
        temporaryPath,
        fileSystemConstants.O_CREAT | fileSystemConstants.O_WRONLY | fileSystemConstants.O_NOFOLLOW,
        0o600,
      )
      const stats = await handle.stat()
      if (!stats.isFile()) throw promotionError('path-escape', 400, 'Promotion process lease must be a regular file')
      const contents = Buffer.from(
        `${JSON.stringify({
          schemaVersion: PROCESS_LEASE_SCHEMA_VERSION,
          kind: PROCESS_LEASE_KIND,
          hostname: localHostname,
          hostnameKey: localHostnameKey,
          pid: process.pid,
          instanceToken: PROCESS_INSTANCE_TOKEN,
          heartbeatAt: leaseNow(),
        })}\n`,
      )
      await handle.truncate(0)
      await handle.write(contents, 0, contents.byteLength, 0)
      await handle.sync()
      await handle.close()
      handle = null
      await rename(temporaryPath, leasePathFor(PROCESS_INSTANCE_TOKEN))
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  const stopHeartbeat = state => {
    clearTimeout(state.timer)
    state.timer = null
  }

  const stopStateAfterHeartbeatFailure = (state, error) => {
    state.failure = error
    state.phase = 'failed'
    stopHeartbeat(state)
  }

  const scheduleHeartbeat = state => {
    if (state.phase !== 'active' || !stateHasReferences(state) || state.timer || state.writeTask) return
    state.timer = setTimeout(() => {
      state.timer = null
      if (state.phase !== 'active' || !stateHasReferences(state) || state.writeTask) return
      state.writeTask = writeCurrentProcessLease(state)
      void state.writeTask.then(
        () => {
          state.writeTask = null
          scheduleHeartbeat(state)
        },
        error => {
          state.writeTask = null
          stopStateAfterHeartbeatFailure(state, error)
        },
      )
    }, state.heartbeatMs)
    state.timer.unref?.()
  }

  const unlinkCurrentProcessLease = async () => {
    const leasePath = leasePathFor(PROCESS_INSTANCE_TOKEN)
    const firstStats = await lstatOrNull(leasePath)
    if (firstStats?.isFile() && !firstStats.isSymbolicLink()) {
      const firstLease = await readProcessLease(leasePath)
      const secondStats = await lstatOrNull(leasePath)
      const secondLease = await readProcessLease(leasePath)
      if (
        firstLease?.instanceToken === PROCESS_INSTANCE_TOKEN &&
        firstLease.hostname === localHostname &&
        firstLease.pid === process.pid &&
        sameFile(firstStats, secondStats) &&
        secondLease?.instanceToken === firstLease.instanceToken &&
        secondLease.heartbeatAt === firstLease.heartbeatAt
      ) {
        await unlink(leasePath).catch(error => {
          if (error?.code !== 'ENOENT') throw error
        })
      }
    }

    const temporaryPath = leaseTempPathFor(PROCESS_INSTANCE_TOKEN)
    const temporaryStats = await lstatOrNull(temporaryPath)
    if (temporaryStats?.isFile() && !temporaryStats.isSymbolicLink()) {
      await unlink(temporaryPath).catch(error => {
        if (error?.code !== 'ENOENT') throw error
      })
    }
  }

  const shutdownStateIfUnused = state => {
    if (stateHasReferences(state)) return Promise.resolve()
    if (state.shutdownTask) return state.shutdownTask
    state.shutdownTask = (async () => {
      if (stateHasReferences(state)) return
      state.phase = 'stopping'
      stopHeartbeat(state)
      await state.ready.catch(() => undefined)
      await state.writeTask?.catch(() => undefined)
      if (stateHasReferences(state)) {
        state.phase = 'active'
        scheduleHeartbeat(state)
        return
      }
      await unlinkCurrentProcessLease()
      state.phase = 'stopped'
      if (PROCESS_LEASE_STATES.get(resolvedWorkspaceRoot) === state) {
        PROCESS_LEASE_STATES.delete(resolvedWorkspaceRoot)
      }
    })().finally(() => {
      state.shutdownTask = null
    })
    return state.shutdownTask
  }

  const ensureCurrentProcessLease = async () => {
    let state = PROCESS_LEASE_STATES.get(resolvedWorkspaceRoot)
    if (state?.phase === 'stopping') {
      await state.shutdownTask
      state = PROCESS_LEASE_STATES.get(resolvedWorkspaceRoot)
    }
    if (state?.phase === 'stopped' || (state?.phase === 'failed' && !stateHasReferences(state))) {
      stopHeartbeat(state)
      if (PROCESS_LEASE_STATES.get(resolvedWorkspaceRoot) === state) PROCESS_LEASE_STATES.delete(resolvedWorkspaceRoot)
      state = undefined
    }
    if (state) {
      if (state.phase === 'failed') throw state.failure
      state.owners.add(lifecycleOwner)
    } else {
      state = {
        activeWorkspaces: new Set(),
        failure: null,
        heartbeatMs: workspaceLease.heartbeatMs,
        owners: new Set(),
        phase: 'starting',
        ready: null,
        shutdownTask: null,
        timer: null,
        writeTask: null,
      }
      state.owners.add(lifecycleOwner)
      state.writeTask = writeCurrentProcessLease(state)
      state.ready = state.writeTask.then(
        () => {
          state.writeTask = null
          state.phase = 'active'
          scheduleHeartbeat(state)
          return state
        },
        error => {
          state.writeTask = null
          stopStateAfterHeartbeatFailure(state, error)
          throw error
        },
      )
      PROCESS_LEASE_STATES.set(resolvedWorkspaceRoot, state)
    }
    try {
      return await state.ready
    } catch (error) {
      state.owners.delete(lifecycleOwner)
      await shutdownStateIfUnused(state).catch(() => undefined)
      throw error
    }
  }

  const beginLifecycleOperation = async () => {
    if (lifecycleState !== 'open') {
      throw promotionError('promotion-runtime-unavailable', 503, 'Local material promotion author is closed')
    }
    if (activeOperations === 0) {
      operationsIdle = new Promise(resolvePromise => {
        resolveOperationsIdle = resolvePromise
      })
    }
    activeOperations += 1
    try {
      return await ensureCurrentProcessLease()
    } catch (error) {
      activeOperations -= 1
      if (activeOperations === 0) {
        resolveOperationsIdle?.()
        resolveOperationsIdle = undefined
      }
      throw error
    }
  }

  const endLifecycleOperation = () => {
    activeOperations -= 1
    if (activeOperations === 0) {
      resolveOperationsIdle?.()
      resolveOperationsIdle = undefined
    }
  }

  const forgetActiveWorkspace = async buildDirectory => {
    const state = PROCESS_LEASE_STATES.get(resolvedWorkspaceRoot)
    if (!state) return
    state.activeWorkspaces.delete(buildDirectory)
    await shutdownStateIfUnused(state)
  }

  const ownerIsFresh = async ({ instanceToken, hostname: ownerHostname, pid, observedAt, createdAt, heartbeatAt }) => {
    if (instanceToken === PROCESS_INSTANCE_TOKEN) return true
    const processLease = await readProcessLease(leasePathFor(instanceToken))
    if (processLease?.instanceToken === instanceToken) {
      if (processLease.hostname === localHostname) {
        if (processLease.pid === process.pid) return false
        if (!processIsAlive(processLease.pid)) return false
      }
      return leaseNow() - processLease.heartbeatAt <= workspaceLease.staleAfterMs
    }
    if (ownerHostname === localHostname && Number.isSafeInteger(pid)) {
      if (pid === process.pid) return false
      if (!processIsAlive(pid)) return false
    }
    const lastObservedAt = observedAt ?? createdAt ?? heartbeatAt
    return Number.isFinite(lastObservedAt) && leaseNow() - lastObservedAt <= workspaceLease.staleAfterMs
  }

  const createWorkspace = async state => {
    await ensureWorkspaceRoot()
    const workspaceToken = randomUUID()
    const buildDirectory = await mkdtemp(
      join(resolvedWorkspaceRoot, `promotion-v2-${PROCESS_INSTANCE_TOKEN}-${workspaceToken}-`),
    )
    if (
      !isInside(resolvedWorkspaceRoot, buildDirectory) ||
      relative(resolvedWorkspaceRoot, buildDirectory).includes(sep)
    ) {
      throw promotionError('path-escape', 400, 'Promotion workspace escaped its configured root')
    }
    const workspaceName = basename(buildDirectory)
    const match = WORKSPACE_NAME_PATTERN.exec(workspaceName)
    if (!match || match[1] !== PROCESS_INSTANCE_TOKEN || match[2] !== workspaceToken) {
      await removeTreeWithoutFollowingSymlinks(buildDirectory).catch(() => undefined)
      throw promotionError('promotion-build-invalid', 503, 'Promotion workspace name is invalid')
    }
    try {
      await writeFile(
        join(buildDirectory, WORKSPACE_MARKER_FILE),
        `${JSON.stringify({
          schemaVersion: WORKSPACE_SCHEMA_VERSION,
          kind: WORKSPACE_KIND,
          hostname: localHostname,
          hostnameKey: localHostnameKey,
          pid: process.pid,
          instanceToken: PROCESS_INSTANCE_TOKEN,
          workspaceToken,
          workspaceName,
          createdAt: leaseNow(),
        })}\n`,
        { flag: 'wx', mode: 0o600 },
      )
      state.activeWorkspaces.add(buildDirectory)
      return buildDirectory
    } catch (error) {
      await removeTreeWithoutFollowingSymlinks(buildDirectory).catch(() => undefined)
      throw error
    }
  }

  const recoverQuarantinedWorkspace = async (entryName, signal) => {
    const match = RECOVERY_NAME_PATTERN.exec(entryName)
    if (!match || !WORKSPACE_NAME_PATTERN.test(match[3])) return false
    const quarantinePath = join(resolvedWorkspaceRoot, entryName)
    const firstStats = await lstatOrNull(quarantinePath)
    if (!firstStats || firstStats.isSymbolicLink() || !firstStats.isDirectory()) return false
    const owner = { instanceToken: match[1], observedAt: firstStats.mtimeMs }
    if (await ownerIsFresh(owner)) return false
    throwIfPromotionAborted(signal)
    const secondStats = await lstatOrNull(quarantinePath)
    if (!sameFile(firstStats, secondStats) || (await ownerIsFresh(owner))) return false
    await removeTreeWithoutFollowingSymlinks(quarantinePath)
    return true
  }

  const recoverWorkspace = async (entryName, signal) => {
    const match = WORKSPACE_NAME_PATTERN.exec(entryName)
    if (!match) return false
    const workspacePath = join(resolvedWorkspaceRoot, entryName)
    const firstStats = await lstatOrNull(workspacePath)
    if (!firstStats || firstStats.isSymbolicLink() || !firstStats.isDirectory()) return false

    const marker = await readWorkspaceMarker(join(workspacePath, WORKSPACE_MARKER_FILE))
    const owners = [{ instanceToken: match[1], observedAt: firstStats.mtimeMs }]
    if (marker && marker.instanceToken !== match[1]) owners.push(marker)
    else if (marker) owners[0] = marker
    for (const owner of owners) if (await ownerIsFresh(owner)) return false

    throwIfPromotionAborted(signal)
    const secondStats = await lstatOrNull(workspacePath)
    if (!sameFile(firstStats, secondStats)) return false
    for (const owner of owners) if (await ownerIsFresh(owner)) return false

    const quarantineName = `.promotion-recovery-v2-${PROCESS_INSTANCE_TOKEN}-${randomUUID()}-${entryName}`
    const quarantinePath = join(resolvedWorkspaceRoot, quarantineName)
    try {
      await rename(workspacePath, quarantinePath)
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw error
    }
    const movedStats = await lstatOrNull(quarantinePath)
    if (!sameFile(firstStats, movedStats)) {
      await rename(quarantinePath, workspacePath).catch(() => undefined)
      return false
    }
    await removeTreeWithoutFollowingSymlinks(quarantinePath)
    return true
  }

  const cleanupUnreferencedProcessLeases = async signal => {
    const entries = (await readdir(resolvedWorkspaceRoot)).sort()
    const referencedTokens = new Set([PROCESS_INSTANCE_TOKEN])
    for (const entryName of entries) {
      const workspaceMatch = WORKSPACE_NAME_PATTERN.exec(entryName)
      if (workspaceMatch) {
        referencedTokens.add(workspaceMatch[1])
        const workspacePath = join(resolvedWorkspaceRoot, entryName)
        const stats = await lstatOrNull(workspacePath)
        if (stats?.isDirectory() && !stats.isSymbolicLink()) {
          const marker = await readWorkspaceMarker(join(workspacePath, WORKSPACE_MARKER_FILE))
          if (marker) referencedTokens.add(marker.instanceToken)
        }
        continue
      }
      const recoveryMatch = RECOVERY_NAME_PATTERN.exec(entryName)
      if (recoveryMatch) referencedTokens.add(recoveryMatch[1])
    }
    for (const entryName of entries) {
      throwIfPromotionAborted(signal)
      const match = PROCESS_LEASE_NAME_PATTERN.exec(entryName) ?? PROCESS_LEASE_TEMP_NAME_PATTERN.exec(entryName)
      if (!match || referencedTokens.has(match[1])) continue
      const leasePath = join(resolvedWorkspaceRoot, entryName)
      const firstStats = await lstatOrNull(leasePath)
      if (!firstStats || firstStats.isSymbolicLink() || !firstStats.isFile()) continue
      const processLease = await readProcessLease(leasePath)
      const owner = processLease ?? { instanceToken: match[1], observedAt: firstStats.mtimeMs }
      if (await ownerIsFresh(owner)) continue
      const secondStats = await lstatOrNull(leasePath)
      const secondLease = await readProcessLease(leasePath)
      if (
        !sameFile(firstStats, secondStats) ||
        (processLease &&
          (!secondLease ||
            secondLease.instanceToken !== processLease.instanceToken ||
            secondLease.heartbeatAt !== processLease.heartbeatAt)) ||
        (await ownerIsFresh(secondLease ?? owner))
      ) {
        continue
      }
      await unlink(leasePath).catch(error => {
        if (error?.code !== 'ENOENT') throw error
      })
    }
  }

  return Object.freeze({
    async checkAvailability() {
      if (nodeMajor < 20) {
        return Object.freeze({
          schemaVersion: 1,
          available: false,
          reason: 'node-version',
          minimumNodeMajor: 20,
        })
      }
      const available = loadEasypack === loadEasypackRuntime ? await checkEasypackRuntimeReadiness() : true
      return Object.freeze({
        schemaVersion: 1,
        available,
        reason: available ? 'ready' : 'easypack-unavailable',
        minimumNodeMajor: 20,
      })
    },
    async recoverPromotionWorkspaces({ signal } = {}) {
      throwIfPromotionAborted(signal)
      if (!(await ensureWorkspaceRoot({ create: false }))) return Object.freeze([])
      await beginLifecycleOperation()
      try {
        const entries = (await readdir(resolvedWorkspaceRoot)).sort()
        const recovered = []
        for (const entryName of entries) {
          throwIfPromotionAborted(signal)
          if ((await recoverQuarantinedWorkspace(entryName, signal)) || (await recoverWorkspace(entryName, signal))) {
            recovered.push(entryName)
          }
        }
        await cleanupUnreferencedProcessLeases(signal)
        return Object.freeze(recovered)
      } finally {
        endLifecycleOperation()
      }
    },
    async authorPromotion({ principal, request, signal } = {}) {
      if (nodeMajor < 20) {
        throw promotionError('promotion-runtime-unavailable', 503, 'Local material promotion requires Node 20 or newer')
      }
      if (
        !principal ||
        typeof principal !== 'object' ||
        Array.isArray(principal) ||
        typeof principal.tenantId !== 'string' ||
        typeof principal.userId !== 'string'
      ) {
        throw promotionError('unauthorized', 403, 'Request is not authorized')
      }
      throwIfPromotionAborted(signal)
      let promotionRequest
      try {
        promotionRequest = validateMaterialPromotionCall(request)
      } catch {
        throw promotionError('invalid-request', 400, 'Request is invalid')
      }

      let artifact
      try {
        throwIfPromotionAborted(signal)
        artifact = await verifyArtifactRecordIntegrity(promotionRequest.artifact, { hashBytes })
        throwIfPromotionAborted(signal)
      } catch {
        throwIfPromotionAborted(signal)
        throw promotionError('artifact-integrity-mismatch', 409, 'Artifact integrity verification failed')
      }

      const materialIdentity = createCanonicalDurableMaterialIdentity(promotionRequest)

      throwIfPromotionAborted(signal)
      const leaseState = await beginLifecycleOperation()
      let buildDirectory
      try {
        buildDirectory = await createWorkspace(leaseState)
        throwIfPromotionAborted(signal)
        await mkdir(join(buildDirectory, 'src'))
        const packageManifest = {
          name: `@easy-editor/local-material-${packageSlug(artifact.logicalComponentId)}`,
          version: packageVersion(artifact.sourceRevision),
          private: true,
          type: 'module',
        }
        await Promise.all([
          writeFile(join(buildDirectory, 'package.json'), `${JSON.stringify(packageManifest, null, 2)}\n`),
          writeFile(join(buildDirectory, 'src/index.mjs'), trustedWrapperSource(artifact)),
        ])

        let easypack
        try {
          easypack = await loadEasypack({ signal })
          throwIfPromotionAborted(signal)
        } catch {
          throwIfPromotionAborted(signal)
          throw promotionError('promotion-runtime-unavailable', 503, 'Local material promotion is unavailable')
        }
        if (typeof easypack?.buildEasypack !== 'function') {
          throw promotionError('promotion-runtime-unavailable', 503, 'Local material promotion is unavailable')
        }
        let easypackResult
        try {
          throwIfPromotionAborted(signal)
          easypackResult = await easypack.buildEasypack({
            rootDir: buildDirectory,
            config: {
              preset: 'library',
              entry: { main: 'src/index.mjs' },
              output: {
                dir: 'dist',
                esm: true,
                cjs: false,
                umd: false,
                minify: false,
                sourcemap: false,
                types: false,
              },
            },
          })
          throwIfPromotionAborted(signal)
        } catch (error) {
          throwIfPromotionAborted(signal)
          if (error?.code && error?.status) throw error
          throw promotionError('promotion-build-failed', 503, 'Easypack failed to author the trusted wrapper', true)
        }

        // The build metadata selects outputs, while sizes and digests are recomputed from confined files.
        const files = await normalizeArtifactFiles(buildDirectory, easypackResult)
        throwIfPromotionAborted(signal)
        const entry = files.find(file => file.path === EASYPACK_ENTRY_FILE)
        const createdAt = now ? now() : artifact.createdAt
        if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
          throw promotionError('promotion-build-invalid', 503, 'Promotion clock returned an invalid timestamp')
        }
        return Object.freeze({
          schemaVersion: 1,
          promotionId: promotionRequest.promotionId,
          projectId: promotionRequest.projectId,
          materialId: materialIdentity.materialId,
          materialVersion: materialIdentity.materialVersion,
          logicalComponentId: artifact.logicalComponentId,
          buildIntegrity: entry.integrity,
          sourceRevision: Object.freeze(sourceRevisionOf(artifact)),
          dependencyLockDigest: artifact.dependencyLockDigest,
          entryFile: EASYPACK_ENTRY_FILE,
          buildDirectory,
          files: Object.freeze(files.map(file => Object.freeze(file))),
          createdAt,
        })
      } catch (error) {
        if (buildDirectory) {
          await removeTreeWithoutFollowingSymlinks(buildDirectory).catch(() => undefined)
          await forgetActiveWorkspace(buildDirectory).catch(() => undefined)
        }
        throw error
      } finally {
        endLifecycleOperation()
      }
    },
    async releasePromotion({ buildDirectory } = {}) {
      if (typeof buildDirectory !== 'string') return
      const resolvedBuildDirectory = resolve(buildDirectory)
      if (
        !isInside(resolvedWorkspaceRoot, resolvedBuildDirectory) ||
        resolvedBuildDirectory === resolvedWorkspaceRoot ||
        relative(resolvedWorkspaceRoot, resolvedBuildDirectory).includes(sep) ||
        !WORKSPACE_NAME_PATTERN.test(basename(resolvedBuildDirectory))
      ) {
        throw promotionError('path-escape', 400, 'Promotion workspace escaped its configured root')
      }
      const stats = await lstatOrNull(resolvedBuildDirectory)
      if (!stats) {
        await forgetActiveWorkspace(resolvedBuildDirectory)
        return
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw promotionError('path-escape', 400, 'Promotion workspace must be a confined directory')
      }
      const workspaceName = basename(resolvedBuildDirectory)
      const workspaceMatch = WORKSPACE_NAME_PATTERN.exec(workspaceName)
      const marker = await readWorkspaceMarker(join(resolvedBuildDirectory, WORKSPACE_MARKER_FILE))
      if (
        !workspaceMatch ||
        !marker ||
        marker.hostname !== localHostname ||
        marker.hostnameKey !== localHostnameKey ||
        marker.pid !== process.pid ||
        marker.instanceToken !== PROCESS_INSTANCE_TOKEN ||
        marker.workspaceName !== workspaceName ||
        marker.workspaceToken !== workspaceMatch[2]
      ) {
        throw promotionError('path-escape', 400, 'Promotion workspace ownership could not be verified')
      }
      await removeTreeWithoutFollowingSymlinks(resolvedBuildDirectory)
      await forgetActiveWorkspace(resolvedBuildDirectory)
    },
    async dispose() {
      if (disposeTask) return disposeTask
      lifecycleState = 'closing'
      disposeTask = (async () => {
        await operationsIdle
        const state = PROCESS_LEASE_STATES.get(resolvedWorkspaceRoot)
        if (state) {
          state.owners.delete(lifecycleOwner)
          await shutdownStateIfUnused(state)
        }
        lifecycleState = 'closed'
      })()
      return disposeTask
    },
  })
}
