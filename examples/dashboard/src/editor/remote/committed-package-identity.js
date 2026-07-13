/**
 * Remote package replacement is unsafe until every engine registry involved
 * can participate in one rollback-capable transaction. Keep the first
 * committed identity stable instead of presenting a partially upgraded state.
 */
export const assertCommittedPackageIdentity = (resourceType, next, committed) => {
  if (!committed || (committed.version === next.version && committed.globalName === next.globalName)) return
  throw new Error(
    `${resourceType} package ${next.packageName} is already committed as ${committed.version} ` +
      `(${committed.globalName}); non-atomic replacement with ${next.version} (${next.globalName}) is not allowed`,
  )
}
