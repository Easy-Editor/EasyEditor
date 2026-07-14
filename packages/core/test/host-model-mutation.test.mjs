import assert from 'node:assert/strict'
import test from 'node:test'
import { reaction } from 'mobx'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

function assertCommittedObserverFailure(error, messages) {
  assert.equal(error.name, 'TransactionCommittedError')
  assert.equal(error.committed, true)
  assert.equal(error.result, undefined)
  assert.ok(error.errors.length >= messages.length)
  assert.ok(
    error.errors.every(cause => !(cause instanceof AggregateError)),
    'observer errors must be flattened',
  )
  for (const message of messages) {
    assert.ok(
      error.errors.some(cause => cause?.message === message),
      `missing committed observer error: ${message}`,
    )
  }
}

function assertCommittedCleanupFailure(error, message) {
  assert.equal(error.name, 'TransactionCommittedError')
  assert.equal(error.committed, true)
  assert.equal(error.result, undefined)
  assert.ok(
    error.errors.some(cause => cause?.message === message),
    `missing committed cleanup error: ${message}`,
  )
  assert.ok(
    error.errors.every(cause => !(cause instanceof AggregateError)),
    'cleanup errors must be flattened',
  )
}

function installThrowingReaction(track, effectMessage, observerMessage) {
  return reaction(
    track,
    () => {
      throw new Error(effectMessage)
    },
    {
      onError() {
        throw new Error(observerMessage)
      },
    },
  )
}

test('loadProject exposes a committed outcome when deferred observers fail', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.loadProject(createProjectSchema({ id: 'host-load-before' }), true)

  const disposeEvent = engine.designer.onEvent(core.DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, () => {
    throw new Error('load deferred event observer failed')
  })
  t.after(disposeEvent)

  const schema = createProjectSchema({
    id: 'host-load-committed',
    componentsTree: [
      {
        docId: 'host-load-page',
        id: 'host-load-root',
        componentName: 'Page',
        props: { title: 'loaded exactly once' },
        children: [],
      },
    ],
  })
  let attempts = 0
  const load = () => {
    attempts += 1
    engine.loadProject(schema, true)
  }

  const error = await captureFailure(load)
  if (error.committed !== true) {
    try {
      load()
    } catch {
      // A caller that cannot distinguish a committed failure may retry the
      // already-applied mutation, regardless of whether the retry also fails.
    }
  }

  assertCommittedObserverFailure(error, ['load deferred event observer failed'])
  assert.equal(attempts, 1, 'a committed outcome lets the host avoid applying the replacement twice')
  assert.equal(engine.project.export().id, 'host-load-committed')
  assert.equal(engine.project.documents.length, 1)
  assert.equal(engine.project.currentDocument.id, 'host-load-page')
  assert.equal(engine.project.currentDocument.root.getPropValue('title'), 'loaded exactly once')
})

test('undo and redo expose committed outcomes when reactions and deferred observers fail', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.loadProject(createProjectSchema({ id: 'host-history-committed' }), true)
  const document = engine.project.currentDocument
  const root = document.root
  engine.commands.execute({ type: 'updateProps', nodeId: root.id, props: { title: 'after' } })

  const disposeEvent = engine.designer.onEvent(core.DESIGNER_EVENT.CURRENT_DOCUMENT_CHANGE, () => {
    throw new Error('history deferred event observer failed')
  })
  t.after(disposeEvent)

  let undoAttempts = 0
  const undoError = await captureFailure(() => {
    undoAttempts += 1
    engine.undo(document)
  })
  if (undoError.committed !== true) {
    try {
      undoAttempts += 1
      engine.undo(document)
    } catch {
      // See the loadProject retry branch above.
    }
  }
  assertCommittedObserverFailure(undoError, ['history deferred event observer failed'])
  assert.equal(undoAttempts, 1, 'a committed outcome prevents a second undo')
  assert.equal(root.getPropValue('title'), 'before')
  assert.equal(document.history.isUndoable(), false)
  assert.equal(document.history.isRedoable(), true)

  let redoAttempts = 0
  const disposeRedoReaction = installThrowingReaction(
    () => root.getPropValue('title'),
    'redo reaction effect failed',
    'redo reaction observer failed',
  )
  const redoError = await captureFailure(() => {
    redoAttempts += 1
    engine.redo(document.id)
  })
  if (redoError.committed !== true) {
    try {
      redoAttempts += 1
      engine.redo(document.id)
    } catch {
      // See the loadProject retry branch above.
    }
  }
  disposeRedoReaction()

  assertCommittedObserverFailure(redoError, ['redo reaction observer failed', 'history deferred event observer failed'])
  assert.equal(redoAttempts, 1, 'a committed outcome prevents a second redo')
  assert.equal(root.getPropValue('title'), 'after')
  assert.equal(document.history.isUndoable(), true)
  assert.equal(document.history.isRedoable(), false)
})

test('replacement load keeps the new project authoritative when retired-project cleanup fails', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema({ id: 'replacement-cleanup-before' }), true)

  const retiredDocument = engine.project.currentDocument
  const retiredRoot = retiredDocument.root
  const cleanupMessage = 'replacement cleanup failed once'
  let cleanupAttempts = 0
  core.registerTestSettingTopEntryDisposer(retiredRoot.settingEntry, () => {
    cleanupAttempts += 1
    if (cleanupAttempts === 1) throw new Error(cleanupMessage)
  })

  const replacementSchema = createProjectSchema({
    id: 'replacement-cleanup-after',
    componentsTree: [
      {
        docId: 'replacement-cleanup-after-document',
        id: 'replacement-cleanup-after-root',
        componentName: 'Page',
        props: { title: 'replacement committed' },
        children: [],
      },
    ],
  })
  const error = await captureFailure(() => engine.loadProject(replacementSchema, true))

  assertCommittedCleanupFailure(error, cleanupMessage)
  assert.equal(cleanupAttempts, 1)
  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(engine.project.export().id, 'replacement-cleanup-after')
  assert.equal(engine.project.documents.length, 1)
  assert.equal(engine.project.currentDocument.id, 'replacement-cleanup-after-document')
  assert.equal(engine.project.currentDocument.root.getPropValue('title'), 'replacement committed')
  assert.equal(retiredDocument.root, null)
  assert.equal(retiredRoot.isPurged, true)
  assert.throws(() => retiredRoot.settingEntry, /node generation is disposed/)
  assert.throws(() => retiredDocument.exportRaw(), /document generation is disposed/)

  await engine.destroy()

  assert.equal(cleanupAttempts, 2, 'destroy must retry the privately retained cleanup')
  assert.equal(engine.lifecycleState, 'disposed')
})

test('bare unload keeps the empty project authoritative when document cleanup fails', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema({ id: 'unload-cleanup-before' }), true)

  const retiredDocument = engine.project.currentDocument
  const retiredRoot = retiredDocument.root
  const cleanupMessage = 'unload cleanup failed once'
  let cleanupAttempts = 0
  core.registerTestSettingTopEntryDisposer(retiredRoot.settingEntry, () => {
    cleanupAttempts += 1
    if (cleanupAttempts === 1) throw new Error(cleanupMessage)
  })

  const error = await captureFailure(() => engine.unloadProject())

  assertCommittedCleanupFailure(error, cleanupMessage)
  assert.equal(cleanupAttempts, 1)
  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(engine.project.documents.length, 0)
  assert.equal(engine.project.currentDocument, undefined)
  assert.equal(retiredDocument.root, null)
  assert.equal(retiredRoot.isPurged, true)
  assert.throws(() => retiredRoot.settingEntry, /node generation is disposed/)
  assert.throws(() => retiredDocument.exportRaw(), /document generation is disposed/)

  await engine.destroy()

  assert.equal(cleanupAttempts, 2, 'destroy must retry the privately retained cleanup')
  assert.equal(engine.lifecycleState, 'disposed')
})

test('replacement construction failure preserves the old project and terminally cleans provisional identities', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema({ id: 'provisional-construction-before' }), true)

  const originalProject = structuredClone(engine.project.export())
  const originalDocuments = engine.project.documents
  const originalDocument = engine.project.currentDocument
  const originalRoot = originalDocument.root
  const events = { add: 0, remove: 0, open: 0 }
  const disposeAdd = engine.project.onDocumentAdd(() => {
    events.add += 1
  })
  const disposeRemove = engine.project.onDocumentRemove(() => {
    events.remove += 1
  })
  const disposeOpen = engine.project.onCurrentDocumentChange(() => {
    events.open += 1
  })
  t.after(disposeAdd)
  t.after(disposeRemove)
  t.after(disposeOpen)

  let rejectConstruction = true
  const provisionalRoots = []
  engine.materials.createComponentMeta({
    componentName: 'ProvisionalFailurePage',
    configure: {
      advanced: {
        initialChildren(node) {
          provisionalRoots.push(node)
          if (rejectConstruction) throw new Error('provisional material construction failed')
          return []
        },
      },
    },
  })
  const replacementSchema = {
    id: 'provisional-construction-after',
    version: '1.0.0',
    componentsMap: [],
    componentsTree: [
      {
        docId: 'provisional-construction-document',
        id: 'provisional-construction-root',
        componentName: 'ProvisionalFailurePage',
        props: { title: 'replacement' },
      },
    ],
  }

  const error = await captureFailure(() => engine.loadProject(replacementSchema, true))
  const failedRoot = provisionalRoots[0]
  const failedDocument = failedRoot.document

  assert.match(error.message, /provisional material construction failed/)
  assert.notEqual(error.committed, true)
  assert.deepEqual(engine.project.export(), originalProject)
  assert.deepEqual(engine.project.documents, originalDocuments)
  assert.strictEqual(engine.project.currentDocument, originalDocument)
  assert.strictEqual(engine.project.currentDocument.root, originalRoot)
  assert.deepEqual(events, { add: 0, remove: 0, open: 0 })
  assert.equal(failedRoot.isPurged, true)
  assert.equal(failedDocument.root, null)
  assert.throws(() => failedRoot.settingEntry, /node generation is disposed/)
  assert.throws(() => failedDocument.exportRaw(), /document construction failed/)
  assert.equal(engine.lifecycleState, 'ready')

  rejectConstruction = false
  engine.loadProject(replacementSchema, true)

  assert.equal(provisionalRoots.length, 2)
  assert.notStrictEqual(provisionalRoots[1], failedRoot)
  assert.equal(engine.project.export().id, 'provisional-construction-after')
  assert.equal(engine.project.currentDocument.id, 'provisional-construction-document')
  assert.equal(engine.project.currentDocument.root.componentName, 'ProvisionalFailurePage')
  assert.equal(engine.lifecycleState, 'ready')
})
