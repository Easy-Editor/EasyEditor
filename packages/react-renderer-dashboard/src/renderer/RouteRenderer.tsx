import type { RootSchema } from '@easy-editor/core'
import type { RendererProps } from '@easy-editor/react-renderer'
import { type Listener, type MemoryHistory, createMemoryHistory } from 'history'
import { useEffect, useRef, useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LowCodeRenderer } from '../renderer-core/renderer'

interface PageConfig {
  path: string
  title?: string
  exact?: boolean
}

export interface RouteRendererProps extends Omit<RendererProps, 'schema'> {
  /**
   * 布局组件，用于替换自带的路由
   */
  layout?: React.ComponentType<{
    history: MemoryHistory
    children: React.ReactNode
    pages: RouteRendererProps['pages']
  }>

  /**
   * 页面列表信息
   */
  pages: PageConfig[]

  /**
   * 获取路由对应的 schema
   * @param path 路由路径
   * @returns 路由对应的 schema
   */
  getSchema: (path: string) => Promise<RootSchema> | RootSchema | null | undefined

  /**
   * 路由变化时触发
   */
  onRouteChange?: Listener
}

export const RouteRenderer: React.FC<RouteRendererProps> = props => {
  const { onRouteChange } = props
  const history = useRef<MemoryHistory>(createMemoryHistory({ initialEntries: ['/'] }))

  useEffect(() => {
    if (onRouteChange) {
      const unlisten = history.current.listen(onRouteChange)
      return () => {
        unlisten()
      }
    }
  }, [onRouteChange])

  return (
    <MemoryRouter>
      <Layout history={history.current} {...props}>
        <RouteList history={history.current} {...props} />
      </Layout>
    </MemoryRouter>
  )
}

const Layout: React.FC<RouteRendererProps & { history: MemoryHistory; children: React.ReactNode }> = props => {
  const { layout, children } = props

  if (layout) {
    const Comp = layout
    return <Comp {...props} />
  }

  return <>{children}</>
}

const RouteList: React.FC<RouteRendererProps & { history: MemoryHistory }> = props => {
  const { pages, history, ...rendererProps } = props
  return (
    <Routes>
      {pages.map(page => (
        <Route
          key={page.path}
          path={page.path}
          element={<Renderer history={history} path={page.path} {...rendererProps} />}
        />
      ))}
    </Routes>
  )
}

const Renderer: React.FC<
  Omit<RendererProps, 'schema'> & {
    history: MemoryHistory
    path: string
    getSchema: RouteRendererProps['getSchema']
  }
> = props => {
  const { history, path, getSchema, ...rendererProps } = props
  const [schema, setSchema] = useState<RootSchema>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)

    const result = getSchema(path)

    if (result instanceof Promise) {
      result
        .then(schema => {
          if (mounted && schema) {
            setSchema(schema)
            setError(null)
          }
        })
        .catch(err => {
          if (mounted) {
            setError(err)
          }
        })
        .finally(() => {
          if (mounted) {
            setLoading(false)
          }
        })
    } else {
      // 处理同步返回的情况
      if (mounted) {
        if (result) {
          setSchema(result)
          setError(null)
        }
        setLoading(false)
      }
    }

    return () => {
      mounted = false
    }
  }, [path, getSchema])

  if (loading) {
    return null
  }
  if (error) {
    console.log('error', error)
    return null
  }
  if (!schema) {
    console.error('schema is not found for path: ', path)
    return null
  }

  return <LowCodeRenderer {...rendererProps} schema={schema} />
}
