import assert from 'node:assert/strict'
import test from 'node:test'
import { action, observable } from 'mobx'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

const createHistoryFixture = async ({ postRestore } = {}) => {
  const core = await loadCore()
  const state = observable.box({ value: 'before' }, { deep: false })
  const setState = action(data => state.set(data))
  let restore = setState
  const history = new core.History(
    () => state.get(),
    data => restore(data),
    undefined,
    postRestore,
  )

  history.savePoint()
  setState({ value: 'after' })
  history.savePoint()

  return {
    history,
    setRestore(nextRestore) {
      restore = nextRestore
    },
    setState,
    state,
  }
}

test('history restores the exact source snapshot when a partial target restore fails', async t => {
  const fixture = await createHistoryFixture()
  const { history, setState, state } = fixture
  t.after(() => history.destroy())

  const targetFailure = new Error('target restore failed after a partial write')
  fixture.setRestore(data => {
    if (data.value === 'before') {
      setState({ value: 'partial-target' })
      throw targetFailure
    }
    setState(data)
  })

  const error = await captureFailure(() => history.back())
  assert.equal(error, targetFailure)
  assert.equal(error.committed, undefined)
  assert.deepEqual(state.get(), { value: 'after' })
  assert.deepEqual(JSON.parse(history.hotData), { value: 'after' })
  assert.equal(history.isUndoable(), true)
  assert.equal(history.isRedoable(), false)

  fixture.setRestore(setState)
  history.back()
  assert.deepEqual(state.get(), { value: 'before' })
  assert.deepEqual(JSON.parse(history.hotData), { value: 'before' })
  assert.equal(history.isUndoable(), false)
  assert.equal(history.isRedoable(), true)
})

test('history fails closed when neither target nor source snapshot can be restored exactly', async t => {
  const fixture = await createHistoryFixture()
  const { history, setState, state } = fixture
  t.after(() => {
    try {
      history.destroy()
    } catch {
      // The test deliberately poisons the restore substrate; disposal still
      // closes its timers and reaction before surfacing any cleanup error.
    }
  })

  fixture.setRestore(data => {
    if (data.value === 'before') {
      setState({ value: 'partial-target' })
      throw new Error('target restore failed')
    }
    setState({ value: 'partial-source' })
    throw new Error('source rollback failed')
  })

  const error = await captureFailure(() => history.back())
  assert.equal(error.committed, true)
  assert.ok(error.errors.some(cause => cause?.message.includes('History is invalid')))
  assert.deepEqual(state.get(), { value: 'partial-source' })
  assert.deepEqual(JSON.parse(history.hotData), { value: 'after' })

  for (const operation of [() => history.back(), () => history.forward(), () => history.savePoint()]) {
    const invalidError = await captureFailure(operation)
    assert.match(invalidError.message, /history restore substrate is invalid/)
  }
})

test('post-restore observer failure reports a committed target snapshot', async t => {
  let postRestoreCalls = 0
  const fixture = await createHistoryFixture({
    postRestore() {
      postRestoreCalls += 1
      throw new Error('post-restore observer failed')
    },
  })
  const { history, state } = fixture
  t.after(() => history.destroy())

  const error = await captureFailure(() => history.back())
  assert.equal(error.committed, true)
  assert.equal(postRestoreCalls, 1)
  assert.ok(error.errors.some(cause => cause?.message === 'post-restore observer failed'))
  assert.deepEqual(state.get(), { value: 'before' })
  assert.deepEqual(JSON.parse(history.hotData), { value: 'before' })
  assert.equal(history.isUndoable(), false)
  assert.equal(history.isRedoable(), true)
})
