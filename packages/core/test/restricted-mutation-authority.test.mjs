import assert from 'node:assert/strict'
import test from 'node:test'
import { intercept, reaction } from 'mobx'
import { createExecutableSchema, createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

function captureState(engine) {
  const document = engine.project.currentDocument
  const materialState = engine.materials.registry.getSnapshot()
  return {
    document,
    historyData: document.history.hotData,
    historyState: document.history.getState(),
    materialEntries: materialState.entries,
    materialPendingEntries: materialState.pendingEntries,
    materialVersion: engine.materials.version,
    mutationVersion: document.mutationVersion,
    project: structuredClone(engine.project.export()),
    root: document.root,
    schema: structuredClone(document.exportRaw()),
  }
}

function assertStateUnchanged(engine, before, message) {
  const after = captureState(engine)
  assert.strictEqual(after.document, before.document, `${message}: document identity changed`)
  assert.strictEqual(after.root, before.root, `${message}: root identity changed`)
  assert.deepEqual(after.schema, before.schema, `${message}: document schema changed`)
  assert.deepEqual(after.project, before.project, `${message}: project schema changed`)
  assert.equal(after.historyData, before.historyData, `${message}: history data changed`)
  assert.equal(after.historyState, before.historyState, `${message}: history state changed`)
  assert.equal(after.mutationVersion, before.mutationVersion, `${message}: mutation version changed`)
  assert.equal(after.materialVersion, before.materialVersion, `${message}: material version changed`)
  assert.deepEqual(after.materialEntries, before.materialEntries, `${message}: material usage changed`)
  assert.deepEqual(after.materialPendingEntries, before.materialPendingEntries, `${message}: pending materials changed`)
}

function assertRawMutationDenied(error) {
  assert.equal(error.name, 'PolicyViolation')
  assert.equal(error.capability, 'model.mutation')
  assert.match(error.rule, /^agentRestricted\.model\.mutation\.deny$/)
}

function assertRuntimeReadonly(target, key, replacement, label) {
  const original = target[key]
  assert.equal(Reflect.set(target, key, replacement), false, `${label}: assignment must be rejected`)
  assert.strictEqual(target[key], original, `${label}: assignment changed the reference`)
  assert.equal(
    Reflect.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value: replacement,
      writable: true,
    }),
    false,
    `${label}: defineProperty must not shadow the reference`,
  )
  assert.strictEqual(target[key], original, `${label}: defineProperty changed the reference`)
}

function assertRuntimeNonShadowable(target, key, replacement, label) {
  const original = target[key]
  assert.equal(
    Reflect.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value: replacement,
      writable: true,
    }),
    false,
    `${label}: defineProperty must not shadow the guarded accessor`,
  )
  assert.strictEqual(target[key], original, `${label}: defineProperty changed the guarded value`)
}

function assertRuntimeSnapshotNonShadowable(target, key, replacement, label) {
  const original = target[key]
  assert.equal(Object.isFrozen(original), true, `${label}: snapshot must be frozen`)
  assert.equal(
    Reflect.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value: replacement,
      writable: true,
    }),
    false,
    `${label}: defineProperty must not shadow the guarded accessor`,
  )
  const current = target[key]
  assert.equal(Object.isFrozen(current), true, `${label}: replacement snapshot must stay frozen`)
  assert.equal(current.length, original.length, `${label}: snapshot length changed`)
  for (let index = 0; index < original.length; index += 1) {
    assert.strictEqual(current[index], original[index], `${label}: snapshot member changed at ${index}`)
  }
}

test('ready agentRestricted engines reject raw Node, Document, Project, and History writes before side effects', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  await engine.init()
  engine.loadProject(createProjectSchema(), true)
  const document = engine.project.currentDocument

  const attempts = [
    ['Node.setPropValue', () => document.root.setPropValue('title', 'raw-node-write')],
    ['Document.id assignment', () => (document.id = 'raw-document-id')],
    ['Document.rootNode assignment', () => (document.rootNode = null)],
    ['Node.props assignment', () => (document.root.props = {})],
    ['Prop.key assignment', () => (document.root.getProp('title', false).key = 'raw-prop-key')],
    ['Document.nodesMap.delete', () => document.nodesMap.delete(document.root.id)],
    ['Document.nodesMap.clear', () => document.nodesMap.clear()],
    ['Document.nodesMap valueOf clear escape', () => document.nodesMap.valueOf().clear()],
    [
      'Document.nodesMap.forEach clear escape',
      () => document.nodesMap.forEach((_node, _id, nodesMap) => nodesMap.clear()),
    ],
    ['Node.purge', () => document.root.purge()],
    ['Node.unlink', () => document.root.unlink()],
    ['Document.unlinkNode', () => document.unlinkNode(document.root)],
    ['NodeChildren.purge', () => document.root.children.purge()],
    ['Props.purge', () => document.root.props.purge()],
    ['Prop.purge', () => document.root.getProp('title', false).purge()],
    [
      'Document.createNode',
      () => document.createNode({ id: 'raw-orphan', componentName: 'Text', props: { text: 'raw' }, children: [] }),
    ],
    ['Project.load', () => engine.project.load(createProjectSchema({ id: 'raw-project-write' }), true)],
    ['History.back', () => document.history.back()],
  ]

  for (const [label, attempt] of attempts) {
    const before = captureState(engine)
    const error = await captureFailure(attempt, `${label} must be rejected`)
    assertRawMutationDenied(error)
    assertStateUnchanged(engine, before, label)
  }

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
})

test('engine model identities and authority-bearing references are runtime immutable', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema(), true)

  const document = engine.project.currentDocument
  const root = document.root
  const children = root.children
  const props = root.props
  const title = root.getProp('title', false)
  const originalId = root.id
  const originalComponentName = root.componentName
  const before = captureState(engine)
  const replacement = Object.freeze({ forged: true })

  for (const [target, key, label] of [
    [engine, 'trustPolicy', 'Engine.trustPolicy'],
    [engine, 'config', 'Engine.config'],
    [engine, 'editor', 'Engine.editor'],
    [engine, 'designer', 'Engine.designer'],
    [engine, 'project', 'Engine.project'],
    [engine, 'hotkey', 'Engine.hotkey'],
    [engine, 'clipboard', 'Engine.clipboard'],
    [engine, 'setters', 'Engine.setters'],
    [engine, 'materials', 'Engine.materials'],
    [engine, 'eventBus', 'Engine.eventBus'],
    [engine, 'event', 'Engine.event'],
    [engine, 'logger', 'Engine.logger'],
    [engine, 'plugins', 'Engine.plugins'],
    [engine, 'innerPlugins', 'Engine.innerPlugins'],
    [engine, 'transactions', 'Engine.transactions'],
    [engine, 'commands', 'Engine.commands'],
    [engine, 'agentCapabilities', 'Engine.agentCapabilities'],
    [engine, 'remote', 'Engine.remote'],
    [engine.transactions, 'events', 'TransactionManager.events'],
    [engine.transactions, 'host', 'TransactionManager.host'],
    [engine.commands, 'transactions', 'CommandManager.transactions'],
    [engine.agentCapabilities, 'host', 'AgentCapabilityManager.host'],
    [engine.agentCapabilities, 'auditRecordBytes', 'AgentCapabilityManager.auditRecordBytes'],
    [engine.agentCapabilities, 'auditRecords', 'AgentCapabilityManager.auditRecords'],
    [engine.agentCapabilities, 'baselines', 'AgentCapabilityManager.baselines'],
    [engine.agentCapabilities, 'capabilities', 'AgentCapabilityManager.capabilities'],
    [engine.agentCapabilities, 'domainEvents', 'AgentCapabilityManager.domainEvents'],
    [engine.agentCapabilities, 'plans', 'AgentCapabilityManager.plans'],
    [engine.agentCapabilities, 'portSessions', 'AgentCapabilityManager.portSessions'],
    [engine.agentCapabilities, 'terminalPlans', 'AgentCapabilityManager.terminalPlans'],
    [engine.editor, 'engineConfig', 'Editor.engineConfig'],
    [engine.editor, 'eventBus', 'Editor.eventBus'],
    [engine.remote, 'loadingState', 'Engine.remote.loadingState'],
    [engine.remote, 'registry', 'Engine.remote.registry'],
    [engine.remote, 'request', 'Engine.remote.request'],
    [engine.remote.loadingState, 'listeners', 'LoadingStateManager.listeners'],
    [engine.remote.loadingState, 'waitCancels', 'LoadingStateManager.waitCancels'],
    [engine.materials, 'editor', 'Materials.editor'],
    [engine.event, 'eventBus', 'Event.eventBus'],
    [engine.event, 'options', 'Event.options'],
    [engine.designer, 'activeTracker', 'Designer.activeTracker'],
    [engine.designer, 'detecting', 'Designer.detecting'],
    [engine.designer, 'dragon', 'Designer.dragon'],
    [engine.designer, 'editor', 'Designer.editor'],
    [engine.designer, 'project', 'Designer.project'],
    [engine.designer, 'selection', 'Designer.selection'],
    [engine.designer, 'settingsManager', 'Designer.settingsManager'],
    [engine.designer.activeTracker, 'designer', 'ActiveTracker.designer'],
    [engine.designer.activeTracker, 'emitter', 'ActiveTracker.emitter'],
    [engine.designer.detecting, 'designer', 'Detecting.designer'],
    [engine.designer.detecting, 'emitter', 'Detecting.emitter'],
    [engine.designer.dragon, 'designer', 'Dragon.designer'],
    [engine.designer.dragon, 'emitter', 'Dragon.emitter'],
    [engine.designer.selection, 'designer', 'Selection.designer'],
    [engine.designer.selection, 'emitter', 'Selection.emitter'],
    [engine.designer.settingsManager, 'editor', 'SettingsManager.editor'],
    [engine.project, 'designer', 'Project.designer'],
    [engine.innerPlugins, 'assertPrototypeExtensionsAllowed', 'Plugins.assertPrototypeExtensionsAllowed'],
    [engine.innerPlugins, 'pluginContextMap', 'Plugins.pluginContextMap'],
    [engine.innerPlugins, 'pluginsMap', 'Plugins.pluginsMap'],
    [engine.innerPlugins, 'pluginContexts', 'Plugins.pluginContexts'],
    [engine.innerPlugins, 'plugins', 'Plugins.plugins'],
    [engine.innerPlugins, 'registeredPlugins', 'Plugins.registeredPlugins'],
    [engine.innerPlugins, 'structuralOperations', 'Plugins.structuralOperations'],
    [engine.innerPlugins, 'structuralReservations', 'Plugins.structuralReservations'],
    [document, 'project', 'Document.project'],
    [document, 'designer', 'Document.designer'],
    [document, 'emitter', 'Document.emitter'],
    [document, 'history', 'Document.history'],
    [document, 'restrictedNodesMapView', 'Document.restrictedNodesMapView'],
    [document, 'mutationVersion', 'Document.mutationVersion'],
    [document, 'nodesMap', 'Document.nodesMap'],
    [document, 'root', 'Document.root'],
    [document.history, 'document', 'History.document'],
    [root, 'document', 'Node.document'],
    [root, 'children', 'Node.children'],
    [root, 'parent', 'Node.parent'],
    [children, 'owner', 'NodeChildren.owner'],
    [props, 'owner', 'Props.owner'],
    [title, 'parent', 'Prop.parent'],
    [title, 'owner', 'Prop.owner'],
    [title, 'props', 'Prop.props'],
  ]) {
    assertRuntimeReadonly(target, key, replacement, label)
  }
  assertRuntimeReadonly(root, 'id', 'forged-id', 'Node.id')
  assertRuntimeReadonly(root, 'componentName', 'ForgedComponent', 'Node.componentName')
  for (const [target, key, value, label] of [
    [engine.project, 'config', replacement, 'Project.config'],
    [engine.project, 'simulator', replacement, 'Project.simulator'],
    [engine.materials, 'designer', replacement, 'Materials.designer'],
    [engine.materials, 'registry', replacement, 'Materials.registry'],
    [engine.materials, 'version', 999, 'Materials.version'],
    [engine.designer, 'currentDocument', replacement, 'Designer.currentDocument'],
    [engine.designer, 'currentHistory', replacement, 'Designer.currentHistory'],
    [engine.designer, 'materials', replacement, 'Designer.materials'],
    [engine.designer.detecting, 'current', replacement, 'Detecting.current'],
    [engine.designer.detecting, 'enable', false, 'Detecting.enable'],
    [engine.designer.dragon, 'activeSensor', replacement, 'Dragon.activeSensor'],
    [engine.designer.dragon, 'dragging', true, 'Dragon.dragging'],
    [engine.designer.selection, 'currentDocument', replacement, 'Selection.currentDocument'],
    [document, 'id', 'forged-document-id', 'Document.id'],
    [document, 'rootNode', replacement, 'Document.rootNode'],
    [document, 'simulator', replacement, 'Document.simulator'],
    [root, 'props', replacement, 'Node.props'],
    [props, 'type', 'forged', 'Props.type'],
    [title, 'key', 'forged-key', 'Prop.key'],
  ]) {
    assertRuntimeNonShadowable(target, key, value, label)
  }
  for (const [target, key, label] of [
    [engine.project, 'documents', 'Project.documents'],
    [props, 'items', 'Props.items'],
    [children, 'children', 'NodeChildren.children'],
  ]) {
    assertRuntimeSnapshotNonShadowable(target, key, replacement, label)
  }
  const selectedBefore = engine.designer.selection.selected
  assert.equal(
    Reflect.defineProperty(engine.designer.selection, 'selected', {
      configurable: true,
      value: ['forged-selection'],
      writable: true,
    }),
    false,
  )
  assert.deepEqual(engine.designer.selection.selected, selectedBefore)

  assert.equal(root.id, originalId)
  assert.equal(root.componentName, originalComponentName)
  assert.strictEqual(document.nodesMap.get(originalId), root)
  assert.equal(document.nodesMap.has('forged-id'), false)
  assertStateUnchanged(engine, before, 'runtime readonly reference attacks')

  const error = await captureFailure(() => root.setPropValue('title', 'authority-bypass'))
  assertRawMutationDenied(error)

  const schemaError = await captureFailure(() => engine.loadProject(createExecutableSchema(), true))
  assert.equal(schemaError.name, 'PolicyViolation')

  const commandError = await captureFailure(() =>
    engine.commands.execute({
      type: 'updateProps',
      nodeId: root.id,
      props: { handler: { type: 'JSExpression', value: 'globalThis.secret' } },
    }),
  )
  assert.equal(commandError.name, 'PolicyViolation')

  const remoteError = await captureFailure(() =>
    engine.remote.request({ name: 'forged-material', type: 'material', url: 'https://example.invalid/material.js' }),
  )
  assert.equal(remoteError.name, 'PolicyViolation')

  let extended = false
  const pluginError = await captureFailure(() =>
    engine.plugins.register({
      name: 'runtime-readonly-extension',
      extend() {
        extended = true
      },
      init() {},
    }),
  )
  assert.equal(pluginError.name, 'PolicyViolation')
  assert.equal(extended, false)
  assert.equal(engine.plugins.get('runtime-readonly-extension'), undefined)
  assertStateUnchanged(engine, before, 'authority reference replacement')

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
})

test('two engines cannot cross-rebind material ownership and remain independently disposable', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(async () => Promise.all([first.destroy(), second.destroy()]))
  await Promise.all([first.init(), second.init()])

  first.materials.createComponentMeta({ componentName: 'FirstOnly' })
  second.materials.createComponentMeta({ componentName: 'SecondOnly' })
  const firstRegistry = first.materials.registry
  const secondRegistry = second.materials.registry

  assertRuntimeReadonly(first.materials, 'editor', second.editor, 'Materials.editor cross-engine')
  assertRuntimeNonShadowable(first.materials, 'designer', second.designer, 'Materials.designer cross-engine')
  assertRuntimeNonShadowable(first.materials, 'registry', secondRegistry, 'Materials.registry cross-engine')
  assert.equal(firstRegistry.has('FirstOnly'), true)
  assert.equal(firstRegistry.has('SecondOnly'), false)
  assert.equal(secondRegistry.has('FirstOnly'), false)
  assert.equal(secondRegistry.has('SecondOnly'), true)

  await first.destroy()
  assert.equal(first.lifecycleState, 'disposed')
  assert.equal(second.lifecycleState, 'ready')
  second.materials.createComponentMeta({ componentName: 'SecondAfterFirstDestroy' })
  assert.equal(secondRegistry.has('SecondAfterFirstDestroy'), true)
  await second.destroy()
  assert.equal(second.lifecycleState, 'disposed')
})

test('simulator graph keeps its project, designer, viewport, scroller, and event ownership', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  const simulator = new core.Simulator(engine.project, engine.designer)
  engine.project.mountSimulator(simulator)
  const replacement = Object.freeze({ forged: true })

  for (const [target, key, label] of [
    [simulator, 'designer', 'Simulator.designer'],
    [simulator, 'emitter', 'Simulator.emitter'],
    [simulator, 'isSimulator', 'Simulator.isSimulator'],
    [simulator, 'project', 'Simulator.project'],
    [simulator, 'scroller', 'Simulator.scroller'],
    [simulator, 'viewport', 'Simulator.viewport'],
    [simulator.viewport, 'designer', 'Viewport.designer'],
    [simulator.scroller, 'scrollable', 'Scroller.scrollable'],
  ]) {
    assertRuntimeReadonly(target, key, replacement, label)
  }
  assertRuntimeNonShadowable(simulator, 'currentDocument', replacement, 'Simulator.currentDocument')
  assertRuntimeNonShadowable(simulator, 'editor', replacement, 'Simulator.editor')
  assertRuntimeNonShadowable(simulator.scroller, 'scrollTarget', replacement, 'Scroller.scrollTarget')
  assert.strictEqual(engine.project.simulator, simulator)

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(engine.project.simulator, null)
})

test('document identity accessors and monotonic version clock keep old Agent plans stale', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema(), true)

  const document = engine.project.currentDocument
  const originalSchema = structuredClone(document.export())
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:runtime-clock',
    documentIds: [document.id],
    commandTypes: ['updateProps'],
    componentProps: { Page: { title: { type: 'string', maxBytes: 4096 } } },
  })
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'agent-write' } }],
  })
  const baselineVersion = document.mutationVersion

  engine.commands.execute({ type: 'updateProps', nodeId: document.root.id, props: { title: 'temporary-write' } })
  engine.undo(document.id)
  assert.deepEqual(document.export(), originalSchema)
  const advancedVersion = document.mutationVersion
  assert.ok(advancedVersion > baselineVersion)

  assert.equal(Reflect.set(document, 'schemaMutationVersion', baselineVersion), true)
  assert.equal(document.schemaMutationVersion, baselineVersion, 'the legacy private name is now inert caller data')
  assert.equal(document.mutationVersion, advancedVersion, 'the internal version clock must not be reset by reflection')
  assertRuntimeNonShadowable(document, 'mutationVersion', baselineVersion, 'Document.mutationVersion')
  assertRuntimeNonShadowable(document, 'id', 'shadow-document-id', 'Document.id')
  assertRuntimeNonShadowable(document, 'rootNode', null, 'Document.rootNode')

  const error = await captureFailure(() => capability.execute(plan.planId))
  assert.equal(error.name, 'AgentPlanStaleError')
  assert.equal(error.code, 'agent.plan.stale')
  assert.equal(error.committed, false)
  assert.deepEqual(document.export(), originalSchema)
})

test('history sessions keep their cursor and active record authority after reflective tampering', async t => {
  const core = await loadCore()
  const standalone = new core.Session(3, 'standalone')
  t.after(() => standalone.end())
  assertRuntimeReadonly(standalone, 'cursor', 0, 'Session.cursor')

  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const history = document.history

  engine.transactions.run([
    {
      type: 'updateProps',
      documentId: document.id,
      nodeId: document.root.id,
      props: { title: 'committed' },
    },
  ])
  assert.equal(document.root.getPropValue('title'), 'committed')
  assert.equal(history.isUndoable(), true)

  const forged = new core.Session(0, JSON.stringify(document.export()))
  t.after(() => forged.end())
  assert.equal(Reflect.set(history, 'session', forged), true, 'legacy private name should be inert caller data')
  assert.strictEqual(history.session, forged)
  assertRuntimeReadonly(history, 'emitter', Object.freeze({ forged: true }), 'History.emitter')

  engine.undo(document.id)
  assert.equal(document.root.getPropValue('title'), 'before')
  assert.equal(history.isRedoable(), true)
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
})

test('material construction callbacks cannot rebind a node identity or authority chain', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()

  let observed
  engine.designer.addPropsReducer((props, node) => {
    if (observed) return props
    const replacement = Object.freeze({ forged: true })
    const title = node.getProp('title', false)
    const originalDocument = node.document
    const originalId = node.id
    const originalComponentName = node.componentName
    const attempts = [
      [node, 'document', replacement],
      [node, 'id', 'callback-forged-id'],
      [node, 'componentName', 'CallbackForgedComponent'],
      [node.document, 'project', replacement],
      [node.document, 'designer', replacement],
      [node.props, 'owner', replacement],
      [title, 'parent', replacement],
      [title, 'owner', replacement],
      [title, 'props', replacement],
    ].map(([target, key, value]) => ({
      defined: Reflect.defineProperty(target, key, { configurable: true, value, writable: true }),
      key,
      set: Reflect.set(target, key, value),
    }))
    const shadowAttempts = [
      [node, 'children', replacement],
      [node, 'parent', replacement],
      [node, 'props', replacement],
      [node.document, 'id', 'callback-document-id'],
      [node.document, 'mutationVersion', 0],
      [node.document, 'rootNode', replacement],
      [node.document.project, 'config', replacement],
      [node.document.project, 'documents', replacement],
      [node.props, 'items', replacement],
      [node.props, 'type', 'forged'],
      [title, 'key', 'callback-key'],
    ].map(([target, key, value]) => Reflect.defineProperty(target, key, { configurable: true, value, writable: true }))
    observed = { attempts, node, originalComponentName, originalDocument, originalId, shadowAttempts }
    return props
  }, core.TRANSFORM_STAGE.INIT)

  engine.loadProject(createProjectSchema(), true)

  assert.ok(observed)
  assert.deepEqual(
    observed.attempts.map(({ defined, set }) => ({ defined, set })),
    observed.attempts.map(() => ({ defined: false, set: false })),
  )
  assert.deepEqual(
    observed.shadowAttempts,
    observed.shadowAttempts.map(() => false),
  )
  assert.strictEqual(observed.node.document, observed.originalDocument)
  assert.equal(observed.node.id, observed.originalId)
  assert.equal(observed.node.componentName, observed.originalComponentName)
  assert.strictEqual(observed.originalDocument.nodesMap.get(observed.originalId), observed.node)
  assert.equal(observed.originalDocument.nodesMap.has('callback-forged-id'), false)
})

test('agentRestricted project config and extension data are immutable detached values', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  const schema = createProjectSchema({
    config: { feature: { enabled: true }, modes: [{ name: 'safe' }] },
    meta: { nested: { owner: 'host' } },
  })
  engine.loadProject(schema, true)

  assert.ok(Object.isFrozen(engine.project.config))
  assert.ok(Object.isFrozen(engine.project.config.feature))
  assert.ok(Object.isFrozen(engine.project.config.modes))
  assert.ok(Object.isFrozen(engine.project.get('meta')))
  assert.ok(Object.isFrozen(engine.project.get('meta').nested))

  const before = captureState(engine)
  for (const [label, attempt] of [
    ['Project.config nested object', () => (engine.project.config.feature.enabled = false)],
    ['Project.config nested array', () => engine.project.config.modes.push({ name: 'unsafe' })],
    ['Project.get nested extension data', () => (engine.project.get('meta').nested.owner = 'agent')],
  ]) {
    const error = await captureFailure(attempt, `${label} must be immutable`)
    assert.ok(error instanceof TypeError, `${label} must fail with an immutable-value TypeError`)
    assertStateUnchanged(engine, before, label)
  }

  schema.config.feature.enabled = false
  schema.meta.nested.owner = 'caller'
  assert.equal(engine.project.config.feature.enabled, true, 'loaded config must not alias the caller schema')
  assert.equal(
    engine.project.get('meta').nested.owner,
    'host',
    'loaded extension data must not alias the caller schema',
  )
})

test('legacyTrusted preserves direct model mutation compatibility', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()

  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const root = document.rootNode
  const originalDocumentId = document.id
  const originalProps = root.props
  const titleProp = root.getProp('title', false)
  document.root.setPropValue('title', 'legacy-node-write')
  const orphan = document.createNode({ id: 'legacy-orphan', componentName: 'Text', props: {}, children: [] })
  engine.project.set('legacyFlag', true)
  engine.project.config = { nested: { enabled: true } }

  document.id = 'legacy-document-id'
  assert.equal(document.id, 'legacy-document-id')
  document.id = originalDocumentId
  document.rootNode = null
  assert.equal(document.rootNode, null)
  document.rootNode = root
  assert.throws(() => {
    document.root.props = orphan.props
  }, /canonical Props identity/)
  assert.strictEqual(document.root.props, originalProps)
  titleProp.key = 'legacyTitle'
  assert.equal(titleProp.key, 'legacyTitle')
  titleProp.key = 'title'
  document.nodesMap.delete(orphan.id)
  assert.equal(document.getNode(orphan.id), null)
  document.nodesMap.set(orphan.id, orphan)
  engine.project.config.nested.enabled = false

  assert.equal(document.root.getPropValue('title'), 'legacy-node-write')
  assert.strictEqual(document.getNode(orphan.id), orphan)
  assert.equal(engine.project.get('legacyFlag'), true)
  assert.equal(engine.project.config.nested.enabled, false)
})

test('restricted host composition, typed transactions, Agent capability, and engine undo-redo remain usable', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  await engine.init()
  engine.loadProject(createProjectSchema(), true)
  const document = engine.project.currentDocument

  engine.transactions.run([
    {
      type: 'updateProps',
      documentId: document.id,
      nodeId: document.root.id,
      props: { title: 'typed' },
    },
  ])
  assert.equal(document.root.getPropValue('title'), 'typed')

  engine.undo(document.id)
  assert.equal(document.root.getPropValue('title'), 'before')
  engine.redo(document)
  assert.equal(document.root.getPropValue('title'), 'typed')

  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:mutation-authority',
    documentIds: [document.id],
    commandTypes: ['updateProps'],
    componentProps: { Page: { title: { type: 'string', maxBytes: 16 * 1024 } } },
  })
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'agent' } }],
  })
  const receipt = capability.execute(plan.planId)
  assert.match(receipt.status, /^committed/)
  assert.equal(document.root.getPropValue('title'), 'agent')

  engine.unloadProject()
  assert.equal(engine.project.documents.length, 0)
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
})

test('agentRestricted event callbacks cannot borrow ambient host mutation authority', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  let callbackError
  const unsubscribe = engine.project.onDocumentAdd(document => {
    try {
      document.root.setPropValue('borrowedAuthority', 'persisted')
    } catch (error) {
      callbackError = error
    }
  })
  t.after(unsubscribe)

  engine.loadProject(createProjectSchema({ id: 'authority-callback' }), true)

  assertRawMutationDenied(callbackError)
  assert.equal(engine.project.currentDocument.root.getPropValue('borrowedAuthority'), undefined)
})

test('agentRestricted MobX reactions cannot borrow ambient host mutation authority', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  let callbackError
  const disposeReaction = reaction(
    () => engine.project.documents.length,
    () => {
      try {
        engine.project.currentDocument?.root?.setPropValue('borrowedMobxAuthority', 'persisted')
      } catch (error) {
        callbackError = error
      }
    },
  )
  t.after(disposeReaction)

  engine.loadProject(createProjectSchema({ id: 'authority-mobx-callback' }), true)

  assertRawMutationDenied(callbackError)
  assert.equal(engine.project.currentDocument.root.getPropValue('borrowedMobxAuthority'), undefined)
})

test('agentRestricted MobX reactions cannot mutate project collections during teardown', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema({ id: 'authority-teardown-callback' }), true)
  const oldDocument = engine.project.currentDocument
  const callbackErrors = []
  let callbackRuns = 0
  const disposeReaction = reaction(
    () => engine.project.documents,
    documents => {
      callbackRuns += 1
      try {
        documents.push(oldDocument)
      } catch (error) {
        callbackErrors.push(error)
      }
    },
  )
  t.after(disposeReaction)

  await engine.destroy()

  assert.ok(callbackRuns >= 1)
  assert.equal(callbackErrors.length, callbackRuns)
  assert.ok(callbackErrors.every(error => error instanceof TypeError))
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(engine.project.documents.length, 0)

  await engine.init()
  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(engine.project.documents.length, 0)
})

test('Project documents snapshots cannot intercept, veto, or rewrite canonical identity changes', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema({ id: 'authority-teardown-intercept' }), true)
  const oldDocument = engine.project.currentDocument
  const exposedDocuments = engine.project.documents
  assert.equal(Object.isFrozen(exposedDocuments), true)
  assert.throws(() => intercept(exposedDocuments, () => null), /Cannot obtain administration/)

  engine.loadProject(createProjectSchema({ id: 'authority-teardown-intercept-replacement' }), true)

  assert.deepEqual(exposedDocuments, [oldDocument])
  assert.equal(engine.project.documents.length, 1)
  assert.notStrictEqual(engine.project.currentDocument, oldDocument)

  await engine.destroy()

  assert.equal(engine.project.documents.length, 0)

  await engine.init()
  assert.equal(engine.project.documents.length, 0)
  assert.throws(() => oldDocument.createNode({ id: 'revived', componentName: 'Text', props: {} }), /disposed/)
})

test('agentRestricted material observers and component hooks cannot borrow host transaction authority', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  let hookError
  let materialError
  engine.materials.createComponentMeta({
    componentName: 'Page',
    configure: {
      advanced: {
        callbacks: {
          onNodeAdd(_node, parent) {
            try {
              parent.setPropValue('borrowedHookAuthority', 'persisted')
            } catch (error) {
              hookError = error
            }
          },
        },
      },
    },
  })
  const unsubscribe = engine.materials.registry.subscribe(event => {
    if (event.type !== 'usage_changed') return
    try {
      engine.project.currentDocument?.root?.setPropValue('borrowedMaterialAuthority', 'persisted')
    } catch (error) {
      materialError = error
    }
  })
  t.after(unsubscribe)

  engine.loadProject(createProjectSchema({ id: 'authority-material-callback' }), true)
  const document = engine.project.currentDocument
  engine.transactions.run([
    {
      type: 'insertNode',
      documentId: document.id,
      parentId: document.root.id,
      node: { componentName: 'Text', props: {}, children: [] },
    },
  ])

  assertRawMutationDenied(materialError)
  assertRawMutationDenied(hookError)
  assert.equal(document.root.getPropValue('borrowedMaterialAuthority'), undefined)
  assert.equal(document.root.getPropValue('borrowedHookAuthority'), undefined)
})

test('SettingField material callbacks cannot inherit an ambient host transaction authority', async t => {
  const core = await loadCore()
  const engine = core.createEngine({
    hostWindow: null,
    trustPolicy: {
      name: 'agentRestricted',
      allowDirectModelMutation: false,
      allowExecutableCommands: true,
      allowExecutableSchema: false,
      allowPluginExtensions: false,
      allowRemoteAccess: false,
    },
  })
  t.after(() => engine.destroy())
  await engine.init()

  let activePath
  let root
  const attempts = []
  const attemptMutation = callback => {
    let error
    const propName = `borrowed-${activePath}-${callback}`
    try {
      root.setPropValue(propName, 'must-not-persist')
    } catch (cause) {
      error = cause
    }
    attempts.push({ callback, error, path: activePath, propName })
  }

  engine.materials.createComponentMeta({
    componentName: 'Page',
    configure: {
      props: [
        {
          name: 'title',
          setter: 'StringSetter',
          extraProps: {
            getValue(_field, value) {
              attemptMutation('getValue')
              return value
            },
            setValue() {
              attemptMutation('setValue')
            },
          },
        },
        {
          name: '#appearance',
          type: 'group',
          extraProps: {
            getValue() {
              attemptMutation('valueState')
              return 'present'
            },
          },
        },
      ],
    },
  })
  engine.loadProject(createProjectSchema({ id: 'setting-callback-authority' }), true)
  root = engine.project.currentDocument.root
  const [title, appearance] = root.settingEntry.items

  const runInsideHostTransaction = (path, operation) => {
    let invoked = false
    const props = {}
    Object.defineProperty(props, `command-${path}`, {
      enumerable: true,
      get() {
        if (!invoked) {
          invoked = true
          operation()
        }
        return `committed-${path}`
      },
    })
    activePath = path
    try {
      engine.commands.execute({ type: 'updateProps', nodeId: root.id, props })
    } finally {
      activePath = undefined
    }
    assert.equal(invoked, true, `${path} must execute inside command application`)
  }

  runInsideHostTransaction('getValue', () => title.getValue())
  runInsideHostTransaction('valueState', () => appearance.valueState)
  runInsideHostTransaction('setValue', () => title.setValue('set-through-field'))
  runInsideHostTransaction('clearValue', () => title.clearValue())

  assert.deepEqual(
    attempts.map(({ callback, path }) => `${path}:${callback}`),
    ['getValue:getValue', 'valueState:valueState', 'setValue:getValue', 'setValue:setValue', 'clearValue:setValue'],
  )
  for (const attempt of attempts) {
    assertRawMutationDenied(attempt.error)
    assert.equal(root.getPropValue(attempt.propName), undefined)
  }
})

test('SettingField material callbacks block lifecycle reentry while preserving callback results and arguments', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()

  let activePath
  const lifecycleAttempts = []
  const setCalls = []
  const attemptLifecycleReentry = callback => {
    let error
    let result
    try {
      result = engine.init()
    } catch (cause) {
      error = cause
    }
    lifecycleAttempts.push({ callback, error, path: activePath, result })
  }

  engine.materials.createComponentMeta({
    componentName: 'Page',
    configure: {
      props: [
        {
          name: 'title',
          setter: 'StringSetter',
          extraProps: {
            getValue(_field, value) {
              attemptLifecycleReentry('getValue')
              return `${value}:material`
            },
            setValue(_field, value, oldValue) {
              attemptLifecycleReentry('setValue')
              setCalls.push({ oldValue, path: activePath, value })
            },
          },
        },
        {
          name: '#appearance',
          type: 'group',
          extraProps: {
            getValue() {
              attemptLifecycleReentry('valueState')
              return 'present'
            },
          },
        },
      ],
    },
  })
  engine.loadProject(createProjectSchema({ id: 'setting-callback-lifecycle' }), true)
  const root = engine.project.currentDocument.root
  const [title, appearance] = root.settingEntry.items

  activePath = 'getValue'
  assert.equal(title.getValue(), 'before:material')
  activePath = 'valueState'
  assert.equal(appearance.valueState, 1)
  activePath = 'setValue'
  title.setValue('after')
  assert.equal(root.getPropValue('title'), 'after')
  activePath = 'clearValue'
  title.clearValue()
  activePath = undefined
  assert.equal(root.getPropValue('title'), undefined)

  assert.deepEqual(
    lifecycleAttempts.map(({ callback, path }) => `${path}:${callback}`),
    ['getValue:getValue', 'valueState:valueState', 'setValue:getValue', 'setValue:setValue', 'clearValue:setValue'],
  )
  for (const attempt of lifecycleAttempts) {
    assert.equal(attempt.result, undefined)
    assert.equal(attempt.error?.name, 'LifecycleReentrancyError')
    assert.match(attempt.error.message, /Cannot init the engine from an engine-owned lifecycle callback/)
  }
  assert.deepEqual(setCalls, [
    { oldValue: 'before:material', path: 'setValue', value: 'after' },
    { oldValue: undefined, path: 'clearValue', value: undefined },
  ])
  assert.equal(engine.lifecycleState, 'ready')
})

test('EventBus does not expose a raw EventEmitter handle that can revive a disposed engine', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  await engine.destroy()

  const rawEmitter = engine.eventBus.eventEmitter
  assert.equal(rawEmitter, undefined)
})
