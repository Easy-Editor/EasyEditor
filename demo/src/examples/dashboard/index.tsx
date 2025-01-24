import { SidebarProvider } from '@/components/ui/sidebar'
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { observer } from 'mobx-react'
import { DashboardSidebar } from './components/sidebar'
import { simulator } from './editor'

export const Dashboard = observer(() => {
  return (
    <div className='flex flex-col flex-1 h-[calc(100svh_-_var(--site-header-height))]'>
      <div className='flex h-full flex-col flex-1 rounded-lg border'>
        <SidebarProvider
          style={
            {
              '--sidebar-width': '350px',
            } as React.CSSProperties
          }
        >
          <DashboardSidebar />

          <div className='flex h-full flex-col flex-1'>
            <div className='flex flex-1 flex-col p-4'>
              <SimulatorRenderer
                host={simulator}
                bemTools={{
                  resizing: true,
                }}
              />
            </div>
          </div>
        </SidebarProvider>
      </div>
    </div>
  )
})
