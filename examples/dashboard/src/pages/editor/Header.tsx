import BannerImg from '@/assets/banner.png'
import { Button } from '@/components/ui/button'
import { type DashboardPreviewWindowHandle, openDashboardPreviewAfterSave } from '@/editor/persistence-runtime'
import { dashboardPersistence, persistDashboardProject } from '@/editor/runtime'
import { cn } from '@/lib/utils'
import { Bot } from 'lucide-react'
import { toast } from 'sonner'

const createPreviewWindow = (): DashboardPreviewWindowHandle | null => {
  const popup = window.open('', '_blank')
  if (!popup) return null
  return {
    navigate: url => popup.location.replace(url),
    showFailure: message => {
      popup.document.title = '预览失败'
      popup.document.body.replaceChildren()
      const content = popup.document.createElement('p')
      content.textContent = message
      content.style.cssText = 'font: 14px sans-serif; padding: 24px; color: #b91c1c;'
      popup.document.body.append(content)
    },
  }
}

export interface AppHeaderProps {
  readonly className?: string
  readonly agentEnabled?: boolean
  readonly agentOpen?: boolean
  readonly onAgentToggle?: () => void
}

export const AppHeader = ({ className, agentEnabled = false, agentOpen = false, onAgentToggle }: AppHeaderProps) => {
  const save = async () => {
    try {
      const result = await persistDashboardProject('manual-save')
      await dashboardPersistence.flush()
      if (result.compatibilityWarning) {
        toast.warning('已保存，但旧版兼容快照刷新失败')
      } else {
        toast.success('保存成功')
      }
    } catch (error) {
      console.error('[EasyEditor] Dashboard manual save failed:', error)
      toast.error('保存失败，当前更改尚未保存')
    }
  }

  const preview = async () => {
    const result = await openDashboardPreviewAfterSave({
      openWindow: createPreviewWindow,
      persist: async () => {
        await persistDashboardProject('manual-save')
        await dashboardPersistence.flush()
      },
      previewUrl: '/preview',
    })
    if (result.status === 'failed') {
      console.error('[EasyEditor] Dashboard preview save failed:', result.error)
      toast.error('预览失败：当前更改尚未保存')
    }
  }

  return (
    <header
      className={cn(
        'w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className,
      )}
    >
      <div className='border-border/70 dark:border-border w-full border-dashed'>
        <div className='flex h-14 items-center px-4'>
          <div className='mr-4 hidden md:flex'>
            <div className='mr-4 flex items-center gap-2 lg:mr-6'>
              <img src={BannerImg} alt='banner' className='h-6' />
            </div>
            <nav className='flex items-center gap-4 text-sm xl:gap-6' />
          </div>
          <div className='flex flex-1 items-center justify-between gap-2 md:justify-end'>
            <div className='w-full flex-1 md:w-auto md:flex-none' />
            <div className='flex items-center gap-2'>
              {agentEnabled ? (
                <Button
                  type='button'
                  variant={agentOpen ? 'default' : 'outline'}
                  aria-pressed={agentOpen}
                  aria-controls='dashboard-agent-workspace'
                  data-testid='agent-workspace-toggle'
                  onClick={onAgentToggle}
                >
                  <Bot className='size-4' aria-hidden='true' />
                  Agent
                </Button>
              ) : null}
              <Button variant='outline' onClick={() => void preview()}>
                预览
              </Button>
              <Button variant='outline' onClick={() => void save()}>
                保存
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
