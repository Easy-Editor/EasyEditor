import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DashboardDataCapabilityError,
  createDashboardDataCapabilityService,
  createDashboardDataManifestCache,
  createDashboardSameOriginDataResolver,
} from '../src/editor/agent/capabilities/data/index.mjs'

const authority = Object.freeze({
  projectId: 'project-data-capabilities',
  branchId: 'branch-main',
  sessionId: 'session-1',
  taskId: 'task-1',
})

const semanticCall = (capability, callId, args, expectedRevision = 'revision-7') => ({
  schemaVersion: 1,
  ...authority,
  stepId: 'step-1',
  callId,
  capability,
  arguments: args,
  expectedRevision,
})

const createServiceHarness = ({ projectDataSource, recoverInvocation = async () => null, rootDataSource } = {}) => {
  const root = {
    docId: 'page-1',
    id: 'root-1',
    componentName: 'Root',
    props: {},
    ...(rootDataSource === undefined ? {} : { dataSource: structuredClone(rootDataSource) }),
    children: [
      { id: 'text-1', componentName: 'Text', props: { text: 'fallback' }, children: [] },
      { id: 'bar-1', componentName: 'BarChart', props: { data: [] }, children: [] },
      { id: 'line-1', componentName: 'LineChart', props: { data: [] }, children: [] },
      { id: 'image-1', componentName: 'Image', props: { src: 'image://fallback' }, children: [] },
    ],
  }
  const findNode = nodeId => {
    const pending = [root]
    while (pending.length > 0) {
      const node = pending.shift()
      if (node.id === nodeId) return node
      pending.push(...node.children)
    }
    return null
  }
  const screenCalls = []
  const screenApplyChangeSet = async call => {
    const ownedCall = structuredClone(call)
    screenCalls.push(ownedCall)
    const operation = ownedCall.arguments.operations[0]
    const node = findNode(operation.nodeId)
    assert.ok(node)
    assert.equal(operation.type, 'set')
    node.props[operation.fieldId] = structuredClone(operation.value)
    return Object.freeze({ schemaVersion: 1, callId: ownedCall.callId, status: 'applied' })
  }
  const engine = {
    project: {
      currentDocument: { id: 'page-1', exportRaw: () => structuredClone(root) },
      export: () => ({
        id: authority.projectId,
        ...(projectDataSource === undefined ? {} : { dataSource: structuredClone(projectDataSource) }),
      }),
    },
  }
  const resolver = createDashboardSameOriginDataResolver({ fetchImpl: async () => assert.fail('unexpected fetch') })
  const service = createDashboardDataCapabilityService({
    authority,
    engine,
    recoverInvocation,
    resolver,
    screenApplyChangeSet,
  })
  return { findNode, root, screenCalls, service }
}

test('trusted data manifest cache upgrades only its reserved field without masking unrelated readiness gaps', async () => {
  const base = {
    schemaVersion: 1,
    materialRegistryVersion: 7,
    componentName: 'Root',
    fields: [
      { fieldId: 'dataSources', access: 'read-only', readPath: ['props', 'dataSources'] },
      { fieldId: 'future.unsupported', access: 'unsupported' },
    ],
    diagnostics: [],
    readiness: {
      status: 'not-ready',
      missingFieldIds: ['future.missing'],
      unsupportedFieldIds: ['future.unsupported'],
    },
  }
  const cache = createDashboardDataManifestCache({ get: async () => base })
  const upgraded = await cache.get('Root', 7)

  assert.equal(upgraded.fields.find(field => field.fieldId === 'dataSources').access, 'read-write')
  assert.equal(upgraded.fields.find(field => field.fieldId === 'future.unsupported').access, 'unsupported')
  assert.deepEqual(upgraded.readiness, {
    status: 'not-ready',
    missingFieldIds: ['future.missing'],
    unsupportedFieldIds: ['future.unsupported'],
  })
  assert.equal(base.fields[0].access, 'read-only')
})

test('data upsert, inspect, and preview persist only safe Root props and transform exactly once', async () => {
  const { root, screenCalls, service } = createServiceHarness()
  const upsertB = semanticCall('data.upsert', 'upsert-b', {
    schemaVersion: 1,
    descriptor: { schemaVersion: 1, id: 'source-b', kind: 'mock', fixture: [2, 3] },
  })
  const upsertA = semanticCall('data.upsert', 'upsert-a', {
    schemaVersion: 1,
    descriptor: {
      schemaVersion: 1,
      id: 'source-a',
      kind: 'static',
      value: { payload: { payload: 'double-transform-would-return-this', total: 42 } },
      transform: [{ op: 'select', path: ['payload'] }],
    },
  })
  const upsertCredentialed = semanticCall('data.upsert', 'upsert-credentialed', {
    schemaVersion: 1,
    descriptor: {
      schemaVersion: 1,
      id: 'source-private',
      kind: 'credentialed-http-json',
      providerId: 'provider-1',
      credentialRef: 'vault-ref-1',
      request: { url: 'https://private.example.test/data', method: 'GET' },
    },
  })
  await service.upsert(upsertB)
  await service.upsert(upsertA)
  await service.upsert(upsertCredentialed)

  assert.deepEqual(
    root.props.dataSources.sources.map(source => source.id),
    ['source-a', 'source-b', 'source-private'],
  )
  assert.equal(Object.hasOwn(root.props, 'dataSource'), false)
  assert.equal(Object.hasOwn(root, 'dataSource'), false)
  assert.equal(screenCalls[1].capability, 'screen.applyChangeSet')
  assert.equal(screenCalls[1].callId, upsertA.callId)
  assert.equal(screenCalls[1].expectedRevision, upsertA.expectedRevision)
  assert.deepEqual(screenCalls[1].arguments, {
    schemaVersion: 1,
    documentId: 'page-1',
    operations: [
      {
        opId: 'data-upsert:source-a',
        type: 'set',
        nodeId: 'root-1',
        fieldId: 'dataSources',
        value: {
          schemaVersion: 1,
          sources: [upsertA.arguments.descriptor, upsertB.arguments.descriptor],
        },
      },
    ],
  })

  const inspected = await service.inspect(semanticCall('data.inspect', 'inspect-all', { schemaVersion: 1 }))
  assert.deepEqual(
    inspected.sources.map(source => source.id),
    ['source-a', 'source-b', 'source-private'],
  )
  assert.deepEqual(inspected.scope, { kind: 'page', documentId: 'page-1' })
  assert.doesNotMatch(JSON.stringify(inspected), /vault-ref-1/)
  assert.deepEqual(inspected.sources[2], {
    schemaVersion: 1,
    id: 'source-private',
    kind: 'credentialed-http-json',
    hasTransform: false,
    providerId: 'provider-1',
    destination: { url: 'https://private.example.test/data', method: 'GET' },
  })

  const preview = await service.preview(
    semanticCall('data.preview', 'preview-a', { schemaVersion: 1, sourceId: 'source-a' }),
  )
  assert.deepEqual(preview.preview, {
    kind: 'object',
    keys: ['payload', 'total'],
    sample: { payload: 'double-transform-would-return-this', total: 42 },
  })
  assert.deepEqual(preview.scope, { kind: 'page', documentId: 'page-1' })
})

test('data write replay recovery runs before current page, descriptor, node, and legacy conflict validation', async () => {
  const recovered = Object.freeze({
    schemaVersion: 1,
    callId: 'recovered-write',
    status: 'applied',
    revision: 'durable-revision-1',
  })
  const recoveryAuthorities = []
  const { screenCalls, service } = createServiceHarness({
    projectDataSource: { list: [{ id: 'legacy-1', type: 'fetch' }] },
    recoverInvocation: async recoveryAuthority => {
      recoveryAuthorities.push(structuredClone(recoveryAuthority))
      return recovered
    },
  })

  const malformedUpsert = semanticCall('data.upsert', recovered.callId, {
    schemaVersion: 99,
    descriptor: { schemaVersion: 1, id: 'legacy-1', kind: 'static', value: 1 },
  })
  const missingNodeBind = semanticCall('data.bind', recovered.callId, {
    schemaVersion: 1,
    nodeId: 'deleted-node',
    field: 'text',
    binding: { sourceId: 'deleted-source' },
  })

  assert.strictEqual(await service.upsert(malformedUpsert), recovered)
  assert.strictEqual(await service.bind(missingNodeBind), recovered)
  assert.deepEqual(recoveryAuthorities, [
    { projectId: authority.projectId, branchId: authority.branchId, callId: recovered.callId },
    { projectId: authority.projectId, branchId: authority.branchId, callId: recovered.callId },
  ])
  assert.equal(screenCalls.length, 0)
})

test('data bind supports only Text.text and chart.data while preserving synthetic call identity', async () => {
  const { findNode, screenCalls, service } = createServiceHarness()
  await service.upsert(
    semanticCall('data.upsert', 'upsert-series', {
      schemaVersion: 1,
      descriptor: { schemaVersion: 1, id: 'series-1', kind: 'static', value: [{ value: 1 }] },
    }),
  )

  const valid = [
    ['text-1', 'text'],
    ['bar-1', 'data'],
    ['line-1', 'data'],
  ]
  for (const [index, [nodeId, field]] of valid.entries()) {
    const call = semanticCall(
      'data.bind',
      `bind-${index + 1}`,
      { schemaVersion: 1, nodeId, field, binding: { sourceId: 'series-1' } },
      `revision-${index + 10}`,
    )
    await service.bind(call)
    const translated = screenCalls.at(-1)
    assert.equal(translated.capability, 'screen.applyChangeSet')
    assert.equal(translated.callId, call.callId)
    assert.equal(translated.expectedRevision, call.expectedRevision)
    assert.deepEqual(translated.arguments.operations[0], {
      opId: `data-bind:${nodeId}:${field}`,
      type: 'set',
      nodeId,
      fieldId: 'dataBindings',
      value: { schemaVersion: 1, fields: { [field]: { sourceId: 'series-1' } } },
    })
    assert.deepEqual(findNode(nodeId).props.dataBindings, translated.arguments.operations[0].value)
  }

  for (const [nodeId, field] of [
    ['text-1', 'data'],
    ['bar-1', 'text'],
    ['line-1', 'text'],
    ['image-1', 'text'],
  ]) {
    const before = screenCalls.length
    await assert.rejects(
      service.bind(
        semanticCall('data.bind', `invalid-${nodeId}-${field}`, {
          schemaVersion: 1,
          nodeId,
          field,
          binding: { sourceId: 'series-1' },
        }),
      ),
      error => error instanceof DashboardDataCapabilityError && error.code === 'DATA_BINDING_UNSUPPORTED',
    )
    assert.equal(screenCalls.length, before)
  }
  await assert.rejects(
    service.bind(
      semanticCall('data.bind', 'missing-source', {
        schemaVersion: 1,
        nodeId: 'text-1',
        field: 'text',
        binding: { sourceId: 'missing-1' },
      }),
    ),
    error => error instanceof DashboardDataCapabilityError && error.code === 'DATA_SOURCE_NOT_FOUND',
  )
  await assert.rejects(
    service.bind(
      semanticCall('data.bind', 'dangerous-node', {
        schemaVersion: 1,
        nodeId: '__proto__',
        field: 'text',
        binding: { sourceId: 'series-1' },
      }),
    ),
    DashboardDataCapabilityError,
  )
})

test('legacy datasource id collisions reject before any durable Screen write', async () => {
  for (const fixture of [
    { projectDataSource: { list: [{ id: 'legacy-1', type: 'fetch' }] } },
    { rootDataSource: { list: [{ id: 'legacy-1', type: 'fetch' }] } },
  ]) {
    const { screenCalls, service } = createServiceHarness(fixture)
    await assert.rejects(
      service.upsert(
        semanticCall('data.upsert', 'legacy-conflict', {
          schemaVersion: 1,
          descriptor: { schemaVersion: 1, id: 'legacy-1', kind: 'static', value: 1 },
        }),
      ),
      error =>
        error instanceof DashboardDataCapabilityError &&
        error.code === 'DATA_SOURCE_CONFLICT' &&
        error.reason === 'source-id-conflicts-with-legacy-data-source',
    )
    assert.equal(screenCalls.length, 0)
  }
})
