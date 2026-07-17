import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  ONLINE_COMPONENT_DEPENDENCY_RESOLVE_ENDPOINT,
  createDashboardOnlineComponentDependencyResolver,
} from '../src/editor/agent/online-components/dependency-resolver.mjs'

const dependency = (overrides = {}) => {
  const bytes = Buffer.from('export default {}')
  return {
    package: '@scope/card',
    range: '^1.0.0',
    exactVersion: '1.2.3',
    finalUrl: 'https://registry.example.test/@scope/card/1.2.3/index.mjs',
    integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    cached: false,
    module: {
      format: 'bundled-esm',
      contentType: 'text/javascript',
      encoding: 'base64',
      byteLength: bytes.byteLength,
      bytes: bytes.toString('base64'),
    },
    ...overrides,
  }
}

test('browser dependency resolver posts only to the fixed same-origin endpoint and returns an exact locked DTO', async () => {
  const calls = []
  const resolver = createDashboardOnlineComponentDependencyResolver({
    async fetchImpl(url, init) {
      calls.push([url, structuredClone(init)])
      return { ok: true, status: 200, json: async () => ({ schemaVersion: 1, dependency: dependency() }) }
    },
  })
  const result = await resolver.resolve({ package: '@scope/card', range: '^1.0.0' })
  assert.deepEqual(result, dependency())
  assert.deepEqual(calls, [
    [
      ONLINE_COMPONENT_DEPENDENCY_RESOLVE_ENDPOINT,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: '@scope/card', range: '^1.0.0' }),
      },
    ],
  ])
})

test('browser dependency resolver rejects HTTP failures, error envelopes, extra fields, and authority mismatches', async () => {
  const cases = [
    { ok: false, status: 502, json: async () => ({ error: 'upstream' }) },
    { ok: true, status: 200, json: async () => ({ schemaVersion: 1, error: { code: 'DENIED' } }) },
    { ok: true, status: 200, json: async () => ({ schemaVersion: 1, dependency: dependency(), extra: true }) },
    {
      ok: true,
      status: 200,
      json: async () => ({ schemaVersion: 1, dependency: dependency({ package: '@scope/other' }) }),
    },
  ]
  for (const response of cases) {
    const resolver = createDashboardOnlineComponentDependencyResolver({ fetchImpl: async () => response })
    await assert.rejects(resolver.resolve({ package: '@scope/card', range: '^1.0.0' }))
  }
})

test('Dashboard production composes the artifact resolver and service only behind runtime plus online flags', () => {
  const source = readFileSync(new URL('../src/editor/runtime.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /const artifactService =\s*dashboardAgentRuntimeFeatureFlags\.runtime && dashboardAgentRuntimeFeatureFlags\.online/u,
  )
  assert.match(
    source,
    /createDashboardOnlineComponentDependencyResolver\(\{ fetchImpl: window\.fetch\.bind\(window\) \}\)/u,
  )
  assert.match(source, /\.\.\.\(artifactService \? \{ artifactService \} : \{\}\)/u)
})
