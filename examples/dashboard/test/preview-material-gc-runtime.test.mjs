import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createMaterialGcPlanHashInput,
  createMaterialGcPlanRequestDigestInput,
} from '../shared/material-gc-contract.mjs'
import { createDashboardPreviewMaterialGcComposition } from '../src/pages/preview/material-gc.mjs'

const digest = character => `sha256:${character.repeat(64)}`
const projectId = 'preview-project'
const replicaId = '11111111-1111-4111-8111-111111111111'
const material = Object.freeze({
  materialId: 'preview-material',
  materialVersion: '1.0.0',
  buildIntegrity: digest('9'),
})

const hashContractJson = async value => {
  const bytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return `sha256:${Buffer.from(bytes).toString('hex')}`
}

const createPlan = async (request, { retainMaterial }) => {
  const requestDigest = await hashContractJson(createMaterialGcPlanRequestDigestInput(request))
  const placeholder = Object.freeze({
    schemaVersion: 1,
    kind: 'material-gc-plan',
    registryId: digest('b'),
    registryGeneration: 1,
    rootKeyDigest: digest('c'),
    projectId: request.projectId,
    replicaId: request.replicaId,
    replicaGeneration: request.expectedReplicaGeneration + 1,
    requestDigest,
    snapshotDigest: request.snapshotDigest,
    globalRetainedMaterialRefs: Object.freeze(retainMaterial ? [...request.materialRefs] : []),
    deletionCandidates: Object.freeze([]),
    planHash: digest('0'),
  })
  return Object.freeze({
    ...placeholder,
    planHash: await hashContractJson(createMaterialGcPlanHashInput(placeholder)),
  })
}

const jsonResponse = value => ({
  ok: true,
  status: 200,
  headers: { get: name => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify(value),
})

class ImmediateLockManager {
  #active = new Map()

  async request(name, options, operation) {
    this.#active.set(name, (this.#active.get(name) ?? 0) + 1)
    try {
      return await operation(Object.freeze({ name, mode: options.mode }))
    } finally {
      const remaining = (this.#active.get(name) ?? 1) - 1
      if (remaining === 0) this.#active.delete(name)
      else this.#active.set(name, remaining)
    }
  }

  get activePresenceCount() {
    return [...this.#active.entries()]
      .filter(([name]) => name.includes(':project-presence:'))
      .reduce((total, [, count]) => total + count, 0)
  }
}

const eventually = async predicate => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('condition was not reached')
}

const createHarness = ({ deferPlan = false, retainMaterial = true } = {}) => {
  const events = []
  const routes = []
  const values = new Map()
  const lockManager = new ImmediateLockManager()
  let continuePlan = () => undefined
  const planGate = deferPlan
    ? new Promise(resolve => {
        continuePlan = resolve
      })
    : Promise.resolve()
  const fetchImpl = async (route, init) => {
    routes.push(route)
    const request = JSON.parse(init.body)
    events.push('plan-request')
    await planGate
    const plan = await createPlan(request, { retainMaterial })
    events.push('plan-ack')
    return jsonResponse(plan)
  }
  const snapshot = Object.freeze({
    schemaVersion: 1,
    projectId,
    generationFence: Object.freeze([{ branchId: 'main', draftGeneration: 1 }]),
    sessionGenerationFence: Object.freeze([]),
    rootFence: Object.freeze([]),
    storeFence: Object.freeze([]),
    materialRefs: Object.freeze([material]),
    unresolvedPromotionIds: Object.freeze([]),
    snapshotDigest: digest('a'),
  })
  const persistence = {
    getSnapshot: () => ({
      state: 'ready',
      projectId,
      branchId: 'main',
      draftGeneration: 1,
      pendingAutosave: false,
    }),
    async flush() {},
    async withMaterialGcFence(expectedProjectId, operation) {
      assert.equal(expectedProjectId, projectId)
      return operation({ readSnapshot: async () => snapshot })
    },
  }
  const composition = createDashboardPreviewMaterialGcComposition({
    enabled: true,
    environment: {
      inputTarget: new EventTarget(),
      lockManager,
      storage: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
      crypto: {
        randomUUID: () => replicaId,
        subtle: webcrypto.subtle,
      },
      fetchImpl,
    },
    persistence,
  })
  return { composition, continuePlan, events, lockManager, routes, snapshot }
}

test('preview exposure waits for durable material ACK and ordinary dispose releases presence without terminal release', async () => {
  const harness = createHarness({ deferPlan: true })
  const exposure = harness.composition.withMaterialAdmission(
    {
      schemaVersion: 1,
      projectId,
      materialRefs: harness.snapshot.materialRefs,
      unresolvedPromotionIds: harness.snapshot.unresolvedPromotionIds,
      reason: 'preview-load',
    },
    () => {
      harness.events.push('online-surface')
      harness.events.push('set-document')
    },
  )

  await eventually(() => harness.events.includes('plan-request'))
  assert.deepEqual(harness.events, ['plan-request'])
  assert.equal(harness.lockManager.activePresenceCount, 1)

  harness.continuePlan()
  await exposure
  assert.deepEqual(harness.events, ['plan-request', 'plan-ack', 'online-surface', 'set-document'])
  assert.equal(harness.composition.dispose(), true)
  assert.equal(harness.composition.dispose(), false)
  await eventually(() => harness.lockManager.activePresenceCount === 0)
  assert.deepEqual(harness.routes, ['/api/materials/gc/plan'])
})

test('preview admission rejection never starts the online surface or publishes a document', async () => {
  const harness = createHarness({ retainMaterial: false })
  await assert.rejects(
    harness.composition.withMaterialAdmission(
      {
        schemaVersion: 1,
        projectId,
        materialRefs: harness.snapshot.materialRefs,
        unresolvedPromotionIds: harness.snapshot.unresolvedPromotionIds,
        reason: 'preview-load',
      },
      () => {
        harness.events.push('online-surface')
        harness.events.push('set-document')
      },
    ),
    /did not retain the admitted material/u,
  )
  assert.deepEqual(harness.events, ['plan-request', 'plan-ack'])
  harness.composition.dispose()
  await eventually(() => harness.lockManager.activePresenceCount === 0)
  assert.deepEqual(harness.routes, ['/api/materials/gc/plan'])
})

test('preview GC default-off does not read any GC environment or persistence getter', () => {
  let effects = 0
  const environment = {}
  for (const field of ['inputTarget', 'lockManager', 'storage', 'crypto', 'fetchImpl']) {
    Object.defineProperty(environment, field, {
      get() {
        effects += 1
        throw new Error(`unexpected GC environment.${field} access`)
      },
    })
  }
  const options = { enabled: false, environment }
  Object.defineProperty(options, 'persistence', {
    get() {
      effects += 1
      throw new Error('unexpected GC persistence access')
    },
  })
  assert.equal(createDashboardPreviewMaterialGcComposition(options), null)
  assert.equal(effects, 0)
})

test('preview production wiring stays independent from Editor Host and exposes only after admission', async () => {
  const [previewSource, materialGcSource] = await Promise.all([
    readFile(new URL('../src/pages/preview/index.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/preview/material-gc.mjs', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(`${previewSource}\n${materialGcSource}`, /@\/editor\/runtime|editor\/agent\/host/u)
  assert.doesNotMatch(`${previewSource}\n${materialGcSource}`, /releaseCurrentReplica|pagehide/u)
  assert.match(previewSource, /if \(!previewMaterialGcEnabled\) \{[\s\S]+?exposePreview\(\)[\s\S]+?return/u)
  assert.match(previewSource, /withDashboardMaterialAdmissionBeforeExposure\(\{[\s\S]+?reason: 'preview-load'/u)
  assert.match(previewSource, /operation: exposePreview/u)
  assert.match(
    previewSource,
    /const exposePreview = \(\) => \{[\s\S]+?startDashboardOnlineComponentSurface\([\s\S]+?setDocument\(/u,
  )
  assert.match(materialGcSource, /createDashboardMaterialGcCrossTabCoordinator/u)
  assert.match(materialGcSource, /createDashboardMaterialGcReplicaState/u)
  assert.match(materialGcSource, /createDashboardSameOriginMaterialGcClient/u)
  assert.match(materialGcSource, /createDashboardMutationQuiescenceGate/u)
  assert.match(materialGcSource, /createHumanActivityLease/u)
  assert.match(materialGcSource, /createDashboardInvocationActivity/u)
})
