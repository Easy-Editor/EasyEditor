import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const dashboardRoot = new URL('../src/editor/materials/', import.meta.url)
const read = path => readFile(new URL(path, dashboardRoot), 'utf8')

test('DashboardIcon is registered in the dashboard and Document Executor material bundle', async () => {
  const [componentRegistry, metaRegistry, executorRegistry] = await Promise.all([
    read('component.ts'),
    read('meta.ts'),
    readFile(new URL('../../../spikes/document-executor/harness/executor-materials.ts', import.meta.url), 'utf8'),
  ])

  assert.match(componentRegistry, /dashboard-icon\/component/u)
  assert.match(componentRegistry, /\bDashboardIcon,/u)
  assert.match(metaRegistry, /dashboard-icon\/meta/u)
  assert.match(metaRegistry, /\bDashboardIcon,/u)
  assert.match(executorRegistry, /\{ component: DashboardIcon, meta: DashboardIconMeta \}/u)
})
