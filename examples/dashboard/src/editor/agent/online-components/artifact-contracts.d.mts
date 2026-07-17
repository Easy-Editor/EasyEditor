export type {
  ArtifactRecordV1,
  ArtifactRef,
  ArtifactSourceRevision,
  CanonicalNodeAgentExtraV1,
  CanonicalNodeExtra,
  LocalMaterialArtifactRef,
  OnlineArtifactRef,
} from '../../../lib/storage/artifact-contracts.mjs'
export {
  createArtifactRevisionKey,
  migrateLegacyNodeArtifactRef,
  readCanonicalNodeArtifactRef,
  validateArtifactRecord,
  validateArtifactRef,
  validateArtifactSourceRevision,
  writeCanonicalNodeArtifactRef,
} from '../../../lib/storage/artifact-contracts.mjs'
