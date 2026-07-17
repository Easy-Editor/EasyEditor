import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AgentWorkspaceActiveTargetLayer,
  projectAgentWorkspaceActiveTargetLayer,
  projectAgentWorkspaceTargetStyle,
} from './ActiveTargetLayer.ts'
import type { AgentWorkspaceTargetProjection } from './types.ts'

const target = (
  targetId: string,
  overrides: Partial<AgentWorkspaceTargetProjection> = {},
): AgentWorkspaceTargetProjection => ({
  targetId,
  label: `物料 ${targetId}`,
  rect: { left: 10, top: 20, width: 120, height: 80 },
  tone: 'active',
  ...overrides,
})

const renderLayer = (projection: ReturnType<typeof projectAgentWorkspaceActiveTargetLayer>): string =>
  renderToStaticMarkup(createElement(AgentWorkspaceActiveTargetLayer, { projection }))

test('renders a pointer-transparent layer over the canvas with transform-only positioning', () => {
  const projection = projectAgentWorkspaceActiveTargetLayer({
    sessionId: ' session-1 ',
    targets: [target('node-b', { tone: 'pending' }), target('node-a')],
  })

  const markup = renderLayer(projection)

  assert.equal(projection.sessionKey, 'session:session-1')
  assert.match(markup, /pointer-events-none absolute inset-0/)
  assert.match(markup, /\[contain:layout_paint_style\]/)
  assert.match(markup, /data-agent-target-session="session:session-1"/)
  assert.match(markup, /data-agent-target-node-id="node-a"/)
  assert.match(markup, /data-agent-target-node-id="node-b"/)
  assert.match(markup, /transform:translate3d\(10px, 20px, 0\)/)
  assert.doesNotMatch(markup, /style="[^"]*(?:left|top):/)
  assert.ok(markup.indexOf('node-a') < markup.indexOf('node-b'))
})

test('session switches and empty target projections render no stale overlay nodes', () => {
  const firstSession = projectAgentWorkspaceActiveTargetLayer({
    sessionId: 'session-1',
    targets: [target('node-a')],
  })
  const switchedSession = projectAgentWorkspaceActiveTargetLayer({ sessionId: 'session-2', targets: [] })
  const clearedSession = projectAgentWorkspaceActiveTargetLayer({ sessionId: 'session-1', targets: [] })

  assert.notEqual(switchedSession.sessionKey, firstSession.sessionKey)
  assert.equal(renderLayer(firstSession).includes('node-a'), true)
  assert.equal(renderLayer(switchedSession), '')
  assert.equal(renderLayer(clearedSession), '')
})

test('layer projection is immutable and rejects invalid rectangles before rendering', () => {
  const sourceRect = { left: 10, top: 20, width: 120, height: 80 }
  const source = [
    target('valid', { rect: sourceRect }),
    target('invalid', { rect: { left: 0, top: 0, width: Number.NaN, height: 10 } }),
  ]
  const projection = projectAgentWorkspaceActiveTargetLayer({ sessionId: undefined, targets: source })

  sourceRect.left = 999

  assert.equal(projection.sessionKey, 'session:unbound')
  assert.deepEqual(
    projection.targets.map(item => item.targetId),
    ['valid'],
  )
  assert.equal(projection.targets[0]?.rect.left, 10)
  assert.equal(Object.isFrozen(projection), true)
  assert.equal(Object.isFrozen(projection.targets), true)
  assert.equal(Object.isFrozen(projection.targets[0]?.rect), true)
})

test('target styles consume projected canvas coordinates without DOM measurement', () => {
  assert.deepEqual(projectAgentWorkspaceTargetStyle({ left: -24, top: 48, width: 320, height: 180 }), {
    width: 320,
    height: 180,
    transform: 'translate3d(-24px, 48px, 0)',
  })
})
