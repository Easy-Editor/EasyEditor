import { resolveAgentRuntimeFeatureFlags } from '@/editor/agent/feature-flags.mjs'
import { defaultRootSchema } from '@/editor/const'
import {
  composeDashboardRootSchema,
  createDashboardDataRuntime,
  resolveDashboardSafeDataFeatureFlag,
} from '@/editor/data'
import { dashboardExpressionEvaluator } from '@/editor/expression-policy'
import { components } from '@/editor/materials'
import { createDashboardPersistenceRuntime, selectDashboardActiveDocumentSchema } from '@/editor/persistence-runtime'
import {
  DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY,
  createDashboardOnlineComponentSurfaceBridge,
  dispatchDashboardOnlineComponentRuntimeEvent,
  isDashboardOnlineComponentSurfaceEnabled,
  resolveDashboardOnlineComponentSafeBoot,
  startDashboardOnlineComponentSurface,
} from '@/runtime/online-components/surface-bridge.mjs'
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type ProjectSchema,
  type RootSchema,
  resolveTrustPolicy,
  validateProjectSchema,
} from '@easy-editor/core/instance'
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { useEffect, useMemo, useState } from 'react'

const previewAgentRuntimeFeatureFlags = resolveAgentRuntimeFeatureFlags(import.meta.env)
const previewOnlineComponentSurfaceEnabled = isDashboardOnlineComponentSurfaceEnabled(previewAgentRuntimeFeatureFlags)

interface DashboardPreviewDocument {
  readonly dataSourceEngine: ReturnType<typeof createDashboardDataRuntime>['dataSourceEngine']
  readonly project: ProjectSchema
  readonly schema: RootSchema
}

const Preview = () => {
  const [document, setDocument] = useState<DashboardPreviewDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onlineComponentSurfaceBridge = useMemo(
    () =>
      previewOnlineComponentSurfaceEnabled
        ? createDashboardOnlineComponentSurfaceBridge({
            onError: cause => console.error('[EasyEditor] Dashboard online component preview surface failed:', cause),
          })
        : null,
    [],
  )

  useEffect(() => {
    let active = true
    let projectId: string | null = null
    let onlineComponentSurface: ReturnType<typeof startDashboardOnlineComponentSurface> | null = null
    const safeDataEnabled = resolveDashboardSafeDataFeatureFlag(import.meta.env)
    const dataRuntime = createDashboardDataRuntime({
      expressionEvaluator: dashboardExpressionEvaluator,
      getProjectId: () => projectId,
      safeDataEnabled,
    })
    const persistence = createDashboardPersistenceRuntime({
      storage: window.localStorage,
      indexedDB: window.indexedDB,
      crypto: window.crypto,
      onWarning: warning => {
        console.warn(
          `[EasyEditor] Preview loaded canonical draft ${warning.draftGeneration}, but compatibility refresh failed:`,
          warning.cause,
        )
      },
    })
    const load = async () => {
      try {
        const draft = await persistence.initialize({
          componentsTree: [defaultRootSchema],
          version: CURRENT_PROJECT_SCHEMA_VERSION,
        })
        const validatedProject = validateProjectSchema(
          draft.projectSchema as unknown as ProjectSchema,
          resolveTrustPolicy('legacyTrusted'),
        )
        const activeSchema = selectDashboardActiveDocumentSchema(
          validatedProject as unknown as Parameters<typeof selectDashboardActiveDocumentSchema>[0],
          draft.activeDocument,
        ) as unknown as RootSchema
        projectId = draft.projectId
        if (!active) return
        if (previewOnlineComponentSurfaceEnabled && onlineComponentSurfaceBridge) {
          onlineComponentSurface = startDashboardOnlineComponentSurface({
            enabled: true,
            safeBoot: resolveDashboardOnlineComponentSafeBoot(window.location.search),
            mode: 'preview',
            projectId: draft.projectId,
            branchId: draft.branchId,
            surfaceId: 'dashboard-preview-online',
            bridge: onlineComponentSurfaceBridge,
            markerStore: window.localStorage,
            persistence,
            document: window.document,
            onRuntimeEvent: event => dispatchDashboardOnlineComponentRuntimeEvent(window, event),
          })
        }
        setDocument({
          dataSourceEngine: dataRuntime.dataSourceEngine,
          project: validatedProject,
          schema: composeDashboardRootSchema(validatedProject, activeSchema, { safeDataEnabled }),
        })
      } catch (cause) {
        console.error('[EasyEditor] Failed to load canonical Dashboard preview:', cause)
        if (active) setError('预览加载失败：无法读取已保存的大屏项目。')
      }
    }
    void load()
    return () => {
      active = false
      onlineComponentSurface?.dispose()
      dataRuntime.dispose()
      void persistence.dispose().catch(cause => {
        console.error('[EasyEditor] Failed to dispose Dashboard preview persistence:', cause)
      })
    }
  }, [onlineComponentSurfaceBridge])

  return (
    <div className='h-full w-full'>
      {error ? (
        <div className='flex h-full w-full items-center justify-center'>
          <div className='text-sm text-destructive'>{error}</div>
        </div>
      ) : document ? (
        <Renderer
          schema={document.schema}
          components={components}
          expressionEvaluator={dashboardExpressionEvaluator}
          appHelper={{
            dataSourceEngine: document.dataSourceEngine,
            ...(onlineComponentSurfaceBridge
              ? { [DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY]: onlineComponentSurfaceBridge }
              : {}),
          }}
          viewport={{ width: 1920, height: 1080 }}
        />
      ) : (
        <div className='flex h-full w-full items-center justify-center'>
          <div className='text-sm text-muted-foreground'>loading...</div>
        </div>
      )}
    </div>
  )
}

export default Preview
