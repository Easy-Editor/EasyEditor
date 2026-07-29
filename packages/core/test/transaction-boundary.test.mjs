import assert from 'node:assert/strict'
import test from 'node:test'
import { reaction } from 'mobx'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

async function createReadyEngine(t, trustPolicy = 'legacyTrusted') {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy })
  t.after(() => engine.destroy())
  await engine.init()
  return { core, engine }
}

test('bound transactions enforce expected mutation versions under both trust policies', async t => {
  for (const trustPolicy of ['legacyTrusted', 'agentRestricted']) {
    const { core, engine } = await createReadyEngine(t, trustPolicy)
    engine.loadProject(createProjectSchema({ id: `expected-version-${trustPolicy}` }), true)
    const document = engine.project.currentDocument
    const root = document.root
    const expected = document.mutationVersion

    const committed = engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: root.id, props: { title: `guarded:${trustPolicy}` } }],
      { expectedMutationVersion: expected },
    )

    assert.equal(committed.ok, true)
    assert.equal(root.getPropValue('title'), `guarded:${trustPolicy}`)
    assert.ok(document.mutationVersion > expected)
    assert.equal(document.history.isUndoable(), true)

    const beforeConflict = structuredClone(document.exportRaw())
    const beforeConflictVersion = document.mutationVersion
    const beforeConflictHistory = document.history.getState()
    const conflict = await captureFailure(() =>
      engine.transactions.runOnDocument(
        document,
        [{ type: 'updateProps', nodeId: root.id, props: { title: 'must-not-commit' } }],
        { expectedMutationVersion: expected },
      ),
    )

    assert.ok(conflict instanceof core.DocumentMutationVersionConflictError)
    assert.equal(conflict.name, 'DocumentMutationVersionConflictError')
    assert.equal(conflict.documentId, document.id)
    assert.equal(conflict.expected, expected)
    assert.equal(conflict.actual, beforeConflictVersion)
    assert.deepEqual(document.exportRaw(), beforeConflict)
    assert.equal(document.mutationVersion, beforeConflictVersion)
    assert.equal(document.history.getState(), beforeConflictHistory)

    const bypassed = engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: root.id, props: { title: `unguarded:${trustPolicy}` } }],
      { expectedMutationVersion: undefined },
    )
    assert.equal(bypassed.ok, true)
    assert.equal(root.getPropValue('title'), `unguarded:${trustPolicy}`)
  }
})

test('node title remains readable by reactive observers while a typed transaction is isolated', async t => {
  const { engine } = await createReadyEngine(t)
  const schema = createProjectSchema()
  schema.componentsTree[0].title = 'before title'
  engine.loadProject(schema, true)
  const document = engine.project.currentDocument
  const root = document.root
  const observerErrors = []
  const observedTitles = []
  const dispose = reaction(
    () => root.title,
    title => {
      observedTitles.push(title)
    },
    {
      fireImmediately: true,
      onError(error) {
        observerErrors.push(error)
      },
    },
  )
  t.after(dispose)

  const result = engine.transactions.runOnDocument(document, [
    {
      type: 'updateProps',
      nodeId: root.id,
      extras: { title: 'after title' },
    },
  ])

  assert.equal(result.ok, true)
  assert.deepEqual(observerErrors, [])
  assert.deepEqual(observedTitles, ['before title', 'after title'])
  assert.equal(root.title, 'after title')
})

test('setting values remain readable by reactive observers while a typed transaction is isolated', async t => {
  const { engine } = await createReadyEngine(t)
  const schema = createProjectSchema()
  schema.componentsTree[0].props.metric = 'before metric'
  engine.loadProject(schema, true)
  const document = engine.project.currentDocument
  const root = document.root
  const settingEntry = root.settingEntry
  const observerErrors = []
  const observedValues = []
  const dispose = reaction(
    () => settingEntry.getPropValue('metric'),
    value => {
      observedValues.push(value)
    },
    {
      fireImmediately: true,
      onError(error) {
        observerErrors.push(error)
      },
    },
  )
  t.after(dispose)

  const result = engine.transactions.runOnDocument(document, [
    {
      type: 'updateProps',
      nodeId: root.id,
      props: { metric: 'after metric' },
    },
  ])

  assert.equal(result.ok, true)
  assert.deepEqual(observerErrors, [])
  assert.deepEqual(observedValues, ['before metric', 'after metric'])
  assert.equal(settingEntry.getPropValue('metric'), 'after metric')
})

test('invalid expected mutation versions reject before effects and do not strand transaction resources', async t => {
  const { core, engine } = await createReadyEngine(t)
  engine.loadProject(createProjectSchema({ id: 'invalid-expected-version' }), true)
  const document = engine.project.currentDocument
  const root = document.root
  const before = structuredClone(document.exportRaw())
  const beforeVersion = document.mutationVersion
  const beforeHistory = document.history.getState()
  let propEvents = 0
  const dispose = root.onPropChange(() => {
    propEvents += 1
  })
  t.after(dispose)

  for (const invalid of [null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const error = await captureFailure(() =>
      engine.transactions.runOnDocument(
        document,
        [{ type: 'updateProps', nodeId: root.id, props: { title: 'must-not-commit' } }],
        { expectedMutationVersion: invalid },
      ),
    )

    assert.ok(error instanceof core.InvalidDocumentMutationVersionError)
    assert.equal(error.name, 'InvalidDocumentMutationVersionError')
    assert.equal(error.value, invalid)
    assert.deepEqual(document.exportRaw(), before)
    assert.equal(document.mutationVersion, beforeVersion)
    assert.equal(document.history.getState(), beforeHistory)
    assert.equal(propEvents, 0)
  }

  const committed = engine.transactions.runOnDocument(document, [
    { type: 'updateProps', nodeId: root.id, props: { title: 'resources-remain-usable' } },
  ])
  assert.equal(committed.ok, true)
  assert.equal(root.getPropValue('title'), 'resources-remain-usable')
})

test('expected mutation version validation follows binding and command preflight and rejects executable combinations', async t => {
  for (const trustPolicy of ['legacyTrusted', 'agentRestricted']) {
    const { core, engine } = await createReadyEngine(t, trustPolicy)
    engine.loadProject(createProjectSchema({ id: `expected-version-order-${trustPolicy}` }), true)
    const document = engine.project.currentDocument
    const expected = document.mutationVersion
    let conditionCalls = 0

    for (const condition of ['precondition', 'postcondition', 'settledPostcondition']) {
      for (const guardedVersion of [expected, expected + 1]) {
        const combination = await captureFailure(() =>
          engine.transactions.runOnDocument(
            document,
            [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'must-not-commit' } }],
            {
              expectedMutationVersion: guardedVersion,
              [condition]() {
                conditionCalls += 1
              },
            },
          ),
        )
        assert.ok(combination instanceof core.InvalidDocumentMutationVersionError)
        assert.equal(combination.reason, 'cannot-combine-with-executable-condition')
        assert.equal(conditionCalls, 0)
        assert.equal(document.root.getPropValue('title'), 'before')
        assert.equal(document.history.isUndoable(), false)
      }
    }

    const preflight = await captureFailure(() =>
      engine.transactions.runOnDocument(document, [{ type: 'updateProps', nodeId: document.root.id }], {
        expectedMutationVersion: expected + 1,
      }),
    )
    assert.ok(preflight instanceof core.CommandValidationError)
    assert.equal(document.root.getPropValue('title'), 'before')
    assert.equal(document.history.isUndoable(), false)
  }
})

test('expected mutation version rejects ABA after rollback even when raw schema is restored', async t => {
  const { core, engine } = await createReadyEngine(t)
  engine.loadProject(createProjectSchema({ id: 'expected-version-aba' }), true)
  const document = engine.project.currentDocument
  const root = document.root
  const expected = document.mutationVersion
  const before = structuredClone(document.exportRaw())

  const rollback = await captureFailure(() =>
    engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: root.id, props: { title: 'temporary' } }],
      {
        postcondition() {
          throw new Error('force rollback')
        },
      },
    ),
  )
  assert.match(rollback.message, /force rollback/)
  assert.deepEqual(document.exportRaw(), before)
  assert.ok(document.mutationVersion > expected)
  assert.equal(document.history.isUndoable(), false)

  const conflict = await captureFailure(() =>
    engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: root.id, props: { title: 'stale-aba-write' } }],
      { expectedMutationVersion: expected },
    ),
  )
  assert.ok(conflict instanceof core.DocumentMutationVersionConflictError)
  assert.equal(conflict.expected, expected)
  assert.equal(conflict.actual, document.mutationVersion)
  assert.deepEqual(document.exportRaw(), before)
  assert.equal(document.history.isUndoable(), false)
})

test('typed command material callbacks cannot mutate another document', async t => {
  const { engine } = await createReadyEngine(t)
  let callbackCalls = 0
  let attack = () => {}
  const otherDocumentId = 'page-2'
  engine.materials.createComponentMeta({
    componentName: 'Page',
    configure: {
      advanced: {
        callbacks: {
          onNodeAdd() {
            callbackCalls += 1
            attack()
          },
        },
      },
    },
  })
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const otherDocument = engine.project.createDocument({
    docId: otherDocumentId,
    id: 'root-2',
    componentName: 'Page',
    props: { title: 'other-before' },
    children: [],
  })
  const beforeDocument = structuredClone(document.exportRaw())
  const beforeOther = structuredClone(otherDocument.exportRaw())

  const attacks = [
    ['prop write', () => otherDocument.root.setPropValue('title', 'cross-document-leak')],
    ['root replacement', () => (otherDocument.rootNode = null)],
    ['node purge', () => otherDocument.root.purge()],
  ]
  for (const [index, [label, attempt]] of attacks.entries()) {
    attack = attempt
    const insertedId = `must-roll-back-${index}`
    const error = await captureFailure(() =>
      engine.commands.execute({
        type: 'insertNode',
        parentId: document.root.id,
        node: { id: insertedId, componentName: 'Text', props: {}, children: [] },
      }),
    )

    assert.match(error.message, /document mutation is blocked/i, label)
    assert.equal(callbackCalls, index + 1, `${label}: the regression fixture must execute the material callback`)
    assert.deepEqual(document.exportRaw(), beforeDocument, `${label}: target document must roll back`)
    assert.deepEqual(otherDocument.exportRaw(), beforeOther, `${label}: other document must remain unchanged`)
    assert.equal(otherDocument.root.isPurged, false, `${label}: other root must remain usable`)
    assert.equal(document.getNode(insertedId), null, `${label}: inserted node must be removed during rollback`)
    assert.equal(document.history.isUndoable(), false, `${label}: failed command must not add target history`)
    assert.equal(otherDocument.history.isUndoable(), false, `${label}: failed command must not add other history`)
    assert.equal(engine.materials.getUsageCount('Text'), 0, `${label}: material accounting must roll back`)
  }
})

test('typed command document isolation cannot be disabled through caller options', async t => {
  const { engine } = await createReadyEngine(t)
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const otherDocument = engine.project.createDocument({
    docId: 'caller-options-other',
    id: 'caller-options-other-root',
    componentName: 'Page',
    props: { title: 'other-before' },
    children: [],
  })
  const beforeDocument = structuredClone(document.exportRaw())
  const beforeOther = structuredClone(otherDocument.exportRaw())

  const error = await captureFailure(() =>
    engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'typed-change' } }],
      {
        // Deliberately exercise the historical JS-level escape hatch. The
        // canonical typed boundary must ignore it even though JS accepts the
        // unknown field.
        restrictDocumentMutations: false,
        postcondition() {
          otherDocument.root.setPropValue('title', 'cross-document-leak')
        },
      },
    ),
  )

  assert.match(error.message, /document mutation is blocked/i)
  assert.deepEqual(document.exportRaw(), beforeDocument)
  assert.deepEqual(otherDocument.exportRaw(), beforeOther)
  assert.equal(document.history.isUndoable(), false)
  assert.equal(otherDocument.history.isUndoable(), false)
})

test('callback transactions reject raw Document compatibility writes that bypass rollback', async t => {
  const { engine } = await createReadyEngine(t)
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const root = document.root
  const replacementOwner = document.createNode({
    id: 'raw-props-replacement-owner',
    componentName: 'Text',
    props: { replacement: true },
    children: [],
  })
  const before = structuredClone(document.exportRaw())
  const version = document.mutationVersion

  const attacks = [
    ['rootNode', () => (document.rootNode = null)],
    ['nodesMap.clear', () => document.nodesMap.clear()],
    ['nodesMap.delete', () => document.nodesMap.delete(root.id)],
    ['node.props', () => (root.props = replacementOwner.props)],
  ]
  for (const [label, attack] of attacks) {
    const error = await captureFailure(() => engine.transactions.runSync(attack))
    assert.match(error.message, /Raw (?:Document|Node)\..*mutation is blocked while a transaction is active/, label)
    assert.strictEqual(document.root, root, label)
    assert.strictEqual(document.getNode(root.id), root, label)
    assert.deepEqual(document.exportRaw(), before, label)
    assert.equal(document.mutationVersion, version, label)
    assert.equal(document.history.isUndoable(), false, label)
  }
  assert.equal(document.nodes, undefined)
  assert.equal(Reflect.ownKeys(document).includes('nodes'), false)
  assert.throws(() => (root.props.type = 'forged'), TypeError)
  assert.equal(root.props.type, 'map')
})

test('typed transactions block Project.config and Project.set writes while settling', async t => {
  const { engine } = await createReadyEngine(t)
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  engine.project.config = { mode: 'before' }
  engine.project.set('customState', 'before')
  const blocked = []
  const disposeReaction = reaction(
    () => document.root.getPropValue('title'),
    () => {
      for (const attempt of [
        () => {
          engine.project.config = { mode: 'leaked' }
        },
        () => engine.project.set('customState', 'leaked'),
      ]) {
        try {
          attempt()
        } catch (error) {
          blocked.push(error)
        }
      }
    },
  )
  t.after(disposeReaction)

  const result = engine.transactions.run([{ type: 'updateProps', nodeId: document.root.id, props: { title: 'after' } }])

  assert.equal(result.commandCount, 1)
  assert.equal(document.root.getPropValue('title'), 'after')
  assert.equal(blocked.length, 2)
  assert.ok(blocked.every(error => /project mutation is blocked/i.test(error.message)))
  assert.deepEqual(engine.project.config, { mode: 'before' })
  assert.equal(engine.project.get('customState'), 'before')
})

test('Project.removeDocument performs the complete Document.remove lifecycle exactly once', async t => {
  const { engine } = await createReadyEngine(t)
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  document.insertNode(document.root, {
    id: 'removed-child',
    componentName: 'Text',
    props: {},
    children: [],
  })
  let removeCalls = 0
  let destroyCalls = 0
  let purgeCalls = 0
  const removeEvents = []
  const originalRemove = document.remove
  const originalDestroy = document.history.destroy
  const originalPurge = document.purge
  document.remove = function removeWithCount() {
    removeCalls += 1
    return originalRemove.call(this)
  }
  document.history.destroy = function destroyWithCount() {
    destroyCalls += 1
    return originalDestroy.call(this)
  }
  document.purge = function purgeWithCount() {
    purgeCalls += 1
    return originalPurge.call(this)
  }
  const disposeRemoveListener = engine.project.onDocumentRemove(event => removeEvents.push(event))
  t.after(disposeRemoveListener)

  engine.project.removeDocument(document.id)

  assert.equal(removeCalls, 1, 'public removal must delegate once without recursion')
  assert.equal(destroyCalls, 0, 'internal history teardown must not be interceptable through the public method')
  assert.equal(purgeCalls, 0, 'document removal must use its non-interceptable internal purge path')
  assert.equal(document.root, null)
  assert.equal(document.getNodeCount(), 0)
  assert.equal(engine.project.getDocument(document.id), undefined)
  assert.equal(engine.project.documents.includes(document), false)
  assert.deepEqual(removeEvents, [{ id: document.id }])
  assert.equal(engine.materials.getUsageCount('Page'), 0)
  assert.equal(engine.materials.getUsageCount('Text'), 0)
})

test('restricted public transactions cannot execute callback options and Project exposes no boundary token', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => engine.destroy())
  engine.loadProject(createProjectSchema({ id: 'restricted-callback-boundary' }), true)
  await engine.init()
  const document = engine.project.currentDocument
  let callbackCalls = 0

  assert.equal(engine.project.beginDocumentMutationBoundary, undefined)
  const error = await captureFailure(() =>
    engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'must-not-commit' } }],
      {
        precondition() {
          callbackCalls += 1
        },
      },
    ),
  )

  assert.equal(error.name, 'PolicyViolation')
  assert.match(error.capability, /command\.executable/)
  assert.equal(callbackCalls, 0)
  assert.equal(document.root.getPropValue('title'), 'before')

  const result = engine.transactions.runOnDocument(document, [
    { type: 'updateProps', nodeId: document.root.id, props: { title: 'typed-only' } },
  ])
  assert.equal(result.ok, true)
  assert.equal(document.root.getPropValue('title'), 'typed-only')
})

test('material registry metadata and structural state roll back atomically with a failed transaction', async t => {
  const { engine } = await createReadyEngine(t)
  engine.project.load(createProjectSchema({ id: 'material-rollback' }), true)
  const document = engine.project.currentDocument
  const registry = engine.materials.registry
  const originalComponent = () => 'original'
  const replacementComponent = () => 'replacement'
  const originalMeta = registry.register(
    { componentName: 'Page', title: 'before' },
    {
      component: originalComponent,
      extensions: new Map([['origin', 'before']]),
      override: true,
      version: '1.0.0',
    },
  )
  const originalEntry = registry.get('Page')
  let metadataChanges = 0
  const disposeChange = originalMeta.onMetadataChange(() => {
    metadataChanges += 1
  })
  t.after(disposeChange)
  const beforeDocument = structuredClone(document.exportRaw())

  const error = await captureFailure(() =>
    engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'document-leak' } }],
      {
        postcondition() {
          registry.register(
            { componentName: 'Page', title: 'metadata-leak' },
            { component: replacementComponent, override: true, version: '2.0.0' },
          )
          registry.register({ componentName: 'TransactionOnly', title: 'must-disappear' })
          throw new Error('force material rollback')
        },
      },
    ),
  )

  assert.match(error.message, /force material rollback/)
  assert.deepEqual(document.exportRaw(), beforeDocument)
  assert.equal(document.history.isUndoable(), false)
  assert.equal(registry.has('TransactionOnly'), false)
  const restoredEntry = registry.get('Page')
  assert.notStrictEqual(restoredEntry, originalEntry)
  assert.strictEqual(restoredEntry.meta, originalMeta)
  assert.strictEqual(restoredEntry.component, originalComponent)
  assert.equal(restoredEntry.version, '1.0.0')
  assert.equal(restoredEntry.usageCount, 1)
  assert.deepEqual([...restoredEntry.extensions], [['origin', 'before']])
  assert.equal(originalMeta.title, 'before')

  const changesAfterRollback = metadataChanges
  assert.strictEqual(
    engine.materials.createComponentMeta({ componentName: 'Page', title: 'listener-still-live' }),
    originalMeta,
  )
  assert.equal(metadataChanges, changesAfterRollback + 1)
})

test('committed material replacement tombstones the old meta and releases the transaction lock', async t => {
  const { engine } = await createReadyEngine(t)
  engine.project.load(createProjectSchema({ id: 'material-commit' }), true)
  const document = engine.project.currentDocument
  const registry = engine.materials.registry
  const originalMeta = registry.register({ componentName: 'Page', title: 'before' }, { override: true })

  engine.transactions.runOnDocument(
    document,
    [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'first-commit' } }],
    {
      postcondition() {
        registry.register({ componentName: 'Page', title: 'replacement' }, { override: true })
      },
    },
  )

  assert.equal(registry.get('Page').meta.title, 'replacement')
  assert.throws(() => originalMeta.onMetadataChange(() => {}), /disposed/)
  const second = engine.transactions.runOnDocument(document, [
    { type: 'updateProps', nodeId: document.root.id, props: { title: 'second-commit' } },
  ])
  assert.equal(second.ok, true)
  assert.equal(document.root.getPropValue('title'), 'second-commit')
})

test('transaction preflight failure does not acquire or leak the material transaction lock', async t => {
  const { engine } = await createReadyEngine(t)
  engine.project.load(createProjectSchema({ id: 'transaction-preflight-failure' }), true)
  const document = engine.project.currentDocument
  const beforeDocument = structuredClone(document.exportRaw())
  const originalExportRaw = document.exportRaw.bind(document)

  document.exportRaw = () => {
    throw new Error('preflight export failure')
  }
  try {
    const error = await captureFailure(() => engine.transactions.runSync(() => 'must-not-run'))
    assert.match(error.message, /preflight export failure/)
  } finally {
    document.exportRaw = originalExportRaw
  }

  assert.deepEqual(document.exportRaw(), beforeDocument)
  const result = engine.transactions.runOnDocument(document, [
    { type: 'updateProps', nodeId: document.root.id, props: { title: 'lock-released' } },
  ])
  assert.equal(result.ok, true)
  assert.equal(document.root.getPropValue('title'), 'lock-released')
})

test('typed postconditions and legacy callbacks cannot reenter lifecycle or replace the active project', async t => {
  const { engine } = await createReadyEngine(t)
  engine.loadProject(createProjectSchema({ id: 'transaction-lifecycle-boundary' }), true)
  const document = engine.project.currentDocument
  const root = document.root
  const replacement = createProjectSchema({ id: 'must-not-replace-active-project' })
  const attempts = [
    ['engine.init', () => engine.init(), /transaction is active/i],
    ['engine.destroy', () => engine.destroy(), /transaction is active/i],
    ['engine.loadProject', () => engine.loadProject(replacement, true), /transaction is active/i],
    ['Project.load', () => engine.project.load(replacement, true), /project mutation is blocked/i],
  ]

  for (const [label, attempt, expected] of attempts) {
    const before = structuredClone(document.exportRaw())
    const typedError = await captureFailure(() =>
      engine.transactions.runOnDocument(
        document,
        [{ type: 'updateProps', nodeId: root.id, props: { title: `typed:${label}` } }],
        { postcondition: attempt },
      ),
    )
    assert.match(typedError.message, expected, `${label}: typed postcondition`)
    assert.deepEqual(document.exportRaw(), before, `${label}: typed mutation must roll back`)
    assert.equal(engine.lifecycleState, 'ready')
    assert.strictEqual(engine.project.currentDocument, document)

    const legacyError = await captureFailure(() =>
      engine.transactions.runSync(() => {
        root.setPropValue('title', `legacy:${label}`)
        attempt()
      }),
    )
    assert.match(legacyError.message, expected, `${label}: legacy runSync`)
    assert.deepEqual(document.exportRaw(), before, `${label}: legacy mutation must roll back`)
    assert.equal(engine.lifecycleState, 'ready')
    assert.strictEqual(engine.project.currentDocument, document)
  }

  const committed = engine.commands.execute({
    type: 'updateProps',
    nodeId: root.id,
    props: { title: 'rollback-substrate-remains-live' },
  })
  assert.equal(committed.ok, true)
  assert.equal(root.getPropValue('title'), 'rollback-substrate-remains-live')
})

test('transaction settlement keeps lifecycle closed through deferred event delivery', async t => {
  const { core, engine } = await createReadyEngine(t)
  engine.loadProject(createProjectSchema({ id: 'transaction-settlement-lifecycle-boundary' }), true)
  const document = engine.project.currentDocument
  let lifecycleError
  const dispose = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => {
    try {
      engine.destroy()
    } catch (error) {
      lifecycleError = error
      throw error
    }
  })
  t.after(dispose)

  const error = await captureFailure(() =>
    engine.commands.execute({
      type: 'updateProps',
      nodeId: document.root.id,
      props: { title: 'committed-before-observer' },
    }),
  )

  assert.equal(error.name, 'TransactionCommittedError')
  assert.equal(error.committed, true)
  assert.equal(lifecycleError.name, 'LifecycleReentrancyError')
  assert.match(lifecycleError.message, /engine-owned lifecycle callback/i)
  assert.equal(document.root.getPropValue('title'), 'committed-before-observer')
  assert.equal(engine.lifecycleState, 'ready')
})

test('history transaction coordination is package-private and public history mutation cannot corrupt rollback', async t => {
  const { engine } = await createReadyEngine(t)
  engine.loadProject(createProjectSchema({ id: 'history-transaction-boundary' }), true)
  const document = engine.project.currentDocument
  const root = document.root
  const history = document.history
  const coordinationNames = ['beginTransaction', 'cancelTransaction', 'commitTransaction', 'rollbackTransaction']

  for (const name of coordinationNames) {
    assert.equal(name in history, false, `${name} must not be a public History operation`)
    Object.defineProperty(history, name, { configurable: true, value: () => undefined, writable: true })
  }

  try {
    const error = await captureFailure(() =>
      engine.transactions.runSync(() => {
        root.setPropValue('title', 'must-roll-back')
        for (const operation of [
          () => history.back(),
          () => history.forward(),
          () => history.go(0),
          () => history.savePoint(),
          () => history.setSerialization({ serialize: JSON.stringify, unserialize: JSON.parse }),
        ]) {
          assert.throws(operation, /document transaction is active/i)
        }
        history.commitTransaction()
        throw new Error('force rollback through private coordination')
      }),
    )

    assert.match(error.message, /force rollback through private coordination/)
    assert.equal(root.getPropValue('title'), 'before')
    assert.equal(document.history.isUndoable(), false)
  } finally {
    for (const name of coordinationNames) delete history[name]
  }

  const result = engine.transactions.runSync(() => {
    root.setPropValue('title', 'private-coordination-still-live')
    return 'committed'
  })
  assert.equal(result, 'committed')
  assert.equal(root.getPropValue('title'), 'private-coordination-still-live')
})
