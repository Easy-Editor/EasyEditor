import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ONLINE_COMPONENT_DEPENDENCY_ROUTE,
  createOnlineComponentDependencyHandler,
} from '../server/online-components/index.mjs'

const REGISTRY_ORIGIN = 'https://registry.example.test'
const CDN_ORIGIN = 'https://cdn.example.test'
const REQUEST_ORIGIN = 'https://dashboard.example.test'
const PACKAGE_NAME = '@scope/chart-card'
const SOURCE = 'export default function Component() { return null }'

const config = {
  registryOrigins: [REGISTRY_ORIGIN],
  cdnOrigins: [CDN_ORIGIN],
  cacheDir: '/tmp/easy-editor-online-component-semver-unused',
  limits: { maxMetadataBytes: 4096, maxBundleBytes: 8192, maxRedirects: 2, timeoutMs: 100 },
}

const proxyRequest = range => ({
  method: 'POST',
  path: ONLINE_COMPONENT_DEPENDENCY_ROUTE,
  headers: { 'content-type': 'application/json', origin: REQUEST_ORIGIN },
  expectedOrigins: [REQUEST_ORIGIN],
  body: JSON.stringify({ package: PACKAGE_NAME, range }),
})

const response = (request, body, contentType) => ({
  url: request.url.href,
  remoteAddress: '93.184.216.34',
  status: 200,
  headers: { 'content-type': contentType },
  body: Buffer.from(body),
})

const metadataResponse = (request, exactVersion) =>
  response(
    request,
    JSON.stringify({
      exactVersion,
      bundleUrl: `${CDN_ORIGIN}/${PACKAGE_NAME}@${exactVersion}/index.mjs`,
      format: 'bundled-esm',
      installScripts: false,
    }),
    'application/json',
  )

const createMemoryCache = () => {
  const records = new Map()
  const keyFor = (packageName, range) => `${packageName}\0${range}`
  return {
    records,
    async read(packageName, range) {
      return structuredClone(records.get(keyFor(packageName, range)) ?? null)
    },
    async write(packageName, range, record) {
      records.set(keyFor(packageName, range), structuredClone(record))
      return structuredClone(record)
    },
  }
}

const createHarness = ({ exactVersion, cache = createMemoryCache(), offline = false } = {}) => {
  let transportCalls = 0
  const handler = createOnlineComponentDependencyHandler({
    config,
    cache,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    transport: async request => {
      transportCalls += 1
      if (offline) throw new Error('offline')
      return request.kind === 'registry'
        ? metadataResponse(request, exactVersion)
        : response(request, SOURCE, 'text/javascript')
    },
  })
  return { cache, handler, transportCalls: () => transportCalls }
}

test('ordinary stable ranges reject prerelease releases and invalid numeric prerelease identifiers', async () => {
  for (const exactVersion of ['1.3.0-alpha.1', '1.2.0-01']) {
    const harness = createHarness({ exactVersion })
    const result = await harness.handler.handle(proxyRequest('^1.2.0'))
    assert.equal(result.status, 502, exactVersion)
    assert.equal(result.body.error.code, 'upstream-response-invalid', exactVersion)
    assert.equal(harness.cache.records.size, 0, exactVersion)
  }

  const invalidRange = createHarness({ exactVersion: '1.2.0-alpha.1' })
  const result = await invalidRange.handler.handle(proxyRequest('^1.2.0-01'))
  assert.equal(result.status, 400)
  assert.equal(result.body.error.code, 'invalid-request')
  assert.equal(invalidRange.transportCalls(), 0)
})

test('core numeric identifiers remain distinct above Number.MAX_SAFE_INTEGER', async () => {
  const collisions = [
    ['9007199254740993.0.0', '9007199254740992.0.0'],
    ['1.9007199254740993.0', '1.9007199254740992.0'],
    ['1.0.9007199254740993', '1.0.9007199254740992'],
  ]

  for (const [exactVersion, range] of collisions) {
    const harness = createHarness({ exactVersion })
    const result = await harness.handler.handle(proxyRequest(range))
    assert.equal(result.status, 502, `${exactVersion} must not satisfy ${range}`)
    assert.equal(result.body.error.code, 'upstream-response-invalid')
    assert.equal(harness.cache.records.size, 0)
  }
})

test('range upper bounds increment arbitrarily large core numeric identifiers without precision loss', async () => {
  const acceptedVersions = [
    ['9007199254740992.0.0', '^9007199254740992.0.0'],
    ['1.9007199254740992.0', '~1.9007199254740992.0'],
    ['0.0.9007199254740992', '^0.0.9007199254740992'],
  ]

  for (const [exactVersion, range] of acceptedVersions) {
    const harness = createHarness({ exactVersion })
    const result = await harness.handler.handle(proxyRequest(range))
    assert.equal(result.status, 200, `${exactVersion} must satisfy ${range}`)
    assert.equal(result.body.dependency.exactVersion, exactVersion)
  }
})

test('numeric prerelease identifiers use arbitrary-precision ordering', async () => {
  const lower = createHarness({ exactVersion: '1.0.0-9007199254740992' })
  const rejected = await lower.handler.handle(proxyRequest('>1.0.0-9007199254740993 <1.0.0'))
  assert.equal(rejected.status, 502)
  assert.equal(rejected.body.error.code, 'upstream-response-invalid')

  const higher = createHarness({ exactVersion: '1.0.0-9007199254740993' })
  const accepted = await higher.handler.handle(proxyRequest('>1.0.0-9007199254740992 <1.0.0'))
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.dependency.exactVersion, '1.0.0-9007199254740993')
})

test('explicit prerelease ranges admit prereleases only on the comparator tuple and preserve cache parity', async () => {
  const cache = createMemoryCache()
  const matching = createHarness({ exactVersion: '1.2.0-beta.1', cache })
  const accepted = await matching.handler.handle(proxyRequest('>=1.2.0-alpha.1 <2.0.0'))
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.dependency.exactVersion, '1.2.0-beta.1')
  assert.equal(accepted.body.dependency.cached, false)

  const offline = createHarness({ cache, offline: true })
  const recovered = await offline.handler.handle(proxyRequest('>=1.2.0-alpha.1 <2.0.0'))
  assert.equal(recovered.status, 200)
  assert.equal(recovered.body.dependency.exactVersion, '1.2.0-beta.1')
  assert.equal(recovered.body.dependency.cached, true)

  const differentTuple = createHarness({ exactVersion: '1.3.0-alpha.1' })
  const rejected = await differentTuple.handler.handle(proxyRequest('>=1.2.0-alpha.1 <2.0.0'))
  assert.equal(rejected.status, 502)
  assert.equal(rejected.body.error.code, 'upstream-response-invalid')
})

test('cached records use the same prerelease exclusion as live metadata', async () => {
  const cache = createMemoryCache()
  const online = createHarness({ exactVersion: '1.2.3', cache })
  assert.equal((await online.handler.handle(proxyRequest('^1.2.0'))).status, 200)

  const [key] = cache.records.keys()
  cache.records.get(key).exactVersion = '1.3.0-alpha.1'

  const offline = createHarness({ cache, offline: true })
  const result = await offline.handler.handle(proxyRequest('^1.2.0'))
  assert.equal(result.status, 409)
  assert.equal(result.body.error.code, 'dependency-lock-drift')
  assert.equal(offline.transportCalls(), 0)
})
