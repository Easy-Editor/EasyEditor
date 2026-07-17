import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DASHBOARD_CAPABILITY_DESCRIPTORS,
  DASHBOARD_CAPABILITY_ERROR_CODE,
  DASHBOARD_CAPABILITY_NAMES,
  DASHBOARD_CAPABILITY_REGISTRY_HASH,
  DASHBOARD_CAPABILITY_REGISTRY_REVISION,
  DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT,
  DASHBOARD_FUTURE_CAPABILITY_UNAVAILABLE_REASON,
  DashboardCapabilityRegistryError,
  assertDashboardCapabilityAvailable,
  dashboardCapabilityRegistry,
  describeDashboardCapability,
  getDashboardCapabilityDescriptor,
  getDashboardCapabilityRegistrySnapshot,
  listDashboardCapabilities,
} from '../src/editor/agent/capabilities/index.mjs'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const readRepositoryFile = relativePath => readFile(new URL(relativePath, `file://${repositoryRoot}/`), 'utf8')

const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

const registryHash = descriptors =>
  `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(descriptors)))
    .digest('hex')}`

const describeRequest = capability => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  capability,
})

const expectedCapabilityNames = [
  'artifact.createOnline',
  'artifact.promoteLocal',
  'artifact.reviseOnline',
  'data.bind',
  'data.inspect',
  'data.preview',
  'data.upsert',
  'material.describe',
  'material.search',
  'project.checkpoint',
  'screen.applyChangeSet',
  'screen.inspect',
  'task.compensate',
]

test('Dashboard capability catalog is finite, ordered, immutable, and hash-addressed', () => {
  assert.deepEqual(DASHBOARD_CAPABILITY_NAMES, expectedCapabilityNames)
  assert.deepEqual(
    DASHBOARD_CAPABILITY_DESCRIPTORS.map(descriptor => descriptor.capability),
    expectedCapabilityNames,
  )
  assert.equal(DASHBOARD_CAPABILITY_REGISTRY_REVISION, 'dashboard-capability-registry/3')
  assert.equal(DASHBOARD_CAPABILITY_REGISTRY_HASH, registryHash(DASHBOARD_CAPABILITY_DESCRIPTORS))
  assert.match(DASHBOARD_CAPABILITY_REGISTRY_HASH, /^sha256:[a-f0-9]{64}$/)
  assert.equal(Object.isFrozen(DASHBOARD_CAPABILITY_DESCRIPTORS), true)
  assert.equal(Object.isFrozen(DASHBOARD_CAPABILITY_DESCRIPTORS[0]), true)
  assert.equal(Object.isFrozen(DASHBOARD_CAPABILITY_DESCRIPTORS[0].input), true)
  assert.deepEqual(JSON.parse(JSON.stringify(DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT)), {
    schemaVersion: 1,
    revision: DASHBOARD_CAPABILITY_REGISTRY_REVISION,
    hash: DASHBOARD_CAPABILITY_REGISTRY_HASH,
    capabilities: DASHBOARD_CAPABILITY_DESCRIPTORS,
  })
  assert.equal(getDashboardCapabilityRegistrySnapshot(), DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT)
  assert.equal(dashboardCapabilityRegistry.snapshot(), DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT)
  assert.equal(listDashboardCapabilities(), DASHBOARD_CAPABILITY_DESCRIPTORS)
})

test('Phase 5 publishes bounded data declarations beside the existing semantic capabilities', () => {
  const available = DASHBOARD_CAPABILITY_DESCRIPTORS.filter(descriptor => descriptor.availability === 'available').map(
    descriptor => descriptor.capability,
  )
  assert.deepEqual(available, [
    'data.bind',
    'data.inspect',
    'data.preview',
    'data.upsert',
    'material.describe',
    'material.search',
    'screen.applyChangeSet',
    'screen.inspect',
    'task.compensate',
  ])

  for (const descriptor of DASHBOARD_CAPABILITY_DESCRIPTORS) {
    if (descriptor.availability === 'available') {
      assert.equal(Object.hasOwn(descriptor, 'unavailableReason'), false)
      assert.equal(assertDashboardCapabilityAvailable(descriptor.capability), descriptor)
      continue
    }

    assert.equal(descriptor.unavailableReason, DASHBOARD_FUTURE_CAPABILITY_UNAVAILABLE_REASON)
    assert.throws(
      () => assertDashboardCapabilityAvailable(descriptor.capability),
      error =>
        error instanceof DashboardCapabilityRegistryError &&
        error.code === DASHBOARD_CAPABILITY_ERROR_CODE.unavailable &&
        error.capability === descriptor.capability &&
        error.reason === DASHBOARD_FUTURE_CAPABILITY_UNAVAILABLE_REASON,
    )
  }
})

test('describeCapability returns exact revisioned JSON schemas without availability metadata', async () => {
  for (const capability of DASHBOARD_CAPABILITY_NAMES) {
    const descriptor = getDashboardCapabilityDescriptor(capability)
    const schema = await describeDashboardCapability(describeRequest(capability))
    assert.deepEqual(Object.keys(schema).sort(), ['capability', 'input', 'output', 'revision', 'schemaVersion'])
    assert.deepEqual(schema, {
      schemaVersion: 1,
      capability,
      revision: descriptor.revision,
      input: descriptor.input,
      output: descriptor.output,
    })
    assert.equal(schema.input.type, 'object')
    assert.equal(schema.input.additionalProperties, false)
    assert.equal(schema.output.type, 'object')
    assert.equal(schema.output.additionalProperties, false)
    assert.equal(Object.isFrozen(schema), true)
    assert.doesNotThrow(() => structuredClone(schema))
  }

  const materialDescribe = await describeDashboardCapability(describeRequest('material.describe'))
  assert.deepEqual(materialDescribe.input.required, ['componentName'])
  assert.deepEqual(Object.keys(materialDescribe.input.properties), ['componentName'])

  const screenWrite = await describeDashboardCapability(describeRequest('screen.applyChangeSet'))
  assert.equal(screenWrite.revision, 'screen.applyChangeSet/1')
  assert.deepEqual(screenWrite.input.required, ['schemaVersion', 'documentId', 'operations'])
  assert.equal(screenWrite.input.properties.operations.minItems, 1)
  assert.equal(screenWrite.input.properties.operations.maxItems, 100)
  assert.equal(screenWrite.input.properties.operations.items.oneOf.length, 7)
  assert.deepEqual(
    screenWrite.input.properties.operations.items.oneOf.map(operation => operation.properties.type.const),
    ['set', 'unset', 'resize', 'insert', 'move', 'reorder', 'remove'],
  )

  const compensate = await describeDashboardCapability(describeRequest('task.compensate'))
  assert.equal(compensate.revision, 'task.compensate/1')
  assert.deepEqual(compensate.input.required, ['schemaVersion', 'targetTaskId'])
  assert.equal(compensate.input.additionalProperties, false)

  const dataUpsert = await describeDashboardCapability(describeRequest('data.upsert'))
  assert.equal(dataUpsert.revision, 'data.upsert/1')
  assert.deepEqual(dataUpsert.input.required, ['schemaVersion', 'descriptor'])
  const credentialed = dataUpsert.input.properties.descriptor.oneOf.find(
    descriptor => descriptor.properties.kind.const === 'credentialed-http-json',
  )
  const publicHttp = dataUpsert.input.properties.descriptor.oneOf.find(
    descriptor => descriptor.properties.kind.const === 'public-http-json',
  )
  assert.deepEqual(credentialed.required, ['schemaVersion', 'id', 'kind', 'providerId', 'credentialRef', 'request'])
  assert.deepEqual(Object.keys(credentialed.properties.request.properties), ['url', 'method', 'body'])
  assert.equal(credentialed.properties.request.additionalProperties, false)
  assert.deepEqual(Object.keys(publicHttp.properties.request.properties), ['url', 'method'])
  assert.equal(publicHttp.properties.request.properties.method.const, 'GET')
  assert.equal(publicHttp.properties.request.additionalProperties, false)

  const dataInspect = await describeDashboardCapability(describeRequest('data.inspect'))
  const dataPreview = await describeDashboardCapability(describeRequest('data.preview'))
  assert.deepEqual(dataInspect.output.required, ['schemaVersion', 'scope', 'sources'])
  assert.deepEqual(dataPreview.output.required, ['schemaVersion', 'scope', 'source', 'preview'])
  for (const output of [dataInspect.output, dataPreview.output]) {
    assert.deepEqual(output.properties.scope.required, ['kind', 'documentId'])
    assert.equal(output.properties.scope.properties.kind.const, 'page')
  }
})

test('unknown names and malformed describe requests reject with typed stable errors', async () => {
  assert.throws(
    () => getDashboardCapabilityDescriptor('screen.rawCommand'),
    error => {
      assert.equal(error instanceof DashboardCapabilityRegistryError, true)
      assert.deepEqual(error.toJSON(), {
        schemaVersion: 1,
        code: 'UNKNOWN_CAPABILITY',
        capability: 'screen.rawCommand',
        reason: 'unknown-capability',
      })
      return true
    },
  )

  await assert.rejects(
    describeDashboardCapability(describeRequest('screen.rawCommand')),
    error =>
      error instanceof DashboardCapabilityRegistryError && error.code === DASHBOARD_CAPABILITY_ERROR_CODE.unknown,
  )

  for (const invalidRequest of [
    null,
    {},
    { ...describeRequest('screen.inspect'), extra: true },
    { ...describeRequest('screen.inspect'), schemaVersion: 2 },
    { ...describeRequest('screen.inspect'), projectId: '' },
  ]) {
    await assert.rejects(
      describeDashboardCapability(invalidRequest),
      error =>
        error instanceof DashboardCapabilityRegistryError &&
        error.code === DASHBOARD_CAPABILITY_ERROR_CODE.invalidRequest,
    )
  }
})

test('catalog DTOs expose opaque credential references but no executable hooks, headers, engines, or secrets', async () => {
  const serializedCatalog = JSON.stringify(DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT)
  assert.match(serializedCatalog, /credentialRef/)
  for (const forbidden of [
    'callback',
    'command',
    'dataHandler',
    'engine',
    'errorHandler',
    'headers',
    'requestHandler',
    'secret',
    'shouldFetch',
    'willFetch',
  ]) {
    assert.doesNotMatch(serializedCatalog, new RegExp(forbidden, 'i'))
  }

  const source = await readRepositoryFile('examples/dashboard/src/editor/agent/capabilities/registry.mjs')
  assert.doesNotMatch(source, /@easy-editor\/core|packages\/core|\.\.\/\.\.\/\.\.\/\.\.\/packages\/core/)
  assert.doesNotMatch(source, /process\.env|import\.meta\.env|localStorage|sessionStorage/)
})
