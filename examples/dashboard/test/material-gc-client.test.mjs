import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DashboardMaterialGcClientError,
  createDashboardSameOriginMaterialGcClient,
} from '../src/editor/agent/capabilities/promotion/material-gc-client.mjs'

const digest = character => `sha256:${character.repeat(64)}`
const request = Object.freeze({
  schemaVersion: 1,
  projectId: 'project-a',
  replicaId: '11111111-1111-4111-8111-111111111111',
  expectedReplicaGeneration: 0,
  snapshotDigest: digest('a'),
  materialRefs: [],
  unresolvedPromotionIds: [],
})
const plan = Object.freeze({
  schemaVersion: 1,
  kind: 'material-gc-plan',
  registryId: digest('b'),
  registryGeneration: 2,
  rootKeyDigest: digest('c'),
  projectId: request.projectId,
  replicaId: request.replicaId,
  replicaGeneration: 1,
  requestDigest: digest('d'),
  snapshotDigest: request.snapshotDigest,
  globalRetainedMaterialRefs: [],
  deletionCandidates: [],
  planHash: digest('e'),
})

const jsonResponse = (value, options = {}) =>
  new Response(JSON.stringify(value), {
    status: options.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })

test('Material GC client uses strict same-origin JSON transport without browser authority fields', async () => {
  const calls = []
  const client = createDashboardSameOriginMaterialGcClient({
    fetchImpl: async (route, init) => {
      calls.push({ route, init })
      return jsonResponse(plan)
    },
  })

  assert.deepEqual(await client.planGc(request), plan)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].route, '/api/materials/gc/plan')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'same-origin')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.headers.Accept, 'application/json')
  const body = JSON.parse(calls[0].init.body)
  assert.deepEqual(body, request)
  assert.ok(!Object.hasOwn(body, 'tenantId'))
  assert.ok(!Object.hasOwn(body, 'userId'))
})

test('Material GC client validates sweep and release responses exactly', async () => {
  const responses = [
    {
      schemaVersion: 1,
      deletedMaterials: [],
      registryGeneration: 2,
      replicaGeneration: 1,
      planHash: plan.planHash,
    },
    {
      schemaVersion: 1,
      status: 'released',
      projectId: request.projectId,
      replicaId: request.replicaId,
      replicaGeneration: 2,
      requestDigest: digest('f'),
      registryGeneration: 3,
    },
  ]
  const calls = []
  const client = createDashboardSameOriginMaterialGcClient({
    fetchImpl: async (route, init) => {
      calls.push({ route, body: JSON.parse(init.body) })
      return jsonResponse(responses.shift())
    },
  })

  const sweep = await client.sweepGc({ schemaVersion: 1, plan })
  assert.equal(sweep.planHash, plan.planHash)
  const release = await client.releaseGc({
    schemaVersion: 1,
    projectId: request.projectId,
    replicaId: request.replicaId,
    expectedReplicaGeneration: 1,
    snapshotDigest: request.snapshotDigest,
  })
  assert.equal(release.status, 'released')
  assert.deepEqual(
    calls.map(call => call.route),
    ['/api/materials/gc/sweep', '/api/materials/gc/release'],
  )
})

test('Material GC client treats accepted malformed responses as ambiguous and enforces byte and JSON budgets', async () => {
  for (const response of [
    jsonResponse({ ...plan, injected: true }),
    new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(1024 * 1024 + 1) },
    }),
  ]) {
    const client = createDashboardSameOriginMaterialGcClient({ fetchImpl: async () => response })
    await assert.rejects(client.planGc(request), error => {
      assert.ok(error instanceof DashboardMaterialGcClientError)
      assert.equal(error.code, 'invalid-response')
      assert.equal(error.ambiguous, true)
      return true
    })
  }
})

test('Material GC client treats 408, 5xx, retryable, and malformed error responses as ambiguous', async () => {
  const uncertainResponses = [
    jsonResponse(
      { schemaVersion: 1, error: { code: 'request-timeout', message: 'timeout', retryable: false } },
      { status: 408 },
    ),
    jsonResponse(
      { schemaVersion: 1, error: { code: 'gc-unavailable', message: 'unavailable', retryable: false } },
      { status: 503 },
    ),
    jsonResponse(
      { schemaVersion: 1, error: { code: 'gc-replica-generation-conflict', message: 'retry', retryable: true } },
      { status: 409 },
    ),
    new Response('not-json', { status: 503, headers: { 'Content-Type': 'text/plain' } }),
    jsonResponse(
      { schemaVersion: 1, error: { code: 'invalid-request', message: 'invalid', retryable: false, injected: true } },
      { status: 400 },
    ),
  ]
  for (const response of uncertainResponses) {
    const client = createDashboardSameOriginMaterialGcClient({ fetchImpl: async () => response })
    await assert.rejects(client.planGc(request), error => {
      assert.ok(error instanceof DashboardMaterialGcClientError)
      assert.equal(error.ambiguous, true)
      return true
    })
  }
})

test('Material GC client distinguishes explicit non-retryable conflicts from ambiguous transport and abort failures', async () => {
  const conflict = createDashboardSameOriginMaterialGcClient({
    fetchImpl: async () =>
      jsonResponse(
        {
          schemaVersion: 1,
          error: { code: 'gc-replica-generation-conflict', message: 'conflict', retryable: false },
        },
        { status: 409 },
      ),
  })
  await assert.rejects(conflict.planGc(request), error => {
    assert.equal(error.code, 'gc-replica-generation-conflict')
    assert.equal(error.ambiguous, false)
    return true
  })

  for (const error of [new TypeError('offline'), new DOMException('aborted', 'AbortError')]) {
    const client = createDashboardSameOriginMaterialGcClient({
      fetchImpl: async () => {
        throw error
      },
    })
    await assert.rejects(client.planGc(request), failure => {
      assert.ok(failure instanceof DashboardMaterialGcClientError)
      assert.equal(failure.ambiguous, true)
      assert.ok(['aborted', 'transport-failed'].includes(failure.code))
      return true
    })
  }
})

test('Material GC client rejects cross-origin and protocol-relative route overrides', () => {
  for (const route of ['https://example.test/gc', '//example.test/gc', '/safe\\escape']) {
    assert.throws(
      () =>
        createDashboardSameOriginMaterialGcClient({ fetchImpl: async () => jsonResponse({}), routes: { plan: route } }),
      /same-origin/u,
    )
  }
})
