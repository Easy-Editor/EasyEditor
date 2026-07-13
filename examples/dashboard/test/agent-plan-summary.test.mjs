import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentPlanSummary } from '../src/components/ai-chat/agent-plan-summary.mjs'

test('plan summary is derived from the validated preview without leaking engine identifiers', () => {
  const summary = createAgentPlanSummary({
    planId: 'plan-secret',
    state: 'prepared',
    documentId: 'document-secret',
    baseRevision: 'revision-secret',
    commandCount: 4,
    effects: [
      { commandIndex: 0, type: 'insertNode', nodeIds: ['generated-secret'], parentId: 'root-secret' },
      { commandIndex: 1, type: 'updateProps', nodeIds: ['node-secret'] },
      { commandIndex: 2, type: 'moveNode', nodeIds: ['node-secret'], parentId: 'root-secret' },
      { commandIndex: 3, type: 'removeNode', nodeIds: ['removed-secret'] },
    ],
  })

  assert.deepEqual(summary, {
    affectedNodeCount: 3,
    commandCount: 4,
    destructiveCommandCount: 1,
    operations: [
      { affectedNodeCount: 1, commandCount: 1, type: 'insertNode' },
      { affectedNodeCount: 1, commandCount: 1, type: 'updateProps' },
      { affectedNodeCount: 1, commandCount: 1, type: 'moveNode' },
      { affectedNodeCount: 1, commandCount: 1, type: 'removeNode' },
    ],
  })
  const serialized = JSON.stringify(summary)
  for (const secret of ['plan-secret', 'document-secret', 'revision-secret', 'node-secret', 'root-secret']) {
    assert.equal(serialized.includes(secret), false)
  }
  assert.equal(Object.isFrozen(summary), true)
  assert.equal(Object.isFrozen(summary.operations), true)
  assert.equal(Object.isFrozen(summary.operations[0]), true)
})
