import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDashboardServer } from '../server/index.mjs'
import {
  MATERIAL_CATALOG_LIST_ROUTE,
  MATERIAL_CATALOG_READ_ROUTE,
  createEnvironmentMaterialPromotionHandler,
  createEnvironmentMaterialPromotionMiddleware,
  createMaterialCatalogListResponse,
  createMaterialPromotionCoordinator,
  createMaterialPromotionHandler,
  validateMaterialCatalogItem,
  validateMaterialCatalogListResponse,
} from '../server/promotion/index.mjs'

const digest = character => `sha256:${character.repeat(64)}`

const sourceRevision = (suffix = 'a') => ({
  artifactId: `artifact-${suffix}`,
  sourceRevision: `source-${suffix}`,
  logicalComponentId: `logical-${suffix}`,
  sourceIntegrity: digest(suffix),
})

const material = (overrides = {}) => ({
  schemaVersion: 1,
  state: 'active',
  projectId: 'project-catalog',
  promotionId: digest('1'),
  materialId: 'material-a',
  materialVersion: 'version-a',
  logicalComponentId: 'logical-a',
  buildIntegrity: digest('2'),
  sourceRevision: sourceRevision('a'),
  dependencyLockDigest: digest('3'),
  entryFile: 'dist/index.esm.js',
  files: [{ path: 'dist/index.esm.js', byteLength: 42, integrity: digest('2') }],
  createdAt: 100,
  ...overrides,
})

const catalogItem = record => ({
  schemaVersion: 1,
  componentName: 'GeneratedMaterialHost',
  title: `${record.materialId} · ${record.materialVersion}`,
  createdAt: record.createdAt,
  promotionId: record.promotionId,
  artifactRef: {
    ...record.sourceRevision,
    target: {
      kind: 'local-material',
      materialId: record.materialId,
      materialVersion: record.materialVersion,
      buildIntegrity: record.buildIntegrity,
    },
    rollbackTo: record.sourceRevision,
  },
})

const isDeeplyFrozen = value => {
  if (!value || typeof value !== 'object') return true
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen)
}

const catalogTransport = (path, value, overrides = {}) => ({
  method: 'POST',
  path,
  headers: {
    'content-type': 'application/json',
    origin: 'https://dashboard.example.test',
    authorization: 'Bearer server-session',
  },
  expectedOrigins: ['https://dashboard.example.test'],
  body: Buffer.from(JSON.stringify(value)),
  ...overrides,
})

const listRequest = (overrides = {}) => ({ schemaVersion: 1, projectId: 'project-catalog', ...overrides })
const readRequest = (record, overrides = {}) => ({
  schemaVersion: 1,
  projectId: record.projectId,
  materialId: record.materialId,
  materialVersion: record.materialVersion,
  buildIntegrity: record.buildIntegrity,
  ...overrides,
})

const createCatalogHarness = ({ records = [], authorizePrincipal } = {}) => {
  const authorizationCalls = []
  const registryCalls = []
  const registry = {
    async stagePromotion() {
      throw new Error('catalog must not stage')
    },
    async publishPromotion() {
      throw new Error('catalog must not publish')
    },
    async listMaterials(filter, options) {
      registryCalls.push({ method: 'listMaterials', filter, signal: options?.signal })
      return records
    },
    async readMaterial(identity, options) {
      registryCalls.push({ method: 'readMaterial', identity, signal: options?.signal })
      return (
        records.find(
          record =>
            record.materialId === identity.materialId &&
            record.materialVersion === identity.materialVersion &&
            record.buildIntegrity === identity.buildIntegrity,
        ) ?? null
      )
    },
  }
  const coordinator = createMaterialPromotionCoordinator({
    async authorizePrincipal(input) {
      authorizationCalls.push(input)
      if (authorizePrincipal) return authorizePrincipal(input)
      if (input.headers.authorization !== 'Bearer server-session') {
        throw Object.assign(new Error('Request is not authorized'), {
          code: 'unauthorized',
          status: 403,
          retryable: false,
        })
      }
      return { tenantId: 'trusted-tenant', userId: 'trusted-user' }
    },
    author: {
      async authorPromotion() {
        throw new Error('catalog must not author')
      },
    },
    registry,
  })
  return {
    authorizationCalls,
    registryCalls,
    handler: createMaterialPromotionHandler({ coordinator }),
  }
}

const listen = server => new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
const close = server =>
  new Promise((resolvePromise, reject) => server.close(error => (error ? reject(error) : resolvePromise())))
const originFor = server => {
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}
const postJson = (origin, path, value, headers = {}) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Authorization: 'Bearer server-session',
      ...headers,
    },
    body: JSON.stringify(value),
  })

test('catalog list and read expose only stable deeply frozen trusted DTOs', async () => {
  const first = material()
  const second = material({
    promotionId: digest('4'),
    materialId: 'material-b',
    materialVersion: 'version-b',
    buildIntegrity: digest('5'),
    sourceRevision: sourceRevision('b'),
    createdAt: 200,
    buildDirectory: '/must/not/leak',
    tenantId: 'must-not-leak',
    userId: 'must-not-leak',
    rawSource: 'globalThis.compromised = true',
  })
  const otherProject = material({
    projectId: 'project-other',
    promotionId: digest('6'),
    materialId: 'material-other',
    buildIntegrity: digest('7'),
    sourceRevision: sourceRevision('c'),
  })
  const harness = createCatalogHarness({ records: [second, otherProject, first] })

  const listed = await harness.handler.handle(catalogTransport(MATERIAL_CATALOG_LIST_ROUTE, listRequest()))
  assert.deepEqual(listed, {
    status: 200,
    body: {
      schemaVersion: 1,
      materials: [catalogItem(first), catalogItem(second)],
    },
  })
  assert.equal(isDeeplyFrozen(listed.body), true)
  assert.deepEqual(harness.registryCalls[0].filter, { projectId: 'project-catalog' })
  assert.equal(harness.authorizationCalls[0].projectId, 'project-catalog')

  const read = await harness.handler.handle(catalogTransport(MATERIAL_CATALOG_READ_ROUTE, readRequest(second)))
  assert.deepEqual(read, { status: 200, body: catalogItem(second) })
  assert.equal(isDeeplyFrozen(read.body), true)
  assert.deepEqual(harness.registryCalls[1].identity, {
    materialId: second.materialId,
    materialVersion: second.materialVersion,
    buildIntegrity: second.buildIntegrity,
  })
  assert.deepEqual(Object.keys(read.body).sort(), [
    'artifactRef',
    'componentName',
    'createdAt',
    'promotionId',
    'schemaVersion',
    'title',
  ])
})

test('shared catalog response contract rejects leaked fields and unstable ordering', () => {
  const first = material()
  const second = material({
    promotionId: digest('4'),
    materialId: 'material-b',
    materialVersion: 'version-b',
    buildIntegrity: digest('5'),
    sourceRevision: sourceRevision('b'),
  })
  assert.throws(() => validateMaterialCatalogItem({ ...catalogItem(first), entryFile: 'dist/index.esm.js' }), TypeError)
  assert.throws(
    () =>
      validateMaterialCatalogListResponse({
        schemaVersion: 1,
        materials: [catalogItem(second), catalogItem(first)],
      }),
    TypeError,
  )

  const exactDuplicate = [first, first]
  assert.throws(() => createMaterialCatalogListResponse(exactDuplicate), /duplicate durable material identity/iu)
  assert.throws(
    () =>
      validateMaterialCatalogListResponse({
        schemaVersion: 1,
        materials: [catalogItem(first), catalogItem(first)],
      }),
    /duplicate durable material identity/iu,
  )

  const conflictingSource = material({
    promotionId: digest('9'),
    sourceRevision: sourceRevision('c'),
  })
  assert.throws(
    () => createMaterialCatalogListResponse([first, conflictingSource]),
    /conflicting durable material identity/iu,
  )
  assert.throws(
    () =>
      validateMaterialCatalogListResponse({
        schemaVersion: 1,
        materials: [catalogItem(first), catalogItem(conflictingSource)],
      }),
    /conflicting durable material identity/iu,
  )
})

test('catalog requests reject client authority and component identity before authorization', async () => {
  const record = material()
  const harness = createCatalogHarness({ records: [record] })
  const forbidden = [
    [MATERIAL_CATALOG_LIST_ROUTE, listRequest({ tenantId: 'attacker' })],
    [MATERIAL_CATALOG_LIST_ROUTE, listRequest({ userId: 'attacker' })],
    [MATERIAL_CATALOG_LIST_ROUTE, listRequest({ componentName: 'AttackerHost' })],
    [MATERIAL_CATALOG_READ_ROUTE, readRequest(record, { tenantId: 'attacker' })],
    [MATERIAL_CATALOG_READ_ROUTE, readRequest(record, { componentName: 'AttackerHost' })],
  ]
  for (const [path, request] of forbidden) {
    const result = await harness.handler.handle(catalogTransport(path, request))
    assert.equal(result.status, 400)
    assert.equal(result.body.error.code, 'invalid-request')
  }
  assert.equal(harness.authorizationCalls.length, 0)
  assert.equal(harness.registryCalls.length, 0)
})

test('catalog read is project isolated and returns typed not-found', async () => {
  const record = material({ projectId: 'project-other' })
  const harness = createCatalogHarness({ records: [record] })

  const missing = await harness.handler.handle(
    catalogTransport(MATERIAL_CATALOG_READ_ROUTE, readRequest(record, { projectId: 'project-catalog' })),
  )
  assert.deepEqual(missing, {
    status: 404,
    body: {
      schemaVersion: 1,
      error: {
        code: 'material-not-found',
        message: 'Material was not found',
        retryable: false,
      },
    },
  })
})

test('catalog preserves origin, media, method, body, and abort constraints', async () => {
  const record = material()
  const harness = createCatalogHarness({ records: [record] })
  const cases = [
    [catalogTransport(MATERIAL_CATALOG_LIST_ROUTE, listRequest(), { method: 'GET' }), 405],
    [
      catalogTransport(MATERIAL_CATALOG_LIST_ROUTE, listRequest(), {
        headers: { 'content-type': 'text/plain', origin: 'https://dashboard.example.test' },
      }),
      415,
    ],
    [
      catalogTransport(MATERIAL_CATALOG_LIST_ROUTE, listRequest(), {
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      }),
      403,
    ],
  ]
  for (const [request, status] of cases) {
    const result = await harness.handler.handle(request)
    assert.equal(result.status, status)
    assert.equal(result.body.error.code, 'invalid-request')
  }

  const controller = new AbortController()
  controller.abort()
  const aborted = await harness.handler.handle(
    catalogTransport(MATERIAL_CATALOG_READ_ROUTE, readRequest(record), { signal: controller.signal }),
  )
  assert.equal(aborted.status, 408)
  assert.equal(aborted.body.error.code, 'promotion-aborted')
  assert.equal(harness.authorizationCalls.length, 0)
})

test('default-off reserves catalog routes with typed unavailable responses', async t => {
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

  for (const [path, request] of [
    [MATERIAL_CATALOG_LIST_ROUTE, listRequest()],
    [MATERIAL_CATALOG_READ_ROUTE, readRequest(material())],
  ]) {
    const response = await postJson(origin, path, request)
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'promotion-unavailable')
  }
  assert.equal(nextCalls, 0)
})

test('environment catalog initialization is bounded by pre-abort and in-flight abort signals', async () => {
  let preAbortedRegistryCalls = 0
  const preAbortedHandler = createEnvironmentMaterialPromotionHandler({
    env: { EASY_EDITOR_MATERIAL_PROMOTION_ENABLED: '1' },
    author: {
      async authorPromotion() {
        throw new Error('catalog must not author')
      },
    },
    async createRegistry() {
      preAbortedRegistryCalls += 1
      return {
        async stagePromotion() {},
        async publishPromotion() {},
        async listMaterials() {
          return []
        },
        async readMaterial() {
          return null
        },
      }
    },
    async authorizePrincipal() {
      return { tenantId: 'trusted-tenant', userId: 'trusted-user' }
    },
  })
  const preAborted = new AbortController()
  preAborted.abort()
  const preAbortedResult = await preAbortedHandler.handle(
    catalogTransport(MATERIAL_CATALOG_LIST_ROUTE, listRequest(), { signal: preAborted.signal }),
  )
  assert.equal(preAbortedResult.status, 408)
  assert.equal(preAbortedResult.body.error.code, 'promotion-aborted')
  assert.equal(preAbortedRegistryCalls, 0)

  let enterInitialization
  let releaseInitialization
  const initializationEntered = new Promise(resolvePromise => {
    enterInitialization = resolvePromise
  })
  const initializationGate = new Promise(resolvePromise => {
    releaseInitialization = resolvePromise
  })
  const stalledHandler = createEnvironmentMaterialPromotionHandler({
    env: { EASY_EDITOR_MATERIAL_PROMOTION_ENABLED: '1' },
    author: {
      async authorPromotion() {
        throw new Error('catalog must not author')
      },
    },
    async createRegistry() {
      enterInitialization()
      return initializationGate
    },
    async authorizePrincipal() {
      return { tenantId: 'trusted-tenant', userId: 'trusted-user' }
    },
  })
  const inFlight = new AbortController()
  const resultPromise = stalledHandler.handle(
    catalogTransport(MATERIAL_CATALOG_LIST_ROUTE, listRequest(), { signal: inFlight.signal }),
  )
  await initializationEntered
  inFlight.abort()
  const boundedResult = await Promise.race([
    resultPromise,
    new Promise(resolvePromise => setTimeout(() => resolvePromise('unbounded'), 100)),
  ])
  releaseInitialization({
    async stagePromotion() {},
    async publishPromotion() {},
    async listMaterials() {
      return []
    },
    async readMaterial() {
      return null
    },
  })
  assert.notEqual(boundedResult, 'unbounded')
  assert.equal(boundedResult.status, 408)
  assert.equal(boundedResult.body.error.code, 'promotion-aborted')
})

test('Node 18 catalog reads initialize the registry without loading or building Easypack', async t => {
  const record = material()
  let loadEasypackCalls = 0
  let createRegistryCalls = 0
  const registry = {
    async stagePromotion() {
      throw new Error('catalog must not stage')
    },
    async publishPromotion() {
      throw new Error('catalog must not publish')
    },
    async listMaterials() {
      return [record]
    },
    async readMaterial() {
      return record
    },
  }
  const middleware = createEnvironmentMaterialPromotionMiddleware({
    env: { EASY_EDITOR_MATERIAL_PROMOTION_ENABLED: '1' },
    nodeVersion: '18.20.8',
    async loadEasypack() {
      loadEasypackCalls += 1
      throw new Error('catalog must not load Easypack')
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

  const list = await postJson(origin, MATERIAL_CATALOG_LIST_ROUTE, listRequest())
  assert.deepEqual(await list.json(), { schemaVersion: 1, materials: [catalogItem(record)] })
  const read = await postJson(origin, MATERIAL_CATALOG_READ_ROUTE, readRequest(record))
  assert.deepEqual(await read.json(), catalogItem(record))
  assert.equal(loadEasypackCalls, 0)
  assert.equal(createRegistryCalls, 1)
})

test('Vite contract middleware and production server share catalog route DTOs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'easy-editor-catalog-parity-'))
  const distDir = join(root, 'dist')
  await mkdir(distDir, { recursive: true })
  await writeFile(join(distDir, 'index.html'), '<main>dashboard</main>')
  t.after(() => rm(root, { recursive: true, force: true }))

  const record = material()
  const handler = createCatalogHarness({ records: [record] }).handler
  const viteMiddleware = createEnvironmentMaterialPromotionMiddleware({ env: {}, handler })
  const viteServer = createServer((request, response) => {
    void viteMiddleware(request, response, () => response.writeHead(404).end())
  })
  const productionServer = createDashboardServer({ distDir, env: {}, materialPromotionHandler: handler })
  await Promise.all([listen(viteServer), listen(productionServer)])
  t.after(async () => Promise.all([close(viteServer), close(productionServer)]))

  for (const [path, request] of [
    [MATERIAL_CATALOG_LIST_ROUTE, listRequest()],
    [MATERIAL_CATALOG_READ_ROUTE, readRequest(record)],
  ]) {
    const responses = await Promise.all(
      [viteServer, productionServer].map(async server => {
        const response = await postJson(originFor(server), path, request)
        return { status: response.status, body: await response.json() }
      }),
    )
    assert.deepEqual(responses[1], responses[0])
    assert.equal(responses[0].status, 200)
  }
})
