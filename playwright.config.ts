import { defineConfig, devices } from '@playwright/test'

const appUrl = 'http://127.0.0.1:5173'

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
    command: 'pnpm --dir examples/dashboard dev --host 127.0.0.1 --port 5173 --strictPort',
    env: { VITE_E2E: '1' },
    reuseExistingServer: !process.env.CI,
    stderr: 'pipe',
    stdout: 'ignore',
    timeout: 120_000,
    url: appUrl,
  },
})
