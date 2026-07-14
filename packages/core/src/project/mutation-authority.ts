import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import { PolicyViolation, type TrustPolicy } from '../trust'
import type { Project } from './project'

interface ProjectMutationAuthorityState {
  callbackDepth: number
  depth: number
  suspendedDepth: number
  readonly trustPolicy: TrustPolicy
}

const authorities = new WeakMap<Project, ProjectMutationAuthorityState>()

/** Package-private marker for model mutations whose identity changes are terminal. */
export class ProjectMutationCommittedError<T = unknown> extends AggregateError {
  readonly committed = true

  constructor(
    errors: readonly unknown[],
    readonly result: T,
  ) {
    super(errors, 'The project mutation committed, but one or more completion callbacks failed')
  }
}

export function installProjectMutationAuthority(project: Project, trustPolicy: TrustPolicy): void {
  if (authorities.has(project)) {
    throw new Error('Project mutation authority is already installed')
  }
  authorities.set(project, { callbackDepth: 0, depth: 0, suspendedDepth: 0, trustPolicy })
}

export function assertProjectMutationAuthority(project: Project, origin: string): void {
  const authority = authorities.get(project)
  if (!authority) {
    throw new Error('Project mutation authority is not installed')
  }
  assertLifecycleMutationAllowed(project, origin)
  if (authority.depth > 0 && authority.suspendedDepth === 0) return
  if (authority.trustPolicy.allowDirectModelMutation === true) return

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

/**
 * User/material callbacks must never inherit the ambient host write scope.
 * This is synchronous by design: executable async callbacks are outside the
 * V1 transaction contract.
 */
export function withoutProjectMutationAuthority<T>(project: Project, operation: () => T): T {
  const authority = authorities.get(project)
  if (!authority) {
    throw new Error('Project mutation authority is not installed')
  }
  authority.callbackDepth += 1
  authority.suspendedDepth += 1
  try {
    return operation()
  } finally {
    authority.suspendedDepth -= 1
    authority.callbackDepth -= 1
  }
}

/** Package-private lifecycle gate for synchronous engine-owned callbacks. */
export function isProjectCallbackInvocationActive(project: Project): boolean {
  return (authorities.get(project)?.callbackDepth ?? 0) > 0
}
