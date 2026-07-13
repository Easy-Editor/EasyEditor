import assert from 'node:assert/strict'
import test from 'node:test'

import { AgentPlanConfirmationSlot } from '../src/components/ai-chat/agent-plan-confirmation.mjs'

test('confirmation consumes one proposal before resolving and rejects replay', async () => {
  const slot = new AgentPlanConfirmationSlot()
  const controller = new AbortController()
  const decision = slot.request('proposal-1', controller.signal)

  assert.equal(slot.pendingProposalId, 'proposal-1')
  assert.equal(slot.approve('proposal-1'), true)
  assert.equal(slot.approve('proposal-1'), false)
  assert.equal(slot.reject('proposal-1'), false)
  assert.equal(await decision, true)
  assert.equal(slot.pendingProposalId, undefined)
})

test('rejection, abort, and supersession all settle without leaving authority pending', async () => {
  const slot = new AgentPlanConfirmationSlot()
  const firstController = new AbortController()
  const first = slot.request('proposal-first', firstController.signal)
  const secondController = new AbortController()
  const second = slot.request('proposal-second', secondController.signal)

  await assert.rejects(first, error => error.code === 'dashboard.agent.confirmation.superseded')
  assert.equal(slot.reject('proposal-second'), true)
  assert.equal(await second, false)

  const thirdController = new AbortController()
  const third = slot.request('proposal-third', thirdController.signal)
  thirdController.abort()
  await assert.rejects(third, error => error.code === 'dashboard.agent.confirmation.aborted')
  assert.equal(slot.pendingProposalId, undefined)
})
