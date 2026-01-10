import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar'
import { customFieldItem } from '@/editor/setters'
import { project, setters } from '@easy-editor/core'
import { SettingRenderer } from '@easy-editor/react-renderer'
import { observer } from 'mobx-react'

export const SettingSidebar = observer(({ ...props }: React.ComponentProps<typeof Sidebar>) => {
  return (
    <Sidebar collapsible='none' className='sticky hidden lg:flex top-0 h-svh border-l' {...props}>
      <SidebarHeader className='border-b p-2'>
        <div className='flex w-full items-center justify-between'>
          <div className='text-base font-medium text-foreground'>属性配置</div>
        </div>
      </SidebarHeader>
      <SidebarContent className='p-2'>
        <SettingRenderer designer={project.designer} customFieldItem={customFieldItem} />
      </SidebarContent>
    </Sidebar>
  )
})
