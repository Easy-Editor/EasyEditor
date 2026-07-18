import { GENERATED_MATERIAL_PROJECT_ID } from './generated-material-host'

export const LOCAL_MATERIAL_E2E_COOKIE_NAME = 'easy-editor-session'
export const LOCAL_MATERIAL_E2E_SESSION_TOKEN = 'g009-browser-session-token'
export const LOCAL_MATERIAL_E2E_TENANT_ID = 'g009-tenant'

export const LOCAL_MATERIAL_E2E_GRANT_AUTHORITY = Object.freeze({
  userId: 'dashboard-e2e-user',
  policyVersion: 'dashboard-e2e-policy-v1',
  providerId: 'dashboard-e2e-scripted-worker',
  providerFingerprint: 'dashboard-e2e-scripted-worker-v1',
  providerLabel: 'Dashboard E2E Scripted Worker',
})

export const LOCAL_MATERIAL_E2E_AUTH_CONFIG = Object.freeze({
  auth: Object.freeze({
    mode: 'cookie-session' as const,
    cookieName: LOCAL_MATERIAL_E2E_COOKIE_NAME,
    sessions: Object.freeze([
      Object.freeze({
        token: LOCAL_MATERIAL_E2E_SESSION_TOKEN,
        tenantId: LOCAL_MATERIAL_E2E_TENANT_ID,
        userId: LOCAL_MATERIAL_E2E_GRANT_AUTHORITY.userId,
        projectIds: Object.freeze([GENERATED_MATERIAL_PROJECT_ID]),
      }),
    ]),
  }),
})
