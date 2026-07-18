import assert from 'node:assert/strict'
import test from 'node:test'
import { createDashboardEditorSurfaceLifecycle } from '../src/editor/surface-lifecycle.mjs'

const nextMicrotask = () => Promise.resolve()

test('suspends and resumes immediately when no React surface is mounted', async () => {
  const lifecycle = createDashboardEditorSurfaceLifecycle()

  await lifecycle.suspend()
  assert.equal(lifecycle.getSnapshot(), 'suspended')

  await lifecycle.resume()
  assert.equal(lifecycle.getSnapshot(), 'mounted')
})

test('waits for the mounted React surface to acknowledge both committed transitions', async () => {
  const lifecycle = createDashboardEditorSurfaceLifecycle()
  const phases = []
  const unsubscribe = lifecycle.subscribe(() => phases.push(lifecycle.getSnapshot()))
  const participant = lifecycle.registerParticipant()

  let suspended = false
  const suspension = lifecycle.suspend().then(() => {
    suspended = true
  })
  assert.equal(lifecycle.getSnapshot(), 'suspending')
  await nextMicrotask()
  assert.equal(suspended, false)

  participant.acknowledge('mounted')
  await nextMicrotask()
  assert.equal(suspended, false)
  participant.acknowledge('suspending')
  await suspension
  assert.equal(lifecycle.getSnapshot(), 'suspended')

  let resumed = false
  const resumption = lifecycle.resume().then(() => {
    resumed = true
  })
  assert.equal(lifecycle.getSnapshot(), 'resuming')
  await nextMicrotask()
  assert.equal(resumed, false)

  participant.acknowledge('resuming')
  await resumption
  assert.equal(lifecycle.getSnapshot(), 'mounted')
  assert.deepEqual(phases, ['suspending', 'suspended', 'resuming', 'mounted'])

  participant.dispose()
  unsubscribe()
})

test('unblocks a pending transition when its React surface is disposed', async () => {
  const lifecycle = createDashboardEditorSurfaceLifecycle()
  const participant = lifecycle.registerParticipant()

  const suspension = lifecycle.suspend()
  assert.equal(lifecycle.getSnapshot(), 'suspending')
  participant.dispose()
  await suspension

  assert.equal(lifecycle.getSnapshot(), 'suspended')
})
