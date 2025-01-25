import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuExtra,
  SidebarMenuExtraItem,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@/components/ui/sidebar'
import { project } from '@/examples/dashboard/editor'
import type { NodeSchema } from '@easy-editor/core'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@radix-ui/react-collapsible'
import { ChevronRight, Container, Eye, EyeOff, LockKeyhole, LockKeyholeOpen } from 'lucide-react'
import { observer } from 'mobx-react'
import type { Key } from 'react'

export const OutlineSidebar = observer(() => {
  const docSchema = project.currentDocument?.export()
  console.log('docSchema', docSchema)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Collapsible className='group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90'>
          <SidebarMenuButton>
            <CollapsibleTrigger asChild>
              <ChevronRight className='transition-transform' />
            </CollapsibleTrigger>
            <Container />
            {docSchema?.componentName}
          </SidebarMenuButton>
          <CollapsibleContent>
            <SidebarMenuSub>
              {docSchema?.children?.map((subItem: NodeSchema, index: Key | null | undefined) => (
                <OutlineTree key={index} item={subItem} />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

const OutlineTree = observer(({ item }: { item: NodeSchema }) => {
  const node = project.currentDocument?.getNode(item.id!)

  const handleHide = (e: React.MouseEvent) => {
    e.stopPropagation()
    node?.hide(!node?.isHidden)
  }

  const handleLock = (e: React.MouseEvent) => {
    e.stopPropagation()
    node?.lock(!node?.isLocked)
  }

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (node?.canSelect) {
      node?.select()
    }
  }

  if (!item.children?.length) {
    return (
      <div
        onClick={handleSelect}
        className='flex w-full group items-center rounded-md p-2 text-left text-sm justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer'
        style={{
          backgroundColor: node?.select ? 'var(--sidebar-accent)' : 'transparent',
        }}
      >
        {item.componentName}
        <SidebarMenuExtra className='invisible group-hover:visible'>
          <SidebarMenuExtraItem onClick={handleHide}>{node?.hidden ? <EyeOff /> : <Eye />}</SidebarMenuExtraItem>
          <SidebarMenuExtraItem onClick={handleLock}>
            {node?.locked ? <LockKeyhole /> : <LockKeyholeOpen />}
          </SidebarMenuExtraItem>
        </SidebarMenuExtra>
      </div>
    )
  }

  return (
    <SidebarMenuItem>
      <Collapsible className='group/collapsible [&[data-state=open]>div>div>svg:first-child]:rotate-90'>
        <div
          onClick={handleSelect}
          className='flex w-full group items-center justify-between rounded-md p-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer'
        >
          <div className='flex items-center gap-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground'>
            <CollapsibleTrigger asChild>
              <ChevronRight className='transition-transform' />
            </CollapsibleTrigger>
            {item.componentName}
          </div>
          <SidebarMenuExtra className='invisible group-hover:visible'>
            <SidebarMenuExtraItem onClick={handleHide}>{node?.hidden ? <EyeOff /> : <Eye />}</SidebarMenuExtraItem>
            <SidebarMenuExtraItem onClick={handleLock}>
              {node?.locked ? <LockKeyhole /> : <LockKeyholeOpen />}
            </SidebarMenuExtraItem>
          </SidebarMenuExtra>
        </div>
        <CollapsibleContent>
          <SidebarMenuSub className='mr-0 pr-0'>
            {item.children?.map((subItem, index) => (
              <OutlineTree key={index} item={subItem} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
})
