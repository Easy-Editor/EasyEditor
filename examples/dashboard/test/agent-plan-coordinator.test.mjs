import assert from 'node:assert/strict'
import test from 'node:test'

import { AgentPlanCoordinatorError, coordinatePreparedAgentPlan } from '../src/editor/agent-plan-coordinator.mjs'

const createPreview = (overrides = {}) =>
  Object.freeze({
    baseRevision: 'revision-1',
    commandCount: 2,
    documentId: 'document-1',
    effects: Object.freeze([
      Object.freeze({ commandIndex: 0, nodeIds: Object.freeze(['private-node-1']), type: 'updateProps' }),
      Object.freeze({ commandIndex: 1, nodeIds: Object.freeze(['private-node-2']), type: 'removeNode' }),
    ]),
    planId: 'plan-1',
    state: 'prepared',
    ...overrides,
  })

const createClock = (start = 1_000) => {
  let now = start
  let nextHandle = 0
  const timers = new Map()
  const runDueTimers = () => {
    for (const [handle, timer] of [...timers]) {
      if (timer.at > now) continue
      timers.delete(handle)
      timer.callback()
    }
  }
  return {
    clearTimeout(handle) {
      timers.delete(handle)
    },
    now: () => now,
    setTimeout(callback, delay) {
      nextHandle += 1
      timers.set(nextHandle, { at: now + Math.max(0, delay), callback })
      return nextHandle
    },
    advance(milliseconds) {
      now += milliseconds
      runDueTimers()
    },
    jump(milliseconds) {
      now += milliseconds
    },
  }
}

const createInput = overrides => ({
  authority: {
    approveAndExecute: planId => Object.freeze({ committed: true, planId, status: 'committed' }),
    getPreparedPlanPreview: () => createPreview(),
  },
  clock: createClock(),
  confirmationTimeoutMs: 100,
  confirmProposal: async () => true,
  documentId: 'document-1',
  message: Object.freeze({ content: '可以更新画布', role: 'assistant' }),
  planId: 'plan-1',
  proposalId: 'proposal-1',
  signal: new AbortController().signal,
  ...overrides,
})

test('coordinator reads the authoritative preview, confirms a safe summary, then executes exactly once', async () => {
  const calls = []
  const preview = createPreview()
  let confirmedProposal
  const receipt = await coordinatePreparedAgentPlan(
    createInput({
      authority: {
        getPreparedPlanPreview(planId) {
          calls.push(`lookup:${planId}`)
          return preview
        },
        approveAndExecute(planId) {
          calls.push(`execute:${planId}`)
          return Object.freeze({ committed: true, planId, status: 'committed' })
        },
      },
      async confirmProposal(proposal) {
        calls.push('confirm')
        confirmedProposal = proposal
        return true
      },
    }),
  )

  assert.deepEqual(calls, ['lookup:plan-1', 'confirm', 'execute:plan-1'])
  assert.equal(receipt.planId, preview.planId)
  assert.equal(confirmedProposal.proposalId, 'proposal-1')
  assert.equal(confirmedProposal.summary.commandCount, 2)
  assert.equal(confirmedProposal.summary.destructiveCommandCount, 1)
  assert.doesNotMatch(JSON.stringify(confirmedProposal), /plan-1|document-1|private-node/)
})

test('mismatched authoritative plans fail before confirmation or execution', async () => {
  for (const preview of [createPreview({ planId: 'other-plan' }), createPreview({ documentId: 'other-document' })]) {
    let confirmCount = 0
    let executeCount = 0
    await assert.rejects(
      coordinatePreparedAgentPlan(
        createInput({
          authority: {
            getPreparedPlanPreview: () => preview,
            approveAndExecute: () => {
              executeCount += 1
            },
          },
          confirmProposal: async () => {
            confirmCount += 1
            return true
          },
        }),
      ),
      error => error instanceof AgentPlanCoordinatorError && error.code === 'dashboard.agent.invalidWorkerResponse',
    )
    assert.equal(confirmCount, 0)
    assert.equal(executeCount, 0)
  }
})

test('explicit rejection never executes the prepared plan', async () => {
  let executeCount = 0
  await assert.rejects(
    coordinatePreparedAgentPlan(
      createInput({
        authority: {
          getPreparedPlanPreview: () => createPreview(),
          approveAndExecute: () => {
            executeCount += 1
          },
        },
        confirmProposal: async () => false,
      }),
    ),
    error => error.code === 'dashboard.agent.rejected',
  )
  assert.equal(executeCount, 0)
})

test('abort settles a pending confirmation without executing', async () => {
  const controller = new AbortController()
  let executeCount = 0
  const pending = coordinatePreparedAgentPlan(
    createInput({
      authority: {
        getPreparedPlanPreview: () => createPreview(),
        approveAndExecute: () => {
          executeCount += 1
        },
      },
      confirmProposal: () => new Promise(() => {}),
      signal: controller.signal,
    }),
  )

  controller.abort()
  await assert.rejects(pending, error => error.code === 'dashboard.agent.aborted')
  assert.equal(executeCount, 0)
})

test('confirmation timeout ignores a late decision and never executes', async () => {
  const clock = createClock()
  let resolveConfirmation
  let executeCount = 0
  const pending = coordinatePreparedAgentPlan(
    createInput({
      authority: {
        getPreparedPlanPreview: () => createPreview(),
        approveAndExecute: () => {
          executeCount += 1
        },
      },
      clock,
      confirmProposal: () =>
        new Promise(resolve => {
          resolveConfirmation = resolve
        }),
    }),
  )

  clock.advance(100)
  await assert.rejects(pending, error => error.code === 'dashboard.agent.confirmationExpired')
  resolveConfirmation(true)
  await Promise.resolve()
  assert.equal(executeCount, 0)
})

test('a confirmation that resolves after its deadline is rejected by the second clock check', async () => {
  const clock = createClock()
  let executeCount = 0
  await assert.rejects(
    coordinatePreparedAgentPlan(
      createInput({
        authority: {
          getPreparedPlanPreview: () => createPreview(),
          approveAndExecute: () => {
            executeCount += 1
          },
        },
        clock,
        confirmProposal: async () => {
          clock.jump(100)
          return true
        },
      }),
    ),
    error => error.code === 'dashboard.agent.confirmationExpired',
  )
  assert.equal(executeCount, 0)
})

test('execution errors propagate once without lookup or execution retry', async () => {
  const failure = new Error('stale plan')
  let lookupCount = 0
  let executeCount = 0
  await assert.rejects(
    coordinatePreparedAgentPlan(
      createInput({
        authority: {
          getPreparedPlanPreview() {
            lookupCount += 1
            return createPreview()
          },
          approveAndExecute() {
            executeCount += 1
            throw failure
          },
        },
      }),
    ),
    error => error === failure,
  )
  assert.equal(lookupCount, 1)
  assert.equal(executeCount, 1)
})
