import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  createOnlineComponentSurfaceController,
  createOnlineComponentSurfaceMarkerStorageKey,
} from '../src/runtime/online-components/surface-controller.mjs'

const hashBytes = async bytes => new Uint8Array(createHash('sha256').update(bytes).digest())
const source = 'export default { mount() {}, update() {}, destroy() {} }'
const dependencySource = 'export default Object.freeze({ value: 1 })'
const hexDigest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const sriDigest = value => `sha256-${createHash('sha256').update(value).digest('base64')}`

const ref = (revision = 'revision-1') => ({
  artifactId: 'artifact-kpi',
  logicalComponentId: 'logical-kpi',
  sourceIntegrity: hexDigest(source),
  sourceRevision: revision,
  target: { kind: 'online' },
})

const localMaterialRef = (revision = 'revision-local') => {
  const sourceRevision = {
    artifactId: 'artifact-kpi',
    logicalComponentId: 'logical-kpi',
    sourceIntegrity: hexDigest(source),
    sourceRevision: revision,
  }
  return {
    ...sourceRevision,
    rollbackTo: { ...sourceRevision, sourceRevision: 'revision-rollback' },
    target: {
      kind: 'local-material',
      materialId: 'material-kpi',
      materialVersion: '1.0.0',
      buildIntegrity: `sha256:${'b'.repeat(64)}`,
    },
  }
}

const lockedDependency = (overrides = {}) => {
  const bytes = Buffer.from(dependencySource)
  return {
    package: '@customer/chart',
    range: '^1.0.0',
    exactVersion: '1.2.3',
    finalUrl: 'https://cdn.example.test/@customer/chart@1.2.3/index.mjs',
    integrity: sriDigest(bytes),
    cached: true,
    module: {
      format: 'bundled-esm',
      contentType: 'text/javascript',
      encoding: 'base64',
      byteLength: bytes.byteLength,
      bytes: bytes.toString('base64'),
    },
    ...overrides,
  }
}

const artifact = (artifactRef = ref(), overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-a',
  artifactId: artifactRef.artifactId,
  logicalComponentId: artifactRef.logicalComponentId,
  sourceIntegrity: artifactRef.sourceIntegrity,
  sourceRevision: artifactRef.sourceRevision,
  source,
  css: ':host { display: block; }',
  safeManifest: { schemaVersion: 1 },
  lockedDependencies: [lockedDependency()],
  dependencyLockDigest: `sha256:${'d'.repeat(64)}`,
  diagnostics: [],
  provenance: { actor: 'agent' },
  createdAt: 1,
  supersedes: null,
  ...overrides,
})

const node = artifactRef => ({
  componentName: 'GeneratedMaterialHost',
  $agent: { schemaVersion: 1, artifactRef },
})

const registration = (instanceId, artifactRef = ref(), overrides = {}) => ({
  projectId: 'project-a',
  instanceId,
  node: node(artifactRef),
  rect: { x: 1, y: 2, width: 320, height: 180 },
  visible: true,
  generatedZ: 1,
  payload: { props: { title: instanceId }, data: { value: 1 } },
  ...overrides,
})

const createStorage = initial => {
  const values = new Map(Object.entries(initial ?? {}))
  const events = []
  return {
    values,
    events,
    getItem(key) {
      events.push(['get', key])
      return values.get(key) ?? null
    },
    setItem(key, value) {
      events.push(['set', key])
      values.set(key, String(value))
    },
    removeItem(key) {
      events.push(['remove', key])
      values.delete(key)
    },
  }
}

const createHostFactory = () => {
  const calls = []
  const hosts = []
  const factory = options => {
    calls.push(options)
    const instances = new Map()
    const host = {
      instances,
      updates: [],
      disposed: false,
      register(input) {
        const markerKey = `${input.revisionKey}::${options.surfaceId}`
        const marker = {
          state: 'pending',
          revisionKey: input.revisionKey,
          surfaceId: options.surfaceId,
          activationId: options.activationId,
          nonce: 'nonce-00000000000000000001',
          startedAt: 1,
        }
        options.markerStore.write(markerKey, marker)
        instances.set(input.instanceId, structuredClone(input))
        options.markerStore.clear(markerKey, marker)
        return () => host.unregister(input.instanceId)
      },
      update(instanceId, patch) {
        const current = instances.get(instanceId)
        if (!current) throw new Error('unknown instance')
        instances.set(instanceId, structuredClone({ ...current, ...patch, instanceId }))
        host.updates.push([instanceId, structuredClone(patch)])
        return true
      },
      unregister(instanceId) {
        return instances.delete(instanceId)
      },
      dispose() {
        host.disposed = true
        instances.clear()
      },
      getDiagnostics() {
        return { iframeCount: host.disposed || instances.size === 0 ? 0 : 1, instanceCount: instances.size }
      },
    }
    hosts.push(host)
    return host
  }
  return { factory, calls, hosts }
}

const createController = (overrides = {}) => {
  const storage = overrides.markerStore ?? createStorage()
  const hosts = overrides.hosts ?? createHostFactory()
  let reads = 0
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: storage,
    hashBytes,
    createSurfaceHost: hosts.factory,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: async artifactRef => {
      reads += 1
      return artifact(artifactRef)
    },
    ...overrides.options,
  })
  return { controller, storage, hosts, reads: () => reads }
}

test('default-off and safe-boot perform zero artifact reads and create zero surface hosts', async () => {
  for (const options of [
    { featureEnabled: false, safeBoot: false },
    { featureEnabled: true, safeBoot: true },
  ]) {
    const hosts = createHostFactory()
    let reads = 0
    const controller = createOnlineComponentSurfaceController({
      projectId: 'project-a',
      branchId: 'main',
      surfaceId: 'editor-surface',
      markerStore: createStorage(),
      hashBytes,
      createSurfaceHost: hosts.factory,
      surfaceHostOptions: { mode: 'editor', mount: {} },
      readArtifact: async () => {
        reads += 1
        return artifact()
      },
      ...options,
    })
    assert.equal(await controller.register(registration('node-1')), false)
    assert.equal(reads, 0)
    assert.equal(hosts.calls.length, 0)
    assert.equal(controller.getDiagnostics().state, options.safeBoot ? 'safe-boot' : 'disabled')
  }
})

test('only GeneratedMaterialHost nodes can carry runtime artifact authority', async () => {
  const harness = createController()
  await assert.rejects(
    harness.controller.register(
      registration('forged', ref(), {
        node: { componentName: 'Text', $agent: { schemaVersion: 1, artifactRef: ref() } },
      }),
    ),
    /GeneratedMaterialHost/i,
  )
  assert.equal(harness.reads(), 0)
  assert.equal(harness.hosts.calls.length, 0)
})

test('twenty canonical instances share one host and receive only verified sandbox artifact projections', async () => {
  const harness = createController()
  await Promise.all(
    Array.from({ length: 20 }, (_, index) => harness.controller.register(registration(`node-${index}`))),
  )

  assert.equal(harness.reads(), 20)
  assert.equal(harness.hosts.calls.length, 1)
  assert.equal(harness.hosts.hosts[0].instances.size, 20)
  assert.equal(harness.hosts.hosts[0].getDiagnostics().iframeCount, 1)
  const projected = harness.hosts.hosts[0].instances.get('node-0').payload.artifact
  assert.deepEqual(projected, {
    source,
    css: ':host { display: block; }',
    dependencies: [{ specifier: '@customer/chart', source: dependencySource }],
  })
  assert.doesNotMatch(JSON.stringify(projected), /finalUrl|integrity|base64|bytes|Engine|Document|Core/)
  assert.equal(harness.storage.values.size, 0)
})

test('local-material promotion keeps the immutable artifact on the same sandbox projection path', async () => {
  const harness = createController()
  globalThis.__easyEditorMainRealmSentinel = 0
  const promotedSource = `${source}\nglobalThis.__easyEditorMainRealmSentinel = 1`
  const promotedRef = { ...localMaterialRef(), sourceIntegrity: hexDigest(promotedSource) }
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'promoted-material-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: harness.storage,
    hashBytes,
    createSurfaceHost: harness.hosts.factory,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: async artifactRef => artifact(artifactRef, { source: promotedSource }),
  })

  assert.equal(await controller.register(registration('promoted', promotedRef)), true)
  assert.equal(globalThis.__easyEditorMainRealmSentinel, 0)
  assert.equal(harness.hosts.hosts[0].instances.get('promoted').payload.artifact.source, promotedSource)
  globalThis.__easyEditorMainRealmSentinel = undefined
})

test('hash ArrayBufferView offsets are respected without reading adjacent bytes', async () => {
  const hosts = createHostFactory()
  const offsetHashBytes = async bytes => {
    const digest = new Uint8Array(createHash('sha256').update(bytes).digest())
    const padded = new Uint8Array(40).fill(0xff)
    padded.set(digest, 4)
    return new DataView(padded.buffer, 4, digest.byteLength)
  }
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'offset-hash-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: createStorage(),
    hashBytes: offsetHashBytes,
    createSurfaceHost: hosts.factory,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: async artifactRef => artifact(artifactRef),
  })

  assert.equal(await controller.register(registration('offset-view')), true)
  assert.equal(hosts.calls.length, 1)
})

test('identity, source digest, dependency SRI, and dependency UTF-8 failures are isolated', async t => {
  const cases = [
    ['identity', current => ({ ...current, artifactId: 'forged-artifact' })],
    ['source-digest', current => ({ ...current, source: `${current.source}\n// forged` })],
    [
      'dependency-sri',
      current => ({
        ...current,
        lockedDependencies: [
          lockedDependency({
            module: { ...lockedDependency().module, bytes: Buffer.from('export default 2').toString('base64') },
          }),
        ],
      }),
    ],
    [
      'dependency-utf8',
      current => ({
        ...current,
        lockedDependencies: [
          lockedDependency({
            integrity: sriDigest(Buffer.from([0xc3, 0x28])),
            module: {
              ...lockedDependency().module,
              byteLength: 2,
              bytes: Buffer.from([0xc3, 0x28]).toString('base64'),
            },
          }),
        ],
      }),
    ],
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const hosts = createHostFactory()
      const goodRef = ref()
      const controller = createOnlineComponentSurfaceController({
        projectId: 'project-a',
        branchId: 'main',
        surfaceId: `surface-${name}`,
        featureEnabled: true,
        safeBoot: false,
        markerStore: createStorage(),
        hashBytes,
        createSurfaceHost: hosts.factory,
        surfaceHostOptions: { mode: 'editor', mount: {} },
        readArtifact: async artifactRef =>
          artifactRef.sourceRevision === 'revision-bad' ? mutate(artifact(artifactRef)) : artifact(artifactRef),
      })
      assert.equal(await controller.register(registration('good', goodRef)), true)
      await assert.rejects(controller.register(registration('bad', ref('revision-bad'))), /artifact|dependency|UTF-8/i)
      assert.equal(hosts.calls.length, 1)
      assert.equal(hosts.hosts[0].instances.has('good'), true)
      assert.equal(hosts.hosts[0].instances.has('bad'), false)
      assert.equal(hosts.hosts[0].disposed, false)
    })
  }
})

test('late artifact resolution cannot resurrect an unregistered instance', async () => {
  let resolveRead
  const pendingRead = new Promise(resolve => {
    resolveRead = resolve
  })
  const hosts = createHostFactory()
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: createStorage(),
    hashBytes,
    createSurfaceHost: hosts.factory,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: () => pendingRead,
  })
  const pending = controller.register(registration('late'))
  assert.equal(controller.unregister('late'), true)
  resolveRead(artifact())
  assert.equal(await pending, false)
  assert.equal(hosts.calls.length, 0)
})

test('last-write-wins drops a late old revision update', async () => {
  const deferred = new Map()
  const hosts = createHostFactory()
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: createStorage(),
    hashBytes,
    createSurfaceHost: hosts.factory,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: artifactRef => {
      if (artifactRef.sourceRevision !== 'revision-2') return Promise.resolve(artifact(artifactRef))
      return new Promise(resolve => deferred.set(artifactRef.sourceRevision, resolve))
    },
  })
  await controller.register(registration('node'))
  const oldUpdate = controller.update('node', { node: node(ref('revision-2')) })
  const newestUpdate = controller.update('node', {
    node: node(ref('revision-3')),
    payload: { props: { title: 'newest' } },
  })
  assert.equal(await newestUpdate, true)
  deferred.get('revision-2')(artifact(ref('revision-2')))
  assert.equal(await oldUpdate, false)
  const instance = hosts.hosts[0].instances.get('node')
  assert.equal(instance.payload.props.title, 'newest')
  assert.equal(instance.payload.artifact.source, source)
})

test('pending activation reload quarantines before reads or host creation until explicitly cleared', async () => {
  const key = createOnlineComponentSurfaceMarkerStorageKey({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
  })
  const marker = {
    state: 'pending',
    revisionKey: 'revision-stale',
    surfaceId: 'editor-surface',
    activationId: 'project-a:main:editor-surface',
    nonce: 'nonce-00000000000000000001',
    startedAt: 1,
  }
  const storage = createStorage({
    [key]: JSON.stringify({ schemaVersion: 1, pending: { stale: marker }, quarantined: {} }),
  })
  const hosts = createHostFactory()
  let reads = 0
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: storage,
    hashBytes,
    createSurfaceHost: hosts.factory,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: async artifactRef => {
      reads += 1
      return artifact(artifactRef)
    },
  })

  assert.equal(controller.getDiagnostics().state, 'quarantined')
  assert.equal(await controller.register(registration('blocked')), false)
  assert.equal(reads, 0)
  assert.equal(hosts.calls.length, 0)
  assert.equal(controller.clearQuarantine(), true)
  assert.equal(storage.values.has(key), false)
  assert.equal(await controller.register(registration('active')), true)
  assert.equal(reads, 1)
  assert.equal(hosts.calls.length, 1)
})

test('dispose cancels pending work, disposes the one host, and reports zero resources', async () => {
  const harness = createController()
  await harness.controller.register(registration('active'))
  harness.controller.dispose()
  assert.equal(harness.hosts.hosts[0].disposed, true)
  assert.deepEqual(harness.controller.getDiagnostics(), {
    state: 'disposed',
    instanceCount: 0,
    iframeCount: 0,
    hostCreated: true,
    faultCount: 0,
  })
  assert.equal(await harness.controller.register(registration('after-dispose')), false)
  assert.equal(harness.reads(), 1)
})
