import type {
  ArtifactCreateResultV1,
  ArtifactReadRequestV1,
  ArtifactRecordV1,
  ArtifactRootCreateResultV1,
  ArtifactRootDeleteResultV1,
  ArtifactRootRecordV1,
} from '../../../lib/storage/artifact-contracts.mjs'
import type { ProjectPersistenceCoordinator } from '../../../lib/storage/project-persistence-coordinator.mjs'

export declare class ArtifactStore {
  constructor(options: Readonly<{ coordinator: ProjectPersistenceCoordinator }>)
  createArtifact(value: ArtifactRecordV1): Promise<ArtifactCreateResultV1>
  readArtifact(value: ArtifactReadRequestV1): Promise<ArtifactRecordV1 | null>
  createArtifactRoot(value: ArtifactRootRecordV1): Promise<ArtifactRootCreateResultV1>
  readArtifactRoot(value: ArtifactRootRecordV1): Promise<ArtifactRootRecordV1 | null>
  deleteArtifactRoot(value: ArtifactRootRecordV1): Promise<ArtifactRootDeleteResultV1>
}
