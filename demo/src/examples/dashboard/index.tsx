import { SidebarProvider } from '@/components/ui/sidebar'
import { DocumentSchemaRender } from '@easy-editor/react-renderer/dashboard'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { DashboardSidebar } from './components/sidebar'
import { editor, project, simulator } from './editor'
import { defaultDocumentSchema } from './editor/const'

export const Dashboard = observer(() => {
  const viewportRef = useRef<HTMLDivElement>(null)
  const docSchema = project.currentDocument?.export()

  useEffect(() => {
    if (viewportRef.current) {
      project.open(defaultDocumentSchema)

      simulator.mountViewport(viewportRef.current)
      simulator.setupEvents()
    }
  }, [])

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
            <div className='flex flex-1 flex-col p-4' ref={viewportRef}>
              {docSchema && <DocumentSchemaRender editor={editor} schema={docSchema} designMode='design' />}
            </div>
          </div>
        </SidebarProvider>
      </div>
    </div>
  )
})
