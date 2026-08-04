import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DASHBOARD_AGENT_HOST_COMPATIBILITY,
  DASHBOARD_AGENT_HOST_VERSION,
  createDashboardAgentHost,
  createDashboardAgentHostCompatibility,
  createDashboardAgentHostFactory,
  createMemoryDashboardAgentPersistence,
} from '../dist/index.js'

const artifactSha256 = label => createHash('sha256').update(label).digest('hex')

test('publishes the Host factory and a pinned compatibility tuple', () => {
  assert.equal(typeof createDashboardAgentHost, 'function')
  assert.equal(typeof createDashboardAgentHostFactory, 'function')
  assert.equal(DASHBOARD_AGENT_HOST_VERSION, '0.0.0')
  assert.deepEqual(DASHBOARD_AGENT_HOST_COMPATIBILITY.contracts, {
    agentHost: 1,
    projectSchema: '1.0.0',
    screenApplyChangeSet: 1,
  })
})

test('creates the strict EasyDashboard compatibility tuple from immutable artifact hashes', () => {
  const tuple = createDashboardAgentHostCompatibility({
    runtimeSha256: artifactSha256('runtime-artifact'),
    coreSha256: artifactSha256('core-artifact'),
    rendererSha256: artifactSha256('renderer-artifact'),
    dashboardAgentHostSha256: artifactSha256('host-artifact'),
    browserArtifactVersion: '0.0.0',
    browserArtifactSha256: artifactSha256('browser-artifact'),
    materialManifestVersion: 'workspace-v1',
    materialManifestSha256: artifactSha256('material-manifest'),
  })
  assert.deepEqual(Object.keys(tuple).sort(), [
    'browserArtifactSha256',
    'browserArtifactVersion',
    'coreSha256',
    'coreVersion',
    'dashboardAgentHostSha256',
    'dashboardAgentHostVersion',
    'materialManifestSha256',
    'materialManifestVersion',
    'rendererSha256',
    'rendererVersion',
    'runtimeSha256',
    'runtimeVersion',
  ])
  assert.throws(
    () =>
      createDashboardAgentHostCompatibility({
        runtimeSha256: 'mutable',
        coreSha256: artifactSha256('core-artifact'),
        rendererSha256: artifactSha256('renderer-artifact'),
        dashboardAgentHostSha256: artifactSha256('host-artifact'),
        browserArtifactVersion: '0.0.0',
        browserArtifactSha256: artifactSha256('browser-artifact'),
        materialManifestVersion: 'workspace-v1',
        materialManifestSha256: artifactSha256('material-manifest'),
      }),
    /lowercase SHA-256/u,
  )
})

test('production bundle is self-contained and has no examples runtime import', async () => {
  const source = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /examples\/dashboard/u)
  assert.doesNotMatch(source, /from\s+['"][^'"]+['"]/u)
  assert.match(source, /createDashboardAgentHost/u)
})

test('factory delegates only Host composition and has no credential input', () => {
  const authority = {
    projectId: 'project-1',
    branchId: 'main',
    sessionId: 'session-1',
    taskId: 'task-1',
  }
  const host = { dispose() {} }
  const factory = createDashboardAgentHostFactory({
    composeHost: received => {
      assert.equal(received, authority)
      return host
    },
  })
  assert.equal(factory.create(authority), host)
})

test('memory persistence keeps receipts in process-local state', async () => {
  const persistence = createMemoryDashboardAgentPersistence()
  await persistence.runDurableAgentWrite(async session => {
    const intent = { callId: 'call-1' }
    await session.recordIntent(intent)
    await session.commitBatch({
      callId: 'call-1',
      receiptIntent: intent,
      receipt: { status: 'applied', callId: 'call-1' },
    })
  })
  assert.deepEqual(persistence.snapshot(), {
    kind: 'memory',
    draftGeneration: 1,
    receiptCount: 1,
  })
  assert.equal((await persistence.recoverDurableAgentReceipt({ callId: 'call-1' })).classification, 'committed')
})
