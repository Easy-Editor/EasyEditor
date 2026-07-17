import type { AgentWorkspaceTargetProjection } from './types'

const isFiniteNumber = (value: number): boolean => Number.isFinite(value)

const compareCodeUnits = (left: string, right: string): number => {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export const normalizeAgentWorkspaceTargets = (
  targets: readonly AgentWorkspaceTargetProjection[],
): readonly AgentWorkspaceTargetProjection[] =>
  targets
    .filter(({ rect }) => {
      return (
        isFiniteNumber(rect.left) &&
        isFiniteNumber(rect.top) &&
        isFiniteNumber(rect.width) &&
        isFiniteNumber(rect.height) &&
        rect.width > 0 &&
        rect.height > 0
      )
    })
    .map(target => ({
      ...target,
      rect: { ...target.rect },
      tone: target.tone ?? 'active',
    }))
    .sort((left, right) => compareCodeUnits(left.targetId, right.targetId))
