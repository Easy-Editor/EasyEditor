import { deriveCompensationRunId, parseCompensationRun } from '../../../editor/agent/compensation/index.mjs'

const EMPTY_RECOVERIES = Object.freeze([])

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

const requireNonNegativeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
  return value
}

const requireRecord = (value, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

const sameBinding = (left, right) =>
  left.projectId === right.projectId && left.branchId === right.branchId && left.sessionId === right.sessionId

const parseBinding = (value, label = 'binding') => {
  const binding = requireRecord(value, label)
  return Object.freeze({
    projectId: requireNonEmptyString(binding.projectId, `${label}.projectId`),
    branchId: requireNonEmptyString(binding.branchId, `${label}.branchId`),
    sessionId: requireNonEmptyString(binding.sessionId, `${label}.sessionId`),
  })
}

const parseRuntimeAppliedUndurableRecovery = value => {
  const recovery = requireRecord(value, 'Agent Runtime recovery')
  if (recovery.schemaVersion !== 1 || recovery.kind !== 'applied-undurable') {
    throw new TypeError('Agent Runtime recovery must be an applied-undurable v1 projection')
  }
  return Object.freeze({
    kind: 'applied-undurable',
    recoveryId: requireNonEmptyString(recovery.recoveryId, 'Agent Runtime recovery.recoveryId'),
    taskId: requireNonEmptyString(recovery.taskId, 'Agent Runtime recovery.taskId'),
    callId: requireNonEmptyString(recovery.callId, 'Agent Runtime recovery.callId'),
    message: '该调用已应用，但耐久回执尚未确认。系统只会核对精确回执，不会重新执行调用。',
    occurredAt: requireNonNegativeInteger(recovery.occurredAt, 'Agent Runtime recovery.occurredAt'),
  })
}

const compensationConflictRecoveryId = compensationRunId =>
  `compensation-conflict-v1:${encodeURIComponent(compensationRunId)}`

const compareRecoveries = (left, right) =>
  left.occurredAt - right.occurredAt ||
  (left.recoveryId < right.recoveryId ? -1 : left.recoveryId > right.recoveryId ? 1 : 0)

const projectCompensationConflict = (record, binding) => {
  const envelope = requireRecord(record, 'Dashboard compensation run record')
  if (
    envelope.schemaVersion !== 1 ||
    envelope.projectId !== binding.projectId ||
    envelope.branchId !== binding.branchId ||
    envelope.sessionId !== binding.sessionId
  ) {
    throw new TypeError('Dashboard compensation run record does not match the active binding')
  }
  const outerCallId = requireNonEmptyString(envelope.outerCallId, 'Dashboard compensation run record.outerCallId')
  requireNonEmptyString(envelope.writerCallId, 'Dashboard compensation run record.writerCallId')
  requireNonNegativeInteger(envelope.draftGeneration, 'Dashboard compensation run record.draftGeneration')
  const updatedAt = requireNonNegativeInteger(envelope.updatedAt, 'Dashboard compensation run record.updatedAt')
  const run = parseCompensationRun(envelope.run)
  const expectedRunId = deriveCompensationRunId({
    projectId: binding.projectId,
    branchId: binding.branchId,
    outerCallId,
  })
  if (
    run.outerCallId !== outerCallId ||
    run.sessionId !== binding.sessionId ||
    run.compensationRunId !== expectedRunId
  ) {
    throw new TypeError('Dashboard compensation run identity does not match its durable envelope')
  }
  if (run.status !== 'completed-with-conflicts') return null
  const conflictPaths = Object.freeze(
    [...new Set(run.conflicts.flatMap(conflict => conflict.slotKeys))].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  )
  return Object.freeze({
    kind: 'compensation-conflict',
    recoveryId: compensationConflictRecoveryId(run.compensationRunId),
    taskId: run.taskId,
    message: `补偿已终止并保留 ${run.conflicts.length} 处后续修改；这里只能刷新耐久冲突报告，不会再次执行补偿。`,
    occurredAt: updatedAt,
    conflictPaths,
  })
}

const readRecoveries = async (persistence, binding, runtime) => {
  let runtimeRecoveries = EMPTY_RECOVERIES
  if (runtime !== undefined) {
    const runtimeSnapshot = requireRecord(runtime.getSnapshot(), 'Agent Runtime snapshot')
    const runtimeBinding = parseBinding(runtimeSnapshot.binding, 'Agent Runtime snapshot.binding')
    if (!sameBinding(binding, runtimeBinding)) throw new Error('Agent Runtime recovery binding is stale')
    if (!Array.isArray(runtimeSnapshot.recoveries)) {
      throw new TypeError('Agent Runtime snapshot.recoveries must be an array')
    }
    runtimeRecoveries = runtimeSnapshot.recoveries
  }

  const [compensationRecords] = await Promise.all([
    persistence.listCompensationRuns({
      schemaVersion: 1,
      projectId: binding.projectId,
      branchId: binding.branchId,
      sessionId: binding.sessionId,
    }),
  ])
  const appliedUndurable = runtimeRecoveries.map(parseRuntimeAppliedUndurableRecovery)
  const compensationConflicts = compensationRecords
    .map(record => projectCompensationConflict(record, binding))
    .filter(recovery => recovery !== null)
  const recoveries = [...appliedUndurable, ...compensationConflicts].sort(compareRecoveries)
  return recoveries.length === 0 ? EMPTY_RECOVERIES : Object.freeze(recoveries)
}

export class AgentWorkspaceManualReconciliationRequiredError extends Error {
  constructor({ recoveryId, taskId, callId, classification, reason }) {
    super(
      `调用 ${callId} 的耐久状态为 ${classification}，需要人工核对；系统不会重新执行该调用。${reason ? ` ${reason}` : ''}`,
    )
    this.name = 'AgentWorkspaceManualReconciliationRequiredError'
    this.code = 'agent-workspace-manual-reconciliation-required'
    this.recoveryId = recoveryId
    this.taskId = taskId
    this.callId = callId
    this.classification = classification
  }
}

export const createDashboardAgentWorkspaceProductionRecoveryBridge = ({ persistence }) => {
  const authority = requireRecord(persistence, 'production recovery persistence')
  if (typeof authority.listCompensationRuns !== 'function') {
    throw new TypeError('production recovery persistence.listCompensationRuns must be a function')
  }
  if (typeof authority.recoverDurableAgentReceipt !== 'function') {
    throw new TypeError('production recovery persistence.recoverDurableAgentReceipt must be a function')
  }

  return Object.freeze({
    async list(input) {
      const record = requireRecord(input, 'production recovery list input')
      const binding = parseBinding(record.binding)
      const runtime = record.runtime === undefined ? undefined : requireRecord(record.runtime, 'runtime')
      if (runtime !== undefined && typeof runtime.getSnapshot !== 'function') {
        throw new TypeError('runtime.getSnapshot must be a function')
      }
      return readRecoveries(authority, binding, runtime)
    },

    async retry(input) {
      const record = requireRecord(input, 'production recovery retry input')
      const binding = parseBinding(record.binding)
      const recoveryId = requireNonEmptyString(record.recoveryId, 'recoveryId')
      const runtime = record.runtime === undefined ? undefined : requireRecord(record.runtime, 'runtime')
      if (runtime !== undefined && typeof runtime.getSnapshot !== 'function') {
        throw new TypeError('runtime.getSnapshot must be a function')
      }
      const recoveries = await readRecoveries(authority, binding, runtime)
      const recovery = recoveries.find(value => value.recoveryId === recoveryId)
      if (!recovery || recovery.kind !== record.kind) throw new Error('Recovery item is stale or no longer exists')

      if (recovery.kind === 'compensation-conflict') {
        if (record.action !== 'refresh-conflict-report') {
          throw new Error('Completed compensation conflicts only support refreshing the durable report')
        }
        return
      }
      if (record.action !== 'retry-durability') {
        throw new Error('Applied-undurable recovery only supports exact receipt reconciliation')
      }
      if (runtime === undefined || typeof runtime.resume !== 'function') {
        throw new Error('Applied-undurable recovery requires the bound Agent Runtime')
      }

      const receipt = await authority.recoverDurableAgentReceipt({
        projectId: binding.projectId,
        branchId: binding.branchId,
        callId: recovery.callId,
      })
      const evidence = requireRecord(receipt, 'durable receipt recovery result')
      if (evidence.classification === 'committed' || evidence.classification === 'failed') {
        if (
          evidence.receipt?.projectId !== binding.projectId ||
          evidence.receipt?.branchId !== binding.branchId ||
          evidence.receipt?.callId !== recovery.callId ||
          evidence.receiptIntent?.projectId !== binding.projectId ||
          evidence.receiptIntent?.branchId !== binding.branchId ||
          evidence.receiptIntent?.callId !== recovery.callId
        ) {
          throw new Error('Durable receipt evidence does not match the requested recovery identity')
        }
        await runtime.resume(recovery.taskId)
        return
      }
      if (evidence.classification !== 'missing' && evidence.classification !== 'indeterminate') {
        throw new TypeError('Durable receipt recovery returned an unsupported classification')
      }
      throw new AgentWorkspaceManualReconciliationRequiredError({
        recoveryId: recovery.recoveryId,
        taskId: recovery.taskId,
        callId: recovery.callId,
        classification: evidence.classification,
        ...(evidence.classification === 'indeterminate' && typeof evidence.reason === 'string'
          ? { reason: evidence.reason }
          : {}),
      })
    },
  })
}
