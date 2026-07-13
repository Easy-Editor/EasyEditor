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
