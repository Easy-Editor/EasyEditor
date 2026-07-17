import type {
  AgentAcceptedBlueprint,
  AgentPhase,
  AgentQuestion,
  AgentRuntimeFailure,
  AgentSessionContextBudget,
  AgentSessionContextDigest,
  AgentSessionTaskExcerpt,
  AgentSessionUnresolvedConstraint,
  JsonObject,
  JsonValue,
  UserIntent,
} from '../../contracts.js'
import { assertExactFields, assertJsonValue } from '../protocol/index.js'

export interface SessionContextTaskSource {
  readonly taskId: string
  readonly sessionId: string
  readonly parentTaskId?: string
  readonly supersedesTaskId?: string
  readonly compensatesTaskId?: string
  readonly phase: AgentPhase
  readonly createdAt: number
  readonly intent: UserIntent
  readonly acceptedBlueprint?: AgentAcceptedBlueprint
  readonly completionSummary?: string
  readonly question?: AgentQuestion
  readonly failure?: AgentRuntimeFailure
}

export const DEFAULT_AGENT_SESSION_CONTEXT_BUDGET: AgentSessionContextBudget = Object.freeze({
  maxTurns: 8,
  maxTextBytes: 8_192,
  maxUnresolvedConstraints: 16,
})

const terminalResolvedPhase = 'COMPLETED' satisfies AgentPhase
const encoder = new TextEncoder()
const compareCodeUnits = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

const isSafeIntegerInRange = (value: number, minimum: number, maximum: number) =>
  Number.isSafeInteger(value) && value >= minimum && value <= maximum

export const normalizeAgentSessionContextBudget = (
  budget: AgentSessionContextBudget | undefined,
): AgentSessionContextBudget => {
  const value = budget ?? DEFAULT_AGENT_SESSION_CONTEXT_BUDGET
  if (!isSafeIntegerInRange(value.maxTurns, 1, 64)) {
    throw new TypeError('sessionContextBudget.maxTurns must be an integer between 1 and 64')
  }
  if (!isSafeIntegerInRange(value.maxTextBytes, 64, 1_048_576)) {
    throw new TypeError('sessionContextBudget.maxTextBytes must be an integer between 64 and 1048576')
  }
  if (!isSafeIntegerInRange(value.maxUnresolvedConstraints, 0, 128)) {
    throw new TypeError('sessionContextBudget.maxUnresolvedConstraints must be an integer between 0 and 128')
  }
  return Object.freeze({ ...value })
}

const canonicalize = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

const utf8Bytes = (value: string) => encoder.encode(value).byteLength

const truncateUtf8 = (value: string, maxBytes: number) => {
  if (maxBytes <= 0) return ''
  if (utf8Bytes(value) <= maxBytes) return value
  const ellipsis = '…'
  const ellipsisBytes = utf8Bytes(ellipsis)
  const contentBudget = maxBytes >= ellipsisBytes ? maxBytes - ellipsisBytes : maxBytes
  let bytes = 0
  let result = ''
  for (const character of value) {
    const characterBytes = utf8Bytes(character)
    if (bytes + characterBytes > contentBudget) break
    result += character
    bytes += characterBytes
  }
  if (maxBytes >= ellipsisBytes) return `${result}${ellipsis}`
  return result
}

const sourceOrder = (left: SessionContextTaskSource, right: SessionContextTaskSource) =>
  left.createdAt - right.createdAt || compareCodeUnits(left.taskId, right.taskId)

const sourceValue = (task: SessionContextTaskSource): JsonObject => ({
  taskId: task.taskId,
  sessionId: task.sessionId,
  ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
  ...(task.supersedesTaskId ? { supersedesTaskId: task.supersedesTaskId } : {}),
  ...(task.compensatesTaskId ? { compensatesTaskId: task.compensatesTaskId } : {}),
  phase: task.phase,
  createdAt: task.createdAt,
  intent: task.intent as unknown as JsonObject,
  ...(task.acceptedBlueprint ? { acceptedBlueprint: task.acceptedBlueprint as unknown as JsonObject } : {}),
  ...(task.completionSummary ? { completionSummary: task.completionSummary } : {}),
  ...(task.question ? { question: task.question as unknown as JsonObject } : {}),
  ...(task.failure ? { failure: task.failure as unknown as JsonObject } : {}),
})

const fnv1a32 = (value: string) => {
  let hash = 0x811c9dc5
  for (const byte of encoder.encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

const sourceHash = (tasks: readonly SessionContextTaskSource[]) =>
  fnv1a32(JSON.stringify(canonicalize(tasks.map(sourceValue))))

interface RawConstraint extends AgentSessionUnresolvedConstraint {
  readonly sourcePosition: number
  readonly constraintPosition: number
}

const unresolvedConstraints = (tasks: readonly SessionContextTaskSource[]) => {
  const constraints: RawConstraint[] = []
  tasks.forEach((task, sourcePosition) => {
    let constraintPosition = 0
    const push = (constraint: Omit<AgentSessionUnresolvedConstraint, 'taskId'>) => {
      constraints.push({ taskId: task.taskId, sourcePosition, constraintPosition, ...constraint })
      constraintPosition += 1
    }
    if (task.phase !== terminalResolvedPhase) {
      for (const summary of task.acceptedBlueprint?.unresolvedConstraints ?? []) {
        push({ kind: 'blueprint', summary })
      }
    }
    if (task.question) push({ kind: 'question', summary: task.question.prompt })
    if (task.failure) push({ kind: 'failure', summary: task.failure.message })
    if (task.phase === 'CANCELLED') push({ kind: 'cancelled', summary: task.intent.text })
  })
  return constraints
}

interface TextSlot {
  readonly key: string
  readonly value: string
}

const allocateText = (slots: readonly TextSlot[], maxTextBytes: number) => {
  const values = new Map<string, string>()
  let remainingBytes = maxTextBytes
  slots.forEach((slot, index) => {
    const remainingSlots = slots.length - index
    const allocation = Math.floor(remainingBytes / remainingSlots)
    const value = truncateUtf8(slot.value, allocation)
    values.set(slot.key, value)
    remainingBytes -= utf8Bytes(value)
  })
  return { values, textBytes: maxTextBytes - remainingBytes }
}

export const createAgentSessionContext = (
  taskSources: readonly SessionContextTaskSource[],
  budgetInput?: AgentSessionContextBudget,
): AgentSessionContextDigest => {
  const budget = normalizeAgentSessionContextBudget(budgetInput)
  const tasks = [...taskSources].sort(sourceOrder)
  const selectedTasks = tasks.slice(-budget.maxTurns)
  const allConstraints = unresolvedConstraints(tasks)
  const selectedConstraints =
    budget.maxUnresolvedConstraints === 0 ? [] : allConstraints.slice(-budget.maxUnresolvedConstraints)

  const slots: TextSlot[] = [
    ...[...selectedConstraints].reverse().map(constraint => ({
      key: `constraint:${constraint.sourcePosition}:${constraint.constraintPosition}`,
      value: constraint.summary,
    })),
    ...[...selectedTasks]
      .reverse()
      .flatMap(task => [
        { key: `task:${task.taskId}:intent`, value: task.intent.text },
        ...(task.acceptedBlueprint
          ? [{ key: `task:${task.taskId}:blueprint`, value: task.acceptedBlueprint.summary }]
          : []),
        ...(task.completionSummary ? [{ key: `task:${task.taskId}:completion`, value: task.completionSummary }] : []),
      ]),
  ]
  const allocated = allocateText(slots, budget.maxTextBytes)

  const compactConstraints = selectedConstraints.flatMap(constraint => {
    const summary = allocated.values.get(`constraint:${constraint.sourcePosition}:${constraint.constraintPosition}`)
    return summary
      ? [{ taskId: constraint.taskId, kind: constraint.kind, summary } satisfies AgentSessionUnresolvedConstraint]
      : []
  })
  const excerpts: AgentSessionTaskExcerpt[] = selectedTasks.map(task => {
    const acceptedBlueprintSummary = task.acceptedBlueprint
      ? allocated.values.get(`task:${task.taskId}:blueprint`)
      : undefined
    const completionSummary = task.completionSummary
      ? allocated.values.get(`task:${task.taskId}:completion`)
      : undefined
    return {
      taskId: task.taskId,
      phase: task.phase,
      intentExcerpt: allocated.values.get(`task:${task.taskId}:intent`) ?? '',
      ...(acceptedBlueprintSummary ? { acceptedBlueprintSummary } : {}),
      ...(completionSummary ? { completionSummary } : {}),
    }
  })

  const context: AgentSessionContextDigest = {
    schemaVersion: 1,
    budget,
    includedTaskIds: selectedTasks.map(task => task.taskId),
    sourceJournalRange: {
      startPosition: 0,
      endPosition: tasks.length - 1,
    },
    sourceHash: sourceHash(tasks),
    sourceTaskCount: tasks.length,
    omittedTaskCount: tasks.length - selectedTasks.length,
    unresolvedConstraints: compactConstraints,
    omittedUnresolvedConstraintCount: allConstraints.length - compactConstraints.length,
    excerpts,
    textBytes: allocated.textBytes,
  }
  return structuredClone(context)
}

function parseFailure(message: string): never {
  throw new TypeError(message)
}

const nonEmptyString = (value: unknown, field: string): string =>
  typeof value === 'string' && value.length > 0 ? value : parseFailure(`${field} must be a non-empty string`)

const safeNonNegativeInteger = (value: unknown, field: string): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : parseFailure(`${field} must be a non-negative safe integer`)

const parseStringArray = (value: unknown, field: string) => {
  if (!Array.isArray(value)) parseFailure(`${field} must be an array`)
  return (value as unknown[]).map((entry, index) => nonEmptyString(entry, `${field}[${index}]`))
}

const constraintKinds = new Set<AgentSessionUnresolvedConstraint['kind']>([
  'blueprint',
  'question',
  'failure',
  'cancelled',
])

export const parseAgentSessionContextDigest = (value: unknown): AgentSessionContextDigest => {
  assertJsonValue(value, 'AgentSessionContextDigest')
  assertExactFields(
    value,
    [
      'schemaVersion',
      'budget',
      'includedTaskIds',
      'sourceJournalRange',
      'sourceHash',
      'sourceTaskCount',
      'omittedTaskCount',
      'unresolvedConstraints',
      'omittedUnresolvedConstraintCount',
      'excerpts',
      'textBytes',
    ],
    [],
    'AgentSessionContextDigest',
  )
  if (value.schemaVersion !== 1) parseFailure('AgentSessionContextDigest.schemaVersion must equal 1')

  assertExactFields(
    value.budget,
    ['maxTurns', 'maxTextBytes', 'maxUnresolvedConstraints'],
    [],
    'AgentSessionContextDigest.budget',
  )
  const budget = normalizeAgentSessionContextBudget({
    maxTurns: value.budget.maxTurns as number,
    maxTextBytes: value.budget.maxTextBytes as number,
    maxUnresolvedConstraints: value.budget.maxUnresolvedConstraints as number,
  })
  const includedTaskIds = parseStringArray(value.includedTaskIds, 'AgentSessionContextDigest.includedTaskIds')
  if (new Set(includedTaskIds).size !== includedTaskIds.length) {
    parseFailure('AgentSessionContextDigest.includedTaskIds must be unique')
  }

  const sourceTaskCount = safeNonNegativeInteger(value.sourceTaskCount, 'AgentSessionContextDigest.sourceTaskCount')
  const omittedTaskCount = safeNonNegativeInteger(value.omittedTaskCount, 'AgentSessionContextDigest.omittedTaskCount')
  if (includedTaskIds.length > budget.maxTurns || sourceTaskCount - includedTaskIds.length !== omittedTaskCount) {
    parseFailure('AgentSessionContextDigest task counts do not match the budget and included ids')
  }

  assertExactFields(
    value.sourceJournalRange,
    ['startPosition', 'endPosition'],
    [],
    'AgentSessionContextDigest.sourceJournalRange',
  )
  const startPosition = safeNonNegativeInteger(
    value.sourceJournalRange.startPosition,
    'AgentSessionContextDigest.sourceJournalRange.startPosition',
  )
  const endPosition = value.sourceJournalRange.endPosition
  if (
    typeof endPosition !== 'number' ||
    !Number.isSafeInteger(endPosition) ||
    startPosition !== 0 ||
    endPosition !== sourceTaskCount - 1
  ) {
    parseFailure('AgentSessionContextDigest.sourceJournalRange must be the inclusive canonical source range')
  }
  const sourceHashValue = nonEmptyString(value.sourceHash, 'AgentSessionContextDigest.sourceHash')
  if (!/^fnv1a32:[0-9a-f]{8}$/.test(sourceHashValue)) {
    parseFailure('AgentSessionContextDigest.sourceHash must be an fnv1a32 digest')
  }

  const unresolvedConstraintValues = value.unresolvedConstraints
  if (!Array.isArray(unresolvedConstraintValues)) {
    parseFailure('AgentSessionContextDigest.unresolvedConstraints must be an array')
  }
  const constraints = (unresolvedConstraintValues as unknown[]).map((entry, index) => {
    const field = `AgentSessionContextDigest.unresolvedConstraints[${index}]`
    assertExactFields(entry, ['taskId', 'kind', 'summary'], [], field)
    const taskId = nonEmptyString(entry.taskId, `${field}.taskId`)
    const kind = entry.kind
    if (typeof kind !== 'string' || !constraintKinds.has(kind as AgentSessionUnresolvedConstraint['kind'])) {
      parseFailure(`${field}.kind is invalid`)
    }
    return {
      taskId,
      kind: kind as AgentSessionUnresolvedConstraint['kind'],
      summary: nonEmptyString(entry.summary, `${field}.summary`),
    }
  })
  if (constraints.length > budget.maxUnresolvedConstraints) {
    parseFailure('AgentSessionContextDigest unresolved constraints exceed the configured budget')
  }
  const omittedUnresolvedConstraintCount = safeNonNegativeInteger(
    value.omittedUnresolvedConstraintCount,
    'AgentSessionContextDigest.omittedUnresolvedConstraintCount',
  )

  const excerptValues = value.excerpts
  if (!Array.isArray(excerptValues)) parseFailure('AgentSessionContextDigest.excerpts must be an array')
  const excerpts = (excerptValues as unknown[]).map((entry, index) => {
    const field = `AgentSessionContextDigest.excerpts[${index}]`
    assertExactFields(
      entry,
      ['taskId', 'phase', 'intentExcerpt'],
      ['acceptedBlueprintSummary', 'completionSummary'],
      field,
    )
    const phase = entry.phase
    if (typeof phase !== 'string' || !agentSessionContextPhases.has(phase as AgentPhase)) {
      parseFailure(`${field}.phase is invalid`)
    }
    if (typeof entry.intentExcerpt !== 'string') parseFailure(`${field}.intentExcerpt must be a string`)
    if (entry.acceptedBlueprintSummary !== undefined) {
      nonEmptyString(entry.acceptedBlueprintSummary, `${field}.acceptedBlueprintSummary`)
    }
    if (entry.completionSummary !== undefined) {
      nonEmptyString(entry.completionSummary, `${field}.completionSummary`)
    }
    return {
      taskId: nonEmptyString(entry.taskId, `${field}.taskId`),
      phase: phase as AgentPhase,
      intentExcerpt: entry.intentExcerpt,
      ...(typeof entry.acceptedBlueprintSummary === 'string'
        ? { acceptedBlueprintSummary: entry.acceptedBlueprintSummary }
        : {}),
      ...(typeof entry.completionSummary === 'string' ? { completionSummary: entry.completionSummary } : {}),
    }
  })
  if (
    excerpts.length !== includedTaskIds.length ||
    excerpts.some((excerpt, index) => excerpt.taskId !== includedTaskIds[index])
  ) {
    parseFailure('AgentSessionContextDigest excerpts must align with includedTaskIds')
  }
  const textBytes = safeNonNegativeInteger(value.textBytes, 'AgentSessionContextDigest.textBytes')
  const measuredTextBytes =
    constraints.reduce((total, constraint) => total + utf8Bytes(constraint.summary), 0) +
    excerpts.reduce(
      (total, excerpt) =>
        total +
        utf8Bytes(excerpt.intentExcerpt) +
        (excerpt.acceptedBlueprintSummary ? utf8Bytes(excerpt.acceptedBlueprintSummary) : 0) +
        (excerpt.completionSummary ? utf8Bytes(excerpt.completionSummary) : 0),
      0,
    )
  if (textBytes !== measuredTextBytes || textBytes > budget.maxTextBytes) {
    parseFailure('AgentSessionContextDigest.textBytes must match its bounded textual excerpts')
  }

  return structuredClone({
    schemaVersion: 1,
    budget,
    includedTaskIds,
    sourceJournalRange: { startPosition, endPosition },
    sourceHash: sourceHashValue,
    sourceTaskCount,
    omittedTaskCount,
    unresolvedConstraints: constraints,
    omittedUnresolvedConstraintCount,
    excerpts,
    textBytes,
  })
}

const agentSessionContextPhases = new Set<AgentPhase>([
  'IDLE',
  'OBSERVE',
  'BLUEPRINT',
  'WAITING_USER',
  'PLAN_STEP',
  'EXECUTE',
  'YIELDED',
  'QUERY_RECEIPT',
  'VERIFY',
  'REPAIR',
  'CHECKPOINT',
  'PAUSED',
  'RECOVERING',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
])
