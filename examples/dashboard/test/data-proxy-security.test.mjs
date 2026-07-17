import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import test from 'node:test'

import { DataProxyError } from '../server/data/errors.mjs'
import {
  authorizeDestination,
  compileProviderPolicy,
  createCredentialRegistry,
  createDataProxyHandler,
  createEnvironmentDataProxyHandler,
  createEnvironmentDataProxyMiddleware,
  createHttpOnlySessionPrincipalAuthorizer,
  createNodeDataProxyMiddleware,
  isEnvironmentDataProxyEnabled,
  isForbiddenAddress,
} from '../server/data/index.mjs'

const SECRET = 'provider-secret-that-must-not-leak'
const ORIGIN = 'https://api.example.test'

const policyInput = (overrides = {}) => ({
  scheme: 'https:',
  origin: ORIGIN,
  port: 443,
  pathPrefix: '/v1',
  methods: ['GET', 'POST'],
  headerTemplate: { Authorization: 'Bearer {{secret}}', 'X-Provider': 'dashboard' },
  redirect: { enabled: false, maxHops: 0 },
  limits: { maxRequestBytes: 1024, maxResponseBytes: 1024, maxRows: 3, timeoutMs: 100 },
  ...overrides,
})

const binding = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  projectId: 'project-1',
  providerId: 'provider-1',
  credentialRef: 'credential-1',
}

const requestBody = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  providerId: 'provider-1',
  credentialRef: 'credential-1',
  url: `${ORIGIN}/v1/metrics`,
  method: 'GET',
  ...overrides,
})

const proxyRequest = body => ({
  method: 'POST',
  path: '/api/data/credentialed-json',
  headers: { 'content-type': 'application/json', origin: 'https://dashboard.example.test' },
  expectedOrigins: ['https://dashboard.example.test'],
  body: JSON.stringify(body),
})

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]
const jsonResponse = (data, overrides = {}) => ({
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: Buffer.from(JSON.stringify(data)),
  ...overrides,
})

const createHarness = ({
  authorizePrincipal = async () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
  registry = createCredentialRegistry([{ ...binding, secret: SECRET, policy: policyInput() }]),
  lookup = publicLookup,
  transport = async () => jsonResponse([{ value: 1 }]),
  logger,
  monotonicNow,
  now,
  totalTimeoutMs,
} = {}) =>
  createDataProxyHandler({
    authorizePrincipal,
    credentialRegistry: registry,
    lookup,
    transport,
    logger,
    monotonicNow,
    now,
    totalTimeoutMs,
  })

test('IP policy rejects non-public, metadata, mapped, and compatible addresses', () => {
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '100.100.100.200',
    '127.0.0.1',
    '168.63.129.16',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '192.88.99.1',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:8.8.8.8',
    '::192.168.1.1',
    '::ffff:0:a9fe:a9fe',
    '64:ff9b:1::a9fe:a9fe',
    '100::1',
    '2001:0000:4136:e378:8000:63bf:3fff:fdd2',
    '2001:2::1',
    '2001:10::1',
    '2001:20::1',
    '2002:a9fe:a9fe::1',
    '2001:db8::1',
    '3fff::1',
    '5f00::1',
    '2620:4f:8000::1',
  ]) {
    assert.equal(isForbiddenAddress(address), true, address)
  }
  assert.equal(isForbiddenAddress('93.184.216.34'), false)
  assert.equal(isForbiddenAddress('2606:4700:4700::1111'), false)
})

test('provider policy binds scheme, origin, port, path, method, headers, and canonical paths', () => {
  const policy = compileProviderPolicy(policyInput())
  assert.equal(authorizeDestination(policy, `${ORIGIN}/v1/metrics`, 'GET').pathname, '/v1/metrics')
  for (const [url, method] of [
    ['http://api.example.test/v1/metrics', 'GET'],
    ['https://attacker.example/v1/metrics', 'GET'],
    [`${ORIGIN}:444/v1/metrics`, 'GET'],
    [`${ORIGIN}/v10/metrics`, 'GET'],
    [`${ORIGIN}/v1/metrics`, 'DELETE'],
    [`${ORIGIN}/v1/%2e%2e/admin`, 'GET'],
    [`${ORIGIN}/v1/%252e%252e/admin`, 'GET'],
    [`${ORIGIN}/v1/%252fadmin`, 'GET'],
    [`${ORIGIN}/v1/metrics#fragment`, 'GET'],
    ['https://user:password@api.example.test/v1/metrics', 'GET'],
    [`${ORIGIN}/v1/metrics%0d%0aX-Evil:true`, 'GET'],
  ]) {
    assert.throws(
      () => authorizeDestination(policy, url, method),
      error => error.code === 'destination-denied',
    )
  }
  assert.throws(
    () => compileProviderPolicy(policyInput({ headerTemplate: { Connection: '{{secret}}' } })),
    error => error.code === 'credential-unavailable',
  )
  assert.throws(
    () => compileProviderPolicy(policyInput({ headerTemplate: { Authorization: 'Bearer {{secret}}\r\nX-Evil: yes' } })),
    error => error.code === 'credential-unavailable',
  )
})

test('strict request contract rejects client headers, cross-origin calls, and GET bodies', async () => {
  const handler = createHarness()
  for (const request of [
    proxyRequest({ ...requestBody(), headers: { Authorization: `Bearer ${SECRET}` } }),
    proxyRequest(requestBody({ body: { injected: true } })),
    { ...proxyRequest(requestBody()), headers: { 'content-type': 'application/json', origin: 'https://evil.example' } },
    {
      ...proxyRequest(requestBody()),
      headers: { 'content-type': 'text/plain', origin: 'https://dashboard.example.test' },
    },
  ]) {
    const result = await handler.handle(request)
    assert.notEqual(result.status, 200)
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET))
  }
})

test('success uses server headers, pins checked DNS address, and returns the exact envelope', async () => {
  let lookupCalls = 0
  let nowValue = 10
  const handler = createHarness({
    lookup: async () => {
      lookupCalls += 1
      return lookupCalls === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]
    },
    now: () => {
      const value = nowValue
      nowValue += 7
      return value
    },
    transport: async options => {
      assert.deepEqual(Object.keys(options.headers).sort(), ['accept', 'authorization', 'x-provider'])
      assert.equal(options.headers.authorization, `Bearer ${SECRET}`)
      const pinned = await new Promise((resolve, reject) => {
        options.lookup('api.example.test', {}, (error, address, family) =>
          error ? reject(error) : resolve({ address, family }),
        )
      })
      assert.deepEqual(pinned, { address: '93.184.216.34', family: 4 })
      return jsonResponse([{ value: 1 }, { value: 2 }])
    },
  })
  const result = await handler.handle(proxyRequest(requestBody()))
  assert.equal(lookupCalls, 1)
  assert.deepEqual(result, {
    status: 200,
    body: {
      schemaVersion: 1,
      data: [{ value: 1 }, { value: 2 }],
      diagnostics: { status: 200, rows: 2, bytes: 25, durationMs: 7, providerId: 'provider-1' },
    },
  })
})

test('POST serializes only JSON body and uses only server-owned outbound headers', async () => {
  const handler = createHarness({
    transport: async options => {
      assert.deepEqual(JSON.parse(options.body.toString('utf8')), { filter: { region: 'north' } })
      assert.equal(options.headers['content-type'], 'application/json')
      assert.equal(options.headers.authorization, `Bearer ${SECRET}`)
      assert.equal(options.headers['x-client-authorization'], undefined)
      return jsonResponse({ items: [{ value: 1 }] })
    },
  })
  const result = await handler.handle(
    proxyRequest(requestBody({ method: 'POST', body: { filter: { region: 'north' } } })),
  )
  assert.equal(result.status, 200)
  assert.equal(result.body.diagnostics.rows, 1)
})

test('destination and private-address checks happen before secret access', async () => {
  const policy = compileProviderPolicy(policyInput())
  let reads = 0
  const registry = {
    async resolveBinding() {
      return { handle: 'opaque', policy }
    },
    async readSecret() {
      reads += 1
      return SECRET
    },
  }
  const mismatch = createHarness({ registry })
  const mismatchResult = await mismatch.handle(
    proxyRequest(requestBody({ url: 'https://attacker.example/v1/metrics' })),
  )
  assert.equal(mismatchResult.body.error.code, 'destination-denied')
  assert.equal(reads, 0)

  const privateTarget = createHarness({ registry, lookup: async () => [{ address: '169.254.169.254', family: 4 }] })
  const privateResult = await privateTarget.handle(proxyRequest(requestBody()))
  assert.equal(privateResult.body.error.code, 'destination-denied')
  assert.equal(reads, 0)
})

test('credential registry denies provider/cross-project mismatches and applies revocation immediately', async () => {
  const registry = createCredentialRegistry([{ ...binding, secret: SECRET, policy: policyInput() }])
  const handler = createHarness({ registry })
  assert.equal(
    (await handler.handle(proxyRequest(requestBody({ providerId: 'provider-2' })))).body.error.code,
    'credential-unavailable',
  )
  assert.equal(
    (await handler.handle(proxyRequest(requestBody({ projectId: 'project-2' })))).body.error.code,
    'credential-unavailable',
  )
  assert.equal((await handler.handle(proxyRequest(requestBody()))).status, 200)
  registry.revoke(binding)
  assert.equal((await handler.handle(proxyRequest(requestBody()))).body.error.code, 'credential-unavailable')
})

test('redirects default off and enabled redirects revalidate every destination before sending a secret', async () => {
  let requests = 0
  const redirectResponse = {
    status: 302,
    headers: { location: `${ORIGIN}/v1/next` },
    body: Buffer.alloc(0),
  }
  const disabled = createHarness({
    transport: async () => {
      requests += 1
      return redirectResponse
    },
  })
  assert.equal((await disabled.handle(proxyRequest(requestBody()))).body.error.code, 'destination-denied')
  assert.equal(requests, 1)

  let dnsCalls = 0
  requests = 0
  const enabledRegistry = createCredentialRegistry([
    {
      ...binding,
      secret: SECRET,
      policy: policyInput({ redirect: { enabled: true, maxHops: 2 } }),
    },
  ])
  const enabled = createHarness({
    registry: enabledRegistry,
    lookup: async () => {
      dnsCalls += 1
      return [{ address: dnsCalls === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]
    },
    transport: async () => {
      requests += 1
      return redirectResponse
    },
  })
  assert.equal((await enabled.handle(proxyRequest(requestBody()))).body.error.code, 'destination-denied')
  assert.equal(dnsCalls, 2)
  assert.equal(requests, 1)
})

test('credential revocation is revalidated before every redirect hop', async () => {
  const registry = createCredentialRegistry([
    {
      ...binding,
      secret: SECRET,
      policy: policyInput({ redirect: { enabled: true, maxHops: 2 } }),
    },
  ])
  let requests = 0
  const handler = createHarness({
    registry,
    transport: async () => {
      requests += 1
      registry.revoke(binding)
      return {
        status: 307,
        headers: { location: `${ORIGIN}/v1/next` },
        body: Buffer.alloc(0),
      }
    },
  })
  const result = await handler.handle(proxyRequest(requestBody()))
  assert.equal(result.body.error.code, 'credential-unavailable')
  assert.equal(requests, 1)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET))
})

test('content type, bytes, rows, invalid JSON, upstream status, and total deadline are enforced', async () => {
  const cases = [
    [jsonResponse({}, { headers: { 'content-type': 'text/html' } }), 'upstream-response-invalid'],
    [jsonResponse('x'.repeat(2000)), 'upstream-response-invalid'],
    [jsonResponse([1, 2, 3, 4]), 'upstream-response-invalid'],
    [jsonResponse({ payload: { items: [1, 2, 3, 4] } }), 'upstream-response-invalid'],
    [
      { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{') },
      'upstream-response-invalid',
    ],
    [jsonResponse({}, { status: 500 }), 'upstream-failed'],
  ]
  for (const [response, code] of cases) {
    const result = await createHarness({ transport: async () => response }).handle(proxyRequest(requestBody()))
    assert.equal(result.body.error.code, code)
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET))
  }

  const slowLookup = createHarness({
    registry: createCredentialRegistry([
      { ...binding, secret: SECRET, policy: policyInput({ limits: { ...policyInput().limits, timeoutMs: 10 } }) },
    ]),
    lookup: async () =>
      new Promise(resolve => setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 40)),
  })
  assert.equal((await slowLookup.handle(proxyRequest(requestBody()))).body.error.code, 'upstream-timeout')
  await new Promise(resolve => setTimeout(resolve, 50))
})

test('credentialed JSON rejects malformed UTF-8 without reflecting upstream or decoder details', async () => {
  const upstreamMarker = 'malformed-utf8-upstream-marker'
  const malformedBody = Buffer.concat([
    Buffer.from(`{"marker":"${upstreamMarker}`),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ])
  const result = await createHarness({
    transport: async () => ({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: malformedBody,
    }),
  }).handle(proxyRequest(requestBody()))

  assert.deepEqual(result, {
    status: 502,
    body: {
      schemaVersion: 1,
      error: {
        code: 'upstream-response-invalid',
        message: 'Upstream response was rejected',
        retryable: false,
      },
    },
  })
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, new RegExp(upstreamMarker))
  assert.doesNotMatch(serialized, new RegExp(SECRET))
  assert.doesNotMatch(serialized, /�|encoded data|utf-?8|decoder|typeerror/i)
})

test('request abort and total deadline cover hung authorization and binding work', async () => {
  let authorizationCalls = 0
  const alreadyAborted = new AbortController()
  alreadyAborted.abort(new Error(SECRET))
  const alreadyAbortedRequest = proxyRequest(requestBody())
  alreadyAbortedRequest.signal = alreadyAborted.signal
  const alreadyAbortedResult = await createHarness({
    authorizePrincipal: async () => {
      authorizationCalls += 1
      return { tenantId: 'tenant-1', userId: 'user-1' }
    },
  }).handle(alreadyAbortedRequest)
  assert.equal(alreadyAbortedResult.body.error.code, 'request-aborted')
  assert.equal(authorizationCalls, 0)

  const hungAuthorization = createHarness({
    authorizePrincipal: async () => new Promise(() => {}),
    totalTimeoutMs: 10,
  })
  assert.equal((await hungAuthorization.handle(proxyRequest(requestBody()))).body.error.code, 'upstream-timeout')

  const hungBinding = createHarness({
    registry: {
      async resolveBinding() {
        return new Promise(() => {})
      },
      async readSecret() {
        return SECRET
      },
    },
    totalTimeoutMs: 10,
  })
  assert.equal((await hungBinding.handle(proxyRequest(requestBody()))).body.error.code, 'upstream-timeout')

  const abortController = new AbortController()
  const abortedRequest = proxyRequest(requestBody())
  abortedRequest.signal = abortController.signal
  const abortedResult = createHarness({
    authorizePrincipal: async () => new Promise(() => {}),
    totalTimeoutMs: 1000,
  }).handle(abortedRequest)
  setTimeout(() => abortController.abort(new Error(SECRET)), 5)
  assert.equal((await abortedResult).body.error.code, 'request-aborted')
})

test('bounded reflection scan rejects common literal, encoded, transformed, and fragmented forms', async () => {
  const unicodeEscaped = [...SECRET]
    .map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .join('')
  const percentBytes = [...Buffer.from(SECRET)].map(byte => `%${byte.toString(16).padStart(2, '0')}`).join('')
  const base64Secret = Buffer.from(SECRET).toString('base64')
  const secretBytes = [...Buffer.from(SECRET)]
  const secretCharacters = [...SECRET]
  const splitAt = Math.floor(SECRET.length / 2)
  const base64SplitAt = Math.floor(base64Secret.length / 2)
  const headerValue = `Bearer ${SECRET}`
  const reservedSecret = 'Case/Sensitive?token=AbC&scope=read'
  const probes = [
    { secret: SECRET, response: jsonResponse({ echo: SECRET }) },
    {
      secret: SECRET,
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(`{"echo":"${unicodeEscaped}"}`),
      },
    },
    { secret: SECRET, response: jsonResponse({ nested: { echo: base64Secret } }) },
    { secret: SECRET, response: jsonResponse({ nested: { echo: Buffer.from(SECRET).toString('base64url') } }) },
    { secret: SECRET, response: jsonResponse({ nested: { echo: Buffer.from(SECRET).toString('hex') } }) },
    { secret: SECRET, response: jsonResponse({ nested: { echo: percentBytes } }) },
    { secret: SECRET, response: jsonResponse({ nested: { bytes: secretBytes } }) },
    { secret: SECRET, response: jsonResponse({ nested: { characters: secretCharacters } }) },
    {
      secret: SECRET,
      response: jsonResponse({ first: SECRET.slice(0, splitAt), second: SECRET.slice(splitAt) }),
    },
    {
      secret: SECRET,
      response: jsonResponse({
        first: base64Secret.slice(0, base64SplitAt),
        second: base64Secret.slice(base64SplitAt),
      }),
    },
    {
      secret: SECRET,
      response: jsonResponse({ first: secretBytes.slice(0, splitAt), second: secretBytes.slice(splitAt) }),
    },
    {
      secret: SECRET,
      response: jsonResponse({ first: secretCharacters.slice(0, splitAt), second: secretCharacters.slice(splitAt) }),
    },
    {
      secret: SECRET,
      response: jsonResponse({ [SECRET.slice(0, splitAt)]: null, [SECRET.slice(splitAt)]: null }),
    },
    { secret: SECRET, response: jsonResponse({ echo: Buffer.from(headerValue).toString('base64') }) },
    {
      secret: SECRET,
      response: jsonResponse({
        echo: Buffer.from(JSON.stringify({ headers: { authorization: headerValue } })).toString('base64url'),
      }),
    },
    { secret: SECRET, response: jsonResponse({ echo: SECRET.toUpperCase() }) },
    {
      secret: reservedSecret,
      response: jsonResponse({ echo: encodeURIComponent(encodeURIComponent(reservedSecret)) }),
    },
  ]
  for (const { secret, response } of probes) {
    const registry = createCredentialRegistry([{ ...binding, secret, policy: policyInput() }])
    const events = []
    const result = await createHarness({
      registry,
      logger: { info: event => events.push(event), warn: event => events.push(event) },
      transport: async () => response,
    }).handle(proxyRequest(requestBody()))
    assert.equal(result.body.error.code, 'upstream-response-invalid')
    assert.doesNotMatch(
      JSON.stringify([result, events]),
      new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    )
  }
})

test('reflection scan fails closed when its bounded work budget is exhausted', async () => {
  const largeValue = Object.fromEntries(Array.from({ length: 50_100 }, (_, index) => [`field-${index}`, null]))
  const registry = createCredentialRegistry([
    {
      ...binding,
      secret: SECRET,
      policy: policyInput({
        limits: { ...policyInput().limits, maxResponseBytes: 4 * 1024 * 1024, maxRows: 10_000 },
      }),
    },
  ])
  const result = await createHarness({ registry, transport: async () => jsonResponse(largeValue) }).handle(
    proxyRequest(requestBody()),
  )
  assert.equal(result.body.error.code, 'upstream-response-invalid')
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET))
})

test('Node middleware returns the typed retryable 408 envelope before closing a stalled inbound body', async t => {
  let handlerCalls = 0
  const middleware = createNodeDataProxyMiddleware({
    inboundTimeoutMs: 30,
    handler: {
      async handle() {
        handlerCalls += 1
        return { status: 200, body: { schemaVersion: 1, data: null } }
      },
    },
  })
  const server = createServer((request, response) => {
    void middleware(request, response, () => response.writeHead(404).end())
  })
  await listen(server)
  t.after(() => close(server))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const socket = connect(address.port, '127.0.0.1')
  t.after(() => socket.destroy())
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  const closed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('stalled request socket was not closed')), 1000)
    socket.once('close', () => {
      clearTimeout(timeout)
      resolve()
    })
    socket.on('error', error => {
      if (error.code !== 'ECONNRESET') reject(error)
    })
  })
  const responseChunks = []
  socket.on('data', chunk => responseChunks.push(chunk))
  const startedAt = Date.now()
  socket.write(
    [
      'POST /api/data/credentialed-json HTTP/1.1',
      `Host: 127.0.0.1:${address.port}`,
      `Origin: http://127.0.0.1:${address.port}`,
      'Content-Type: application/json',
      'Content-Length: 4096',
      'Connection: keep-alive',
      '',
      '{"schemaVersion":1',
    ].join('\r\n'),
  )
  await closed
  assert.ok(Date.now() - startedAt < 500)
  assert.equal(handlerCalls, 0)
  const rawResponse = Buffer.concat(responseChunks).toString('utf8')
  const [headers, body] = rawResponse.split('\r\n\r\n')
  assert.match(headers, /^HTTP\/1\.1 408 /)
  assert.match(headers, /Connection: close/i)
  assert.deepEqual(JSON.parse(body), {
    schemaVersion: 1,
    error: { code: 'request-aborted', message: 'Request was aborted', retryable: true },
  })
})

test('Node middleware returns the typed non-retryable 413 envelope for an oversized inbound body', async t => {
  let handlerCalls = 0
  const middleware = createNodeDataProxyMiddleware({
    handler: {
      async handle() {
        handlerCalls += 1
        return { status: 200, body: { schemaVersion: 1, data: null } }
      },
    },
  })
  const server = createServer((request, response) => {
    void middleware(request, response, () => response.writeHead(404).end())
  })
  await listen(server)
  t.after(() => close(server))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  const response = await fetch(`${origin}/api/data/credentialed-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: 'x'.repeat(128 * 1024 + 1),
  })

  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    error: { code: 'invalid-request', message: 'Request is invalid', retryable: false },
  })
  assert.equal(handlerCalls, 0)
})

/*
 * Registered providers remain a trust boundary: arbitrary bespoke reversible transforms cannot be
 * proven absent generically. The bounded scan above fails closed for common accidental reflection
 * forms without claiming a universal non-exfiltration proof.
 */

test('logs and errors are redacted even when upstream throws a secret-bearing error', async () => {
  const events = []
  const logger = { info: event => events.push(event), warn: event => events.push(event) }
  const handler = createHarness({
    logger,
    transport: async () => {
      throw new Error(`failed at ${ORIGIN} using ${SECRET} and credential-1`)
    },
  })
  const result = await handler.handle(proxyRequest(requestBody()))
  assert.equal(result.body.error.code, 'upstream-failed')
  const serialized = JSON.stringify([result, events])
  assert.doesNotMatch(serialized, /provider-secret-that-must-not-leak|credential-1|api\.example\.test/)
})

test('injected typed errors are canonicalized instead of reflecting attacker-controlled messages', async () => {
  const events = []
  const handler = createHarness({
    logger: { info: event => events.push(event), warn: event => events.push(event) },
    transport: async () => {
      throw new DataProxyError('destination-denied', 403, `reflected ${SECRET}`)
    },
  })
  const result = await handler.handle(proxyRequest(requestBody()))
  assert.deepEqual(result.body.error, {
    code: 'destination-denied',
    message: 'Destination is not allowed',
    retryable: false,
  })
  assert.doesNotMatch(JSON.stringify([result, events]), new RegExp(SECRET))
})

test('environment handler is fail-closed without a configured principal and registry', async () => {
  const handler = createEnvironmentDataProxyHandler({ env: {}, lookup: publicLookup })
  const result = await handler.handle(proxyRequest(requestBody()))
  assert.equal(result.body.error.code, 'unauthorized')
})

test('environment configuration still keeps provider credentials server-side', async () => {
  const env = {
    EASY_EDITOR_DATA_PROXY_CONFIG_JSON: JSON.stringify({
      auth: {
        mode: 'bearer',
        principals: [
          {
            tenantId: binding.tenantId,
            userId: binding.userId,
            token: 'dashboard-session-token',
            projectIds: ['project-1'],
          },
        ],
      },
      credentials: [{ ...binding, secret: SECRET, policy: policyInput() }],
    }),
  }
  const handler = createEnvironmentDataProxyHandler({
    env,
    lookup: publicLookup,
    transport: async options => {
      assert.equal(options.headers.authorization, `Bearer ${SECRET}`)
      return jsonResponse({ ok: true })
    },
  })
  const request = proxyRequest(requestBody())
  request.headers.authorization = 'Bearer dashboard-session-token'
  const result = await handler.handle(request)
  assert.equal(result.status, 200)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET))
})

test('environment cookie-session mode authorizes only an opaque session bound to the requested project', async () => {
  const sessionToken = 'opaque-dashboard-session-token'
  const env = {
    EASY_EDITOR_DATA_PROXY_CONFIG_JSON: JSON.stringify({
      auth: {
        mode: 'cookie-session',
        cookieName: '__Host-easy-editor-session',
        sessions: [
          {
            token: 'different-session-token',
            tenantId: 'tenant-2',
            userId: 'user-2',
            projectIds: ['project-2'],
          },
          {
            token: sessionToken,
            tenantId: binding.tenantId,
            userId: binding.userId,
            projectIds: ['project-1'],
          },
        ],
      },
      credentials: [{ ...binding, secret: SECRET, policy: policyInput() }],
    }),
  }
  const handler = createEnvironmentDataProxyHandler({
    env,
    lookup: publicLookup,
    transport: async options => {
      assert.equal(options.headers.cookie, undefined)
      assert.equal(options.headers.authorization, `Bearer ${SECRET}`)
      return jsonResponse({ ok: true })
    },
  })
  const request = proxyRequest(requestBody())
  request.headers.cookie = `__Host-easy-editor-session=${sessionToken}`
  assert.equal((await handler.handle(request)).status, 200)

  const wrongProject = proxyRequest(requestBody({ projectId: 'project-2' }))
  wrongProject.headers.cookie = `__Host-easy-editor-session=${sessionToken}`
  assert.equal((await handler.handle(wrongProject)).body.error.code, 'unauthorized')

  const unknown = proxyRequest(requestBody())
  unknown.headers.cookie = '__Host-easy-editor-session=unknown-session-token'
  assert.equal((await handler.handle(unknown)).body.error.code, 'unauthorized')
})

test('environment auth requires an explicit supported mode and non-empty session configuration', async () => {
  const configurations = [
    {},
    { auth: { sessions: [] } },
    { auth: { mode: 'cookie-session', sessions: [] } },
    {
      auth: {
        mode: 'cookie-session',
        sessions: [
          { token: 'duplicate', tenantId: 'tenant-1', userId: 'user-1', projectIds: ['project-1'] },
          { token: 'duplicate', tenantId: 'tenant-1', userId: 'user-1', projectIds: ['project-1'] },
        ],
      },
    },
    { auth: { mode: 'unsupported' } },
    {
      auth: {
        mode: 'cookie-session',
        sessions: [{ token: 'duplicate', tenantId: 'tenant-1', userId: 'user-1', projectIds: ['project-1'] }],
      },
      unexpected: true,
    },
  ]
  for (const configuration of configurations) {
    const handler = createEnvironmentDataProxyHandler({
      env: {
        EASY_EDITOR_DATA_PROXY_CONFIG_JSON: JSON.stringify({
          ...configuration,
          credentials: [{ ...binding, secret: SECRET, policy: policyInput() }],
        }),
      },
      lookup: publicLookup,
      transport: async () => jsonResponse({ ok: true }),
    })
    const request = proxyRequest(requestBody())
    request.headers.cookie = 'easy-editor-session=duplicate'
    assert.equal((await handler.handle(request)).body.error.code, 'unauthorized')
  }
})

test('shared environment middleware gate is default-off and enabled only by the exact opt-in value', async () => {
  assert.equal(isEnvironmentDataProxyEnabled({}), false)
  assert.equal(isEnvironmentDataProxyEnabled({ EASY_EDITOR_DATA_PROXY_ENABLED: 'true' }), false)
  assert.equal(isEnvironmentDataProxyEnabled({ EASY_EDITOR_DATA_PROXY_ENABLED: '1' }), true)

  let nextCalls = 0
  let handlerCalls = 0
  const middleware = createEnvironmentDataProxyMiddleware({
    env: {},
    handler: {
      async handle() {
        handlerCalls += 1
        return { status: 200, body: { schemaVersion: 1, data: null } }
      },
    },
  })
  const handled = await middleware({}, {}, () => {
    nextCalls += 1
  })
  assert.equal(handled, false)
  assert.equal(nextCalls, 1)
  assert.equal(handlerCalls, 0)
})

test('same-origin HttpOnly session adapter resolves an opaque server session and defaults fail-closed', async () => {
  const sessionId = 'opaque-session-id-that-is-not-a-principal'
  const events = []
  let resolverCalls = 0
  const env = {
    EASY_EDITOR_DATA_PROXY_CONFIG_JSON: JSON.stringify({
      auth: { mode: 'external-session', cookieName: 'easy-editor-session' },
      credentials: [{ ...binding, secret: SECRET, policy: policyInput() }],
    }),
  }
  const handler = createEnvironmentDataProxyHandler({
    env,
    logger: { info: event => events.push(event), warn: event => events.push(event) },
    lookup: publicLookup,
    resolveSessionPrincipal: async input => {
      resolverCalls += 1
      assert.deepEqual(input, { sessionId, projectId: 'project-1' })
      return { tenantId: 'tenant-1', userId: 'user-1', projectIds: ['project-1'] }
    },
    transport: async options => {
      assert.equal(options.headers.cookie, undefined)
      assert.equal(options.headers.authorization, `Bearer ${SECRET}`)
      return jsonResponse({ ok: true })
    },
  })
  const request = proxyRequest(requestBody())
  request.headers.cookie = `easy-editor-session=${sessionId}`
  const result = await handler.handle(request)
  assert.equal(result.status, 200)
  assert.equal(resolverCalls, 1)
  assert.doesNotMatch(JSON.stringify([result, events]), new RegExp(sessionId))

  const duplicate = proxyRequest(requestBody())
  duplicate.headers.cookie = `easy-editor-session=${sessionId}; easy-editor-session=${sessionId}`
  assert.equal((await handler.handle(duplicate)).body.error.code, 'unauthorized')
  assert.equal(resolverCalls, 1)

  const crossOrigin = proxyRequest(requestBody())
  crossOrigin.headers.origin = 'https://evil.example'
  crossOrigin.headers.cookie = `easy-editor-session=${sessionId}`
  assert.equal((await handler.handle(crossOrigin)).body.error.code, 'invalid-request')
  assert.equal(resolverCalls, 1)

  const disabled = createHttpOnlySessionPrincipalAuthorizer()
  await assert.rejects(
    () => disabled({ headers: { cookie: `easy-editor-session=${sessionId}` }, projectId: 'project-1' }),
    error => error.code === 'unauthorized',
  )
})

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const close = server => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))

test('Node middleware enforces the same strict handler contract used by production and Vite', async t => {
  const handler = createHarness({ now: () => 0 })
  const productionMiddleware = createNodeDataProxyMiddleware({ handler })
  const viteMiddleware = createNodeDataProxyMiddleware({ handler })
  const createAdapterServer = middleware =>
    createServer((request, response) => {
      void middleware(request, response, () => response.writeHead(404).end())
    })
  const servers = [createAdapterServer(productionMiddleware), createAdapterServer(viteMiddleware)]
  await Promise.all(servers.map(listen))
  t.after(() => Promise.all(servers.map(close)))

  const responses = []
  for (const server of servers) {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const response = await fetch(`${origin}/api/data/credentialed-json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(requestBody()),
    })
    responses.push({ status: response.status, body: await response.json() })
  }
  assert.deepEqual(responses[0], responses[1])
  assert.equal(responses[0].status, 200)

  const address = servers[0].address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  const crossOrigin = await fetch(`${origin}/api/data/credentialed-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify(requestBody()),
  })
  assert.equal(crossOrigin.status, 403)
})

test('Vite dev server and production server are wired to the shared data proxy implementation', async () => {
  const [viteConfig, productionServer] = await Promise.all([
    readFile(new URL('../vite.config.mts', import.meta.url), 'utf8'),
    readFile(new URL('../server/index.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(viteConfig, /createEnvironmentDataProxyMiddleware/)
  assert.match(viteConfig, /createDashboardViteConfig/)
  assert.match(viteConfig, /server\.middlewares\.use/)
  assert.match(productionServer, /createEnvironmentDataProxyMiddleware/)
  assert.match(productionServer, /dataProxyOptions\.lookup/)
  assert.match(productionServer, /handler:\s*dataProxyHandler/)
  assert.doesNotMatch(viteConfig, /proxy:\s*\{/)
})
