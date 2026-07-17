import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Check, CircleDashed, GitBranch, Pause, Play, RotateCcw, ShieldCheck, Square, X } from 'lucide-react'
import {
  AGENT_WORKSPACE_PHASE_LABELS,
  formatAgentWorkspaceTime,
  getAgentWorkspacePhaseTone,
  shortAgentWorkspaceId,
} from './presentation'
import { projectAgentWorkspaceCompensationControl, projectAgentWorkspaceTaskActionControl } from './task-lineage.ts'
import type { AgentWorkspaceControllerContract, AgentWorkspaceTaskPhase, AgentWorkspaceTaskProjection } from './types'

const TERMINAL_PHASES = new Set<AgentWorkspaceTaskPhase>(['COMPLETED', 'CANCELLED', 'FAILED'])

const phaseToneClass = (phase: AgentWorkspaceTaskPhase): string => {
  const tone = getAgentWorkspacePhaseTone(phase)
  if (tone === 'active')
    return 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200'
  if (tone === 'paused') return 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200'
  if (tone === 'success')
    return 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
  if (tone === 'danger') return 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-200'
  return 'border-border bg-muted text-muted-foreground'
}

const Blueprint = ({ task }: { readonly task: AgentWorkspaceTaskProjection }) => {
  if (!task.blueprint) return null
  return (
    <div className='mt-3 rounded-md border border-indigo-200/70 bg-indigo-50/50 p-2.5 dark:border-indigo-900 dark:bg-indigo-950/20'>
      <div className='flex items-center gap-1.5 text-[11px] font-semibold text-indigo-800 dark:text-indigo-200'>
        <GitBranch className='size-3.5' aria-hidden='true' />
        {task.blueprint.title ?? '搭建蓝图'}
      </div>
      <p className='mt-1.5 text-xs leading-5 text-foreground/75'>{task.blueprint.summary}</p>
      {task.blueprint.steps.length > 0 ? (
        <ol className='mt-2 space-y-1.5'>
          {task.blueprint.steps.map(step => (
            <li key={step.stepId} className='flex items-start gap-2 text-[11px] leading-4 text-foreground/70'>
              {step.status === 'verified' ? (
                <Check className='mt-0.5 size-3 shrink-0 text-emerald-600' aria-hidden='true' />
              ) : step.status === 'failed' || step.status === 'cancelled' ? (
                <X className='mt-0.5 size-3 shrink-0 text-red-600' aria-hidden='true' />
              ) : (
                <CircleDashed
                  className={cn('mt-0.5 size-3 shrink-0', step.status === 'active' && 'text-indigo-600')}
                  aria-hidden='true'
                />
              )}
              <span className={cn(step.status === 'active' && 'font-medium text-indigo-700 dark:text-indigo-200')}>
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

interface TaskCardProps {
  readonly task: AgentWorkspaceTaskProjection
  readonly active: boolean
  readonly last: boolean
  readonly controller: AgentWorkspaceControllerContract
  readonly pendingAction?: string
  readonly activeTaskPhase?: AgentWorkspaceTaskPhase
}

const TaskCard = ({ task, active, last, controller, pendingAction, activeTaskPhase }: TaskCardProps) => {
  const terminal = TERMINAL_PHASES.has(task.phase)
  const taskActionPending = pendingAction?.includes(task.taskId) ?? false
  const compensationControl = projectAgentWorkspaceCompensationControl(task, activeTaskPhase)
  const taskActionControl = projectAgentWorkspaceTaskActionControl(task, active)
  return (
    <li className='relative grid grid-cols-[18px_minmax(0,1fr)] gap-3 pb-4 last:pb-0'>
      {last ? null : <span className='absolute top-5 bottom-0 left-[8px] w-px bg-border' aria-hidden='true' />}
      <span
        className={cn(
          'relative z-10 mt-1 size-[18px] rounded-full border-[5px] border-background ring-1 ring-border',
          active && 'bg-indigo-500 ring-indigo-500',
          task.phase === 'COMPLETED' && 'bg-emerald-500 ring-emerald-500',
          (task.phase === 'FAILED' || task.phase === 'CANCELLED') && 'bg-red-500 ring-red-500',
          !active && !terminal && 'bg-muted-foreground/45',
        )}
        aria-hidden='true'
      />
      <article
        className={cn(
          'min-w-0 rounded-lg border bg-card p-3',
          active && 'border-indigo-300 shadow-sm dark:border-indigo-800',
        )}
      >
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0'>
            <p className='line-clamp-2 text-xs font-medium leading-5'>{task.intent}</p>
            <p className='mt-1 font-mono text-[10px] text-muted-foreground'>
              {shortAgentWorkspaceId(task.taskId)} · {formatAgentWorkspaceTime(task.updatedAt)}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
              phaseToneClass(task.phase),
            )}
          >
            {AGENT_WORKSPACE_PHASE_LABELS[task.phase]}
          </span>
        </div>

        {task.parentTaskId ? (
          <p className='mt-2 text-[10px] text-muted-foreground'>接续任务 {shortAgentWorkspaceId(task.parentTaskId)}</p>
        ) : null}
        {task.supersedesTaskId ? (
          <p className='mt-2 text-[10px] font-medium text-amber-700 dark:text-amber-300'>
            已安全替代 {shortAgentWorkspaceId(task.supersedesTaskId)} 的后续步骤
          </p>
        ) : null}

        <Blueprint task={task} />

        {task.completionSummary ? (
          <p className='mt-3 rounded-md bg-emerald-50 p-2 text-xs leading-5 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'>
            {task.completionSummary}
          </p>
        ) : null}
        {task.failure ? (
          <div className='mt-3 rounded-md bg-red-50 p-2 text-xs leading-5 text-red-900 dark:bg-red-950/30 dark:text-red-100'>
            <p className='font-semibold'>{task.failure.code}</p>
            <p>{task.failure.message}</p>
          </div>
        ) : null}

        {task.contextDigest ? (
          <div className='mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground'>
            <ShieldCheck className='size-3' aria-hidden='true' />
            <span className='font-mono'>{shortAgentWorkspaceId(task.contextDigest.sourceHash)}</span>
            {task.contextDigest.omittedTaskCount > 0 ? (
              <span>已压缩 {task.contextDigest.omittedTaskCount} 个任务</span>
            ) : null}
          </div>
        ) : null}

        {taskActionControl.pauseVisible || taskActionControl.resumeVisible || taskActionControl.cancelVisible ? (
          <div className='mt-3 flex flex-wrap gap-1.5 border-t pt-2.5'>
            {taskActionControl.resumeVisible ? (
              <Button
                type='button'
                size='sm'
                variant='outline'
                className='h-7 text-xs'
                disabled={taskActionPending}
                onClick={() => void controller.resumeCurrentTask()}
              >
                <Play className='size-3.5' />
                继续
              </Button>
            ) : null}
            {taskActionControl.pauseVisible ? (
              <Button
                type='button'
                size='sm'
                variant='outline'
                className='h-7 text-xs'
                disabled={taskActionPending}
                onClick={() => void controller.pauseCurrentTask()}
              >
                <Pause className='size-3.5' />
                安全暂停
              </Button>
            ) : null}
            {taskActionControl.cancelVisible ? (
              <Button
                type='button'
                size='sm'
                variant='ghost'
                className='h-7 text-xs text-muted-foreground hover:text-red-700'
                disabled={taskActionPending}
                onClick={() => void controller.cancelCurrentTask()}
              >
                <Square className='size-3.5' />
                取消后续步骤
              </Button>
            ) : null}
          </div>
        ) : null}

        {compensationControl.visible ? (
          <div className='mt-3 border-t pt-2.5'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='h-7 text-xs'
              disabled={taskActionPending || compensationControl.disabled}
              onClick={() => void controller.compensateTask(task.taskId)}
            >
              <RotateCcw className='size-3.5' />
              补偿此任务
            </Button>
            <p className='mt-1.5 text-[10px] leading-4 text-muted-foreground'>
              仅按该任务的字段回执执行补偿，不会恢复项目命名版本。
            </p>
          </div>
        ) : null}
      </article>
    </li>
  )
}

export interface AgentWorkspaceTaskLineageRailProps {
  readonly tasks: readonly AgentWorkspaceTaskProjection[]
  readonly activeTaskId?: string
  readonly controller: AgentWorkspaceControllerContract
  readonly pendingAction?: string
}

export const AgentWorkspaceTaskLineageRail = ({
  tasks,
  activeTaskId,
  controller,
  pendingAction,
}: AgentWorkspaceTaskLineageRailProps) => {
  if (tasks.length === 0) {
    return (
      <div className='rounded-lg border border-dashed p-5 text-center'>
        <CircleDashed className='mx-auto size-5 text-muted-foreground' aria-hidden='true' />
        <p className='mt-2 text-xs font-medium'>还没有搭建任务</p>
        <p className='mt-1 text-[11px] leading-4 text-muted-foreground'>描述目标后，任务蓝图和每次变更会出现在这里。</p>
      </div>
    )
  }

  const activeTaskPhase = tasks.find(task => task.taskId === activeTaskId)?.phase

  return (
    <ol className='mt-3' aria-label='Agent 任务谱系'>
      {tasks.map((task, index) => (
        <TaskCard
          key={task.taskId}
          task={task}
          active={task.taskId === activeTaskId}
          last={index === tasks.length - 1}
          controller={controller}
          pendingAction={pendingAction}
          activeTaskPhase={activeTaskPhase}
        />
      ))}
    </ol>
  )
}
