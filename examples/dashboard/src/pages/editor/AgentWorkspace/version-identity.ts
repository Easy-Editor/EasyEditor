import type { AgentWorkspaceVersionIdentity } from './types'

export const agentWorkspaceVersionIdentityKey = (identity: AgentWorkspaceVersionIdentity): string =>
  JSON.stringify([identity.sourceBranchId, identity.versionId])

export const agentWorkspaceVersionRestoreActionKey = (identity: AgentWorkspaceVersionIdentity): string =>
  `version:restore:${agentWorkspaceVersionIdentityKey(identity)}`
