import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { canonicalJsonStringify } from '../src/lib/storage/canonical-json.mjs'
import {
  createOnlineComponentSurfaceController,
  createOnlineComponentSurfaceMarkerStorageKey,
} from '../src/runtime/online-components/surface-controller.mjs'

const hashBytes = async bytes => new Uint8Array(createHash('sha256').update(bytes).digest())
const source = 'export default { mount() {}, update() {}, destroy() {} }'
const revisedSource = 'export default { mount() { return "revised" }, update() {}, destroy() {} }'
const dependencySource = 'export default Object.freeze({ value: 1 })'
const artifactCss = ':host { display: block; }'
const hexDigest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const sriDigest = value => `sha256-${createHash('sha256').update(value).digest('base64')}`

const runtimeRevisionKey = sourceValue => {
  const projection = {
    source: sourceValue,
    css: artifactCss,
    dependencies: [{ specifier: '@customer/chart', source: dependencySource }],
  }
  return `artifact-${createHash('sha256').update(JSON.stringify(projection)).digest('hex')}`
}

const ref = (revision = 'revision-1') => ({
  artifactId: 'artifact-kpi',
  logicalComponentId: 'logical-kpi',
  sourceIntegrity: hexDigest(source),
  sourceRevision: revision,
  target: { kind: 'online' },
})

const refForSource = (revision, sourceValue) => ({ ...ref(revision), sourceIntegrity: hexDigest(sourceValue) })

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

const artifact = (artifactRef = ref(), overrides = {}) => {
  const lockedDependencies = overrides.lockedDependencies ?? [lockedDependency()]
  return {
    schemaVersion: 1,
    projectId: 'project-a',
    artifactId: artifactRef.artifactId,
    logicalComponentId: artifactRef.logicalComponentId,
    sourceIntegrity: artifactRef.sourceIntegrity,
    sourceRevision: artifactRef.sourceRevision,
    source,
    css: artifactCss,
    safeManifest: { schemaVersion: 1 },
    lockedDependencies,
    dependencyLockDigest: hexDigest(canonicalJsonStringify(lockedDependencies)),
    diagnostics: [],
    provenance: { actor: 'agent' },
    createdAt: 1,
    supersedes: null,
    ...overrides,
  }
}

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
      whenReady() {
        return Promise.resolve(!host.disposed)
      },
      abortOwnedActivation() {
        instances.clear()
        return true
      },
      dispose() {
        host.disposed = true
        instances.clear()
      },
      getDiagnostics() {
        return {
          state: host.disposed ? 'disposed' : instances.size === 0 ? 'idle' : 'ready',
          generation: host.disposed || instances.size === 0 ? 0 : 1,
          iframeCount: host.disposed || instances.size === 0 ? 0 : 1,
          instanceCount: instances.size,
        }
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
    assert.equal(await controller.whenReady({ expectedInstanceIds: ['node-1'] }), true)
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
  let hashes = 0
  const harness = createController({
    options: {
      hashBytes: async bytes => {
        hashes += 1
        return hashBytes(bytes)
      },
    },
  })
  await Promise.all(
    Array.from({ length: 20 }, (_, index) => harness.controller.register(registration(`node-${index}`))),
  )

  assert.equal(harness.reads(), 1)
  assert.equal(hashes, 4)
  assert.equal(harness.hosts.calls.length, 1)
  assert.equal(harness.hosts.hosts[0].instances.size, 20)
  assert.equal(harness.hosts.hosts[0].getDiagnostics().iframeCount, 1)
  const projected = harness.hosts.hosts[0].instances.get('node-0').payload.artifact
  assert.deepEqual(projected, {
    source,
    css: artifactCss,
    dependencies: [{ specifier: '@customer/chart', source: dependencySource }],
  })
  assert.doesNotMatch(JSON.stringify(projected), /finalUrl|integrity|base64|bytes|Engine|Document|Core/)
  assert.equal(harness.storage.values.size, 0)
})

test('geometry, visibility, and context updates reuse the verified immutable projection', async () => {
  let hashes = 0
  const harness = createController({
    options: {
      hashBytes: async bytes => {
        hashes += 1
        return hashBytes(bytes)
      },
    },
  })
  await harness.controller.register(registration('node'))
  await harness.controller.update('node', { rect: { x: 9, y: 8, width: 640, height: 360 } })
  await harness.controller.update('node', { visible: false })
  await harness.controller.update('node', {
    payload: { props: { title: 'updated' }, data: { value: 2 } },
  })

  assert.equal(harness.reads(), 1)
  assert.equal(hashes, 4)
  assert.equal(harness.hosts.hosts[0].updates.length, 3)
})

test('a rejected verification is evicted so a corrected immutable read can retry', async () => {
  const hosts = createHostFactory()
  let reads = 0
  let hashes = 0
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'retry-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: createStorage(),
    hashBytes: async bytes => {
      hashes += 1
      return hashBytes(bytes)
    },
    createSurfaceHost: hosts.factory,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: async artifactRef => {
      reads += 1
      return reads === 1 ? artifact(artifactRef, { source: `${source}\n// corrupt` }) : artifact(artifactRef)
    },
  })

  await assert.rejects(controller.register(registration('retry')), /source digest/i)
  assert.equal(await controller.update('retry', { visible: false }), true)
  assert.equal(reads, 2)
  assert.equal(hashes, 5)
  assert.equal(hosts.calls.length, 1)
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
  assert.equal(await controller.whenReady({ expectedInstanceIds: [] }), true)
  resolveRead(artifact())
  assert.equal(await pending, false)
  assert.equal(hosts.calls.length, 0)
})

test('readiness drains artifact materialization and then waits for host activation', async () => {
  let resolveRead
  let resolveHostReady
  const pendingRead = new Promise(resolve => {
    resolveRead = resolve
  })
  const pendingHostReady = new Promise(resolve => {
    resolveHostReady = resolve
  })
  let hostReadyCalls = 0
  const hosts = []
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: createStorage(),
    hashBytes,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: () => pendingRead,
    createSurfaceHost: () => {
      const host = {
        disposed: false,
        register: () => true,
        update: () => true,
        unregister: () => true,
        whenReady() {
          hostReadyCalls += 1
          return pendingHostReady
        },
        abortOwnedActivation: () => true,
        dispose() {
          this.disposed = true
        },
        getDiagnostics() {
          return { state: this.disposed ? 'disposed' : 'starting', generation: 1, iframeCount: 1 }
        },
      }
      hosts.push(host)
      return host
    },
  })

  const registrationResult = controller.register(registration('pending'))
  let settled = false
  const readiness = controller.whenReady({ expectedInstanceIds: ['pending'] }).then(value => {
    settled = true
    return value
  })
  await Promise.resolve()
  assert.equal(hosts.length, 0)
  assert.equal(settled, false)

  resolveRead(artifact())
  assert.equal(await registrationResult, true)
  for (let attempt = 0; attempt < 10 && hostReadyCalls === 0; attempt += 1) await Promise.resolve()
  assert.equal(hostReadyCalls, 1)
  assert.equal(settled, false)

  resolveHostReady(true)
  assert.equal(await readiness, true)
})

test('dispose interrupts readiness while artifact materialization is unresolved', async () => {
  let resolveRead
  const pendingRead = new Promise(resolve => {
    resolveRead = resolve
  })
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: createStorage(),
    hashBytes,
    createSurfaceHost: createHostFactory().factory,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: () => pendingRead,
  })
  const registrationResult = controller.register(registration('pending'))
  const readiness = controller.whenReady({ expectedInstanceIds: ['pending'] })
  controller.dispose()
  assert.equal(await readiness, false)
  resolveRead(artifact())
  assert.equal(await registrationResult, false)
})

test('readiness loops across a host restart generation before reporting activation-ready', async () => {
  let generation = 1
  let resolveFirstReadiness
  const firstReadiness = new Promise(resolve => {
    resolveFirstReadiness = resolve
  })
  let calls = 0
  const controller = createOnlineComponentSurfaceController({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
    featureEnabled: true,
    safeBoot: false,
    markerStore: createStorage(),
    hashBytes,
    surfaceHostOptions: { mode: 'editor', mount: {} },
    readArtifact: async artifactRef => artifact(artifactRef),
    createSurfaceHost: () => ({
      register: () => true,
      update: () => true,
      unregister: () => true,
      whenReady() {
        calls += 1
        return calls === 1 ? firstReadiness : Promise.resolve(true)
      },
      abortOwnedActivation: () => true,
      dispose: () => undefined,
      getDiagnostics: () => ({ state: generation === 1 ? 'starting' : 'ready', generation, iframeCount: 1 }),
    }),
  })
  assert.equal(await controller.register(registration('node')), true)
  const readiness = controller.whenReady({ expectedInstanceIds: ['node'] })
  generation = 2
  resolveFirstReadiness(false)
  assert.equal(await readiness, true)
  assert.equal(calls, 2)
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

test('readiness ignores a never-settling stale update after a newer record completes', async () => {
  const never = new Promise(() => undefined)
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
    readArtifact: artifactRef =>
      artifactRef.sourceRevision === 'revision-never' ? never : Promise.resolve(artifact(artifactRef)),
  })
  await controller.register(registration('node'))
  let staleSettled = false
  void controller.update('node', { node: node(ref('revision-never')) }).then(() => {
    staleSettled = true
  })
  assert.equal(await controller.update('node', { node: node(ref('revision-current')) }), true)
  assert.equal(await controller.whenReady({ expectedInstanceIds: ['node'] }), true)
  assert.equal(staleSettled, false)
  assert.equal(hosts.hosts[0].instances.get('node').revisionKey, runtimeRevisionKey(source))
  controller.dispose()
})

test('readiness waits for the exact current and registered instance census instead of a same-sized wrong id', async () => {
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
    readArtifact: async artifactRef => artifact(artifactRef),
  })
  assert.equal(await controller.register(registration('wrong-node')), true)
  let settled = false
  const exactReadiness = controller.whenReady({ expectedInstanceIds: ['expected-node'] }).then(value => {
    settled = true
    return value
  })
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(controller.matchesReadyCensus({ expectedInstanceIds: ['expected-node'] }), false)

  assert.equal(controller.unregister('wrong-node'), true)
  assert.equal(await controller.register(registration('expected-node')), true)
  assert.equal(await exactReadiness, true)
  assert.equal(controller.matchesReadyCensus({ expectedInstanceIds: ['expected-node'] }), true)
  controller.dispose()
})

test('pending and quarantined markers isolate only their matching immutable revision', async t => {
  for (const markerState of ['pending', 'quarantined']) {
    await t.test(markerState, async () => {
      const key = createOnlineComponentSurfaceMarkerStorageKey({
        projectId: 'project-a',
        branchId: 'main',
        surfaceId: 'editor-surface',
      })
      const badRef = refForSource('revision-bad', revisedSource)
      const badRevisionKey = runtimeRevisionKey(revisedSource)
      const marker = {
        state: 'pending',
        revisionKey: badRevisionKey,
        surfaceId: 'editor-surface',
        activationId: 'project-a:main:editor-surface',
        nonce: 'nonce-00000000000000000001',
        startedAt: 1,
      }
      const storage = createStorage({
        [key]: JSON.stringify({
          schemaVersion: 1,
          pending: markerState === 'pending' ? { [`${badRevisionKey}::editor-surface`]: marker } : {},
          quarantined: markerState === 'quarantined' ? { [badRevisionKey]: marker } : {},
        }),
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
          return artifactRef.sourceRevision === badRef.sourceRevision
            ? artifact(artifactRef, { source: revisedSource })
            : artifact(artifactRef)
        },
      })

      assert.equal(controller.getDiagnostics().state, 'idle')
      assert.equal(await controller.register(registration('bad', badRef)), false)
      assert.equal(await controller.register(registration('good')), true)
      assert.equal(await controller.update('bad', { node: node(ref()) }), true)
      assert.equal(reads, 2)
      assert.equal(hosts.calls.length, 1)
      assert.deepEqual([...hosts.hosts[0].instances.keys()].sort(), ['bad', 'good'])
      assert.equal(controller.clearQuarantine(), false)
      assert.deepEqual(JSON.parse(storage.values.get(key)), {
        schemaVersion: 1,
        pending: {},
        quarantined: { [badRevisionKey]: marker },
      })
    })
  }
})

test('a corrupt marker record fails closed until explicitly cleared', async () => {
  const key = createOnlineComponentSurfaceMarkerStorageKey({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
  })
  const storage = createStorage({ [key]: '{not-json' })
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
  assert.equal(await controller.register(registration('active')), true)
  assert.equal(reads, 1)
})

test('malformed marker keys and foreign surface identities fail closed without prototype mutation', async t => {
  const key = createOnlineComponentSurfaceMarkerStorageKey({
    projectId: 'project-a',
    branchId: 'main',
    surfaceId: 'editor-surface',
  })
  const revisionKey = runtimeRevisionKey(revisedSource)
  const marker = {
    state: 'pending',
    revisionKey,
    surfaceId: 'editor-surface',
    activationId: 'project-a:main:editor-surface',
    nonce: 'nonce-00000000000000000001',
    startedAt: 1,
  }
  const foreignMarker = {
    ...marker,
    surfaceId: 'preview-surface',
    activationId: 'project-a:main:preview-surface',
  }
  const cases = [
    ['non-canonical pending key', JSON.stringify({ schemaVersion: 1, pending: { alias: marker }, quarantined: {} })],
    [
      '__proto__ pending key',
      JSON.stringify({
        schemaVersion: 1,
        pending: Object.fromEntries([['__proto__', marker]]),
        quarantined: {},
      }),
    ],
    [
      'foreign surface identity',
      JSON.stringify({
        schemaVersion: 1,
        pending: { [`${revisionKey}::preview-surface`]: foreignMarker },
        quarantined: {},
      }),
    ],
    ['malformed pending map', JSON.stringify({ schemaVersion: 1, pending: [], quarantined: {} })],
  ]

  for (const [name, serialized] of cases) {
    await t.test(name, async () => {
      const storage = createStorage({ [key]: serialized })
      const hosts = createHostFactory()
      let reads = 0
      const prototypeRevision = Object.prototype.revisionKey
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
      assert.equal(Object.prototype.revisionKey, prototypeRevision)
      assert.equal(controller.clearQuarantine(), true)
      assert.equal(await controller.register(registration('recovered')), true)
    })
  }
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
