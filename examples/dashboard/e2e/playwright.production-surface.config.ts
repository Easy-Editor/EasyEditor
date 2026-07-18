import { defineConfig, devices } from '@playwright/test'

const appPort = process.env.DASHBOARD_PRODUCTION_SURFACE_E2E_PORT ?? '4199'
const appUrl = `http://127.0.0.1:${appPort}`
const dashboardRoot = new URL('..', import.meta.url).pathname

export default defineConfig({
  testDir: '.',
  testMatch: 'generated-material-host-production-surface.spec.ts',
  expect: { timeout: 20_000 },
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 0,
  timeout: 120_000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: appUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      'pnpm build:only && pnpm exec vite build --config e2e/vite.production-surface-fixture.config.mts && node server/index.mjs',
    cwd: dashboardRoot,
    env: {
      PORT: appPort,
      VITE_DASHBOARD_AGENT_DATA: '1',
      VITE_DASHBOARD_AGENT_ONLINE: '1',
      VITE_DASHBOARD_AGENT_RUNTIME: '1',
      VITE_E2E: '0',
    },
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 180_000,
    url: appUrl,
  },
})
