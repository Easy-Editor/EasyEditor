import { type Locator, type Page, expect, test } from '@playwright/test'
import {
  GENERATED_MATERIAL_ARTIFACT_ID,
  GENERATED_MATERIAL_BRANCH_ID,
  GENERATED_MATERIAL_INSTANCE_IDS,
  GENERATED_MATERIAL_ORDINARY_ID,
  GENERATED_MATERIAL_PRIMARY_ID,
  GENERATED_MATERIAL_PROJECT_ID,
  GENERATED_MATERIAL_RESOLVED_DATA_VALUE,
  GENERATED_MATERIAL_SOURCE_REVISION,
  seedGeneratedMaterialProject,
} from './fixtures/generated-material-host'
import { LOCAL_MATERIAL_E2E_GRANT_AUTHORITY } from './fixtures/local-material-promotion-lifecycle'

const WORKSPACE_TEST_ID = 'agent-workspace'
const EDITOR_SURFACE_ID = 'dashboard-editor-online'
const PREVIEW_SURFACE_ID = 'dashboard-preview-online'
const PROMOTION_TASK_ID = 'g009-promotion-task'
const PROMOTION_STEP_ID = 'g009-promotion-step'
const PROMOTION_CALL_ID = 'g009-promote-primary-local'
const VERSION_NAME = 'G009 在线物料恢复点'

type WorkspaceProbe = NonNullable<ReturnType<NonNullable<Window['__EASY_EDITOR_E2E__']>['getAgentWorkspaceState']>>

interface BrowserErrorLog {
  readonly pageErrors: string[]
  readonly cspErrors: string[]
}

interface LocalMaterialArtifactRef {
  readonly artifactId: string
  readonly sourceRevision: string
  readonly logicalComponentId: string
  readonly sourceIntegrity: string
  readonly target: Readonly<{
    kind: 'local-material'
    materialId: string
    materialVersion: string
    buildIntegrity: string
  }>
  readonly rollbackTo: Readonly<{
    artifactId: string
    sourceRevision: string
    logicalComponentId: string
    sourceIntegrity: string
  }>
}

interface LocalMaterialPromotionCall {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
  readonly stepId: string
  readonly callId: string
  readonly capability: 'artifact.promoteLocal'
  readonly expectedRevision: string
  readonly arguments: Readonly<{ schemaVersion: 1; nodeId: string }>
}

interface NodeProjection {
  readonly id: string
  readonly componentName: string
  readonly props: Readonly<Record<string, unknown>>
  readonly agent: Readonly<{ schemaVersion: number; artifactRef: unknown }> | null
  readonly dashboard: Readonly<Record<string, unknown>> | null
  readonly parentId: string | null
  readonly index: number
  readonly siblingOrder: readonly string[]
}

interface MaterialIdentity {
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: string
}

interface MaterialRootFence {
  readonly branchId: string
  readonly ownerType: string
  readonly ownerId: string
  readonly artifactId: string
  readonly sourceRevision: string
  readonly materialRefs: readonly MaterialIdentity[]
}

interface MaterialGcSnapshot {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly generationFence: readonly Readonly<{ branchId: string; draftGeneration: number }>[]
  readonly sessionGenerationFence: readonly Readonly<{
    branchId: string
    sessionId: string
    persistenceGeneration: number
  }>[]
  readonly rootFence: readonly MaterialRootFence[]
  readonly storeFence: readonly Readonly<{ store: string; recordCount: number; digest: string }>[]
  readonly materialRefs: readonly MaterialIdentity[]
  readonly unresolvedPromotionIds: readonly string[]
  readonly snapshotDigest: string
}

const recordBrowserErrors = (page: Page): BrowserErrorLog => {
  const log: BrowserErrorLog = { pageErrors: [], cspErrors: [] }
  page.on('pageerror', error => log.pageErrors.push(error.message))
  page.on('console', message => {
    if (/content security policy|refused to (?:execute|frame|load)/iu.test(message.text())) {
      log.cspErrors.push(message.text())
    }
  })
  return log
}

const readProbe = (page: Page): Promise<WorkspaceProbe | null> =>
  page.evaluate(() => window.__EASY_EDITOR_E2E__?.getAgentWorkspaceState() ?? null)

const waitForWorkspaceRuntime = async (page: Page): Promise<WorkspaceProbe> => {
  await expect(page.locator('.lc-designer')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__EASY_EDITOR_E2E__?.getEngineState())).toBe('ready')
  await expect
    .poll(async () => {
      const probe = await readProbe(page)
      return probe?.snapshot.remote.runtimeStatus === 'ready' && probe.snapshot.remote.availability.state === 'ready'
    })
    .toBe(true)
  const probe = await readProbe(page)
  if (!probe?.binding.sessionId) throw new Error('G009 Agent Workspace binding is unavailable')
  return probe
}

const openWorkspace = async (page: Page): Promise<Locator> => {
  const workspace = page.getByTestId(WORKSPACE_TEST_ID)
  if (!(await workspace.isVisible().catch(() => false))) await page.getByTestId('agent-workspace-toggle').click()
  await expect(workspace).toBeVisible()
  return workspace
}

const closeWorkspace = async (workspace: Locator): Promise<void> => {
  await workspace.getByRole('button', { name: '关闭 Agent Workspace' }).click()
  await expect(workspace).toBeHidden()
}

const authorizeScope = async (page: Page, workspace: Locator, label: string, scope: string): Promise<void> => {
  await workspace.getByRole('tab', { name: '授权' }).click()
  const row = workspace.getByRole('listitem').filter({ hasText: label })
  const authorize = row.getByRole('button', { name: '授权' })
  if (await authorize.isVisible().catch(() => false)) await authorize.click()
  await expect
    .poll(async () => (await readProbe(page))?.snapshot.remote.grants.find(grant => grant.scope === scope)?.status)
    .toBe('granted')
}

const surfaceId = (mode: 'editor' | 'preview') => (mode === 'editor' ? EDITOR_SURFACE_ID : PREVIEW_SURFACE_ID)

const sandboxFrame = (page: Page, mode: 'editor' | 'preview') =>
  page.frameLocator(`iframe[data-online-component-sandbox="${surfaceId(mode)}"]`)

const sandboxInstance = (page: Page, mode: 'editor' | 'preview', instanceId: string) =>
  sandboxFrame(page, mode).locator(`.online-component-instance[data-instance-id="${instanceId}"]`)

const expectSurfaceInstances = async (
  page: Page,
  mode: 'editor' | 'preview',
  instanceIds: readonly string[],
  renderedInstanceIds: readonly string[] = instanceIds,
) => {
  await expect(page.locator(`[data-easy-editor-surface-overlay-mount="${mode}"]`)).toBeVisible()
  await expect(page.locator(`iframe[data-online-component-sandbox="${surfaceId(mode)}"]`)).toHaveCount(1)
  await expect(page.locator('[data-online-component-shell]')).toHaveCount(instanceIds.length)
  const instances = sandboxFrame(page, mode).locator('.online-component-instance')
  await expect(instances).toHaveCount(instanceIds.length)
  await expect
    .poll(async () =>
      (
        await instances.evaluateAll(elements => elements.map(element => element.getAttribute('data-instance-id')))
      ).sort(),
    )
    .toEqual([...instanceIds].sort())
  for (const instanceId of renderedInstanceIds) {
    await expect(sandboxInstance(page, mode, instanceId)).toHaveAttribute(
      'data-source-revision',
      GENERATED_MATERIAL_SOURCE_REVISION,
    )
    await expect(sandboxInstance(page, mode, instanceId)).toHaveAttribute(
      'data-rendered-data-value',
      GENERATED_MATERIAL_RESOLVED_DATA_VALUE,
    )
  }
}

const readEditorNodes = (page: Page, nodeIds: readonly string[]): Promise<Record<string, NodeProjection | null>> =>
  page.evaluate(async ids => {
    const runtime = await import('/src/editor/runtime.ts')
    const document = runtime.engine.project.currentDocument
    if (!document) throw new Error('G009 editor document is unavailable')
    return Object.fromEntries(
      ids.map(id => {
        const node = document.getNode(id)
        if (!node) return [id, null]
        const raw = node.exportRaw() as Record<string, unknown>
        return [
          id,
          {
            id: node.id,
            componentName: node.componentName,
            props: structuredClone((raw.props ?? {}) as Record<string, unknown>),
            agent: structuredClone((raw.$agent ?? null) as Record<string, unknown> | null),
            dashboard: structuredClone((raw.$dashboard ?? null) as Record<string, unknown> | null),
            parentId: node.parent?.id ?? null,
            index: node.index,
            siblingOrder: node.parent?.childrenNodes.map(sibling => sibling.id) ?? [node.id],
          },
        ]
      }),
    )
  }, nodeIds)

const readPersistedNodes = async (
  page: Page,
  nodeIds: readonly string[],
  branchId?: string,
): Promise<{
  readonly projectId: string
  readonly branchId: string
  readonly draftGeneration: number
  readonly nodes: Record<string, NodeProjection | null>
}> =>
  page.evaluate(
    async ({ ids, requestedBranchId, projectId }) => {
      const storage = await import('/src/lib/storage/index.mjs')
      const pointer = JSON.parse(localStorage.getItem(storage.DASHBOARD_STORAGE_IDENTITY_POINTER_KEY) ?? 'null') as {
        projectId?: string
        branchId?: string
      } | null
      const activeBranchId = requestedBranchId ?? pointer?.branchId
      if (pointer?.projectId !== projectId || typeof activeBranchId !== 'string') {
        throw new Error('G009 persisted identity pointer is unavailable')
      }
      const coordinator = new storage.ProjectPersistenceCoordinator({
        backend: new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
        crypto,
      })
      try {
        const draft = await coordinator.readWorkingDraft({ projectId, branchId: activeBranchId })
        if (!draft) throw new Error('G009 persisted draft is unavailable')
        const found = new Map<string, NodeProjection>()
        const visit = (
          node: Record<string, unknown>,
          parentId: string | null,
          siblings: readonly string[],
          index: number,
        ) => {
          const id = typeof node.id === 'string' ? node.id : ''
          if (ids.includes(id)) {
            found.set(id, {
              id,
              componentName: String(node.componentName ?? ''),
              props: structuredClone((node.props ?? {}) as Record<string, unknown>),
              agent: structuredClone(
                (node.$agent ?? null) as Record<string, unknown> | null,
              ) as NodeProjection['agent'],
              dashboard: structuredClone(
                (node.$dashboard ?? null) as Record<string, unknown> | null,
              ) as NodeProjection['dashboard'],
              parentId,
              index,
              siblingOrder: [...siblings],
            })
          }
          const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : []
          const childIds = children.map(child => String(child.id ?? ''))
          children.forEach((child, childIndex) => visit(child, id, childIds, childIndex))
        }
        const roots = draft.projectSchema.componentsTree as Record<string, unknown>[]
        const rootIds = roots.map(root => String(root.id ?? ''))
        roots.forEach((root, index) => visit(root, null, rootIds, index))
        return {
          projectId,
          branchId: activeBranchId,
          draftGeneration: draft.draftGeneration,
          nodes: Object.fromEntries(ids.map(id => [id, found.get(id) ?? null])),
        }
      } finally {
        await coordinator.dispose()
      }
    },
    { ids: nodeIds, requestedBranchId: branchId, projectId: GENERATED_MATERIAL_PROJECT_ID },
  )

const readMaterialGcSnapshot = (page: Page): Promise<MaterialGcSnapshot> =>
  page.evaluate(async projectId => {
    const storage = await import('/src/lib/storage/index.mjs')
    const coordinator = new storage.ProjectPersistenceCoordinator({
      backend: new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
      crypto,
    })
    try {
      return await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
    } finally {
      await coordinator.dispose()
    }
  }, GENERATED_MATERIAL_PROJECT_ID) as Promise<MaterialGcSnapshot>

const materialIdentityOf = (ref: LocalMaterialArtifactRef): MaterialIdentity => ({
  materialId: ref.target.materialId,
  materialVersion: ref.target.materialVersion,
  buildIntegrity: ref.target.buildIntegrity,
})

const compareRootFence = (left: MaterialRootFence, right: MaterialRootFence) =>
  [left.branchId, left.ownerType, left.ownerId, left.artifactId, left.sourceRevision]
    .join('\0')
    .localeCompare([right.branchId, right.ownerType, right.ownerId, right.artifactId, right.sourceRevision].join('\0'))

const openDurableMaterialCard = async (page: Page, material: MaterialIdentity): Promise<Locator> => {
  const quiescenceSnapshot = await page.evaluate(async () => {
    const runtime = await import('/src/editor/runtime.ts')
    await runtime.dashboardMaterialGcRuntime.waitForIdle()
    const gate = runtime.dashboardMutationQuiescenceGate
    if (!gate) throw new Error('G009 Dashboard mutation quiescence gate is unavailable')
    return gate.getSnapshot()
  })
  expect(quiescenceSnapshot.inputBlocked).toBe(false)
  await page.getByRole('button', { name: '组件', exact: true }).click()
  await expect(page.getByText('Components', { exact: true })).toBeVisible()
  const durableMaterials = page.getByRole('button', { name: /本地耐久物料/u })
  await expect(durableMaterials).toContainText('(1)')
  await durableMaterials.click()
  const card = page.locator(
    `[data-testid="durable-material-card"][data-material-id="${material.materialId}"][data-material-version="${material.materialVersion}"][data-build-integrity="${material.buildIntegrity}"]`,
  )
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('aria-disabled', 'false')
  await expect(card).toHaveAttribute('draggable', 'true')
  return card
}

const dragDurableMaterialIntoCanvas = async (page: Page, card: Locator): Promise<void> => {
  const canvas = page.locator('.lc-simulator-content-frame')
  await expect(canvas).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  await card.hover({ trial: true })
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('G009 durable material drag geometry is unavailable')
  const draggingObserved = page.evaluate(async () => {
    const runtime = await import('/src/editor/runtime.ts')
    const deadline = performance.now() + 5_000
    while (performance.now() < deadline) {
      if (runtime.engine.designer.dragon.dragging) return true
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    return false
  })
  await card.dragTo(canvas, {
    targetPosition: { x: canvasBox.width / 2, y: canvasBox.height / 2 },
  })
  expect(await draggingObserved).toBe(true)
  expect(
    await page.evaluate(async () => {
      const runtime = await import('/src/editor/runtime.ts')
      return runtime.engine.designer.dragon.dragging
    }),
  ).toBe(false)
}

test('real promotion remains durable across editor/preview reload and Workspace named-version restore', async ({
  context,
  page,
}) => {
  const editorErrors = recordBrowserErrors(page)
  const seed = await seedGeneratedMaterialProject(page, { instanceIds: [GENERATED_MATERIAL_PRIMARY_ID] })

  await page.goto('/')
  const initialProbe = await waitForWorkspaceRuntime(page)
  const initialBinding = initialProbe.binding as Required<WorkspaceProbe['binding']>
  await expectSurfaceInstances(page, 'editor', [GENERATED_MATERIAL_PRIMARY_ID])
  const workspace = await openWorkspace(page)
  await authorizeScope(page, workspace, '修改当前项目', 'project.write')
  await authorizeScope(page, workspace, '发布自定义物料', 'material.promote.local')

  const onlinePrimaryProjection = await readEditorNodes(page, [GENERATED_MATERIAL_PRIMARY_ID])
  const onlinePrimary = onlinePrimaryProjection[GENERATED_MATERIAL_PRIMARY_ID]
  expect(onlinePrimary?.agent?.artifactRef).toEqual(seed.artifactRef)
  expect(onlinePrimary?.siblingOrder).toEqual([GENERATED_MATERIAL_PRIMARY_ID, GENERATED_MATERIAL_ORDINARY_ID])

  await workspace.getByRole('tab', { name: '版本' }).click()
  await page.locator('#agent-workspace-version-name').fill(VERSION_NAME)
  await workspace.getByRole('button', { name: '保存版本' }).click()
  await expect.poll(async () => (await readProbe(page))?.snapshot.remote.versions.length ?? 0).toBe(1)
  const version = (await readProbe(page))?.snapshot.remote.versions[0]
  if (!version) throw new Error('G009 named version is unavailable')
  expect(version).toMatchObject({
    name: VERSION_NAME,
    sourceBranchId: initialBinding.branchId,
    sourceSessionId: initialBinding.sessionId,
  })
  expect(version.sourceTaskId ?? null).toBeNull()
  await closeWorkspace(workspace)

  const promotion = (await page.evaluate(
    async ({ authority, binding, callId, nodeId, stepId, taskId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const storage = await import('/src/lib/storage/index.mjs')
      const host = runtime.composeDashboardAgentHost({ ...binding, taskId }, authority)
      if (!host) throw new Error('G009 production Dashboard Agent Host is unavailable')
      try {
        const observed = await host.observe({ schemaVersion: 1, ...binding, taskId, mode: 'full' })
        const capability = await host.describeCapability({
          schemaVersion: 1,
          projectId: binding.projectId,
          branchId: binding.branchId,
          capability: 'artifact.promoteLocal',
        })
        const call = {
          schemaVersion: 1 as const,
          ...binding,
          taskId,
          stepId,
          callId,
          capability: 'artifact.promoteLocal' as const,
          expectedRevision: observed.revision,
          arguments: { schemaVersion: 1 as const, nodeId },
        }
        const result = await host.invoke(call, { schemaVersion: 1 })
        if (result.status !== 'applied' || !result.output) {
          throw new Error(`G009 production promotion did not apply: ${JSON.stringify(result)}`)
        }
        const receipt = await host.queryReceipt({
          schemaVersion: 1,
          ...binding,
          taskId,
          callId,
        })
        const lineage = await runtime.dashboardPersistence.readDurableAgentReceiptLineage({
          projectId: binding.projectId,
          branchId: binding.branchId,
          callId,
        })
        const journal = await runtime.dashboardPersistence.readAgentPersistence({
          schemaVersion: 1,
          ...binding,
          expectedPersistenceGeneration: 0,
        })
        const backend = new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto })
        const coordinator = new storage.ProjectPersistenceCoordinator({ backend, crypto })
        try {
          const [materialSnapshot, storeSnapshot] = await Promise.all([
            coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId: binding.projectId }),
            backend.readMaterialGcStoreSnapshot(binding.projectId),
          ])
          return {
            observedRevision: observed.revision,
            capability,
            call,
            result,
            receipt,
            lineage,
            promotionJournal: journal.records.find(record => record.recordId === `promotion:${callId}`) ?? null,
            rawReceipt: storeSnapshot.stores.toolReceipts.find(record => record.callId === callId) ?? null,
            rawIntent: storeSnapshot.stores.receiptIntents.find(record => record.callId === callId) ?? null,
            checkpoint:
              storeSnapshot.stores.agentCheckpoints.find(record => record.checkpointId === `promotion:${callId}`) ??
              null,
            materialSnapshot,
            storeRecordCounts: Object.fromEntries(
              Object.entries(storeSnapshot.stores).map(([store, records]) => [store, records.length]),
            ),
          }
        } finally {
          await coordinator.dispose()
        }
      } finally {
        host.dispose()
      }
    },
    {
      authority: LOCAL_MATERIAL_E2E_GRANT_AUTHORITY,
      binding: {
        projectId: initialBinding.projectId,
        branchId: initialBinding.branchId,
        sessionId: initialBinding.sessionId,
      },
      callId: PROMOTION_CALL_ID,
      nodeId: GENERATED_MATERIAL_PRIMARY_ID,
      stepId: PROMOTION_STEP_ID,
      taskId: PROMOTION_TASK_ID,
    },
  )) as {
    observedRevision: string
    capability: Readonly<{ revision: string }>
    call: LocalMaterialPromotionCall
    result: Readonly<{ status: 'applied'; revision: string; output: { artifactRef: LocalMaterialArtifactRef } }>
    receipt: Readonly<Record<string, unknown>> | null
    lineage: Readonly<Record<string, unknown>>
    promotionJournal: Readonly<Record<string, unknown>> | null
    rawReceipt: Readonly<Record<string, unknown>> | null
    rawIntent: Readonly<Record<string, unknown>> | null
    checkpoint: Readonly<Record<string, unknown>> | null
    materialSnapshot: MaterialGcSnapshot
    storeRecordCounts: Readonly<Record<string, number>>
  }

  const localArtifactRef = promotion.result.output.artifactRef
  const materialIdentity = materialIdentityOf(localArtifactRef)
  expect(promotion.capability.revision).toBe('artifact.promoteLocal/1')
  expect(promotion.result.status).toBe('applied')
  expect(localArtifactRef).toMatchObject({
    artifactId: seed.artifactRef.artifactId,
    sourceRevision: seed.artifactRef.sourceRevision,
    logicalComponentId: seed.artifactRef.logicalComponentId,
    sourceIntegrity: seed.artifactRef.sourceIntegrity,
    target: {
      kind: 'local-material',
      materialId: seed.artifactRef.logicalComponentId,
      materialVersion: seed.artifactRef.sourceRevision,
      buildIntegrity: expect.stringMatching(/^sha256:[\da-f]{64}$/u),
    },
    rollbackTo: {
      artifactId: seed.artifactRef.artifactId,
      sourceRevision: seed.artifactRef.sourceRevision,
      logicalComponentId: seed.artifactRef.logicalComponentId,
      sourceIntegrity: seed.artifactRef.sourceIntegrity,
    },
  })
  expect(promotion.promotionJournal).toMatchObject({
    recordId: `promotion:${PROMOTION_CALL_ID}`,
    kind: 'local-material-promotion',
    value: {
      stage: 'committed',
      call: promotion.call,
      output: { artifactRef: localArtifactRef },
      server: {
        materialId: materialIdentity.materialId,
        materialVersion: materialIdentity.materialVersion,
        buildIntegrity: materialIdentity.buildIntegrity,
      },
    },
  })
  const promotionId = (promotion.promotionJournal?.value as { promotionId?: string } | undefined)?.promotionId
  expect(promotionId).toMatch(/^sha256:[\da-f]{64}$/u)
  expect(promotion.receipt).toMatchObject({
    projectId: initialBinding.projectId,
    branchId: initialBinding.branchId,
    callId: PROMOTION_CALL_ID,
    status: 'applied',
    revision: promotion.result.revision,
  })
  expect(promotion.rawReceipt).toEqual(promotion.receipt)
  expect(promotion.lineage).toMatchObject({
    projectId: initialBinding.projectId,
    branchId: initialBinding.branchId,
    callId: PROMOTION_CALL_ID,
    receiptIntent: { status: 'pending' },
    receipt: { status: 'applied', revision: promotion.result.revision },
    applyWitness: {
      schemaVersion: 1,
      projectId: initialBinding.projectId,
      branchId: initialBinding.branchId,
      callId: PROMOTION_CALL_ID,
      coreMutationVersion: expect.any(Number),
      draftGeneration: expect.any(Number),
      transactionFingerprint: expect.stringMatching(/^sha256:[\da-f]{64}$/u),
      affectedSlotTokens: expect.arrayContaining([
        {
          slotKey: `${initialBinding.projectId}/${initialBinding.branchId}/${GENERATED_MATERIAL_PRIMARY_ID}/extras/$agent`,
          token: `agent:${PROMOTION_CALL_ID}`,
        },
      ]),
    },
  })
  expect(promotion.rawIntent).toEqual((promotion.lineage as { receiptIntent: unknown }).receiptIntent)
  expect(promotion.checkpoint).toMatchObject({
    projectId: initialBinding.projectId,
    branchId: initialBinding.branchId,
    sessionId: initialBinding.sessionId,
    callId: PROMOTION_CALL_ID,
    checkpointId: `promotion:${PROMOTION_CALL_ID}`,
    value: {
      capability: 'artifact.promoteLocal',
      taskId: PROMOTION_TASK_ID,
      stepId: PROMOTION_STEP_ID,
      promotionId,
      status: 'applied',
    },
  })
  expect(promotion.materialSnapshot.materialRefs).toEqual([materialIdentity])
  expect(promotion.materialSnapshot.unresolvedPromotionIds).toEqual([])

  await expect
    .poll(() =>
      page.evaluate(async expectedArtifactRef => {
        const runtime = await import('/src/editor/runtime.ts')
        const snapshot = runtime.dashboardLocalMaterialCatalogRuntime.getSnapshot()
        return (
          snapshot.status === 'ready' &&
          snapshot.materials.some(
            material =>
              material.availability === 'available' &&
              material.artifactRef.target.materialId === expectedArtifactRef.target.materialId &&
              material.artifactRef.target.materialVersion === expectedArtifactRef.target.materialVersion &&
              material.artifactRef.target.buildIntegrity === expectedArtifactRef.target.buildIntegrity,
          )
        )
      }, localArtifactRef),
    )
    .toBe(true)
  const catalogMaterial = await page.evaluate(async expectedArtifactRef => {
    const runtime = await import('/src/editor/runtime.ts')
    const snapshot = runtime.dashboardLocalMaterialCatalogRuntime.getSnapshot()
    return (
      snapshot.materials.find(
        material =>
          material.artifactRef.target.materialId === expectedArtifactRef.target.materialId &&
          material.artifactRef.target.materialVersion === expectedArtifactRef.target.materialVersion &&
          material.artifactRef.target.buildIntegrity === expectedArtifactRef.target.buildIntegrity,
      ) ?? null
    )
  }, localArtifactRef)
  expect(catalogMaterial).toMatchObject({
    promotionId,
    availability: 'available',
    artifactRef: localArtifactRef,
  })

  const durableMaterialCard = await openDurableMaterialCard(page, materialIdentity)
  const beforePaletteDragIds = onlinePrimary?.siblingOrder ?? []
  await dragDurableMaterialIntoCanvas(page, durableMaterialCard)
  const durableCopyId = await page.evaluate(
    async ({ beforeIds, expectedArtifactRef, primaryId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const document = runtime.engine.project.currentDocument
      const primary = document?.getNode(primaryId)
      if (!document || !primary?.parent) throw new Error('G009 primary node authority is unavailable')
      const candidates = primary.parent.childrenNodes.filter(node => {
        if (beforeIds.includes(node.id) || node.componentName !== 'GeneratedMaterialHost') return false
        const raw = node.exportRaw() as Record<string, unknown>
        const artifactRef = (raw.$agent as { artifactRef?: LocalMaterialArtifactRef } | undefined)?.artifactRef
        return (
          artifactRef?.target.materialId === expectedArtifactRef.target.materialId &&
          artifactRef.target.materialVersion === expectedArtifactRef.target.materialVersion &&
          artifactRef.target.buildIntegrity === expectedArtifactRef.target.buildIntegrity
        )
      })
      if (candidates.length !== 1) {
        throw new Error(`G009 palette drag created ${candidates.length} matching nodes`)
      }
      return candidates[0].id
    },
    {
      beforeIds: beforePaletteDragIds,
      expectedArtifactRef: localArtifactRef,
      primaryId: GENERATED_MATERIAL_PRIMARY_ID,
    },
  )
  const paletteNode = (await readEditorNodes(page, [durableCopyId]))[durableCopyId]
  expect(paletteNode).toMatchObject({
    id: durableCopyId,
    componentName: 'GeneratedMaterialHost',
    props: {},
    agent: { schemaVersion: 1, artifactRef: localArtifactRef },
    dashboard: { rect: { x: expect.any(Number), y: expect.any(Number), width: 400, height: 240 } },
    parentId: onlinePrimary?.parentId ?? null,
    index: 2,
    siblingOrder: [GENERATED_MATERIAL_PRIMARY_ID, GENERATED_MATERIAL_ORDINARY_ID, durableCopyId],
  })
  expect(
    await page.evaluate(async nodeId => {
      const runtime = await import('/src/editor/runtime.ts')
      return runtime.engine.designer.selection.has(nodeId)
    }, durableCopyId),
  ).toBe(true)

  const paletteInsert = await page.evaluate(
    async ({ copyId, primaryId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const document = runtime.engine.project.currentDocument
      const primary = document?.getNode(primaryId)
      const copy = document?.getNode(copyId)
      if (!document || !primary?.parent || !copy || copy.parent !== primary.parent) {
        throw new Error('G009 palette-created node authority is unavailable')
      }
      const primaryRaw = primary.exportRaw() as Record<string, unknown>
      const copyRaw = copy.exportRaw() as Record<string, unknown>
      const copyProps = {
        ...structuredClone((primaryRaw.props ?? {}) as Record<string, unknown>),
        label: 'G009 Durable Copy',
        value: 99,
      }
      const copyRect = { x: 1040, y: 620, width: 280, height: 160 }
      runtime.engine.transactions.runOnDocument(
        document,
        [
          {
            type: 'updateProps' as const,
            documentId: document.id,
            nodeId: copyId,
            props: copyProps,
            extras: { $dashboard: { ...((copyRaw.$dashboard ?? {}) as Record<string, unknown>), rect: copyRect } },
          },
          {
            type: 'moveNode' as const,
            documentId: document.id,
            nodeId: copyId,
            parentId: primary.parent.id,
            at: primary.index + 1,
          },
        ],
        { expectedMutationVersion: document.mutationVersion },
      )
      await runtime.persistDashboardProject('manual-save')
      await runtime.dashboardPersistence.flush()
      return { copyProps, copyRect }
    },
    { copyId: durableCopyId, primaryId: GENERATED_MATERIAL_PRIMARY_ID },
  )

  const onlineNodes: Record<string, NodeProjection | null> = {
    ...onlinePrimaryProjection,
    [durableCopyId]: null,
  }
  const localNodes = await readEditorNodes(page, [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])
  const localPrimary = localNodes[GENERATED_MATERIAL_PRIMARY_ID]
  const localCopy = localNodes[durableCopyId]
  expect(localPrimary).toMatchObject({
    id: onlinePrimary?.id,
    componentName: onlinePrimary?.componentName,
    props: onlinePrimary?.props,
    dashboard: onlinePrimary?.dashboard,
    parentId: onlinePrimary?.parentId,
    index: onlinePrimary?.index,
    agent: { schemaVersion: 1, artifactRef: localArtifactRef },
    siblingOrder: [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId, GENERATED_MATERIAL_ORDINARY_ID],
  })
  expect(localCopy).toEqual({
    id: durableCopyId,
    componentName: 'GeneratedMaterialHost',
    props: paletteInsert.copyProps,
    agent: { schemaVersion: 1, artifactRef: localArtifactRef },
    dashboard: { rect: paletteInsert.copyRect },
    parentId: onlinePrimary?.parentId ?? null,
    index: 1,
    siblingOrder: [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId, GENERATED_MATERIAL_ORDINARY_ID],
  })

  await expectSurfaceInstances(page, 'editor', [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])
  await expect(sandboxInstance(page, 'editor', GENERATED_MATERIAL_PRIMARY_ID)).toHaveAttribute(
    'data-rendered-label',
    'G008 Instance 1',
  )
  await expect(sandboxInstance(page, 'editor', durableCopyId)).toHaveAttribute(
    'data-rendered-label',
    'G009 Durable Copy',
  )
  await page.reload()
  const reloadedProbe = await waitForWorkspaceRuntime(page)
  expect(reloadedProbe.binding).toEqual(initialBinding)
  expect(reloadedProbe.snapshot.remote.grants).toContainEqual(
    expect.objectContaining({ scope: 'material.promote.local', status: 'granted' }),
  )
  const reloadedProtectedAccess = await page.evaluate(
    async ({ authority, binding, call }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const host = runtime.composeDashboardAgentHost({ ...binding, taskId: call.taskId }, authority)
      if (!host) throw new Error('G009 reloaded Dashboard Agent Host is unavailable')
      try {
        const capability = await host.describeCapability({
          schemaVersion: 1,
          projectId: binding.projectId,
          branchId: binding.branchId,
          capability: 'artifact.promoteLocal',
        })
        const result = await host.invoke(call, { schemaVersion: 1 })
        const receipt = await host.queryReceipt({
          schemaVersion: 1,
          ...binding,
          taskId: call.taskId,
          callId: call.callId,
        })
        return { capability, result, receipt }
      } finally {
        host.dispose()
      }
    },
    {
      authority: LOCAL_MATERIAL_E2E_GRANT_AUTHORITY,
      binding: {
        projectId: initialBinding.projectId,
        branchId: initialBinding.branchId,
        sessionId: initialBinding.sessionId,
      },
      call: promotion.call,
    },
  )
  expect(reloadedProtectedAccess.capability.revision).toBe('artifact.promoteLocal/1')
  expect(reloadedProtectedAccess.result).toEqual(promotion.result)
  expect(reloadedProtectedAccess.receipt).toEqual(promotion.receipt)
  await expectSurfaceInstances(page, 'editor', [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])
  expect(await readEditorNodes(page, [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])).toEqual(localNodes)

  const preview = await context.newPage()
  const previewErrors = recordBrowserErrors(preview)
  await preview.goto('/preview')
  await expectSurfaceInstances(preview, 'preview', [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])
  let previewDraft = await readPersistedNodes(preview, [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])
  expect(previewDraft).toMatchObject({
    projectId: initialBinding.projectId,
    branchId: initialBinding.branchId,
    nodes: localNodes,
  })
  expect(previewDraft.nodes[GENERATED_MATERIAL_PRIMARY_ID]?.agent?.artifactRef).toEqual(localArtifactRef)
  await preview.reload()
  await expectSurfaceInstances(preview, 'preview', [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])
  expect((await readPersistedNodes(preview, [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])).nodes).toEqual(localNodes)

  const materialGcCycle = await page.evaluate(async projectId => {
    const probe = window.__EASY_EDITOR_E2E__
    if (!probe?.triggerMaterialGc) throw new Error('G009 Material GC E2E probe is unavailable')
    const runtimeSnapshot = await probe.triggerMaterialGc()
    const stateModule = await import('/src/editor/agent/capabilities/promotion/material-gc-replica-state.mjs')
    const projectState = JSON.parse(
      localStorage.getItem(
        `${stateModule.DASHBOARD_MATERIAL_GC_PROJECT_STORAGE_PREFIX}${encodeURIComponent(projectId)}`,
      ) ?? 'null',
    )
    return { runtimeSnapshot, projectState }
  }, initialBinding.projectId)
  expect(materialGcCycle.runtimeSnapshot).toMatchObject({
    schemaVersion: 1,
    status: 'swept',
    projectId: initialBinding.projectId,
    failure: null,
  })
  expect(materialGcCycle.projectState).toMatchObject({
    schemaVersion: 1,
    projectId: initialBinding.projectId,
    replicaId: expect.stringMatching(/^[\da-f-]{36}$/u),
    replicaGeneration: expect.any(Number),
    snapshotDigest: expect.stringMatching(/^sha256:[\da-f]{64}$/u),
    pendingPlanRequest: null,
    status: 'active',
  })
  expect(materialGcCycle.projectState.replicaGeneration).toBeGreaterThan(0)

  const stableMainSnapshot = await readMaterialGcSnapshot(page)
  expect(await readMaterialGcSnapshot(page)).toEqual(stableMainSnapshot)
  expect(stableMainSnapshot.snapshotDigest).toMatch(/^sha256:[\da-f]{64}$/u)
  expect(materialGcCycle.projectState.snapshotDigest).toBe(stableMainSnapshot.snapshotDigest)
  expect(stableMainSnapshot.materialRefs).toEqual([materialIdentity])
  expect(stableMainSnapshot.unresolvedPromotionIds).toEqual([])
  expect(stableMainSnapshot.generationFence).toEqual([
    { branchId: initialBinding.branchId, draftGeneration: previewDraft.draftGeneration },
  ])
  expect(stableMainSnapshot.sessionGenerationFence).toEqual([
    {
      branchId: initialBinding.branchId,
      sessionId: initialBinding.sessionId,
      persistenceGeneration: expect.any(Number),
    },
  ])
  expect(stableMainSnapshot.storeFence).toEqual(
    stableMainSnapshot.storeFence.map(fence => ({
      store: fence.store,
      recordCount: promotion.storeRecordCounts[fence.store],
      digest: expect.stringMatching(/^sha256:[\da-f]{64}$/u),
    })),
  )
  const expectedMainRoots = [
    {
      branchId: initialBinding.branchId,
      ownerType: 'checkpoint',
      ownerId: `promotion:${PROMOTION_CALL_ID}`,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      materialRefs: [materialIdentity],
    },
    {
      branchId: initialBinding.branchId,
      ownerType: 'durable-registry',
      ownerId: promotionId,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      materialRefs: [materialIdentity],
    },
    {
      branchId: initialBinding.branchId,
      ownerType: 'project-version',
      ownerId: version.versionId,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      materialRefs: [],
    },
    {
      branchId: initialBinding.branchId,
      ownerType: 'promotion-rollback',
      ownerId: promotionId,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      materialRefs: [materialIdentity],
    },
    {
      branchId: initialBinding.branchId,
      ownerType: 'receipt-intent',
      ownerId: PROMOTION_CALL_ID,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      materialRefs: [materialIdentity],
    },
    {
      branchId: initialBinding.branchId,
      ownerType: 'task-journal',
      ownerId: `task-journal-v1:${encodeURIComponent(initialBinding.sessionId)}:${encodeURIComponent(
        `promotion:${PROMOTION_CALL_ID}`,
      )}`,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      materialRefs: [materialIdentity],
    },
    {
      branchId: initialBinding.branchId,
      ownerType: 'tool-receipt',
      ownerId: PROMOTION_CALL_ID,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      materialRefs: [materialIdentity],
    },
    {
      branchId: initialBinding.branchId,
      ownerType: 'working-draft',
      ownerId: initialBinding.branchId,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      materialRefs: [materialIdentity],
    },
  ].sort(compareRootFence)
  expect(stableMainSnapshot.rootFence).toEqual(expectedMainRoots)

  await page.reload()
  await waitForWorkspaceRuntime(page)
  await expectSurfaceInstances(page, 'editor', [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])
  expect(await readEditorNodes(page, [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])).toEqual(localNodes)
  await preview.reload()
  await expectSurfaceInstances(preview, 'preview', [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])
  expect((await readPersistedNodes(preview, [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])).nodes).toEqual(localNodes)

  const restoredWorkspace = await openWorkspace(page)
  await restoredWorkspace.getByRole('tab', { name: '版本' }).click()
  await restoredWorkspace
    .getByRole('listitem')
    .filter({ hasText: VERSION_NAME })
    .getByRole('button', { name: '恢复到新分支' })
    .click()
  await expect
    .poll(async () => {
      const probe = await readProbe(page)
      return probe ? `${probe.binding.branchId}\0${probe.binding.sessionId ?? ''}` : null
    })
    .not.toBe(`${initialBinding.branchId}\0${initialBinding.sessionId}`)
  const forkProbe = await waitForWorkspaceRuntime(page)
  const forkBinding = forkProbe.binding as Required<WorkspaceProbe['binding']>
  expect(forkBinding.projectId).toBe(initialBinding.projectId)
  expect(forkBinding.branchId).not.toBe(initialBinding.branchId)
  expect(forkBinding.sessionId).not.toBe(initialBinding.sessionId)
  expect(forkProbe.snapshot.remote.branchId).toBe(forkBinding.branchId)
  expect(forkProbe.snapshot.remote.sessionId).toBe(forkBinding.sessionId)
  expect(forkProbe.snapshot.remote.tasks).toEqual([])
  expect(forkProbe.snapshot.remote.versions).toContainEqual(expect.objectContaining({ versionId: version.versionId }))
  await closeWorkspace(restoredWorkspace)
  await expectSurfaceInstances(page, 'editor', [GENERATED_MATERIAL_PRIMARY_ID])
  await expect(page.locator(`[data-easy-editor-generated-material-host="${durableCopyId}"]`)).toHaveCount(0)
  expect(await readEditorNodes(page, [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])).toEqual(onlineNodes)

  const restoreEvidence = await page.evaluate(
    async ({ forkBranchId, mainBranchId, projectId }) => {
      const runtime = await import('/src/editor/runtime.ts')
      const storage = await import('/src/lib/storage/index.mjs')
      const pointer = JSON.parse(localStorage.getItem(storage.DASHBOARD_STORAGE_IDENTITY_POINTER_KEY) ?? 'null')
      const persistence = runtime.dashboardPersistence.getSnapshot()
      const coordinator = new storage.ProjectPersistenceCoordinator({
        backend: new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
        crypto,
      })
      try {
        const [main, target, sessions] = await Promise.all([
          coordinator.readWorkingDraft({ projectId, branchId: mainBranchId }),
          coordinator.readWorkingDraft({ projectId, branchId: forkBranchId }),
          coordinator.listAgentSessions({ schemaVersion: 1, projectId, branchId: forkBranchId }),
        ])
        return { pointer, persistence, main, target, sessions }
      } finally {
        await coordinator.dispose()
      }
    },
    {
      forkBranchId: forkBinding.branchId,
      mainBranchId: initialBinding.branchId,
      projectId: initialBinding.projectId,
    },
  )
  expect(restoreEvidence.pointer).toEqual({
    schemaVersion: 1,
    projectId: forkBinding.projectId,
    branchId: forkBinding.branchId,
  })
  expect(restoreEvidence.persistence).toMatchObject({
    state: 'ready',
    projectId: forkBinding.projectId,
    branchId: forkBinding.branchId,
  })
  expect(restoreEvidence.sessions).toEqual([
    expect.objectContaining({
      projectId: forkBinding.projectId,
      branchId: forkBinding.branchId,
      sessionId: forkBinding.sessionId,
      status: 'active',
      forkedFrom: {
        sessionId: initialBinding.sessionId,
        taskId: null,
        versionId: version.versionId,
      },
    }),
  ])
  const restoredDraftNodes = await readPersistedNodes(
    page,
    [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId],
    forkBinding.branchId,
  )
  expect(restoredDraftNodes.nodes).toEqual(onlineNodes)
  const durableMainNodes = await readPersistedNodes(
    page,
    [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId],
    initialBinding.branchId,
  )
  expect(durableMainNodes.nodes).toEqual(localNodes)

  await page.reload()
  expect((await waitForWorkspaceRuntime(page)).binding).toEqual(forkBinding)
  await expectSurfaceInstances(page, 'editor', [GENERATED_MATERIAL_PRIMARY_ID])
  expect(await readEditorNodes(page, [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])).toEqual(onlineNodes)
  await preview.reload()
  await expectSurfaceInstances(preview, 'preview', [GENERATED_MATERIAL_PRIMARY_ID])
  await expect(preview.locator(`[data-easy-editor-generated-material-host="${durableCopyId}"]`)).toHaveCount(0)
  previewDraft = await readPersistedNodes(preview, [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId])
  expect(previewDraft).toMatchObject({
    projectId: forkBinding.projectId,
    branchId: forkBinding.branchId,
    nodes: onlineNodes,
  })
  expect(previewDraft.nodes[GENERATED_MATERIAL_PRIMARY_ID]?.agent?.artifactRef).toEqual(seed.artifactRef)

  const restoredSnapshot = await readMaterialGcSnapshot(page)
  expect(await readMaterialGcSnapshot(page)).toEqual(restoredSnapshot)
  expect(restoredSnapshot.snapshotDigest).toMatch(/^sha256:[\da-f]{64}$/u)
  expect(restoredSnapshot.materialRefs).toEqual([materialIdentity])
  expect(restoredSnapshot.unresolvedPromotionIds).toEqual([])
  expect(restoredSnapshot.rootFence.filter(root => root.branchId === initialBinding.branchId)).toEqual(
    stableMainSnapshot.rootFence,
  )
  expect(restoredSnapshot.rootFence.filter(root => root.branchId === forkBinding.branchId)).toEqual([
    {
      branchId: forkBinding.branchId,
      ownerType: 'working-draft',
      ownerId: forkBinding.branchId,
      artifactId: GENERATED_MATERIAL_ARTIFACT_ID,
      sourceRevision: GENERATED_MATERIAL_SOURCE_REVISION,
      materialRefs: [],
    },
  ])
  expect(restoredSnapshot.generationFence).toEqual(
    [
      { branchId: initialBinding.branchId, draftGeneration: durableMainNodes.draftGeneration },
      { branchId: forkBinding.branchId, draftGeneration: restoredDraftNodes.draftGeneration },
    ].sort((left, right) => left.branchId.localeCompare(right.branchId)),
  )
  expect(restoredSnapshot.sessionGenerationFence).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ branchId: initialBinding.branchId, sessionId: initialBinding.sessionId }),
      expect.objectContaining({ branchId: forkBinding.branchId, sessionId: forkBinding.sessionId }),
    ]),
  )

  await page.evaluate(async primaryId => {
    const runtime = await import('/src/editor/runtime.ts')
    const document = runtime.engine.project.currentDocument
    if (!document) throw new Error('G009 restored document is unavailable')
    runtime.engine.transactions.runOnDocument(
      document,
      [
        {
          type: 'updateProps' as const,
          documentId: document.id,
          nodeId: primaryId,
          props: { label: 'G009 Restored Branch Isolated' },
        },
      ],
      { expectedMutationVersion: document.mutationVersion },
    )
    await runtime.persistDashboardProject('manual-save')
    await runtime.dashboardPersistence.flush()
  }, GENERATED_MATERIAL_PRIMARY_ID)
  const mainAfterForkWrite = await readPersistedNodes(
    page,
    [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId],
    initialBinding.branchId,
  )
  expect(mainAfterForkWrite.nodes).toEqual(localNodes)
  const forkAfterWrite = await readPersistedNodes(
    page,
    [GENERATED_MATERIAL_PRIMARY_ID, durableCopyId],
    forkBinding.branchId,
  )
  expect(forkAfterWrite.nodes[GENERATED_MATERIAL_PRIMARY_ID]).toMatchObject({
    agent: { schemaVersion: 1, artifactRef: seed.artifactRef },
    props: { label: 'G009 Restored Branch Isolated' },
  })
  const afterForkWriteSnapshot = await readMaterialGcSnapshot(page)
  expect(afterForkWriteSnapshot.rootFence.filter(root => root.branchId === initialBinding.branchId)).toEqual(
    stableMainSnapshot.rootFence,
  )
  expect(afterForkWriteSnapshot.materialRefs).toEqual([materialIdentity])
  expect(afterForkWriteSnapshot.unresolvedPromotionIds).toEqual([])

  expect(editorErrors.pageErrors).toEqual([])
  expect(editorErrors.cspErrors).toEqual([])
  expect(previewErrors.pageErrors).toEqual([])
  expect(previewErrors.cspErrors).toEqual([])
  await preview.close()
})
