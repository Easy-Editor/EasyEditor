import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import {
  SnapshotProviderRegistry,
  createCoreProjectionProvider,
  createDashboardSnapshotService,
  createHostRevision,
  createProjectionChanges,
  sanitizeJsonValue,
  stableStringify,
  validateProjectionChanges,
} from '../src/editor/agent/snapshot/index.mjs'

const createNode = (index, overrides = {}) => ({
  id: `node-${String(index).padStart(3, '0')}`,
  componentName: index === 0 ? 'Root' : 'Text',
  props: {
    text: `Node ${index}`,
    values: [index, index + 1],
  },
  $dashboard: { rect: { x: index * 4, y: index * 2, width: 120, height: 32 } },
  ...overrides,
})

const createAdapter = (nodeCount = 3) => {
  const root = createNode(0, {
    componentName: 'Root',
    children: Array.from({ length: nodeCount - 1 }, (_, index) => createNode(index + 1)),
  })
  const state = {
    adapterGeneration: 1,
    document: { id: 'document-1', mutationVersion: 1, schema: root },
    materials: {
      version: 1,
      entries: new Map([
        [
          'Text',
          {
            componentName: 'Text',
            title: 'Text',
            description: 'Safe summary',
            tags: ['basic'],
            configure: { advanced: { view: () => null } },
            credentialRef: 'must-not-leak',
            artifactSource: 'must-not-leak',
          },
        ],
        ['Root', { componentName: 'Root', title: 'Root' }],
      ]),
    },
  }
  const adapter = {
    readAdapterGeneration: () => state.adapterGeneration,
    readDocument: () => state.document,
    readMaterials: () => state.materials,
  }
  return { adapter, state }
}

const createHarness = (nodeCount = 3, options = {}) => {
  const { adapter, state } = createAdapter(nodeCount)
  const coreProvider = createCoreProjectionProvider(adapter)
  const registry = new SnapshotProviderRegistry()
  registry.register(coreProvider)
  const service = createDashboardSnapshotService({ registry, coreProvider, ...options })
  return { adapter, coreProvider, registry, service, state }
}

const isFull = snapshot => Object.hasOwn(snapshot, 'projection')

test('revision and full projection are stable across provider insertion and material Map order', async () => {
  const revisionInput = {
    adapterGeneration: 4,
    documentId: 'doc',
    documentMutationVersion: 9,
    materialRegistryVersion: 3,
    providerVersions: { a: '2', z: '1' },
  }
  const revision = createHostRevision(revisionInput)
  assert.equal(revision, 'v1-09b578c0e299571d')
  assert.match(revision, /^v1-/)
  assert.equal(createHostRevision({ ...revisionInput, providerVersions: { z: '1', a: '2' } }), revision)
  for (const changed of [
    { ...revisionInput, adapterGeneration: 5 },
    { ...revisionInput, documentId: 'other-doc' },
    { ...revisionInput, documentMutationVersion: 10 },
    { ...revisionInput, materialRegistryVersion: 4 },
    { ...revisionInput, providerVersions: { ...revisionInput.providerVersions, a: '3' } },
  ]) {
    assert.notEqual(createHostRevision(changed), revision)
  }

  const first = createHarness()
  const firstFull = await first.service.observe({ mode: 'full' })
  first.state.materials.entries = new Map([...first.state.materials.entries].reverse())
  const secondFull = await first.service.observe({ mode: 'full' })

  assert.equal(firstFull.revision, secondFull.revision)
  assert.equal(stableStringify(firstFull.projection), stableStringify(secondFull.projection))
  assert.deepEqual(
    firstFull.projection['dashboard.core'].materials.summaries.map(material => material.componentName),
    ['Root', 'Text'],
  )
})

test('provider registry rejects duplicate ids and never reuses generations', () => {
  const registry = new SnapshotProviderRegistry()
  const provider = { id: 'provider', getVersion: () => '1', capture: () => ({ value: 1 }) }
  const unregister = registry.register(provider)
  const firstGeneration = registry.snapshot()[0].generation

  assert.throws(() => registry.register({ ...provider }), /already registered/)
  unregister()
  registry.register({ id: 'provider', getVersion: () => '2', capture: () => ({ value: 2 }) })
  const secondGeneration = registry.snapshot()[0].generation

  assert.ok(secondGeneration > firstGeneration)
  assert.ok(registry.generation >= secondGeneration)
})

test('full snapshots are structured-clone JSON and omit host objects, callbacks, credentials, and artifact source', async () => {
  const { service, state } = createHarness()
  state.document.schema.props = {
    safe: 'value',
    callback: () => 'unsafe',
    credentialRef: 'credential-1',
    artifactRef: { artifactId: 'a', source: 'const unsafe = true', sourceRevision: '1' },
    hostObject: new (class HostObject {})(),
  }

  const full = await service.observe({ mode: 'full' })
  const clone = structuredClone(full)
  const serialized = JSON.stringify(clone)

  assert.equal(clone.schemaVersion, 1)
  assert.doesNotMatch(serialized, /credential-1|must-not-leak|const unsafe|configure|callback|HostObject/)
  assert.match(serialized, /"safe":"value"/)
  assert.equal(typeof clone.revision, 'string')
  assert.equal(typeof clone.cursor, 'string')
})

test('JSON sanitization omits nested and array accessors without invoking getters', () => {
  let getterInvocations = 0
  const getter = () => {
    getterInvocations += 1
    return 'getter-secret-source'
  }
  const nested = { safe: 'nested-safe' }
  Object.defineProperty(nested, 'credential', { enumerable: true, get: getter })
  const values = ['first', 'second', 'third']
  Object.defineProperty(values, '1', { configurable: true, enumerable: true, get: getter })
  const input = { nested, values }
  Object.defineProperty(input, 'sourceCode', { enumerable: true, get: getter })

  const sanitized = sanitizeJsonValue(input)
  const clone = structuredClone(sanitized)
  const jsonRoundTrip = JSON.parse(JSON.stringify(sanitized))

  assert.equal(getterInvocations, 0)
  assert.deepEqual(clone, jsonRoundTrip)
  assert.deepEqual(jsonRoundTrip, {
    nested: { safe: 'nested-safe' },
    values: ['first', null, 'third'],
  })
  assert.doesNotMatch(JSON.stringify(jsonRoundTrip), /getter-secret|credential|sourceCode/)
})

test('Core node and material summaries omit structural accessors without invoking getters', async () => {
  let getterInvocations = 0
  const getter = () => {
    getterInvocations += 1
    return 'getter-secret-source'
  }
  const { registry, service, state } = createHarness()
  const root = state.document.schema
  const nested = { safe: 'root-safe' }
  Object.defineProperty(nested, 'password', { enumerable: true, get: getter })
  const values = [1, 2, 3]
  Object.defineProperty(values, '1', { configurable: true, enumerable: true, get: getter })
  root.props = { nested, values }

  const safeChild = { id: 'safe-child' }
  Object.defineProperty(safeChild, 'componentName', { enumerable: true, get: getter })
  Object.defineProperty(safeChild, 'props', { enumerable: true, get: getter })
  Object.defineProperty(safeChild, 'children', { enumerable: true, get: getter })
  const accessorIdChild = { componentName: 'Text', props: { text: 'must-not-appear' } }
  Object.defineProperty(accessorIdChild, 'id', { enumerable: true, get: getter })
  const children = [safeChild, createNode(2), accessorIdChild]
  Object.defineProperty(children, '1', { configurable: true, enumerable: true, get: getter })
  root.children = children

  const textMaterial = state.materials.entries.get('Text')
  Object.defineProperty(state.materials.entries, 'values', { configurable: true, enumerable: true, get: getter })
  Object.defineProperty(textMaterial, 'title', { configurable: true, enumerable: true, get: getter })
  Object.defineProperty(textMaterial, 'description', { configurable: true, enumerable: true, get: getter })
  const tags = ['basic', 'poisoned']
  Object.defineProperty(tags, '1', { configurable: true, enumerable: true, get: getter })
  textMaterial.tags = tags

  const hostileProjection = { safe: 'provider-safe' }
  Object.defineProperty(hostileProjection, 'authorization', { enumerable: true, get: getter })
  registry.register({ id: 'hostile.provider', getVersion: () => '1', capture: () => hostileProjection })

  const full = await service.observe({ mode: 'full' })
  const clone = structuredClone(full)
  const jsonRoundTrip = JSON.parse(JSON.stringify(full))
  const core = full.projection['dashboard.core']
  const material = core.materials.summaries.find(summary => summary.componentName === 'Text')

  assert.equal(getterInvocations, 0)
  assert.equal(JSON.stringify(clone), JSON.stringify(jsonRoundTrip))
  assert.equal(full.projection['hostile.provider'].safe, 'provider-safe')
  assert.deepEqual(core.nodes['node-000'].props.values, [1, null, 3])
  assert.deepEqual(core.nodes['node-000'].childIds, ['safe-child'])
  assert.equal(core.nodes['safe-child'].componentName, 'Unknown')
  assert.equal(Object.hasOwn(core.nodes['safe-child'], 'props'), false)
  assert.equal(Object.hasOwn(core.nodes, 'getter-secret-source'), false)
  assert.equal(material.title, 'Text')
  assert.equal(material.description, '')
  assert.deepEqual(material.tags, ['basic', null])
  assert.doesNotMatch(
    JSON.stringify(jsonRoundTrip),
    /getter-secret|must-not-appear|password|authorization|credentialRef|artifactSource/,
  )
})

test('Core document and material registry accessors are omitted without invoking getters', async () => {
  let getterInvocations = 0
  const getter = () => {
    getterInvocations += 1
    return 'registry-secret-source'
  }
  const { service, state } = createHarness()
  for (const key of ['id', 'mutationVersion', 'schema']) {
    Object.defineProperty(state.document, key, { configurable: true, enumerable: true, get: getter })
  }
  for (const key of ['version', 'entries']) {
    Object.defineProperty(state.materials, key, { configurable: true, enumerable: true, get: getter })
  }

  const full = await service.observe({ mode: 'full' })
  const core = full.projection['dashboard.core']

  assert.equal(getterInvocations, 0)
  assert.deepEqual(Object.keys(core.nodes), [])
  assert.deepEqual(core.materials.summaries, [])
  assert.equal(Object.hasOwn(core.document, 'id'), false)
  assert.equal(Object.hasOwn(core.document, 'mutationVersion'), false)
  assert.equal(Object.hasOwn(core.materials, 'registryVersion'), false)
  assert.doesNotMatch(JSON.stringify(structuredClone(full)), /registry-secret|source/)
})

test('ordered deltas carry exact revision, cursor, provider generation, and atomic array patches', async () => {
  const { registry, service, state } = createHarness()
  const full = await service.observe({ mode: 'full' })
  const generation = registry.snapshot()[0].generation

  state.document.schema.children[0].props.values = [7, 8, 9]
  state.document.mutationVersion += 1
  const delta = await service.observe({ mode: 'delta', cursor: full.cursor })

  assert.equal(isFull(delta), false)
  assert.equal(delta.baseRevision, full.revision)
  assert.equal(delta.baseCursor, full.cursor)
  assert.equal(delta.providerId, 'dashboard.core')
  assert.equal(delta.providerGeneration, generation)
  assert.notEqual(delta.newRevision, delta.baseRevision)
  assert.notEqual(delta.newCursor, delta.baseCursor)
  const arrayPatch = delta.changes.find(change => change.path.at(-1) === 'values')
  assert.deepEqual(arrayPatch?.value, [7, 8, 9])
  assert.ok(
    delta.changes.every(change => change.path.length > 0 && change.path.every(segment => typeof segment === 'string')),
  )

  state.document.schema.children[0].props.text = 'next'
  state.document.mutationVersion += 1
  const nextDelta = await service.observe({ mode: 'delta', cursor: delta.newCursor })
  assert.equal(isFull(nextDelta), false)
  assert.equal(nextDelta.baseRevision, delta.newRevision)
  assert.equal(nextDelta.baseCursor, delta.newCursor)
})

test('loss, reorder, structural change, and provider generation changes force full resync', async () => {
  const { coreProvider, registry, service, state } = createHarness()
  const first = await service.observe({ mode: 'full' })
  state.document.schema.children[0].props.text = 'delta-1'
  state.document.mutationVersion += 1
  const delta = await service.observe({ mode: 'delta', cursor: first.cursor })
  assert.equal(isFull(delta), false)

  state.document.schema.children[0].props.text = 'delta-2'
  state.document.mutationVersion += 1
  assert.equal(isFull(await service.observe({ mode: 'delta', cursor: first.cursor })), true, 'lost/reordered cursor')

  const current = await service.observe({ mode: 'full' })
  state.document.schema.children.reverse()
  state.document.mutationVersion += 1
  assert.equal(isFull(await service.observe({ mode: 'delta', cursor: current.cursor })), true, 'reorder')

  const unregister = registry.register({ id: 'temporary', getVersion: () => '1', capture: () => ({ value: 1 }) })
  const withTemporary = await service.observe({ mode: 'full' })
  unregister()
  registry.register({ id: 'temporary', getVersion: () => '1', capture: () => ({ value: 1 }) })
  assert.equal(isFull(await service.observe({ mode: 'delta', cursor: withTemporary.cursor })), true, 'generation')

  assert.ok(registry.snapshot().some(record => record.provider === coreProvider))
})

test('optimistic fences retry tearing and discard a delayed replaced provider result', async () => {
  const { coreProvider, registry, service, state } = createHarness(3, { maxCaptureAttempts: 4 })
  let releaseOld
  let oldCaptureStarted
  let blockOldCapture = false
  const started = new Promise(resolve => {
    oldCaptureStarted = resolve
  })
  const oldProvider = {
    id: 'replaceable',
    getVersion: () => 'old-v1',
    capture: async () => {
      if (!blockOldCapture) return { source: 'old-provider-baseline' }
      oldCaptureStarted()
      await new Promise(resolve => {
        releaseOld = resolve
      })
      return { source: 'old-provider' }
    },
  }
  const unregisterOld = registry.register(oldProvider)
  const withOldProvider = await service.observe({ mode: 'full' })

  state.document.schema.children[0].props.text = 'moved'
  state.document.mutationVersion += 1
  blockOldCapture = true
  const pending = service.observe({ mode: 'delta', cursor: withOldProvider.cursor })
  await started
  unregisterOld()
  registry.register({ id: 'replaceable', getVersion: () => 'new-v1', capture: () => ({ origin: 'new-provider' }) })
  releaseOld()

  const result = await pending
  assert.equal(isFull(result), true)
  assert.equal(result.projection.replaceable.origin, 'new-provider')
  assert.equal(JSON.stringify(result).includes('old-provider'), false)
  assert.ok(registry.snapshot().some(record => record.provider === coreProvider))
})

test('a provider mutation during capture retries and returns a fenced full snapshot', async () => {
  const { registry, service, state } = createHarness(3, { maxCaptureAttempts: 3 })
  const base = await service.observe({ mode: 'full' })
  let firstCapture = true
  registry.register({
    id: 'tearing',
    getVersion: () => `v${state.adapterGeneration}`,
    capture: () => {
      if (firstCapture) {
        firstCapture = false
        state.adapterGeneration += 1
      }
      return { adapterGeneration: state.adapterGeneration }
    },
  })

  const result = await service.observe({ mode: 'delta', cursor: base.cursor })
  assert.equal(isFull(result), true)
  assert.equal(result.projection.tearing.adapterGeneration, state.adapterGeneration)
})

test('fixed 200-node smoke records warmed build+clone evidence and keeps one-move delta below 20% of full', async t => {
  const { service, state } = createHarness(200)
  await service.observe({ mode: 'full' })
  await service.observe({ mode: 'full' })

  const measurements = []
  let full
  for (let run = 0; run < 7; run += 1) {
    const startedAt = performance.now()
    full = structuredClone(await service.observe({ mode: 'full' }))
    measurements.push(performance.now() - startedAt)
  }
  const sorted = [...measurements].sort((left, right) => left - right)
  const median = sorted[Math.floor(sorted.length / 2)]
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
  const fullBytes = Buffer.byteLength(JSON.stringify(full), 'utf8')

  assert.equal(Object.keys(full.projection['dashboard.core'].nodes).length, 200)
  assert.ok(fullBytes < 1024 * 1024, `full snapshot is ${fullBytes} bytes`)
  assert.ok(Number.isFinite(median) && Number.isFinite(p95))

  state.document.schema.children[99].$dashboard.rect.x += 24
  state.document.mutationVersion += 1
  const delta = structuredClone(await service.observe({ mode: 'delta', cursor: full.cursor }))
  const deltaBytes = Buffer.byteLength(JSON.stringify(delta), 'utf8')
  assert.equal(isFull(delta), false)
  assert.ok(deltaBytes < fullBytes * 0.2, `delta ${deltaBytes} must be below 20% of full ${fullBytes}`)

  t.diagnostic(
    JSON.stringify({
      warmedMeasurements: measurements.length,
      fullUtf8Bytes: fullBytes,
      deltaUtf8Bytes: deltaBytes,
      deltaRatio: deltaBytes / fullBytes,
      buildAndCloneMedianMs: median,
      buildAndCloneP95Ms: p95,
    }),
  )
})

test('finite patch grammar rejects projection root replacement and prototype path keys', () => {
  assert.throws(() => createProjectionChanges({}, []), /JSON objects/)
  assert.deepEqual(createProjectionChanges({ value: 1 }, { value: 2 }), [{ op: 'set', path: ['value'], value: 2 }])
  assert.throws(() => createProjectionChanges({ safe: 1 }, JSON.parse('{"__proto__":2,"safe":1}')), /Unsafe/)
  assert.equal(validateProjectionChanges({ nested: { value: 1 } }, [{ op: 'remove', path: ['missing'] }]), false)
  assert.equal(
    validateProjectionChanges({ nested: { value: 1 } }, [
      { op: 'set', path: ['nested'], value: {} },
      { op: 'set', path: ['nested', 'value'], value: 2 },
    ]),
    false,
  )
  assert.equal(
    validateProjectionChanges({ nested: { value: 1 } }, [
      { op: 'set', path: ['nested', 'value'], value: 2 },
      { op: 'remove', path: ['nested', 'value'] },
    ]),
    false,
  )
})

test('cursor history is bounded and dispose releases snapshot state', async () => {
  const { service, state } = createHarness(3, { historyLimit: 2 })
  const expired = await service.observe({ mode: 'full' })

  for (let version = 2; version <= 4; version += 1) {
    state.document.schema.children[0].props.text = `version-${version}`
    state.document.mutationVersion = version
    await service.observe({ mode: 'full' })
  }

  state.document.schema.children[0].props.text = 'after-expiry'
  state.document.mutationVersion += 1
  assert.equal(isFull(await service.observe({ mode: 'delta', cursor: expired.cursor })), true)

  service.dispose()
  assert.equal(service.disposed, true)
  await assert.rejects(() => service.observe({ mode: 'full' }), /disposed/)
})
