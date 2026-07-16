import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

const createUnsetSchema = () => {
  const schema = createProjectSchema({ id: 'update-props-unset' })
  schema.componentsTree[0].props = {
    title: 'before',
    style: { color: 'red', size: 12 },
    options: { nested: { enabled: true } },
  }
  schema.componentsTree[0].$dashboard = {
    layout: 'grid',
    rect: { x: 10, y: 20 },
  }
  return schema
}

const createHarness = async (t, trustPolicy = 'legacyTrusted') => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createUnsetSchema(), true)
  return { core, document: engine.project.currentDocument, engine }
}

test('updateProps unsets nested props and extras as one undoable transaction with property event parity', async t => {
  const { core, document, engine } = await createHarness(t)
  const root = document.root
  const before = structuredClone(document.exportRaw())
  const propEvents = []
  const designerEvents = []
  const disposeProp = root.onPropChange(event => propEvents.push(event))
  const disposeDesigner = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, event =>
    designerEvents.push(event),
  )
  t.after(disposeProp)
  t.after(disposeDesigner)

  const result = engine.transactions.runOnDocument(document, [
    {
      type: 'updateProps',
      nodeId: root.id,
      props: { title: 'after' },
      unsetPropPaths: ['style.color'],
      unsetExtraPaths: ['$dashboard.rect.x'],
    },
  ])

  const raw = document.exportRaw()
  assert.equal(result.ok, true)
  assert.equal(result.commandCount, 1)
  assert.equal(raw.props.title, 'after')
  assert.deepEqual(raw.props.style, { size: 12 })
  assert.equal(Object.hasOwn(raw.props.style, 'color'), false)
  assert.deepEqual(raw.$dashboard, { layout: 'grid', rect: { y: 20 } })
  assert.equal(Object.hasOwn(raw.$dashboard.rect, 'x'), false)
  assert.equal(propEvents.length, 3)
  assert.equal(designerEvents.length, 3)
  assert.deepEqual(
    propEvents.map(({ key, oldValue, newValue }) => ({ key, oldValue, newValue })),
    [
      { key: 'title', oldValue: 'before', newValue: 'after' },
      { key: 'color', oldValue: 'red', newValue: undefined },
      { key: 'x', oldValue: 10, newValue: undefined },
    ],
  )
  assert.deepEqual(
    designerEvents.map(({ key, oldValue, newValue }) => ({ key, oldValue, newValue })),
    propEvents.map(({ key, oldValue, newValue }) => ({ key, oldValue, newValue })),
  )
  assert.equal(document.history.isUndoable(), true)

  document.history.back()
  assert.deepEqual(document.exportRaw(), before)
  assert.equal(document.history.isUndoable(), false, 'one undo must consume the set and both unsets')

  document.history.forward()
  assert.equal(document.exportRaw().props.title, 'after')
  assert.equal(Object.hasOwn(document.exportRaw().props.style, 'color'), false)
  assert.equal(Object.hasOwn(document.exportRaw().$dashboard.rect, 'x'), false)
})

test('exact unset remains declarative under both trust policies and can be set back to the same literal', async t => {
  for (const trustPolicy of ['legacyTrusted', 'agentRestricted']) {
    const { document, engine } = await createHarness(t, trustPolicy)
    const root = document.root

    engine.commands.execute({ type: 'updateProps', nodeId: root.id, unsetPropPaths: ['title'] })
    assert.equal(Object.hasOwn(document.exportRaw().props, 'title'), false, trustPolicy)

    engine.commands.execute({ type: 'updateProps', nodeId: root.id, props: { title: 'before' } })
    assert.equal(Object.hasOwn(document.exportRaw().props, 'title'), true, trustPolicy)
    assert.equal(document.exportRaw().props.title, 'before', trustPolicy)
  }
})

test('valid absent unset paths are idempotent no-ops with no mutation, events, or History', async t => {
  const { core, document, engine } = await createHarness(t)
  const root = document.root
  const before = structuredClone(document.exportRaw())
  const beforeVersion = document.mutationVersion
  const beforeHistory = document.history.getState()
  let propEvents = 0
  let designerEvents = 0
  const disposeProp = root.onPropChange(() => {
    propEvents += 1
  })
  const disposeDesigner = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => {
    designerEvents += 1
  })
  t.after(disposeProp)
  t.after(disposeDesigner)

  const result = engine.commands.execute({
    type: 'updateProps',
    nodeId: root.id,
    unsetPropPaths: ['missing.deep'],
    unsetExtraPaths: ['missing.deep'],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(document.exportRaw(), before)
  assert.equal(document.mutationVersion, beforeVersion)
  assert.equal(document.history.getState(), beforeHistory)
  assert.equal(propEvents, 0)
  assert.equal(designerEvents, 0)
})

test('unset validation rejects malformed, over-budget, duplicate, overlapping, and set-overlapping paths atomically', async t => {
  const { core, document, engine } = await createHarness(t)
  const root = document.root
  const accessorPaths = []
  Object.defineProperty(accessorPaths, 0, {
    enumerable: true,
    get() {
      throw new Error('validator must not invoke unset path accessors')
    },
  })
  accessorPaths.length = 1
  const cases = [
    ['non-array', { unsetPropPaths: 'style.color' }, 'unset.paths.type'],
    ['sparse', { unsetPropPaths: Array(1) }, 'unset.path.missing'],
    ['accessor', { unsetPropPaths: accessorPaths }, 'unset.path.missing'],
    ['non-string', { unsetPropPaths: [1] }, 'unset.path.invalid'],
    ['empty', { unsetPropPaths: [''] }, 'unset.path.invalid'],
    ['outer whitespace', { unsetPropPaths: [' style.color'] }, 'unset.path.invalid'],
    ['empty segment', { unsetPropPaths: ['style..color'] }, 'unset.path.invalid'],
    ['bracket syntax', { unsetPropPaths: ['items[0].title'] }, 'unset.path.invalid'],
    ['path length', { unsetPropPaths: ['x'.repeat(257)] }, 'unset.path.invalid'],
    [
      'path depth',
      { unsetPropPaths: [Array.from({ length: 33 }, (_, index) => `s${index}`).join('.')] },
      'unset.path.invalid',
    ],
    ['dangerous segment', { unsetPropPaths: ['style.__proto__.color'] }, 'unset.path.dangerous'],
    ['duplicate', { unsetPropPaths: ['style.color', 'style.color'] }, 'unset.path.duplicate'],
    ['ancestor overlap', { unsetPropPaths: ['style', 'style.color'] }, 'unset.path.overlap'],
    [
      'set ancestor overlap',
      { props: { style: { color: 'blue' } }, unsetPropPaths: ['style.color'] },
      'updateProps.set-unset.overlap',
    ],
    [
      'set descendant overlap',
      { props: { 'style.color': 'blue' }, unsetPropPaths: ['style'] },
      'updateProps.set-unset.overlap',
    ],
    [
      'set dangerous descendant overlap',
      { props: { 'style.__proto__.color': 'blue' }, unsetPropPaths: ['style'] },
      'updateProps.set-unset.overlap',
    ],
    [
      'legacy bracket set overlap',
      { props: { 'style[color]': 'blue' }, unsetPropPaths: ['style.color'] },
      'updateProps.set-unset.overlap',
    ],
    [
      'extra set overlap',
      { extras: { $dashboard: { layout: 'free' } }, unsetExtraPaths: ['$dashboard.layout'] },
      'updateProps.set-unset.overlap',
    ],
    [
      'over budget',
      { unsetPropPaths: Array.from({ length: 101 }, (_, index) => `field${index}`) },
      'unset.paths.limit',
    ],
    [
      'character budget',
      { unsetPropPaths: Array.from({ length: 100 }, (_, index) => `field${index}.${'x'.repeat(80)}`) },
      'unset.paths.limit',
    ],
  ]

  for (const [label, patch, issueCode] of cases) {
    const before = structuredClone(document.exportRaw())
    const beforeVersion = document.mutationVersion
    const beforeHistory = document.history.getState()
    const error = await captureFailure(() =>
      engine.commands.execute({
        type: 'updateProps',
        nodeId: root.id,
        props: { title: 'must-not-commit' },
        ...patch,
      }),
    )

    assert.ok(error instanceof core.CommandValidationError, label)
    assert.ok(
      error.issues.some(issue => issue.code === issueCode),
      `${label}: expected ${issueCode}`,
    )
    assert.deepEqual(document.exportRaw(), before, label)
    assert.equal(document.mutationVersion, beforeVersion, label)
    assert.equal(document.history.getState(), beforeHistory, label)
  }
})

test('a later command failure rolls unset schema and deferred events back without a History unit', async t => {
  const { core, document, engine } = await createHarness(t)
  const root = document.root
  const before = structuredClone(document.exportRaw())
  let propEvents = 0
  let designerEvents = 0
  const disposeProp = root.onPropChange(() => {
    propEvents += 1
  })
  const disposeDesigner = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => {
    designerEvents += 1
  })
  t.after(disposeProp)
  t.after(disposeDesigner)

  const error = await captureFailure(() =>
    engine.transactions.run([
      { type: 'updateProps', nodeId: root.id, unsetPropPaths: ['style.color'] },
      { type: 'updateProps', nodeId: 'missing-node', props: { title: 'fail' } },
    ]),
  )

  assert.match(error.message, /does not exist/i)
  assert.deepEqual(document.exportRaw(), before)
  assert.equal(document.history.isUndoable(), false)
  assert.equal(propEvents, 0)
  assert.equal(designerEvents, 0)
})

test('null and undefined set values are not interpreted as unset paths', async t => {
  const { document, engine } = await createHarness(t)
  const root = document.root
  const before = structuredClone(document.exportRaw())

  engine.commands.execute({
    type: 'updateProps',
    nodeId: root.id,
    props: { nullable: null, undefinedValue: undefined, 'style.color': null },
  })

  const props = document.exportRaw().props
  assert.equal(Object.hasOwn(props, 'nullable'), true)
  assert.equal(props.nullable, null)
  assert.equal(Object.hasOwn(props, 'undefinedValue'), true)
  assert.equal(props.undefinedValue, undefined)
  assert.equal(Object.hasOwn(props.style, 'color'), true)
  assert.equal(props.style.color, null)

  document.history.back()
  assert.deepEqual(document.exportRaw(), before)
  document.history.forward()
  assert.equal(Object.hasOwn(document.exportRaw().props, 'nullable'), true)
  assert.equal(document.exportRaw().props.nullable, null)
  assert.equal(Object.hasOwn(document.exportRaw().props.style, 'color'), true)
  assert.equal(document.exportRaw().props.style.color, null)
})
