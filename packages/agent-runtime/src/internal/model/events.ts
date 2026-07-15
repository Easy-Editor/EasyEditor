import type { ModelAdapter, ModelEvent, ModelTurnRequest } from '../../contracts.js'

export type ModelEventValidationCode =
  | 'invalid-model-event'
  | 'unknown-model-event-kind'
  | 'unexpected-model-event-field'

export class ModelEventValidationError extends Error {
  readonly code: ModelEventValidationCode

  constructor(code: ModelEventValidationCode, message: string) {
    super(message)
    this.name = 'ModelEventValidationError'
    this.code = code
  }
}

const assertRecord: (value: unknown) => asserts value is Record<string, unknown> = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModelEventValidationError('invalid-model-event', 'model event must be an object')
  }
}

const assertExactFields = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) => {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ModelEventValidationError(
        'unexpected-model-event-field',
        `model event contains unexpected field ${key}`,
      )
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new ModelEventValidationError('invalid-model-event', `model event is missing ${key}`)
    }
  }
}

const nonEmptyString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ModelEventValidationError('invalid-model-event', `${field} must be a non-empty string`)
  }
}

export const parseModelEvent = (value: unknown): ModelEvent => {
  assertRecord(value)
  if (value.schemaVersion !== 1) {
    throw new ModelEventValidationError('invalid-model-event', 'model event schemaVersion must equal 1')
  }

  switch (value.kind) {
    case 'blueprint':
      assertExactFields(value, ['schemaVersion', 'kind', 'summary'])
      nonEmptyString(value.summary, 'blueprint.summary')
      break
    case 'question': {
      assertExactFields(value, ['schemaVersion', 'kind', 'question'])
      assertRecord(value.question)
      assertExactFields(value.question, ['questionId', 'prompt'], ['responseSchema'])
      nonEmptyString(value.question.questionId, 'question.questionId')
      nonEmptyString(value.question.prompt, 'question.prompt')
      break
    }
    case 'tool-call': {
      assertExactFields(value, ['schemaVersion', 'kind', 'call'])
      assertRecord(value.call)
      for (const field of [
        'projectId',
        'branchId',
        'sessionId',
        'taskId',
        'stepId',
        'callId',
        'capability',
        'expectedRevision',
      ]) {
        nonEmptyString(value.call[field], `tool-call.call.${field}`)
      }
      if (value.call.schemaVersion !== 1) {
        throw new ModelEventValidationError('invalid-model-event', 'tool-call schemaVersion must equal 1')
      }
      assertRecord(value.call.arguments)
      break
    }
    case 'complete':
      assertExactFields(value, ['schemaVersion', 'kind'], ['summary'])
      if (value.summary !== undefined) nonEmptyString(value.summary, 'complete.summary')
      break
    case 'pause':
      assertExactFields(value, ['schemaVersion', 'kind', 'reason'])
      nonEmptyString(value.reason, 'pause.reason')
      break
    default:
      throw new ModelEventValidationError(
        'unknown-model-event-kind',
        `unsupported model event kind ${String(value.kind)}`,
      )
  }

  return Object.freeze(value) as unknown as ModelEvent
}

export const collectModelEvents = async (
  model: ModelAdapter,
  request: ModelTurnRequest,
  signal: AbortSignal,
): Promise<readonly ModelEvent[]> => {
  const events: ModelEvent[] = []
  for await (const value of model.run(request, signal)) {
    if (signal.aborted) throw signal.reason
    events.push(parseModelEvent(value))
  }
  return Object.freeze(events)
}
