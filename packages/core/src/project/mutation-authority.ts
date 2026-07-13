import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import { PolicyViolation, type TrustPolicy } from '../trust'
import type { Project } from './project'

interface ProjectMutationAuthorityState {
  depth: number
  suspendedDepth: number
  teardownDepth: number
  readonly trustPolicy: TrustPolicy
}

const authorities = new WeakMap<Project, ProjectMutationAuthorityState>()

export function installProjectMutationAuthority(project: Project, trustPolicy: TrustPolicy): void {
  if (authorities.has(project)) {
    throw new Error('Project mutation authority is already installed')
  }
  authorities.set(project, { depth: 0, suspendedDepth: 0, teardownDepth: 0, trustPolicy })
}

export function assertProjectMutationAuthority(project: Project, origin: string): void {
  const authority = authorities.get(project)
  if (!authority) {
    throw new Error('Project mutation authority is not installed')
  }
  if (authority.teardownDepth === 0) assertLifecycleMutationAllowed(project, origin)
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

/** Internal cleanup authority that is valid only while an engine is disposing. */
export function withProjectTeardownAuthority<T>(project: Project, operation: () => T): T {
  const authority = authorities.get(project)
  if (!authority) {
    throw new Error('Project mutation authority is not installed')
  }
  authority.depth += 1
  authority.teardownDepth += 1
  try {
    return operation()
  } finally {
    authority.teardownDepth -= 1
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
  authority.suspendedDepth += 1
  try {
    return operation()
  } finally {
    authority.suspendedDepth -= 1
  }
}
