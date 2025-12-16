/**
 * 远程物料预设面板
 * 展示远程物料预设列表，点击自动添加到画布并加载
 */

import { Card, CardContent } from '@/components/ui/card'
import { remoteMaterialsPresets, type RemoteMaterialPreset } from '@/editor/loader/remote-materials-presets'
import RemoteMaterialManager from '@/editor/loader/RemoteMaterialManager'
import { cn } from '@/lib/utils'
import { project, type Snippet } from '@easy-editor/core'
import { Cloud, Loader2, PackagePlus } from 'lucide-react'
import { observer } from 'mobx-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

interface RemoteMaterialCardProps {
  preset: RemoteMaterialPreset
  onAdd: (preset: RemoteMaterialPreset, position?: { x: number; y: number }) => Promise<void>
  isLoading: boolean
}

/**
 * 远程物料卡片
 */
const RemoteMaterialCard = observer(({ preset, onAdd, isLoading }: RemoteMaterialCardProps) => {
  const cardRef = useRef<HTMLDivElement>(null)

  // 处理拖拽完成：在画布上监听 drop 事件
  useEffect(() => {
    const simulator = project.simulator
    if (!simulator) return

    const canvasElement = simulator.contentDocument?.body
    if (!canvasElement) return

    const handleCanvasDrop = async (e: DragEvent) => {
      // 检查是否是当前预设的拖拽
      const dragData = e.dataTransfer?.getData('text/plain')
      if (dragData !== `remote-material-${preset.id}`) return

      e.preventDefault()
      e.stopPropagation()

      // 获取鼠标在画布中的坐标
      const rect = canvasElement.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      console.log(`[RemoteMaterialCard] Drop at: (${x}, ${y})`)

      const canvasPos = simulator.viewport.toLocalPoint({ clientX: x, clientY: y })

      // 调用 onAdd，传入坐标
      await onAdd(preset, { x: canvasPos.clientX, y: canvasPos.clientY })
    }

    canvasElement.addEventListener('drop', handleCanvasDrop)
    canvasElement.addEventListener('dragover', e => e.preventDefault()) // 允许 drop

    return () => {
      canvasElement.removeEventListener('drop', handleCanvasDrop)
      canvasElement.removeEventListener('dragover', e => e.preventDefault())
    }
  }, [preset, onAdd])

  // 处理拖拽开始：设置拖拽数据
  const handleDragStart = (e: React.DragEvent) => {
    // 设置拖拽标识，用于在 drop 时识别
    e.dataTransfer.setData('text/plain', `remote-material-${preset.id}`)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleClick = () => {
    if (isLoading) return
    onAdd(preset)
  }

  return (
    <Card
      ref={cardRef}
      className={cn(
        'cursor-move select-none hover:scale-105 transition-all duration-300',
        isLoading && 'opacity-50 cursor-not-allowed',
      )}
      onClick={handleClick}
      onDragStart={handleDragStart}
      draggable={true}
    >
      <CardContent className='flex flex-col items-center w-full h-full p-4 gap-2'>
        {/* 图标/截图 */}
        {preset.screenshot ? (
          <img src={preset.screenshot} alt={preset.title} className='w-full h-24 object-cover rounded' />
        ) : (
          <div className='w-full h-24 flex items-center justify-center bg-muted rounded'>
            {preset.icon ? (
              <span className='text-4xl'>{preset.icon}</span>
            ) : (
              <Cloud className='h-12 w-12 text-muted-foreground' />
            )}
          </div>
        )}

        {/* 标题 */}
        <div className='w-full flex flex-col gap-1'>
          <span className='text-sm font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap'>
            {preset.title}
          </span>
          {preset.description && (
            <span className='text-xs text-muted-foreground text-center line-clamp-2'>{preset.description}</span>
          )}
        </div>

        {/* NPM 信息 */}
        <div className='w-full flex items-center justify-center gap-1 text-xs text-muted-foreground'>
          <PackagePlus className='h-3 w-3' />
          <span className='truncate'>
            {preset.npm.package}@{preset.npm.version}
          </span>
        </div>

        {/* 加载状态 */}
        {isLoading && (
          <div className='absolute inset-0 flex items-center justify-center bg-background/50 rounded'>
            <Loader2 className='h-6 w-6 animate-spin text-primary' />
          </div>
        )}
      </CardContent>
    </Card>
  )
})

/**
 * 远程物料预设面板
 */
export const RemoteMaterialsSidebar = observer(() => {
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null)

  /**
   * 添加远程物料到画布
   * @param preset 预设配置
   * @param position 可选的位置坐标（拖拽时传入），如果不传则使用画布中心
   */
  const handleAddPreset = async (preset: RemoteMaterialPreset, position?: { x: number; y: number }) => {
    if (loadingPresetId) return

    // 检查是否已经加载
    const global = window as any
    const alreadyLoaded = global.$EasyEditor?.materials?.[preset.npm.globalName]
    const needsLoading = !alreadyLoaded?.snippets

    // 只在需要加载时显示 loading toast
    const toastId = needsLoading
      ? toast.loading('正在加载远程物料...', {
          description: `${preset.title} - ${preset.npm.package}@${preset.npm.version}`,
          position: 'top-center',
        })
      : null

    try {
      setLoadingPresetId(preset.id)
      console.log(`[RemoteMaterialsSidebar] Adding preset (click): ${preset.id}`)

      // 1. 加载远程物料（按需加载）
      await loadRemoteMaterial(preset)

      // 2. 从已加载的全局变量中获取 snippet
      const global = window as any
      const loadedComponent = global.$EasyEditor?.materials?.[preset.npm.globalName]

      if (!loadedComponent?.snippets || loadedComponent.snippets.length === 0) {
        throw new Error('Failed to load snippets')
      }

      const snippets = loadedComponent.snippets
      let snippet: Snippet

      // 根据 snippetSelector 查找对应的 snippet
      if (preset.snippetSelector === undefined) {
        snippet = snippets[0]
      } else if (typeof preset.snippetSelector === 'number') {
        snippet = snippets[preset.snippetSelector] || snippets[0]
      } else {
        const found = snippets.find((s: Snippet) => s.title === preset.snippetSelector)
        snippet = found || snippets[0]
      }

      if (!snippet) {
        throw new Error('Failed to get snippet after loading')
      }

      // 3. 获取当前文档
      const currentDocument = project.currentDocument
      if (!currentDocument) {
        throw new Error('No active document')
      }

      // 4. 验证 snippet.schema
      if (!snippet.schema) {
        throw new Error('Snippet schema is missing')
      }

      // 5. 计算位置（拖拽坐标或画布中心）
      const simulator = project.simulator
      const viewport = simulator?.viewport

      // 从 snippet 的 schema 中读取尺寸
      const snippetRect = snippet.schema.$dashboard?.rect
      const defaultWidth = snippetRect?.width ?? 200
      const defaultHeight = snippetRect?.height ?? 100

      let targetX = 100
      let targetY = 100

      if (position) {
        // 使用拖拽坐标（转换为画布坐标系）
        targetX = position.x
        targetY = position.y
        console.log(`[RemoteMaterialsSidebar] Using drag position: (${targetX}, ${targetY})`)
      } else if (viewport) {
        // 计算画布中心坐标（组件左上角位置）
        targetX = (viewport.width - defaultWidth) / 2
        targetY = (viewport.height - defaultHeight) / 2
        console.log(
          `[RemoteMaterialsSidebar] Using canvas center: (${targetX}, ${targetY}), viewport: ${viewport.width}x${viewport.height}, size: ${defaultWidth}x${defaultHeight}`,
        )
      }

      // 6. 创建节点 schema（基于 snippet，但位置使用画布中心）
      const nodeSchema = {
        ...snippet.schema,
        componentName: snippet.schema.componentName || preset.npm.componentName || preset.npm.globalName,
        // 添加 npm 信息到 schema
        npm: {
          package: preset.npm.package,
          version: preset.npm.version,
          globalName: preset.npm.globalName,
          componentName: preset.npm.componentName || preset.npm.globalName,
        },
        // 覆盖位置信息（使用拖拽坐标或画布中心）
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

      // 7. 添加到画布（添加到 Root 节点）
      const rootNode = currentDocument.root
      if (rootNode) {
        const newNode = currentDocument.insertNode(rootNode, nodeSchema, 0, true)
        console.log(`[RemoteMaterialsSidebar] ✅ Node added:`, newNode?.id)

        // 8. 选中新添加的节点
        if (newNode) {
          newNode.select()
        }

        // 隐藏 loading toast（如果存在），显示成功 toast
        if (toastId) {
          toast.dismiss(toastId)
        }
        toast.success('远程物料已添加', {
          description: `${preset.title} 已成功添加到画布中心`,
          position: 'top-center',
        })
      } else {
        throw new Error('Root node not found')
      }
    } catch (error) {
      console.error(`[RemoteMaterialsSidebar] ❌ Failed to add preset:`, error)

      // 隐藏 loading toast（如果存在），显示错误 toast
      if (toastId) {
        toast.dismiss(toastId)
      }
      toast.error('添加失败', {
        description: error instanceof Error ? error.message : String(error),
        position: 'top-center',
      })
    } finally {
      setLoadingPresetId(null)
    }
  }

  /**
   * 加载远程物料
   */
  const loadRemoteMaterial = async (preset: RemoteMaterialPreset) => {
    // 检查是否已经加载
    const global = window as any
    const alreadyLoaded = global.$EasyEditor?.materials?.[preset.npm.globalName]

    if (alreadyLoaded?.snippets) {
      console.log(`[RemoteMaterialsSidebar] ${preset.npm.globalName} already loaded`)
      return alreadyLoaded.snippets
    }

    // 加载远程物料
    await RemoteMaterialManager.loadAndRegister({
      package: preset.npm.package,
      version: preset.npm.version,
      globalName: preset.npm.globalName,
      enabled: true,
    })

    // 等待元数据注册完成
    await new Promise(resolve => setTimeout(resolve, 100))

    // 从全局获取 snippets
    const loadedComponent = global.$EasyEditor?.materials?.[preset.npm.globalName]

    return loadedComponent?.snippets || []
  }

  return (
    <div className='flex flex-col overflow-y-auto px-4 py-4'>
      {/* 提示信息 */}
      <div className='mb-4 p-3 bg-muted rounded-lg text-sm text-muted-foreground'>
        <div className='flex items-start gap-2'>
          <Cloud className='h-4 w-4 mt-0.5 shrink-0' />
          <div className='space-y-1'>
            <p className='font-medium text-foreground'>远程物料</p>
            <p className='text-xs'>点击卡片自动加载远程物料并添加到画布</p>
          </div>
        </div>
      </div>

      {/* 物料列表 */}
      <div className='grid grid-cols-2 gap-3'>
        {remoteMaterialsPresets.map(preset => (
          <RemoteMaterialCard
            key={preset.id}
            preset={preset}
            onAdd={handleAddPreset}
            isLoading={loadingPresetId === preset.id}
          />
        ))}
      </div>

      {/* 空状态 */}
      {remoteMaterialsPresets.length === 0 && (
        <div className='flex flex-col items-center justify-center h-64 text-muted-foreground'>
          <PackagePlus className='h-12 w-12 mb-2' />
          <p className='text-sm'>暂无远程物料预设</p>
          <p className='text-xs mt-1'>
            请在 <code className='text-xs bg-muted px-1 py-0.5 rounded'>remote-materials-presets.ts</code> 中配置
          </p>
        </div>
      )}
    </div>
  )
})
