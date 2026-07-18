import { defineConfig, devices } from '@playwright/test'

const appPort = process.env.DASHBOARD_ONLINE_E2E_PORT ?? '4198'
const appUrl = `http://127.0.0.1:${appPort}`
const dashboardRoot = new URL('..', import.meta.url).pathname

export default defineConfig({
  testDir: '.',
  testMatch: 'generated-material-host-online.spec.ts',
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
      VITE_DASHBOARD_AGENT_DATA: '1',
      VITE_DASHBOARD_AGENT_ONLINE: '1',
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
