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

const createAdapter = (nodeCount = 3, options = {}) => {
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
      ...(typeof options.resolveEntry === 'function' ? { resolveEntry: options.resolveEntry } : {}),
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
  const { adapter, state } = createAdapter(nodeCount, options)
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

test('full snapshots positively project safe node state and finite artifact references', async () => {
  let getterInvocations = 0
  const getter = () => {
    getterInvocations += 1
    return 'getter-must-not-run'
  }
  const { service, state } = createHarness()
  const nestedUnknown = { opaque: 'nested-private-material' }
  Object.defineProperty(nestedUnknown, 'readThroughGetter', { enumerable: true, get: getter })
  const unknownArray = ['safe-looking', 'getter-backed']
  Object.defineProperty(unknownArray, '1', { configurable: true, enumerable: true, get: getter })
  state.document.schema.props = {
    backgroundColor: '#232630',
    safe: 'unknown-prop-must-not-cross',
    callback: () => 'unsafe',
    credentialRef: 'credential-1',
    bearerToken: 'bearer-must-not-cross',
    privateKey: 'private-key-must-not-cross',
    nestedUnknown,
    unknownArray,
    hostObject: new (class HostObject {})(),
  }
  Object.defineProperty(state.document.schema.props, 'backgroundImage', { enumerable: true, get: getter })
  state.document.schema.title = 'Projected root title'
  state.document.schema.artifactRef = {
    artifactId: 'artifact-safe-id',
    logicalComponentId: 'component-safe-id',
    sourceIntegrity: 'sha256-safe-source',
    sourceRevision: 'revision-safe-id',
    target: {
      kind: 'local-material',
      materialId: 'material-safe-id',
      buildIntegrity: 'sha256-safe-build',
      module: 'module-must-not-cross',
    },
    rollbackTo: {
      artifactId: 'rollback-safe-id',
      logicalComponentId: 'rollback-component-safe-id',
      sourceIntegrity: 'sha256-safe-rollback',
      sourceRevision: 'rollback-revision-safe-id',
      code: 'rollback-code-must-not-cross',
    },
    code: 'artifact-code-must-not-cross',
    source: 'artifact-source-must-not-cross',
    signingSeed: 'artifact-signing-seed-must-not-cross',
    unknownArray,
  }
  Object.defineProperty(state.document.schema.artifactRef.target, 'materialVersion', {
    enumerable: true,
    get: getter,
  })
  Object.defineProperty(state.document.schema.artifactRef, 'credentials', { enumerable: true, get: getter })
  state.document.schema.deploymentEnvelope = nestedUnknown

  const full = await service.observe({ mode: 'full' })
  const clone = structuredClone(full)
  const serialized = JSON.stringify(clone)
  const root = clone.projection['dashboard.core'].nodes['node-000']

  assert.equal(getterInvocations, 0)
  assert.equal(clone.schemaVersion, 1)
  assert.equal(Object.hasOwn(root, 'props'), false)
  assert.deepEqual(root.extra.artifactRef, {
    artifactId: 'artifact-safe-id',
    logicalComponentId: 'component-safe-id',
    rollbackTo: {
      artifactId: 'rollback-safe-id',
      logicalComponentId: 'rollback-component-safe-id',
      sourceIntegrity: 'sha256-safe-rollback',
      sourceRevision: 'rollback-revision-safe-id',
    },
    sourceIntegrity: 'sha256-safe-source',
    sourceRevision: 'revision-safe-id',
    target: {
      buildIntegrity: 'sha256-safe-build',
      kind: 'local-material',
      materialId: 'material-safe-id',
    },
  })
  assert.equal(root.extra.title, 'Projected root title')
  assert.doesNotMatch(
    serialized,
    /unknown-prop-must-not-cross|credential-1|bearer-must-not-cross|private-key-must-not-cross|nested-private-material|artifact-code-must-not-cross|artifact-source-must-not-cross|module-must-not-cross|rollback-code-must-not-cross|signing-seed-must-not-cross|must-not-leak|configure|callback|HostObject|getter-must-not-run/,
  )
  assert.equal(typeof clone.revision, 'string')
  assert.equal(typeof clone.cursor, 'string')
  assert.deepEqual(clone.providerGenerations, {
    'dashboard.core': 1,
  })
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
  root.props = { backgroundColor: '#101010', nested, values }
  Object.defineProperty(root.props, 'backgroundImage', { configurable: true, enumerable: true, get: getter })

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
  assert.equal(Object.hasOwn(core.nodes['node-000'], 'props'), false)
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

test('Core material summaries use the explicit resolver seam without touching prototype getters', async () => {
  let getterInvocations = 0
  let resolverInvocations = 0

  class ComponentMetaLike {
    constructor(metadata) {
      this.#metadata = metadata
    }

    #metadata

    getMetadata() {
      resolverInvocations += 1
      return this.#metadata
    }
  }

  for (const key of ['componentName', 'title', 'description', 'group', 'category', 'tags']) {
    Object.defineProperty(ComponentMetaLike.prototype, key, {
      enumerable: true,
      get() {
        getterInvocations += 1
        throw new Error(`prototype getter should not run for ${key}`)
      },
    })
  }

  const rootMetadata = Object.freeze({
    componentName: 'Root',
    title: 'Root',
    description: 'Root summary',
    group: 'Layouts',
    category: 'Structure',
    tags: Object.freeze(['base']),
  })
  const imageMetadata = Object.freeze({
    componentName: 'Image',
    title: 'Image',
    description: 'Image summary',
    group: 'Media',
    category: 'Display',
    tags: Object.freeze(['visual']),
  })
  const { service, state } = createHarness(3, {
    resolveEntry: meta => meta.getMetadata(),
  })
  state.materials.entries = new Map([
    ['root', new ComponentMetaLike(rootMetadata)],
    ['image', new ComponentMetaLike(imageMetadata)],
  ])

  const full = await service.observe({ mode: 'full' })
  const clone = structuredClone(full)
  const serialized = JSON.stringify(clone)
  const summaries = full.projection['dashboard.core'].materials.summaries

  assert.equal(getterInvocations, 0)
  assert.equal(resolverInvocations, 2)
  assert.deepEqual(
    summaries.map(material => material.componentName),
    ['Image', 'Root'],
  )
  assert.deepEqual(summaries, [
    sanitizeJsonValue({
      componentName: 'Image',
      title: 'Image',
      description: 'Image summary',
      group: 'Media',
      category: 'Display',
      tags: ['visual'],
    }),
    sanitizeJsonValue({
      componentName: 'Root',
      title: 'Root',
      description: 'Root summary',
      group: 'Layouts',
      category: 'Structure',
      tags: ['base'],
    }),
  ])
  assert.equal(JSON.stringify(clone), serialized)
  assert.deepEqual(clone, JSON.parse(serialized))
  assert.doesNotMatch(serialized, /prototype getter|credential|authorization|secret|password/)
})

test('Core material summaries ignore a getter-only resolveEntry seam and keep plain metadata fallback', async () => {
  let resolveEntryGetterInvocations = 0
  const { service, state } = createHarness()
  Object.defineProperty(state.materials, 'resolveEntry', {
    enumerable: true,
    get() {
      resolveEntryGetterInvocations += 1
      throw new Error('resolveEntry getter should not run')
    },
  })

  const full = await service.observe({ mode: 'full' })
  const clone = structuredClone(full)
  const serialized = JSON.stringify(clone)
  const summaries = full.projection['dashboard.core'].materials.summaries

  assert.equal(resolveEntryGetterInvocations, 0)
  assert.deepEqual(
    summaries.map(material => material.componentName),
    ['Root', 'Text'],
  )
  assert.equal(JSON.stringify(clone), serialized)
  assert.deepEqual(clone, JSON.parse(serialized))
  assert.doesNotMatch(serialized, /resolveEntry getter should not run|credential|authorization|secret|password/)
})

test('Core material summaries omit entries whose resolveEntry throws secret-bearing errors', async () => {
  let resolverInvocations = 0

  class ComponentMetaLike {
    constructor(metadata) {
      this.#metadata = metadata
    }

    #metadata

    getMetadata() {
      resolverInvocations += 1
      return this.#metadata
    }
  }

  class ThrowingComponentMetaLike {
    constructor(message) {
      this.#message = message
    }

    #message

    getMetadata() {
      resolverInvocations += 1
      throw new Error(this.#message)
    }
  }

  const { service, state } = createHarness(3, {
    resolveEntry: meta => meta.getMetadata(),
  })
  state.materials.entries = new Map([
    [
      'root',
      new ComponentMetaLike(
        Object.freeze({
          componentName: 'Root',
          title: 'Root',
          description: 'Root summary',
          group: 'Layouts',
          category: 'Structure',
          tags: Object.freeze(['base']),
        }),
      ),
    ],
    ['broken', new ThrowingComponentMetaLike('secret resolve failure: credential-7')],
  ])

  const full = await service.observe({ mode: 'full' })
  const clone = structuredClone(full)
  const serialized = JSON.stringify(clone)
  const summaries = full.projection['dashboard.core'].materials.summaries

  assert.equal(resolverInvocations, 2)
  assert.deepEqual(
    summaries.map(material => material.componentName),
    ['Root'],
  )
  assert.equal(JSON.stringify(clone), serialized)
  assert.deepEqual(clone, JSON.parse(serialized))
  assert.doesNotMatch(serialized, /secret resolve failure|credential-7|password|authorization/)
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
  let arrayVersion = 1
  let arrayValues = [1, 2, 3]
  registry.register({
    id: 'array.provider',
    getVersion: () => String(arrayVersion),
    capture: () => ({ values: arrayValues }),
  })
  const full = await service.observe({ mode: 'full' })
  const generation = registry.snapshot().find(record => record.provider.id === 'dashboard.core').generation

  assert.equal(full.providerGenerations['dashboard.core'], generation)

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
  assert.ok(delta.changes.some(change => change.path.at(-1) === 'title'))

  arrayValues = [7, 8, 9]
  arrayVersion += 1
  const arrayDelta = await service.observe({ mode: 'delta', cursor: delta.newCursor })
  assert.equal(isFull(arrayDelta), false)
  assert.equal(arrayDelta.providerId, 'array.provider')
  const arrayPatch = arrayDelta.changes.find(change => change.path.at(-1) === 'values')
  assert.deepEqual(arrayPatch?.value, [7, 8, 9])
  assert.ok(
    arrayDelta.changes.every(
      change => change.path.length > 0 && change.path.every(segment => typeof segment === 'string'),
    ),
  )

  state.document.schema.children[0].title = 'next'
  state.document.mutationVersion += 1
  const nextDelta = await service.observe({ mode: 'delta', cursor: arrayDelta.newCursor })
  assert.equal(isFull(nextDelta), false)
  assert.equal(nextDelta.baseRevision, arrayDelta.newRevision)
  assert.equal(nextDelta.baseCursor, arrayDelta.newCursor)
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
  const previousGeneration = withTemporary.providerGenerations.temporary
  unregister()
  registry.register({ id: 'temporary', getVersion: () => '1', capture: () => ({ value: 1 }) })
  const generationResync = await service.observe({ mode: 'delta', cursor: withTemporary.cursor })
  assert.equal(isFull(generationResync), true, 'generation')
  assert.ok(generationResync.providerGenerations.temporary > previousGeneration)

  assert.ok(registry.snapshot().some(record => record.provider === coreProvider))
})

test('stationary observations return full while empty deltas may advance revision and cursor', async () => {
  const { coreProvider, registry, service } = createHarness()
  let version = 1
  registry.register({ id: 'no-op', getVersion: () => String(version), capture: () => ({ stable: true }) })
  const full = await service.observe({ mode: 'full' })

  const stationary = await service.observe({ mode: 'delta', cursor: full.cursor })
  assert.equal(isFull(stationary), true)
  assert.equal(stationary.cursor, full.cursor)

  version += 1
  const noOpDelta = await service.observe({ mode: 'delta', cursor: stationary.cursor })
  assert.equal(isFull(noOpDelta), false)
  assert.deepEqual(noOpDelta.changes, [])
  assert.notEqual(noOpDelta.newRevision, noOpDelta.baseRevision)
  assert.notEqual(noOpDelta.newCursor, noOpDelta.baseCursor)
  assert.equal(
    noOpDelta.providerGeneration,
    registry.snapshot().find(record => record.provider === coreProvider).generation,
  )
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
