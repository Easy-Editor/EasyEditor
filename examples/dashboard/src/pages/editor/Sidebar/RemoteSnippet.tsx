/**
 * 远程物料 Snippet 组件
 * 处理远程物料的拖拽和点击添加到画布
 */

import { materialManager } from '@/editor/remote'
import { cn } from '@/lib/utils'
import { type ComponentMeta, type Snippet as ISnippet, project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'

interface RemoteSnippetProps {
  snippet: ISnippet
  componentMeta: ComponentMeta
}

/**
 * 远程物料 Snippet 组件
 */
export const RemoteSnippet = observer(({ snippet, componentMeta }: RemoteSnippetProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(false)

  const metadata = componentMeta.getMetadata()
  const isRemoteMaterial = metadata.devMode === 'proCode'

  // 使用 MobX 响应式数据来检测组件是否已加载
  // 这样当任何 snippet 加载组件后，所有使用同一 globalName 的 snippet 都会重新渲染
  const remoteComponentsMap = materialManager.remoteComponentsMap
  const hasRemoteComponent =
    isRemoteMaterial && metadata.componentName ? !!remoteComponentsMap[metadata.componentName] : false

  // 检查组件代码是否需要加载（使用响应式数据）
  const needsComponentLoading = isRemoteMaterial && !hasRemoteComponent

  // 处理拖拽完成：在画布上监听 drop 事件
  useEffect(() => {
    if (!isRemoteMaterial || !metadata.npm?.globalName) {
      return
    }

    const simulator = project.simulator
    if (!simulator) return

    const canvasElement = simulator.contentDocument?.body
    if (!canvasElement) return

    const handleCanvasDrop = async (e: DragEvent) => {
      // 检查是否是当前远程物料的拖拽
      const dragData = e.dataTransfer?.getData('text/plain')
      if (dragData !== `remote-material:${metadata.npm.globalName}`) return

      // 检查组件代码是否已加载（使用响应式数据）
      const hasComponent = !!materialManager.remoteComponentsMap[metadata.componentName]

      // 如果组件已加载，让 linkSnippet 处理（不拦截）
      if (hasComponent) {
        return
      }

      // 如果组件未加载，拦截并处理
      e.preventDefault()
      e.stopPropagation()

      setIsLoading(true)
      const toastId = toast.loading('正在加载组件代码...', {
        description: `${metadata.title || metadata.componentName} - ${metadata.npm.package}@${metadata.npm.version}`,
        position: 'top-center',
      })

      try {
        // 加载组件代码
        await materialManager.addComponent(metadata.npm!.package)

        toast.dismiss(toastId)

        // 获取 drop 坐标
        const rect = canvasElement.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const canvasPos = simulator.viewport.toLocalPoint({ clientX: x, clientY: y })

        // 获取当前文档
        const currentDocument = project.currentDocument
        if (!currentDocument) {
          throw new Error('No active document')
        }

        // 验证 snippet.schema
        if (!snippet.schema) {
          throw new Error('Snippet schema is missing')
        }

        // 从 snippet 的 schema 中读取尺寸
        const snippetRect = snippet.schema.$dashboard?.rect
        const defaultWidth = snippetRect?.width ?? 200
        const defaultHeight = snippetRect?.height ?? 100

        // 创建节点 schema（基于 snippet，使用 drop 坐标）
        const nodeSchema = {
          ...snippet.schema,
          componentName: snippet.schema.componentName || metadata.componentName,
          // 添加 npm 信息到 schema
          npm: {
            package: metadata.npm.package,
            version: metadata.npm.version || 'latest',
            globalName: metadata.npm.globalName,
            componentName: metadata.npm.componentName || metadata.componentName,
          },
          // 覆盖位置信息（使用 drop 坐标）
          $dashboard: {
            ...snippet.schema.$dashboard,
            rect: {
              ...snippetRect,
              x: canvasPos.clientX,
              y: canvasPos.clientY,
              width: defaultWidth,
              height: defaultHeight,
            },
          },
        }

        // 添加到画布（添加到 Root 节点）
        const rootNode = currentDocument.root
        if (rootNode) {
          const newNode = currentDocument.insertNode(rootNode, nodeSchema, 0, true)
          console.log(`[RemoteSnippet] ✅ Remote material node added:`, newNode?.id)

          // 选中新添加的节点
          if (newNode) {
            newNode.select()
          }

          toast.success('远程物料已添加', {
            description: `${metadata.title || metadata.componentName} 已成功添加到画布`,
            position: 'top-center',
          })
        } else {
          throw new Error('Root node not found')
        }

        setIsLoading(false)
      } catch (error) {
        toast.dismiss(toastId)
        toast.error('组件加载失败', {
          description: error instanceof Error ? error.message : String(error),
          position: 'top-center',
        })
        setIsLoading(false)
      }
    }

    canvasElement.addEventListener('drop', handleCanvasDrop)
    canvasElement.addEventListener('dragover', e => e.preventDefault()) // 允许 drop

    return () => {
      canvasElement.removeEventListener('drop', handleCanvasDrop)
      canvasElement.removeEventListener('dragover', e => e.preventDefault())
    }
  }, [snippet, componentMeta, isRemoteMaterial, metadata])

  // 处理拖拽开始：设置拖拽数据
  const handleDragStart = (e: React.DragEvent) => {
    if (isRemoteMaterial && metadata.npm?.globalName) {
      // 设置拖拽标识，用于在 drop 时识别这是远程物料
      e.dataTransfer.setData('text/plain', `remote-material:${metadata.npm.globalName}`)
      e.dataTransfer.effectAllowed = 'copy'
    }
  }

  // 处理点击添加到画布中心
  const handleClick = async () => {
    if (!isRemoteMaterial || !metadata.npm?.globalName) {
      return // 本地物料，让 linkSnippet 处理
    }

    if (isLoading) return

    // 使用响应式数据检查组件是否需要加载
    if (needsComponentLoading) {
      setIsLoading(true)
      const toastId = toast.loading('正在加载组件代码...', {
        description: `${metadata.title || metadata.componentName} - ${metadata.npm.package}@${metadata.npm.version}`,
        position: 'top-center',
      })

      try {
        // 加载组件代码
        await materialManager.addComponent(metadata.npm!.package)

        toast.dismiss(toastId)

        // 获取当前文档
        const currentDocument = project.currentDocument
        if (!currentDocument) {
          throw new Error('No active document')
        }

        // 验证 snippet.schema
        if (!snippet.schema) {
          throw new Error('Snippet schema is missing')
        }

        // 计算画布中心坐标
        const simulator = project.simulator
        const viewport = simulator?.viewport

        // 从 snippet 的 schema 中读取尺寸
        const snippetRect = snippet.schema.$dashboard?.rect
        const defaultWidth = snippetRect?.width ?? 200
        const defaultHeight = snippetRect?.height ?? 100

        let targetX = 100
        let targetY = 100

        if (viewport) {
          // 计算画布中心坐标（组件左上角位置）
          targetX = (viewport.width - defaultWidth) / 2
          targetY = (viewport.height - defaultHeight) / 2
        }

        // 创建节点 schema（基于 snippet，使用画布中心坐标）
        const nodeSchema = {
          ...snippet.schema,
          componentName: snippet.schema.componentName || metadata.componentName,
          // 添加 npm 信息到 schema
          npm: {
            package: metadata.npm.package,
            version: metadata.npm.version || 'latest',
            globalName: metadata.npm.globalName,
            componentName: metadata.npm.componentName || metadata.componentName,
          },
          // 覆盖位置信息（使用画布中心）
          $dashboard: {
            ...snippet.schema.$dashboard,
            rect: {
              ...snippetRect,
              x: targetX,
              y: targetY,
              width: defaultWidth,
              height: defaultHeight,
            },
          },
        }

        // 添加到画布（添加到 Root 节点）
        const rootNode = currentDocument.root
        if (rootNode) {
          const newNode = currentDocument.insertNode(rootNode, nodeSchema, 0, true)
          console.log(`[RemoteSnippet] ✅ Remote material node added (click):`, newNode?.id)

          // 选中新添加的节点
          if (newNode) {
            newNode.select()
          }

          toast.success('远程物料已添加', {
            description: `${metadata.title || metadata.componentName} 已成功添加到画布中心`,
            position: 'top-center',
          })
        } else {
          throw new Error('Root node not found')
        }

        setIsLoading(false)
      } catch (error) {
        toast.dismiss(toastId)
        toast.error('组件加载失败', {
          description: error instanceof Error ? error.message : String(error),
          position: 'top-center',
        })
        setIsLoading(false)
      }
    }
  }

  // 使用 linkSnippet 处理拖拽（对于本地物料或已加载的远程物料）
  useEffect(() => {
    const element = ref.current
    if (!element) return

    // 如果是远程物料且组件未加载，不使用 linkSnippet（使用自定义处理）
    if (isRemoteMaterial && needsComponentLoading) {
      return
    }

    // 使用 linkSnippet 处理拖拽
    const unlink = project.simulator?.linkSnippet(element, snippet)

    return () => {
      unlink?.()
    }
  }, [snippet, isRemoteMaterial, needsComponentLoading])

  return (
    <Card
      ref={ref}
      className={cn(
        'cursor-move select-none aspect-square hover:scale-105 transition-all duration-300',
        isLoading && 'opacity-50 cursor-wait',
      )}
      onClick={handleClick}
      onDragStart={handleDragStart}
      draggable={true}
    >
      <CardContent
        className={cn(
          snippet.screenshot ? 'justify-between' : 'justify-center',
          'flex flex-col items-center w-full h-full p-4 relative',
        )}
      >
        {snippet.screenshot && <img src={snippet.screenshot} alt={snippet.title} className='object-cover' />}
        <span className='w-full text-sm font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap'>
          {snippet.title}
        </span>
        {isLoading && (
          <div className='absolute inset-0 flex items-center justify-center bg-background/50 rounded'>
            <div className='text-xs text-muted-foreground'>加载中...</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
})
