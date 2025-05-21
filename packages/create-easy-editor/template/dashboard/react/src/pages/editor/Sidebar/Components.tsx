import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Card, CardContent } from '@/components/ui/card'
import type { MaterialGroup } from '@/editor/materials/type'
import { cn } from '@/lib/utils'
import { type ComponentMeta, type Snippet as ISnippet, project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import React, { useEffect } from 'react'

const Snippet = ({ snippet }: { snippet: ISnippet }) => {
  const ref = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unlink = project.simulator?.linkSnippet(ref.current!, snippet)
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

export const ComponentSidebar = observer(() => {
  const componentMetasMap = project.designer.materials.getComponentMetasMap()
  const componentGroupMap = new Map<MaterialGroup, ComponentMeta[]>()
  componentMetasMap.forEach(meta => {
    const metadata = meta.getMetadata()
    if (metadata.group) {
      componentGroupMap.set(metadata.group as MaterialGroup, [
        ...(componentGroupMap.get(metadata.group as MaterialGroup) || []),
        meta,
      ])
    }
  })
  const sortedComponentGroupMap = new Map([...componentGroupMap].sort((a, b) => a[0].localeCompare(b[0])))

  return (
    <div className='flex flex-col overflow-y-auto px-4'>
      <Accordion type='single' collapsible>
        {Array.from(sortedComponentGroupMap.entries())
          .filter(([group]) => group.toLowerCase() !== 'inner')
          .map(([group, components]) => (
            <AccordionItem key={group} value={group}>
              <AccordionTrigger>{group}</AccordionTrigger>
              <AccordionContent className='transition-all data-[state=closed]:animate-[accordion-up_300ms_ease-out] data-[state=open]:animate-[accordion-down_400ms_ease-out]'>
                <div className='grid grid-cols-2 gap-2 p-2'>
                  {components.map(component =>
                    component.getMetadata().snippets?.map(snippet => <Snippet key={snippet.title} snippet={snippet} />),
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
      </Accordion>
    </div>
  )
})
