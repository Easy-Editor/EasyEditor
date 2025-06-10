import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenu, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { SidebarMenuExtra, SidebarMenuExtraItem } from '@/components/ui/sidebar-extra'
import { cn } from '@/lib/utils'
import { type Node, type NodeSchema, project } from '@easy-editor/core'
import { ChevronRight, Eye, EyeOff, LockKeyhole, LockKeyholeOpen } from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { RendererContextMenu } from '../ContextMenu'

export const OutlineSidebar = observer(() => {
  if (!project.currentDocument?.rootNode) {
    return null
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem className='p-2'>
        <RendererContextMenu>
          <OutlineTree node={project.currentDocument?.rootNode} />
        </RendererContextMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

const OutlineTree = observer(({ node }: { node: Node<NodeSchema> }) => {
  const selected = project.designer.selection.getTopNodes(true)
  const [isShowExtra, setIsShowExtra] = useState(false)

  const handleHide = () => {
    node.hide(!node.isHidden)
  }

  const handleLock = () => {
    node.lock(!node.isLocked)
  }

  const handleSelect = () => {
    if (node.canSelect()) {
      node.select()
    }
  }

  if (!node.childrenNodes?.length) {
    return (
      <div
        onClick={handleSelect}
        onContextMenu={handleSelect}
        onMouseEnter={() => setIsShowExtra(true)}
        onMouseLeave={() => setIsShowExtra(false)}
        className={cn(
          'flex w-full items-center rounded-md p-2 text-left text-sm justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer',
          selected.includes(node) && 'bg-sidebar-accent text-sidebar-accent-foreground',
        )}
      >
        {node.componentName}
        <SidebarMenuExtra>
          <SidebarMenuExtraItem
            className={cn('invisible', (isShowExtra || node?.hidden) && 'visible')}
            onClick={handleHide}
          >
            {node?.hidden ? <EyeOff /> : <Eye />}
          </SidebarMenuExtraItem>
          <SidebarMenuExtraItem
            className={cn('invisible', (isShowExtra || node?.locked) && 'visible')}
            onClick={handleLock}
          >
            {node?.locked ? <LockKeyhole /> : <LockKeyholeOpen />}
          </SidebarMenuExtraItem>
        </SidebarMenuExtra>
      </div>
    )
  }

  return (
    <SidebarMenuItem>
      <Collapsible className='group/collapsible [&[data-state=open]>div>div>svg:first-child]:rotate-90' defaultOpen>
        <div
          onClick={handleSelect}
          onContextMenu={handleSelect}
          onMouseEnter={() => setIsShowExtra(true)}
          onMouseLeave={() => setIsShowExtra(false)}
          className={cn(
            'flex w-full items-center rounded-md p-2 text-left text-sm justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer',
            selected.includes(node) && 'bg-sidebar-accent text-sidebar-accent-foreground',
          )}
        >
          <div className='flex items-center gap-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground'>
            <CollapsibleTrigger asChild>
              <ChevronRight className='transition-transform' />
            </CollapsibleTrigger>
            {node.componentName}
          </div>
          {!node.isRoot && (
            <SidebarMenuExtra>
              <SidebarMenuExtraItem
                className={cn('invisible', (isShowExtra || node?.hidden) && 'visible')}
                onClick={handleHide}
              >
                {node?.hidden ? <EyeOff /> : <Eye />}
              </SidebarMenuExtraItem>
              <SidebarMenuExtraItem
                className={cn('invisible', (isShowExtra || node?.locked) && 'visible')}
                onClick={handleLock}
              >
                {node?.locked ? <LockKeyhole /> : <LockKeyholeOpen />}
              </SidebarMenuExtraItem>
            </SidebarMenuExtra>
          )}
        </div>
        <CollapsibleContent>
          <SidebarMenuSub className='mr-0 pr-0'>
            {node.childrenNodes?.map((childrenNode: Node<NodeSchema>) => (
              <OutlineTree key={childrenNode.id} node={childrenNode} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
})
