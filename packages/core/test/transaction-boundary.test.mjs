import assert from 'node:assert/strict'
import test from 'node:test'
import { reaction } from 'mobx'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

async function createReadyEngine(t) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  return { core, engine }
}

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

test('Agent transactions block Project.config and Project.set writes while settling', async t => {
  const { engine } = await createReadyEngine(t)
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  engine.project.config = { mode: 'before' }
  engine.project.set('customAgentState', 'before')
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:project-boundary-regression',
    documentIds: [document.id],
    commandTypes: ['updateProps'],
    componentProps: { Page: { title: { type: 'string', maxBytes: 16 * 1024 } } },
  })
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'after' } }],
  })
  const blocked = []
  const disposeReaction = reaction(
    () => document.root.getPropValue('title'),
    () => {
      for (const attempt of [
        () => {
          engine.project.config = { mode: 'leaked' }
        },
        () => engine.project.set('customAgentState', 'leaked'),
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

  const receipt = capability.execute(plan.planId)

  assert.equal(receipt.status, 'committed')
  assert.equal(blocked.length, 2)
  assert.ok(blocked.every(error => /project mutation is blocked/i.test(error.message)))
  assert.deepEqual(engine.project.config, { mode: 'before' })
  assert.equal(engine.project.get('customAgentState'), 'before')
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
    { component: originalComponent, override: true, version: '1.0.0' },
  )
  const originalEntry = registry.get('Page')
  originalEntry.extensions = new Map([['origin', 'before']])
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
  assert.strictEqual(restoredEntry, originalEntry)
  assert.strictEqual(restoredEntry.meta, originalMeta)
  assert.strictEqual(restoredEntry.component, originalComponent)
  assert.equal(restoredEntry.version, '1.0.0')
  assert.equal(restoredEntry.usageCount, 1)
  assert.deepEqual([...restoredEntry.extensions], [['origin', 'before']])
  assert.equal(originalMeta.title, 'before')

  const changesAfterRollback = metadataChanges
  originalMeta.setMetadata({ componentName: 'Page', title: 'listener-still-live' })
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
  assert.throws(() => originalMeta.setMetadata({ componentName: 'Page', title: 'zombie' }), /disposed/)
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
