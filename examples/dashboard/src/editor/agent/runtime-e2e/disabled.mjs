const unavailable = () => Promise.reject(new Error('Agent Runtime E2E support is excluded from this build'))

export const loadAgentRuntimeE2EScriptConfig = unavailable
export const loadAgentRuntimeE2EWorkerEndpointFactory = unavailable
export const loadAgentRuntimeE2ERecoveryConfig = unavailable
