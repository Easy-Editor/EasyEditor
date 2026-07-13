export interface PackageIdentity {
  packageName: string
  version: string
  globalName: string
}

export type CommittedPackageIdentity = Omit<PackageIdentity, 'packageName'>

export declare const assertCommittedPackageIdentity: (
  resourceType: string,
  next: PackageIdentity,
  committed: CommittedPackageIdentity | undefined,
) => void
