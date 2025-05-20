import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { ConfigureSidebar } from './Configure'
import { AppHeader } from './Header'
import { AppSidebar } from './Sidebar'

import '@/editor'

function AppLayout({ children }: { children: React.ReactNode }) {
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
              <div className='flex flex-1 flex-col gap-4'>{children}</div>
            </SidebarInset>
            <ConfigureSidebar
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
    </div>
  )
}

export default AppLayout
