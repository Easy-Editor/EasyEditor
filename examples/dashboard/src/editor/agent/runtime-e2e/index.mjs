const isViteE2EEnabled = () => import.meta.env?.VITE_E2E === '1'

const assertViteE2EEnabled = () => {
  if (!isViteE2EEnabled()) {
    throw new Error('Agent Runtime scripted module Workers are available only when VITE_E2E=1')
  }
}

/**
 * Keeps the scripted Worker and testing entry out of normal Dashboard chunks.
 * Callers receive the synchronous endpoint factory only after the E2E gate passes.
 */
export const loadAgentRuntimeE2EWorkerEndpointFactory = async () => {
  assertViteE2EEnabled()
  const { createAgentRuntimeE2EWorkerEndpoint } = await import('./endpoint.mjs')
  return createAgentRuntimeE2EWorkerEndpoint
}

/** Dynamically exposes the sessionStorage parser only to VITE_E2E composition. */
export const loadAgentRuntimeE2EScriptConfig = async () => {
  assertViteE2EEnabled()
  return import('./script-config.mjs')
}

/** Dynamically exposes deterministic recovery fixtures only to VITE_E2E composition. */
export const loadAgentRuntimeE2ERecoveryConfig = async () => {
  assertViteE2EEnabled()
  return import('./recovery-config.mjs')
}
