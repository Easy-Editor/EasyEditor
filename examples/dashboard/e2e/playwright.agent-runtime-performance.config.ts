import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

const appPort = process.env.DASHBOARD_AGENT_PERFORMANCE_E2E_PORT ?? '4201'
const appUrl = `http://127.0.0.1:${appPort}`
const e2eRoot = new URL('.', import.meta.url).pathname
const dashboardRoot = new URL('..', import.meta.url).pathname
const dataRoot = join(tmpdir(), `easy-editor-online-e2e-performance-${process.pid}-${randomUUID()}`)
const outputRoot = join(e2eRoot, 'test-results', 'agent-runtime-performance')
process.env.DASHBOARD_ONLINE_E2E_DATA_ROOT = dataRoot

export default defineConfig({
  testDir: './performance',
  testMatch: 'agent-runtime-dashboard-performance.spec.ts',
  globalTeardown: './fixtures/online-components-global-teardown.ts',
  expect: { timeout: 20_000 },
  forbidOnly: true,
  failOnFlakyTests: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: 'line',
  outputDir: outputRoot,
  preserveOutput: 'always',
  metadata: {
    runner: 'g010-fixed-chromium',
    runnerClass: 'g010-fixed-no-throttle',
    cpuThrottleRate: 1,
    viewport: '1440x900',
    deviceScaleFactor: 1,
  },
  use: { baseURL: appUrl, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium-fixed',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        colorScheme: 'light',
        locale: 'en-US',
        timezoneId: 'UTC',
      },
    },
  ],
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${appPort} --strictPort`,
    cwd: dashboardRoot,
    env: {
      EASY_EDITOR_DASHBOARD_DATA_DIR: dataRoot,
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
