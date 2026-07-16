import { defaultRootSchema } from '@/editor/const'
import { dashboardExpressionEvaluator } from '@/editor/expression-policy'
import { components } from '@/editor/materials'
import { createDashboardPersistenceRuntime, selectDashboardActiveDocumentSchema } from '@/editor/persistence-runtime'
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type ProjectSchema,
  type RootSchema,
  resolveTrustPolicy,
  validateProjectSchema,
} from '@easy-editor/core/instance'
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { useEffect, useState } from 'react'

const Preview = () => {
  const [schema, setSchema] = useState<RootSchema | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
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
        if (active) setSchema(activeSchema)
      } catch (cause) {
        console.error('[EasyEditor] Failed to load canonical Dashboard preview:', cause)
        if (active) setError('预览加载失败：无法读取已保存的大屏项目。')
      }
    }
    void load()
    return () => {
      active = false
      void persistence.dispose().catch(cause => {
        console.error('[EasyEditor] Failed to dispose Dashboard preview persistence:', cause)
      })
    }
  }, [])

  return (
    <div className='h-full w-full'>
      {error ? (
        <div className='flex h-full w-full items-center justify-center'>
          <div className='text-sm text-destructive'>{error}</div>
        </div>
      ) : schema ? (
        <Renderer
          schema={schema}
          components={components}
          expressionEvaluator={dashboardExpressionEvaluator}
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
