import { PolicyViolation, type TrustPolicy } from '../trust'
import type { Project } from './project'

interface ProjectMutationAuthorityState {
  depth: number
  readonly trustPolicy: TrustPolicy
}

const authorities = new WeakMap<Project, ProjectMutationAuthorityState>()

export function installProjectMutationAuthority(project: Project, trustPolicy: TrustPolicy): void {
  if (authorities.has(project)) {
    throw new Error('Project mutation authority is already installed')
  }
  authorities.set(project, { depth: 0, trustPolicy })
}

export function assertProjectMutationAuthority(project: Project, origin: string): void {
  const authority = authorities.get(project)
  if (!authority) {
    throw new Error('Project mutation authority is not installed')
  }
  if (authority.trustPolicy.allowDirectModelMutation === true || authority.depth > 0) return

  throw new PolicyViolation({
    capability: 'model.mutation',
    message: 'Direct model mutation is disabled; use an Engine composition API or typed transaction',
    origin,
    rule: `${authority.trustPolicy.name}.model.mutation.deny`,
  })
}

/**
 * Internal host authority. This module is deliberately not re-exported from
 * the public package surface; it is not a same-realm security sandbox.
 */
export function withProjectMutationAuthority<T>(project: Project, operation: () => T): T {
  const authority = authorities.get(project)
  if (!authority) {
    throw new Error('Project mutation authority is not installed')
  }
  authority.depth += 1
  try {
    return operation()
  } finally {
    authority.depth -= 1
  }
}
