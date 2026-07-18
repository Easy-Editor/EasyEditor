import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFileMaterialRegistry } from '../server/promotion/file-material-registry.mjs'

const ENTRY_SOURCE = 'export default { mount() {}, update() {}, destroy() {} }'
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const digest = character => `sha256:${character.repeat(64)}`
const PRINCIPAL_A = Object.freeze({ tenantId: 'tenant-a', userId: 'user-a' })
const PRINCIPAL_B = Object.freeze({ tenantId: 'tenant-a', userId: 'user-b' })

const identityFor = request => ({
  materialId: request.materialId,
  materialVersion: request.materialVersion,
  buildIntegrity: request.buildIntegrity,
})

const createFixture = async t => {
  const directory = await mkdtemp(join(tmpdir(), 'easy-editor-material-gc-server-'))
  const rootDir = join(directory, 'registry')
  const workspaceRoot = join(directory, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  t.after(() => rm(directory, { recursive: true, force: true }))
  const registry = await createFileMaterialRegistry({ rootDir, workspaceRoot })
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

const sweepGc = (registry, plan, principal = PRINCIPAL_A) =>
  registry.sweepGarbageCollection({ principal, request: { schemaVersion: 1, plan } })

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
  await assert.rejects(planGc(registry), assertCode('gc-replica-generation-conflict'))

  const reactivated = await planGc(registry, {
    expectedReplicaGeneration: released.replicaGeneration,
    snapshotDigest: digest('e'),
  })
  assert.equal(reactivated.replicaGeneration, released.replicaGeneration + 1)
})

test('unresolved promotions resolve only to active same-project materials and failures do not write roots', async t => {
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

  for (const [replicaId, promotionId] of [
    ['replica-missing', digest('7')],
    ['replica-pending', pending.promotionId],
    ['replica-cross', crossProject.promotionId],
  ]) {
    await assert.rejects(
      planGc(registry, { replicaId, unresolvedPromotionIds: [promotionId] }),
      assertCode('gc-promotion-unresolved'),
    )
  }
  const indexAfterFailures = JSON.parse(await readFile(join(rootDir, 'registry-index.json'), 'utf8'))
  assert.deepEqual(indexAfterFailures.replicaRoots, [])

  const resolved = await planGc(registry, {
    replicaId: 'replica-resolved',
    unresolvedPromotionIds: [active.promotionId],
  })
  assert.ok(resolved.globalRetainedMaterialRefs.some(ref => ref.materialId === active.materialId))
  const durable = JSON.parse(await readFile(join(rootDir, 'registry-index.json'), 'utf8'))
  assert.deepEqual(durable.replicaRoots[0].unresolvedPromotionIds, [active.promotionId])
  assert.deepEqual(durable.replicaRoots[0].resolvedPromotions, [
    { promotionId: active.promotionId, materialRef: identityFor(active) },
  ])
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
