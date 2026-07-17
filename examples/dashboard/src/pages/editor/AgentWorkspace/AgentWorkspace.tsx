import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  Bot,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CornerDownLeft,
  LoaderCircle,
  MessageSquareText,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useSyncExternalStore } from 'react'
import { AgentWorkspaceActiveTargetOverlay } from './ActiveTargetOverlay'
import { AgentWorkspaceRecoveryBanners } from './RecoveryBanners'
import { AgentWorkspaceTaskLineageRail } from './TaskLineageRail'
import { AgentWorkspaceGrantPanel, AgentWorkspaceVersionPanel } from './VersionGrantPanels'
import type { AgentWorkspaceControllerContract, AgentWorkspaceIntentMode } from './types'

const INTENT_MODE_COPY: Readonly<Record<AgentWorkspaceIntentMode, { label: string; hint: string }>> = {
  initial: { label: '开始搭建', hint: '描述你希望大屏呈现的内容、数据和交互。' },
  'follow-up': { label: '继续搭建', hint: '这是一个接续任务，上一任务的结果会保留。' },
  refinement: { label: '调整当前任务', hint: 'Agent 会在安全边界停止后续步骤，再按新要求重新观察。' },
}

const submitOnModifierEnter = (event: KeyboardEvent<HTMLTextAreaElement>, submit: () => void) => {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
  event.preventDefault()
  submit()
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
        <h2 className='text-xs font-semibold'>
          {state === 'disabled' ? 'Agent Workspace 已关闭' : 'Agent Runtime 暂不可用'}
        </h2>
        <p className='mt-1 text-xs leading-5 opacity-80'>{reason}</p>
        {detail ? <p className='mt-1 font-mono text-[10px] opacity-65'>{detail}</p> : null}
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
  const intentCopy = INTENT_MODE_COPY[state.intentMode]
  const submitting = state.pendingAction?.startsWith('submit:') ?? false
  const responding = state.pendingAction?.startsWith('respond:') ?? false

  const submitIntent = (event?: FormEvent) => {
    event?.preventDefault()
    void controller.submitIntent()
  }

  const submitResponse = (event?: FormEvent) => {
    event?.preventDefault()
    void controller.respondToQuestion()
  }

  return (
    <>
      <aside
        id='dashboard-agent-workspace'
        data-testid='agent-workspace'
        className={cn(
          'flex h-full w-[390px] min-w-[340px] max-w-[min(440px,100vw)] flex-col border-l bg-background',
          className,
        )}
        aria-label='Agent Workspace'
      >
        <header className='border-b px-4 py-3'>
          <div className='flex items-start gap-3'>
            <div className='relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200'>
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
                <h1 className='text-sm font-semibold tracking-tight'>Agent Workspace</h1>
                {state.pendingAction ? (
                  <LoaderCircle
                    className='size-3.5 text-indigo-600 motion-safe:animate-spin'
                    aria-label='正在执行操作'
                  />
                ) : null}
              </div>
              <p className='mt-0.5 truncate font-mono text-[10px] text-muted-foreground'>
                {remote.branchId}
                {remote.sessionId ? ` / ${remote.sessionId}` : ' / 尚未建立会话'}
              </p>
            </div>
            {onClose ? (
              <Button type='button' variant='ghost' size='icon' className='size-8' onClick={onClose}>
                <X className='size-4' />
                <span className='sr-only'>关闭 Agent Workspace</span>
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

            <form onSubmit={submitIntent} aria-labelledby='agent-intent-title'>
              <div className='flex items-center justify-between gap-2'>
                <div className='flex items-center gap-2'>
                  <Sparkles className='size-4 text-indigo-600' aria-hidden='true' />
                  <h2 id='agent-intent-title' className='text-xs font-semibold'>
                    {intentCopy.label}
                  </h2>
                </div>
                <span className='rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200'>
                  {state.intentMode === 'refinement'
                    ? '安全调整'
                    : state.intentMode === 'follow-up'
                      ? '接续任务'
                      : '新任务'}
                </span>
              </div>
              <p className='mt-1 text-[11px] leading-4 text-muted-foreground'>{intentCopy.hint}</p>
              <label className='sr-only' htmlFor='agent-workspace-intent'>
                大屏搭建目标
              </label>
              <textarea
                id='agent-workspace-intent'
                value={state.intentDraft}
                rows={4}
                maxLength={4000}
                placeholder='例如：为园区运营大屏增加设备在线率、告警趋势和今日工单概览，并保持现有视觉风格。'
                className='mt-3 min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-5 shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50'
                disabled={!ready || submitting}
                onChange={event => controller.setIntentDraft(event.currentTarget.value)}
                onKeyDown={event => submitOnModifierEnter(event, () => submitIntent())}
              />
              <div className='mt-2 flex items-center justify-between gap-2'>
                <span className='text-[10px] text-muted-foreground'>⌘ / Ctrl + Enter 发送</span>
                <Button
                  type='submit'
                  size='sm'
                  className='h-8 bg-indigo-600 text-xs text-white hover:bg-indigo-700'
                  disabled={!ready || submitting}
                >
                  {submitting ? (
                    <LoaderCircle className='size-3.5 motion-safe:animate-spin' />
                  ) : (
                    <Send className='size-3.5' />
                  )}
                  {intentCopy.label}
                </Button>
              </div>
            </form>

            {activeTask?.phase === 'WAITING_USER' && activeTask.question ? (
              <form
                className='rounded-lg border border-amber-300/70 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/20'
                onSubmit={submitResponse}
                aria-labelledby='agent-question-title'
              >
                <div className='flex items-center gap-2 text-amber-900 dark:text-amber-100'>
                  <MessageSquareText className='size-4' aria-hidden='true' />
                  <h2 id='agent-question-title' className='text-xs font-semibold'>
                    需要你确认
                  </h2>
                </div>
                <p className='mt-2 text-xs leading-5 text-amber-950/80 dark:text-amber-100/80'>
                  {activeTask.question.prompt}
                </p>
                <label className='sr-only' htmlFor='agent-workspace-response'>
                  回答 Agent 的问题
                </label>
                <textarea
                  id='agent-workspace-response'
                  value={state.responseDraft}
                  rows={3}
                  placeholder={activeTask.question.responseHint ?? '输入你的决定或补充信息'}
                  className='mt-2 min-h-20 w-full resize-y rounded-md border border-amber-300 bg-white/80 px-2.5 py-2 text-xs leading-5 outline-none focus-visible:ring-3 focus-visible:ring-amber-500/20 dark:border-amber-800 dark:bg-background/60'
                  disabled={responding}
                  onChange={event => controller.setResponseDraft(event.currentTarget.value)}
                  onKeyDown={event => submitOnModifierEnter(event, () => submitResponse())}
                />
                <div className='mt-2 flex justify-end'>
                  <Button
                    type='submit'
                    size='sm'
                    variant='outline'
                    className='h-7 border-amber-400/70 bg-white/60 text-xs'
                    disabled={responding}
                  >
                    <CornerDownLeft className='size-3.5' />
                    提交回答
                  </Button>
                </div>
              </form>
            ) : null}

            <Separator />

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
                <div className='flex items-center justify-between gap-2'>
                  <div>
                    <h2 className='text-xs font-semibold'>任务谱系</h2>
                    <p className='mt-1 text-[11px] text-muted-foreground'>接续、替代和检查点按真实顺序排列。</p>
                  </div>
                  {activeTask ? (
                    <span className='flex items-center gap-1 text-[10px] font-medium text-indigo-700 dark:text-indigo-200'>
                      <ChevronRight className='size-3' />
                      当前任务
                    </span>
                  ) : remote.tasks.some(task => task.phase === 'COMPLETED') ? (
                    <span className='flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-200'>
                      <CircleCheck className='size-3' /> durable
                    </span>
                  ) : null}
                </div>
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
          </div>
        </div>

        <footer className='border-t px-4 py-2.5'>
          <div className='flex items-center justify-between gap-3 text-[10px] text-muted-foreground'>
            <span>
              {remote.activeTargets.length > 0
                ? `正在操作 ${remote.activeTargets.length} 个画布目标`
                : '当前没有画布操作'}
            </span>
            <span className='font-mono'>{remote.runtimeStatus}</span>
          </div>
        </footer>
      </aside>
      <AgentWorkspaceActiveTargetOverlay sessionId={remote.sessionId} targets={remote.activeTargets} />
    </>
  )
}
