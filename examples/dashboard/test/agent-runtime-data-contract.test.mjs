import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DashboardDataCapabilityError,
  applySafeDataTransform,
  createDashboardSameOriginDataResolver,
  parseSafeDataBinding,
  parseSafeDataBindings,
  parseSafeDataCatalog,
  parseSafeDataDescriptor,
} from '../src/editor/agent/capabilities/data/contract.mjs'

const jsonResponse = (value, { contentType = 'application/json; charset=utf-8', ok = true } = {}) => ({
  ok,
  headers: { get: name => (name.toLowerCase() === 'content-type' ? contentType : null) },
  text: async () => JSON.stringify(value),
})

const isDataError = (error, code, reason) => {
  assert.equal(error instanceof DashboardDataCapabilityError, true)
  if (code) assert.equal(error.code, code)
  if (reason) assert.equal(error.reason, reason)
  return true
}

test('safe data descriptors accept only the four exact frozen declaration shapes', () => {
  const literalPayload = {
    source: 'literal-source-key-is-data',
    dataHandler: 'literal keys inside static JSON are not executable hooks',
    expression: 'function () { return "still only a string" }',
  }
  const fixtures = [
    { schemaVersion: 1, id: 'static-1', kind: 'static', value: literalPayload },
    { schemaVersion: 1, id: 'mock-1', kind: 'mock', fixture: [literalPayload] },
    {
      schemaVersion: 1,
      id: 'public-1',
      kind: 'public-http-json',
      request: { url: 'https://example.test/data', method: 'GET' },
    },
    {
      schemaVersion: 1,
      id: 'credentialed-1',
      kind: 'credentialed-http-json',
      providerId: 'provider-1',
      credentialRef: 'credential-ref-1',
      request: { url: 'https://example.test/private', method: 'POST', body: { query: 'safe' } },
    },
  ]

  const parsed = fixtures.map(value => parseSafeDataDescriptor(value))
  assert.deepEqual(
    parsed.map(descriptor => descriptor.kind),
    ['static', 'mock', 'public-http-json', 'credentialed-http-json'],
  )
  assert.deepEqual(parsed[0].value, literalPayload)
  assert.equal(Object.isFrozen(parsed[0]), true)
  assert.equal(Object.isFrozen(parsed[0].value), true)
  assert.deepEqual(
    parseSafeDataCatalog({ schemaVersion: 1, sources: [fixtures[1], fixtures[0]] }).sources.map(x => x.id),
    ['mock-1', 'static-1'],
  )

  for (const forbidden of ['dataHandler', 'errorHandler', 'expression', 'requestHandler', 'shouldFetch', 'willFetch']) {
    assert.throws(
      () => parseSafeDataDescriptor({ ...fixtures[0], [forbidden]: 'not-allowed-at-the-descriptor-boundary' }),
      error => isDataError(error, 'INVALID_DATA_DESCRIPTOR', 'fields-must-match-contract'),
      forbidden,
    )
  }
  assert.throws(
    () =>
      parseSafeDataDescriptor({
        ...fixtures[2],
        request: { ...fixtures[2].request, headers: { authorization: 'must-not-enter-the-contract' } },
      }),
    error => isDataError(error, 'INVALID_DATA_DESCRIPTOR', 'fields-must-match-contract'),
  )
  assert.throws(
    () => parseSafeDataDescriptor({ ...fixtures[0], transform: [{ op: 'expression', value: 'return secret' }] }),
    error => isDataError(error, 'INVALID_DATA_DESCRIPTOR', 'unsupported-transform-operation'),
  )

  let getterCalls = 0
  const accessor = { ...fixtures[0] }
  Object.defineProperty(accessor, 'willFetch', {
    enumerable: true,
    get() {
      getterCalls += 1
      return () => undefined
    },
  })
  assert.throws(() => parseSafeDataDescriptor(accessor), DashboardDataCapabilityError)
  assert.equal(getterCalls, 0)

  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(
    () => parseSafeDataDescriptor({ ...fixtures[0], value: cyclic }),
    error => isDataError(error, 'INVALID_DATA_DESCRIPTOR', 'cyclic-json-is-not-allowed'),
  )
  assert.throws(() => parseSafeDataDescriptor({ ...fixtures[0], id: '__proto__' }), DashboardDataCapabilityError)
  assert.throws(() => parseSafeDataDescriptor({ ...fixtures[0], id: 'unsafe id' }), DashboardDataCapabilityError)
  assert.throws(() => parseSafeDataBinding({ sourceId: 'constructor' }), DashboardDataCapabilityError)
})

test('public browser descriptors are GET-only and lexically reject obvious local, IP, link-local, and metadata targets', () => {
  const descriptor = request => ({ schemaVersion: 1, id: 'public-guard', kind: 'public-http-json', request })
  for (const request of [
    { url: 'https://example.test/data', method: 'POST' },
    { url: 'https://example.test/data', method: 'GET', body: { forbidden: true } },
  ]) {
    assert.throws(() => parseSafeDataDescriptor(descriptor(request)), DashboardDataCapabilityError)
  }

  for (const url of [
    'https://localhost/data',
    'https://service.local/data',
    'https://127.0.0.1/data',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/data',
    'https://metadata.google.internal/computeMetadata/v1',
    'https://metadata/latest',
  ]) {
    assert.throws(
      () => parseSafeDataDescriptor(descriptor({ url, method: 'GET' })),
      error => isDataError(error, 'INVALID_DATA_DESCRIPTOR', 'public-request-destination-is-not-public'),
      url,
    )
  }

  assert.throws(
    () => parseSafeDataDescriptor(descriptor({ url: 'http://public.example/data', method: 'GET' })),
    error => isDataError(error, 'INVALID_DATA_DESCRIPTOR', 'public-request-must-use-https'),
  )

  assert.equal(
    parseSafeDataDescriptor(descriptor({ url: 'https://public.example/data', method: 'GET' })).request.method,
    'GET',
  )
  assert.equal(
    parseSafeDataDescriptor({
      schemaVersion: 1,
      id: 'credentialed-private-target',
      kind: 'credentialed-http-json',
      providerId: 'provider-1',
      credentialRef: 'vault-1',
      request: { url: 'http://127.0.0.1/private', method: 'POST', body: { query: 'proxied' } },
    }).request.method,
    'POST',
  )
})

test('closed transforms and bindings are deterministic, exact, and budgeted', () => {
  const rows = [
    { name: 'alpha', score: 2, nested: { value: 'A' } },
    { name: 'beta', score: 3, nested: { value: 'B' } },
    { name: 'gamma', score: 3, nested: { value: 'C' } },
    { name: 'delta', score: 1, nested: { value: 'D' } },
  ]
  const transform = [
    { op: 'filter', path: ['score'], operator: 'gte', value: 2 },
    { op: 'sort', path: ['score'], direction: 'desc' },
    { op: 'project', fields: { label: ['name'], value: ['nested', 'value'] } },
    { op: 'take', count: 2 },
  ]
  assert.deepEqual(applySafeDataTransform(rows, transform), [
    { label: 'beta', value: 'B' },
    { label: 'gamma', value: 'C' },
  ])
  assert.deepEqual(
    applySafeDataTransform({ payload: [1, 2, 3] }, [
      { op: 'select', path: ['payload'] },
      { op: 'limit', count: 2 },
    ]),
    [1, 2],
  )

  assert.deepEqual(
    parseSafeDataBindings({
      schemaVersion: 1,
      fields: {
        data: { sourceId: 'series-1', transform: [{ op: 'take', count: 20 }] },
        text: { sourceId: 'summary-1' },
      },
    }),
    {
      schemaVersion: 1,
      fields: {
        data: { sourceId: 'series-1', transform: [{ op: 'take', count: 20 }] },
        text: { sourceId: 'summary-1' },
      },
    },
  )
  assert.throws(
    () => parseSafeDataBindings({ schemaVersion: 1, fields: { src: { sourceId: 'series-1' } } }),
    error => isDataError(error, 'INVALID_DATA_DESCRIPTOR', 'fields-must-match-contract'),
  )
  assert.throws(
    () => applySafeDataTransform(rows, [{ op: 'sort', path: ['score'] }], { limits: { maxRows: 2 } }),
    error => isDataError(error, 'DATA_BUDGET_EXCEEDED', 'row-budget-exceeded'),
  )
  let clock = 0
  assert.throws(
    () =>
      applySafeDataTransform(rows, [{ op: 'take', count: 1 }], {
        limits: { timeoutMs: 5 },
        now: () => (clock += 10),
      }),
    error => isDataError(error, 'DATA_BUDGET_EXCEEDED', 'transform-time-budget-exceeded'),
  )
})

test('maxRows applies to nested data arrays before selection or preview can hide them', async () => {
  const nested = { payload: { items: Array.from({ length: 501 }, (_, index) => index) } }
  assert.throws(
    () =>
      parseSafeDataDescriptor({
        schemaVersion: 1,
        id: 'nested-static',
        kind: 'static',
        value: nested,
        transform: [{ op: 'select', path: ['payload'] }],
      }),
    error => isDataError(error, 'DATA_BUDGET_EXCEEDED', 'row-budget-exceeded'),
  )

  const resolver = createDashboardSameOriginDataResolver({ fetchImpl: async () => jsonResponse(nested) })
  await assert.rejects(
    resolver.resolve({
      schemaVersion: 1,
      id: 'nested-public',
      kind: 'public-http-json',
      request: { url: 'https://public.example/data', method: 'GET' },
      transform: [{ op: 'select', path: ['payload'] }],
    }),
    error => isDataError(error, 'DATA_BUDGET_EXCEEDED', 'row-budget-exceeded'),
  )

  assert.throws(
    () =>
      parseSafeDataDescriptor({
        schemaVersion: 1,
        id: 'cumulative-nested-static',
        kind: 'static',
        value: { a: Array(300).fill(1), b: Array(300).fill(2) },
      }),
    error => isDataError(error, 'DATA_BUDGET_EXCEEDED', 'row-budget-exceeded'),
  )
})

test('same-origin resolver returns transformed data once and keeps credential proxy envelopes out of materials', async () => {
  const staticResolver = createDashboardSameOriginDataResolver({
    fetchImpl: async () => assert.fail('unexpected fetch'),
  })
  const once = await staticResolver.resolve({
    schemaVersion: 1,
    id: 'static-once',
    kind: 'static',
    value: { payload: { payload: 'double-transform-would-leak-this', total: 42 } },
    transform: [{ op: 'select', path: ['payload'] }],
  })
  assert.deepEqual(once, { payload: 'double-transform-would-leak-this', total: 42 })

  const publicCalls = []
  const publicResolver = createDashboardSameOriginDataResolver({
    fetchImpl: async (url, options) => {
      publicCalls.push({ url, options })
      return jsonResponse({ payload: [{ value: 1 }, { value: 2 }] })
    },
  })
  assert.deepEqual(
    await publicResolver.resolve({
      schemaVersion: 1,
      id: 'public-1',
      kind: 'public-http-json',
      request: { url: 'https://example.test/data', method: 'GET' },
      transform: [
        { op: 'select', path: ['payload'] },
        { op: 'take', count: 1 },
      ],
    }),
    [{ value: 1 }],
  )
  assert.equal(publicCalls[0].url, 'https://example.test/data')
  assert.equal(publicCalls[0].options.credentials, 'omit')

  const proxyCalls = []
  const credentialedResolver = createDashboardSameOriginDataResolver({
    fetchImpl: async (url, options) => {
      proxyCalls.push({ url, options })
      return jsonResponse({
        schemaVersion: 1,
        data: { payload: { payload: 'double-transform-would-return-this', total: 7 } },
        diagnostics: { status: 200, rows: 1, bytes: 64, durationMs: 3, providerId: 'provider-1' },
      })
    },
  })
  const credentialed = await credentialedResolver.resolve(
    {
      schemaVersion: 1,
      id: 'credentialed-1',
      kind: 'credentialed-http-json',
      providerId: 'provider-1',
      credentialRef: 'vault-ref-1',
      request: { url: 'https://private.example.test/data', method: 'POST', body: { query: 'safe' } },
      transform: [{ op: 'select', path: ['payload'] }],
    },
    { projectId: 'project-1' },
  )
  assert.deepEqual(credentialed, { payload: 'double-transform-would-return-this', total: 7 })
  assert.equal(Object.hasOwn(credentialed, 'schemaVersion'), false)
  assert.equal(Object.hasOwn(credentialed, 'diagnostics'), false)
  assert.equal(proxyCalls[0].url, '/api/data/credentialed-json')
  assert.deepEqual(JSON.parse(proxyCalls[0].options.body), {
    schemaVersion: 1,
    projectId: 'project-1',
    providerId: 'provider-1',
    credentialRef: 'vault-ref-1',
    url: 'https://private.example.test/data',
    method: 'POST',
    body: { query: 'safe' },
  })
  assert.deepEqual(Object.keys(proxyCalls[0].options.headers), ['content-type'])
})

test('credential resolver fails closed on malformed or mismatched success envelopes', async () => {
  const descriptor = {
    schemaVersion: 1,
    id: 'credentialed-1',
    kind: 'credentialed-http-json',
    providerId: 'provider-1',
    credentialRef: 'vault-ref-1',
    request: { url: 'https://private.example.test/data', method: 'GET' },
  }
  const validDiagnostics = { status: 200, rows: 1, bytes: 16, durationMs: 1, providerId: 'provider-1' }
  for (const envelope of [
    { schemaVersion: 1, data: [1], diagnostics: validDiagnostics, extra: true },
    { schemaVersion: 1, data: [1], diagnostics: { ...validDiagnostics, secret: 'leak' } },
    { schemaVersion: 1, data: [1], diagnostics: { ...validDiagnostics, providerId: 'provider-2' } },
    { schemaVersion: 1, data: [1], diagnostics: { ...validDiagnostics, status: 199 } },
  ]) {
    const resolver = createDashboardSameOriginDataResolver({ fetchImpl: async () => jsonResponse(envelope) })
    await assert.rejects(resolver.resolve(descriptor, { projectId: 'project-1' }), error =>
      isDataError(error, 'DATA_RESOLUTION_FAILED'),
    )
  }

  const nonJson = createDashboardSameOriginDataResolver({
    fetchImpl: async () => jsonResponse({ schemaVersion: 1 }, { contentType: 'text/html' }),
  })
  await assert.rejects(nonJson.resolve(descriptor, { projectId: 'project-1' }), error =>
    isDataError(error, 'DATA_RESOLUTION_FAILED', 'resolver-response-must-be-json'),
  )
})
