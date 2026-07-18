import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createFileMaterialRegistry } from '../server/promotion/file-material-registry.mjs'

const childFixturePath = fileURLToPath(new URL('./fixtures/local-material-registry-child.mjs', import.meta.url))
const ENTRY_SOURCE = `export default { mount(root) { root.textContent = 'durable KPI' }, update() {}, destroy() {} }`
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const digest = character => `sha256:${character.repeat(64)}`
const ATOMIC_TEMPORARY_PATTERNS = Object.freeze({
  fence: /^\.registry-fence\.json\.\d+\.[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.tmp$/u,
  index: /^\.registry-index\.json\.\d+\.[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.tmp$/u,
  published: /^\.published\.json\.\d+\.[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.tmp$/u,
})

const promotionRequest = ({
  buildDirectory,
  promotionId = 'promotion-crash-v1',
  materialVersion = '1.0.0',
  sourceRevision = 'revision-7',
} = {}) => {
  const bytes = Buffer.from(ENTRY_SOURCE)
  return {
    schemaVersion: 1,
    promotionId,
    projectId: 'project-1',
    materialId: 'material-crash-kpi',
    materialVersion,
    logicalComponentId: 'logical-crash-kpi',
    buildIntegrity: sha256(bytes),
    sourceRevision: {
      artifactId: 'artifact-crash-kpi',
      sourceRevision,
      logicalComponentId: 'logical-crash-kpi',
      sourceIntegrity: digest('a'),
    },
    dependencyLockDigest: digest('b'),
    entryFile: 'index.mjs',
    buildDirectory,
    files: [{ path: 'index.mjs', byteLength: bytes.byteLength, integrity: sha256(bytes) }],
    createdAt: 100,
  }
}

const identityFor = request => ({
  materialId: request.materialId,
  materialVersion: request.materialVersion,
  buildIntegrity: request.buildIntegrity,
})

const assertRegistryError = code => error => {
  assert.equal(error?.code, code)
  return true
}

const waitForMessage = (child, predicate, timeoutMs = 5_000) =>
  new Promise((resolve, reject) => {
    const stdout = []
    const stderr = []
    child.stdout?.on('data', chunk => stdout.push(chunk))
    child.stderr?.on('data', chunk => stderr.push(chunk))
    const cleanup = () => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    const onMessage = message => {
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(
        new Error(
          `registry child exited before expected message (code=${code}, signal=${signal})\n${Buffer.concat(stdout).toString()}${Buffer.concat(stderr).toString()}`,
        ),
      )
    }
    const onError = error => {
      cleanup()
      reject(error)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          `timed out waiting for registry child\n${Buffer.concat(stdout).toString()}${Buffer.concat(stderr).toString()}`,
        ),
      )
    }, timeoutMs)
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })

const waitForExit = child =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
    : new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => resolve({ code, signal }))
      })

const startChild = (children, config) => {
  const child = fork(childFixturePath, [], {
    env: {
      ...process.env,
      EASY_EDITOR_REGISTRY_CHILD_CONFIG: JSON.stringify(config),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

const killChild = async child => {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  const exit = await waitForExit(child)
  assert.equal(exit.signal, 'SIGKILL')
}

const runChild = async (children, config) => {
  const child = startChild(children, config)
  const message = await waitForMessage(child, value => value?.type === 'result' || value?.type === 'error')
  await waitForExit(child)
  return message
}

const createFixture = async t => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-material-registry-crash-'))
  const rootDir = join(fixtureDirectory, 'registry')
  const children = new Set()
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await waitForExit(child).catch(() => undefined)
    }
    await rm(fixtureDirectory, { recursive: true, force: true })
  })
  const makeBuild = async name => {
    const buildDirectory = join(fixtureDirectory, name)
    await mkdir(buildDirectory, { recursive: true })
    await writeFile(join(buildDirectory, 'index.mjs'), ENTRY_SOURCE)
    return buildDirectory
  }
  const registry = await createFileMaterialRegistry({ rootDir })
  return { children, makeBuild, registry, rootDir }
}

test('SIGKILL before and after atomic manifest rename recovers to invisible-staged or fully-published state', async t => {
  const { children, makeBuild, registry, rootDir } = await createFixture(t)

  await t.test('kill before rename leaves no visible material and the same promotionId resumes', async () => {
    const request = promotionRequest({ buildDirectory: await makeBuild('build-before-rename') })
    await registry.stagePromotion(request)
    const child = startChild(children, {
      action: 'publish',
      rootDir,
      promotionId: request.promotionId,
      pauseAtCheckpoint: 'before-manifest-rename',
    })
    await waitForMessage(
      child,
      message => message?.type === 'checkpoint' && message.checkpoint?.name === 'before-manifest-rename',
    )
    await killChild(child)

    const restarted = await createFileMaterialRegistry({ rootDir })
    const promotionDirectory = join(
      rootDir,
      'promotions',
      (await readdir(join(rootDir, 'promotions'))).find(name => !name.startsWith('.')),
    )
    const publishedDecoy = '.published.json.12.not-a-uuid.tmp'
    await writeFile(join(promotionDirectory, publishedDecoy), 'preserve me')
    assert.ok((await readdir(promotionDirectory)).some(name => ATOMIC_TEMPORARY_PATTERNS.published.test(name)))
    const rebuilt = await restarted.rebuildIndex()
    assert.equal(await restarted.readMaterial(identityFor(request)), null)
    assert.ok(rebuilt.pendingPromotions.some(entry => entry.promotionId === request.promotionId))
    assert.ok((await restarted.recoverPendingPromotions()).some(entry => entry.promotionId === request.promotionId))
    assert.equal(
      (await readdir(promotionDirectory)).some(name => ATOMIC_TEMPORARY_PATTERNS.published.test(name)),
      false,
    )
    assert.ok((await readdir(promotionDirectory)).includes(publishedDecoy))
    await restarted.publishPromotion({ promotionId: request.promotionId })
    assert.equal((await restarted.readMaterial(identityFor(request))).promotionId, request.promotionId)
  })

  await t.test('kill after rename rebuilds one visible material and repeat publish stays idempotent', async () => {
    const request = promotionRequest({
      buildDirectory: await makeBuild('build-after-rename'),
      promotionId: 'promotion-crash-v2',
      materialVersion: '2.0.0',
      sourceRevision: 'revision-8',
    })
    await registry.stagePromotion(request)
    const child = startChild(children, {
      action: 'publish',
      rootDir,
      promotionId: request.promotionId,
      pauseAtCheckpoint: 'after-manifest-rename-before-index-activation',
    })
    await waitForMessage(
      child,
      message =>
        message?.type === 'checkpoint' && message.checkpoint?.name === 'after-manifest-rename-before-index-activation',
    )
    await killChild(child)

    const restarted = await createFileMaterialRegistry({ rootDir })
    await restarted.rebuildIndex()
    const published = await restarted.readMaterial(identityFor(request))
    assert.equal(published.promotionId, request.promotionId)
    const repeat = await restarted.publishPromotion({ promotionId: request.promotionId })
    assert.equal(repeat.promotionId, request.promotionId)
    const matches = (await restarted.listMaterials({ projectId: request.projectId })).filter(
      entry => entry.promotionId === request.promotionId,
    )
    assert.equal(matches.length, 1)
  })
})

test('recovery removes strictly named root atomic JSON temporaries left by SIGKILL', async t => {
  const { children, makeBuild, registry, rootDir } = await createFixture(t)
  const request = promotionRequest({
    buildDirectory: await makeBuild('atomic-json-temporaries'),
    promotionId: 'promotion-atomic-json-temporaries',
  })
  await registry.stagePromotion(request)

  const indexChild = startChild(children, {
    action: 'publish',
    rootDir,
    promotionId: request.promotionId,
    pauseAtCheckpoint: 'before-registry-index-rename',
  })
  await waitForMessage(
    indexChild,
    message => message?.type === 'checkpoint' && message.checkpoint?.name === 'before-registry-index-rename',
  )
  await killChild(indexChild)
  assert.ok((await readdir(rootDir)).some(name => ATOMIC_TEMPORARY_PATTERNS.index.test(name)))

  const fenceChild = startChild(children, {
    action: 'stage',
    rootDir,
    request: promotionRequest({
      buildDirectory: await makeBuild('atomic-json-fence'),
      promotionId: 'promotion-atomic-json-fence',
      materialVersion: '2.0.0',
      sourceRevision: 'revision-atomic-json-fence',
    }),
    pauseAtCheckpoint: 'before-registry-fence-rename',
  })
  await waitForMessage(
    fenceChild,
    message => message?.type === 'checkpoint' && message.checkpoint?.name === 'before-registry-fence-rename',
  )
  await killChild(fenceChild)
  assert.ok((await readdir(rootDir)).some(name => ATOMIC_TEMPORARY_PATTERNS.fence.test(name)))

  const indexDecoy = '.registry-index.json.not-ours.tmp'
  const fenceDecoy = '.registry-fence.json.12.not-a-uuid.tmp'
  await writeFile(join(rootDir, indexDecoy), 'preserve me')
  await writeFile(join(rootDir, fenceDecoy), 'preserve me')

  const restarted = await createFileMaterialRegistry({ rootDir })
  await restarted.recoverPendingPromotions()
  const remaining = await readdir(rootDir)
  assert.equal(
    remaining.some(name => ATOMIC_TEMPORARY_PATTERNS.index.test(name)),
    false,
  )
  assert.equal(
    remaining.some(name => ATOMIC_TEMPORARY_PATTERNS.fence.test(name)),
    false,
  )
  assert.ok(remaining.includes(indexDecoy))
  assert.ok(remaining.includes(fenceDecoy))
})

test('SIGKILL around stage rename recovers nested orphans and durable pending state', async t => {
  const { children, makeBuild, rootDir } = await createFixture(t)

  await t.test('kill after nested fsync leaves only a recoverable hidden orphan', async () => {
    const request = promotionRequest({
      buildDirectory: await makeBuild('stage-nested-fsync'),
      promotionId: 'promotion-stage-nested-fsync',
    })
    const child = startChild(children, {
      action: 'stage',
      rootDir,
      request,
      pauseAtCheckpoint: 'after-stage-nested-directory-fsync',
    })
    await waitForMessage(
      child,
      message => message?.type === 'checkpoint' && message.checkpoint?.name === 'after-stage-nested-directory-fsync',
    )
    await killChild(child)

    const restarted = await createFileMaterialRegistry({ rootDir })
    assert.equal(await restarted.readMaterial(identityFor(request)), null)
    assert.ok((await readdir(join(rootDir, 'promotions'))).some(name => name.startsWith('.') && name.endsWith('.tmp')))
    assert.deepEqual(await restarted.recoverPendingPromotions(), [])
    assert.equal(
      (await readdir(join(rootDir, 'promotions'))).some(name => name.startsWith('.') && name.endsWith('.tmp')),
      false,
    )
    await restarted.stagePromotion(request)
  })

  await t.test('kill after stage rename rebuilds one pending promotion and resumes idempotently', async () => {
    const request = promotionRequest({
      buildDirectory: await makeBuild('stage-after-rename'),
      promotionId: 'promotion-stage-after-rename',
      materialVersion: '2.0.0',
      sourceRevision: 'revision-stage-after-rename',
    })
    const child = startChild(children, {
      action: 'stage',
      rootDir,
      request,
      pauseAtCheckpoint: 'after-stage-rename-before-index-activation',
    })
    await waitForMessage(
      child,
      message =>
        message?.type === 'checkpoint' && message.checkpoint?.name === 'after-stage-rename-before-index-activation',
    )
    await killChild(child)

    const restarted = await createFileMaterialRegistry({ rootDir })
    const rebuilt = await restarted.rebuildIndex()
    assert.ok(rebuilt.pendingPromotions.some(entry => entry.promotionId === request.promotionId))
    const repeated = await restarted.stagePromotion(request)
    assert.equal(repeated.promotionId, request.promotionId)
    await restarted.publishPromotion({ promotionId: request.promotionId })
    assert.equal((await restarted.readMaterial(identityFor(request))).promotionId, request.promotionId)
  })
})

test('SIGKILL around GC rename and removal never restores deleted visibility', async t => {
  const { children, makeBuild, registry, rootDir } = await createFixture(t)
  const v1 = promotionRequest({ buildDirectory: await makeBuild('gc-v1'), promotionId: 'promotion-gc-crash-v1' })
  const v2 = promotionRequest({
    buildDirectory: await makeBuild('gc-v2'),
    promotionId: 'promotion-gc-crash-v2',
    materialVersion: '2.0.0',
    sourceRevision: 'revision-gc-v2',
  })
  await registry.stagePromotion(v1)
  await registry.publishPromotion({ promotionId: v1.promotionId })
  await registry.stagePromotion(v2)
  await registry.publishPromotion({ promotionId: v2.promotionId })
  const planBeforeRemoval = await registry.planGarbageCollection({ retainedMaterialRefs: [identityFor(v2)] })

  const beforeRemoval = startChild(children, {
    action: 'sweep',
    rootDir,
    plan: planBeforeRemoval,
    pauseAtCheckpoint: 'after-gc-rename-before-removal',
  })
  await waitForMessage(
    beforeRemoval,
    message => message?.type === 'checkpoint' && message.checkpoint?.name === 'after-gc-rename-before-removal',
  )
  await killChild(beforeRemoval)

  const afterRenameRestart = await createFileMaterialRegistry({ rootDir })
  assert.equal(await afterRenameRestart.readMaterial(identityFor(v1)), null)
  assert.equal((await afterRenameRestart.readMaterial(identityFor(v2))).promotionId, v2.promotionId)
  assert.ok((await readdir(join(rootDir, 'trash'))).length > 0)
  await afterRenameRestart.recoverPendingPromotions()
  assert.deepEqual(await readdir(join(rootDir, 'trash')), [])
  await assert.rejects(
    afterRenameRestart.sweepGarbageCollection(planBeforeRemoval),
    assertRegistryError('gc-generation-conflict'),
  )

  const v3 = promotionRequest({
    buildDirectory: await makeBuild('gc-v3'),
    promotionId: 'promotion-gc-crash-v3',
    materialVersion: '3.0.0',
    sourceRevision: 'revision-gc-v3',
  })
  await afterRenameRestart.stagePromotion(v3)
  await afterRenameRestart.publishPromotion({ promotionId: v3.promotionId })
  const planAfterRemoval = await afterRenameRestart.planGarbageCollection({
    retainedMaterialRefs: [identityFor(v3)],
  })
  const afterRemoval = startChild(children, {
    action: 'sweep',
    rootDir,
    plan: planAfterRemoval,
    pauseAtCheckpoint: 'after-gc-removal-before-index-activation',
  })
  await waitForMessage(
    afterRemoval,
    message =>
      message?.type === 'checkpoint' && message.checkpoint?.name === 'after-gc-removal-before-index-activation',
  )
  await killChild(afterRemoval)

  const afterRemovalRestart = await createFileMaterialRegistry({ rootDir })
  assert.equal(await afterRemovalRestart.readMaterial(identityFor(v2)), null)
  assert.equal((await afterRemovalRestart.readMaterial(identityFor(v3))).promotionId, v3.promotionId)
  assert.deepEqual(await readdir(join(rootDir, 'trash')), [])
  await assert.rejects(
    afterRemovalRestart.sweepGarbageCollection(planAfterRemoval),
    assertRegistryError('gc-generation-conflict'),
  )
})

test('a cross-process lease rejects a live contender and is reclaimable after SIGKILL', async t => {
  const { children, makeBuild, rootDir } = await createFixture(t)
  const request = promotionRequest({
    buildDirectory: await makeBuild('lease-build'),
    promotionId: 'promotion-lease-v1',
  })
  const lease = { acquireTimeoutMs: 75, staleAfterMs: 200, heartbeatMs: 40 }
  const holder = startChild(children, {
    action: 'stage',
    rootDir,
    request,
    lease,
    pauseAtCheckpoint: 'registry-lease-acquired',
  })
  await waitForMessage(
    holder,
    message => message?.type === 'checkpoint' && message.checkpoint?.name === 'registry-lease-acquired',
  )

  const contender = await runChild(children, { action: 'stage', rootDir, request, lease })
  assert.equal(contender.type, 'error')
  assert.ok(
    ['registry-locked', 'registry-lease-unavailable'].includes(contender.error.code),
    `unexpected contender error: ${JSON.stringify(contender.error)}`,
  )

  await killChild(holder)
  await new Promise(resolve => setTimeout(resolve, lease.staleAfterMs + 100))
  const successor = await runChild(children, { action: 'stage', rootDir, request, lease })
  assert.equal(successor.type, 'result')
  assert.equal(successor.result.promotionId, request.promotionId)
})
