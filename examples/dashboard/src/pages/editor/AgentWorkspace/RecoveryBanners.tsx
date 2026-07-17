import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AlertTriangle, GitCompareArrows, RefreshCw, ShieldAlert } from 'lucide-react'
import type { AgentWorkspaceControllerContract, AgentWorkspaceRecoveryProjection } from './types'

interface RecoveryBannerProps {
  readonly recovery: AgentWorkspaceRecoveryProjection
  readonly controller: AgentWorkspaceControllerContract
  readonly pendingAction?: string
}

const RecoveryBanner = ({ recovery, controller, pendingAction }: RecoveryBannerProps) => {
  const isPending = pendingAction?.includes(recovery.recoveryId) ?? false
  if (recovery.kind === 'unsaved') {
    return (
      <section className='rounded-lg border border-amber-300/70 bg-amber-50/80 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100'>
        <div className='flex items-start gap-2'>
          <AlertTriangle className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
          <div className='min-w-0 flex-1'>
            <h3 className='text-xs font-semibold'>当前版本尚未保存</h3>
            <p className='mt-1 text-xs leading-5 opacity-80'>{recovery.message}</p>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='mt-2 h-7 border-amber-400/70 bg-white/60 text-xs hover:bg-amber-100 dark:bg-transparent dark:hover:bg-amber-900/40'
              disabled={isPending}
              onClick={() => void controller.retrySave(recovery.recoveryId)}
            >
              <RefreshCw className={cn('size-3.5', isPending && 'motion-safe:animate-spin')} />
              重新保存
            </Button>
          </div>
        </div>
      </section>
    )
  }

  if (recovery.kind === 'applied-undurable') {
    return (
      <section className='rounded-lg border border-red-300/70 bg-red-50/80 p-3 text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100'>
        <div className='flex items-start gap-2'>
          <ShieldAlert className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
          <div className='min-w-0 flex-1'>
            <h3 className='text-xs font-semibold'>画布已变化，但持久化未确认</h3>
            <p className='mt-1 text-xs leading-5 opacity-80'>{recovery.message}</p>
            <p className='mt-1 font-mono text-[10px] opacity-65'>调用 {recovery.callId}</p>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='mt-2 h-7 border-red-400/70 bg-white/60 text-xs hover:bg-red-100 dark:bg-transparent dark:hover:bg-red-900/40'
              disabled={isPending}
              onClick={() => void controller.retryDurability(recovery.recoveryId)}
            >
              <RefreshCw className={cn('size-3.5', isPending && 'motion-safe:animate-spin')} />
              核对并恢复持久化
            </Button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className='rounded-lg border border-red-300/70 bg-red-50/80 p-3 text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100'>
      <div className='flex items-start gap-2'>
        <GitCompareArrows className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
        <div className='min-w-0 flex-1'>
          <h3 className='text-xs font-semibold'>任务补偿遇到人工修改</h3>
          <p className='mt-1 text-xs leading-5 opacity-80'>{recovery.message}</p>
          {recovery.conflictPaths.length > 0 ? (
            <ul className='mt-1 space-y-0.5 font-mono text-[10px] opacity-70' aria-label='冲突字段'>
              {recovery.conflictPaths.slice(0, 3).map(path => (
                <li key={path} className='truncate'>
                  {path}
                </li>
              ))}
            </ul>
          ) : null}
          <div className='mt-2 flex flex-wrap gap-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='h-7 border-red-400/70 bg-white/60 text-xs hover:bg-red-100 dark:bg-transparent dark:hover:bg-red-900/40'
              disabled={isPending}
              onClick={() => void controller.refreshCompensationConflict(recovery.recoveryId)}
            >
              刷新耐久冲突报告
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export interface AgentWorkspaceRecoveryBannersProps {
  readonly recoveries: readonly AgentWorkspaceRecoveryProjection[]
  readonly controller: AgentWorkspaceControllerContract
  readonly pendingAction?: string
}

export const AgentWorkspaceRecoveryBanners = ({
  recoveries,
  controller,
  pendingAction,
}: AgentWorkspaceRecoveryBannersProps) => {
  if (recoveries.length === 0) return null
  return (
    <div className='space-y-2' aria-label='需要处理的恢复事项'>
      {recoveries.map(recovery => (
        <RecoveryBanner
          key={`${recovery.kind}:${recovery.recoveryId}`}
          recovery={recovery}
          controller={controller}
          pendingAction={pendingAction}
        />
      ))}
    </div>
  )
}
