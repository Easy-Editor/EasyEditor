import type { AgentWorkspaceTaskPhase } from './types'

export const AGENT_WORKSPACE_PHASE_LABELS: Readonly<Record<AgentWorkspaceTaskPhase, string>> = {
  IDLE: '待命',
  OBSERVE: '读取大屏',
  BLUEPRINT: '生成蓝图',
  WAITING_USER: '等待确认',
  PLAN_STEP: '规划下一步',
  EXECUTE: '执行搭建',
  YIELDED: '安全让出',
  QUERY_RECEIPT: '核对回执',
  VERIFY: '验证结果',
  REPAIR: '修复偏差',
  CHECKPOINT: '保存检查点',
  PAUSED: '已暂停',
  RECOVERING: '恢复中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  FAILED: '失败',
}

export type AgentWorkspacePhaseTone = 'neutral' | 'active' | 'paused' | 'success' | 'danger'

export const getAgentWorkspacePhaseTone = (phase: AgentWorkspaceTaskPhase): AgentWorkspacePhaseTone => {
  if (phase === 'COMPLETED') return 'success'
  if (phase === 'FAILED' || phase === 'CANCELLED') return 'danger'
  if (phase === 'PAUSED' || phase === 'WAITING_USER' || phase === 'YIELDED') return 'paused'
  if (phase === 'IDLE') return 'neutral'
  return 'active'
}

export const formatAgentWorkspaceTime = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

export const shortAgentWorkspaceId = (value: string): string => {
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}
