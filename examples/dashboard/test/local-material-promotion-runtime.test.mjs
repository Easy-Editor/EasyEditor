import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DashboardLocalMaterialPromotionClientError,
  LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON,
  LOCAL_MATERIAL_PROMOTION_POLICY,
  createDashboardLocalMaterialPromotionRuntime,
  createDashboardSameOriginLocalMaterialPromotionClient,
} from '../src/editor/agent/capabilities/promotion/index.mjs'

const authority = Object.freeze({
  projectId: 'project-promotion-runtime',
  branchId: 'branch-main',
  sessionId: 'session-1',
  taskId: 'task-1',
})

const enabledFlags = Object.freeze({ runtime: true, data: false, online: true, promotion: true })

const grantIdentity = Object.freeze({
  userId: 'user-1',
  policyVersion: 'dashboard-local-material-promotion/1',
  providerId: 'dashboard-same-origin-promotion',
  providerFingerprint: 'same-origin:/api/materials/promote',
})

const serviceCore = Object.freeze({
  async prepareSwitch() {
    assert.fail('availability checks must not prepare a Core mutation')
  },
  async switchRef() {
    assert.fail('availability checks must not switch a Core ref')
  },
  async restoreOnline() {
    assert.fail('availability checks must not restore a Core ref')
  },
  async captureProject() {
    assert.fail('availability checks must not capture the Engine')
  },
})

const createPersistence = checkLocalGrant =>
  Object.freeze({
    checkLocalGrant,
    async readArtifact() {
      assert.fail('availability checks must not read an artifact')
    },
    async recoverDurableAgentReceipt() {
      assert.fail('availability checks must not recover a receipt')
    },
    async readPromotionJournal() {
      assert.fail('availability checks must not read a journal')
    },
    async listPromotionJournals() {
      return []
    },
    async writePromotionJournal() {
      assert.fail('availability checks must not write a journal')
    },
    async runDurableAgentWrite() {
      assert.fail('availability checks must not open a durable write')
    },
  })

const createRuntime = ({
  checkAvailability,
  checkLocalGrant,
  featureFlags = enabledFlags,
  grantIdentity: runtimeGrantIdentity = grantIdentity,
} = {}) =>
  createDashboardLocalMaterialPromotionRuntime({
    authority,
    client: Object.freeze({
      checkAvailability: checkAvailability ?? (async () => ({ schemaVersion: 1, available: true, reason: null })),
      async promote() {
        assert.fail('availability checks must not promote')
      },
      async queryPromotion() {
        assert.fail('availability checks must not query a promotion')
      },
    }),
    core: serviceCore,
    crypto,
    featureFlags,
    ...(runtimeGrantIdentity ? { grantIdentity: runtimeGrantIdentity } : {}),
    persistence: createPersistence(
      checkLocalGrant ??
        (async () => ({ schemaVersion: 1, granted: true, reason: 'granted', grant: { status: 'granted' } })),
    ),
  })

const streamingJsonResponse = ({ chunks, contentLength }) => {
  let cancelCount = 0
  let getReaderCount = 0
  let readCount = 0
  let index = 0
  const reader = {
    async cancel() {
      cancelCount += 1
    },
    async read() {
      readCount += 1
      if (index >= chunks.length) return { done: true, value: undefined }
      const value = chunks[index]
      index += 1
      return { done: false, value }
    },
    releaseLock() {},
  }
  const body = {
    async cancel() {
      cancelCount += 1
    },
    getReader() {
      getReaderCount += 1
      return reader
    },
  }
  const response = {
    body,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') return 'application/json; charset=utf-8'
        if (name.toLowerCase() === 'content-length') return contentLength ?? null
        return null
      },
    },
    ok: true,
    status: 200,
  }
  return {
    response,
    metrics: () => ({ cancelCount, getReaderCount, readCount }),
  }
}

test('promotion runtime is inert under default-off feature flags and does not touch optional services', async () => {
  let optionalReads = 0
  const options = {
    authority,
    featureFlags: { runtime: false, data: false, online: false, promotion: false },
  }
  for (const key of ['client', 'core', 'crypto', 'grantIdentity', 'persistence']) {
    Object.defineProperty(options, key, {
      enumerable: true,
      get() {
        optionalReads += 1
        throw new Error(`default-off promotion runtime touched ${key}`)
      },
    })
  }

  const runtime = createDashboardLocalMaterialPromotionRuntime(options)
  assert.equal(runtime.promotionService, null)
  assert.deepEqual(await runtime.promotionAvailability(), {
    available: false,
    reason: LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.runtimeDisabled,
  })
  assert.equal(optionalReads, 0)
})

test('promotion availability requires all flags, a Node-20 trusted server, and the durable local policy grant', async () => {
  const flagCases = [
    [
      { runtime: true, data: false, online: false, promotion: true },
      LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.onlineDisabled,
    ],
    [
      { runtime: true, data: false, online: true, promotion: false },
      LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.featureDisabled,
    ],
  ]
  for (const [featureFlags, reason] of flagCases) {
    const runtime = createDashboardLocalMaterialPromotionRuntime({ authority, featureFlags })
    assert.equal(runtime.promotionService, null)
    assert.deepEqual(await runtime.promotionAvailability(), { available: false, reason })
  }

  let grantChecks = 0
  const node18 = createRuntime({
    checkAvailability: async () => ({
      schemaVersion: 1,
      available: false,
      reason: LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.nodeVersionUnsupported,
    }),
    checkLocalGrant: async () => {
      grantChecks += 1
      assert.fail('a Node-18 server must fail closed before the local grant check')
    },
  })
  assert.deepEqual(await node18.promotionAvailability(), {
    available: false,
    reason: LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.nodeVersionUnsupported,
  })
  assert.equal(grantChecks, 0)

  const serverUnavailable = createRuntime({
    checkAvailability: async () => ({
      schemaVersion: 1,
      available: false,
      reason: LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.serverUnavailable,
    }),
  })
  assert.deepEqual(await serverUnavailable.promotionAvailability(), {
    available: false,
    reason: LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.serverUnavailable,
  })

  const grantRequests = []
  const missingGrant = createRuntime({
    checkLocalGrant: async request => {
      grantRequests.push(structuredClone(request))
      return { schemaVersion: 1, granted: false, reason: 'missing', grant: null }
    },
  })
  assert.deepEqual(await missingGrant.promotionAvailability(), {
    available: false,
    reason: LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.localGrantRequired,
  })
  assert.deepEqual(grantRequests, [
    {
      schemaVersion: 1,
      userId: grantIdentity.userId,
      projectId: authority.projectId,
      scope: 'material.promote.local',
      policyVersion: grantIdentity.policyVersion,
      providerId: grantIdentity.providerId,
      providerFingerprint: grantIdentity.providerFingerprint,
    },
  ])
})

test('promotion runtime without an injected trusted grant identity remains grant-required after checking the server', async () => {
  let serverChecks = 0
  let grantChecks = 0
  const runtime = createRuntime({
    grantIdentity: null,
    checkAvailability: async () => {
      serverChecks += 1
      return { schemaVersion: 1, available: true, reason: null }
    },
    checkLocalGrant: async () => {
      grantChecks += 1
      assert.fail('an absent grant identity must not be replaced with a production fallback identity')
    },
  })

  assert.ok(runtime.promotionService)
  assert.deepEqual(await runtime.promotionAvailability(), {
    available: false,
    reason: LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.localGrantRequired,
  })
  assert.equal(serverChecks, 1)
  assert.equal(grantChecks, 0)
})

test('one durable grant permits repeated promotion discovery while revoke is observed immediately', async () => {
  let granted = true
  let checks = 0
  const runtime = createRuntime({
    checkLocalGrant: async () => {
      checks += 1
      return {
        schemaVersion: 1,
        granted,
        reason: granted ? 'granted' : 'revoked',
        grant: { status: granted ? 'granted' : 'revoked' },
      }
    },
  })
  assert.ok(runtime.promotionService)
  assert.deepEqual(Object.keys(runtime.promotionService).sort(), ['promoteLocal', 'queryReceipt', 'resumePending'])
  assert.deepEqual(await runtime.promotionAvailability(), { available: true, reason: null })
  assert.deepEqual(await runtime.promotionAvailability(), { available: true, reason: null })
  granted = false
  assert.deepEqual(await runtime.promotionAvailability(), {
    available: false,
    reason: LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.localGrantRequired,
  })
  assert.equal(checks, 3)
  assert.deepEqual(LOCAL_MATERIAL_PROMOTION_POLICY, {
    scope: 'material.promote.local',
    policyVersion: 'dashboard-local-material-promotion/1',
    providerId: 'dashboard-same-origin-promotion',
    providerFingerprint: 'same-origin:/api/materials/promote',
  })
})

test('editor runtime composes same-origin promotion ports only behind runtime, online, and promotion flags', async () => {
  const source = await readFile(new URL('../src/editor/runtime.ts', import.meta.url), 'utf8')
  assert.match(source, /createDashboardSameOriginLocalMaterialPromotionClient/u)
  assert.match(source, /createDashboardLocalMaterialPromotionRuntime/u)
  assert.match(source, /createDashboardLocalMaterialPromotionPersistenceAdapter/u)
  assert.match(
    source,
    /dashboardAgentRuntimeFeatureFlags\.runtime\s*&&\s*dashboardAgentRuntimeFeatureFlags\.online\s*&&\s*dashboardAgentRuntimeFeatureFlags\.promotion/u,
  )
  assert.match(source, /fetchImpl:\s*window\.fetch\.bind\(window\)/u)
  assert.match(source, /promotionService/u)
  assert.match(source, /promotionAvailability/u)
  assert.doesNotMatch(source, /dashboard-local-user/u)
  assert.match(source, /createBoundDashboardAgentHost\(hostAuthority, grantIdentity\)/u)
  assert.doesNotMatch(source, /@easy-editor\/easypack|server\/promotion|from ['"]node:/u)

  const browserPromotionSources = await Promise.all(
    ['index.mjs', 'client.mjs', 'runtime.mjs', 'persistence-adapter.mjs'].map(file =>
      readFile(new URL(`../src/editor/agent/capabilities/promotion/${file}`, import.meta.url), 'utf8'),
    ),
  )
  assert.doesNotMatch(browserPromotionSources.join('\n'), /@easy-editor\/easypack|server\/promotion|from ['"]node:/u)
})

test('same-origin client enforces the one-MiB response cap before and during promote, query, and availability reads', async () => {
  const maxResponseBytes = 1024 * 1024
  const declaredOversize = streamingJsonResponse({
    chunks: [new TextEncoder().encode('{}')],
    contentLength: String(maxResponseBytes + 1),
  })
  const promoteClient = createDashboardSameOriginLocalMaterialPromotionClient({
    projectId: authority.projectId,
    fetchImpl: async () => declaredOversize.response,
  })
  await assert.rejects(
    promoteClient.promote({ schemaVersion: 1 }),
    error => error instanceof DashboardLocalMaterialPromotionClientError && error.code === 'invalid-response',
  )
  assert.deepEqual(declaredOversize.metrics(), { cancelCount: 1, getReaderCount: 0, readCount: 0 })

  const queryOversize = streamingJsonResponse({
    chunks: [new Uint8Array(maxResponseBytes), new Uint8Array(1)],
  })
  const queryClient = createDashboardSameOriginLocalMaterialPromotionClient({
    projectId: authority.projectId,
    fetchImpl: async () => queryOversize.response,
  })
  await assert.rejects(
    queryClient.queryPromotion({ promotionId: `sha256:${'a'.repeat(64)}` }),
    error => error instanceof DashboardLocalMaterialPromotionClientError && error.code === 'invalid-response',
  )
  assert.deepEqual(queryOversize.metrics(), { cancelCount: 1, getReaderCount: 1, readCount: 2 })

  const availabilityOversize = streamingJsonResponse({
    chunks: [new Uint8Array(maxResponseBytes), new Uint8Array(1)],
  })
  const availabilityClient = createDashboardSameOriginLocalMaterialPromotionClient({
    projectId: authority.projectId,
    fetchImpl: async () => availabilityOversize.response,
  })
  assert.deepEqual(await availabilityClient.checkAvailability(), {
    schemaVersion: 1,
    available: false,
    reason: LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.serverUnavailable,
  })
  assert.deepEqual(availabilityOversize.metrics(), { cancelCount: 1, getReaderCount: 1, readCount: 2 })
})
