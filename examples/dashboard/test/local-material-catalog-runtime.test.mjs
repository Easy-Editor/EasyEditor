import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  validateMaterialCatalogItem,
  validateMaterialCatalogListResponse,
} from '../shared/material-catalog-contract.mjs'
import {
  DashboardLocalMaterialCatalogClientError,
  LOCAL_MATERIAL_CATALOG_LIST_ROUTE,
  LOCAL_MATERIAL_CATALOG_READ_ROUTE,
  createDashboardLocalMaterialCatalogRuntime,
  createDashboardSameOriginLocalMaterialCatalogClient,
  createDurableMaterialSnippet,
  normalizeLocalMaterialCatalogItem,
  normalizeLocalMaterialCatalogList,
} from '../src/editor/agent/capabilities/promotion/index.mjs'

const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const digestBytes = bytes => createHash('sha256').update(bytes).digest()

const source = suffix => `export default function Generated${suffix}() { return ${JSON.stringify(suffix)} }`

const artifactRef = (suffix = 'a') => {
  const sourceValue = source(suffix)
  const revision = {
    artifactId: `artifact-${suffix}`,
    sourceRevision: `revision-${suffix}`,
    logicalComponentId: `logical-${suffix}`,
    sourceIntegrity: sha256(sourceValue),
  }
  return {
    ...revision,
    target: {
      kind: 'local-material',
      materialId: `material-${suffix}`,
      materialVersion: `1.0.${suffix.charCodeAt(0)}`,
      buildIntegrity: sha256(`build-${suffix}`),
    },
    rollbackTo: revision,
  }
}

const catalogItem = (suffix = 'a', overrides = {}) => {
  const reference = overrides.artifactRef ?? artifactRef(suffix)
  return {
    schemaVersion: 1,
    componentName: 'GeneratedMaterialHost',
    title: `${reference.target.materialId} · ${reference.target.materialVersion}`,
    createdAt: suffix.charCodeAt(0),
    promotionId: sha256(`promotion-${suffix}`),
    artifactRef: reference,
    ...overrides,
  }
}

const catalogTitle = suffix => catalogItem(suffix).title

const artifactRecord = (suffix = 'a', overrides = {}) => {
  const sourceValue = source(suffix)
  return {
    schemaVersion: 1,
    projectId: 'project-a',
    artifactId: `artifact-${suffix}`,
    sourceRevision: `revision-${suffix}`,
    logicalComponentId: `logical-${suffix}`,
    sourceIntegrity: sha256(sourceValue),
    source: sourceValue,
    css: '',
    safeManifest: { schemaVersion: 1, title: `Durable ${suffix.toUpperCase()}` },
    lockedDependencies: [],
    dependencyLockDigest: sha256('[]'),
    diagnostics: [],
    provenance: { source: 'test' },
    createdAt: suffix.charCodeAt(0),
    supersedes: null,
    ...overrides,
  }
}

const jsonResponse = value =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const waitFor = async assertion => {
  let lastError
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return assertion()
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  throw lastError
}

const deferred = () => {
  let resolve
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const createPersistence = ({ artifacts = new Map(), initialSnapshot } = {}) => {
  const listeners = new Set()
  let snapshot =
    initialSnapshot ??
    Object.freeze({ state: 'ready', projectId: 'project-a', branchId: 'branch-main', draftGeneration: 1 })
  const reads = []
  return {
    reads,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async readArtifact(request) {
      reads.push(structuredClone(request))
      const value = artifacts.get(`${request.projectId}:${request.artifactId}:${request.sourceRevision}`)
      if (value instanceof Error) throw value
      return value ?? null
    },
    setSnapshot(value) {
      snapshot = Object.freeze({ ...value })
      for (const listener of listeners) listener()
    },
  }
}

test('catalog client uses the exact same-origin list/read contracts and returns strict frozen DTOs', async () => {
  const calls = []
  const client = createDashboardSameOriginLocalMaterialCatalogClient({
    async fetchImpl(route, init) {
      calls.push({ route, init })
      if (route === LOCAL_MATERIAL_CATALOG_LIST_ROUTE) {
        return jsonResponse({ schemaVersion: 1, materials: [catalogItem('a'), catalogItem('b')] })
      }
      return jsonResponse(catalogItem('b'))
    },
  })

  const listed = await client.listMaterials({ projectId: 'project-a' })
  assert.deepEqual(
    listed.materials.map(material => material.title),
    [catalogTitle('a'), catalogTitle('b')],
  )
  assert.ok(Object.isFrozen(listed))
  assert.ok(Object.isFrozen(listed.materials))
  assert.ok(Object.isFrozen(listed.materials[0]))
  assert.ok(Object.isFrozen(listed.materials[0].artifactRef.target))

  const target = artifactRef('b').target
  const { kind: _kind, ...readIdentity } = target
  const read = await client.readMaterial({ projectId: 'project-a', ...target })
  assert.equal(read.title, catalogTitle('b'))
  assert.deepEqual(
    calls.map(call => ({
      route: call.route,
      method: call.init.method,
      credentials: call.init.credentials,
      redirect: call.init.redirect,
      body: JSON.parse(call.init.body),
    })),
    [
      {
        route: '/api/materials/catalog/list',
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        body: { schemaVersion: 1, projectId: 'project-a' },
      },
      {
        route: '/api/materials/catalog/read',
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        body: { schemaVersion: 1, projectId: 'project-a', ...readIdentity },
      },
    ],
  )
})

test('browser catalog validators are the shared canonical validators for every accepted and rejected vector', () => {
  assert.strictEqual(normalizeLocalMaterialCatalogItem, validateMaterialCatalogItem)
  assert.strictEqual(normalizeLocalMaterialCatalogList, validateMaterialCatalogListResponse)

  const oversizedIdentifier = catalogItem('a')
  oversizedIdentifier.artifactRef.target.materialId = 'a'.repeat(257)
  oversizedIdentifier.title = `${oversizedIdentifier.artifactRef.target.materialId} · ${oversizedIdentifier.artifactRef.target.materialVersion}`

  const illegalIdentifier = catalogItem('a')
  illegalIdentifier.artifactRef.target.materialId = 'material with spaces'
  illegalIdentifier.title = `${illegalIdentifier.artifactRef.target.materialId} · ${illegalIdentifier.artifactRef.target.materialVersion}`

  const itemVectors = [
    { name: 'canonical item', value: catalogItem('a'), accepted: true },
    { name: 'forged title', value: catalogItem('a', { title: 'Forged title' }), accepted: false },
    { name: 'oversized identifier', value: oversizedIdentifier, accepted: false },
    { name: 'illegal identifier', value: illegalIdentifier, accepted: false },
    { name: 'extra field', value: { ...catalogItem('a'), source: 'must-not-cross' }, accepted: false },
  ]

  const conflicting = catalogItem('a')
  conflicting.promotionId = sha256('promotion-conflict')
  conflicting.artifactRef.artifactId = 'artifact-conflict'
  conflicting.artifactRef.rollbackTo.artifactId = 'artifact-conflict'
  const repeatedPromotion = catalogItem('b', { promotionId: catalogItem('a').promotionId })
  const listVectors = [
    {
      name: 'canonical ordered list',
      value: { schemaVersion: 1, materials: [catalogItem('a'), catalogItem('b')] },
      accepted: true,
    },
    {
      name: 'same promotion with distinct durable identities',
      value: { schemaVersion: 1, materials: [catalogItem('a'), repeatedPromotion] },
      accepted: true,
    },
    {
      name: 'duplicate durable identity',
      value: { schemaVersion: 1, materials: [catalogItem('a'), catalogItem('a')] },
      accepted: false,
    },
    {
      name: 'conflicting durable identity',
      value: { schemaVersion: 1, materials: [catalogItem('a'), conflicting] },
      accepted: false,
    },
    {
      name: 'noncanonical order',
      value: { schemaVersion: 1, materials: [catalogItem('b'), catalogItem('a')] },
      accepted: false,
    },
  ]

  const assertAgreement = ({ name, value, accepted }, sharedValidator, browserValidator) => {
    const outcomes = [sharedValidator, browserValidator].map(validator => {
      try {
        return { accepted: true, value: validator(structuredClone(value)) }
      } catch (error) {
        return { accepted: false, error }
      }
    })
    assert.equal(outcomes[0].accepted, accepted, `${name}: shared acceptance`)
    assert.equal(outcomes[1].accepted, accepted, `${name}: browser acceptance`)
    assert.equal(outcomes[1].accepted, outcomes[0].accepted, `${name}: shared/browser drift`)
    if (accepted) assert.deepEqual(outcomes[1].value, outcomes[0].value, `${name}: normalized DTO drift`)
  }

  for (const vector of itemVectors) {
    assertAgreement(vector, validateMaterialCatalogItem, normalizeLocalMaterialCatalogItem)
  }
  for (const vector of listVectors) {
    assertAgreement(vector, validateMaterialCatalogListResponse, normalizeLocalMaterialCatalogList)
  }
})

test('catalog read rejects a canonical item whose durable identity differs from the request', async () => {
  const client = createDashboardSameOriginLocalMaterialCatalogClient({
    fetchImpl: async () => jsonResponse(catalogItem('b')),
  })
  const requested = artifactRef('a').target
  await assert.rejects(
    client.readMaterial({ projectId: 'project-a', ...requested }),
    error =>
      error instanceof DashboardLocalMaterialCatalogClientError &&
      error.code === 'invalid-response' &&
      /requested durable identity/u.test(error.message),
  )
})

test('catalog DTO normalization rejects unsafe proxy types and rollback drift', () => {
  assert.throws(() => normalizeLocalMaterialCatalogItem({ ...catalogItem(), source: 'must-not-cross' }), /fields/u)
  assert.throws(
    () => normalizeLocalMaterialCatalogItem({ ...catalogItem(), componentName: 'UntrustedComponent' }),
    /GeneratedMaterialHost/u,
  )
  const drifted = catalogItem('a')
  drifted.artifactRef.rollbackTo = { ...drifted.artifactRef.rollbackTo, sourceRevision: 'forged' }
  assert.throws(() => normalizeLocalMaterialCatalogItem(drifted), /rollbackTo/u)
  assert.throws(
    () =>
      normalizeLocalMaterialCatalogList({
        schemaVersion: 1,
        materials: [catalogItem('a'), catalogItem('a')],
      }),
    /duplicate durable material identity/u,
  )
})

test('catalog client rejects declared and streamed responses over one MiB', async () => {
  let declaredCancelled = 0
  const declaredClient = createDashboardSameOriginLocalMaterialCatalogClient({
    fetchImpl: async () => ({
      body: { cancel: async () => (declaredCancelled += 1) },
      headers: {
        get: name =>
          name.toLowerCase() === 'content-type'
            ? 'application/json'
            : name.toLowerCase() === 'content-length'
              ? String(1024 * 1024 + 1)
              : null,
      },
      ok: true,
      status: 200,
    }),
  })
  await assert.rejects(
    declaredClient.listMaterials({ projectId: 'project-a' }),
    error => error instanceof DashboardLocalMaterialCatalogClientError && error.code === 'invalid-response',
  )
  assert.equal(declaredCancelled, 1)

  let readerCancelled = 0
  let readIndex = 0
  const reader = {
    async read() {
      readIndex += 1
      return readIndex === 1
        ? { done: false, value: new Uint8Array(1024 * 1024) }
        : { done: false, value: new Uint8Array(1) }
    },
    async cancel() {
      readerCancelled += 1
    },
    releaseLock() {},
  }
  const streamedClient = createDashboardSameOriginLocalMaterialCatalogClient({
    fetchImpl: async () => ({
      body: { getReader: () => reader },
      headers: { get: name => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      ok: true,
      status: 200,
    }),
  })
  await assert.rejects(
    streamedClient.listMaterials({ projectId: 'project-a' }),
    error => error instanceof DashboardLocalMaterialCatalogClientError && error.code === 'invalid-response',
  )
  assert.equal(readerCancelled, 1)
})

test('catalog runtime is inert while flags are off and never performs a request', async () => {
  const effects = { fetch: 0, getSnapshot: 0, subscribe: 0, readArtifact: 0, hashBytes: 0, admission: 0 }
  const disabledOptions = { enabled: false }
  Object.defineProperty(disabledOptions, 'withMaterialAdmission', {
    get() {
      effects.admission += 1
      throw new Error('disabled catalog must not read admission authority')
    },
  })
  const runtime = createDashboardLocalMaterialCatalogRuntime(disabledOptions)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(Object.isFrozen(runtime), true)
  assert.deepEqual(runtime.getSnapshot(), {
    schemaVersion: 1,
    status: 'disabled',
    projectId: null,
    materials: [],
    failure: null,
  })
  assert.equal(Object.isFrozen(runtime.getSnapshot()), true)
  assert.equal(Object.isFrozen(runtime.getSnapshot().materials), true)
  const unsubscribe = runtime.subscribe(() => {
    throw new Error('disabled runtime must not notify observers')
  })
  assert.deepEqual(await runtime.refresh(), runtime.getSnapshot())
  unsubscribe()
  runtime.dispose()
  assert.deepEqual(effects, { fetch: 0, getSnapshot: 0, subscribe: 0, readArtifact: 0, hashBytes: 0, admission: 0 })

  const instrumented = createDashboardLocalMaterialCatalogRuntime({
    enabled: false,
    client: { listMaterials: async () => (effects.fetch += 1) },
    persistence: {
      getSnapshot: () => (effects.getSnapshot += 1),
      subscribe: () => (effects.subscribe += 1),
      readArtifact: async () => (effects.readArtifact += 1),
    },
    hashBytes: () => (effects.hashBytes += 1),
  })
  await instrumented.refresh()
  instrumented.dispose()
  assert.deepEqual(effects, { fetch: 0, getSnapshot: 0, subscribe: 0, readArtifact: 0, hashBytes: 0, admission: 0 })
})

test('catalog runtime publishes ready only after one admission callback completes with every validated identity', async () => {
  const persistence = createPersistence({
    artifacts: new Map([
      ['project-a:artifact-a:revision-a', artifactRecord('a')],
      ['project-a:artifact-c:revision-c', artifactRecord('c')],
    ]),
  })
  const admissionGate = deferred()
  const admissions = []
  const events = []
  const runtime = createDashboardLocalMaterialCatalogRuntime({
    enabled: true,
    client: {
      async listMaterials() {
        return normalizeLocalMaterialCatalogList({
          schemaVersion: 1,
          materials: [catalogItem('a'), catalogItem('b'), catalogItem('c')],
        })
      },
    },
    persistence,
    hashBytes: digestBytes,
    async withMaterialAdmission(input, operation) {
      admissions.push(structuredClone(input))
      events.push('admission-started')
      await admissionGate.promise
      events.push('admission-acknowledged')
      return operation(Object.freeze({ status: 'admitted' }))
    },
  })
  runtime.subscribe(() => {
    if (runtime.getSnapshot().status === 'ready') events.push('ready-published')
  })

  await waitFor(() => assert.equal(admissions.length, 1))
  assert.equal(runtime.getSnapshot().status, 'loading')
  assert.deepEqual(events, ['admission-started'])
  assert.deepEqual(admissions, [
    {
      schemaVersion: 1,
      projectId: 'project-a',
      materialRefs: [artifactRef('a').target, artifactRef('c').target].map(({ kind: _kind, ...identity }) => identity),
      reason: 'catalog-ready',
    },
  ])
  assert.equal(
    new Set(admissions[0].materialRefs.map(ref => `${ref.materialId}\0${ref.materialVersion}\0${ref.buildIntegrity}`))
      .size,
    admissions[0].materialRefs.length,
  )

  admissionGate.resolve()
  await waitFor(() => assert.equal(runtime.getSnapshot().status, 'ready'))
  assert.deepEqual(events, ['admission-started', 'admission-acknowledged', 'ready-published'])
  assert.deepEqual(
    runtime.getSnapshot().materials.map(material => [material.artifactRef.target.materialId, material.availability]),
    [
      ['material-a', 'available'],
      ['material-b', 'unavailable'],
      ['material-c', 'available'],
    ],
  )
  runtime.dispose()
})

test('catalog runtime admission rejection fail-closes without ever publishing a ready snapshot', async () => {
  const persistence = createPersistence({
    artifacts: new Map([['project-a:artifact-a:revision-a', artifactRecord('a')]]),
  })
  const observedStatuses = []
  const rejection = Object.assign(new Error('durable admission rejected'), {
    code: 'admission-rejected',
    retryable: true,
  })
  const runtime = createDashboardLocalMaterialCatalogRuntime({
    enabled: true,
    client: {
      async listMaterials() {
        return normalizeLocalMaterialCatalogList({ schemaVersion: 1, materials: [catalogItem('a')] })
      },
    },
    persistence,
    hashBytes: digestBytes,
    async withMaterialAdmission() {
      throw rejection
    },
  })
  runtime.subscribe(() => observedStatuses.push(runtime.getSnapshot().status))

  await waitFor(() => assert.equal(runtime.getSnapshot().status, 'fail-closed'))
  assert.equal(observedStatuses.includes('ready'), false)
  assert.deepEqual(runtime.getSnapshot().materials, [])
  assert.deepEqual(runtime.getSnapshot().failure, {
    code: 'admission-rejected',
    message: 'durable admission rejected',
    retryable: true,
  })
  runtime.dispose()
})

test('catalog runtime fail-closes without transient ready publication when admission invokes its operation twice', async () => {
  const persistence = createPersistence({
    artifacts: new Map([['project-a:artifact-a:revision-a', artifactRecord('a')]]),
  })
  const observedStatuses = []
  const runtime = createDashboardLocalMaterialCatalogRuntime({
    enabled: true,
    client: {
      async listMaterials() {
        return normalizeLocalMaterialCatalogList({ schemaVersion: 1, materials: [catalogItem('a')] })
      },
    },
    persistence,
    hashBytes: digestBytes,
    withMaterialAdmission(_input, operation) {
      operation(Object.freeze({ status: 'admitted' }))
      operation(Object.freeze({ status: 'admitted' }))
    },
  })
  runtime.subscribe(() => observedStatuses.push(runtime.getSnapshot().status))

  await waitFor(() => assert.equal(runtime.getSnapshot().status, 'fail-closed'))
  assert.equal(observedStatuses.includes('ready'), false)
  assert.match(runtime.getSnapshot().failure.message, /exactly once/u)
  runtime.dispose()
})

test('catalog runtime permanently ignores operation calls arriving after admission returns or rejects', async () => {
  for (const outcome of ['returned', 'rejected']) {
    let lateOperation = null
    const observedStatuses = []
    const runtime = createDashboardLocalMaterialCatalogRuntime({
      enabled: true,
      client: {
        async listMaterials() {
          return normalizeLocalMaterialCatalogList({ schemaVersion: 1, materials: [catalogItem('a')] })
        },
      },
      persistence: createPersistence({
        artifacts: new Map([['project-a:artifact-a:revision-a', artifactRecord('a')]]),
      }),
      hashBytes: digestBytes,
      withMaterialAdmission(_input, operation) {
        lateOperation = operation
        if (outcome === 'rejected') return Promise.reject(new Error('admission wrapper rejected'))
      },
    })
    runtime.subscribe(() => observedStatuses.push(runtime.getSnapshot().status))

    await waitFor(() => assert.equal(runtime.getSnapshot().status, 'fail-closed'))
    assert.equal(typeof lateOperation, 'function')
    const failedSnapshot = runtime.getSnapshot()
    lateOperation(Object.freeze({ status: 'admitted' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.strictEqual(runtime.getSnapshot(), failedSnapshot, outcome)
    assert.equal(observedStatuses.includes('ready'), false, outcome)
    runtime.dispose()
  }
})

test('catalog runtime cannot publish a stale scope after its admission acknowledgement', async () => {
  const persistence = createPersistence({
    artifacts: new Map([['project-a:artifact-a:revision-a', artifactRecord('a')]]),
  })
  const admissions = []
  const readyPublications = []
  const runtime = createDashboardLocalMaterialCatalogRuntime({
    enabled: true,
    client: {
      async listMaterials() {
        return normalizeLocalMaterialCatalogList({ schemaVersion: 1, materials: [catalogItem('a')] })
      },
    },
    persistence,
    hashBytes: digestBytes,
    withMaterialAdmission(input, operation) {
      const gate = deferred()
      const completed = deferred()
      const entry = { input: structuredClone(input), gate, completed }
      admissions.push(entry)
      return gate.promise
        .then(() => operation(Object.freeze({ status: 'admitted' })))
        .finally(() => completed.resolve())
    },
  })
  runtime.subscribe(() => {
    if (runtime.getSnapshot().status === 'ready') readyPublications.push(runtime.getSnapshot())
  })

  await waitFor(() => assert.equal(admissions.length, 1))
  persistence.setSnapshot({
    state: 'ready',
    projectId: 'project-a',
    branchId: 'branch-restored',
    draftGeneration: 1,
  })
  await waitFor(() => assert.equal(admissions.length, 2))

  admissions[0].gate.resolve()
  await admissions[0].completed.promise
  assert.equal(runtime.getSnapshot().status, 'loading')
  assert.equal(readyPublications.length, 0)

  admissions[1].gate.resolve()
  await waitFor(() => assert.equal(runtime.getSnapshot().status, 'ready'))
  assert.equal(readyPublications.length, 1)
  runtime.dispose()
})

test('catalog runtime without an own admission option preserves ready behavior without consulting getters', async () => {
  let inheritedGetterReads = 0
  const options = Object.assign(
    Object.create({
      get withMaterialAdmission() {
        inheritedGetterReads += 1
        throw new Error('an omitted admission option must not be consulted')
      },
    }),
    {
      enabled: true,
      client: {
        async listMaterials() {
          return normalizeLocalMaterialCatalogList({ schemaVersion: 1, materials: [catalogItem('a')] })
        },
      },
      persistence: createPersistence({
        artifacts: new Map([['project-a:artifact-a:revision-a', artifactRecord('a')]]),
      }),
      hashBytes: digestBytes,
    },
  )
  const runtime = createDashboardLocalMaterialCatalogRuntime(options)

  await waitFor(() => assert.equal(runtime.getSnapshot().status, 'ready'))
  assert.equal(inheritedGetterReads, 0)
  assert.equal(runtime.getSnapshot().materials[0].availability, 'available')
  runtime.dispose()
})

test('catalog runtime verifies local IndexedDB source identity and integrity before enabling a snippet', async () => {
  const artifacts = new Map([
    ['project-a:artifact-a:revision-a', artifactRecord('a')],
    ['project-a:artifact-c:revision-c', artifactRecord('c', { source: 'tampered' })],
    ['project-a:artifact-d:revision-d', artifactRecord('d', { logicalComponentId: 'other-logical' })],
    ['project-a:artifact-e:revision-e', new Error('IndexedDB unavailable')],
  ])
  const persistence = createPersistence({ artifacts })
  const runtime = createDashboardLocalMaterialCatalogRuntime({
    enabled: true,
    client: {
      async listMaterials() {
        return normalizeLocalMaterialCatalogList({
          schemaVersion: 1,
          materials: [catalogItem('a'), catalogItem('b'), catalogItem('c'), catalogItem('d'), catalogItem('e')],
        })
      },
    },
    persistence,
    hashBytes: digestBytes,
  })

  await waitFor(() => assert.equal(runtime.getSnapshot().status, 'ready'))
  const snapshot = runtime.getSnapshot()
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.materials))
  assert.deepEqual(
    snapshot.materials.map(material => [material.title, material.availability, material.unavailableReason]),
    [
      [catalogTitle('a'), 'available', null],
      [catalogTitle('b'), 'unavailable', 'artifact-missing'],
      [catalogTitle('c'), 'unavailable', 'artifact-invalid'],
      [catalogTitle('d'), 'unavailable', 'artifact-identity-mismatch'],
      [catalogTitle('e'), 'unavailable', 'artifact-unreadable'],
    ],
  )
  assert.deepEqual(persistence.reads[0], {
    schemaVersion: 1,
    projectId: 'project-a',
    artifactId: 'artifact-a',
    sourceRevision: 'revision-a',
  })
  runtime.dispose()
})

test('catalog runtime refreshes for page scope changes but not ordinary draft autosaves', async () => {
  const persistence = createPersistence({
    artifacts: new Map([
      ['project-a:artifact-a:revision-a', artifactRecord('a')],
      ['project-b:artifact-b:revision-b', artifactRecord('b', { projectId: 'project-b' })],
    ]),
  })
  const requests = []
  const runtime = createDashboardLocalMaterialCatalogRuntime({
    enabled: true,
    client: {
      async listMaterials({ projectId }) {
        requests.push(projectId)
        return normalizeLocalMaterialCatalogList({
          schemaVersion: 1,
          materials: [catalogItem(projectId === 'project-a' ? 'a' : 'b')],
        })
      },
    },
    persistence,
    hashBytes: digestBytes,
  })
  await waitFor(() => assert.equal(runtime.getSnapshot().status, 'ready'))
  assert.deepEqual(requests, ['project-a'])

  persistence.setSnapshot({
    state: 'ready',
    projectId: 'project-a',
    branchId: 'branch-main',
    draftGeneration: 2,
  })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(requests, ['project-a'])

  persistence.setSnapshot({
    state: 'ready',
    projectId: 'project-b',
    branchId: 'branch-restored',
    draftGeneration: 1,
  })
  await waitFor(() => assert.equal(runtime.getSnapshot().projectId, 'project-b'))
  assert.deepEqual(requests, ['project-a', 'project-b'])

  await runtime.refresh()
  assert.deepEqual(requests, ['project-a', 'project-b', 'project-b'])
  runtime.dispose()
})

test('catalog runtime distinguishes transport error from invalid-contract fail-closed state', async () => {
  const persistence = createPersistence()
  let failure = new DashboardLocalMaterialCatalogClientError('transport-failed', {
    retryable: true,
    message: 'offline',
  })
  const runtime = createDashboardLocalMaterialCatalogRuntime({
    enabled: true,
    client: {
      async listMaterials() {
        throw failure
      },
    },
    persistence,
    hashBytes: digestBytes,
  })
  await waitFor(() => assert.equal(runtime.getSnapshot().status, 'error'))
  assert.deepEqual(runtime.getSnapshot().failure, { code: 'transport-failed', message: 'offline', retryable: true })

  failure = new DashboardLocalMaterialCatalogClientError('invalid-response', { message: 'forged DTO' })
  await runtime.refresh()
  assert.equal(runtime.getSnapshot().status, 'fail-closed')
  assert.deepEqual(runtime.getSnapshot().materials, [])
  runtime.dispose()
})

test('catalog runtime fail-closes when an injected client bypasses canonical list validation', async () => {
  const persistence = createPersistence()
  const runtime = createDashboardLocalMaterialCatalogRuntime({
    enabled: true,
    client: {
      async listMaterials() {
        return { schemaVersion: 1, materials: [catalogItem('b'), catalogItem('a')] }
      },
    },
    persistence,
    hashBytes: digestBytes,
  })
  await waitFor(() => assert.equal(runtime.getSnapshot().status, 'fail-closed'))
  assert.deepEqual(runtime.getSnapshot().materials, [])
  assert.equal(persistence.reads.length, 0)
  runtime.dispose()
})

test('durable palette snippet always uses the trusted proxy and lets Core allocate each instance id', () => {
  const material = normalizeLocalMaterialCatalogItem(catalogItem('a'))
  const first = createDurableMaterialSnippet(material)
  const second = createDurableMaterialSnippet(material)
  assert.notStrictEqual(first, second)
  assert.equal(first.schema.componentName, 'GeneratedMaterialHost')
  assert.deepEqual(first.schema.props, {})
  assert.deepEqual(first.schema.$dashboard, { rect: { width: 400, height: 240 } })
  assert.deepEqual(first.schema.children, [])
  assert.deepEqual(first.schema.$agent, { schemaVersion: 1, artifactRef: material.artifactRef })
  const runtimeMaterial = Object.freeze({ ...material, availability: 'available', unavailableReason: null })
  assert.deepEqual(createDurableMaterialSnippet(runtimeMaterial), first)
  assert.equal(Object.hasOwn(first.schema, 'id'), false)
  assert.equal(Object.hasOwn(second.schema, 'id'), false)
  assert.deepEqual(first.schema.$agent.artifactRef.target, second.schema.$agent.artifactRef.target)
})

test('promotion runtime refresh hook observes direct and resumed applied results without changing their outcome', async t => {
  const runtimeSource = await readFile(
    new URL('../src/editor/agent/capabilities/promotion/runtime.mjs', import.meta.url),
    'utf8',
  )
  const factoryKey = `__catalogPromotionFactory${Date.now()}${Math.random().toString(16).slice(2)}`
  const applied = Object.freeze({ schemaVersion: 1, callId: 'call-1', status: 'applied', output: {} })
  globalThis[factoryKey] = () =>
    Object.freeze({
      async promoteLocal() {
        return applied
      },
      async queryReceipt() {
        return null
      },
      async resumePending() {
        return Object.freeze({ schemaVersion: 1, results: Object.freeze([applied]) })
      },
    })
  t.after(() => delete globalThis[factoryKey])
  const instrumented = runtimeSource.replace(
    "import { createDashboardLocalMaterialPromotionCapabilityService } from './service.mjs'",
    `const createDashboardLocalMaterialPromotionCapabilityService = globalThis[${JSON.stringify(factoryKey)}]`,
  )
  const module = await import(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`)
  let refreshes = 0
  const runtime = module.createDashboardLocalMaterialPromotionRuntime({
    authority: { projectId: 'project-a' },
    featureFlags: { runtime: true, online: true, promotion: true },
    client: { checkAvailability: async () => ({ available: true }) },
    persistence: { checkLocalGrant: async () => ({ granted: true }) },
    onPromotionApplied: async () => {
      refreshes += 1
      throw new Error('projection refresh failed')
    },
  })

  assert.strictEqual(await runtime.promotionService.promoteLocal({}), applied)
  await waitFor(() => assert.equal(refreshes, 1))
  const resumed = await runtime.promotionService.resumePending()
  assert.deepEqual(resumed, { schemaVersion: 1, results: [applied] })
  await waitFor(() => assert.equal(refreshes, 2))
  assert.equal(await runtime.promotionService.queryReceipt({}), null)
})

test('browser catalog composition never imports or executes server, Easypack, Node, or raw source modules', async () => {
  const files = [
    '../shared/material-catalog-contract.mjs',
    '../src/editor/agent/capabilities/promotion/catalog-client.mjs',
    '../src/editor/agent/capabilities/promotion/catalog-runtime.mjs',
    '../src/pages/editor/Sidebar/DurableMaterialPalette.tsx',
    '../src/editor/runtime.ts',
  ]
  const sources = await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), 'utf8')))
  assert.doesNotMatch(sources.join('\n'), /@easy-editor\/easypack|server\/promotion|from ['"]node:|\.source\b/u)
  assert.match(sources[1], /shared\/material-catalog-contract\.mjs/u)

  const runtimeSource = await readFile(
    new URL('../src/editor/agent/capabilities/promotion/runtime.mjs', import.meta.url),
    'utf8',
  )
  assert.match(runtimeSource, /onPromotionApplied/u)
  assert.match(runtimeSource, /result\?\.status === 'applied'/u)
  assert.match(runtimeSource, /result\?\.results\?\.some/u)
  assert.match(runtimeSource, /Promise\.resolve\(onPromotionApplied\(\)\)\.catch/u)
  assert.match(sources.at(-1), /onPromotionApplied:\s*async \(\) =>/u)
  assert.match(sources.at(-1), /await dashboardLocalMaterialCatalogRuntime\.refresh\(\)/u)
})
