import { type CSSProperties, type ReactElement, createElement } from 'react'
import { normalizeAgentWorkspaceTargets } from './overlay-projection.ts'
import type { AgentWorkspaceTargetProjection } from './types.ts'

const ROOT_CLASS_NAME = 'pointer-events-none absolute inset-0 z-40 overflow-hidden [contain:layout_paint_style]'

const TARGET_CLASS_NAME =
  'absolute top-0 left-0 will-change-transform rounded-[3px] border-2 shadow-[0_0_0_1px_rgba(255,255,255,0.72),0_0_0_4px_rgba(79,70,229,0.12)] transition-[transform,width,height] duration-150 motion-reduce:transition-none'

const TARGET_TONE_CLASS_NAME: Readonly<Record<NonNullable<AgentWorkspaceTargetProjection['tone']>, string>> = {
  active: 'border-indigo-500 bg-indigo-500/5',
  pending: 'border-amber-500 bg-amber-500/5',
  blocked: 'border-red-500 bg-red-500/5',
}

const LABEL_CLASS_NAME =
  'absolute -top-6 left-0 max-w-52 truncate rounded-sm px-2 py-0.5 font-mono text-[10px] leading-4 text-white shadow-sm'

const LABEL_TONE_CLASS_NAME: Readonly<Record<NonNullable<AgentWorkspaceTargetProjection['tone']>, string>> = {
  active: 'bg-indigo-600',
  pending: 'bg-amber-600',
  blocked: 'bg-red-600',
}

const classNames = (...values: readonly string[]): string => values.join(' ')

const sessionKey = (sessionId?: string): string => {
  const normalized = sessionId?.trim()
  return normalized ? `session:${normalized}` : 'session:unbound'
}

export interface AgentWorkspaceActiveTargetLayerProjection {
  readonly sessionKey: string
  readonly targets: readonly AgentWorkspaceTargetProjection[]
}

export const projectAgentWorkspaceActiveTargetLayer = (input: {
  readonly sessionId?: string
  readonly targets: readonly AgentWorkspaceTargetProjection[]
}): AgentWorkspaceActiveTargetLayerProjection =>
  Object.freeze({
    sessionKey: sessionKey(input.sessionId),
    targets: Object.freeze(
      normalizeAgentWorkspaceTargets(input.targets).map(target =>
        Object.freeze({ ...target, rect: Object.freeze({ ...target.rect }) }),
      ),
    ),
  })

export const projectAgentWorkspaceTargetStyle = (
  rect: AgentWorkspaceTargetProjection['rect'],
): Readonly<CSSProperties> =>
  Object.freeze({
    width: rect.width,
    height: rect.height,
    transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
  })

export interface AgentWorkspaceActiveTargetLayerProps {
  readonly projection: AgentWorkspaceActiveTargetLayerProjection
}

export const AgentWorkspaceActiveTargetLayer = ({
  projection,
}: AgentWorkspaceActiveTargetLayerProps): ReactElement | null => {
  if (projection.targets.length === 0) return null

  return createElement(
    'div',
    {
      'aria-hidden': 'true',
      className: ROOT_CLASS_NAME,
      'data-agent-target-session': projection.sessionKey,
    },
    projection.targets.map(target => {
      const tone = target.tone ?? 'active'
      return createElement(
        'div',
        {
          className: classNames(TARGET_CLASS_NAME, TARGET_TONE_CLASS_NAME[tone]),
          'data-agent-target-id': target.targetId,
          'data-agent-target-node-id': target.targetId,
          key: target.targetId,
          style: projectAgentWorkspaceTargetStyle(target.rect),
        },
        createElement('span', { className: classNames(LABEL_CLASS_NAME, LABEL_TONE_CLASS_NAME[tone]) }, target.label),
      )
    }),
  )
}
