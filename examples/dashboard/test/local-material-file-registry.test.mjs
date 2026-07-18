import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as nodeFileSystem from 'node:fs/promises'
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { createFileMaterialRegistry } from '../server/promotion/file-material-registry.mjs'

const ENTRY_SOURCE = `
export default {
  mount(root) { root.textContent = 'durable KPI' },
  update() {},
  destroy(root) { root.replaceChildren() },
}
`.trim()

const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const digest = character => `sha256:${character.repeat(64)}`
const storageKeyForPromotion = promotionId => createHash('sha256').update(promotionId).digest('hex')

const materialIdentity = (
  materialId = 'material-kpi',
  materialVersion = '1.0.0',
  buildIntegrity = sha256(ENTRY_SOURCE),
) => ({
  materialId,
  materialVersion,
  buildIntegrity,
})

const promotionRequest = ({
  buildDirectory,
  promotionId = 'promotion-kpi-v1',
  materialId = 'material-kpi',
  materialVersion = '1.0.0',
  buildIntegrity = sha256(ENTRY_SOURCE),
  entryFile = 'index.mjs',
  files,
  sourceRevision = 'revision-7',
} = {}) => {
  const bytes = Buffer.from(ENTRY_SOURCE)
  return {
    schemaVersion: 1,
    promotionId,
    projectId: 'project-1',
    materialId,
    materialVersion,
    logicalComponentId: 'logical-kpi',
    buildIntegrity,
    sourceRevision: {
      artifactId: 'artifact-kpi',
      sourceRevision,
      logicalComponentId: 'logical-kpi',
      sourceIntegrity: digest('a'),
    },
    dependencyLockDigest: digest('b'),
    entryFile,
    buildDirectory,
    files: files ?? [{ path: entryFile, byteLength: bytes.byteLength, integrity: sha256(bytes) }],
    createdAt: 100,
  }
}

const createFixture = async (t, options = {}) => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-material-registry-'))
  const rootDir = join(fixtureDirectory, 'configured-registry-root')
  const buildDirectory = join(fixtureDirectory, 'trusted-build-output')
  await mkdir(buildDirectory, { recursive: true })
  await writeFile(join(buildDirectory, 'index.mjs'), ENTRY_SOURCE)
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }))
  const registry = await createFileMaterialRegistry({ rootDir, ...options })
  return { fixtureDirectory, rootDir, buildDirectory, registry }
}

const assertRegistryError =
  (...codes) =>
  error => {
    assert.ok(error && typeof error === 'object')
    assert.ok(codes.includes(error.code), `expected ${codes.join(' or ')}, received ${error.code}`)
    return true
  }

const findFileNamed = async (directory, fileName) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findFileNamed(path, fileName)
      if (nested) return nested
    } else if (entry.isFile() && entry.name === fileName) {
      return path
    }
  }
  return null
}

test('configured registry stages invisibly, publishes atomically, and is idempotent by promotionId', async t => {
  const { buildDirectory, registry, rootDir } = await createFixture(t)
  const request = promotionRequest({ buildDirectory })
  const identity = materialIdentity()

  const firstStage = await registry.stagePromotion(request)
  const secondStage = await registry.stagePromotion(request)
  assert.deepEqual(secondStage, firstStage)
  assert.equal(await registry.readMaterial(identity), null)
  assert.deepEqual(await registry.listMaterials({ projectId: request.projectId }), [])

  const firstPublish = await registry.publishPromotion({ promotionId: request.promotionId })
  const secondPublish = await registry.publishPromotion({ promotionId: request.promotionId })
  assert.deepEqual(secondPublish, firstPublish)

  const published = await registry.readMaterial(identity)
  assert.equal(published.promotionId, request.promotionId)
  assert.equal(published.materialId, request.materialId)
  assert.equal(published.materialVersion, request.materialVersion)
  assert.equal(published.buildIntegrity, request.buildIntegrity)
  assert.deepEqual(await registry.listMaterials({ projectId: request.projectId }), [published])
  const persistedEntry = await findFileNamed(rootDir, 'index.mjs')
  assert.ok(persistedEntry, 'the configured registry root must contain the published build')
  assert.equal(await readFile(persistedEntry, 'utf8'), ENTRY_SOURCE)

  await assert.rejects(
    registry.stagePromotion({ ...request, dependencyLockDigest: digest('c') }),
    assertRegistryError('promotion-conflict', 'idempotency-conflict'),
  )
})

test('a fresh process view rebuilds the published index and recovers an unpublished promotion', async t => {
  const { buildDirectory, registry, rootDir } = await createFixture(t)
  const publishedRequest = promotionRequest({ buildDirectory })
  await registry.stagePromotion(publishedRequest)
  await registry.publishPromotion({ promotionId: publishedRequest.promotionId })

  const pendingDirectory = join(buildDirectory, 'pending')
  await mkdir(pendingDirectory)
  await writeFile(join(pendingDirectory, 'index.mjs'), ENTRY_SOURCE)
  const pendingRequest = promotionRequest({
    buildDirectory: pendingDirectory,
    promotionId: 'promotion-kpi-v2',
    materialVersion: '2.0.0',
    sourceRevision: 'revision-8',
  })
  await registry.stagePromotion(pendingRequest)

  const restarted = await createFileMaterialRegistry({ rootDir })
  const rebuilt = await restarted.rebuildIndex()
  assert.ok(rebuilt.materials.some(entry => entry.promotionId === publishedRequest.promotionId))
  assert.ok(rebuilt.pendingPromotions.some(entry => entry.promotionId === pendingRequest.promotionId))
  assert.equal((await restarted.readMaterial(materialIdentity())).promotionId, publishedRequest.promotionId)
  assert.equal(await restarted.readMaterial(materialIdentity('material-kpi', '2.0.0')), null)

  const recovered = await restarted.recoverPendingPromotions()
  assert.ok(recovered.some(entry => entry.promotionId === pendingRequest.promotionId))
  await restarted.publishPromotion({ promotionId: pendingRequest.promotionId })
  assert.equal(
    (await restarted.readMaterial(materialIdentity('material-kpi', '2.0.0'))).promotionId,
    pendingRequest.promotionId,
  )
})

test('build paths are confined and symlinks are never followed into registry bytes', async t => {
  const { buildDirectory, fixtureDirectory, registry } = await createFixture(t)
  const outsideFile = join(fixtureDirectory, 'outside.mjs')
  await writeFile(outsideFile, 'outside bytes must remain outside the registry')

  await assert.rejects(
    registry.stagePromotion(
      promotionRequest({
        buildDirectory,
        promotionId: 'promotion-path-traversal',
        files: [
          {
            path: '../outside.mjs',
            byteLength: 46,
            integrity: sha256('outside bytes must remain outside the registry'),
          },
        ],
      }),
    ),
    assertRegistryError('path-escape', 'registry-path-escape'),
  )
  assert.equal(await readFile(outsideFile, 'utf8'), 'outside bytes must remain outside the registry')

  const linkedEntry = join(buildDirectory, 'linked-entry.mjs')
  await symlink(outsideFile, linkedEntry)
  await assert.rejects(
    registry.stagePromotion(
      promotionRequest({
        buildDirectory,
        promotionId: 'promotion-symlink',
        buildIntegrity: sha256('outside bytes must remain outside the registry'),
        entryFile: basename(linkedEntry),
        files: [
          {
            path: basename(linkedEntry),
            byteLength: Buffer.byteLength('outside bytes must remain outside the registry'),
            integrity: sha256('outside bytes must remain outside the registry'),
          },
        ],
      }),
    ),
    assertRegistryError('symlink-disallowed', 'registry-symlink-disallowed', 'path-escape', 'registry-path-escape'),
  )
  assert.deepEqual(await registry.listMaterials({ projectId: 'project-1' }), [])
})

test('EXDEV rejects publication instead of degrading atomic rename to copy and delete', async t => {
  const exdev = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
  const fileSystem = {
    ...nodeFileSystem,
    async rename(source, destination) {
      if (basename(destination) === 'published.json') throw exdev
      return nodeFileSystem.rename(source, destination)
    },
  }
  const { buildDirectory, registry } = await createFixture(t, { fileSystem })
  const request = promotionRequest({ buildDirectory, promotionId: 'promotion-exdev' })

  const staged = await registry.stagePromotion(request)
  assert.equal(staged.state, 'manifest-staged')
  await assert.rejects(
    registry.publishPromotion({ promotionId: request.promotionId }),
    assertRegistryError('cross-device', 'registry-cross-device'),
  )
  assert.equal(await registry.readMaterial(materialIdentity()), null)
})

test('backup export is independently verifiable and detects tampered build bytes', async t => {
  const { buildDirectory, fixtureDirectory, registry } = await createFixture(t)
  const request = promotionRequest({ buildDirectory })
  await registry.stagePromotion(request)
  await registry.publishPromotion({ promotionId: request.promotionId })

  const destinationDir = join(fixtureDirectory, 'registry-backup')
  await registry.exportBackup({ destinationDir })
  const verified = await registry.verifyBackup({ backupDirectory: destinationDir })
  assert.equal(verified.valid, true)
  assert.deepEqual(
    verified.materials.map(entry => materialIdentity(entry.materialId, entry.materialVersion, entry.buildIntegrity)),
    [materialIdentity()],
  )

  const exportedEntry = await findFileNamed(destinationDir, 'index.mjs')
  assert.ok(exportedEntry, 'backup must contain the published entry bytes')
  await writeFile(exportedEntry, `${ENTRY_SOURCE}\n// tampered backup`)
  await assert.rejects(
    registry.verifyBackup({ backupDirectory: destinationDir }),
    assertRegistryError('backup-integrity-mismatch', 'integrity-mismatch'),
  )
})

test('GC is dry-run fenced and deletes an old build only after every caller-provided root is released', async t => {
  const { buildDirectory, registry } = await createFixture(t)
  const v1 = promotionRequest({ buildDirectory })
  await registry.stagePromotion(v1)
  await registry.publishPromotion({ promotionId: v1.promotionId })

  const v2Directory = join(buildDirectory, 'v2')
  await mkdir(v2Directory)
  await writeFile(join(v2Directory, 'index.mjs'), ENTRY_SOURCE)
  const v2 = promotionRequest({
    buildDirectory: v2Directory,
    promotionId: 'promotion-kpi-v2',
    materialVersion: '2.0.0',
    sourceRevision: 'revision-8',
  })
  await registry.stagePromotion(v2)
  await registry.publishPromotion({ promotionId: v2.promotionId })

  const v1Identity = materialIdentity()
  const v2Identity = materialIdentity('material-kpi', '2.0.0')
  const retainedPlan = await registry.planGarbageCollection({ retainedMaterialRefs: [v2Identity, v1Identity] })
  assert.deepEqual(retainedPlan.deletionCandidates, [])

  const releasedPlan = await registry.planGarbageCollection({ retainedMaterialRefs: [v2Identity] })
  assert.deepEqual(releasedPlan.deletionCandidates, [v1Identity])
  assert.notEqual(await registry.readMaterial(v1Identity), null, 'dry-run must not mutate the registry')
  const swept = await registry.sweepGarbageCollection(releasedPlan)
  assert.deepEqual(swept.deletedMaterials, [v1Identity])
  assert.equal(await registry.readMaterial(v1Identity), null)
  assert.notEqual(await registry.readMaterial(v2Identity), null)
})

test('read and list refresh across independently created registry instances', async t => {
  const { buildDirectory, registry, rootDir } = await createFixture(t)
  const observer = await createFileMaterialRegistry({ rootDir })
  const request = promotionRequest({ buildDirectory, promotionId: 'promotion-cross-process' })

  await registry.stagePromotion(request)
  assert.equal(await observer.readMaterial(materialIdentity()), null)
  await registry.publishPromotion({ promotionId: request.promotionId })

  assert.equal((await observer.readMaterial(materialIdentity())).promotionId, request.promotionId)
  assert.deepEqual(
    (await observer.listMaterials({ projectId: request.projectId })).map(entry => entry.promotionId),
    [request.promotionId],
  )
})

test('readMaterial propagates pre-abort and an abort during registry refresh', async t => {
  let pauseRefresh = false
  let refreshPaused = false
  let enterRefresh
  let releaseRefresh
  const refreshEntered = new Promise(resolvePromise => {
    enterRefresh = resolvePromise
  })
  const refreshGate = new Promise(resolvePromise => {
    releaseRefresh = resolvePromise
  })
  const fileSystem = {
    ...nodeFileSystem,
    async readdir(path, ...args) {
      if (pauseRefresh && !refreshPaused && basename(path) === 'promotions') {
        refreshPaused = true
        enterRefresh()
        await refreshGate
      }
      return nodeFileSystem.readdir(path, ...args)
    },
  }
  const { registry } = await createFixture(t, { fileSystem })

  const preAborted = new AbortController()
  preAborted.abort()
  await assert.rejects(
    registry.readMaterial(materialIdentity(), { signal: preAborted.signal }),
    assertRegistryError('promotion-aborted'),
  )

  pauseRefresh = true
  const inFlight = new AbortController()
  const readPromise = registry.readMaterial(materialIdentity(), { signal: inFlight.signal })
  await refreshEntered
  inFlight.abort()
  releaseRefresh()
  await assert.rejects(readPromise, assertRegistryError('promotion-aborted'))
})

test('read and list retry a concurrent GC rename but still surface stable record corruption', async t => {
  const exercise = async (nestedTest, operation, racePoint) => {
    const { buildDirectory, registry, rootDir } = await createFixture(nestedTest)
    const v1 = promotionRequest({
      buildDirectory,
      promotionId: `promotion-concurrent-gc-${racePoint}-${operation}-v1`,
    })
    const v2Directory = join(buildDirectory, `concurrent-gc-${racePoint}-${operation}-v2`)
    await mkdir(v2Directory)
    await writeFile(join(v2Directory, 'index.mjs'), ENTRY_SOURCE)
    const v2 = promotionRequest({
      buildDirectory: v2Directory,
      promotionId: `promotion-concurrent-gc-${racePoint}-${operation}-v2`,
      materialVersion: '2.0.0',
      sourceRevision: `revision-concurrent-gc-${racePoint}-${operation}-v2`,
    })
    await registry.stagePromotion(v1)
    await registry.publishPromotion({ promotionId: v1.promotionId })
    await registry.stagePromotion(v2)
    await registry.publishPromotion({ promotionId: v2.promotionId })
    const plan = await registry.planGarbageCollection({
      retainedMaterialRefs: [materialIdentity('material-kpi', '2.0.0')],
    })

    const v1EntryPath = join(rootDir, 'promotions', storageKeyForPromotion(v1.promotionId), 'build', 'index.mjs')
    const v2EntryPath = join(rootDir, 'promotions', storageKeyForPromotion(v2.promotionId), 'build', 'index.mjs')
    let triggerConcurrentGc = false
    let gcTriggered = false
    let stableOpenFailure = false
    let stableOpenAttempts = 0
    const triggerGc = async path => {
      if (!triggerConcurrentGc || gcTriggered || path !== v1EntryPath) return
      gcTriggered = true
      await registry.sweepGarbageCollection(plan)
    }
    const observer = await createFileMaterialRegistry({
      rootDir,
      fileSystem: {
        ...nodeFileSystem,
        async lstat(path, ...args) {
          if (racePoint === 'lstat') await triggerGc(path)
          return nodeFileSystem.lstat(path, ...args)
        },
        async open(path, ...args) {
          if (racePoint === 'open') await triggerGc(path)
          if (stableOpenFailure && path === v2EntryPath) {
            stableOpenAttempts += 1
            throw Object.assign(new Error('stable record disappeared before open'), { code: 'ENOENT' })
          }
          return nodeFileSystem.open(path, ...args)
        },
      },
    })
    triggerConcurrentGc = true

    const result =
      operation === 'read'
        ? await observer.readMaterial(materialIdentity('material-kpi', '2.0.0'))
        : await observer.listMaterials({ projectId: v2.projectId })
    assert.equal(gcTriggered, true)
    if (operation === 'read') assert.equal(result.promotionId, v2.promotionId)
    else
      assert.deepEqual(
        result.map(entry => entry.promotionId),
        [v2.promotionId],
      )

    if (racePoint === 'open') stableOpenFailure = true
    else await rm(v2EntryPath, { force: true })
    const corruptedRead =
      operation === 'read'
        ? observer.readMaterial(materialIdentity('material-kpi', '2.0.0'))
        : observer.listMaterials({ projectId: v2.projectId })
    await assert.rejects(corruptedRead, assertRegistryError('registry-record-not-found'))
    if (racePoint === 'open') assert.equal(stableOpenAttempts, 1, 'stable ENOENT must not be retried')
  }

  for (const racePoint of ['lstat', 'open']) {
    await t.test(`${racePoint}: readMaterial`, nestedTest => exercise(nestedTest, 'read', racePoint))
    await t.test(`${racePoint}: listMaterials`, nestedTest => exercise(nestedTest, 'list', racePoint))
  }
})

test('GC generation includes pending promotions and durable retained roots', async t => {
  const { buildDirectory, registry, rootDir } = await createFixture(t)
  const v1 = promotionRequest({ buildDirectory })
  await registry.stagePromotion(v1)
  await registry.publishPromotion({ promotionId: v1.promotionId })

  const v2Directory = join(buildDirectory, 'generation-v2')
  await mkdir(v2Directory)
  await writeFile(join(v2Directory, 'index.mjs'), ENTRY_SOURCE)
  const v2 = promotionRequest({
    buildDirectory: v2Directory,
    promotionId: 'promotion-generation-v2',
    materialVersion: '2.0.0',
    sourceRevision: 'revision-generation-v2',
  })
  await registry.stagePromotion(v2)
  await registry.publishPromotion({ promotionId: v2.promotionId })

  const v1Identity = materialIdentity()
  const v2Identity = materialIdentity('material-kpi', '2.0.0')
  const beforePending = await registry.planGarbageCollection({ retainedMaterialRefs: [v2Identity] })

  const v3Directory = join(buildDirectory, 'generation-v3')
  await mkdir(v3Directory)
  await writeFile(join(v3Directory, 'index.mjs'), ENTRY_SOURCE)
  const v3 = promotionRequest({
    buildDirectory: v3Directory,
    promotionId: 'promotion-generation-v3',
    materialVersion: '3.0.0',
    sourceRevision: 'revision-generation-v3',
  })
  await registry.stagePromotion(v3)
  await assert.rejects(registry.sweepGarbageCollection(beforePending), assertRegistryError('gc-generation-conflict'))

  const pendingAware = await registry.planGarbageCollection({ retainedMaterialRefs: [v2Identity] })
  assert.deepEqual(pendingAware.deletionCandidates, [v1Identity])
  const restarted = await createFileMaterialRegistry({ rootDir })
  const rootsChanged = await restarted.planGarbageCollection({ retainedMaterialRefs: [v2Identity, v1Identity] })
  assert.notEqual(rootsChanged.generation, pendingAware.generation)
  await assert.rejects(registry.sweepGarbageCollection(pendingAware), assertRegistryError('gc-generation-conflict'))
})

test('build budgets reject before source I/O and accepted builds are streamed', async t => {
  let budgetSourceOpens = 0
  const budgetFileSystem = {
    ...nodeFileSystem,
    async open(path, ...args) {
      if (String(path).includes('trusted-build-output')) budgetSourceOpens += 1
      return nodeFileSystem.open(path, ...args)
    },
  }
  const budgetFixture = await createFixture(t, {
    fileSystem: budgetFileSystem,
    limits: { maxFileBytes: 1, maxFiles: 8, maxTotalBytes: 8 },
  })
  budgetSourceOpens = 0
  await assert.rejects(
    budgetFixture.registry.stagePromotion(promotionRequest({ buildDirectory: budgetFixture.buildDirectory })),
    assertRegistryError('registry-budget-exceeded'),
  )
  assert.equal(budgetSourceOpens, 0)

  let streamedSourceOpens = 0
  const streamingFileSystem = {
    ...nodeFileSystem,
    async readFile(path, ...args) {
      if (String(path).includes('trusted-build-output')) {
        throw new Error('artifact bytes must not use whole-file readFile')
      }
      return nodeFileSystem.readFile(path, ...args)
    },
    async open(path, ...args) {
      if (String(path).includes('trusted-build-output')) streamedSourceOpens += 1
      return nodeFileSystem.open(path, ...args)
    },
  }
  const streamingFixture = await createFixture(t, { fileSystem: streamingFileSystem })
  const request = promotionRequest({
    buildDirectory: streamingFixture.buildDirectory,
    promotionId: 'promotion-streamed-source',
  })
  await streamingFixture.registry.stagePromotion(request)
  await streamingFixture.registry.publishPromotion({ promotionId: request.promotionId })
  assert.ok(streamedSourceOpens > 0)
})

test('workspace escapes, hardlinks, and pre-open inode swaps are rejected', async t => {
  const { buildDirectory, fixtureDirectory, registry } = await createFixture(t)
  const outsideDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-registry-outside-workspace-'))
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }))
  await writeFile(join(outsideDirectory, 'index.mjs'), ENTRY_SOURCE)
  await assert.rejects(
    registry.stagePromotion(
      promotionRequest({ buildDirectory: outsideDirectory, promotionId: 'promotion-workspace-escape' }),
    ),
    assertRegistryError('registry-workspace-escape'),
  )

  const hardlinkedEntry = join(buildDirectory, 'hardlinked-entry.mjs')
  await link(join(buildDirectory, 'index.mjs'), hardlinkedEntry)
  await assert.rejects(
    registry.stagePromotion(
      promotionRequest({
        buildDirectory,
        entryFile: basename(hardlinkedEntry),
        files: [
          {
            path: basename(hardlinkedEntry),
            byteLength: Buffer.byteLength(ENTRY_SOURCE),
            integrity: sha256(ENTRY_SOURCE),
          },
        ],
        promotionId: 'promotion-hardlink',
      }),
    ),
    assertRegistryError('registry-hardlink-disallowed'),
  )

  let swapped = false
  const swappingFileSystem = {
    ...nodeFileSystem,
    async open(path, ...args) {
      if (!swapped && String(path).endsWith('trusted-build-output/index.mjs')) {
        swapped = true
        await rename(path, `${path}.before-swap`)
        await writeFile(path, ENTRY_SOURCE)
      }
      return nodeFileSystem.open(path, ...args)
    },
  }
  const swapRoot = join(fixtureDirectory, 'swap-registry')
  const swapBuild = join(fixtureDirectory, 'swap-workspace')
  await mkdir(swapBuild)
  await writeFile(join(swapBuild, 'index.mjs'), ENTRY_SOURCE)
  const physicalSwapEntry = await realpath(join(swapBuild, 'index.mjs'))
  const swappingRegistry = await createFileMaterialRegistry({
    rootDir: swapRoot,
    workspaceRoot: fixtureDirectory,
    fileSystem: {
      ...swappingFileSystem,
      async open(path, ...args) {
        if (!swapped && path === physicalSwapEntry) {
          swapped = true
          await rename(path, `${path}.before-swap`)
          await writeFile(path, ENTRY_SOURCE)
        }
        return nodeFileSystem.open(path, ...args)
      },
    },
  })
  await assert.rejects(
    swappingRegistry.stagePromotion(
      promotionRequest({ buildDirectory: swapBuild, promotionId: 'promotion-inode-swap' }),
    ),
    assertRegistryError('registry-source-changed'),
  )
  assert.equal(swapped, true)
})

test('new nested registry directories are mode 0700 and fsynced bottom-up', async t => {
  const syncedDirectories = []
  const fileSystem = {
    ...nodeFileSystem,
    async open(path, flags, ...args) {
      const handle = await nodeFileSystem.open(path, flags, ...args)
      if (flags !== 'r') return handle
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'sync') {
            return async () => {
              syncedDirectories.push(String(path))
              return target.sync()
            }
          }
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  }
  const { buildDirectory, registry, rootDir } = await createFixture(t, { fileSystem })
  const nestedSource = 'export const nested = true'
  const nestedDirectory = join(buildDirectory, 'assets', 'nested')
  await mkdir(nestedDirectory, { recursive: true })
  await writeFile(join(nestedDirectory, 'chunk.mjs'), nestedSource)
  syncedDirectories.length = 0
  const entryBytes = Buffer.from(ENTRY_SOURCE)
  const nestedBytes = Buffer.from(nestedSource)
  await registry.stagePromotion(
    promotionRequest({
      buildDirectory,
      promotionId: 'promotion-nested-fsync',
      files: [
        { path: 'index.mjs', byteLength: entryBytes.byteLength, integrity: sha256(entryBytes) },
        {
          path: 'assets/nested/chunk.mjs',
          byteLength: nestedBytes.byteLength,
          integrity: sha256(nestedBytes),
        },
      ],
    }),
  )

  const persistedChunk = await findFileNamed(rootDir, 'chunk.mjs')
  assert.ok(persistedChunk)
  const persistedNested = dirname(persistedChunk)
  const persistedAssets = dirname(persistedNested)
  assert.equal((await stat(persistedNested)).mode & 0o777, 0o700)
  assert.equal((await stat(persistedAssets)).mode & 0o777, 0o700)
  const nestedSync = syncedDirectories.findIndex(path => path.endsWith('/build/assets/nested'))
  const assetsSync = syncedDirectories.findIndex((path, index) => index > nestedSync && path.endsWith('/build/assets'))
  assert.ok(nestedSync >= 0, 'the deepest newly created directory must be fsynced')
  assert.ok(assetsSync > nestedSync, 'new ancestors must be fsynced from deepest to shallowest')
})

test('live local PIDs are not reclaimed and a tampered fence cancels mutation', async t => {
  const lease = { acquireTimeoutMs: 60, heartbeatMs: 10, staleAfterMs: 30 }
  const liveFixture = await createFixture(t, { lease })
  const lockPath = join(liveFixture.rootDir, '.registry.lock')
  await writeFile(
    lockPath,
    `${JSON.stringify({ fence: 1, hostname: hostname(), pid: process.pid, token: 'unrelated-live-owner' })}\n`,
  )
  const oldHeartbeat = new Date(Date.now() - 60_000)
  await utimes(lockPath, oldHeartbeat, oldHeartbeat)
  await assert.rejects(
    liveFixture.registry.stagePromotion(promotionRequest({ buildDirectory: liveFixture.buildDirectory })),
    assertRegistryError('registry-locked'),
  )

  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-registry-fence-tamper-'))
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }))
  const rootDir = join(fixtureDirectory, 'registry')
  const buildDirectory = join(fixtureDirectory, 'build')
  await mkdir(buildDirectory)
  await writeFile(join(buildDirectory, 'index.mjs'), ENTRY_SOURCE)
  const fencePath = join(rootDir, '.registry-fence.json')
  let tampered = false
  const registry = await createFileMaterialRegistry({
    rootDir,
    workspaceRoot: fixtureDirectory,
    checkpoint: async event => {
      if (tampered || event.name !== 'after-stage-fsync-before-stage-rename') return
      tampered = true
      const fence = JSON.parse(await readFile(fencePath, 'utf8'))
      await writeFile(fencePath, `${JSON.stringify({ ...fence, fence: fence.fence + 1 })}\n`)
    },
  })
  const request = promotionRequest({ buildDirectory, promotionId: 'promotion-fence-tamper' })
  await assert.rejects(registry.stagePromotion(request), assertRegistryError('registry-lease-lost'))
  assert.equal(await registry.readMaterial(materialIdentity()), null)
  const restarted = await createFileMaterialRegistry({ rootDir, workspaceRoot: fixtureDirectory })
  assert.deepEqual(await restarted.recoverPendingPromotions(), [])
})
