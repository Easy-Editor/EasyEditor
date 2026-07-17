import assert from 'node:assert/strict'
import test from 'node:test'

import { createDashboardInvocationActivity } from '../src/editor/agent/activity/invocation-activity.mjs'

test('invocation activity projects deterministic active targets and isolates observers', () => {
  let timestamp = 10
  const activity = createDashboardInvocationActivity({ now: () => ++timestamp })
  const revisions = []
  const release = activity.subscribe(() => revisions.push(activity.getSnapshot().revision))
  activity.subscribe(() => {
    throw new Error('observer failure')
  })

  const finishSecond = activity.begin({
    callId: 'call-b',
    capability: 'screen.applyChangeSet',
    taskId: 'task-1',
    targetNodeIds: ['node-b', 'node-a', 'node-b'],
    targets: [
      { nodeId: 'node-b', label: 'B', rect: { x: 20, y: 30, width: 40, height: 50 } },
      { nodeId: 'node-a', label: 'A', rect: { x: 1, y: 2, width: 3, height: 4 } },
    ],
  })
  const finishFirst = activity.begin({
    callId: 'call-a',
    capability: 'screen.inspect',
    taskId: 'task-1',
    targetNodeIds: [],
  })

  assert.deepEqual(activity.getSnapshot(), {
    revision: 2,
    activeCalls: [
      {
        callId: 'call-b',
        capability: 'screen.applyChangeSet',
        taskId: 'task-1',
        startedAt: 11,
        targetNodeIds: ['node-a', 'node-b'],
        targets: [
          { nodeId: 'node-a', label: 'A', rect: { x: 1, y: 2, width: 3, height: 4 } },
          { nodeId: 'node-b', label: 'B', rect: { x: 20, y: 30, width: 40, height: 50 } },
        ],
      },
      {
        callId: 'call-a',
        capability: 'screen.inspect',
        taskId: 'task-1',
        startedAt: 12,
        targetNodeIds: [],
        targets: [],
      },
    ],
  })

  finishSecond()
  finishSecond()
  assert.deepEqual(
    activity.getSnapshot().activeCalls.map(call => call.callId),
    ['call-a'],
  )
  finishFirst()
  assert.deepEqual(revisions, [1, 2, 3, 4])
  release()
  activity.dispose()
})

test('invocation activity rejects duplicate active call identities', () => {
  const activity = createDashboardInvocationActivity()
  const finish = activity.begin({
    callId: 'call-1',
    capability: 'screen.inspect',
    taskId: 'task-1',
    targetNodeIds: [],
  })

  assert.throws(
    () =>
      activity.begin({
        callId: 'call-1',
        capability: 'screen.inspect',
        taskId: 'task-1',
        targetNodeIds: [],
      }),
    /already active/,
  )
  finish()
})
