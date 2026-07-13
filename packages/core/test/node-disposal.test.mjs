import assert from 'node:assert/strict'
import test from 'node:test'
import { runInAction } from 'mobx'
import { loadCore } from './helpers/kernel.mjs'

const projectSchema = () => ({
  id: 'node-disposal-project',
  version: '0.0.1',
  componentsMap: [],
  componentsTree: [
    {
      docId: 'node-disposal-document',
      id: 'root',
      componentName: 'Page',
      props: {},
      children: [{ id: 'leaf', componentName: 'Text', props: {}, children: [] }],
    },
  ],
})

async function createHarness(t) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(projectSchema(), true)
  return { core, document: engine.project.currentDocument, engine }
}

function captureEmptyObservableCollections(node) {
  node.props.import(null)
  assert.equal(node.props.items.length, 0)
  assert.equal(node.children.children.length, 0)
  return {
    children: node.children.children,
    items: node.props.items,
  }
}

function assertDetachedCollectionsDoNotMutateDocument(document, collections, message) {
  const mutationVersion = document.mutationVersion
  runInAction(() => {
    collections.children.push(null)
    collections.items.push(null)
  })
  assert.equal(document.mutationVersion, mutationVersion, message)
}

test('engine destroy recursively disposes cached descendant observable collections', async t => {
  const { document, engine } = await createHarness(t)
  const collections = captureEmptyObservableCollections(document.getNode('leaf'))

  await engine.destroy()

  assertDetachedCollectionsDoNotMutateDocument(
    document,
    collections,
    'detached descendant arrays must not retain active mutation interceptors after destroy',
  )
})

test('document import disposes cached observable collections from removed nodes', async t => {
  const { document } = await createHarness(t)
  const collections = captureEmptyObservableCollections(document.getNode('leaf'))

  document.import({
    docId: document.id,
    id: 'root',
    componentName: 'Page',
    props: {},
    children: [],
  })

  assertDetachedCollectionsDoNotMutateDocument(
    document,
    collections,
    'removed node arrays must not retain mutation interceptors after document import',
  )
})

test('node removal disposes cached observable collections from the removed subtree', async t => {
  const { document } = await createHarness(t)
  const leaf = document.getNode('leaf')
  const collections = captureEmptyObservableCollections(leaf)

  document.removeNode(leaf)

  assert.equal(document.getNode('leaf'), null)
  assertDetachedCollectionsDoNotMutateDocument(
    document,
    collections,
    'removed node arrays must not retain mutation interceptors after purge',
  )
})

test('replacing Props purges the old instance while assigning the same instance is a no-op', async t => {
  const { core, document } = await createHarness(t)
  const root = document.root
  root.props.import(null)
  const detachedItems = root.props.items
  const replacement = new core.Props(root, { replacement: true })

  root.setProps(replacement)
  const afterReplacement = document.mutationVersion
  root.setProps(replacement)
  assert.equal(document.mutationVersion, afterReplacement, 'assigning the current Props instance must remain a no-op')

  runInAction(() => detachedItems.push(null))
  assert.equal(
    document.mutationVersion,
    afterReplacement,
    'the cached items array from the replaced Props instance must be detached',
  )
})
