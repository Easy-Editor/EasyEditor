import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Archive, GitFork, KeyRound, LockKeyhole, ShieldCheck, ShieldOff } from 'lucide-react'
import { formatAgentWorkspaceTime, shortAgentWorkspaceId } from './presentation'
import {
  AGENT_WORKSPACE_GRANT_SCOPES,
  type AgentWorkspaceControllerContract,
  type AgentWorkspaceGrantProjection,
  type AgentWorkspaceGrantScope,
  type AgentWorkspaceVersionProjection,
} from './types'
import { agentWorkspaceVersionIdentityKey, agentWorkspaceVersionRestoreActionKey } from './version-identity.ts'

const GRANT_LABELS: Readonly<Record<AgentWorkspaceGrantScope, string>> = {
  'project.write': '修改当前项目',
  'data.read': '读取数据源',
  'online-code.author': '编写在线组件',
  'dependency.resolve': '解析组件依赖',
  'material.promote.local': '发布自定义物料',
}

interface VersionPanelProps {
  readonly versions: readonly AgentWorkspaceVersionProjection[]
  readonly controller: AgentWorkspaceControllerContract
  readonly versionNameDraft: string
  readonly pendingAction?: string
}

export const AgentWorkspaceVersionPanel = ({
  versions,
  controller,
  versionNameDraft,
  pendingAction,
}: VersionPanelProps) => {
  const creating = pendingAction === 'version:create'
  return (
    <section aria-labelledby='agent-workspace-versions-title'>
      <div className='flex items-center gap-2'>
        <Archive className='size-4 text-muted-foreground' aria-hidden='true' />
        <h2 id='agent-workspace-versions-title' className='text-xs font-semibold'>
          命名版本
        </h2>
      </div>
      <p className='mt-1 text-[11px] leading-4 text-muted-foreground'>
        保存完整恢复点。恢复会分叉出新分支和新会话，不会重写当前任务历史。
      </p>
      <form
        className='mt-3 flex gap-2'
        onSubmit={event => {
          event.preventDefault()
          void controller.createVersion()
        }}
      >
        <label className='sr-only' htmlFor='agent-workspace-version-name'>
          版本名称
        </label>
        <Input
          id='agent-workspace-version-name'
          value={versionNameDraft}
          maxLength={80}
          className='h-8 text-xs'
          placeholder='例如：客户确认版'
          disabled={creating}
          onChange={event => controller.setVersionNameDraft(event.currentTarget.value)}
        />
        <Button type='submit' size='sm' variant='outline' className='h-8 px-3 text-xs' disabled={creating}>
          保存版本
        </Button>
      </form>

      {versions.length === 0 ? (
        <p className='mt-3 rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground'>
          暂无命名版本
        </p>
      ) : (
        <ul className='mt-3 space-y-2'>
          {versions.map(version => {
            const identity = { sourceBranchId: version.sourceBranchId, versionId: version.versionId }
            const restoring = pendingAction === agentWorkspaceVersionRestoreActionKey(identity)
            return (
              <li key={agentWorkspaceVersionIdentityKey(identity)} className='rounded-md border bg-background p-2.5'>
                <div className='flex items-start justify-between gap-2'>
                  <div className='min-w-0'>
                    <p className='truncate text-xs font-medium'>{version.name}</p>
                    <p className='mt-1 text-[10px] text-muted-foreground'>
                      {formatAgentWorkspaceTime(version.createdAt)} · {shortAgentWorkspaceId(version.schemaHash)}
                    </p>
                  </div>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    className='h-7 shrink-0 text-xs'
                    disabled={restoring}
                    onClick={() => void controller.restoreVersion(identity)}
                  >
                    <GitFork className='size-3.5' />
                    恢复到新分支
                  </Button>
                </div>
                {version.sourceTaskId ? (
                  <p className='mt-1.5 font-mono text-[10px] text-muted-foreground'>
                    来源任务 {shortAgentWorkspaceId(version.sourceTaskId)}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

interface GrantPanelProps {
  readonly grants: readonly AgentWorkspaceGrantProjection[]
  readonly controller: AgentWorkspaceControllerContract
  readonly pendingAction?: string
}

const grantFor = (
  grants: readonly AgentWorkspaceGrantProjection[],
  scope: AgentWorkspaceGrantScope,
): AgentWorkspaceGrantProjection | undefined => grants.find(grant => grant.scope === scope)

export const AgentWorkspaceGrantPanel = ({ grants, controller, pendingAction }: GrantPanelProps) => {
  return (
    <section aria-labelledby='agent-workspace-grants-title'>
      <div className='flex items-center gap-2'>
        <KeyRound className='size-4 text-muted-foreground' aria-hidden='true' />
        <h2 id='agent-workspace-grants-title' className='text-xs font-semibold'>
          本地授权
        </h2>
      </div>
      <p className='mt-1 text-[11px] leading-4 text-muted-foreground'>
        同一范围授权一次后可复用；服务端和数据提供方仍会独立校验权限。
      </p>
      <ul className='mt-3 divide-y rounded-md border'>
        {AGENT_WORKSPACE_GRANT_SCOPES.map(scope => {
          const grant = grantFor(grants, scope)
          const granted = grant?.status === 'granted'
          const pending = pendingAction?.endsWith(scope) ?? false
          return (
            <li key={scope} className='flex items-center gap-2 px-2.5 py-2'>
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md',
                  granted
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {granted ? (
                  <ShieldCheck className='size-4' aria-hidden='true' />
                ) : (
                  <LockKeyhole className='size-4' aria-hidden='true' />
                )}
              </span>
              <div className='min-w-0 flex-1'>
                <p className='text-[11px] font-medium'>{GRANT_LABELS[scope]}</p>
                <p className='truncate font-mono text-[9px] text-muted-foreground'>
                  {scope} · policy {grant?.policyVersion ?? '未授权'}
                </p>
              </div>
              {granted ? (
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  className='h-7 px-2 text-[11px] text-muted-foreground hover:text-red-700'
                  disabled={pending}
                  onClick={() => void controller.revokeGrant(scope)}
                >
                  <ShieldOff className='size-3.5' />
                  撤销
                </Button>
              ) : (
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='h-7 px-2 text-[11px]'
                  disabled={pending}
                  onClick={() => void controller.requestGrant(scope)}
                >
                  授权
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <p className='mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground'>
        <ShieldOff className='mt-0.5 size-3 shrink-0' aria-hidden='true' />
        撤销会在下一次权限检查时立即生效；更换提供方或策略版本需要重新授权。
      </p>
    </section>
  )
}
