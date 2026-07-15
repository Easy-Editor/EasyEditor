import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  AGENT_RUNTIME_FEATURE_FLAG_ENV,
  DEFAULT_AGENT_RUNTIME_FEATURE_FLAGS,
  resolveAgentRuntimeFeatureFlags,
} from '../src/editor/agent/feature-flags.mjs'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const readRepositoryFile = relativePath => readFile(new URL(relativePath, `file://${repositoryRoot}/`), 'utf8')

const flagNames = ['data', 'online', 'promotion', 'runtime']

test('Phase 0 feature flags are finite, default-off, immutable, and side-effect free', () => {
  assert.deepEqual(Object.keys(AGENT_RUNTIME_FEATURE_FLAG_ENV).sort(), flagNames)
  assert.deepEqual(Object.keys(DEFAULT_AGENT_RUNTIME_FEATURE_FLAGS).sort(), flagNames)
  assert.deepEqual(
    { ...DEFAULT_AGENT_RUNTIME_FEATURE_FLAGS },
    {
      runtime: false,
      data: false,
      online: false,
      promotion: false,
    },
  )
  assert.equal(Object.isFrozen(AGENT_RUNTIME_FEATURE_FLAG_ENV), true)
  assert.equal(Object.isFrozen(DEFAULT_AGENT_RUNTIME_FEATURE_FLAGS), true)

  const source = Object.freeze({ UNKNOWN_AGENT_FLAG: 'true' })
  const resolved = resolveAgentRuntimeFeatureFlags(source)
  assert.deepEqual(resolved, DEFAULT_AGENT_RUNTIME_FEATURE_FLAGS)
  assert.equal(Object.isFrozen(resolved), true)
  assert.deepEqual(source, { UNKNOWN_AGENT_FLAG: 'true' })
})

test('Phase 0 feature flags resolve independently and reversibly', () => {
  for (const flagName of flagNames) {
    const environmentName = AGENT_RUNTIME_FEATURE_FLAG_ENV[flagName]
    const expected = { ...DEFAULT_AGENT_RUNTIME_FEATURE_FLAGS, [flagName]: true }

    for (const enabledValue of [true, 'true', '1']) {
      assert.deepEqual(resolveAgentRuntimeFeatureFlags({ [environmentName]: enabledValue }), expected)
    }

    for (const disabledValue of [false, 'false', '0', 'TRUE', 1, null, undefined]) {
      assert.deepEqual(
        resolveAgentRuntimeFeatureFlags({ [environmentName]: disabledValue }),
        DEFAULT_AGENT_RUNTIME_FEATURE_FLAGS,
      )
    }
  }
})

test('Phase 0 ADR freezes reviewed public and cross-boundary anchors', async () => {
  const adr = await readRepositoryFile('docs/design/agent-runtime-dashboard-phase-zero.md')
  const requiredAnchors = [
    '**Status:** Accepted',
    'ADR-AR-001 — Worker composition and public entries',
    '@easy-editor/agent-runtime/worker',
    '@easy-editor/agent-runtime/testing',
    'ADR-AR-002 — Core-neutral mutation boundary',
    'expectedMutationVersion',
    'unsetPropPaths',
    'ADR-AR-003 — Durable commit and migration authority',
    'ProjectPersistenceCoordinator',
    'materializeLegacyFromCanonical',
    'ADR-AR-004 — ArtifactRef trusted-proxy identity',
    "kind: 'local-material'",
    'GeneratedMaterialHost',
    'ADR-AR-005 — Configure annotation boundary',
    'ConfigureFieldAnnotation',
    'ADR-AR-006 — Surface-local generated overlay plane',
    'VITE_DASHBOARD_AGENT_RUNTIME',
    'Deterministic fixtures and performance boundaries',
    'Non-goals for the pilot',
  ]

  for (const anchor of requiredAnchors) {
    assert.match(adr, new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Golden project fixture is deterministic and keeps the KPI material missing', async () => {
  const fixture = JSON.parse(
    await readRepositoryFile('examples/dashboard/test/fixtures/agent-runtime-golden-project.json'),
  )
  const contract = fixture.meta.agentRuntimeGoldenFixture
  const [root] = fixture.componentsTree
  const nodeIds = root.children.map(node => node.id)
  const roles = Object.fromEntries(root.children.map(node => [node.$dashboard.fixtureRole, node]))
  const endpoints = Object.fromEntries(fixture.dataSource.list.map(endpoint => [endpoint.type, endpoint]))

  assert.equal(fixture.id, 'agent-runtime-golden-project')
  assert.equal(fixture.version, '1.0.0')
  assert.deepEqual(contract.viewport, { width: 1920, height: 1080 })
  assert.deepEqual(root.$dashboard.rect, { x: 0, y: 0, width: 1920, height: 1080 })
  assert.deepEqual(nodeIds, ['golden-title', 'golden-map', 'golden-chart'])
  assert.equal(new Set(['golden-root', ...nodeIds]).size, 4)
  assert.equal(roles.title.componentName, 'Text')
  assert.equal(roles.map.componentName, 'Image')
  assert.equal(roles.chart.componentName, 'BarChart')
  assert.equal(endpoints.mock.options.uri, 'mock://city/summary')
  assert.equal(endpoints.http.options.uri, 'https://fixtures.easy-editor.invalid/api/traffic-flow')
  assert.equal(contract.createdAt, '2026-07-15T00:00:00.000Z')
  assert.equal(contract.modelScriptStartedAt, '2026-07-15T00:00:01.000Z')
  assert.equal(
    contract.plannedArtifact.sourceIntegrity,
    'sha256:fdf20e1271c1745e25f868589f9f643125ac4820046f59d7635051898cd4c953',
  )
  assert.equal(
    contract.plannedArtifact.dependencyLockDigest,
    'sha256:4b11cbcc983558c49d5e00223f850725484ef83e3bb8a4dded78b146b58d1c7f',
  )
  assert.deepEqual(contract.missingKpiMaterial, {
    requestedName: 'CityOperationsKpi',
    logicalComponentId: 'city-operations-kpi',
    trustedProxyComponentName: 'GeneratedMaterialHost',
    status: 'missing',
  })
  assert.equal(
    root.children.some(node => node.componentName === 'GeneratedMaterialHost'),
    false,
  )
  assert.equal(
    root.children.some(node => node.componentName === 'CityOperationsKpi'),
    false,
  )
})

test('Core reviewed public API remains Agent-free', async () => {
  const reviewedApi = JSON.parse(await readRepositoryFile('packages/core/test/fixtures/instance-public-api.json'))
  const forbiddenExports = [
    'AgentHost',
    'AgentPersistencePort',
    'AgentRuntime',
    'AgentWorkerEndpoint',
    'CapabilityProvider',
    'ModelAdapter',
    'agentCapabilities',
  ]
  const exports = new Set([...reviewedApi.all, ...reviewedApi.runtime])

  for (const forbiddenExport of forbiddenExports) {
    assert.equal(exports.has(forbiddenExport), false, `Core public API must not expose ${forbiddenExport}`)
  }

  const typeGate = await readRepositoryFile('packages/core/test/instance-entry.test-d.ts')
  assert.match(typeGate, /engine\.agentCapabilities/)
})
