import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { dashboardEditorSurfaceLifecycle, registerDashboardEditorDisposer } from '@/editor'
import { dashboardAgentRuntimeFeatureFlags, registerDashboardAgentWorkspaceE2EProbe } from '@/editor/runtime'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
  const editorSurfacePhase = useSyncExternalStore(
    dashboardEditorSurfaceLifecycle.subscribe,
    dashboardEditorSurfaceLifecycle.getSnapshot,
    dashboardEditorSurfaceLifecycle.getSnapshot,
  )
  const editorSurfaceParticipant = useRef<
    ReturnType<typeof dashboardEditorSurfaceLifecycle.registerParticipant> | undefined
  >(undefined)
  const editorSurfaceMounted = editorSurfacePhase === 'mounted' || editorSurfacePhase === 'resuming'

  useEffect(() => {
    const participant = dashboardEditorSurfaceLifecycle.registerParticipant()
    editorSurfaceParticipant.current = participant
    return () => {
      editorSurfaceParticipant.current = undefined
      participant.dispose()
    }
  }, [])

  useEffect(() => {
    editorSurfaceParticipant.current?.acknowledge(editorSurfacePhase)
  }, [editorSurfacePhase])

  useEffect(() => {
    setAgentComposition(null)
    if (!agentEnabled) {
      setAgentOpen(false)
      return
    }

    let mounted = true
    const integration = startDashboardAgentWorkspacePageIntegration({
      enabled: agentEnabled,
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
            {editorSurfaceMounted ? (
              <AppSidebar
                style={
                  {
                    height: 'calc(100vh - 57px)',
                    top: '57px',
                  } as React.CSSProperties
                }
              />
            ) : null}
            <SidebarInset>
              <div className='flex flex-1 flex-col gap-4'>
                {editorSurfaceMounted ? (
                  <Renderer />
                ) : (
                  <div
                    className='flex flex-1 items-center justify-center text-sm text-muted-foreground'
                    data-dashboard-editor-surface-state={editorSurfacePhase}
                  >
                    正在切换编辑分支…
                  </div>
                )}
              </div>
            </SidebarInset>
            {agentOpen && agentComposition ? (
              <AgentWorkspace controller={agentComposition.controller} onClose={() => setAgentOpen(false)} />
            ) : null}
            {editorSurfaceMounted ? (
              <SettingSidebar
                style={
                  {
                    height: 'calc(100vh - 57px)',
                    top: '57px',
                  } as React.CSSProperties
                }
              />
            ) : null}
          </SidebarProvider>
        </main>
        <Toaster />
      </div>
    </div>
  )
}

export default AppLayout
