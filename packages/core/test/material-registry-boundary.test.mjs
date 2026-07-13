import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

function deepFreezePlain(value, visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return value
  visited.add(value)
  if (Array.isArray(value)) {
    value.forEach(item => deepFreezePlain(item, visited))
    return Object.freeze(value)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  Reflect.ownKeys(value).forEach(key => deepFreezePlain(value[key], visited))
  return Object.freeze(value)
}

function assertPlainGraphFrozen(value, path = '$', visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return
  visited.add(value)
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`)
  Reflect.ownKeys(value).forEach(key => assertPlainGraphFrozen(value[key], `${path}.${String(key)}`, visited))
}

function attemptMapMutation(map) {
  if (!map) return
  try {
    map.set('listener-poison', 'must-not-escape')
  } catch {}
  try {
    map.delete('owner')
  } catch {}
  try {
    map.clear()
  } catch {}
}

function shadowProperty(target, key, value) {
  const previous = Reflect.getOwnPropertyDescriptor(target, key)
  let applied = false
  try {
    applied = Reflect.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    })
  } catch {}
  return () => {
    if (!applied) return
    if (previous) Reflect.defineProperty(target, key, previous)
    else Reflect.deleteProperty(target, key)
  }
}

async function createReadyEngine(t) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  return { core, engine }
}

test('ComponentMeta owns deeply frozen metadata snapshots while preserving opaque component identity', async t => {
  const { engine } = await createReadyEngine(t)
  const view = function BoundaryView() {}
  const metadata = {
    componentName: 'MetadataBoundary',
    title: 'trusted title',
    tags: ['trusted'],
    npm: {
      componentName: 'MetadataBoundary',
      package: '@easy-editor/boundary',
      version: '1.0.0',
    },
    configure: {
      props: [
        {
          name: 'appearance',
          title: 'Appearance',
          extraProps: {
            defaultValue: { palette: { primary: 'blue' } },
          },
        },
      ],
      component: {
        disableBehaviors: ['copy'],
        isContainer: true,
      },
      supports: {
        events: ['click'],
        lifecycles: [{ name: 'mounted' }],
      },
      advanced: {
        initialChildren: [
          {
            componentName: 'Text',
            id: 'metadata-child',
            props: { text: 'trusted child' },
          },
        ],
        view,
      },
    },
    snippets: [
      {
        title: 'Trusted snippet',
        schema: {
          componentName: 'Text',
          id: 'metadata-snippet',
          props: { text: 'trusted snippet' },
        },
      },
    ],
  }

  const meta = engine.materials.registry.register(metadata)
  const storedBeforeCallerMutation = meta.getMetadata()

  assert.notStrictEqual(storedBeforeCallerMutation, metadata)
  assert.strictEqual(meta.advanced.view, view, 'executable component identities are opaque values, not cloned objects')
  assertPlainGraphFrozen(storedBeforeCallerMutation)
  assertPlainGraphFrozen(meta.configure, '$.configure.props')
  assertPlainGraphFrozen(meta.advanced, '$.configure.advanced')
  assertPlainGraphFrozen(meta.snippets, '$.snippets')
  assertPlainGraphFrozen(meta.npm, '$.npm')

  metadata.title = 'caller poison'
  metadata.tags.push('caller poison')
  metadata.npm.package = '@attacker/poison'
  metadata.configure.props[0].title = 'Caller poison'
  metadata.configure.props[0].extraProps.defaultValue.palette.primary = 'red'
  metadata.configure.component.disableBehaviors.push('remove')
  metadata.configure.supports.events.push('poison')
  metadata.configure.advanced.initialChildren[0].props.text = 'caller poison'
  metadata.snippets[0].schema.props.text = 'caller poison'

  assert.equal(meta.title, 'trusted title')
  assert.deepEqual(meta.getMetadata().tags, ['trusted'])
  assert.equal(meta.npm.package, '@easy-editor/boundary')
  assert.equal(meta.configure[0].title, 'Appearance')
  assert.equal(meta.configure[0].extraProps.defaultValue.palette.primary, 'blue')
  assert.deepEqual(meta.getMetadata().configure.component.disableBehaviors, ['copy'])
  assert.deepEqual(meta.getMetadata().configure.supports.events, ['click'])
  assert.equal(meta.advanced.initialChildren[0].props.text, 'trusted child')
  assert.equal(meta.snippets[0].schema.props.text, 'trusted snippet')
  assert.throws(() => {
    meta.configure[0].title = 'output poison'
  }, TypeError)
  assert.throws(() => {
    meta.advanced.initialChildren[0].props.text = 'output poison'
  }, TypeError)
  assert.throws(() => {
    meta.snippets.push({ title: 'output poison' })
  }, TypeError)
  assert.throws(() => {
    meta.npm.package = '@attacker/output-poison'
  }, TypeError)
})

test('material registry queries return frozen detached entry views whose maps cannot mutate backing state', async t => {
  const { core, engine } = await createReadyEngine(t)
  const component = function BoundaryComponent() {}
  const callerExtensions = new Map([
    ['owner', 'host'],
    ['capability', 'read-only'],
  ])
  const meta = engine.materials.registry.register(
    { componentName: 'DetachedEntryBoundary' },
    {
      component,
      extensions: callerExtensions,
      source: core.MaterialSource.REMOTE,
      version: '2.0.0',
    },
  )

  callerExtensions.delete('owner')
  callerExtensions.set('caller-poison', true)

  const direct = engine.materials.registry.get('DetachedEntryBoundary')
  const all = engine.materials.registry.getAll()
  const fromAll = all.get('DetachedEntryBoundary')
  const fromSource = engine.materials.registry.getBySource(core.MaterialSource.REMOTE)[0]

  for (const entry of [direct, fromAll, fromSource]) {
    assert.ok(entry)
    assert.equal(Object.isFrozen(entry), true)
    assert.strictEqual(entry.meta, meta)
    assert.strictEqual(entry.component, component)
    assert.deepEqual(
      [...entry.extensions],
      [
        ['owner', 'host'],
        ['capability', 'read-only'],
      ],
    )
    assert.equal(Reflect.set(entry, 'usageCount', 999), false)
    attemptMapMutation(entry.extensions)
  }

  try {
    all.clear()
  } catch {}
  try {
    all.set('forged', direct)
  } catch {}

  const fresh = engine.materials.registry.get('DetachedEntryBoundary')
  assert.equal(engine.materials.registry.has('DetachedEntryBoundary'), true)
  assert.equal(engine.materials.registry.has('forged'), false)
  assert.equal(fresh.usageCount, 0)
  assert.deepEqual(
    [...fresh.extensions],
    [
      ['owner', 'host'],
      ['capability', 'read-only'],
    ],
  )
})

test('material registration rejects accessors without invoking them or publishing partial state', async t => {
  const { engine } = await createReadyEngine(t)
  let metadataReads = 0
  let extensionReads = 0
  const accessorMetadata = { componentName: 'AccessorMetadataBoundary' }
  Object.defineProperty(accessorMetadata, 'title', {
    enumerable: true,
    get() {
      metadataReads += 1
      return 'must-not-run'
    },
  })
  assert.throws(() => engine.materials.registry.register(accessorMetadata), /cannot contain accessors/)
  assert.equal(metadataReads, 0)
  assert.equal(engine.materials.registry.has('AccessorMetadataBoundary'), false)

  const extensionValue = {}
  Object.defineProperty(extensionValue, 'secret', {
    enumerable: true,
    get() {
      extensionReads += 1
      return 'must-not-run'
    },
  })
  assert.throws(
    () =>
      engine.materials.registry.register(
        { componentName: 'AccessorExtensionBoundary' },
        { extensions: new Map([['owned', extensionValue]]) },
      ),
    /cannot contain accessors/,
  )
  assert.equal(extensionReads, 0)
  assert.equal(engine.materials.registry.has('AccessorExtensionBoundary'), false)

  const componentNameAccessor = {}
  Object.defineProperty(componentNameAccessor, 'componentName', {
    enumerable: true,
    get() {
      metadataReads += 1
      return 'must-not-run'
    },
  })
  assert.throws(
    () => engine.materials.registry.register(componentNameAccessor),
    /componentName must be an own data property/,
  )
  assert.equal(metadataReads, 0)
})

test('material registry listeners receive frozen event-time scalar snapshots isolated from one another and backing state', async t => {
  const { engine } = await createReadyEngine(t)
  engine.materials.registry.register(
    { componentName: 'EventSnapshotBoundary' },
    { extensions: new Map([['owner', 'host']]) },
  )
  const firstListenerEvents = []
  const secondListenerObservations = []

  const disposeFirst = engine.materials.registry.subscribe(event => {
    if (event.type !== 'usage_changed') return
    firstListenerEvents.push(event)
    Reflect.set(event, 'componentName', 'listener-poison')
    Reflect.set(event.entry, 'usageCount', 999)
    try {
      event.entry.extensionKeys.push('listener-poison')
    } catch {}
  })
  const disposeSecond = engine.materials.registry.subscribe(event => {
    if (event.type !== 'usage_changed') return
    secondListenerObservations.push({
      componentName: event.componentName,
      entryFrozen: Object.isFrozen(event.entry),
      eventFrozen: Object.isFrozen(event),
      extensionKeys: [...event.entry.extensionKeys],
      usageCount: event.entry.usageCount,
    })
  })
  t.after(disposeFirst)
  t.after(disposeSecond)

  engine.materials.registry.incrementUsage('EventSnapshotBoundary')

  assert.deepEqual(secondListenerObservations, [
    {
      componentName: 'EventSnapshotBoundary',
      entryFrozen: true,
      eventFrozen: true,
      extensionKeys: ['owner'],
      usageCount: 1,
    },
  ])
  assert.equal(engine.materials.registry.getUsageCount('EventSnapshotBoundary'), 1)
  assert.deepEqual([...engine.materials.registry.get('EventSnapshotBoundary').extensions], [['owner', 'host']])

  engine.materials.registry.incrementUsage('EventSnapshotBoundary')

  assert.equal(firstListenerEvents[0].entry.usageCount, 1, 'earlier events must not become live views')
  assert.deepEqual(
    secondListenerObservations.map(event => event.usageCount),
    [1, 2],
  )
  assert.equal(engine.materials.registry.getUsageCount('EventSnapshotBoundary'), 2)
})

test('reflective property shadows cannot replace material registry or ComponentMeta backing state', async t => {
  const { engine } = await createReadyEngine(t)
  const registry = engine.materials.registry
  const meta = registry.register({ componentName: 'ReflectiveBoundary', title: 'trusted' })
  const version = registry.version
  const forgedMeta = { componentName: 'forged-shadow' }
  const forgedEntry = {
    componentName: 'forged-shadow',
    lastAccessedAt: 0,
    loadedAt: 0,
    meta: forgedMeta,
    source: 'debug',
    status: 'active',
    usageCount: 999,
  }
  const forgedDesigner = {
    createEventBus() {
      throw new Error('reflective designer shadow escaped into ComponentMeta construction')
    },
    deferEvent() {
      throw new Error('reflective designer shadow escaped into event delivery')
    },
  }
  const restorers = [
    shadowProperty(engine.materials, '_registry', { has: () => true }),
    shadowProperty(registry, 'entries', new Map([['ForgedActiveShadow', forgedEntry]])),
    shadowProperty(registry, 'pendingEntries', new Map([['ForgedPendingShadow', forgedEntry]])),
    shadowProperty(registry, '_version', 999),
    shadowProperty(registry, 'designer', forgedDesigner),
    shadowProperty(meta, '_metadata', { componentName: 'forged-metadata', title: 'forged' }),
    shadowProperty(meta, 'designer', forgedDesigner),
  ]

  try {
    assert.strictEqual(engine.materials.registry, registry)
    assert.equal(registry.has('ReflectiveBoundary'), true)
    assert.equal(registry.has('ForgedActiveShadow'), false)
    assert.equal(registry.version, version)
    assert.equal(meta.getMetadata().componentName, 'ReflectiveBoundary')
    assert.equal(meta.title, 'trusted')

    const pending = registry.getOrCreate('LegitimatePending', () => ({ title: 'real pending' }))
    assert.equal(pending.componentName, 'LegitimatePending')
    assert.equal(registry.getOrCreate('ForgedPendingShadow').componentName, 'ForgedPendingShadow')

    const delivered = []
    const unsubscribe = registry.subscribe(event => delivered.push(event.componentName))
    registry.register({ componentName: 'AfterReflectiveShadow', title: 'real registration' })
    unsubscribe()
    assert.equal(registry.has('AfterReflectiveShadow'), true)
    assert.deepEqual(delivered, ['AfterReflectiveShadow'])
  } finally {
    restorers.reverse().forEach(restore => restore())
  }
})

test('frozen snippet and initialChildren schemas with duplicate ids create detached nodes without mutating schemas', async t => {
  const { engine } = await createReadyEngine(t)
  const metadata = deepFreezePlain({
    componentName: 'FrozenSchemaBoundary',
    configure: {
      component: { isContainer: true },
      advanced: {
        initialChildren: [
          {
            componentName: 'Text',
            id: 'duplicate-initial-child',
            props: { text: 'first' },
          },
          {
            componentName: 'Text',
            id: 'duplicate-initial-child',
            props: { text: 'second' },
          },
        ],
      },
    },
    snippets: [
      {
        title: 'Frozen duplicate snippet',
        schema: {
          componentName: 'Text',
          id: 'duplicate-snippet-node',
          props: { text: 'snippet' },
        },
      },
    ],
  })
  const meta = engine.materials.registry.register(metadata)
  const initialChildren = meta.advanced.initialChildren
  const snippetSchema = meta.snippets[0].schema

  assertPlainGraphFrozen(initialChildren, '$.configure.advanced.initialChildren')
  assertPlainGraphFrozen(snippetSchema, '$.snippets[0].schema')

  const document = engine.project.createDocument({
    componentName: 'FrozenSchemaBoundary',
    id: 'frozen-schema-root',
    props: {},
  })
  const childIds = document.root.children.children.map(child => child.id)

  assert.equal(childIds.length, 2)
  assert.equal(new Set(childIds).size, 2)
  assert.deepEqual(
    initialChildren.map(child => child.id),
    ['duplicate-initial-child', 'duplicate-initial-child'],
    'node creation must not rewrite frozen initialChildren schemas',
  )

  const firstSnippetNode = document.createNode(snippetSchema)
  const secondSnippetNode = document.createNode(snippetSchema)

  assert.notEqual(firstSnippetNode.id, secondSnippetNode.id)
  assert.equal(snippetSchema.id, 'duplicate-snippet-node', 'duplicate resolution must not rewrite the frozen snippet')
  assert.equal(Object.isFrozen(snippetSchema), true)
})
