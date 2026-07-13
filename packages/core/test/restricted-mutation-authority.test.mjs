import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

function captureState(engine) {
  const document = engine.project.currentDocument
  const materialState = engine.materials.captureTransactionState()
  return {
    document,
    historyData: document.history.hotData,
    historyState: document.history.getState(),
    materialEntries: [...materialState.entries.entries()].sort(([a], [b]) => a.localeCompare(b)),
    materialPendingEntries: [...materialState.pendingEntries.entries()].sort(([a], [b]) => a.localeCompare(b)),
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
  document.root.props = orphan.props
  assert.strictEqual(document.root.props, orphan.props)
  document.root.props = originalProps
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
