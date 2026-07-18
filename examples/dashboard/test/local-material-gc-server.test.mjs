import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  MATERIAL_GC_SWEEP_ROUTE,
  createFileMaterialRegistry,
  createMaterialGcCoordinator,
  createMaterialPromotionHandler,
} from '../server/promotion/index.mjs'

const ENTRY_SOURCE = 'export default { mount() {}, update() {}, destroy() {} }'
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const digest = character => `sha256:${character.repeat(64)}`
const storageKeyForPromotion = promotionId => createHash('sha256').update(promotionId).digest('hex')
const PRINCIPAL_A = Object.freeze({ tenantId: 'tenant-a', userId: 'user-a' })
const PRINCIPAL_B = Object.freeze({ tenantId: 'tenant-a', userId: 'user-b' })

const identityFor = request => ({
  materialId: request.materialId,
  materialVersion: request.materialVersion,
  buildIntegrity: request.buildIntegrity,
})

const createFixture = async (t, registryOptions = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'easy-editor-material-gc-server-'))
  const rootDir = join(directory, 'registry')
  const workspaceRoot = join(directory, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  t.after(() => rm(directory, { recursive: true, force: true }))
  const registry = await createFileMaterialRegistry({ ...registryOptions, rootDir, workspaceRoot })
  let sequence = 0
  const addMaterial = async ({ projectId, materialId, materialVersion, promotionId, publish = true }) => {
    sequence += 1
    const buildDirectory = join(workspaceRoot, `build-${sequence}`)
    await mkdir(buildDirectory, { recursive: true })
    await writeFile(join(buildDirectory, 'index.mjs'), ENTRY_SOURCE)
    const request = {
      schemaVersion: 1,
      promotionId,
      projectId,
      materialId,
      materialVersion,
      logicalComponentId: `${materialId}-logical`,
      buildIntegrity: sha256(ENTRY_SOURCE),
      sourceRevision: {
        artifactId: `${materialId}-artifact`,
        sourceRevision: `${materialVersion}-revision`,
        logicalComponentId: `${materialId}-logical`,
        sourceIntegrity: digest('a'),
      },
      dependencyLockDigest: digest('b'),
      entryFile: 'index.mjs',
      buildDirectory,
      files: [
        {
          path: 'index.mjs',
          byteLength: Buffer.byteLength(ENTRY_SOURCE),
          integrity: sha256(ENTRY_SOURCE),
        },
      ],
      createdAt: sequence,
    }
    await registry.stagePromotion(request)
    if (publish) await registry.publishPromotion({ promotionId })
    return request
  }
  return { addMaterial, directory, registry, rootDir, workspaceRoot }
}

const planGc = (
  registry,
  {
    principal = PRINCIPAL_A,
    projectId = 'project-a',
    replicaId = 'replica-a',
    expectedReplicaGeneration = 0,
    snapshotDigest = digest('c'),
    materialRefs = [],
    unresolvedPromotionIds = [],
  } = {},
) =>
  registry.planGarbageCollection({
    principal,
    request: {
      schemaVersion: 1,
      projectId,
      replicaId,
      expectedReplicaGeneration,
      snapshotDigest,
      materialRefs,
      unresolvedPromotionIds,
    },
  })

const sweepGc = (registry, plan, principal = PRINCIPAL_A, options = undefined) =>
  registry.sweepGarbageCollection({ principal, request: { schemaVersion: 1, plan } }, options)

const releaseGc = (registry, plan, principal = PRINCIPAL_A) =>
  registry.releaseGarbageCollectionRoot({
    principal,
    request: {
      schemaVersion: 1,
      projectId: plan.projectId,
      replicaId: plan.replicaId,
      expectedReplicaGeneration: plan.replicaGeneration,
      snapshotDigest: plan.snapshotDigest,
    },
  })

const assertCode = code => error => {
  assert.equal(error?.code, code)
  return true
}

const deferred = () => {
  let resolve
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const seedPublishedMaterials = async ({ count, projectId, rootDir }) => {
  const promotionsDirectory = join(rootDir, 'promotions')
  await mkdir(promotionsDirectory, { recursive: true })
  const entryIntegrity = sha256(ENTRY_SOURCE)
  const bindings = Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(4, '0')
    return {
      schemaVersion: 1,
      promotionId: sha256(`candidate-promotion-${suffix}`),
      projectId,
      materialId: `material-candidate-${suffix}`,
      materialVersion: '1.0.0',
      logicalComponentId: `logical-candidate-${suffix}`,
      buildIntegrity: entryIntegrity,
      sourceRevision: {
        artifactId: `artifact-candidate-${suffix}`,
        sourceRevision: `revision-candidate-${suffix}`,
        logicalComponentId: `logical-candidate-${suffix}`,
        sourceIntegrity: digest('a'),
      },
      dependencyLockDigest: digest('b'),
      entryFile: 'index.mjs',
      files: [
        {
          path: 'index.mjs',
          byteLength: Buffer.byteLength(ENTRY_SOURCE),
          integrity: entryIntegrity,
        },
      ],
      createdAt: index + 1,
    }
  })
  for (let offset = 0; offset < bindings.length; offset += 64) {
    await Promise.all(
      bindings.slice(offset, offset + 64).map(async binding => {
        const promotionDirectory = join(promotionsDirectory, storageKeyForPromotion(binding.promotionId))
        const buildDirectory = join(promotionDirectory, 'build')
        await mkdir(buildDirectory, { recursive: true })
        await Promise.all([
          writeFile(join(buildDirectory, 'index.mjs'), ENTRY_SOURCE),
          writeFile(
            join(promotionDirectory, 'staged.json'),
            `${JSON.stringify({ schemaVersion: 1, kind: 'staged', binding })}\n`,
          ),
          writeFile(
            join(promotionDirectory, 'published.json'),
            `${JSON.stringify({ schemaVersion: 1, kind: 'published', binding })}\n`,
          ),
        ])
      }),
    )
  }
  return bindings
}

test('replica roots retain across devices while candidates remain confined to the authorized project', async t => {
  const { addMaterial, registry } = await createFixture(t)
  const projectAOld = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-a-old',
    materialVersion: '1.0.0',
    promotionId: digest('1'),
  })
  const projectANew = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-a-new',
    materialVersion: '2.0.0',
    promotionId: digest('2'),
  })
  const projectBOther = await addMaterial({
    projectId: 'project-b',
    materialId: 'material-b',
    materialVersion: '1.0.0',
    promotionId: digest('3'),
  })

  const replicaA = await planGc(registry, { materialRefs: [identityFor(projectAOld)] })
  assert.deepEqual(replicaA.deletionCandidates, [identityFor(projectANew)])
  assert.ok(!replicaA.deletionCandidates.some(ref => ref.materialId === projectBOther.materialId))
  await planGc(registry, {
    projectId: 'project-b',
    replicaId: 'replica-project-b',
    snapshotDigest: digest('e'),
    materialRefs: [identityFor(projectBOther)],
  })

  const replicaB = await planGc(registry, {
    principal: PRINCIPAL_B,
    replicaId: 'replica-b',
    snapshotDigest: digest('d'),
    materialRefs: [identityFor(projectANew)],
  })
  assert.deepEqual(replicaB.deletionCandidates, [])
  assert.deepEqual(
    replicaB.globalRetainedMaterialRefs,
    [identityFor(projectANew), identityFor(projectAOld), identityFor(projectBOther)].sort((a, b) =>
      a.materialId.localeCompare(b.materialId),
    ),
  )

  await releaseGc(registry, replicaA)
  const refreshedReplicaB = await planGc(registry, {
    principal: PRINCIPAL_B,
    replicaId: 'replica-b',
    expectedReplicaGeneration: 0,
    snapshotDigest: digest('d'),
    materialRefs: [identityFor(projectANew)],
  })
  assert.equal(refreshedReplicaB.replicaGeneration, replicaB.replicaGeneration, 'ACK replay must not rewrite the root')
  assert.deepEqual(refreshedReplicaB.deletionCandidates, [identityFor(projectAOld)])
  const swept = await sweepGc(registry, refreshedReplicaB, PRINCIPAL_B)
  assert.deepEqual(swept.deletedMaterials, [identityFor(projectAOld)])
  assert.equal(Object.isFrozen(swept), true)
  assert.equal(Object.isFrozen(swept.deletedMaterials), true)
  for (const identity of swept.deletedMaterials) assert.equal(Object.isFrozen(identity), true)
  assert.notEqual(await registry.readMaterial(identityFor(projectANew)), null)
  assert.notEqual(await registry.readMaterial(identityFor(projectBOther)), null)
})

test('replica CAS supports exact ACK replay and released tombstones prevent ABA recreation', async t => {
  const { registry, rootDir, workspaceRoot } = await createFixture(t)
  const first = await planGc(registry)
  const replay = await planGc(registry)
  assert.equal(replay.replicaGeneration, first.replicaGeneration)
  assert.equal(replay.requestDigest, first.requestDigest)
  const restarted = await createFileMaterialRegistry({ rootDir, workspaceRoot })
  const restartReplay = await planGc(restarted)
  assert.equal(restartReplay.replicaGeneration, first.replicaGeneration)
  assert.equal(restartReplay.requestDigest, first.requestDigest)

  await assert.rejects(planGc(registry, { snapshotDigest: digest('d') }), assertCode('gc-replica-generation-conflict'))
  const second = await planGc(registry, {
    expectedReplicaGeneration: first.replicaGeneration,
    snapshotDigest: digest('d'),
  })
  assert.equal(second.replicaGeneration, first.replicaGeneration + 1)
  const secondReplay = await planGc(registry, {
    expectedReplicaGeneration: first.replicaGeneration,
    snapshotDigest: digest('d'),
  })
  assert.equal(secondReplay.replicaGeneration, second.replicaGeneration)

  const released = await releaseGc(registry, second)
  const releaseReplay = await registry.releaseGarbageCollectionRoot({
    principal: PRINCIPAL_A,
    request: {
      schemaVersion: 1,
      projectId: second.projectId,
      replicaId: second.replicaId,
      expectedReplicaGeneration: second.replicaGeneration,
      snapshotDigest: second.snapshotDigest,
    },
  })
  assert.deepEqual(releaseReplay, released)
  for (const expectedReplicaGeneration of [
    second.replicaGeneration,
    released.replicaGeneration,
    released.replicaGeneration + 1,
  ]) {
    await assert.rejects(
      planGc(registry, {
        expectedReplicaGeneration,
        snapshotDigest: digest('e'),
      }),
      assertCode('gc-replica-generation-conflict'),
    )
  }

  const reopened = await planGc(registry, {
    replicaId: 'replica-new-uuid',
    snapshotDigest: digest('e'),
  })
  assert.equal(reopened.replicaGeneration, 1)
  assert.deepEqual(
    await releaseGc(registry, second),
    released,
    'release ACK replay must preserve the first registry generation after another replica mutates',
  )

  const replayRestart = await createFileMaterialRegistry({ rootDir, workspaceRoot })
  assert.deepEqual(await releaseGc(replayRestart, second), released)
})

test('legacy released tombstones remain readable without fabricating exact release replay evidence', async t => {
  const { registry, rootDir, workspaceRoot } = await createFixture(t)
  const plan = await planGc(registry)
  await releaseGc(registry, plan)

  const indexPath = join(rootDir, 'registry-index.json')
  const legacyIndex = JSON.parse(await readFile(indexPath, 'utf8'))
  const { releasedRegistryGeneration: _releasedRegistryGeneration, ...legacyRoot } = legacyIndex.replicaRoots[0]
  legacyIndex.replicaRoots = [legacyRoot]
  const gcState = {
    legacyRetainedMaterialRefs: legacyIndex.legacyRetainedMaterialRefs,
    replicaRoots: legacyIndex.replicaRoots,
  }
  legacyIndex.gcStateHash = sha256(JSON.stringify(gcState))
  legacyIndex.snapshotHash = sha256(JSON.stringify({ materials: [], pendingPromotions: [], gcState }))
  await writeFile(indexPath, `${JSON.stringify(legacyIndex)}\n`)

  const restarted = await createFileMaterialRegistry({ rootDir, workspaceRoot })
  await assert.rejects(releaseGc(restarted, plan), assertCode('gc-replica-generation-conflict'))
  const freshReplica = await planGc(restarted, {
    replicaId: 'replica-after-legacy-tombstone',
    snapshotDigest: digest('d'),
  })
  assert.equal(freshReplica.replicaGeneration, 1)
})

test('unresolved promotions accept absent declarations, resolve same-project pending or active records, and reject cross-project records', async t => {
  const { addMaterial, registry, rootDir } = await createFixture(t)
  const active = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-active',
    materialVersion: '1.0.0',
    promotionId: digest('4'),
  })
  const pending = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-pending',
    materialVersion: '1.0.0',
    promotionId: digest('5'),
    publish: false,
  })
  const crossProject = await addMaterial({
    projectId: 'project-b',
    materialId: 'material-cross',
    materialVersion: '1.0.0',
    promotionId: digest('6'),
  })

  const missingPromotionId = digest('7')
  await planGc(registry, { replicaId: 'replica-missing', unresolvedPromotionIds: [missingPromotionId] })
  const pendingPlan = await planGc(registry, {
    replicaId: 'replica-pending',
    unresolvedPromotionIds: [pending.promotionId],
  })
  assert.ok(!pendingPlan.deletionCandidates.some(ref => ref.materialId === pending.materialId))
  await assert.rejects(
    planGc(registry, { replicaId: 'replica-cross', unresolvedPromotionIds: [crossProject.promotionId] }),
    assertCode('gc-promotion-unresolved'),
  )

  const resolved = await planGc(registry, {
    replicaId: 'replica-resolved',
    unresolvedPromotionIds: [active.promotionId],
  })
  assert.ok(resolved.globalRetainedMaterialRefs.some(ref => ref.materialId === active.materialId))
  const durable = JSON.parse(await readFile(join(rootDir, 'registry-index.json'), 'utf8'))
  const roots = new Map(durable.replicaRoots.map(root => [root.replicaId, root]))
  assert.deepEqual(roots.get('replica-missing').unresolvedPromotionIds, [missingPromotionId])
  assert.deepEqual(roots.get('replica-missing').resolvedPromotions, [])
  assert.deepEqual(roots.get('replica-pending').unresolvedPromotionIds, [pending.promotionId])
  assert.deepEqual(roots.get('replica-pending').resolvedPromotions, [
    { promotionId: pending.promotionId, materialRef: identityFor(pending) },
  ])
  assert.equal(roots.has('replica-cross'), false)
  assert.deepEqual(roots.get('replica-resolved').unresolvedPromotionIds, [active.promotionId])
  assert.deepEqual(roots.get('replica-resolved').resolvedPromotions, [
    { promotionId: active.promotionId, materialRef: identityFor(active) },
  ])
})

test('a staged promotion remains protected by any active replica root and becomes sweepable only after every retaining root releases', async t => {
  const { addMaterial, registry } = await createFixture(t)
  const pending = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-pending-retained',
    materialVersion: '1.0.0',
    promotionId: digest('8'),
    publish: false,
  })

  const replicaA = await planGc(registry, {
    replicaId: 'replica-pending-a',
    unresolvedPromotionIds: [pending.promotionId],
  })
  const replicaB = await planGc(registry, {
    replicaId: 'replica-pending-b',
    snapshotDigest: digest('d'),
    unresolvedPromotionIds: [pending.promotionId],
  })
  assert.deepEqual(replicaA.deletionCandidates, [])
  assert.deepEqual(replicaB.deletionCandidates, [])

  await releaseGc(registry, replicaA)
  const oneRootRemaining = await planGc(registry, {
    replicaId: 'replica-pending-observer',
    snapshotDigest: digest('e'),
  })
  assert.deepEqual(oneRootRemaining.deletionCandidates, [])

  await releaseGc(registry, replicaB)
  const released = await planGc(registry, {
    replicaId: 'replica-pending-sweeper',
    snapshotDigest: digest('f'),
  })
  assert.deepEqual(released.deletionCandidates, [identityFor(pending)])
  assert.notEqual(
    await registry.queryPromotion({ schemaVersion: 1, projectId: pending.projectId, promotionId: pending.promotionId }),
    null,
  )

  const swept = await sweepGc(registry, released)
  assert.deepEqual(swept.deletedMaterials, [identityFor(pending)])
  assert.equal(
    await registry.queryPromotion({ schemaVersion: 1, projectId: pending.projectId, promotionId: pending.promotionId }),
    null,
  )
  assert.deepEqual(await registry.recoverPendingPromotions(), [])
})

test('an absent promotion declaration protects a matching stage created later until its original root releases', async t => {
  const { addMaterial, registry } = await createFixture(t)
  const promotionId = digest('9')
  const declaredBeforeStage = await planGc(registry, {
    replicaId: 'replica-pre-stage-owner',
    unresolvedPromotionIds: [promotionId],
  })
  assert.deepEqual(declaredBeforeStage.deletionCandidates, [])

  const pending = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-staged-after-root',
    materialVersion: '1.0.0',
    promotionId,
    publish: false,
  })
  const observedAfterStage = await planGc(registry, {
    replicaId: 'replica-post-stage-observer',
    snapshotDigest: digest('d'),
  })
  assert.deepEqual(
    observedAfterStage.deletionCandidates,
    [],
    'the earlier opaque promotion root must protect a later staged record',
  )

  await releaseGc(registry, declaredBeforeStage)
  const afterRelease = await planGc(registry, {
    replicaId: 'replica-post-stage-sweeper',
    snapshotDigest: digest('e'),
  })
  assert.deepEqual(afterRelease.deletionCandidates, [identityFor(pending)])
})

test('active replica admissions are monotonic across omitted material and promotion roots', async t => {
  const { addMaterial, registry, rootDir } = await createFixture(t)
  const direct = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-direct-root',
    materialVersion: '1.0.0',
    promotionId: digest('1'),
  })
  const promoted = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-promotion-root',
    materialVersion: '1.0.0',
    promotionId: digest('2'),
  })

  const admitted = await planGc(registry, {
    materialRefs: [identityFor(direct)],
    unresolvedPromotionIds: [promoted.promotionId],
  })
  const omitted = await planGc(registry, {
    expectedReplicaGeneration: admitted.replicaGeneration,
    snapshotDigest: digest('d'),
    materialRefs: [],
    unresolvedPromotionIds: [],
  })
  assert.deepEqual(
    omitted.globalRetainedMaterialRefs,
    [identityFor(direct), identityFor(promoted)].sort((left, right) => left.materialId.localeCompare(right.materialId)),
  )
  assert.deepEqual(omitted.deletionCandidates, [])

  const durable = JSON.parse(await readFile(join(rootDir, 'registry-index.json'), 'utf8'))
  const [root] = durable.replicaRoots
  assert.deepEqual(
    root.materialRefs,
    [identityFor(direct), identityFor(promoted)].sort((left, right) => left.materialId.localeCompare(right.materialId)),
  )
  assert.deepEqual(root.unresolvedPromotionIds, [promoted.promotionId])
  assert.deepEqual(root.resolvedPromotions, [{ promotionId: promoted.promotionId, materialRef: identityFor(promoted) }])
})

test('a monotonic replica root rejects its 4097th material before durable mutation and remains serviceable', async t => {
  const { addMaterial, registry, rootDir } = await createFixture(t)
  const overflow = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-overflow',
    materialVersion: '1.0.0',
    promotionId: digest('2'),
  })
  const [promotionDirectory] = await readdir(join(rootDir, 'promotions'))
  const staged = JSON.parse(await readFile(join(rootDir, 'promotions', promotionDirectory, 'staged.json'), 'utf8'))
  const materialRefs = Array.from({ length: 4096 }, (_, index) => ({
    materialId: `material-root-${String(index).padStart(4, '0')}`,
    materialVersion: '1.0.0',
    buildIntegrity: digest('f'),
  }))
  const root = {
    tenantId: PRINCIPAL_A.tenantId,
    userId: PRINCIPAL_A.userId,
    projectId: 'project-a',
    replicaId: 'replica-a',
    state: 'active',
    replicaGeneration: 1,
    acceptedRequestDigest: digest('e'),
    snapshotDigest: digest('c'),
    materialRefs,
    unresolvedPromotionIds: [],
    resolvedPromotions: [],
    updatedAt: 1,
    releasedAt: null,
  }
  const gcState = { legacyRetainedMaterialRefs: [], replicaRoots: [root] }
  const indexPath = join(rootDir, 'registry-index.json')
  const seededIndex = JSON.parse(await readFile(indexPath, 'utf8'))
  seededIndex.generation += 1
  seededIndex.legacyRetainedMaterialRefs = []
  seededIndex.replicaRoots = [root]
  seededIndex.gcStateHash = sha256(JSON.stringify(gcState))
  seededIndex.snapshotHash = sha256(JSON.stringify({ materials: [staged.binding], pendingPromotions: [], gcState }))
  await writeFile(indexPath, `${JSON.stringify(seededIndex)}\n`)
  const durableBefore = await readFile(indexPath, 'utf8')

  await assert.rejects(
    planGc(registry, {
      expectedReplicaGeneration: 1,
      snapshotDigest: digest('d'),
      materialRefs: [identityFor(overflow)],
    }),
    assertCode('invalid-request'),
  )
  assert.equal(await readFile(indexPath, 'utf8'), durableBefore)

  const healthy = await planGc(registry, {
    replicaId: 'replica-after-root-limit',
    snapshotDigest: digest('d'),
  })
  assert.equal(healthy.replicaGeneration, 1)
})

test('cross-replica global retained roots reject the 4097th identity before durable mutation', async t => {
  const { addMaterial, registry, rootDir } = await createFixture(t)
  const admittedByReplicaB = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-replica-b',
    materialVersion: '1.0.0',
    promotionId: digest('3'),
  })
  const [promotionDirectory] = await readdir(join(rootDir, 'promotions'))
  const staged = JSON.parse(await readFile(join(rootDir, 'promotions', promotionDirectory, 'staged.json'), 'utf8'))
  const materialRefs = Array.from({ length: 4096 }, (_, index) => ({
    materialId: `material-global-${String(index).padStart(4, '0')}`,
    materialVersion: '1.0.0',
    buildIntegrity: digest('f'),
  }))
  const replicaA = {
    tenantId: PRINCIPAL_A.tenantId,
    userId: PRINCIPAL_A.userId,
    projectId: 'project-a',
    replicaId: 'replica-a',
    state: 'active',
    replicaGeneration: 1,
    acceptedRequestDigest: digest('e'),
    snapshotDigest: digest('c'),
    materialRefs,
    unresolvedPromotionIds: [],
    resolvedPromotions: [],
    updatedAt: 1,
    releasedAt: null,
  }
  const gcState = { legacyRetainedMaterialRefs: [], replicaRoots: [replicaA] }
  const indexPath = join(rootDir, 'registry-index.json')
  const seededIndex = JSON.parse(await readFile(indexPath, 'utf8'))
  seededIndex.generation += 1
  seededIndex.legacyRetainedMaterialRefs = []
  seededIndex.replicaRoots = [replicaA]
  seededIndex.gcStateHash = sha256(JSON.stringify(gcState))
  seededIndex.snapshotHash = sha256(JSON.stringify({ materials: [staged.binding], pendingPromotions: [], gcState }))
  await writeFile(indexPath, `${JSON.stringify(seededIndex)}\n`)
  const durableBefore = await readFile(indexPath, 'utf8')
  const parsedBefore = JSON.parse(durableBefore)

  await assert.rejects(
    planGc(registry, {
      replicaId: 'replica-b',
      snapshotDigest: digest('d'),
      materialRefs: [identityFor(admittedByReplicaB)],
    }),
    assertCode('invalid-request'),
  )
  const durableAfter = await readFile(indexPath, 'utf8')
  assert.equal(durableAfter, durableBefore)
  assert.equal(JSON.parse(durableAfter).generation, parsedBefore.generation)
  assert.deepEqual(JSON.parse(durableAfter).replicaRoots, parsedBefore.replicaRoots)

  await registry.releaseGarbageCollectionRoot({
    principal: PRINCIPAL_A,
    request: {
      schemaVersion: 1,
      projectId: replicaA.projectId,
      replicaId: replicaA.replicaId,
      expectedReplicaGeneration: replicaA.replicaGeneration,
      snapshotDigest: replicaA.snapshotDigest,
    },
  })
  const healthy = await planGc(registry, {
    replicaId: 'replica-b',
    snapshotDigest: digest('d'),
    materialRefs: [identityFor(admittedByReplicaB)],
  })
  assert.equal(healthy.globalRetainedMaterialRefs.length, 1)
})

test('a project with 4097 deletion candidates rejects planning before durable mutation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'easy-editor-material-gc-candidate-limit-'))
  const rootDir = join(directory, 'registry')
  const workspaceRoot = join(directory, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  t.after(() => rm(directory, { recursive: true, force: true }))
  const materials = await seedPublishedMaterials({ count: 4097, projectId: 'project-candidate-limit', rootDir })
  const indexPath = join(rootDir, 'registry-index.json')
  const gcState = { legacyRetainedMaterialRefs: [], replicaRoots: [] }
  await writeFile(
    indexPath,
    `${JSON.stringify({
      schemaVersion: 2,
      kind: 'material-registry-index',
      fence: 1,
      generation: 1,
      snapshotHash: sha256(JSON.stringify({ materials, pendingPromotions: [], gcState })),
      gcStateHash: sha256(JSON.stringify(gcState)),
      legacyRetainedMaterialRefs: [],
      replicaRoots: [],
    })}\n`,
  )
  const registry = await createFileMaterialRegistry({ rootDir, workspaceRoot })
  const durableBefore = await readFile(indexPath, 'utf8')

  await assert.rejects(
    planGc(registry, {
      projectId: 'project-candidate-limit',
      replicaId: 'replica-candidate-limit',
      snapshotDigest: digest('d'),
    }),
    assertCode('invalid-request'),
  )
  assert.equal(await readFile(indexPath, 'utf8'), durableBefore)

  const healthy = await planGc(registry, {
    projectId: 'project-empty',
    replicaId: 'replica-after-candidate-limit',
    snapshotDigest: digest('e'),
  })
  assert.deepEqual(healthy.deletionCandidates, [])
})

test('GC sweep builds one active-plus-pending identity index per sweep phase', async t => {
  await t.test('ordinary sweep reuses one identity index for every candidate', async subtest => {
    const indexEvents = []
    const { addMaterial, registry } = await createFixture(subtest, {
      checkpoint: async event => {
        if (event.name === 'gc-record-identity-index-built') indexEvents.push(structuredClone(event))
      },
    })
    const candidates = []
    for (let index = 0; index < 12; index += 1) {
      candidates.push(
        await addMaterial({
          projectId: 'project-a',
          materialId: `material-indexed-${index}`,
          materialVersion: '1.0.0',
          promotionId: sha256(`promotion-indexed-${index}`),
        }),
      )
    }

    const plan = await planGc(registry)
    const result = await sweepGc(registry, plan)

    assert.deepEqual(result.deletedMaterials, plan.deletionCandidates)
    assert.deepEqual(indexEvents, [
      {
        name: 'gc-record-identity-index-built',
        phase: 'sweep',
        recordCount: candidates.length,
        identityCount: candidates.length,
      },
    ])
  })

  await t.test('started-receipt recovery builds its own identity index once', async subtest => {
    const indexEvents = []
    const { addMaterial, registry, rootDir } = await createFixture(subtest, {
      checkpoint: async event => {
        if (event.name === 'gc-record-identity-index-built') indexEvents.push(structuredClone(event))
      },
    })
    const candidate = await addMaterial({
      projectId: 'project-a',
      materialId: 'material-started-index',
      materialVersion: '1.0.0',
      promotionId: sha256('promotion-started-index'),
    })
    const plan = await planGc(registry)
    await writeFile(
      join(rootDir, 'gc-sweep-receipts', `${plan.planHash.slice('sha256:'.length)}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'material-gc-sweep-receipt',
        state: 'started',
        plan,
        deletedMaterials: [],
        registryGeneration: null,
      })}\n`,
    )

    const result = await sweepGc(registry, plan)

    assert.deepEqual(result.deletedMaterials, [])
    assert.notEqual(await registry.readMaterial(identityFor(candidate)), null)
    assert.deepEqual(indexEvents, [
      {
        name: 'gc-record-identity-index-built',
        phase: 'complete-started',
        recordCount: 1,
        identityCount: 1,
      },
    ])
  })
})

test('material admission and sweep serialize without a stale-reference deletion window', async t => {
  await t.test('admission first advances durable generations and rejects the stale sweep', async subtest => {
    const { addMaterial, registry, rootDir, workspaceRoot } = await createFixture(subtest)
    const candidate = await addMaterial({
      projectId: 'project-a',
      materialId: 'material-admission-wins',
      materialVersion: '1.0.0',
      promotionId: digest('3'),
    })
    const staleSweep = await planGc(registry)
    assert.deepEqual(staleSweep.deletionCandidates, [identityFor(candidate)])

    const admittingReplica = await createFileMaterialRegistry({ rootDir, workspaceRoot })
    const admitted = await planGc(admittingReplica, {
      expectedReplicaGeneration: staleSweep.replicaGeneration,
      snapshotDigest: digest('d'),
      materialRefs: [identityFor(candidate)],
    })
    assert.ok(admitted.registryGeneration > staleSweep.registryGeneration)
    await assert.rejects(sweepGc(registry, staleSweep), assertCode('gc-replica-generation-conflict'))
    assert.notEqual(await registry.readMaterial(identityFor(candidate)), null)
  })

  await t.test('sweep first makes the later admission fail without mutating its durable root', async subtest => {
    const { addMaterial, registry, rootDir, workspaceRoot } = await createFixture(subtest)
    const candidate = await addMaterial({
      projectId: 'project-a',
      materialId: 'material-sweep-wins',
      materialVersion: '1.0.0',
      promotionId: digest('4'),
    })
    const sweepPlan = await planGc(registry)
    const sweepingReplica = await createFileMaterialRegistry({ rootDir, workspaceRoot })
    const swept = await sweepGc(sweepingReplica, sweepPlan)
    assert.deepEqual(swept.deletedMaterials, [identityFor(candidate)])
    const beforeAdmission = JSON.parse(await readFile(join(rootDir, 'registry-index.json'), 'utf8'))

    await assert.rejects(
      planGc(registry, {
        expectedReplicaGeneration: sweepPlan.replicaGeneration,
        snapshotDigest: digest('d'),
        materialRefs: [identityFor(candidate)],
      }),
      assertCode('material-not-found'),
    )
    const afterAdmission = JSON.parse(await readFile(join(rootDir, 'registry-index.json'), 'utf8'))
    assert.deepEqual(afterAdmission, beforeAdmission, 'failed admission must not authorize a local mutation')
    assert.equal(await registry.readMaterial(identityFor(candidate)), null)
  })
})

test('sweep abort is exact before deletion and quiescent after the first rename', async t => {
  await t.test('a queued aborted sweep never acquires a mutation lease or deletes', async subtest => {
    let pauseAt = null
    const reached = deferred()
    const release = deferred()
    const checkpoint = async event => {
      if (event.name !== pauseAt) return
      reached.resolve()
      await release.promise
    }
    const { addMaterial, registry } = await createFixture(subtest, { checkpoint })
    const candidate = await addMaterial({
      projectId: 'project-a',
      materialId: 'material-queued-abort',
      materialVersion: '1.0.0',
      promotionId: digest('5'),
    })
    const sweepPlan = await planGc(registry)
    pauseAt = 'registry-lease-acquired'
    const holder = planGc(registry, {
      expectedReplicaGeneration: sweepPlan.replicaGeneration,
      snapshotDigest: digest('d'),
    })
    await reached.promise
    pauseAt = null
    const controller = new AbortController()
    const queuedSweep = sweepGc(registry, sweepPlan, PRINCIPAL_A, { signal: controller.signal })
    controller.abort()
    release.resolve()
    await holder
    await assert.rejects(queuedSweep, assertCode('promotion-aborted'))
    assert.notEqual(await registry.readMaterial(identityFor(candidate)), null)
  })

  await t.test('abort at the pre-rename checkpoint leaves every candidate visible', async subtest => {
    let pauseAt = null
    const reached = deferred()
    const release = deferred()
    const checkpoint = async event => {
      if (event.name !== pauseAt) return
      reached.resolve()
      await release.promise
    }
    const { addMaterial, registry } = await createFixture(subtest, { checkpoint })
    const candidate = await addMaterial({
      projectId: 'project-a',
      materialId: 'material-pre-rename-abort',
      materialVersion: '1.0.0',
      promotionId: digest('6'),
    })
    const sweepPlan = await planGc(registry)
    pauseAt = 'before-gc-rename'
    const controller = new AbortController()
    const sweep = sweepGc(registry, sweepPlan, PRINCIPAL_A, { signal: controller.signal })
    await reached.promise
    controller.abort()
    release.resolve()
    await assert.rejects(sweep, assertCode('promotion-aborted'))
    assert.notEqual(await registry.readMaterial(identityFor(candidate)), null)
  })

  await t.test('abort during the final mutation-lease verification still prevents the first rename', async subtest => {
    const nodeFileSystem = await import('node:fs/promises')
    const verificationReached = deferred()
    const releaseVerification = deferred()
    let pauseNextLockStat = false
    const fileSystem = {
      ...nodeFileSystem,
      async lstat(path, options) {
        if (pauseNextLockStat && path.endsWith('.registry.lock')) {
          pauseNextLockStat = false
          verificationReached.resolve()
          await releaseVerification.promise
        }
        return nodeFileSystem.lstat(path, options)
      },
    }
    const checkpoint = async event => {
      if (event.name === 'after-gc-sweep-receipt-rename' && event.state === 'started') {
        pauseNextLockStat = true
      }
    }
    const { addMaterial, registry } = await createFixture(subtest, { checkpoint, fileSystem })
    const candidate = await addMaterial({
      projectId: 'project-a',
      materialId: 'material-final-lease-abort',
      materialVersion: '1.0.0',
      promotionId: digest('7'),
    })
    const sweepPlan = await planGc(registry)
    const controller = new AbortController()
    const sweep = sweepGc(registry, sweepPlan, PRINCIPAL_A, { signal: controller.signal })
    await verificationReached.promise
    controller.abort()
    releaseVerification.resolve()

    await assert.rejects(sweep, assertCode('promotion-aborted'))
    assert.notEqual(await registry.readMaterial(identityFor(candidate)), null)
    const replay = await sweepGc(registry, sweepPlan)
    assert.deepEqual(replay.deletedMaterials, [])
  })

  await t.test('abort after rename cannot settle the request before durable reconciliation', async subtest => {
    let pauseAt = null
    const reached = deferred()
    const release = deferred()
    const checkpoint = async event => {
      if (event.name !== pauseAt) return
      reached.resolve()
      await release.promise
    }
    const { addMaterial, registry } = await createFixture(subtest, { checkpoint })
    const firstCandidate = await addMaterial({
      projectId: 'project-a',
      materialId: 'material-post-rename-abort-a',
      materialVersion: '1.0.0',
      promotionId: digest('7'),
    })
    const secondCandidate = await addMaterial({
      projectId: 'project-a',
      materialId: 'material-post-rename-abort-b',
      materialVersion: '1.0.0',
      promotionId: digest('8'),
    })
    const sweepPlan = await planGc(registry)
    pauseAt = 'after-gc-rename-before-removal'
    const controller = new AbortController()
    let settled = false
    const sweep = sweepGc(registry, sweepPlan, PRINCIPAL_A, { signal: controller.signal }).finally(() => {
      settled = true
    })
    await reached.promise
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(settled, false)
    release.resolve()
    const result = await sweep
    assert.deepEqual(result.deletedMaterials, [identityFor(firstCandidate), identityFor(secondCandidate)])
    assert.equal(await registry.readMaterial(identityFor(firstCandidate)), null)
    assert.equal(await registry.readMaterial(identityFor(secondCandidate)), null)
  })
})

test('exact sweep receipt survives transport ACK loss and restart without deleting twice', async t => {
  let pauseAt = null
  let renameCount = 0
  const reached = deferred()
  const release = deferred()
  const checkpoint = async event => {
    if (event.name === 'before-gc-rename') renameCount += 1
    if (event.name !== pauseAt) return
    reached.resolve()
    await release.promise
  }
  const { addMaterial, registry, rootDir, workspaceRoot } = await createFixture(t, { checkpoint })
  const candidate = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-ack-loss',
    materialVersion: '1.0.0',
    promotionId: digest('9'),
  })
  const plan = await planGc(registry)
  const gcCoordinator = createMaterialGcCoordinator({
    registry,
    authorizePrincipal: async () => PRINCIPAL_A,
  })
  const handler = createMaterialPromotionHandler({
    coordinator: Object.freeze({
      async promote() {
        throw new Error('not used')
      },
      async query() {
        throw new Error('not used')
      },
      ...gcCoordinator,
    }),
  })
  const transport = signal =>
    handler.handle({
      method: 'POST',
      path: MATERIAL_GC_SWEEP_ROUTE,
      headers: { origin: 'http://dashboard.test', 'content-type': 'application/json' },
      expectedOrigins: ['http://dashboard.test'],
      body: JSON.stringify({ schemaVersion: 1, plan }),
      signal,
    })

  pauseAt = 'after-gc-rename-before-removal'
  const controller = new AbortController()
  let firstSettled = false
  const lostResponse = transport(controller.signal).finally(() => {
    firstSettled = true
  })
  await reached.promise
  controller.abort()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(firstSettled, false)
  release.resolve()
  const first = await lostResponse
  assert.equal(first.status, 200)

  pauseAt = null
  const replay = await transport()
  assert.deepEqual(replay, first)
  assert.equal(Object.isFrozen(replay.body), true)
  assert.equal(Object.isFrozen(replay.body.deletedMaterials), true)
  assert.equal(renameCount, 1)

  const restarted = await createFileMaterialRegistry({ rootDir, workspaceRoot })
  const restartReplay = await sweepGc(restarted, plan)
  assert.deepEqual(restartReplay, first.body)
  assert.equal(Object.isFrozen(restartReplay), true)
  assert.equal(Object.isFrozen(restartReplay.deletedMaterials), true)
  assert.deepEqual(restartReplay.deletedMaterials, [identityFor(candidate)])
})

test('completed sweep receipts retain only the latest exact replay per replica across restart', async t => {
  const { registry, rootDir, workspaceRoot } = await createFixture(t)
  let planA = await planGc(registry, { snapshotDigest: sha256('replica-a-0') })
  let resultA = await sweepGc(registry, planA)
  const planB = await planGc(registry, {
    replicaId: 'replica-bounded-b',
    snapshotDigest: sha256('replica-b-0'),
  })
  const resultB = await sweepGc(registry, planB)

  for (let generation = 1; generation <= 12; generation += 1) {
    planA = await planGc(registry, {
      expectedReplicaGeneration: planA.replicaGeneration,
      snapshotDigest: sha256(`replica-a-${generation}`),
    })
    resultA = await sweepGc(registry, planA)
  }

  const receiptsDirectory = join(rootDir, 'gc-sweep-receipts')
  const receiptFiles = (await readdir(receiptsDirectory)).filter(name => name.endsWith('.json')).sort()
  assert.deepEqual(receiptFiles, [planA, planB].map(plan => `${plan.planHash.slice('sha256:'.length)}.json`).sort())

  await releaseGc(registry, planA)
  const restarted = await createFileMaterialRegistry({ rootDir, workspaceRoot })
  assert.deepEqual(await sweepGc(restarted, planA), resultA)
  assert.deepEqual(await sweepGc(restarted, planB), resultB)
  assert.equal((await readdir(receiptsDirectory)).filter(name => name.endsWith('.json')).length, 2)
})

test('sweep rejects registry mutation, candidate tampering, and a different trusted principal', async t => {
  const { addMaterial, registry } = await createFixture(t)
  const old = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-old',
    materialVersion: '1.0.0',
    promotionId: digest('8'),
  })
  const retained = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-retained',
    materialVersion: '2.0.0',
    promotionId: digest('9'),
  })
  const plan = await planGc(registry, { materialRefs: [identityFor(retained)] })
  assert.deepEqual(plan.deletionCandidates, [identityFor(old)])
  await assert.rejects(sweepGc(registry, plan, PRINCIPAL_B), assertCode('gc-replica-generation-conflict'))
  await assert.rejects(sweepGc(registry, { ...plan, deletionCandidates: [] }), assertCode('gc-plan-invalid'))

  await addMaterial({
    projectId: 'project-a',
    materialId: 'material-later',
    materialVersion: '3.0.0',
    promotionId: digest('a'),
  })
  await assert.rejects(sweepGc(registry, plan), assertCode('gc-generation-conflict'))
})

test('v2 durable root hash rejects nested root tampering after restart', async t => {
  const { registry, rootDir, workspaceRoot } = await createFixture(t)
  await planGc(registry)
  const indexPath = join(rootDir, 'registry-index.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  index.replicaRoots[0].materialRefs.push({
    materialId: 'forged-material',
    materialVersion: '1.0.0',
    buildIntegrity: digest('f'),
  })
  await writeFile(indexPath, `${JSON.stringify(index)}\n`)
  await assert.rejects(createFileMaterialRegistry({ rootDir, workspaceRoot }), assertCode('registry-corrupt'))
})

test('v1 index migrates conservatively and v2 backup roots are restart-verifiable and tamper evident', async t => {
  const { addMaterial, directory, registry, rootDir, workspaceRoot } = await createFixture(t)
  const retained = await addMaterial({
    projectId: 'project-a',
    materialId: 'material-legacy',
    materialVersion: '1.0.0',
    promotionId: digest('b'),
  })
  const currentIndex = JSON.parse(await readFile(join(rootDir, 'registry-index.json'), 'utf8'))
  await writeFile(
    join(rootDir, 'registry-index.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'material-registry-index',
      fence: currentIndex.fence,
      generation: currentIndex.generation,
      snapshotHash: digest('f'),
      retainedMaterialRefs: [identityFor(retained)],
    })}\n`,
  )

  const restarted = await createFileMaterialRegistry({ rootDir, workspaceRoot })
  const plan = await planGc(restarted, { replicaId: 'replica-migrated' })
  assert.deepEqual(plan.deletionCandidates, [], 'legacy roots remain permanently conservative')
  const migrated = JSON.parse(await readFile(join(rootDir, 'registry-index.json'), 'utf8'))
  assert.equal(migrated.schemaVersion, 2)
  assert.ok(migrated.generation > currentIndex.generation)
  assert.deepEqual(migrated.legacyRetainedMaterialRefs, [identityFor(retained)])

  const destinationDir = join(directory, 'backup-v2')
  const exported = await restarted.exportBackup({ destinationDir })
  assert.equal(exported.valid, true)
  const verified = await restarted.verifyBackup({ backupDirectory: destinationDir })
  assert.equal(verified.schemaVersion, 2)
  assert.equal(verified.sourceGeneration, exported.sourceGeneration)
  assert.deepEqual(verified.gcState.legacyRetainedMaterialRefs, [identityFor(retained)])

  const manifestPath = join(destinationDir, 'backup-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, sourceGeneration: manifest.sourceGeneration + 1 })}\n`)
  await assert.rejects(restarted.verifyBackup({ backupDirectory: destinationDir }), assertCode('backup-invalid'))

  const legacyBackupDir = join(directory, 'backup-v1')
  await restarted.exportBackup({ destinationDir: legacyBackupDir })
  const legacyManifestPath = join(legacyBackupDir, 'backup-manifest.json')
  const v2Manifest = JSON.parse(await readFile(legacyManifestPath, 'utf8'))
  await writeFile(
    legacyManifestPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: v2Manifest.kind,
      createdAt: v2Manifest.createdAt,
      materials: v2Manifest.materials,
    })}\n`,
  )
  const legacyVerified = await restarted.verifyBackup({ backupDirectory: legacyBackupDir })
  assert.equal(legacyVerified.schemaVersion, 1)
  assert.equal(legacyVerified.gcState, null)
})
