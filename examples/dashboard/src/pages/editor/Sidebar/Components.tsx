import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Card, CardContent } from '@/components/ui/card'
import type { MaterialGroup } from '@/editor/materials/type'
import { cn } from '@/lib/utils'
import { type ComponentMeta, type Snippet as ISnippet, project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import React from 'react'
import { RemoteSnippet } from './RemoteSnippet'
import { LocalMaterialDebugDialog } from './LocalMaterialDebugDialog'

/** 调试分组名称 */
const DEBUG_GROUP = 'DEBUG'

interface SnippetProps {
  snippet: ISnippet
  componentMeta: ComponentMeta
}

/**
 * 本地物料 Snippet 组件
 */
const Snippet = ({ snippet }: SnippetProps) => {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return

    // 使用 linkSnippet 处理拖拽
    const unlink = project.simulator?.linkSnippet(element, snippet)

    return () => {
      unlink?.()
    }
  }, [snippet])

  return (
    <Card ref={ref} className='cursor-move select-none aspect-square hover:scale-105 transition-all duration-300'>
      <CardContent
        className={cn(
          snippet.screenshot ? 'justify-between' : 'justify-center',
          'flex flex-col items-center w-full h-full p-4',
        )}
      >
        {snippet.screenshot && <img src={snippet.screenshot} alt={snippet.title} className='object-cover' />}
        <span className='w-full text-sm font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap'>
          {snippet.title}
        </span>
      </CardContent>
    </Card>
  )
}

/**
 * 调试中物料 Snippet 组件
 * 带有特殊的视觉指示
 */
const DebugSnippet = ({ snippet, componentMeta }: SnippetProps) => {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return

    // 使用 linkSnippet 处理拖拽
    const unlink = project.simulator?.linkSnippet(element, snippet)

    return () => {
      unlink?.()
    }
  }, [snippet])

  return (
    <Card
      ref={ref}
      className='cursor-move select-none aspect-square hover:scale-105 transition-all duration-300 border-green-500 border-2 relative'
    >
      {/* 调试标记 */}
      <div className='absolute top-1 right-1 bg-green-500 text-white text-[10px] px-1 rounded'>DEV</div>
      <CardContent
        className={cn(
          snippet.screenshot ? 'justify-between' : 'justify-center',
          'flex flex-col items-center w-full h-full p-4',
        )}
      >
        {snippet.screenshot && <img src={snippet.screenshot} alt={snippet.title} className='object-cover' />}
        <span className='w-full text-sm font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap'>
          {snippet.title}
        </span>
      </CardContent>
    </Card>
  )
}

export const ComponentSidebar = observer(() => {
  const componentMetasMap = project.designer.materials.getComponentMetasMap()
  const componentGroupMap = new Map<MaterialGroup | typeof DEBUG_GROUP, ComponentMeta[]>()

  componentMetasMap.forEach(meta => {
    const metadata = meta.getMetadata()
    if (metadata.group) {
      const group = metadata.group as MaterialGroup | typeof DEBUG_GROUP
      componentGroupMap.set(group, [...(componentGroupMap.get(group) || []), meta])
    }
  })

  // 分离调试组和普通组
  const debugComponents = componentGroupMap.get(DEBUG_GROUP) || []
  componentGroupMap.delete(DEBUG_GROUP)

  // 对普通组排序
  const sortedComponentGroupMap = new Map([...componentGroupMap].sort((a, b) => a[0].localeCompare(b[0])))

  return (
    <div className='flex flex-col overflow-y-auto'>
      {/* 顶部工具栏 */}
      <div className='flex items-center justify-between px-4 py-2 border-b'>
        <span className='text-sm font-medium'>Components</span>
        <LocalMaterialDebugDialog />
      </div>

      {/* 物料列表 */}
      <div className='px-4'>
        <Accordion type='single' collapsible defaultValue={debugComponents.length > 0 ? DEBUG_GROUP : undefined}>
          {/* 调试中的物料组（如果有） */}
          {debugComponents.length > 0 && (
            <AccordionItem value={DEBUG_GROUP}>
              <AccordionTrigger className='text-green-600'>
                <span className='flex items-center gap-2'>
                  <span className='h-2 w-2 rounded-full bg-green-500 animate-pulse' />
                  Debugging ({debugComponents.length})
                </span>
              </AccordionTrigger>
              <AccordionContent className='transition-all data-[state=closed]:animate-[accordion-up_300ms_ease-out] data-[state=open]:animate-[accordion-down_400ms_ease-out]'>
                <div className='grid grid-cols-2 gap-2 p-2'>
                  {debugComponents.map(component =>
                    component
                      .getMetadata()
                      .snippets?.map(snippet => (
                        <DebugSnippet
                          key={`${component.componentName}-${snippet.title}`}
                          snippet={snippet}
                          componentMeta={component}
                        />
                      )),
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* 普通物料组 */}
          {Array.from(sortedComponentGroupMap.entries())
            .filter(([group]) => group.toLowerCase() !== 'inner')
            .map(([group, components]) => (
              <AccordionItem key={group} value={group}>
                <AccordionTrigger>{group}</AccordionTrigger>
                <AccordionContent className='transition-all data-[state=closed]:animate-[accordion-up_300ms_ease-out] data-[state=open]:animate-[accordion-down_400ms_ease-out]'>
                  <div className='grid grid-cols-2 gap-2 p-2'>
                    {components.map(component => {
                      const metadata = component.getMetadata()
                      const isRemoteMaterial = metadata.devMode === 'proCode'

                      return component
                        .getMetadata()
                        .snippets?.map(snippet =>
                          isRemoteMaterial ? (
                            <RemoteSnippet key={snippet.title} snippet={snippet} componentMeta={component} />
                          ) : (
                            <Snippet key={snippet.title} snippet={snippet} componentMeta={component} />
                          ),
                        )
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
        </Accordion>
      </div>
    </div>
  )
})
