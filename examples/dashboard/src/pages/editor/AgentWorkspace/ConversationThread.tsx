import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Bot, Check, CircleAlert, CircleDashed, LoaderCircle, RotateCcw, Square, Undo2 } from 'lucide-react'
import { type AgentConversationTurn, projectAgentConversationTurns } from './conversation.ts'
import type { AgentWorkspaceControllerContract, AgentWorkspaceTaskProjection } from './types.ts'

const stateTone = (state: AgentConversationTurn['state']): string => {
  if (state === 'completed') return 'text-emerald-600 dark:text-emerald-300'
  if (state === 'error') return 'text-red-600 dark:text-red-300'
  if (state === 'waiting' || state === 'paused') return 'text-amber-600 dark:text-amber-300'
  if (state === 'stopped') return 'text-muted-foreground'
  return 'text-indigo-600 dark:text-indigo-300'
}

const fallbackText = (turn: AgentConversationTurn): string | undefined => {
  if (turn.blueprint || turn.completionText || turn.failureText || turn.question) return undefined
  if (turn.state === 'working') return '正在读取当前大屏并执行你的要求…'
  if (turn.state === 'waiting') return '需要你的回复后才能继续。'
  if (turn.state === 'paused') return '本次操作已暂停。'
  if (turn.state === 'stopped') return '已停止本次操作。'
  if (turn.state === 'completed') return '已完成本次操作。'
  return '本次操作没有完成。'
}

const AssistantResult = ({ turn }: { readonly turn: AgentConversationTurn }) => {
  const fallback = fallbackText(turn)
  return (
    <>
      {turn.blueprint ? (
        <div>
          {turn.blueprint.title ? <p className='text-xs font-medium'>{turn.blueprint.title}</p> : null}
          <p className='mt-1 text-xs leading-5 text-foreground/80'>{turn.blueprint.summary}</p>
          {turn.blueprint.steps.length > 0 ? (
            <ul className='mt-2 space-y-1.5 border-l border-indigo-200 pl-3 dark:border-indigo-900'>
              {turn.blueprint.steps.map(step => (
                <li key={step.stepId} className='flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground'>
                  {step.status === 'verified' ? (
                    <Check className='mt-0.5 size-3 shrink-0 text-emerald-600' aria-hidden='true' />
                  ) : step.status === 'active' ? (
                    <LoaderCircle
                      className='mt-0.5 size-3 shrink-0 text-indigo-600 motion-safe:animate-spin'
                      aria-hidden='true'
                    />
                  ) : (
                    <CircleDashed className='mt-0.5 size-3 shrink-0' aria-hidden='true' />
                  )}
                  <span>{step.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {turn.completionText ? (
        <p className='rounded-md bg-emerald-50 px-2.5 py-2 text-xs leading-5 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'>
          {turn.completionText}
        </p>
      ) : null}

      {turn.failureText ? (
        <p className='flex items-start gap-2 rounded-md bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-900 dark:bg-red-950/30 dark:text-red-100'>
          <CircleAlert className='mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
          {turn.failureText}
        </p>
      ) : null}

      {turn.question ? (
        <p className='rounded-md border border-amber-300/70 bg-amber-50/70 px-2.5 py-2 text-xs leading-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100'>
          {turn.question.prompt}
        </p>
      ) : null}

      {fallback ? <p className='text-xs leading-5 text-foreground/75'>{fallback}</p> : null}
    </>
  )
}

export interface AgentConversationThreadProps {
  readonly tasks: readonly AgentWorkspaceTaskProjection[]
  readonly activeTaskId?: string
  readonly controller: AgentWorkspaceControllerContract
  readonly pendingAction?: string
}

export const AgentConversationThread = ({
  tasks,
  activeTaskId,
  controller,
  pendingAction,
}: AgentConversationThreadProps) => {
  const turns = projectAgentConversationTurns(tasks, activeTaskId)

  if (turns.length === 0) {
    return (
      <div className='flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center'>
        <span className='flex size-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-200'>
          <Bot className='size-5' aria-hidden='true' />
        </span>
        <h2 className='mt-4 text-sm font-medium'>告诉我你想搭建什么</h2>
        <p className='mt-1.5 max-w-64 text-xs leading-5 text-muted-foreground'>
          我会读取当前大屏，直接完成组件、布局、数据和样式调整。
        </p>
      </div>
    )
  }

  return (
    <ol className='space-y-5' aria-label='Agent 对话'>
      {turns.map(turn => {
        const actionPending = pendingAction?.includes(turn.id) ?? false
        return (
          <li key={turn.id} data-testid={`agent-conversation-turn-${turn.id}`} className='space-y-3'>
            <div className='flex justify-end'>
              <p className='max-w-[86%] rounded-2xl rounded-br-md bg-indigo-600 px-3 py-2 text-xs leading-5 text-white shadow-sm'>
                {turn.userText}
              </p>
            </div>

            <div className='flex items-start gap-2.5'>
              <span className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background text-indigo-600 dark:text-indigo-300'>
                <Bot className='size-4' aria-hidden='true' />
              </span>
              <article className='min-w-0 flex-1 rounded-2xl rounded-tl-md border bg-card px-3 py-2.5 shadow-xs'>
                <div className='mb-2 flex items-center gap-1.5'>
                  {turn.state === 'working' ? (
                    <LoaderCircle className='size-3 motion-safe:animate-spin' aria-hidden='true' />
                  ) : null}
                  <span className={cn('text-[10px] font-medium', stateTone(turn.state))}>{turn.stateLabel}</span>
                </div>

                <div className='space-y-2'>
                  <AssistantResult turn={turn} />
                </div>

                {turn.canResume || turn.canStop || turn.canUndo ? (
                  <div className='mt-2.5 flex flex-wrap gap-1.5 border-t pt-2'>
                    {turn.canResume ? (
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        className='h-7 text-xs'
                        disabled={actionPending}
                        onClick={() => void controller.resumeCurrentTask()}
                      >
                        <RotateCcw className='size-3.5' />
                        继续
                      </Button>
                    ) : null}
                    {turn.canStop ? (
                      <Button
                        type='button'
                        size='sm'
                        variant='ghost'
                        className='h-7 text-xs text-muted-foreground hover:text-red-700'
                        disabled={actionPending}
                        onClick={() => void controller.cancelCurrentTask()}
                      >
                        <Square className='size-3.5' />
                        停止
                      </Button>
                    ) : null}
                    {turn.canUndo ? (
                      <Button
                        type='button'
                        size='sm'
                        variant='ghost'
                        className='h-7 text-xs text-muted-foreground'
                        disabled={actionPending}
                        onClick={() => void controller.compensateTask(turn.id)}
                      >
                        <Undo2 className='size-3.5' />
                        撤销这次修改
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
