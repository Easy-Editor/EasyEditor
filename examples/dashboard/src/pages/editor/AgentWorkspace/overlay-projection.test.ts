import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAgentWorkspaceTargets } from './overlay-projection.ts'
import type { AgentWorkspaceTargetProjection } from './types.ts'

const target = (
  targetId: string,
  rect: AgentWorkspaceTargetProjection['rect'],
  tone?: AgentWorkspaceTargetProjection['tone'],
): AgentWorkspaceTargetProjection => ({ targetId, label: targetId, rect, tone })

test('target projection keeps only finite positive Host-projected rectangles', () => {
  const result = normalizeAgentWorkspaceTargets([
    target('valid', { left: -12, top: 4, width: 120, height: 80 }),
    target('zero-width', { left: 0, top: 0, width: 0, height: 10 }),
    target('negative-height', { left: 0, top: 0, width: 10, height: -1 }),
    target('not-finite', { left: Number.NaN, top: 0, width: 10, height: 10 }),
  ])

  assert.deepEqual(result, [target('valid', { left: -12, top: 4, width: 120, height: 80 }, 'active')])
})

test('target projection is deterministic by target id and never mutates the source DTO', () => {
  const source = [
    target('target-z', { left: 50, top: 60, width: 70, height: 80 }, 'blocked'),
    target('target-a', { left: 1, top: 2, width: 3, height: 4 }, 'pending'),
  ] as const
  const original = structuredClone(source)

  const result = normalizeAgentWorkspaceTargets(source)

  assert.deepEqual(
    result.map(item => item.targetId),
    ['target-a', 'target-z'],
  )
  assert.deepEqual(source, original)
  assert.notStrictEqual(result[0]?.rect, source[1].rect)
})
