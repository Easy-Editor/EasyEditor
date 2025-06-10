import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { AIChat } from './AIChat'
import { AppHeader } from './Header'
import { Renderer } from './Renderer'
import { SettingSidebar } from './SettingRenderer'
import { AppSidebar } from './Sidebar'

import '@/editor'

const AppLayout = () => {
  return (
    <div className='h-full relative flex flex-col bg-background'>
      <div className='h-full border-grid flex flex-1 flex-col'>
        <AppHeader className='flex h-[57px]' />
        <main className='flex flex-1 flex-col'>
          <SidebarProvider
            defaultOpen={false}
            defaultFixed={false}
            style={
              {
                '--sidebar-width': '350px',
                '--header-height': '57px',
              } as React.CSSProperties
            }
          >
            <AppSidebar
              style={
                {
                  height: 'calc(100vh - 57px)',
                  top: '57px',
                } as React.CSSProperties
              }
            />
            <SidebarInset>
              <div className='flex flex-1 flex-col gap-4'>
                <Renderer />
              </div>
            </SidebarInset>
            <SettingSidebar
              style={
                {
                  height: 'calc(100vh - 57px)',
                  top: '57px',
                } as React.CSSProperties
              }
            />
          </SidebarProvider>
        </main>
        <Toaster />
      </div>
      <AIChat />
    </div>
  )
}

export default AppLayout
