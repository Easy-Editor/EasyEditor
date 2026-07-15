import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { coreBundleUrl, instanceBundleUrl, loadInstance } from './helpers/kernel.mjs'

const require = createRequire(import.meta.url)
const publicApi = JSON.parse(readFileSync(new URL('./fixtures/instance-public-api.json', import.meta.url), 'utf8'))

const assertRuntimePropertyIsPrivate = (value, property) => {
  assert.equal(property in value, false, `public engine must not make ${property} reachable`)
  assert.equal(value[property], undefined, `public engine must not resolve ${property}`)

  for (let owner = value; owner; owner = Object.getPrototypeOf(owner)) {
    assert.equal(
      Object.hasOwn(owner, property),
      false,
      `public engine must not declare ${property} on itself or its prototype chain`,
    )
  }
}

const readDeclaredInstanceExports = () => {
  const sourceUrl = new URL('../src/instance.ts', import.meta.url)
  const source = ts.createSourceFile(
    fileURLToPath(sourceUrl),
    readFileSync(sourceUrl, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const names = []
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      assert.ok(
        statement.exportClause && ts.isNamedExports(statement.exportClause),
        'the framework entry must never use wildcard exports',
      )
      for (const element of statement.exportClause.elements) names.push(element.name.text)
      continue
    }

    const isLocallyExported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    if (!isLocallyExported) continue
    if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.push(statement.name.text)
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        assert.ok(ts.isIdentifier(declaration.name), 'framework exports must have explicit identifier names')
        names.push(declaration.name.text)
      }
      continue
    }
    assert.fail('framework exports must be statically nameable by the reviewed API fixture')
  }
  return [...new Set(names)].sort()
}

test('the legacy root and factory-owned instance entry have one construction path each', async () => {
  const legacy = await import(coreBundleUrl().href)
  const instance = await loadInstance()
  const instanceCjs = require(fileURLToPath(instanceBundleUrl()).replace(/\.js$/, '.cjs'))

  assert.equal('createEngine' in legacy, false, 'the legacy root must not expose the v2 instance factory')
  assert.equal('EngineInstance' in legacy, false, 'the legacy root must not expose the engine implementation')
  assert.equal('EngineInstance' in instance, false, 'EngineInstance is a public interface, not a constructor')
  assert.deepEqual(readDeclaredInstanceExports(), publicApi.all, 'the reviewed source API allowlist must not drift')
  assert.deepEqual(Object.keys(instance).sort(), publicApi.runtime, 'the reviewed runtime API allowlist must not drift')
  assert.deepEqual(Object.keys(instanceCjs).sort(), publicApi.runtime, 'ESM and CJS exports must match exactly')

  for (const internalName of [
    'AgentCapabilityManager',
    'AgentPortHostSession',
    'DisposalLedger',
    'PluginRuntime',
    'defaultEngine',
    'establishRestrictedPluginBoundary',
  ]) {
    assert.equal(internalName in instance, false, `the framework entry must not export ${internalName}`)
  }
})

test('the instance entry is a complete black-box lifecycle and transaction boundary', async t => {
  const { createEngine } = await loadInstance()
  const first = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  const second = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(async () => {
    await Promise.allSettled([first.destroy(), second.destroy()])
  })

  await Promise.all([first.init(), second.init()])
  first.loadProject(createProjectSchema({ id: 'framework-first' }), true)
  second.loadProject(createProjectSchema({ id: 'framework-second' }), true)

  const firstDocument = first.project.currentDocument
  const secondDocument = second.project.currentDocument
  assert.ok(firstDocument?.root)
  assert.ok(secondDocument?.root)
  const firstRootId = firstDocument.root.id
  assert.notStrictEqual(first.project, second.project)
  assert.notStrictEqual(first.materials, second.materials)
  assert.notStrictEqual(first.plugins, second.plugins)

  first.transactions.runOnDocument(firstDocument, [
    { type: 'updateProps', nodeId: firstDocument.root.id, props: { title: 'first committed' } },
  ])
  assert.equal(firstDocument.root.getPropValue('title'), 'first committed')
  assert.notEqual(secondDocument.root.getPropValue('title'), 'first committed')

  assert.throws(
    () =>
      first.transactions.runOnDocument(firstDocument, [
        { type: 'updateProps', nodeId: firstDocument.root.id, props: { title: 'must roll back' } },
        { type: 'removeNode', nodeId: 'missing-node' },
      ]),
    /missing-node|not found/i,
  )
  assert.equal(firstDocument.root.getPropValue('title'), 'first committed')

  await first.destroy()
  second.commands.execute({
    type: 'updateProps',
    nodeId: secondDocument.root.id,
    props: { title: 'second remains live' },
  })
  assert.equal(secondDocument.root.getPropValue('title'), 'second remains live')

  await first.init()
  first.loadProject(createProjectSchema({ id: 'framework-first-restarted' }), true)
  assert.throws(
    () =>
      first.transactions.runOnDocument(firstDocument, [
        { type: 'updateProps', nodeId: firstRootId, props: { title: 'stale write' } },
      ]),
    /does not belong|disposed|stale/i,
  )
})

test('the public instance runtime does not expose package-private authority', async t => {
  const { createEngine } = await loadInstance()
  const engine = createEngine({ hostWindow: null })
  t.after(() => engine.destroy())

  assert.equal(engine.trustPolicy.name, 'agentRestricted', 'the public factory must default to the restricted policy')
  assert.equal(
    engine.constructor,
    undefined,
    'the concrete engine constructor must not be recoverable from an instance',
  )

  for (const property of [
    'innerPlugins',
    'agentCapabilities',
    'assertTrustBoundaryIntegrity',
    'assertRemoteAccess',
    'assertLifecycleMutationAllowed',
    'eventTransactions',
    'hostWindow',
    'remoteAdapter',
    'initialize',
    'disposeEngine',
    'assertPluginExtensionsAllowed',
    'ensureRestrictedPluginBoundary',
    'releaseRestrictedPluginBoundary',
    'disposeRemoteAdapter',
    'resolveHostWindow',
    'runHostModelMutation',
    'resolveOwnedDocument',
    'wireEditorContext',
    'claimLifecycleMutationOwnership',
  ]) {
    assertRuntimePropertyIsPrivate(engine, property)
  }

  assert.deepEqual(Reflect.ownKeys(engine.transactions), [])
  assert.deepEqual(Reflect.ownKeys(engine.commands), [])
  assert.equal(Object.isFrozen(engine.transactions), true)
  assert.equal(Object.isFrozen(engine.commands), true)
  assert.equal(Object.isFrozen(Object.getPrototypeOf(engine.transactions)), true)
  assert.equal(Object.isFrozen(Object.getPrototypeOf(engine.commands)), true)
  assert.equal(engine.transactions.constructor, undefined)
  assert.equal(engine.commands.constructor, undefined)
  for (const property of [
    'active',
    'events',
    'host',
    'withTransaction',
    'executeCommands',
    'runOnDocumentInternal',
    'begin',
    'commit',
    'rollback',
  ]) {
    assertRuntimePropertyIsPrivate(engine.transactions, property)
  }
  assertRuntimePropertyIsPrivate(engine.commands, 'transactions')

  assert.equal(engine.designer.get('eventDelivery'), undefined)
  for (const property of ['deferEvent', 'emitter', 'eventDelivery', 'props']) {
    assertRuntimePropertyIsPrivate(engine.designer, property)
  }
  for (const property of ['emitImmediately', 'scheduleDelivery', 'setDeliveryScheduler']) {
    assertRuntimePropertyIsPrivate(engine.eventBus, property)
  }
})

test('the public plugin capability cannot reflect or mutate manager internals', async t => {
  const { createEngine } = await loadInstance()
  const engine = createEngine({ hostWindow: null })
  t.after(() => engine.destroy())

  let pluginContext
  await engine.plugins.register({
    name: 'public-facade-proof',
    exports: () => ({ ping: () => 'pong' }),
    init(context) {
      pluginContext = context
    },
  })
  const facade = engine.plugins
  assert.deepEqual(Reflect.ownKeys(facade).sort(), [
    'delete',
    'get',
    'getAll',
    'getExports',
    'has',
    'register',
    'registerPlugins',
    'setDisabled',
    'size',
  ])
  assert.equal(Object.getPrototypeOf(facade), null)
  assert.equal(Object.isFrozen(facade), true)

  for (const property of [
    'plugins',
    'registeredPlugins',
    'pluginContexts',
    'pluginsMap',
    'pluginContextMap',
    'structuralReservations',
    'structuralOperations',
    'contextApiAssembler',
    'contextOptions',
    'assembler',
    'init',
    'destroy',
    'dispose',
    'extend',
    'preflight',
    'toProxy',
  ]) {
    assertRuntimePropertyIsPrivate(facade, property)
  }

  assert.throws(() => Object.defineProperty(facade, 'registeredPlugins', { value: new Map() }), TypeError)
  assert.equal(facade.has('public-facade-proof'), true)
  const snapshot = facade.get('public-facade-proof')
  assert.deepEqual(Reflect.ownKeys(snapshot).sort(), ['dependencies', 'disabled', 'extended', 'initialized', 'name'])
  assert.equal(Object.getPrototypeOf(snapshot), null)
  assert.equal(Object.isFrozen(snapshot), true)
  for (const property of ['ctx', 'config', 'init', 'destroy', 'extend', 'dispose', 'toProxy', 'constructor']) {
    assertRuntimePropertyIsPrivate(snapshot, property)
  }
  const snapshots = facade.getAll()
  assert.equal(Object.isFrozen(snapshots), true)
  assert.throws(() => snapshots.push(snapshot), TypeError)

  const exports = facade.getExports('public-facade-proof')
  assert.equal(exports.ping(), 'pong')
  assert.equal(Object.getPrototypeOf(exports), null)
  assert.equal(Object.isFrozen(exports), true)
  for (const property of ['ctx', 'config', 'init', 'destroy', 'extend', 'dispose', 'toProxy', 'constructor']) {
    assertRuntimePropertyIsPrivate(exports, property)
  }
  assert.strictEqual(
    facade['public-facade-proof'],
    exports,
    'named plugin access resolves only the lifecycle-bound exports facade',
  )

  await engine.init()
  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(pluginContext.engine, undefined, 'restricted plugins do not receive the host engine')
  assert.deepEqual(Reflect.ownKeys(pluginContext.plugins).sort(), ['get', 'getAll', 'getExports', 'has', 'size'])
  for (const property of ['register', 'registerPlugins', 'delete', 'setDisabled']) {
    assertRuntimePropertyIsPrivate(pluginContext.plugins, property)
  }
})

test('restricted plugin registries preserve reviewed exports and revoke them with their generation', async () => {
  const { createEngine } = await loadInstance()
  const engine = createEngine({ hostWindow: null })
  let providerExports

  try {
    await engine.plugins.register({
      name: 'restricted-exports-provider',
      exports: () => ({
        marker: 'ok',
        payload: { count: 1, nested: { enabled: true } },
      }),
      init() {},
    })
    await engine.plugins.register({
      name: 'restricted-exports-consumer',
      deps: ['restricted-exports-provider'],
      init(context) {
        providerExports = context.plugins.getExports('restricted-exports-provider')
        assert.equal(providerExports.marker, 'ok')
        assert.equal(providerExports.payload.count, 1)
        assert.equal(providerExports.payload.nested.enabled, true)
      },
    })

    await engine.init()
    assert.equal(providerExports.marker, 'ok')
    assert.equal(providerExports.payload.count, 1)

    await engine.destroy()
    assert.throws(() => providerExports.marker, /disposed|stale|lifecycle|generation/i)
    assert.throws(() => providerExports.payload, /disposed|stale|lifecycle|generation/i)
  } finally {
    await engine.destroy().catch(() => {})
  }
})

test('restricted plugin roots expose only the reviewed finite capability surface', async t => {
  const { assertLegacyTrustedPluginContext, createEngine } = await loadInstance()
  const engine = createEngine({ hostWindow: null })
  let context
  t.after(() => engine.destroy())

  await engine.plugins.register({
    name: 'finite-context-proof',
    init(pluginContext) {
      context = pluginContext
    },
  })
  await engine.init()
  assert.throws(
    () => assertLegacyTrustedPluginContext(context),
    /legacyTrusted PluginContext/,
    'a restricted context cannot be widened to raw host services',
  )

  const expectedKeys = {
    clipboard: ['initCopyPaster', 'injectCopyPaster', 'isCopyPasteEvent', 'setData', 'waitPasteData'],
    config: ['get', 'has', 'onGot', 'onceGot', 'set', 'setConfig'],
    event: ['emit', 'off', 'on', 'prependListener'],
    hotkey: ['acquireBinding', 'activate', 'bind', 'callBacks', 'unbind'],
    logger: ['debug', 'error', 'info', 'log', 'warn'],
    materials: [
      'buildComponentMetasMap',
      'canUnload',
      'componentMetasMap',
      'componentsMap',
      'createComponentMeta',
      'decrementUsage',
      'getComponentMeta',
      'getComponentMetasMap',
      'getComponentSnippets',
      'getUsageCount',
      'incrementUsage',
      'isComponentMeta',
      'refreshComponentMetasMap',
      'removeComponentMeta',
      'version',
    ],
    project: ['allowsDirectModelMutation', 'config', 'export', 'get'],
    setters: ['createSetterContent', 'getSetter', 'getSettersMap', 'registerSetter', 'settersMap'],
  }
  for (const [name, keys] of Object.entries(expectedKeys)) {
    assert.deepEqual(
      Reflect.ownKeys(context[name]).sort(),
      keys.sort(),
      `${name} must remain an explicit finite facade`,
    )
    assert.equal(Object.getPrototypeOf(context[name]), null)
  }

  const hotkeyCallback = () => {}
  const hotkeyLease = context.hotkey.acquireBinding('mod+shift+l', hotkeyCallback)
  assert.equal(typeof hotkeyLease, 'function')
  hotkeyLease()
  const chainedHotkey = context.hotkey.bind('mod+shift+e', hotkeyCallback)
  assert.strictEqual(chainedHotkey, context.hotkey, 'Hotkey chaining must retain the finite facade')
  assertRuntimePropertyIsPrivate(chainedHotkey, 'mount')
  assert.equal(context.hotkey.unbind('mod+shift+e', hotkeyCallback), undefined)

  for (const [capability, properties] of Object.entries({
    config: ['waits', 'setEngineOptions'],
    event: ['eventBus'],
    materials: ['designer', 'dispose', 'editor', 'registry'],
    project: ['designer', 'documents', 'emitter', 'load', 'unload'],
  })) {
    for (const property of properties) assertRuntimePropertyIsPrivate(context[capability], property)
  }
})

test('legacy raw plugin services require an explicit trust-policy assertion', async t => {
  const { assertLegacyTrustedPluginContext, createEngine } = await loadInstance()
  const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  let legacyContext
  t.after(() => engine.destroy())

  await engine.plugins.register({
    name: 'legacy-context-proof',
    init(context) {
      assertLegacyTrustedPluginContext(context)
      legacyContext = context
    },
  })
  await engine.init()

  assert.equal(legacyContext.trustPolicy.name, 'legacyTrusted')
  assert.equal(typeof legacyContext.project.designer.onEvent, 'function')
  assert.equal(typeof legacyContext.materials.editor.get, 'function')
})

test('restricted plugins receive a usable finite view of engine-owned component metadata', async t => {
  const { createEngine } = await loadInstance()
  const engine = createEngine({ hostWindow: null })
  let componentMeta
  let fetchedMeta
  let mappedMeta
  let context
  t.after(() => engine.destroy())

  await engine.plugins.register({
    name: 'component-meta-capability-proof',
    init(pluginContext) {
      context = pluginContext
      componentMeta = context.materials.createComponentMeta({
        componentName: 'FinitePluginMaterial',
        title: 'Finite plugin material',
      })
      fetchedMeta = context.materials.getComponentMeta('FinitePluginMaterial')
      mappedMeta = context.materials.getComponentMetasMap().get('FinitePluginMaterial')
    },
  })
  await engine.init()

  assert.ok(componentMeta)
  assert.strictEqual(fetchedMeta, componentMeta)
  assert.strictEqual(mappedMeta, componentMeta)
  assert.equal(componentMeta.componentName, 'FinitePluginMaterial')
  assert.equal(componentMeta.title, 'Finite plugin material')
  assert.equal(componentMeta.getMetadata().componentName, 'FinitePluginMaterial')
  assert.equal(componentMeta.isRemoteMaterial(), false)
  assert.equal(context.materials.isComponentMeta(componentMeta), true)
  assert.equal(Object.getPrototypeOf(componentMeta), null)
  assertRuntimePropertyIsPrivate(componentMeta, 'dispose')

  await engine.destroy()
  assert.throws(() => componentMeta.componentName, /disposed|stale|lifecycle|generation/i)
})

test('restricted callback membranes keep dynamic engine-owned runtimes opaque', async t => {
  const { Simulator, createEngine } = await loadInstance()
  const engine = createEngine({
    hostWindow: null,
    trustPolicy: {
      name: 'agentRestricted',
      allowDirectModelMutation: true,
      allowExecutableCommands: false,
      allowExecutableSchema: false,
      allowPluginExtensions: false,
      allowRemoteAccess: false,
    },
  })
  let documentView
  let historyView
  let simulatorView
  let documentHistoryMutationAvailable
  let historyMutationAvailable
  let simulatorMutationAvailable
  t.after(() => engine.destroy())

  await engine.plugins.register({
    name: 'dynamic-runtime-membrane-proof',
    init(context) {
      context.event.on('common:raw-document', value => {
        documentView = value
        documentHistoryMutationAvailable = typeof value.history?.savePoint === 'function'
        value.history?.savePoint?.()
      })
      context.event.on('common:raw-history', value => {
        historyView = value
        historyMutationAvailable = typeof value.savePoint === 'function'
        value.savePoint?.()
      })
      context.event.on('common:raw-simulator', value => {
        simulatorView = value
        simulatorMutationAvailable = typeof value.set === 'function'
        value.set?.('designMode', 'forged')
      })
    },
  })
  await engine.init()
  engine.loadProject(createProjectSchema({ id: 'dynamic-runtime-membrane' }), true)
  const document = engine.project.currentDocument
  engine.commands.execute({
    type: 'updateProps',
    nodeId: document.root.id,
    props: { title: 'host remains authoritative' },
  })
  assert.equal(document.history.isModified(), true)

  const simulator = new Simulator(engine.project, engine.designer)
  engine.eventBus.emit('common:raw-document', document)
  engine.eventBus.emit('common:raw-history', document.history)
  // The simulator is deliberately emitted before Project.mountSimulator().
  // Construction itself must already establish the engine owner.
  engine.eventBus.emit('common:raw-simulator', simulator)

  assert.equal(documentHistoryMutationAvailable, false)
  assert.equal(historyMutationAvailable, false)
  assert.equal(simulatorMutationAvailable, false)
  assert.deepEqual(Reflect.ownKeys(documentView), [])
  assert.deepEqual(Reflect.ownKeys(historyView), [])
  assert.deepEqual(Reflect.ownKeys(simulatorView), [])
  for (const property of ['export', 'history', 'root', 'setActive']) {
    assertRuntimePropertyIsPrivate(documentView, property)
  }
  for (const property of ['back', 'forward', 'getState', 'savePoint']) {
    assertRuntimePropertyIsPrivate(historyView, property)
  }
  for (const property of ['connect', 'project', 'purge', 'set', 'setProps', 'viewport']) {
    assertRuntimePropertyIsPrivate(simulatorView, property)
  }
  assert.equal(document.history.isModified(), true, 'plugin callbacks cannot clear the host history save point')
  assert.notEqual(simulator.get('designMode'), 'forged', 'plugin callbacks cannot mutate the host simulator')
  engine.project.mountSimulator(simulator)
})

test('restricted callback membranes keep model-owned mutable collections opaque', async t => {
  const { createEngine } = await loadInstance()
  const engine = createEngine({
    hostWindow: null,
    trustPolicy: {
      name: 'agentRestricted',
      allowDirectModelMutation: true,
      allowExecutableCommands: false,
      allowExecutableSchema: false,
      allowPluginExtensions: false,
      allowRemoteAccess: false,
    },
  })
  const collectionViews = new Map()
  t.after(() => engine.destroy())

  await engine.plugins.register({
    name: 'model-collection-membrane-proof',
    init(context) {
      for (const name of ['children', 'documents', 'items', 'nodes-map']) {
        context.event.on(`common:raw-${name}`, value => {
          collectionViews.set(name, value)
          value.pop?.()
          value.clear?.()
        })
      }
      context.event.on('common:business-array', value => value.push('plugin'))
      context.event.on('common:business-map', value => value.set('plugin', 2))
    },
  })
  await engine.init()
  const schema = createProjectSchema({
    componentsTree: [
      {
        children: [{ componentName: 'Text', id: 'child', props: { value: 'before' } }],
        componentName: 'Page',
        docId: 'page-1',
        id: 'root',
        props: { title: 'before' },
      },
    ],
  })
  engine.loadProject(schema, true)

  const document = engine.project.currentDocument
  const root = document.root
  const before = {
    children: root.children.children.length,
    documents: engine.project.documents.length,
    items: root.props.items.length,
    nodes: document.nodesMap.size,
  }
  const businessArray = ['host']
  const businessMap = new Map([['host', 1]])

  for (const [name, value] of [
    ['children', root.children.children],
    ['documents', engine.project.documents],
    ['items', root.props.items],
    ['nodes-map', document.nodesMap],
  ]) {
    engine.eventBus.emit(`common:raw-${name}`, value)
  }
  engine.eventBus.emit('common:business-array', businessArray)
  engine.eventBus.emit('common:business-map', businessMap)

  assert.equal(root.children.children.length, before.children)
  assert.equal(engine.project.documents.length, before.documents)
  assert.equal(root.props.items.length, before.items)
  assert.equal(document.nodesMap.size, before.nodes)
  for (const view of collectionViews.values()) assert.deepEqual(Reflect.ownKeys(view), [])
  assert.deepEqual(businessArray, ['host', 'plugin'])
  assert.equal(businessMap.get('plugin'), 2)
})

test('restricted array callbacks wrap authority-bearing elements without breaking scalar iteration', async t => {
  const { createEngine } = await loadInstance()
  const engine = createEngine({
    hostWindow: null,
    trustPolicy: {
      name: 'agentRestricted',
      allowDirectModelMutation: true,
      allowExecutableCommands: false,
      allowExecutableSchema: false,
      allowPluginExtensions: false,
      allowRemoteAccess: false,
    },
  })
  const views = new Map()
  let scalarResult
  let callbackThisMarker
  t.after(() => engine.destroy())

  await engine.plugins.register({
    name: 'array-callback-membrane-proof',
    init(context) {
      context.event.on('common:authority-array', payload => {
        views.set('direct', payload[0])
        payload.map(value => {
          views.set('map', value)
          value.documents?.pop?.()
          return value
        })
        payload.find(value => {
          views.set('find', value)
          value.documents?.pop?.()
          return true
        })
        payload.reduce((count, value) => {
          views.set('reduce', value)
          value.documents?.pop?.()
          return count + 1
        }, 0)
      })
      context.event.on('common:scalar-array', payload => {
        const thisArg = { marker: 'preserved' }
        scalarResult = payload.map(function (value) {
          callbackThisMarker = this.marker
          return value * 2
        }, thisArg)
      })
    },
  })
  await engine.init()
  engine.loadProject(createProjectSchema({ id: 'array-callback-membrane' }), true)
  const documentCount = engine.project.documents.length

  engine.eventBus.emit('common:authority-array', [engine.project])
  engine.eventBus.emit('common:scalar-array', [1, 2, 3])

  assert.equal(engine.project.documents.length, documentCount)
  for (const view of views.values()) {
    assert.equal(view.documents, undefined)
    assert.deepEqual(Reflect.ownKeys(view), [])
  }
  assert.deepEqual([...scalarResult], [2, 4, 6])
  assert.equal(callbackThisMarker, 'preserved')
})

test('restricted callback membranes reject dynamic authority owned by every engine', async t => {
  const { createEngine } = await loadInstance()
  const first = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  const second = createEngine({ hostWindow: null })
  const foreignViews = new Map()
  t.after(async () => Promise.allSettled([first.destroy(), second.destroy()]))

  await second.plugins.register({
    name: 'foreign-runtime-membrane-proof',
    init(context) {
      for (const name of ['commands', 'component-meta', 'document', 'engine', 'history', 'remote', 'transactions']) {
        context.event.on(`common:foreign-${name}`, value => {
          foreignViews.set(name, value)
          value.destroy?.()
          value.history?.savePoint?.()
          value.execute?.({
            type: 'updateProps',
            nodeId: 'root',
            props: { title: 'foreign plugin write' },
          })
        })
      }
    },
  })
  await Promise.all([first.init(), second.init()])
  first.loadProject(createProjectSchema({ id: 'foreign-owner-first' }), true)
  const firstDocument = first.project.currentDocument
  first.commands.execute({
    type: 'updateProps',
    nodeId: firstDocument.root.id,
    props: { title: 'first host write' },
  })
  const firstComponentMeta = first.materials.createComponentMeta({ componentName: 'ForeignOwnedMeta' })
  assert.equal(firstDocument.history.isModified(), true)

  for (const [name, value] of [
    ['commands', first.commands],
    ['component-meta', firstComponentMeta],
    ['document', firstDocument],
    ['engine', first],
    ['history', firstDocument.history],
    ['remote', first.remote],
    ['transactions', first.transactions],
  ]) {
    second.eventBus.emit(`common:foreign-${name}`, value)
  }

  for (const [name, view] of foreignViews) {
    assert.deepEqual(Reflect.ownKeys(view), [], `foreign ${name} must not become a plugin capability`)
  }
  assert.equal(first.lifecycleState, 'ready')
  assert.equal(firstDocument.history.isModified(), true)
  assert.equal(firstDocument.root.getPropValue('title'), 'first host write')
})

test('restricted callback membranes preserve business keys while denying actual host authority references', async () => {
  const { createEngine } = await loadInstance()
  const engine = createEngine({ hostWindow: null })
  let businessPayloadView
  let authorityPayloadView
  let callbackThis
  let rawEngineView
  let hostConfigDeliveries = 0
  let hostEventDeliveries = 0
  const releaseHostWaiter = engine.config.onGot('host-wait-integrity', () => {
    hostConfigDeliveries += 1
  })
  const releaseHostEvent = engine.eventBus.on('common:host-probe', () => {
    hostEventDeliveries += 1
  })

  try {
    await engine.plugins.register({
      name: 'callback-membrane-proof',
      init(context) {
        context.event.on('common:business-payload', payload => {
          businessPayloadView = payload
        })
        context.event.on('common:authority-payload', payload => {
          authorityPayloadView = payload
        })
        context.event.on('common:raw-engine', payload => {
          rawEngineView = payload
        })
        context.event.on('common:callback-this', function () {
          callbackThis = this
          this?.removeAllListeners?.()
        })
      },
    })
    await engine.init()

    const businessPayload = {
      designer: { label: 'ordinary designer data' },
      editor: 'ordinary editor data',
      project: { id: 'ordinary-project-data' },
      registry: ['ordinary', 'registry', 'data'],
      waits: 3,
    }
    engine.eventBus.emit('common:business-payload', businessPayload)
    engine.eventBus.emit('common:authority-payload', {
      eventBus: engine.eventBus,
      commands: engine.commands,
      materials: engine.materials,
      project: engine.project,
      registry: engine.remote.registry,
      transactions: engine.transactions,
    })
    engine.eventBus.emit('common:raw-engine', engine)
    engine.eventBus.emit('common:callback-this')
    engine.eventBus.emit('common:host-probe')
    engine.config.set('host-wait-integrity', true)

    assert.notStrictEqual(businessPayloadView, businessPayload)
    assert.deepEqual(Reflect.ownKeys(businessPayloadView).sort(), Reflect.ownKeys(businessPayload).sort())
    assert.equal(businessPayloadView.project.id, 'ordinary-project-data')
    assert.equal(businessPayloadView.editor, 'ordinary editor data')
    assert.equal(businessPayloadView.waits, 3)

    for (const property of ['commands', 'eventBus', 'materials', 'project', 'registry', 'transactions']) {
      assertRuntimePropertyIsPrivate(authorityPayloadView, property)
    }
    assert.deepEqual(Reflect.ownKeys(rawEngineView), [], 'a callback cannot turn the raw Engine into a capability')
    for (const property of [
      'commands',
      'destroy',
      'init',
      'loadProject',
      'plugins',
      'remote',
      'transactions',
      'undo',
      'unloadProject',
    ]) {
      assertRuntimePropertyIsPrivate(rawEngineView, property)
    }
    assert.equal(hostConfigDeliveries, 1, 'restricted plugins cannot corrupt the host Config waiter registry')
    assert.equal(callbackThis, undefined, 'host callback receivers are not plugin capabilities')
    assert.equal(hostEventDeliveries, 1, 'a plugin callback cannot clear the host event scheduler')

    await engine.destroy()
    assert.throws(() => businessPayloadView.project, /disposed|stale|lifecycle|generation/i)
  } finally {
    releaseHostEvent()
    releaseHostWaiter()
    await engine.destroy().catch(() => {})
  }
})

test('plugin context capability slots cannot be intercepted before the lifecycle membrane is installed', async t => {
  const legacy = await import(coreBundleUrl().href)
  const { createEngine } = await loadInstance()
  const capabilityNames = [
    'engine',
    'clipboard',
    'trustPolicy',
    'project',
    'setters',
    'materials',
    'event',
    'hotkey',
    'config',
    'plugins',
    'logger',
    'pluginEvent',
  ]
  const originalDescriptors = new Map(
    capabilityNames.map(name => [name, Object.getOwnPropertyDescriptor(legacy.PluginContext.prototype, name)]),
  )
  const intercepted = []
  let engine

  try {
    for (const name of capabilityNames) {
      Object.defineProperty(legacy.PluginContext.prototype, name, {
        configurable: true,
        get() {
          return undefined
        },
        set(value) {
          intercepted.push({ name, receiver: this, value })
        },
      })
    }

    let retainedConfig
    engine = createEngine({ hostWindow: null })
    await engine.plugins.register({
      name: 'context-slot-proof',
      init(context) {
        retainedConfig ||= context.config
        assert.notStrictEqual(context.config, engine.config)
        assert.equal(context.engine, undefined)
      },
    })
    await engine.init()
    assert.deepEqual(intercepted, [], 'host capabilities must be written only to own context slots')

    await engine.destroy()
    await engine.init()
    assert.throws(() => retainedConfig.set('stale-context-slot-write', true), /disposed|stale|lifecycle|generation/i)
    assert.deepEqual(intercepted, [], 'restarting the engine must not use inherited capability accessors')
  } finally {
    if (engine) await engine.destroy().catch(() => {})
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(legacy.PluginContext.prototype, name, descriptor)
      else Reflect.deleteProperty(legacy.PluginContext.prototype, name)
    }
  }

  t.after(() => engine?.destroy())
})

test('one restricted plugin cannot redirect a later plugin context through the shared legacy prototype', async () => {
  const legacy = await import(coreBundleUrl().href)
  const { createEngine } = await loadInstance()
  const prototype = legacy.PluginContext.prototype
  const originalOnDispose = Object.getOwnPropertyDescriptor(prototype, 'onDispose')
  const intercepted = []
  let disposerCalls = 0
  let engine

  try {
    engine = createEngine({ hostWindow: null })
    await engine.plugins.registerPlugins([
      {
        name: 'context-prototype-writer',
        init(context) {
          Object.defineProperty(Object.getPrototypeOf(context), 'onDispose', {
            configurable: true,
            get() {
              intercepted.push(this)
              return disposer => intercepted.push(disposer)
            },
          })
        },
      },
      {
        name: 'context-prototype-reader-proof',
        deps: ['context-prototype-writer'],
        init(context) {
          context.onDispose(() => {
            disposerCalls += 1
          })
        },
      },
    ])

    await engine.init()
    assert.deepEqual(intercepted, [], 'later contexts must pin disposal through the package-private operation table')
    await engine.destroy()
    assert.equal(disposerCalls, 1, 'the later plugin must retain its own cleanup registration')
  } finally {
    if (engine) await engine.destroy().catch(() => {})
    if (originalOnDispose) Object.defineProperty(prototype, 'onDispose', originalOnDispose)
    else Reflect.deleteProperty(prototype, 'onDispose')
  }
})

test('restricted capability facades deny structural write-through and raw prototype recovery across restart', async () => {
  const { createEngine } = await loadInstance()
  const engine = createEngine({ hostWindow: null })
  let capturedRawConfig
  let checked = false

  try {
    await engine.plugins.register({
      name: 'capability-structure-proof',
      init(context) {
        if (checked) return
        checked = true
        const replacement = function ReplacementSetEngineOptions() {
          capturedRawConfig = this
        }
        assert.equal(Object.getPrototypeOf(context.config), null)
        assert.equal(context.config.constructor, undefined)
        assert.equal(context.config.__defineGetter__, undefined)
        assert.equal('__defineSetter__' in context.config, false)
        assert.equal(Reflect.set(context.config, 'setEngineOptions', replacement), false)
        assert.equal(
          Reflect.defineProperty(context.config, 'setEngineOptions', {
            configurable: true,
            value: replacement,
            writable: true,
          }),
          false,
        )
        assert.equal(Reflect.deleteProperty(context.config, 'setEngineOptions'), false)
        assert.equal(Reflect.setPrototypeOf(context.config, { setEngineOptions: replacement }), false)
      },
    })

    await engine.init()
    await engine.destroy()
    await engine.init({ designMode: 'design' })
    assert.equal(engine.config.get('designMode'), 'design')
    assert.equal(capturedRawConfig, undefined, 'a prior generation must not install a raw-receiver callback')
  } finally {
    await engine.destroy().catch(() => {})
  }
})

test('plugin export membership checks are revoked on delete and engine disposal', async () => {
  const { createEngine } = await loadInstance()
  const engine = createEngine({ hostWindow: null })
  const calls = { deleted: 0, disposed: 0 }

  try {
    for (const name of Object.keys(calls)) {
      await engine.plugins.register({
        name: `exports-${name}`,
        exports() {
          calls[name] += 1
          return { ping: () => 'pong' }
        },
        init() {},
      })
    }
    const deletedExports = engine.plugins.getExports('exports-deleted')
    const disposedExports = engine.plugins.getExports('exports-disposed')
    assert.equal('ping' in deletedExports, true)
    assert.equal('ping' in disposedExports, true)

    await engine.plugins.delete('exports-deleted')
    const deletedCalls = calls.deleted
    assert.throws(() => 'ping' in deletedExports, /deleted|disposed|stale|lifecycle|generation/i)
    assert.equal(calls.deleted, deletedCalls)

    await engine.destroy()
    const disposedCalls = calls.disposed
    assert.throws(() => 'ping' in disposedExports, /disposed|stale|lifecycle|generation/i)
    assert.equal(calls.disposed, disposedCalls)
  } finally {
    await engine.destroy().catch(() => {})
  }
})

test('the instance entry does not dispatch framework operations through legacy plugin prototypes', async () => {
  const legacy = await import(coreBundleUrl().href)
  const { createEngine } = await loadInstance()
  const intercepted = []
  const restorations = []
  let engine

  const replaceMethod = (prototype, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
    restorations.push(() => {
      if (descriptor) Object.defineProperty(prototype, name, descriptor)
      else Reflect.deleteProperty(prototype, name)
    })
    Object.defineProperty(prototype, name, {
      configurable: true,
      value() {
        intercepted.push({ name, receiver: this })
        throw new Error(`legacy prototype method was invoked: ${name}`)
      },
      writable: true,
    })
  }
  const replaceGetter = (prototype, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
    restorations.push(() => {
      if (descriptor) Object.defineProperty(prototype, name, descriptor)
      else Reflect.deleteProperty(prototype, name)
    })
    Object.defineProperty(prototype, name, {
      configurable: true,
      get() {
        intercepted.push({ name, receiver: this })
        throw new Error(`legacy prototype getter was invoked: ${name}`)
      },
    })
  }

  try {
    for (const name of [
      'clearContexts',
      'delete',
      'destroy',
      'dispose',
      'extend',
      'get',
      'getAll',
      'getPluginContext',
      'has',
      'hasPrototypeExtensions',
      'init',
      'preflight',
      'publishPluginContext',
      'register',
      'registerPlugins',
      'releasePluginContext',
      'setDisabled',
      'toProxy',
    ]) {
      replaceMethod(legacy.Plugins.prototype, name)
    }
    for (const name of ['assertPrototypeExtensionsAllowed', 'size']) replaceGetter(legacy.Plugins.prototype, name)

    for (const name of ['ctx', 'deps', 'disabled', 'logger', 'meta', 'name']) {
      replaceGetter(legacy.PluginRuntime.prototype, name)
    }
    for (const name of ['isExtended', 'isInited', 'setDisabled', 'toExportsProxy']) {
      replaceMethod(legacy.PluginRuntime.prototype, name)
    }
    for (const name of ['dispose', 'onDispose']) replaceGetter(legacy.PluginContext.prototype, name)

    engine = createEngine({ hostWindow: null })
    await engine.plugins.register({
      name: 'prototype-dispatch-proof',
      exports: () => ({ ping: () => 'pong' }),
      init(context) {
        context.onDispose(() => {})
      },
    })
    assert.equal(engine.plugins.get('prototype-dispatch-proof').name, 'prototype-dispatch-proof')
    assert.equal(engine.plugins.getExports('prototype-dispatch-proof').ping(), 'pong')
    engine.plugins.setDisabled('prototype-dispatch-proof', true)
    assert.equal(engine.plugins.getExports('prototype-dispatch-proof'), undefined)
    engine.plugins.setDisabled('prototype-dispatch-proof', false)
    await engine.init()
    assert.equal(engine.plugins.get('prototype-dispatch-proof').initialized, true)
    assert.equal(await engine.plugins.delete('prototype-dispatch-proof'), true)
    await engine.destroy()
    assert.deepEqual(intercepted, [], 'instance operations must use package-private capability anchors')
  } finally {
    if (engine) await engine.destroy().catch(() => {})
    for (const restore of restorations.reverse()) restore()
  }
})

test('the public instance factory ignores package-private service injection', async t => {
  const legacy = await import(coreBundleUrl().href)
  const { createEngine } = await loadInstance()
  const injectedConfig = new legacy.Config()
  const engine = createEngine({
    hostWindow: null,
    services: { config: injectedConfig },
    trustPolicy: 'legacyTrusted',
  })
  t.after(() => engine.destroy())

  assert.notStrictEqual(engine.config, injectedConfig, 'public createEngine options must not inject internal services')
})
