import { ChevronRight, Component, Container, Folder, ListTree, X } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Snippet as ISnippet, NodeSchema } from '@easy-editor/core'
import { observer } from 'mobx-react-lite'
import { designer, project, simulator } from '../editor'

const navMain = [
  {
    key: 'outline',
    title: '大纲',
    icon: ListTree,
  },
  {
    key: 'components',
    title: '组件',
    icon: Component,
  },
]

export const DashboardSidebar = observer(({ ...props }: React.ComponentProps<typeof Sidebar>) => {
  const [activeItem, setActiveItem] = React.useState(navMain[0])
  const [isSubMenuOpen, setIsSubMenuOpen] = React.useState(false)

  return (
    <div className='flex z-40'>
      <Sidebar collapsible='none' className='!w-[calc(var(--sidebar-width-icon)_+_1px)] border-r'>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className='px-1.5 md:px-0'>
              <SidebarMenu>
                {navMain.map(item => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={{
                        children: item.title,
                        hidden: false,
                      }}
                      onClick={() => {
                        setActiveItem(item)
                        setIsSubMenuOpen(!(isSubMenuOpen && activeItem.title === item.title))
                      }}
                      isActive={activeItem.key === item.key}
                      className='px-2.5 md:px-2'
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      {isSubMenuOpen && (
        <Sidebar
          collapsible='none'
          className='
            fixed
            left-[calc(var(--sidebar-width-icon)_+_2px)]
            w-[calc(var(--sidebar-width)_-_var(--sidebar-width-icon))]
            border-r
            shadow-lg
            bg-sidebar
          '
        >
          <SidebarHeader className='gap-3.5 border-b p-2'>
            <div className='flex w-full items-center justify-between'>
              <div className='text-base font-medium text-foreground'>{activeItem.title}</div>
              <Label className='flex items-center gap-2 text-sm'>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant='ghost' size='icon' onClick={() => setIsSubMenuOpen(false)}>
                      <X className='h-4 w-4' />
                      <span className='sr-only'>关闭</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>关闭</TooltipContent>
                </Tooltip>
              </Label>
            </div>
          </SidebarHeader>
          <SidebarContent>{activeItem.key === 'components' ? <ComponentSidebar /> : <OutlineSidebar />}</SidebarContent>
        </Sidebar>
      )}
    </div>
  )
})

const Snippet = ({ snippet }: { snippet: ISnippet }) => {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (snippet?.schema) {
      const unlink = simulator.linkSnippet(ref.current!, snippet)
      return () => {
        unlink()
      }
    }
  }, [snippet])

  return (
    <div ref={ref} className='p-3 rounded-md cursor-move text-center select-none'>
      {snippet?.title}
    </div>
  )
}

const ComponentSidebar = observer(() => {
  const snippets = designer.componentMetaManager.getComponentSnippets()

  return (
    <div className='border-r flex flex-col'>
      <div className='flex-1 overflow-y-auto p-4'>
        <div className='space-y-2'>
          {snippets.map(snippet => (
            <Snippet key={snippet?.title} snippet={snippet} />
          ))}
        </div>
      </div>
    </div>
  )
})

const OutlineSidebar = observer(() => {
  const docSchema = project.currentDocument?.export()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Collapsible className='group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90'>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton>
              <ChevronRight className='transition-transform' />
              <Container />
              {docSchema?.rootNode?.title}
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {docSchema?.rootNode?.children?.map((subItem, index) => (
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
    return <SidebarMenuButton className='data-[active=true]:bg-transparent'>{item.title}</SidebarMenuButton>
  }

  return (
    <SidebarMenuItem>
      <Collapsible className='group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90'>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton>
            <ChevronRight className='transition-transform' />
            <Folder />
            {item.title}
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
