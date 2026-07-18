import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import {
  LOCAL_MATERIAL_E2E_AUTH_CONFIG,
  LOCAL_MATERIAL_E2E_COOKIE_NAME,
  LOCAL_MATERIAL_E2E_SESSION_TOKEN,
} from './fixtures/local-material-promotion-lifecycle'

const appPort = process.env.DASHBOARD_ONLINE_E2E_PORT ?? '4198'
const appUrl = `http://127.0.0.1:${appPort}`
const dashboardRoot = new URL('..', import.meta.url).pathname
const dataRoot = join(tmpdir(), `easy-editor-online-e2e-${process.pid}-${randomUUID()}`)
process.env.DASHBOARD_ONLINE_E2E_DATA_ROOT = dataRoot
const goldenAuthConfig = {
  ...LOCAL_MATERIAL_E2E_AUTH_CONFIG,
  auth: {
    ...LOCAL_MATERIAL_E2E_AUTH_CONFIG.auth,
    sessions: LOCAL_MATERIAL_E2E_AUTH_CONFIG.auth.sessions.map(session => ({
      ...session,
      projectIds: [...session.projectIds, 'agent-runtime-golden-project'],
    })),
  },
}

export default defineConfig({
  testDir: '.',
  testMatch: [
    'generated-material-host-online.spec.ts',
    'generated-material-host-durable-lifecycle.spec.ts',
    'agent-runtime-dashboard-golden.spec.ts',
  ],
  globalTeardown: './fixtures/online-components-global-teardown.ts',
  expect: { timeout: 15_000 },
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 0,
  timeout: 150_000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: appUrl,
    screenshot: 'only-on-failure',
    storageState: {
      cookies: [
        {
          name: LOCAL_MATERIAL_E2E_COOKIE_NAME,
          value: LOCAL_MATERIAL_E2E_SESSION_TOKEN,
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Strict',
        },
      ],
      origins: [],
    },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${appPort} --strictPort`,
    cwd: dashboardRoot,
    env: {
      EASY_EDITOR_DASHBOARD_DATA_DIR: dataRoot,
      EASY_EDITOR_MATERIAL_PROMOTION_CONFIG_JSON: JSON.stringify(goldenAuthConfig),
      EASY_EDITOR_MATERIAL_PROMOTION_ENABLED: '1',
      EASY_EDITOR_MATERIAL_GC_ENABLED: '1',
      VITE_DASHBOARD_AGENT_DATA: '1',
      VITE_DASHBOARD_AGENT_ONLINE: '1',
      VITE_DASHBOARD_AGENT_PROMOTION: '1',
      VITE_DASHBOARD_AGENT_RUNTIME: '1',
      VITE_DASHBOARD_MATERIAL_GC: '1',
      VITE_E2E: '1',
    },
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'ignore',
    timeout: 120_000,
    url: appUrl,
  },
})
