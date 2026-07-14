import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { loadCore } from './helpers/kernel.mjs'

const settle = async action => {
  try {
    return { status: 'fulfilled', value: await action() }
  } catch (error) {
    return { error, status: 'rejected' }
  }
}

test('public Document.purge performs one complete terminal removal instead of leaving a linked zombie', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  const schema = createProjectSchema({ id: 'public-purge-boundary' })
  engine.project.load(schema, true)
  await engine.init()
  const document = engine.project.currentDocument

  document.purge()

  assert.equal(engine.project.getDocument(document.id), undefined)
  assert.equal(engine.project.currentDocument, undefined)
  assert.deepEqual(engine.project.export().componentsTree, [])
  assert.equal(document.root, null)

  const attempts = await Promise.all([
    settle(() => document.import(schema.componentsTree[0])),
    settle(() => document.createNode({ componentName: 'Page', id: 'zombie-node', props: {} })),
    settle(() => document.exportRaw()),
  ])
  assert.deepEqual(
    attempts.map(attempt => attempt.status),
    ['rejected', 'rejected', 'rejected'],
  )
  for (const attempt of attempts) {
    assert.match(attempt.error.message, /document generation is disposed/)
  }
})

test('public Document.purge finishes terminal removal when a remove observer throws', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  engine.project.load(createProjectSchema({ id: 'purge-observer-failure' }), true)
  await engine.init()

  const document = engine.project.currentDocument
  const documentId = document.id
  engine.project.onDocumentRemove(() => {
    throw new Error('observer failed')
  })

  const outcome = await settle(() => document.purge())

  assert.equal(outcome.status, 'rejected')
  assert.match(outcome.error.message, /Document removal completed with errors/)
  assert.equal(engine.project.getDocument(documentId), undefined)
  assert.equal(engine.project.currentDocument, undefined)
  assert.equal(document.root, null)
  assert.equal((await settle(() => document.export())).status, 'rejected')
  assert.equal((await settle(() => document.history.savePoint())).status, 'rejected')
})

test('Selection exposes detached values to callers and listeners across restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  engine.project.load(createProjectSchema({ id: 'selection-snapshot-boundary' }), true)
  await engine.init()
  const selection = engine.designer.selection
  const root = engine.project.currentDocument.root
  const unsubscribe = selection.onSelectionChange(ids => {
    ids.push('listener-poison')
  })

  selection.selectAll([root.id])
  assert.deepEqual(selection.selected, [root.id])

  const snapshot = selection.selected
  snapshot.push('snapshot-poison')
  assert.deepEqual(selection.selected, [root.id])
  unsubscribe()

  await engine.destroy()
  const disposedSnapshot = selection.selected
  disposedSnapshot.push('revived-with-array')
  await engine.init()

  assert.equal(engine.lifecycleState, 'ready')
  assert.deepEqual(selection.selected, [])
})

test('PluginContext revokes callable capability results when their generation ends', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(async () => engine.destroy())
  let retainedConstructor
  let retainedFunction
  let retainedOff
  let deliveries = 0
  const listener = () => {
    deliveries += 1
  }
  engine.config.set('function-capability', () => {
    engine.config.set('cross-generation-function', 'leaked')
  })
  engine.config.set(
    'constructor-capability',
    class {
      constructor() {
        engine.config.set('cross-generation-constructor', 'leaked')
      }
    },
  )
  await engine.plugins.register({
    name: 'callable-capability-boundary',
    init(ctx) {
      retainedConstructor ||= ctx.config.get('constructor-capability')
      retainedFunction ||= ctx.config.get('function-capability')
      const off = ctx.event.on('callable-capability:event', listener)
      retainedOff ||= off
    },
  })
  await engine.init()
  retainedFunction()
  new retainedConstructor()
  assert.equal(engine.config.get('cross-generation-function'), 'leaked')
  assert.equal(engine.config.get('cross-generation-constructor'), 'leaked')
  engine.eventBus.emit('callable-capability:event')
  assert.equal(deliveries, 1)

  await engine.destroy()
  await engine.init()
  const constructorOutcome = await settle(() => new retainedConstructor())
  const functionOutcome = await settle(() => retainedFunction())
  const offOutcome = await settle(() => retainedOff())
  engine.eventBus.emit('callable-capability:event')

  assert.deepEqual(
    {
      constructorOutcome: constructorOutcome.status,
      constructorLeak: engine.config.get('cross-generation-constructor'),
      deliveries,
      functionOutcome: functionOutcome.status,
      leaked: engine.config.get('cross-generation-function'),
      offOutcome: offOutcome.status,
    },
    {
      constructorOutcome: 'rejected',
      constructorLeak: undefined,
      deliveries: 2,
      functionOutcome: 'rejected',
      leaked: undefined,
      offOutcome: 'rejected',
    },
  )
})

test('a PluginContext read before init is replaced at the generation boundary', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(async () => engine.destroy())
  let initializedContext
  await engine.plugins.register({
    name: 'precreated-context',
    init(ctx) {
      initializedContext = ctx
      ctx.config.set('precreated-context-ready', true)
    },
  })

  const precreatedContext = engine.innerPlugins.get('precreated-context').ctx
  assert.equal(precreatedContext.config.get('VERSION'), core.VERSION)

  await engine.init()

  assert.notEqual(initializedContext, precreatedContext)
  assert.equal(initializedContext.config.get('precreated-context-ready'), true)
  assert.equal((await settle(() => precreatedContext.config.get('VERSION'))).status, 'rejected')
})

test('PluginContext teardown can invoke an internally owned guarded disposer', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  let deliveries = 0
  await engine.plugins.register({
    name: 'owned-guarded-disposer',
    init(ctx) {
      ctx.onDispose(
        ctx.event.on('owned-guarded-disposer:event', () => {
          deliveries += 1
        }),
      )
    },
  })
  await engine.init()
  engine.eventBus.emit('owned-guarded-disposer:event')
  assert.equal(deliveries, 1)

  await engine.destroy()

  assert.equal(engine.lifecycleState, 'disposed')
})

test('Document.rootNode atomically rejects foreign and attached Node identities', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => Promise.all([first.destroy(), second.destroy()]))
  await Promise.all([first.init(), second.init()])

  first.project.load(createProjectSchema({ id: 'root-identity-first' }), true)
  second.project.load(createProjectSchema({ id: 'root-identity-second' }), true)
  const document = first.project.currentDocument
  const ownRoot = document.rootNode
  const foreignEngineRoot = second.project.currentDocument.rootNode
  const foreignDocument = first.project.createDocument({
    docId: 'foreign-document',
    id: 'foreign-document-root',
    componentName: 'Page',
    props: {},
    children: [],
  })
  const attachedChild = document.createNode({
    id: 'attached-child',
    componentName: 'Text',
    props: {},
    children: [],
  })
  ownRoot.children.insert(attachedChild)

  const before = {
    mutationVersion: document.mutationVersion,
    root: document.rootNode,
    schema: structuredClone(document.exportRaw()),
  }
  for (const [label, candidate] of [
    ['cross-engine root', foreignEngineRoot],
    ['same-project foreign-document root', foreignDocument.rootNode],
    ['attached child', attachedChild],
  ]) {
    assert.throws(
      () => {
        document.rootNode = candidate
      },
      /only accepts a registered, detached Node owned by this Document/,
      label,
    )
    assert.strictEqual(document.rootNode, before.root, `${label}: canonical root identity must not change`)
    assert.equal(
      document.mutationVersion,
      before.mutationVersion,
      `${label}: a rejected assignment must not advance the mutation clock`,
    )
    assert.deepEqual(document.exportRaw(), before.schema, `${label}: a rejected assignment must be atomic`)
  }

  document.rootNode = null
  assert.equal(document.rootNode, null)
  assert.strictEqual(document.getNode(ownRoot.id), ownRoot, 'the detached root must remain registered')
  assert.equal(ownRoot.parent, null)

  document.rootNode = ownRoot
  assert.strictEqual(document.rootNode, ownRoot)
  assert.deepEqual(document.exportRaw(), before.schema)
})

test('legacyTrusted Project.open rejects a foreign canonical Document without disturbing either engine', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => Promise.all([first.destroy(), second.destroy()]))
  await Promise.all([first.init(), second.init()])
  first.project.load(createProjectSchema({ id: 'project-open-owner-first' }), true)
  second.project.load(createProjectSchema({ id: 'project-open-owner-second' }), true)

  const firstDocument = first.project.currentDocument
  const secondDocument = second.project.currentDocument
  const before = {
    first: structuredClone(first.project.export()),
    second: structuredClone(second.project.export()),
  }

  assert.equal(firstDocument.id, secondDocument.id, 'the regression must exercise colliding public document ids')
  assert.throws(
    () => first.project.open(secondDocument),
    /only accepts a canonical Document identity owned by this Project/,
  )
  assert.strictEqual(first.project.currentDocument, firstDocument)
  assert.strictEqual(second.project.currentDocument, secondDocument)
  assert.deepEqual(first.project.export(), before.first)
  assert.deepEqual(second.project.export(), before.second)

  assert.strictEqual(first.project.open(firstDocument), firstDocument)
  assert.strictEqual(second.project.open(secondDocument), secondDocument)
})

test('legacyTrusted insertion and setting entry boundaries reject cross-instance identities before mutation', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => Promise.all([first.destroy(), second.destroy()]))
  await Promise.all([first.init(), second.init()])
  first.project.load(createProjectSchema({ id: 'model-owner-first' }), true)
  second.project.load(createProjectSchema({ id: 'model-owner-second' }), true)

  const firstDocument = first.project.currentDocument
  const secondDocument = second.project.currentDocument
  const firstRoot = firstDocument.root
  const secondRoot = secondDocument.root
  const batch = [{ id: 'foreign-parent-batch', componentName: 'Text', props: {}, children: [] }]
  const before = {
    batch: structuredClone(batch),
    firstMutationVersion: firstDocument.mutationVersion,
    firstSchema: structuredClone(firstDocument.exportRaw()),
    secondMutationVersion: secondDocument.mutationVersion,
    secondSchema: structuredClone(secondDocument.exportRaw()),
  }

  assert.throws(
    () =>
      firstDocument.insertNode(secondRoot, {
        id: 'foreign-parent-single',
        componentName: 'Text',
        props: {},
        children: [],
      }),
    /requires a canonical parent Node owned by this Document/,
  )
  assert.throws(
    () => firstDocument.insertNodes(secondRoot, batch),
    /requires a canonical parent Node owned by this Document/,
  )
  assert.deepEqual(batch, before.batch, 'a rejected parent must not consume the caller-owned batch')
  assert.throws(
    () => firstDocument.insertNode(firstRoot, secondRoot),
    /only move a canonical Node identity owned by this Document/,
  )
  assert.throws(
    () => firstDocument.insertNode(firstRoot, secondRoot, -1, true),
    /only copy a canonical Node identity owned by this Project/,
  )
  assert.throws(
    () => first.designer.createSettingEntry([secondRoot]),
    /only accepts canonical Node identities from one Document owned by this Designer/,
  )
  assert.throws(
    () => first.designer.createSettingEntry([firstRoot, secondRoot]),
    /only accepts canonical Node identities from one Document owned by this Designer/,
  )
  assert.throws(() => first.designer.createSettingEntry([]), /nodes should not be empty/)

  assert.equal(firstDocument.mutationVersion, before.firstMutationVersion)
  assert.equal(secondDocument.mutationVersion, before.secondMutationVersion)
  assert.deepEqual(firstDocument.exportRaw(), before.firstSchema)
  assert.deepEqual(secondDocument.exportRaw(), before.secondSchema)

  const siblingDocument = first.project.createDocument({
    docId: 'same-project-copy-source',
    id: 'same-project-copy-root',
    componentName: 'Page',
    props: {},
    children: [],
  })
  const copied = firstDocument.insertNode(firstRoot, siblingDocument.root, -1, true)
  assert.ok(copied)
  assert.strictEqual(copied.document, firstDocument)
  assert.notStrictEqual(copied, siblingDocument.root)
  assert.strictEqual(siblingDocument.root.document, siblingDocument)

  const validEntry = first.designer.createSettingEntry([firstRoot, copied])
  assert.deepEqual(validEntry.nodes, [firstRoot, copied])
  validEntry.purge()
  secondRoot.setPropValue('title', 'second-engine-remains-usable')
  assert.equal(secondRoot.getPropValue('title'), 'second-engine-remains-usable')
})

test('legacy shadow names cannot redirect canonical setting-entry ownership across engines', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => Promise.all([first.destroy(), second.destroy()]))
  await Promise.all([first.init(), second.init()])
  first.project.load(createProjectSchema({ id: 'setting-owner-first' }), true)
  second.project.load(createProjectSchema({ id: 'setting-owner-second' }), true)

  const firstRoot = first.project.currentDocument.root
  const secondRoot = second.project.currentDocument.root
  const firstEntry = firstRoot.settingEntry
  const secondEntry = secondRoot.settingEntry

  firstRoot._settingEntry = secondEntry

  assert.strictEqual(firstRoot._settingEntry, secondEntry, 'legacy shadow assignment may remain caller-owned data')
  assert.strictEqual(firstRoot.settingEntry, firstEntry, 'the private canonical cache must ignore the shadow name')
  assert.strictEqual(secondRoot.settingEntry, secondEntry)

  await first.destroy()

  assert.equal(first.lifecycleState, 'disposed')
  assert.equal(second.lifecycleState, 'ready')
  assert.throws(() => firstEntry.setPropValue('title', 'disposed-owner'), /setting entry generation is disposed/)
  secondEntry.setPropValue('title', 'second-still-usable')
  assert.equal(secondRoot.getPropValue('title'), 'second-still-usable')
  assert.strictEqual(secondRoot.settingEntry, secondEntry)
})

test('Designer locations reject foreign identities atomically and keep immutable identity slots', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => Promise.all([first.destroy(), second.destroy()]))
  await Promise.all([first.init(), second.init()])
  first.project.load(createProjectSchema({ id: 'location-owner-first' }), true)
  second.project.load(createProjectSchema({ id: 'location-owner-second' }), true)

  const firstDocument = first.project.currentDocument
  const secondDocument = second.project.currentDocument
  const firstRoot = firstDocument.root
  const secondRoot = secondDocument.root
  const firstDesignerChanges = []
  const firstDocumentChanges = []
  const secondDesignerChanges = []
  const secondDocumentChanges = []
  first.designer.onEvent(core.DESIGNER_EVENT.DROP_LOCATION_CHANGE, location => {
    firstDesignerChanges.push(location)
  })
  first.designer.onEvent(core.DESIGNER_EVENT.DOCUMENT_DROP_LOCATION_CHANGE, change => {
    firstDocumentChanges.push(change)
  })
  second.designer.onEvent(core.DESIGNER_EVENT.DROP_LOCATION_CHANGE, location => {
    secondDesignerChanges.push(location)
  })
  second.designer.onEvent(core.DESIGNER_EVENT.DOCUMENT_DROP_LOCATION_CHANGE, change => {
    secondDocumentChanges.push(change)
  })

  const event = { dragObject: null, globalX: 0, globalY: 0, originalEvent: {}, type: 'identity-test' }
  const childrenDetail = node => ({
    type: core.LocationDetailType.Children,
    valid: true,
    near: { node, pos: 'after' },
    focus: { type: 'node', node },
  })
  const initialFirst = first.designer.createLocation({
    target: firstRoot,
    detail: childrenDetail(firstRoot),
    event,
    source: 'first-initial',
  })
  const initialSecond = second.designer.createLocation({
    target: secondRoot,
    detail: childrenDetail(secondRoot),
    event,
    source: 'second-initial',
  })
  const beforeRejectedAssignments = {
    firstDesignerChanges: firstDesignerChanges.length,
    firstDocumentChanges: firstDocumentChanges.length,
    secondDesignerChanges: secondDesignerChanges.length,
    secondDocumentChanges: secondDocumentChanges.length,
  }

  for (const [label, locationData] of [
    [
      'foreign target',
      {
        target: secondRoot,
        detail: childrenDetail(secondRoot),
        event,
        source: 'foreign-target',
      },
    ],
    [
      'foreign near',
      {
        target: firstRoot,
        detail: {
          type: core.LocationDetailType.Children,
          near: { node: secondRoot, pos: 'before' },
          valid: true,
        },
        event,
        source: 'foreign-near',
      },
    ],
    [
      'foreign focus',
      {
        target: firstRoot,
        detail: {
          type: core.LocationDetailType.Children,
          focus: { type: 'node', node: secondRoot },
          valid: true,
        },
        event,
        source: 'foreign-focus',
      },
    ],
  ]) {
    assert.throws(
      () => first.designer.createLocation(locationData),
      /only accept active Node identities owned by this Designer/,
      label,
    )
    assert.strictEqual(firstDocument.dropLocation, initialFirst, `${label}: first location must remain unchanged`)
    assert.strictEqual(secondDocument.dropLocation, initialSecond, `${label}: second location must remain unchanged`)
    assert.deepEqual(
      {
        firstDesignerChanges: firstDesignerChanges.length,
        firstDocumentChanges: firstDocumentChanges.length,
        secondDesignerChanges: secondDesignerChanges.length,
        secondDocumentChanges: secondDocumentChanges.length,
      },
      beforeRejectedAssignments,
      `${label}: rejection must not emit any location state change`,
    )
  }

  const exerciseLocationLifecycle = (engine, document, root, prefix) => {
    const replacement = engine.designer.createLocation({
      target: root,
      detail: childrenDetail(root),
      event,
      source: `${prefix}-replacement`,
    })
    assert.strictEqual(document.dropLocation, replacement)
    engine.designer.clearLocation()
    assert.equal(document.dropLocation, null)
    const recreated = engine.designer.createLocation({
      target: root,
      detail: childrenDetail(root),
      event,
      source: `${prefix}-recreated`,
    })
    assert.strictEqual(document.dropLocation, recreated)
    return recreated
  }
  const finalFirst = exerciseLocationLifecycle(first, firstDocument, firstRoot, 'first')
  const finalSecond = exerciseLocationLifecycle(second, secondDocument, secondRoot, 'second')

  const firstTarget = finalFirst.target
  const firstDetail = finalFirst.detail
  const firstNear = firstDetail.near
  const firstFocus = firstDetail.focus
  assert.throws(() => {
    finalFirst.target = secondRoot
  }, TypeError)
  assert.throws(() => {
    finalFirst.detail = finalSecond.detail
  }, TypeError)
  assert.throws(() => {
    firstNear.node = secondRoot
  }, TypeError)
  assert.throws(() => {
    firstFocus.node = secondRoot
  }, TypeError)
  assert.strictEqual(finalFirst.target, firstTarget)
  assert.strictEqual(finalFirst.detail, firstDetail)
  assert.strictEqual(finalFirst.detail.near, firstNear)
  assert.strictEqual(finalFirst.detail.focus, firstFocus)
  assert.strictEqual(finalFirst.detail.near.node, firstRoot)
  assert.strictEqual(finalFirst.detail.focus.node, firstRoot)
  assert.ok(Object.isFrozen(finalFirst.detail))
  assert.ok(Object.isFrozen(finalFirst.detail.near))
  assert.ok(Object.isFrozen(finalFirst.detail.focus))
})

test('legacy Editor and Designer shadow names cannot redirect another restricted engine generation', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(async () => Promise.all([first.destroy(), second.destroy()]))
  await Promise.all([first.init(), second.init()])
  first.loadProject(createProjectSchema({ id: 'private-service-fields-first' }), true)
  second.loadProject(createProjectSchema({ id: 'private-service-fields-second' }), true)

  const firstDocument = first.project.currentDocument
  const secondDocument = second.project.currentDocument
  let foreignObserverPurges = 0
  const foreignObserver = {
    compute() {},
    isPurged() {
      return false
    },
    purge() {
      foreignObserverPurges += 1
    },
  }
  const foreignObserverList = second.designer.oobxList ?? []
  foreignObserverList.push(foreignObserver)

  // These are historical implementation names, not authority-bearing public
  // slots. On older implementations they alias the second engine's canonical
  // collections and disposers; on the encapsulated implementation they are
  // inert caller-owned shadows.
  first.editor.context = second.editor.context ?? null
  first.editor.waits = second.editor.waits ?? null
  first.editor.hooks = second.editor.hooks ?? null
  first.designer.historyDispose = second.designer.historyDispose ?? null
  first.designer.mounted = false
  first.designer.oobxList = foreignObserverList
  first.designer._simulatorProps = { poisonedByShadow: true }
  first.designer._suspended = true

  assert.deepEqual(first.designer.simulatorProps, {})
  assert.equal(first.designer.suspended, false)
  assert.strictEqual(first.editor.get('engine'), first)
  assert.strictEqual(first.editor.get('designer'), first.designer)
  assert.strictEqual(first.editor.get('project'), first.project)

  let firstHistoryChanges = 0
  const stopFirstHistoryChanges = first.designer.onEvent(core.DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, () => {
    firstHistoryChanges += 1
  })
  first.designer.mount()
  firstDocument.history.savePoint()
  stopFirstHistoryChanges()
  assert.equal(firstHistoryChanges, 1, 'a false legacy mounted shadow must not duplicate owned subscriptions')

  let onceGotValue
  void second.editor.onceGot('private-once-got').then(value => {
    onceGotValue = value
  })
  const onGotValues = []
  const stopOnGot = second.editor.onGot('private-on-got', value => {
    onGotValues.push(value)
  })
  let secondHistoryChanges = 0
  const stopSecondHistoryChanges = second.designer.onEvent(core.DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, () => {
    secondHistoryChanges += 1
  })

  await first.destroy()

  assert.equal(first.lifecycleState, 'disposed')
  assert.equal(second.lifecycleState, 'ready')
  assert.equal(foreignObserverPurges, 0, 'destroying the first engine must not purge a foreign observer list')
  assert.strictEqual(second.editor.get('engine'), second)
  assert.strictEqual(second.editor.get('designer'), second.designer)
  assert.strictEqual(second.editor.get('project'), second.project)

  second.editor.set('private-once-got', 'once-delivered')
  second.editor.set('private-on-got', 'on-delivered')
  await Promise.resolve()
  assert.equal(onceGotValue, 'once-delivered')
  assert.deepEqual(onGotValues, ['on-delivered'])

  secondDocument.history.savePoint()
  assert.equal(
    secondHistoryChanges,
    1,
    'the foreign history disposer shadow must neither remove nor duplicate the second engine binding',
  )
  stopOnGot()
  stopSecondHistoryChanges()

  await first.init()
  first.loadProject(createProjectSchema({ id: 'private-service-fields-first-restarted' }), true)
  assert.strictEqual(first.editor.get('engine'), first)
  assert.strictEqual(first.editor.get('designer'), first.designer)
  assert.strictEqual(first.editor.get('project'), first.project)

  let restartedHistoryChanges = 0
  first.designer.onEvent(core.DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, () => {
    restartedHistoryChanges += 1
  })
  first.designer.mount()
  first.designer.mount()
  first.project.currentDocument.history.savePoint()
  assert.equal(restartedHistoryChanges, 1, 'restart must bind the current history exactly once')
})

test('legacy Document state shadows cannot alter the canonical open, blank, or history state', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema({ id: 'private-document-fields' }), true)

  const document = engine.project.currentDocument
  const before = {
    active: document.active,
    blank: document.isBlank(),
    currentDocument: engine.project.currentDocument,
    currentHistory: engine.designer.currentHistory,
    documentSchema: structuredClone(document.exportRaw()),
    history: document.history,
    historyData: document.history.hotData,
    historyState: document.history.getState(),
    mutationVersion: document.mutationVersion,
    opened: document.opened,
    projectSchema: structuredClone(engine.project.export()),
  }
  const events = {
    currentDocument: 0,
    currentHistory: 0,
    open: 0,
  }
  engine.designer.onEvent(core.DESIGNER_EVENT.CURRENT_DOCUMENT_CHANGE, () => {
    events.currentDocument += 1
  })
  engine.designer.onEvent(core.DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, () => {
    events.currentHistory += 1
  })
  document.onReady(() => {
    events.open += 1
  })

  document.openedState = false
  document.suspendedState = true
  document._blank = true

  assert.equal(document.opened, before.opened)
  assert.equal(document._opened, true)
  assert.equal(document._suspended, false)
  assert.equal(document.active, before.active)
  assert.equal(document.isBlank(), before.blank)
  assert.strictEqual(engine.project.currentDocument, before.currentDocument)
  assert.strictEqual(engine.designer.currentHistory, before.currentHistory)
  assert.strictEqual(document.history, before.history)
  assert.equal(document.history.hotData, before.historyData)
  assert.equal(document.history.getState(), before.historyState)
  assert.equal(document.mutationVersion, before.mutationVersion)
  assert.deepEqual(document.exportRaw(), before.documentSchema)
  assert.deepEqual(engine.project.export(), before.projectSchema)
  assert.deepEqual(events, { currentDocument: 0, currentHistory: 0, open: 0 })
})

test('legacy SettingEntry collection shadows cannot acquire or dispose foreign fields', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => Promise.all([first.destroy(), second.destroy()]))
  await Promise.all([first.init(), second.init()])

  const registerPageSettings = engine => {
    engine.materials.createComponentMeta({
      componentName: 'Page',
      configure: {
        props: [
          { name: 'title', setter: 'StringSetter', title: 'Title' },
          {
            name: 'appearance',
            type: 'group',
            title: 'Appearance',
            items: [{ name: 'tone', setter: 'StringSetter', title: 'Tone' }],
          },
        ],
      },
    })
  }
  registerPageSettings(first)
  registerPageSettings(second)
  first.project.load(createProjectSchema({ id: 'setting-field-owner-first' }), true)
  second.project.load(createProjectSchema({ id: 'setting-field-owner-second' }), true)

  const firstRoot = first.project.currentDocument.root
  const secondRoot = second.project.currentDocument.root
  const firstEntry = firstRoot.settingEntry
  const secondEntry = secondRoot.settingEntry
  const firstItems = firstEntry.items
  const secondItems = secondEntry.items
  const firstTitle = firstItems[0]
  const firstGroup = firstItems[1]
  const firstTone = firstGroup.items[0]
  const secondTitle = secondItems[0]
  const secondGroup = secondItems[1]
  const secondTone = secondGroup.items[0]

  firstEntry.ownedFields = new Set([secondTitle, secondGroup, secondTone])
  firstEntry._items = [secondTitle, secondGroup]
  firstEntry._settingFieldMap = { appearance: secondGroup, title: secondTitle }
  firstEntry.disposeFunctions = [() => secondTitle.purge()]
  firstGroup._items = [secondTone]
  firstGroup.settingFieldOwner = secondTitle
  firstGroup.settingFieldCollector = secondTitle

  assert.ok(Object.isFrozen(firstEntry.items))
  assert.ok(Object.isFrozen(firstGroup.items))
  assert.ok(Object.isFrozen(secondEntry.items))
  assert.ok(Object.isFrozen(secondGroup.items))
  assert.throws(() => firstEntry.items.push(secondTitle), TypeError)
  assert.throws(() => firstGroup.items.push(secondTone), TypeError)
  assert.strictEqual(firstEntry.items[0], firstTitle)
  assert.strictEqual(firstEntry.items[1], firstGroup)
  assert.strictEqual(firstEntry.get('title'), firstTitle)
  assert.strictEqual(firstGroup.items[0], firstTone)
  assert.strictEqual(secondEntry.items[0], secondTitle)
  assert.strictEqual(secondGroup.items[0], secondTone)

  const createdField = firstGroup.createField({ name: 'temporary', setter: 'StringSetter' })
  assert.strictEqual(createdField.top, firstEntry)
  assert.strictEqual(createdField.getNode(), firstRoot)

  await first.destroy()

  assert.equal(first.lifecycleState, 'disposed')
  assert.equal(second.lifecycleState, 'ready')
  secondTitle.setValue('foreign-field-remains-live')
  secondTone.setValue('blue')
  assert.equal(secondRoot.getPropValue('title'), 'foreign-field-remains-live')
  assert.equal(secondTone.getValue(), 'blue')
  assert.strictEqual(secondRoot.settingEntry, secondEntry)
  assert.strictEqual(secondEntry.get('title'), secondTitle)
})

test('a null legacy Editor.hooks shadow cannot block complete idempotent disposal', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  await engine.init()
  assert.strictEqual(engine.editor.get('engine'), engine)
  assert.strictEqual(engine.editor.get('designer'), engine.designer)
  assert.strictEqual(engine.editor.get('project'), engine.project)

  engine.editor.hooks = null
  await engine.destroy()

  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(engine.editor.get('engine'), undefined)
  assert.equal(engine.editor.get('designer'), undefined)
  assert.equal(engine.editor.get('project'), undefined)

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
})
