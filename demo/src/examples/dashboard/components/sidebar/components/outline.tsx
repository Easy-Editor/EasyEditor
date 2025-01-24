import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { project } from '@/examples/dashboard/editor'
import type { NodeSchema } from '@easy-editor/core'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@radix-ui/react-collapsible'
import { ChevronRight, Container } from 'lucide-react'
import { observer } from 'mobx-react'
import type { Key } from 'react'

export const OutlineSidebar = observer(() => {
  const docSchema = project.currentDocument?.export()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Collapsible className='group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90'>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton>
              <ChevronRight className='transition-transform' />
              <Container />
              {docSchema?.componentName}
            </SidebarMenuButton>
          </CollapsibleTrigger>
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
  if (!item.children?.length) {
    return <SidebarMenuButton className='data-[active=true]:bg-transparent'>{item.componentName}</SidebarMenuButton>
  }

  return (
    <SidebarMenuItem>
      <Collapsible className='group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90'>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton>
            <ChevronRight className='transition-transform' />
            {item.componentName}
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children?.map((subItem, index) => (
              <OutlineTree key={index} item={subItem} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
})
