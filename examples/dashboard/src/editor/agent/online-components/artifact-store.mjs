import {
  validateArtifactReadRequest,
  validateArtifactRecord,
  validateArtifactRootReadRequest,
  validateArtifactRootRecord,
} from '../../../lib/storage/artifact-contracts.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from '../../../lib/storage/errors.mjs'
import { ProjectPersistenceCoordinator } from '../../../lib/storage/project-persistence-coordinator.mjs'
import { scanArtifactSource } from './artifact-source.mjs'

const failure = reason => new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, reason)

export class ArtifactStore {
  #coordinator

  constructor(options) {
    if (
      typeof options !== 'object' ||
      options === null ||
      Array.isArray(options) ||
      Object.keys(options).length !== 1 ||
      !(options.coordinator instanceof ProjectPersistenceCoordinator)
    ) {
      throw failure('artifact-store-coordinator-is-required')
    }
    this.#coordinator = options.coordinator
  }

  async createArtifact(value) {
    const artifact = validateArtifactRecord(value)
    scanArtifactSource(artifact.source)
    return this.#coordinator.createArtifact(artifact)
  }

  async readArtifact(value) {
    return this.#coordinator.readArtifact(validateArtifactReadRequest(value))
  }

  async createArtifactRoot(value) {
    return this.#coordinator.createArtifactRoot(validateArtifactRootRecord(value))
  }

  async readArtifactRoot(value) {
    return this.#coordinator.readArtifactRoot(validateArtifactRootReadRequest(value))
  }

  async deleteArtifactRoot(value) {
    return this.#coordinator.deleteArtifactRoot(validateArtifactRootReadRequest(value))
  }
}
