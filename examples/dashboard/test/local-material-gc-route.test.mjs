import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  MATERIAL_GC_PLAN_ROUTE,
  MATERIAL_GC_RELEASE_ROUTE,
  MATERIAL_GC_SWEEP_ROUTE,
  MATERIAL_PROMOTION_AVAILABILITY_ROUTE,
  createEnvironmentMaterialPromotionHandler,
  createEnvironmentMaterialPromotionMiddleware,
} from '../server/promotion/index.mjs'

const digest = character => `sha256:${character.repeat(64)}`
const ORIGIN = 'http://dashboard.test'
const PLAN_REQUEST = Object.freeze({
  schemaVersion: 1,
  projectId: 'project-a',
  replicaId: 'replica-a',
  expectedReplicaGeneration: 0,
  snapshotDigest: digest('a'),
  materialRefs: [],
  unresolvedPromotionIds: [],
})

const transportRequest = (path, body, overrides = {}) => ({
  method: 'POST',
  path,
  headers: { origin: ORIGIN, 'content-type': 'application/json' },
  expectedOrigins: [ORIGIN],
  body: JSON.stringify(body),
  ...overrides,
})

const createRegistryHarness = () => {
  const calls = []
  const plan = Object.freeze({
    schemaVersion: 1,
    kind: 'material-gc-plan',
    registryId: digest('b'),
    registryGeneration: 2,
    rootKeyDigest: digest('c'),
    projectId: PLAN_REQUEST.projectId,
    replicaId: PLAN_REQUEST.replicaId,
    replicaGeneration: 1,
    requestDigest: digest('d'),
    snapshotDigest: PLAN_REQUEST.snapshotDigest,
    globalRetainedMaterialRefs: [],
    deletionCandidates: [],
    planHash: digest('e'),
  })
  return {
    calls,
    plan,
    registry: Object.freeze({
      async recoverPendingPromotions() {
        calls.push({ operation: 'recover' })
        return []
      },
      async planGarbageCollection(input) {
        calls.push({ operation: 'plan', input })
        return plan
      },
      async sweepGarbageCollection(input) {
        calls.push({ operation: 'sweep', input })
        return {
          schemaVersion: 1,
          deletedMaterials: [],
          registryGeneration: 2,
          replicaGeneration: 1,
          planHash: plan.planHash,
        }
      },
      async releaseGarbageCollectionRoot(input) {
        calls.push({ operation: 'release', input })
        return {
          schemaVersion: 1,
          status: 'released',
          projectId: plan.projectId,
          replicaId: plan.replicaId,
          replicaGeneration: 2,
          requestDigest: digest('f'),
          registryGeneration: 3,
        }
      },
    }),
  }
}

test('GC routes remain reserved default-off with a typed unavailable response', async () => {
  const handler = createEnvironmentMaterialPromotionHandler({ env: {} })
  for (const [path, body] of [
    [MATERIAL_GC_PLAN_ROUTE, PLAN_REQUEST],
    [MATERIAL_GC_SWEEP_ROUTE, { schemaVersion: 1, plan: createRegistryHarness().plan }],
    [
      MATERIAL_GC_RELEASE_ROUTE,
      {
        schemaVersion: 1,
        projectId: 'project-a',
        replicaId: 'replica-a',
        expectedReplicaGeneration: 1,
        snapshotDigest: digest('a'),
      },
    ],
  ]) {
    const response = await handler.handle(transportRequest(path, body))
    assert.equal(response.status, 503)
    assert.equal(response.body.error.code, 'material-gc-unavailable')
  }
})

test('GC-only initialization injects trusted principal without creating or loading Easypack', async () => {
  const harness = createRegistryHarness()
  let registryCreates = 0
  let authorizations = 0
  let easypackLoads = 0
  const handler = createEnvironmentMaterialPromotionHandler({
    env: { EASY_EDITOR_MATERIAL_GC_ENABLED: '1' },
    createRegistry: async () => {
      registryCreates += 1
      return harness.registry
    },
    authorizePrincipal: async ({ projectId }) => {
      authorizations += 1
      assert.equal(projectId, 'project-a')
      return { tenantId: 'tenant-trusted', userId: 'user-trusted' }
    },
    loadEasypack: async () => {
      easypackLoads += 1
      throw new Error('GC-only route must not load Easypack')
    },
  })

  const response = await handler.handle(transportRequest(MATERIAL_GC_PLAN_ROUTE, PLAN_REQUEST))
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, harness.plan)
  assert.equal(registryCreates, 1)
  assert.equal(authorizations, 1)
  assert.equal(easypackLoads, 0)
  const planCall = harness.calls.find(call => call.operation === 'plan')
  assert.deepEqual(planCall.input.principal, { tenantId: 'tenant-trusted', userId: 'user-trusted' })
  assert.ok(!Object.hasOwn(planCall.input.request, 'tenantId'))
  assert.ok(!Object.hasOwn(planCall.input.request, 'userId'))
  assert.ok(Object.isFrozen(planCall.input.request))
  assert.ok(Object.isFrozen(planCall.input.request.materialRefs))

  const availability = await handler.handle({
    method: 'GET',
    path: MATERIAL_PROMOTION_AVAILABILITY_ROUTE,
    headers: { origin: ORIGIN },
    expectedOrigins: [ORIGIN],
    body: new Uint8Array(),
  })
  assert.deepEqual(availability.body, {
    schemaVersion: 1,
    available: false,
    reason: 'disabled',
    minimumNodeMajor: 20,
  })
  assert.equal(easypackLoads, 0)
})

test('GC DTO validation rejects authority injection and transport violations before authorization', async () => {
  const harness = createRegistryHarness()
  let authorizations = 0
  const handler = createEnvironmentMaterialPromotionHandler({
    env: { EASY_EDITOR_MATERIAL_GC_ENABLED: '1' },
    registry: harness.registry,
    authorizePrincipal: async () => {
      authorizations += 1
      return { tenantId: 'tenant-trusted', userId: 'user-trusted' }
    },
  })
  const injected = await handler.handle(
    transportRequest(MATERIAL_GC_PLAN_ROUTE, { ...PLAN_REQUEST, tenantId: 'tenant-browser' }),
  )
  assert.equal(injected.status, 400)
  assert.equal(authorizations, 0)

  for (const request of [
    transportRequest(MATERIAL_GC_PLAN_ROUTE, PLAN_REQUEST, { method: 'GET' }),
    transportRequest(MATERIAL_GC_PLAN_ROUTE, PLAN_REQUEST, {
      headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
    }),
    transportRequest(MATERIAL_GC_PLAN_ROUTE, PLAN_REQUEST, {
      headers: { origin: ORIGIN, 'content-type': 'text/plain' },
    }),
  ]) {
    const response = await handler.handle(request)
    assert.ok([403, 405, 415].includes(response.status))
  }
  assert.equal(authorizations, 0)
})

test('GC initialization failure remains a GC-specific typed unavailable response', async () => {
  const handler = createEnvironmentMaterialPromotionHandler({
    env: { EASY_EDITOR_MATERIAL_GC_ENABLED: '1' },
    createRegistry: async () => {
      throw new Error('registry offline')
    },
    authorizePrincipal: async () => ({ tenantId: 'tenant-trusted', userId: 'user-trusted' }),
  })
  const response = await handler.handle(transportRequest(MATERIAL_GC_PLAN_ROUTE, PLAN_REQUEST))
  assert.equal(response.status, 503)
  assert.equal(response.body.error.code, 'material-gc-unavailable')
})

test('Node middleware exposes the same strict GC route and DTO', async t => {
  const harness = createRegistryHarness()
  const middleware = createEnvironmentMaterialPromotionMiddleware({
    env: { EASY_EDITOR_MATERIAL_GC_ENABLED: '1' },
    publicOrigins: ['http://127.0.0.1'],
    registry: harness.registry,
    authorizePrincipal: async () => ({ tenantId: 'tenant-node', userId: 'user-node' }),
  })
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.writeHead(404).end()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  const response = await fetch(`${origin}${MATERIAL_GC_PLAN_ROUTE}`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1', 'Content-Type': 'application/json' },
    body: JSON.stringify(PLAN_REQUEST),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), harness.plan)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('Vite and production continue to share the GC-aware environment middleware', async () => {
  const viteSource = await readFile(new URL('../vite.config.mts', import.meta.url), 'utf8')
  const productionSource = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')
  for (const source of [viteSource, productionSource]) {
    assert.match(source, /createEnvironmentMaterialPromotionMiddleware/u)
  }
  const nodeAdapterSource = await readFile(new URL('../server/promotion/node-adapter.mjs', import.meta.url), 'utf8')
  assert.match(nodeAdapterSource, /MATERIAL_GC_PLAN_ROUTE/u)
  assert.match(nodeAdapterSource, /MATERIAL_GC_SWEEP_ROUTE/u)
  assert.match(nodeAdapterSource, /MATERIAL_GC_RELEASE_ROUTE/u)
})
