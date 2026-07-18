import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as createHttpRequest, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDashboardServer } from '../server/index.mjs'
import {
  MATERIAL_PROMOTION_AVAILABILITY_ROUTE,
  MATERIAL_PROMOTION_QUERY_ROUTE,
  MATERIAL_PROMOTION_ROUTE,
  createEnvironmentMaterialPromotionMiddleware,
  createMaterialPromotionCoordinator,
  createMaterialPromotionHandler,
  createNodeMaterialPromotionMiddleware,
} from '../server/promotion/index.mjs'
import { canonicalJsonStringify } from '../src/lib/storage/canonical-json.mjs'

const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const sha256Sri = value => `sha256-${createHash('sha256').update(value).digest('base64')}`
const digest = character => `sha256:${character.repeat(64)}`
const clone = value => JSON.parse(JSON.stringify(value))

const source = `export default {
  mount(root) { root.textContent = 'durable KPI' },
  update() {},
  destroy(root) { root.replaceChildren() },
}`
const dependencySource = 'export default { render() {} }'
const lockedDependencies = [
  {
    package: 'chart',
    range: '^1.2.0',
    exactVersion: '1.2.3',
    finalUrl: 'https://cdn.example.test/chart@1.2.3/index.mjs',
    integrity: sha256Sri(dependencySource),
    cached: true,
    module: {
      format: 'bundled-esm',
      contentType: 'text/javascript',
      encoding: 'base64',
      byteLength: Buffer.byteLength(dependencySource),
      bytes: Buffer.from(dependencySource).toString('base64'),
    },
  },
]
const dependencyLockDigest = sha256(canonicalJsonStringify(lockedDependencies))
const buildBytes = Buffer.from('export const trusted = true\n')
const buildIntegrity = sha256(buildBytes)

const artifact = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-promotion',
  artifactId: 'artifact-kpi',
  sourceRevision: 'source-revision-7',
  logicalComponentId: 'logical-kpi',
  sourceIntegrity: sha256(source),
  source,
  css: ':host { display: block; }',
  safeManifest: { schemaVersion: 1, title: 'Durable KPI' },
  lockedDependencies,
  dependencyLockDigest,
  diagnostics: [],
  provenance: { actor: 'agent-test' },
  createdAt: 100,
  supersedes: null,
  ...overrides,
})

const canonicalPromotionId = request =>
  sha256(
    canonicalJsonStringify({
      schemaVersion: 1,
      kind: 'local-material-promotion-identity',
      authority: {
        projectId: request.projectId,
        branchId: request.branchId,
        sessionId: request.sessionId,
        taskId: request.taskId,
      },
      callId: request.callId,
      callDigest: request.callDigest,
      artifact: {
        artifactId: request.artifact.artifactId,
        sourceRevision: request.artifact.sourceRevision,
        logicalComponentId: request.artifact.logicalComponentId,
        sourceIntegrity: request.artifact.sourceIntegrity,
        dependencyLockDigest: request.artifact.dependencyLockDigest,
      },
    }),
  )

const promotionRequest = (overrides = {}) => {
  const request = {
    schemaVersion: 1,
    projectId: 'project-promotion',
    branchId: 'main',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
    callDigest: digest('a'),
    artifact: artifact(),
    ...overrides,
  }
  return { ...request, promotionId: overrides.promotionId ?? canonicalPromotionId(request) }
}

const sourceRevisionOf = value => ({
  artifactId: value.artifactId,
  sourceRevision: value.sourceRevision,
  logicalComponentId: value.logicalComponentId,
  sourceIntegrity: value.sourceIntegrity,
})

const promotionError = (code, status, message, retryable = false) =>
  Object.assign(new Error(message), { code, status, retryable })

const createCoordinatorHarness = ({ onStage } = {}) => {
  const authorizationCalls = []
  const authorCalls = []
  const registryCalls = []
  const records = new Map()
  const principal = Object.freeze({ tenantId: 'trusted-tenant', userId: 'trusted-user' })

  const authorizePrincipal = async input => {
    authorizationCalls.push(clone(input))
    if (input.headers.authorization !== 'Bearer server-session' || input.projectId !== 'project-promotion') {
      throw promotionError('unauthorized', 403, 'Request is not authorized')
    }
    return principal
  }
  const author = {
    async authorPromotion(input) {
      authorCalls.push(clone(input))
      const requestArtifact = input.request.artifact
      return {
        schemaVersion: 1,
        promotionId: input.request.promotionId,
        projectId: input.request.projectId,
        materialId: requestArtifact.logicalComponentId,
        materialVersion: requestArtifact.sourceRevision,
        logicalComponentId: requestArtifact.logicalComponentId,
        buildIntegrity,
        sourceRevision: sourceRevisionOf(requestArtifact),
        dependencyLockDigest: requestArtifact.dependencyLockDigest,
        entryFile: 'dist/index.esm.js',
        buildDirectory: '/trusted-author-workspace/build',
        files: [{ path: 'dist/index.esm.js', byteLength: buildBytes.byteLength, integrity: buildIntegrity }],
        createdAt: 200,
      }
    },
  }
  const registry = {
    async stagePromotion(request) {
      registryCalls.push({ method: 'stagePromotion', request: clone(request) })
      const { buildDirectory: _buildDirectory, ...binding } = clone(request)
      const existing = records.get(request.promotionId)
      if (existing && canonicalJsonStringify(existing.binding) !== canonicalJsonStringify(binding)) {
        throw promotionError('promotion-conflict', 409, 'promotionId is already bound to different frozen inputs')
      }
      if (!existing) records.set(request.promotionId, { binding, state: 'manifest-staged' })
      await onStage?.()
      return { ...clone(records.get(request.promotionId).binding), state: records.get(request.promotionId).state }
    },
    async publishPromotion({ promotionId }) {
      registryCalls.push({ method: 'publishPromotion', promotionId })
      const record = records.get(promotionId)
      if (!record) throw promotionError('promotion-not-found', 404, 'Promotion was not staged')
      record.state = 'active'
      return { ...clone(record.binding), state: 'active' }
    },
    async queryPromotion(request) {
      registryCalls.push({ method: 'queryPromotion', request: clone(request) })
      const record = records.get(request.promotionId)
      if (!record || record.binding.projectId !== request.projectId) return null
      return { ...clone(record.binding), state: record.state }
    },
  }
  const coordinator = createMaterialPromotionCoordinator({ authorizePrincipal, author, registry })
  const handler = createMaterialPromotionHandler({ coordinator })
  return { authorizationCalls, authorCalls, coordinator, handler, principal, records, registryCalls }
}

const transportRequest = (value, overrides = {}) => ({
  method: 'POST',
  path: MATERIAL_PROMOTION_ROUTE,
  headers: {
    'content-type': 'application/json',
    origin: 'https://dashboard.example.test',
    authorization: 'Bearer server-session',
  },
  expectedOrigins: ['https://dashboard.example.test'],
  body: Buffer.from(JSON.stringify(value)),
  ...overrides,
})

const listen = server => new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
const close = server =>
  new Promise((resolvePromise, reject) => server.close(error => (error ? reject(error) : resolvePromise())))
const originFor = server => {
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}
const requestOverHttp = (origin, value, overrides = {}) => {
  const { headers = {}, path = MATERIAL_PROMOTION_ROUTE, ...requestOverrides } = overrides
  return fetch(`${origin}${path}`, {
    method: 'POST',
    body: JSON.stringify(value),
    ...requestOverrides,
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Authorization: 'Bearer server-session',
      ...headers,
    },
  })
}

test('coordinator binds project authority to the trusted principal and keeps promotionId idempotent', async () => {
  const harness = createCoordinatorHarness()
  const request = promotionRequest()
  const first = await harness.handler.handle(transportRequest(request))
  const second = await harness.handler.handle(transportRequest(request))

  assert.deepEqual(second, first)
  assert.deepEqual(first, {
    status: 200,
    body: {
      schemaVersion: 1,
      status: 'active',
      promotionId: request.promotionId,
      materialId: 'logical-kpi',
      materialVersion: 'source-revision-7',
      buildIntegrity,
      rollbackTo: sourceRevisionOf(request.artifact),
    },
  })
  assert.equal(harness.authorizationCalls.length, 2)
  assert.deepEqual(harness.authorizationCalls[0], {
    headers: {
      'content-type': 'application/json',
      origin: 'https://dashboard.example.test',
      authorization: 'Bearer server-session',
    },
    projectId: 'project-promotion',
  })
  assert.equal(harness.authorCalls.length, 2)
  assert.deepEqual(harness.authorCalls[0].principal, harness.principal)
  assert.equal(Object.hasOwn(harness.authorCalls[0].request, 'tenantId'), false)
  assert.equal(Object.hasOwn(harness.authorCalls[0].request, 'userId'), false)
  assert.equal(harness.registryCalls.filter(call => call.method === 'stagePromotion').length, 2)
  assert.equal(harness.registryCalls.filter(call => call.method === 'publishPromotion').length, 2)

  const clientIdentity = await harness.handler.handle(
    transportRequest({ ...request, tenantId: 'attacker-tenant', userId: 'attacker-user' }),
  )
  assert.deepEqual(clientIdentity, {
    status: 400,
    body: {
      schemaVersion: 1,
      error: { code: 'invalid-request', message: 'Request is invalid', retryable: false },
    },
  })
  assert.equal(harness.authorizationCalls.length, 2, 'client-owned identity must be rejected before authorization')

  const unauthorizedArtifact = artifact({ projectId: 'project-other' })
  const unauthorized = await harness.handler.handle(
    transportRequest(
      promotionRequest({
        projectId: 'project-other',
        artifact: unauthorizedArtifact,
      }),
    ),
  )
  assert.equal(unauthorized.status, 403)
  assert.deepEqual(unauthorized.body.error, {
    code: 'unauthorized',
    message: 'Request is not authorized',
    retryable: false,
  })
  assert.equal(harness.authorCalls.length, 2, 'project authority is checked before authoring')
})

test('same promotionId rejects a different frozen source revision with a typed 409', async () => {
  const harness = createCoordinatorHarness()
  const original = promotionRequest()
  assert.equal((await harness.handler.handle(transportRequest(original))).status, 200)

  const revisedSource = `${source}\n// frozen revision changed`
  const revisedArtifact = artifact({
    sourceRevision: 'source-revision-8',
    source: revisedSource,
    sourceIntegrity: sha256(revisedSource),
  })
  const conflict = await harness.handler.handle(
    transportRequest(promotionRequest({ artifact: revisedArtifact, promotionId: original.promotionId })),
  )
  assert.deepEqual(conflict, {
    status: 409,
    body: {
      schemaVersion: 1,
      error: {
        code: 'promotion-conflict',
        message: 'promotionId does not match the canonical call and artifact identity',
        retryable: false,
      },
    },
  })
})

test('promotionId canonically binds branch, call digest, call id, and artifact identity', async () => {
  const harness = createCoordinatorHarness()
  const original = promotionRequest()
  assert.equal((await harness.handler.handle(transportRequest(original))).status, 200)

  for (const changed of [{ branchId: 'release' }, { callId: 'call-2' }, { callDigest: digest('c') }]) {
    const conflict = await harness.handler.handle(
      transportRequest(promotionRequest({ ...changed, promotionId: original.promotionId })),
    )
    assert.deepEqual(conflict, {
      status: 409,
      body: {
        schemaVersion: 1,
        error: {
          code: 'promotion-conflict',
          message: 'promotionId does not match the canonical call and artifact identity',
          retryable: false,
        },
      },
    })
  }
  assert.equal(harness.authorCalls.length, 1)
})

test('abort signal stops before build and after stage before publication', async () => {
  const beforeBuild = createCoordinatorHarness()
  const preAborted = new AbortController()
  preAborted.abort()
  const abortedBeforeBuild = await beforeBuild.handler.handle(
    transportRequest(promotionRequest(), { signal: preAborted.signal }),
  )
  assert.deepEqual(abortedBeforeBuild, {
    status: 408,
    body: {
      schemaVersion: 1,
      error: {
        code: 'promotion-aborted',
        message: 'Local material promotion was aborted',
        retryable: true,
      },
    },
  })
  assert.equal(beforeBuild.authorCalls.length, 0)
  assert.equal(beforeBuild.registryCalls.length, 0)

  const beforePublishController = new AbortController()
  const beforePublish = createCoordinatorHarness({ onStage: () => beforePublishController.abort() })
  const abortedBeforePublish = await beforePublish.handler.handle(
    transportRequest(promotionRequest(), { signal: beforePublishController.signal }),
  )
  assert.equal(abortedBeforePublish.status, 408)
  assert.equal(abortedBeforePublish.body.error.code, 'promotion-aborted')
  assert.equal(beforePublish.authorCalls.length, 1)
  assert.equal(beforePublish.registryCalls.filter(call => call.method === 'stagePromotion').length, 1)
  assert.equal(beforePublish.registryCalls.filter(call => call.method === 'publishPromotion').length, 0)
})

test('query returns authoritative active, not-found, and staged-unknown states', async () => {
  const harness = createCoordinatorHarness()
  const request = promotionRequest()
  const queryRequest = {
    schemaVersion: 1,
    projectId: request.projectId,
    promotionId: request.promotionId,
  }
  const queryTransport = value =>
    transportRequest(value, {
      path: MATERIAL_PROMOTION_QUERY_ROUTE,
    })

  const missing = await harness.handler.handle(queryTransport(queryRequest))
  assert.equal(missing.status, 404)
  assert.equal(missing.body.error.code, 'promotion-not-found')

  const invalid = await harness.handler.handle(queryTransport({ ...queryRequest, branchId: 'main' }))
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.error.code, 'invalid-request')

  const promoted = await harness.handler.handle(transportRequest(request))
  const active = await harness.handler.handle(queryTransport(queryRequest))
  assert.deepEqual(active, promoted)

  harness.records.get(request.promotionId).state = 'manifest-staged'
  const unknown = await harness.handler.handle(queryTransport(queryRequest))
  assert.deepEqual(unknown, {
    status: 409,
    body: {
      schemaVersion: 1,
      error: {
        code: 'promotion-state-unknown',
        message: 'Promotion state is not active',
        retryable: true,
      },
    },
  })
})

test('transport handler and node adapter enforce method, same-origin, media type, and body budget', async t => {
  const harness = createCoordinatorHarness()
  const handler = harness.handler
  const invalidCases = [
    [transportRequest(promotionRequest(), { method: 'GET' }), 405],
    [
      transportRequest(promotionRequest(), {
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
          authorization: 'Bearer server-session',
        },
      }),
      403,
    ],
    [
      transportRequest(promotionRequest(), {
        headers: {
          'content-type': 'text/plain',
          origin: 'https://dashboard.example.test',
          authorization: 'Bearer server-session',
        },
      }),
      415,
    ],
  ]
  for (const [request, expectedStatus] of invalidCases) {
    const result = await handler.handle(request)
    assert.deepEqual(result, {
      status: expectedStatus,
      body: {
        schemaVersion: 1,
        error: { code: 'invalid-request', message: 'Request is invalid', retryable: false },
      },
    })
  }

  let nextCalls = 0
  const middleware = createNodeMaterialPromotionMiddleware({ handler })
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      nextCalls += 1
      response.writeHead(404).end()
    })
  })
  await listen(server)
  t.after(() => close(server))
  const origin = originFor(server)

  const oversized = await fetch(`${origin}${MATERIAL_PROMOTION_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: 'x'.repeat(3 * 1024 * 1024),
  })
  assert.equal(oversized.status, 413)
  assert.deepEqual(await oversized.json(), {
    schemaVersion: 1,
    error: { code: 'invalid-request', message: 'Request is invalid', retryable: false },
  })

  const unrelated = await fetch(`${origin}/not-a-promotion`)
  assert.equal(unrelated.status, 404)
  assert.equal(nextCalls, 1)
})

test('node operation timeout aborts before authoring starts', async t => {
  let authorCalls = 0
  const coordinator = createMaterialPromotionCoordinator({
    async authorizePrincipal() {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
      return { tenantId: 'trusted-tenant', userId: 'trusted-user' }
    },
    author: {
      async authorPromotion() {
        authorCalls += 1
        throw new Error('author must not start after operation timeout')
      },
    },
    registry: {
      async stagePromotion() {
        throw new Error('registry must not start after operation timeout')
      },
      async publishPromotion() {
        throw new Error('registry must not start after operation timeout')
      },
    },
  })
  const middleware = createNodeMaterialPromotionMiddleware({
    handler: createMaterialPromotionHandler({ coordinator }),
    inboundTimeoutMs: 100,
    operationTimeoutMs: 5,
  })
  const server = createServer((request, response) => {
    void middleware(request, response, () => response.writeHead(404).end())
  })
  await listen(server)
  t.after(() => close(server))

  const response = await requestOverHttp(originFor(server), promotionRequest())
  assert.equal(response.status, 408)
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    error: {
      code: 'promotion-aborted',
      message: 'Local material promotion was aborted',
      retryable: true,
    },
  })
  assert.equal(authorCalls, 0)
})

test('node operation timeout terminates a stalled inbound body before dispatch', async t => {
  let handlerCalls = 0
  const middleware = createNodeMaterialPromotionMiddleware({
    handler: {
      async handle() {
        handlerCalls += 1
        throw new Error('stalled input must not reach the handler')
      },
    },
    inboundTimeoutMs: 1_000,
    operationTimeoutMs: 10,
  })
  const server = createServer((request, response) => {
    void middleware(request, response, () => response.writeHead(404).end())
  })
  await listen(server)
  t.after(() => close(server))

  const url = new URL(MATERIAL_PROMOTION_ROUTE, originFor(server))
  let clientRequest
  const result = await new Promise((resolvePromise, reject) => {
    clientRequest = createHttpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Length': 100,
        'Content-Type': 'application/json',
        Origin: originFor(server),
      },
    })
    clientRequest.once('error', reject)
    clientRequest.once('response', response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('end', () => {
        resolvePromise({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      })
    })
    clientRequest.write('{')
  })
  clientRequest.destroy()

  assert.equal(result.status, 408)
  assert.equal(result.body.error.code, 'promotion-aborted')
  assert.equal(handlerCalls, 0)
})

test('availability readiness work is bounded by the node operation timeout', async t => {
  const middleware = createNodeMaterialPromotionMiddleware({
    handler: createMaterialPromotionHandler({
      coordinator: {
        async promote() {
          throw new Error('availability must not promote')
        },
        async query() {
          throw new Error('availability must not query')
        },
      },
      async checkAvailability() {
        await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
        return { schemaVersion: 1, available: true, reason: 'ready', minimumNodeMajor: 20 }
      },
    }),
    operationTimeoutMs: 5,
  })
  const server = createServer((request, response) => {
    void middleware(request, response, () => response.writeHead(404).end())
  })
  await listen(server)
  t.after(() => close(server))

  const origin = originFor(server)
  const response = await fetch(`${origin}${MATERIAL_PROMOTION_AVAILABILITY_ROUTE}`, {
    headers: { Origin: origin },
  })
  assert.equal(response.status, 408)
  assert.equal((await response.json()).error.code, 'promotion-aborted')
})

test('client disconnect after staging aborts before publication', async t => {
  let clientRequest
  let resolveStageReached
  const stageReached = new Promise(resolvePromise => {
    resolveStageReached = resolvePromise
  })
  const harness = createCoordinatorHarness({
    async onStage() {
      clientRequest.destroy()
      resolveStageReached()
      await new Promise(resolvePromise => setTimeout(resolvePromise, 15))
    },
  })
  const middleware = createNodeMaterialPromotionMiddleware({ handler: harness.handler })
  const server = createServer((request, response) => {
    void middleware(request, response, () => response.writeHead(404).end())
  })
  await listen(server)
  t.after(() => close(server))

  const url = new URL(MATERIAL_PROMOTION_ROUTE, originFor(server))
  const body = Buffer.from(JSON.stringify(promotionRequest()))
  const clientClosed = new Promise(resolvePromise => {
    clientRequest = createHttpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        Authorization: 'Bearer server-session',
        'Content-Length': body.byteLength,
        'Content-Type': 'application/json',
        Origin: originFor(server),
      },
    })
    clientRequest.once('error', resolvePromise)
    clientRequest.end(body)
  })

  await stageReached
  await clientClosed
  await new Promise(resolvePromise => setTimeout(resolvePromise, 30))
  assert.equal(harness.registryCalls.filter(call => call.method === 'stagePromotion').length, 1)
  assert.equal(harness.registryCalls.filter(call => call.method === 'publishPromotion').length, 0)
})

test('environment middleware reserves the route and returns explicit typed unavailable while default-off', async t => {
  let nextCalls = 0
  const middleware = createEnvironmentMaterialPromotionMiddleware({ env: {} })
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      nextCalls += 1
      response.writeHead(404).end()
    })
  })
  await listen(server)
  t.after(() => close(server))

  const origin = originFor(server)
  const response = await requestOverHttp(origin, promotionRequest())
  assert.equal(response.status, 503)
  assert.equal(nextCalls, 0)
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    error: {
      code: 'promotion-unavailable',
      message: 'Local material promotion is unavailable',
      retryable: false,
    },
  })

  const availability = await fetch(`${origin}${MATERIAL_PROMOTION_AVAILABILITY_ROUTE}`, {
    headers: { Origin: origin },
  })
  assert.equal(availability.status, 200)
  assert.deepEqual(await availability.json(), {
    schemaVersion: 1,
    available: false,
    reason: 'disabled',
    minimumNodeMajor: 20,
  })

  const availabilityPost = await requestOverHttp(
    origin,
    { schemaVersion: 1 },
    { path: MATERIAL_PROMOTION_AVAILABILITY_ROUTE },
  )
  assert.equal(availabilityPost.status, 200)
  assert.deepEqual(await availabilityPost.json(), {
    schemaVersion: 1,
    available: false,
    reason: 'disabled',
    minimumNodeMajor: 20,
  })
  const invalidAvailabilityPost = await requestOverHttp(
    origin,
    { schemaVersion: 1, probe: true },
    { path: MATERIAL_PROMOTION_AVAILABILITY_ROUTE },
  )
  assert.equal(invalidAvailabilityPost.status, 400)

  const query = await requestOverHttp(
    origin,
    {
      schemaVersion: 1,
      projectId: 'project-promotion',
      promotionId: promotionRequest().promotionId,
    },
    { path: MATERIAL_PROMOTION_QUERY_ROUTE },
  )
  assert.equal(query.status, 503)
  assert.equal((await query.json()).error.code, 'promotion-unavailable')
  assert.equal(nextCalls, 0)
})

test('availability rejects Node 18 without importing or building Easypack', async t => {
  let loadCalls = 0
  let nextCalls = 0
  const middleware = createEnvironmentMaterialPromotionMiddleware({
    env: { EASY_EDITOR_MATERIAL_PROMOTION_ENABLED: '1' },
    nodeVersion: '18.20.8',
    loadEasypack: async () => {
      loadCalls += 1
      throw new Error('Node 18 availability must not load Easypack')
    },
  })
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      nextCalls += 1
      response.writeHead(404).end()
    })
  })
  await listen(server)
  t.after(() => close(server))

  const origin = originFor(server)
  const response = await fetch(`${origin}${MATERIAL_PROMOTION_AVAILABILITY_ROUTE}`, {
    headers: { Origin: origin },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    available: false,
    reason: 'node-version',
    minimumNodeMajor: 20,
  })
  assert.equal(loadCalls, 0)
  assert.equal(nextCalls, 0)
})

test('availability stays side-effect free and authoritative query does not run registry recovery', async t => {
  let createRegistryCalls = 0
  let recoveryCalls = 0
  let queryCalls = 0
  const registry = {
    async stagePromotion() {
      throw new Error('query must not stage a promotion')
    },
    async publishPromotion() {
      throw new Error('query must not publish a promotion')
    },
    async queryPromotion() {
      queryCalls += 1
      return null
    },
    async recoverPendingPromotions() {
      recoveryCalls += 1
      return []
    },
  }
  const middleware = createEnvironmentMaterialPromotionMiddleware({
    env: { EASY_EDITOR_MATERIAL_PROMOTION_ENABLED: '1' },
    author: {
      async checkAvailability() {
        return { schemaVersion: 1, available: true, reason: 'ready', minimumNodeMajor: 20 }
      },
      async authorPromotion() {
        throw new Error('query must not author a promotion')
      },
    },
    async authorizePrincipal() {
      return { tenantId: 'trusted-tenant', userId: 'trusted-user' }
    },
    async createRegistry() {
      createRegistryCalls += 1
      return registry
    },
  })
  const server = createServer((request, response) => {
    void middleware(request, response, () => response.writeHead(404).end())
  })
  await listen(server)
  t.after(() => close(server))

  const origin = originFor(server)
  const availability = await fetch(`${origin}${MATERIAL_PROMOTION_AVAILABILITY_ROUTE}`, {
    headers: { Origin: origin },
  })
  assert.equal(availability.status, 200)
  assert.equal(createRegistryCalls, 0)

  const request = promotionRequest()
  const query = await requestOverHttp(
    origin,
    {
      schemaVersion: 1,
      projectId: request.projectId,
      promotionId: request.promotionId,
    },
    { path: MATERIAL_PROMOTION_QUERY_ROUTE },
  )
  assert.equal(query.status, 404)
  assert.equal((await query.json()).error.code, 'promotion-not-found')
  assert.equal(createRegistryCalls, 1)
  assert.equal(queryCalls, 1)
  assert.equal(recoveryCalls, 0)
})

test('Vite contract middleware and production server use the same promotion handler and DTOs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'easy-editor-promotion-parity-'))
  const distDir = join(root, 'dist')
  await mkdir(distDir, { recursive: true })
  await writeFile(join(distDir, 'index.html'), '<main>dashboard</main>')
  t.after(() => rm(root, { recursive: true, force: true }))

  const harness = createCoordinatorHarness()
  const env = { EASY_EDITOR_MATERIAL_PROMOTION_ENABLED: '1' }
  const viteContractMiddleware = createEnvironmentMaterialPromotionMiddleware({ env, handler: harness.handler })
  const viteContractServer = createServer((request, response) => {
    void viteContractMiddleware(request, response, () => response.writeHead(404).end())
  })
  const productionServer = createDashboardServer({ distDir, env, materialPromotionHandler: harness.handler })
  await Promise.all([listen(viteContractServer), listen(productionServer)])
  t.after(async () => {
    await Promise.all([close(viteContractServer), close(productionServer)])
  })

  const responses = await Promise.all(
    [viteContractServer, productionServer].map(async server => {
      const response = await requestOverHttp(originFor(server), promotionRequest())
      return { status: response.status, body: await response.json() }
    }),
  )
  assert.deepEqual(responses[1], responses[0])
  assert.equal(responses[0].status, 200)
  assert.equal(responses[0].body.status, 'active')
  assert.equal(responses[0].body.buildIntegrity, buildIntegrity)

  const queryRequest = {
    schemaVersion: 1,
    projectId: 'project-promotion',
    promotionId: promotionRequest().promotionId,
  }
  const queryResponses = await Promise.all(
    [viteContractServer, productionServer].map(async server => {
      const response = await requestOverHttp(originFor(server), queryRequest, {
        path: MATERIAL_PROMOTION_QUERY_ROUTE,
      })
      return { status: response.status, body: await response.json() }
    }),
  )
  assert.deepEqual(queryResponses[1], queryResponses[0])
  assert.deepEqual(queryResponses[0], responses[0])

  const availabilityResponses = await Promise.all(
    [viteContractServer, productionServer].map(async server => {
      const origin = originFor(server)
      const response = await fetch(`${origin}${MATERIAL_PROMOTION_AVAILABILITY_ROUTE}`, {
        headers: { Origin: origin },
      })
      return { status: response.status, body: await response.json() }
    }),
  )
  assert.deepEqual(availabilityResponses[1], availabilityResponses[0])
  assert.deepEqual(availabilityResponses[0], {
    status: 200,
    body: {
      schemaVersion: 1,
      available: true,
      reason: 'ready',
      minimumNodeMajor: 20,
    },
  })

  const [viteConfig, productionSource] = await Promise.all([
    readFile(new URL('../vite.config.mts', import.meta.url), 'utf8'),
    readFile(new URL('../server/index.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(viteConfig, /createEnvironmentMaterialPromotionMiddleware/u)
  assert.match(viteConfig, /easy-editor-material-promotion/u)
  assert.match(productionSource, /createEnvironmentMaterialPromotionMiddleware/u)
  assert.match(productionSource, /materialPromotionHandler/u)
})
