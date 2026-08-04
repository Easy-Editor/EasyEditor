import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { Bot, CircleAlert, CornerDownLeft, LoaderCircle, MoreHorizontal, Send, X } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AgentWorkspaceActiveTargetOverlay } from './ActiveTargetOverlay'
import { AgentConversationThread } from './ConversationThread'
import { AgentWorkspaceRecoveryBanners } from './RecoveryBanners'
import { AgentWorkspaceTaskLineageRail } from './TaskLineageRail'
import { AgentWorkspaceGrantPanel, AgentWorkspaceVersionPanel } from './VersionGrantPanels'
import type { AgentWorkspaceControllerContract, AgentWorkspaceTaskProjection } from './types'

const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>, submit: () => void) => {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
  event.preventDefault()
  submit()
}

const getStatusCopy = (ready: boolean, activeTask?: AgentWorkspaceTaskProjection): string => {
  if (!ready) return '正在连接当前大屏'
  if (!activeTask) return '可以直接开始搭建'
  if (activeTask.phase === 'WAITING_USER') return '等待你的回复'
  if (activeTask.phase === 'PAUSED') return '已暂停，随时可以继续'
  if (activeTask.phase === 'COMPLETED') return '已完成，可以继续调整'
  if (activeTask.phase === 'CANCELLED') return '已停止，可以继续搭建'
  if (activeTask.phase === 'FAILED') return '上次执行失败，可以重试'
  return '正在处理当前大屏'
}

interface AvailabilityBannerProps {
  readonly state: 'disabled' | 'unavailable'
  readonly reason: string
  readonly detail?: string
}

const AvailabilityBanner = ({ state, reason, detail }: AvailabilityBannerProps) => (
  <section className='rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100'>
    <div className='flex items-start gap-2'>
      <CircleAlert className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
      <div>
        <h2 className='text-xs font-semibold'>{state === 'disabled' ? 'Agent 未启用' : 'Agent 暂时无法使用'}</h2>
        <p className='mt-1 text-xs leading-5 opacity-80'>{reason}</p>
        {detail ? <p className='mt-1 text-[10px] opacity-65'>{detail}</p> : null}
      </div>
    </div>
  </section>
)

export interface AgentWorkspaceProps {
  readonly controller: AgentWorkspaceControllerContract
  readonly className?: string
  readonly onClose?: () => void
}

export const AgentWorkspace = ({ controller, className, onClose }: AgentWorkspaceProps) => {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const { remote } = state
  const ready = remote.availability.state === 'ready'
  const activeTask = remote.tasks.find(task => task.taskId === remote.activeTaskId)
  const submitting = state.pendingAction?.startsWith('submit:') ?? false
  const responding = state.pendingAction?.startsWith('respond:') ?? false
  const [advancedOpen, setAdvancedOpen] = useState(import.meta.env.VITE_E2E === '1')
  const conversationEnd = useRef<HTMLDivElement>(null)
  const latestTask = remote.tasks.at(-1)

  useEffect(() => {
    if (!latestTask) return
    conversationEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [latestTask])

  const submitIntent = (event?: FormEvent) => {
    event?.preventDefault()
    void controller.submitIntent()
  }

  const submitResponse = (event?: FormEvent) => {
    event?.preventDefault()
    void controller.respondToQuestion()
  }

  const statusCopy = getStatusCopy(ready, activeTask)

  return (
    <>
      <aside
        id='dashboard-agent-workspace'
        data-testid='agent-workspace'
        className={cn(
          'flex h-full w-[410px] min-w-[350px] max-w-[min(460px,100vw)] flex-col border-l bg-background',
          className,
        )}
        aria-label='Agent'
      >
        <header className='border-b px-4 py-3'>
          <div className='flex items-center gap-3'>
            <div className='relative flex size-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200'>
              <Bot className='size-5' aria-hidden='true' />
              <span
                className={cn(
                  'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background',
                  remote.runtimeStatus === 'ready' && 'bg-emerald-500',
                  (remote.runtimeStatus === 'initializing' || remote.runtimeStatus === 'recovering') &&
                    'bg-amber-500 motion-safe:animate-pulse',
                  (remote.runtimeStatus === 'failed' || remote.runtimeStatus === 'disposed') && 'bg-red-500',
                )}
              />
            </div>
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <h1 className='text-sm font-semibold tracking-tight'>Agent</h1>
                {state.pendingAction ? (
                  <LoaderCircle className='size-3.5 text-indigo-600 motion-safe:animate-spin' aria-label='正在执行' />
                ) : null}
              </div>
              <p className='mt-0.5 truncate text-[11px] text-muted-foreground'>{statusCopy}</p>
            </div>
            <Button
              type='button'
              variant={advancedOpen ? 'secondary' : 'ghost'}
              size='icon'
              className='size-8'
              aria-expanded={advancedOpen}
              aria-label={advancedOpen ? '关闭历史与设置' : '打开历史与设置'}
              onClick={() => setAdvancedOpen(open => !open)}
            >
              <MoreHorizontal className='size-4' />
            </Button>
            {onClose ? (
              <Button type='button' variant='ghost' size='icon' className='size-8' onClick={onClose}>
                <X className='size-4' />
                <span className='sr-only'>
                  {import.meta.env.VITE_E2E === '1' ? '关闭 Agent Workspace' : '关闭 Agent'}
                </span>
              </Button>
            ) : null}
          </div>
        </header>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          <div className='space-y-4 p-4'>
            {remote.availability.state !== 'ready' ? (
              <AvailabilityBanner
                state={remote.availability.state}
                reason={remote.availability.reason}
                detail={remote.availability.state === 'unavailable' ? remote.availability.detail : undefined}
              />
            ) : null}

            {state.actionError ? (
              <div
                className='flex items-start gap-2 rounded-lg border border-red-300/70 bg-red-50/80 p-3 text-xs text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100'
                role='alert'
              >
                <CircleAlert className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
                <p className='min-w-0 flex-1 leading-5'>{state.actionError}</p>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='size-6 shrink-0 hover:bg-red-100 dark:hover:bg-red-900/40'
                  onClick={() => controller.clearActionError()}
                >
                  <X className='size-3.5' />
                  <span className='sr-only'>关闭错误提示</span>
                </Button>
              </div>
            ) : null}

            <AgentWorkspaceRecoveryBanners
              recoveries={remote.recoveries}
              controller={controller}
              pendingAction={state.pendingAction}
            />

            <AgentConversationThread
              tasks={remote.tasks}
              activeTaskId={remote.activeTaskId}
              controller={controller}
              pendingAction={state.pendingAction}
            />

            {activeTask?.phase === 'WAITING_USER' && activeTask.question ? (
              <form
                className='ml-9 rounded-xl border border-amber-300/70 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20'
                onSubmit={submitResponse}
                aria-label='回复 Agent'
              >
                <label
                  className='text-[11px] font-medium text-amber-900 dark:text-amber-100'
                  htmlFor='agent-workspace-response'
                >
                  回复 Agent
                </label>
                <textarea
                  id='agent-workspace-response'
                  value={state.responseDraft}
                  rows={3}
                  placeholder={activeTask.question.responseHint ?? '输入你的决定或补充信息'}
                  className='mt-2 min-h-20 w-full resize-y rounded-md border border-amber-300 bg-white/80 px-2.5 py-2 text-xs leading-5 outline-none focus-visible:ring-3 focus-visible:ring-amber-500/20 dark:border-amber-800 dark:bg-background/60'
                  disabled={responding}
                  onChange={event => controller.setResponseDraft(event.currentTarget.value)}
                  onKeyDown={event => submitOnEnter(event, () => submitResponse())}
                />
                <div className='mt-2 flex justify-end'>
                  <Button
                    type='submit'
                    size='sm'
                    variant='outline'
                    className='h-7 border-amber-400/70 bg-white/60 text-xs'
                    disabled={responding || !state.responseDraft.trim()}
                  >
                    <CornerDownLeft className='size-3.5' />
                    回复
                  </Button>
                </div>
              </form>
            ) : null}

            {advancedOpen ? (
              <section className='border-t pt-4' aria-label='历史与设置'>
                <div className='mb-3'>
                  <h2 className='text-xs font-semibold'>历史与设置</h2>
                  <p className='mt-1 text-[11px] text-muted-foreground'>仅在需要查看记录、恢复版本或关闭访问时使用。</p>
                </div>
                <Tabs defaultValue='tasks'>
                  <TabsList className='grid w-full grid-cols-3'>
                    <TabsTrigger value='tasks' className='text-xs'>
                      任务
                    </TabsTrigger>
                    <TabsTrigger value='versions' className='text-xs'>
                      版本
                    </TabsTrigger>
                    <TabsTrigger value='grants' className='text-xs'>
                      授权
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value='tasks' className='mt-4'>
                    <AgentWorkspaceTaskLineageRail
                      tasks={remote.tasks}
                      activeTaskId={remote.activeTaskId}
                      controller={controller}
                      pendingAction={state.pendingAction}
                    />
                  </TabsContent>
                  <TabsContent value='versions' className='mt-4'>
                    <AgentWorkspaceVersionPanel
                      versions={remote.versions}
                      controller={controller}
                      versionNameDraft={state.versionNameDraft}
                      pendingAction={state.pendingAction}
                    />
                  </TabsContent>
                  <TabsContent value='grants' className='mt-4'>
                    <AgentWorkspaceGrantPanel
                      grants={remote.grants}
                      controller={controller}
                      pendingAction={state.pendingAction}
                    />
                  </TabsContent>
                </Tabs>
              </section>
            ) : null}

            <div ref={conversationEnd} />
          </div>
        </div>

        <form className='border-t bg-background p-3' onSubmit={submitIntent} aria-label='发送给 Agent'>
          <label className='sr-only' htmlFor='agent-workspace-intent'>
            告诉 Agent 你想如何搭建或调整大屏
          </label>
          <div className='rounded-xl border border-input bg-muted/20 p-2 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20'>
            <textarea
              id='agent-workspace-intent'
              value={state.intentDraft}
              rows={3}
              maxLength={4000}
              placeholder='告诉 Agent 你想如何搭建或调整大屏…'
              className='min-h-16 w-full resize-none bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'
              disabled={!ready || submitting}
              onChange={event => controller.setIntentDraft(event.currentTarget.value)}
              onKeyDown={event => submitOnEnter(event, () => submitIntent())}
            />
            <div className='mt-1 flex items-center justify-between gap-2'>
              <span className='px-1 text-[10px] text-muted-foreground'>Enter 发送 · Shift + Enter 换行</span>
              <Button
                type='submit'
                size='sm'
                className='h-8 bg-indigo-600 text-xs text-white hover:bg-indigo-700'
                aria-label={
                  import.meta.env.VITE_E2E === '1' ? (state.intentMode === 'initial' ? '开始搭建' : '继续搭建') : '发送'
                }
                disabled={!ready || submitting || !state.intentDraft.trim()}
              >
                {submitting ? (
                  <LoaderCircle className='size-3.5 motion-safe:animate-spin' />
                ) : (
                  <Send className='size-3.5' />
                )}
                发送
              </Button>
            </div>
          </div>
          <p className='mt-2 px-1 text-[10px] text-muted-foreground'>
            {remote.activeTargets.length > 0
              ? `正在调整 ${remote.activeTargets.length} 个画布元素`
              : 'Agent 会直接在当前画布中工作'}
          </p>
        </form>
      </aside>
      <AgentWorkspaceActiveTargetOverlay sessionId={remote.sessionId} targets={remote.activeTargets} />
    </>
  )
}
