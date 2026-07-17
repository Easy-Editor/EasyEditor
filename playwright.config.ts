import { defineConfig, devices } from '@playwright/test'

const appPort = process.env.DASHBOARD_E2E_PORT ?? '5197'
const appUrl = `http://127.0.0.1:${appPort}`

export default defineConfig({
  testDir: './examples/dashboard/e2e',
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['line'], ['html', { open: 'never' }]],
  use: {
    baseURL: appUrl,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm --dir examples/dashboard dev --host 127.0.0.1 --port ${appPort} --strictPort`,
    env: {
      VITE_DASHBOARD_AGENT_DATA: '1',
      VITE_DASHBOARD_AGENT_RUNTIME: '1',
      VITE_E2E: '1',
    },
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'ignore',
    timeout: 120_000,
    url: appUrl,
  },
})
