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

  const precreatedContext = engine.plugins.get('precreated-context').ctx
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
