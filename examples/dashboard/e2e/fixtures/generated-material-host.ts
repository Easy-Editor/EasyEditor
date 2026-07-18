import type { Page } from '@playwright/test'

export const GENERATED_MATERIAL_PROJECT_ID = 'g008-production-project'
export const GENERATED_MATERIAL_BRANCH_ID = 'main'
export const GENERATED_MATERIAL_ARTIFACT_ID = 'g008-production-kpi'
export const GENERATED_MATERIAL_SOURCE_REVISION = 'revision-1'
export const GENERATED_MATERIAL_REVISED_SOURCE_REVISION = 'revision-2'
export const GENERATED_MATERIAL_LOGICAL_COMPONENT_ID = 'g008-production-kpi-logical'
export const GENERATED_MATERIAL_INSTANCE_COUNT = 20
export const GENERATED_MATERIAL_INSTANCE_IDS = Object.freeze(
  Array.from({ length: GENERATED_MATERIAL_INSTANCE_COUNT }, (_, index) => `g008-generated-${index + 1}`),
)
export const GENERATED_MATERIAL_PRIMARY_ID = GENERATED_MATERIAL_INSTANCE_IDS[0]
export const GENERATED_MATERIAL_SECONDARY_ID = GENERATED_MATERIAL_INSTANCE_IDS[1]
export const GENERATED_MATERIAL_ORDINARY_ID = 'g008-ordinary-text'
export const GENERATED_MATERIAL_ORDINARY_TEXT = 'G008 ordinary material survives'
export const GENERATED_MATERIAL_UPDATED_LABEL = 'G008 Primary Updated'
export const GENERATED_MATERIAL_RESOLVED_DATA_VALUE = 'G008 resolved safe data'
export const GENERATED_MATERIAL_THEME_MODE = 'dark'
export const GENERATED_MATERIAL_THEME_TOKEN = 'g008-theme-token'
export const GENERATED_MATERIAL_PRIMARY_ASSET_HANDLE = 'asset://g008/1'
export const GENERATED_MATERIAL_CSS = ':host { display: block; width: 100%; height: 100%; }'

const createGeneratedMaterialSource = (sourceRevision: string) => `
const render = (root, ctx) => {
  const host = root.getRootNode().host
  host.setAttribute('data-rendered-label', String(ctx.props.label ?? 'Generated material'))
  host.setAttribute('data-rendered-value', String(ctx.props.value ?? ''))
  host.setAttribute('data-rendered-color', String(ctx.props.color ?? ''))
  host.setAttribute('data-rendered-token', String(ctx.props.token ?? ''))
  host.setAttribute('data-rendered-data-value', String(ctx.data?.value ?? ''))
  host.setAttribute('data-rendered-data-total', String(ctx.data?.total ?? ''))
  host.setAttribute('data-rendered-theme', String(ctx.theme?.mode ?? ''))
  host.setAttribute('data-rendered-theme-token', String(ctx.theme?.designTokens?.token ?? ''))
  host.setAttribute('data-rendered-asset', String(ctx.assets?.[0]?.handle ?? ''))
  host.setAttribute('data-rendered-width', String(ctx.size?.width ?? ''))
  host.setAttribute('data-rendered-height', String(ctx.size?.height ?? ''))
  host.setAttribute('data-source-revision', '${sourceRevision}')
  root.textContent = String(ctx.props.label ?? 'Generated material')
}

export default {
  mount(root, ctx) {
    render(root, ctx)
  },
  update(root, ctx) {
    render(root, ctx)
  },
  destroy(root) {
    root.textContent = ''
  },
}
`

export const GENERATED_MATERIAL_SOURCE = createGeneratedMaterialSource(GENERATED_MATERIAL_SOURCE_REVISION)
export const GENERATED_MATERIAL_REVISED_SOURCE = createGeneratedMaterialSource(
  GENERATED_MATERIAL_REVISED_SOURCE_REVISION,
)

export interface GeneratedMaterialArtifactRef {
  readonly artifactId: string
  readonly sourceRevision: string
  readonly logicalComponentId: string
  readonly sourceIntegrity: string
  readonly target: Readonly<{ kind: 'online' }>
}

export interface GeneratedMaterialSeed {
  readonly projectId: string
  readonly branchId: string
  readonly artifactId: string
  readonly sourceRevision: string
  readonly revisedSourceRevision: string
  readonly revisionKey: string
  readonly revisedRevisionKey: string
  readonly artifactRef: GeneratedMaterialArtifactRef
  readonly revisedArtifactRef: GeneratedMaterialArtifactRef
  readonly instanceIds: readonly string[]
}

export const seedGeneratedMaterialProject = async (
  page: Page,
  options: Readonly<{ instanceIds?: readonly string[] }> = {},
): Promise<GeneratedMaterialSeed> => {
  await page.goto('/logo.svg')
  const instanceIds = options.instanceIds ?? GENERATED_MATERIAL_INSTANCE_IDS

  return page.evaluate(
    async fixture => {
      const storage = await import('/src/lib/storage/index.mjs')
      const databaseName = storage.DASHBOARD_STORAGE_DATABASE_NAME
      const deleteRequest = indexedDB.deleteDatabase(databaseName)
      await new Promise<void>((resolve, reject) => {
        deleteRequest.onsuccess = () => resolve()
        deleteRequest.onerror = () => reject(deleteRequest.error ?? new Error('failed to reset Dashboard IndexedDB'))
        deleteRequest.onblocked = () => reject(new Error('Dashboard IndexedDB reset was blocked'))
      })
      localStorage.clear()

      const toHex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
      const sha256 = async (value: string) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
        return `sha256:${toHex(new Uint8Array(digest))}`
      }
      const runtimeRevisionKey = async (source: string) => {
        const projection = JSON.stringify({ source, css: fixture.css, dependencies: [] })
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(projection))
        return `artifact-${toHex(new Uint8Array(digest))}`
      }

      const sourceIntegrity = await sha256(fixture.source)
      const revisedSourceIntegrity = await sha256(fixture.revisedSource)
      const revisionKey = await runtimeRevisionKey(fixture.source)
      const revisedRevisionKey = await runtimeRevisionKey(fixture.revisedSource)
      const dependencyLockDigest = await sha256('[]')
      const artifactRef = Object.freeze({
        artifactId: fixture.artifactId,
        sourceRevision: fixture.sourceRevision,
        logicalComponentId: fixture.logicalComponentId,
        sourceIntegrity,
        target: Object.freeze({ kind: 'online' as const }),
      })
      const revisedArtifactRef = Object.freeze({
        artifactId: fixture.artifactId,
        sourceRevision: fixture.revisedSourceRevision,
        logicalComponentId: fixture.logicalComponentId,
        sourceIntegrity: revisedSourceIntegrity,
        target: Object.freeze({ kind: 'online' as const }),
      })
      const artifact = (
        ref: typeof artifactRef,
        source: string,
        createdAt: number,
        supersedes: null | Readonly<{
          artifactId: string
          sourceRevision: string
          logicalComponentId: string
          sourceIntegrity: string
        }>,
      ) => ({
        schemaVersion: 1 as const,
        projectId: fixture.projectId,
        artifactId: ref.artifactId,
        sourceRevision: ref.sourceRevision,
        logicalComponentId: ref.logicalComponentId,
        sourceIntegrity: ref.sourceIntegrity,
        source,
        css: fixture.css,
        safeManifest: { schemaVersion: 1, displayName: 'G008 Production KPI', events: ['activate'] },
        lockedDependencies: [],
        dependencyLockDigest,
        diagnostics: [],
        provenance: { actor: 'e2e', phase: 'G008', sourceRevision: ref.sourceRevision },
        createdAt,
        supersedes,
      })
      const generatedNode = (
        id: string,
        index: number,
        rect: { x: number; y: number; width: number; height: number },
      ) => {
        const color = index % 2 === 0 ? '#7c3aed' : '#0369a1'
        return {
          id,
          componentName: 'GeneratedMaterialHost',
          props: {
            label: `G008 Instance ${index + 1}`,
            value: index + 1,
            color,
            token: `g008-business-token-${index + 1}`,
            data: { value: 'fallback-must-not-render', total: 0 },
            dataBindings: {
              schemaVersion: 1,
              fields: { data: { sourceId: fixture.resolvedDataSourceId } },
            },
            theme: {
              mode: fixture.themeMode,
              designTokens: { token: fixture.themeToken, accent: color },
            },
            assets: [{ id: `g008-asset-${index + 1}`, handle: `asset://g008/${index + 1}` }],
          },
          $agent: { schemaVersion: 1, artifactRef },
          $dashboard: { rect },
          children: [],
        }
      }
      const generatedNodes = fixture.instanceIds.map((id, index) => {
        const column = index % 5
        const row = Math.floor(index / 5)
        return generatedNode(id, index, {
          x: 620 + column * 180,
          y: 300 + row * 130,
          width: 150,
          height: 90,
        })
      })
      const projectSchema = {
        version: '1.0.0',
        componentsMap: [
          { devMode: 'lowCode', componentName: 'Root' },
          { devMode: 'lowCode', componentName: 'Text' },
          { devMode: 'lowCode', componentName: 'GeneratedMaterialHost' },
        ],
        componentsTree: [
          {
            id: 'g008-root',
            docId: 'g008-page',
            fileName: 'home',
            componentName: 'Root',
            isRoot: true,
            props: {
              backgroundColor: '#232630',
              dataSources: {
                schemaVersion: 1,
                sources: [
                  {
                    schemaVersion: 1,
                    id: fixture.resolvedDataSourceId,
                    kind: 'static',
                    value: { value: fixture.resolvedDataValue, total: fixture.instanceIds.length },
                  },
                ],
              },
            },
            $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
            children: [
              ...generatedNodes,
              {
                id: fixture.ordinaryId,
                componentName: 'Text',
                props: { text: fixture.ordinaryText },
                $dashboard: { rect: { x: 760, y: 840, width: 420, height: 70 } },
                children: [],
              },
            ],
          },
        ],
      }

      localStorage.setItem(
        storage.DASHBOARD_STORAGE_IDENTITY_POINTER_KEY,
        JSON.stringify({ schemaVersion: 1, projectId: fixture.projectId, branchId: fixture.branchId }),
      )
      const coordinator = new storage.ProjectPersistenceCoordinator({
        backend: new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
        crypto,
      })
      try {
        const artifactCreate = await coordinator.createArtifact(artifact(artifactRef, fixture.source, 1, null))
        if (artifactCreate.status !== 'created') throw new Error('expected a fresh immutable ArtifactRecord')
        const revisedArtifactCreate = await coordinator.createArtifact(
          artifact(revisedArtifactRef, fixture.revisedSource, 2, {
            artifactId: artifactRef.artifactId,
            sourceRevision: artifactRef.sourceRevision,
            logicalComponentId: artifactRef.logicalComponentId,
            sourceIntegrity: artifactRef.sourceIntegrity,
          }),
        )
        if (revisedArtifactCreate.status !== 'created') throw new Error('expected a fresh revised ArtifactRecord')
        const draftCommit = await coordinator.commit({
          schemaVersion: 1,
          batchId: 'g008-seed-draft',
          projectId: fixture.projectId,
          branchId: fixture.branchId,
          expectedDraftGeneration: 0,
          activeDocument: { documentId: 'g008-page', fileName: 'home', index: 0 },
          projectSchema,
          commitKind: 'manual-save',
          updatedAt: 3,
          operations: [],
        })
        if (draftCommit.draftGeneration !== 1) throw new Error('expected the seed draft at generation 1')
        const roots = await coordinator.enumerateArtifactRoots({ schemaVersion: 1, projectId: fixture.projectId })
        const workingDraftRoots = roots.roots.filter(root => root.ownerType === 'working-draft')
        if (
          workingDraftRoots.length !== 1 ||
          workingDraftRoots[0].ownerId !== fixture.branchId ||
          workingDraftRoots[0].artifactId !== fixture.artifactId ||
          workingDraftRoots[0].sourceRevision !== fixture.sourceRevision
        ) {
          throw new Error(
            `canonical commit did not derive the exact WorkingDraft root: ${JSON.stringify(workingDraftRoots)}`,
          )
        }
      } finally {
        await coordinator.dispose()
      }

      return {
        projectId: fixture.projectId,
        branchId: fixture.branchId,
        artifactId: fixture.artifactId,
        sourceRevision: fixture.sourceRevision,
        revisedSourceRevision: fixture.revisedSourceRevision,
        revisionKey,
        revisedRevisionKey,
        artifactRef,
        revisedArtifactRef,
        instanceIds: fixture.instanceIds,
      }
    },
    {
      projectId: GENERATED_MATERIAL_PROJECT_ID,
      branchId: GENERATED_MATERIAL_BRANCH_ID,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      revisedSourceRevision: GENERATED_MATERIAL_REVISED_SOURCE_REVISION,
      logicalComponentId: GENERATED_MATERIAL_LOGICAL_COMPONENT_ID,
      instanceIds,
      ordinaryId: GENERATED_MATERIAL_ORDINARY_ID,
      ordinaryText: GENERATED_MATERIAL_ORDINARY_TEXT,
      resolvedDataSourceId: 'g008-resolved-data',
      resolvedDataValue: GENERATED_MATERIAL_RESOLVED_DATA_VALUE,
      themeMode: GENERATED_MATERIAL_THEME_MODE,
      themeToken: GENERATED_MATERIAL_THEME_TOKEN,
      source: GENERATED_MATERIAL_SOURCE,
      revisedSource: GENERATED_MATERIAL_REVISED_SOURCE,
      css: GENERATED_MATERIAL_CSS,
    },
  )
}
