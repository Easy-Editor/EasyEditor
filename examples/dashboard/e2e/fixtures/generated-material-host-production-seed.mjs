import {
  DASHBOARD_STORAGE_DATABASE_NAME,
  DASHBOARD_STORAGE_IDENTITY_POINTER_KEY,
  IndexedDbDashboardStorageBackend,
  ProjectPersistenceCoordinator,
} from '../../src/lib/storage/index.mjs'

const toHex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')

const sha256 = async value => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `sha256:${toHex(new Uint8Array(digest))}`
}

const deleteDashboardDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DASHBOARD_STORAGE_DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('failed to reset Dashboard IndexedDB'))
    request.onblocked = () => reject(new Error('Dashboard IndexedDB reset was blocked'))
  })

export const seedGeneratedMaterialHostProductionProject = async fixture => {
  await deleteDashboardDatabase()
  localStorage.clear()

  const sourceIntegrity = await sha256(fixture.source)
  const dependencyLockDigest = await sha256('[]')
  const artifactRef = Object.freeze({
    artifactId: fixture.artifactId,
    sourceRevision: fixture.sourceRevision,
    logicalComponentId: fixture.logicalComponentId,
    sourceIntegrity,
    target: Object.freeze({ kind: 'online' }),
  })
  const artifact = {
    schemaVersion: 1,
    projectId: fixture.projectId,
    artifactId: fixture.artifactId,
    sourceRevision: fixture.sourceRevision,
    logicalComponentId: fixture.logicalComponentId,
    sourceIntegrity,
    source: fixture.source,
    css: fixture.css,
    safeManifest: { schemaVersion: 1, displayName: 'G009 Production Surface', events: ['activate'] },
    lockedDependencies: [],
    dependencyLockDigest,
    diagnostics: [],
    provenance: { actor: 'e2e', phase: 'G009', sourceRevision: fixture.sourceRevision },
    createdAt: 1,
    supersedes: null,
  }
  const projectSchema = {
    version: '1.0.0',
    componentsMap: [
      { devMode: 'lowCode', componentName: 'Root' },
      { devMode: 'lowCode', componentName: 'GeneratedMaterialHost' },
    ],
    componentsTree: [
      {
        id: 'g009-production-root',
        docId: 'g009-production-page',
        fileName: 'home',
        componentName: 'Root',
        isRoot: true,
        props: { backgroundColor: '#232630' },
        $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
        children: [
          {
            id: fixture.instanceId,
            componentName: 'GeneratedMaterialHost',
            props: {
              label: fixture.label,
              value: 1,
              color: '#7c3aed',
              token: 'g009-production-token',
            },
            $agent: { schemaVersion: 1, artifactRef },
            $dashboard: { rect: { x: 620, y: 300, width: 280, height: 160 } },
            children: [],
          },
        ],
      },
    ],
  }

  localStorage.setItem(
    DASHBOARD_STORAGE_IDENTITY_POINTER_KEY,
    JSON.stringify({ schemaVersion: 1, projectId: fixture.projectId, branchId: fixture.branchId }),
  )
  const coordinator = new ProjectPersistenceCoordinator({
    backend: new IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
    crypto,
  })
  try {
    const artifactCreate = await coordinator.createArtifact(artifact)
    if (artifactCreate.status !== 'created') throw new Error('expected a fresh immutable ArtifactRecord')
    const draftCommit = await coordinator.commit({
      schemaVersion: 1,
      batchId: 'g009-production-surface-seed',
      projectId: fixture.projectId,
      branchId: fixture.branchId,
      expectedDraftGeneration: 0,
      activeDocument: { documentId: 'g009-production-page', fileName: 'home', index: 0 },
      projectSchema,
      commitKind: 'manual-save',
      updatedAt: 2,
      operations: [],
    })
    if (draftCommit.draftGeneration !== 1) throw new Error('expected the production seed draft at generation 1')
  } finally {
    await coordinator.dispose()
  }
}
