import assert from 'node:assert/strict'
import test from 'node:test'

import { AgentRequestSlot } from '../src/components/ai-chat/agent-request-slot.mjs'

test('Agent request slot rejects same-tick duplicate work and cancellation owns the active request', () => {
  const slot = new AgentRequestSlot()
  const first = slot.begin()

  assert.ok(first)
  assert.equal(slot.begin(), undefined)

  slot.cancel()
  assert.equal(first.signal.aborted, true)
  assert.equal(slot.release(first), true)

  const next = slot.begin()
  assert.ok(next)
  assert.notStrictEqual(next, first)
  assert.equal(slot.release(first), false)
  assert.equal(slot.release(next), true)
})
