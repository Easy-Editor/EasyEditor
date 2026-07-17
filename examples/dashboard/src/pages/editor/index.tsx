import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { registerDashboardEditorDisposer } from '@/editor'
import { dashboardAgentRuntimeFeatureFlags, registerDashboardAgentWorkspaceE2EProbe } from '@/editor/runtime'
import { useEffect, useState } from 'react'
import { AgentWorkspace, type DashboardAgentWorkspaceComposition } from './AgentWorkspace'
import { startDashboardAgentWorkspacePageIntegration } from './AgentWorkspace/page-integration'
import { AppHeader } from './Header'
import { Renderer } from './Renderer'
import { SettingSidebar } from './SettingRenderer'
import { AppSidebar } from './Sidebar'

const AppLayout = () => {
  const agentEnabled = dashboardAgentRuntimeFeatureFlags.runtime
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentComposition, setAgentComposition] = useState<DashboardAgentWorkspaceComposition | null>(null)

  useEffect(() => {
    setAgentComposition(null)
    if (!agentEnabled) {
      setAgentOpen(false)
      return
    }

    let mounted = true
    const integration = startDashboardAgentWorkspacePageIntegration({
      enabled: true,
      e2eEnabled: import.meta.env.VITE_E2E === '1',
      storage: window.sessionStorage,
      registerEditorDisposer: registerDashboardEditorDisposer,
      registerE2EProbe: registerDashboardAgentWorkspaceE2EProbe,
      onReady: composition => {
        if (mounted) setAgentComposition(composition)
      },
      onError: error => {
        console.error('[EasyEditor] Agent Workspace composition failed:', error)
      },
    })

    return () => {
      mounted = false
      void integration.dispose().catch(error => {
        console.error('[EasyEditor] Agent Workspace disposal failed:', error)
      })
    }
  }, [agentEnabled])

  return (
    <div className='h-full relative flex flex-col bg-background'>
      <div className='h-full border-grid flex flex-1 flex-col'>
        <AppHeader
          className='flex h-[57px]'
          agentEnabled={agentEnabled}
          agentOpen={agentOpen}
          onAgentToggle={() => setAgentOpen(open => !open)}
        />
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
            {agentOpen && agentComposition ? (
              <AgentWorkspace controller={agentComposition.controller} onClose={() => setAgentOpen(false)} />
            ) : null}
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
    </div>
  )
}

export default AppLayout
