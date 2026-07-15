import { defineConfig, devices } from '@playwright/test'

const appUrl = 'http://127.0.0.1:4186'
const dashboardRoot = new URL('../..', import.meta.url).pathname

export default defineConfig({
  testDir: '../../e2e',
  expect: { timeout: 15_000 },
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 0,
  timeout: 60_000,
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
    command: 'pnpm dev --host 127.0.0.1 --port 4186 --strictPort',
    cwd: dashboardRoot,
    env: { VITE_E2E: '1' },
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'ignore',
    timeout: 120_000,
    url: appUrl,
  },
})
