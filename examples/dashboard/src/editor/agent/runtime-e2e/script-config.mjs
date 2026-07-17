import { AgentRuntimeE2EWorkerError, cloneAgentRuntimeE2ESteps } from './protocol.mjs'

export const AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY = 'easy-editor:agent-runtime:e2e-steps:v1'

export class AgentRuntimeE2EScriptConfigError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'AgentRuntimeE2EScriptConfigError'
    this.code = code
  }
}

export const DEFAULT_AGENT_RUNTIME_E2E_SCRIPT = cloneAgentRuntimeE2ESteps([
  {
    expectedPhase: 'BLUEPRINT',
    events: [
      {
        schemaVersion: 1,
        kind: 'blueprint',
        summary: 'Use the current Dashboard state to complete the requested E2E task.',
        unresolvedConstraints: [],
      },
    ],
  },
  {
    expectedPhase: 'PLAN_STEP',
    events: [
      {
        schemaVersion: 1,
        kind: 'complete',
        summary: 'The default Agent Runtime E2E task completed without a host mutation.',
      },
    ],
  },
])

const invalidScript = cause =>
  new AgentRuntimeE2EScriptConfigError(
    'invalid-script',
    `Agent Runtime E2E script stored at ${AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY} is invalid: ${cause.message}`,
    { cause },
  )

/** Pure parser used by tests and by the sessionStorage boundary. */
export const parseAgentRuntimeE2EScriptJson = source => {
  if (source === null) return DEFAULT_AGENT_RUNTIME_E2E_SCRIPT
  if (typeof source !== 'string') {
    throw new AgentRuntimeE2EScriptConfigError(
      'invalid-json',
      `Agent Runtime E2E script at ${AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY} must be a JSON string or null`,
    )
  }

  let parsed
  try {
    parsed = JSON.parse(source)
  } catch (cause) {
    throw new AgentRuntimeE2EScriptConfigError(
      'invalid-json',
      `Agent Runtime E2E script at ${AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY} is not valid JSON`,
      { cause },
    )
  }

  try {
    return cloneAgentRuntimeE2ESteps(parsed)
  } catch (cause) {
    if (cause instanceof AgentRuntimeE2EWorkerError && cause.code === 'invalid-steps') {
      throw invalidScript(cause)
    }
    throw cause
  }
}

export const readAgentRuntimeE2EScript = storage => {
  const source = storage ?? globalThis.sessionStorage
  if (!source || typeof source.getItem !== 'function') {
    throw new AgentRuntimeE2EScriptConfigError(
      'storage-read-failed',
      'Agent Runtime E2E script requires an available sessionStorage implementation',
    )
  }

  let serialized
  try {
    serialized = source.getItem(AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY)
  } catch (cause) {
    throw new AgentRuntimeE2EScriptConfigError(
      'storage-read-failed',
      `Agent Runtime E2E script could not be read from ${AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY}`,
      { cause },
    )
  }
  return parseAgentRuntimeE2EScriptJson(serialized)
}
