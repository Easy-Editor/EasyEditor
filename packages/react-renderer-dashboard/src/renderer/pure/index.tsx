import type { ComponentsMap, ProjectSchema, RootSchema } from '@easy-editor/core'
import type { RendererAppHelper, RendererProps } from '@easy-editor/renderer-core'
import { observer } from 'mobx-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Renderer from '../index'
import { type PureDashboardPageChangeHandler, navigatePureDashboardPage } from './navigation'

export interface PureDashboardRendererProps extends Omit<RendererProps, 'schema' | 'appHelper'> {
  /** 项目 Schema */
  projectSchema: ProjectSchema

  /** 初始页面路径（fileName），不传则显示第一个页面 */
  initialPage?: string

  /** 视口配置 */
  viewport?: { width?: number; height?: number }

  /** appHelper 配置（navigate 会自动注入） */
  appHelper?: Omit<RendererAppHelper, 'utils'> & {
    utils?: Omit<RendererAppHelper['utils'], 'navigate'>
  }

  /** 页面切换前的回调，可用于加载远程物料 */
  onBeforeNavigate?: (pageSchema: RootSchema, componentsMap?: ComponentsMap) => Promise<void>

  /** 页面切换完成后的通知，可用于同步主题、视口和外层页面状态 */
  onPageChange?: PureDashboardPageChangeHandler

  /** 加载中显示的内容 */
  loadingContent?: React.ReactNode

  /** 页面不存在时显示的内容 */
  notFoundContent?: React.ReactNode
}

/**
 * 纯净的大屏渲染器，用于预览态和发布态
 */
const PureDashboardRenderer: React.FC<PureDashboardRendererProps> = observer(
  ({
    projectSchema,
    initialPage,
    viewport = { width: 1920, height: 1080 },
    appHelper,
    onBeforeNavigate,
    onPageChange,
    loadingContent,
    notFoundContent,
    ...rendererProps
  }) => {
    const [schema, setSchema] = useState<RootSchema | null>(null)
    const [loading, setLoading] = useState(true)

    // 使用 ref 存储回调，避免依赖变化导致死循环
    const onBeforeNavigateRef = useRef(onBeforeNavigate)
    onBeforeNavigateRef.current = onBeforeNavigate
    const onPageChangeRef = useRef(onPageChange)
    onPageChangeRef.current = onPageChange

    const navigate = useCallback(
      async (path?: string) => {
        setLoading(true)

        if (projectSchema.componentsTree.length === 0) {
          console.warn('[PreviewRenderer] projectSchema is empty')
          setLoading(false)
          return
        }

        const pageSchema = await navigatePureDashboardPage({
          projectSchema,
          path,
          onBeforeNavigate: onBeforeNavigateRef.current,
          onPageChange: onPageChangeRef.current,
        })

        if (!pageSchema) {
          console.warn('[PreviewRenderer] pageSchema not found:', path)
          setSchema(null)
          setLoading(false)
          return
        }

        setSchema(pageSchema)
        setLoading(false)
      },
      [projectSchema],
    )

    useEffect(() => {
      navigate(initialPage)
    }, [navigate, initialPage])

    if (loading) {
      return (
        loadingContent ?? (
          <div
            style={{ display: 'flex', height: '100%', width: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <span>loading...</span>
          </div>
        )
      )
    }

    if (!schema) {
      return (
        notFoundContent ?? (
          <div
            style={{ display: 'flex', height: '100%', width: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <span>页面不存在</span>
          </div>
        )
      )
    }

    return (
      <Renderer
        {...rendererProps}
        schema={schema}
        viewport={viewport}
        appHelper={{
          ...appHelper,
          utils: {
            ...appHelper?.utils,
            navigate: (e: Event, path: string, param?: object) => {
              navigate(path)
            },
          },
        }}
      />
    )
  },
)

export default PureDashboardRenderer
