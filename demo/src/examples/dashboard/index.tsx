import { SidebarProvider } from '@/components/ui/sidebar'
import { DashboardSidebar } from './components/sidebar'

export function Dashboard() {
  return (
    <div className='flex flex-col flex-1 h-[calc(100svh_-_var(--site-header-height))]'>
      <div className='flex h-full flex-col flex-1 rounded-lg border'>
        <SidebarProvider
          style={
            {
              '--sidebar-width': '48px',
            } as React.CSSProperties
          }
        >
          <DashboardSidebar />

          <div className='flex h-full flex-col flex-1'>
            <div className='flex flex-1 flex-col p-4'>
              <div className='w-full h-full rounded-lg bg-muted/50' />
            </div>
          </div>
        </SidebarProvider>
      </div>
    </div>
  )
}
