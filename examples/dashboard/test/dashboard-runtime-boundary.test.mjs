import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import test from 'node:test'

import { assertCommittedPackageIdentity } from '../src/editor/remote/committed-package-identity.js'
import { GlobalExportClaims } from '../src/editor/remote/global-export-claims.js'
import { LatestOperationRegistry, SingleFlight } from '../src/editor/remote/keyed-operation-coordinator.js'
import { OwnedGlobalBindings } from '../src/editor/remote/owned-global-bindings.js'
import { closeOwnedSocket, removeOwnedNodeForSettlement } from '../src/editor/remote/owned-resource-cleanup.js'
import { settleRemotePackageLoads } from '../src/editor/remote/remote-load-batch.js'
import { RemoteResourceScope } from '../src/editor/remote/resource-scope.js'
import { RetryableDisposal } from '../src/editor/remote/retryable-disposal.js'

const dashboardRoot = new URL('..', import.meta.url).pathname
const sourceRoot = join(dashboardRoot, 'src')
const forbiddenFacadeNames = [
  'defaultEngine',
  'init',
  'loadingState',
  'materials',
  'plugins',
  'project',
  'resourceRegistry',
  'setters',
]

const walk = async directory => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(entry => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? walk(path) : [path]
    }),
  )
  return files.flat()
}

test('remote resource scope is cold, authorizes before effects, and disposes owned resources once', async () => {
  const requests = []
  let effects = 0
  let timerFired = false
  let nodeRemovals = 0
  let socketCloses = 0
  const scope = new RemoteResourceScope(request => requests.push(request))

  assert.equal(requests.length, 0, 'cold construction must not authorize or start remote work')
  assert.throws(() => scope.perform({ name: 'cold', type: 'fetch' }, () => effects++), /scope is created/)

  scope.activate()
  const operation = scope.beginOperation('late completion test')
  scope.perform({ name: 'allowed', type: 'fetch', url: 'https://example.test' }, () => effects++)
  scope.ownNode({ remove: () => nodeRemovals++ })
  scope.ownSocket({ close: () => socketCloses++ })
  scope.setTimer(() => {
    timerFired = true
  }, 5)

  assert.equal(effects, 1)
  assert.deepEqual(requests, [{ name: 'allowed', type: 'fetch', url: 'https://example.test' }])

  const disposal = scope.dispose()
  assert.strictEqual(scope.dispose(), disposal)
  await disposal
  await new Promise(resolve => setTimeout(resolve, 10))

  assert.equal(operation.abortController.signal.aborted, true)
  assert.throws(() => scope.assertCurrent(operation), /completed after/)
  assert.equal(nodeRemovals, 1)
  assert.equal(socketCloses, 1)
  assert.equal(timerFired, false)
})

test('remote resource scope reports cleanup failures and retries only retained resources', async () => {
  const calls = { flakyNode: 0, flakySocket: 0, stableNode: 0, stableSocket: 0 }
  let shouldFail = true
  const scope = new RemoteResourceScope(() => {})
  scope.activate()
  scope.ownNode({
    remove() {
      calls.flakyNode++
      if (shouldFail) throw new Error('node removal failed')
    },
  })
  scope.ownNode({
    remove() {
      calls.stableNode++
    },
  })
  scope.ownSocket({
    close() {
      calls.flakySocket++
      if (shouldFail) throw new Error('socket close failed')
    },
  })
  scope.ownSocket({
    close() {
      calls.stableSocket++
    },
  })

  const failedAttempt = scope.dispose()
  assert.strictEqual(scope.dispose(), failedAttempt)
  await assert.rejects(failedAttempt, error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.errors.length, 2)
    return true
  })
  assert.deepEqual(calls, { flakyNode: 1, flakySocket: 1, stableNode: 1, stableSocket: 1 })

  shouldFail = false
  const retry = scope.dispose()
  assert.notStrictEqual(retry, failedAttempt)
  await retry
  assert.deepEqual(calls, { flakyNode: 2, flakySocket: 2, stableNode: 1, stableSocket: 1 })
  assert.throws(() => scope.activate(), /scope is disposed/)
})

test('owned socket cleanup retains failed ownership while disposal continues and retries', async () => {
  let closeAttempts = 0
  let stableCleanup = 0
  const scope = new RemoteResourceScope(() => {})
  const socket = {
    close() {
      closeAttempts++
      if (closeAttempts <= 2) throw new Error('socket close failed')
    },
  }
  scope.activate()
  scope.ownSocket(socket)
  const disposal = new RetryableDisposal([
    { name: 'scope', run: () => scope.dispose() },
    { name: 'localSocket', run: () => closeOwnedSocket(scope, socket) },
    { name: 'stableCleanup', run: () => stableCleanup++ },
  ])

  await assert.rejects(disposal.dispose(), /Retryable disposal completed with errors/)
  assert.deepEqual({ closeAttempts, stableCleanup }, { closeAttempts: 2, stableCleanup: 1 })

  await disposal.dispose()
  assert.deepEqual({ closeAttempts, stableCleanup }, { closeAttempts: 4, stableCleanup: 1 })
  await scope.dispose()
  assert.equal(closeAttempts, 4, 'successful close must release scope ownership')
})

test('owned node removal failure rejects settlement and remains owned for retry', async () => {
  let removals = 0
  const scope = new RemoteResourceScope(() => {})
  const node = {
    remove() {
      removals++
      if (removals === 1) throw new Error('node remove failed')
    },
  }
  scope.activate()
  scope.ownNode(node)
  const loadError = new Error('script load failed')
  const settlement = new Promise((resolve, reject) => {
    const error = removeOwnedNodeForSettlement(scope, node, loadError)
    if (error !== undefined) reject(error)
    else resolve()
  })

  await assert.rejects(settlement, error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(
      error.errors.map(item => item.message),
      ['script load failed', 'node remove failed'],
    )
    return true
  })
  assert.equal(removals, 1)

  await scope.dispose()
  assert.equal(removals, 2)
})

test('remote package batch results retain package identity and normalized errors', async () => {
  const configs = [
    { package: '@scope/material-a', version: '1.0.0', globalName: 'MaterialA' },
    { package: '@scope/material-b', globalName: 'MaterialB' },
  ]
  const result = await settleRemotePackageLoads(configs, config => {
    if (config.package.endsWith('material-b')) throw new Error('registry unavailable')
    return Promise.resolve()
  })

  assert.deepEqual(
    { total: result.total, succeeded: result.succeeded, failed: result.failed },
    { total: 2, succeeded: 1, failed: 1 },
  )
  assert.equal(result.failures[0].package, '@scope/material-b')
  assert.equal(result.failures[0].version, 'latest')
  assert.equal(result.failures[0].globalName, 'MaterialB')
  assert.match(result.failures[0].error.message, /registry unavailable/)
})

test('committed remote packages reject non-atomic version or global replacement', () => {
  const committed = { version: '1.0.0', globalName: 'MaterialV1' }
  assert.doesNotThrow(() =>
    assertCommittedPackageIdentity(
      'Material',
      { packageName: '@scope/material', version: '1.0.0', globalName: 'MaterialV1' },
      committed,
    ),
  )
  assert.throws(
    () =>
      assertCommittedPackageIdentity(
        'Material',
        { packageName: '@scope/material', version: '2.0.0', globalName: 'MaterialV1' },
        committed,
      ),
    /non-atomic replacement with 2\.0\.0 \(MaterialV1\) is not allowed/,
  )
  assert.throws(
    () =>
      assertCommittedPackageIdentity(
        'Setter',
        { packageName: '@scope/setters', version: '1.0.0', globalName: 'SettersV2' },
        { version: '1.0.0', globalName: 'SettersV1' },
      ),
    /non-atomic replacement with 1\.0\.0 \(SettersV2\) is not allowed/,
  )
})

test('remote policy denial happens before the requested side effect', () => {
  const scope = new RemoteResourceScope(() => {
    throw new Error('policy denied')
  })
  let effects = 0
  scope.activate()

  assert.throws(
    () => scope.perform({ name: 'blocked', type: 'script', url: 'https://example.test/a.js' }, () => effects++),
    /policy denied/,
  )
  assert.equal(effects, 0)
})

test('host globals are policy-authorized, instance-owned, and removed without clobbering later owners', () => {
  const existingReact = { existing: true }
  const installedReactDOM = { installed: true }
  const installedJsxRuntime = { installed: true }
  const laterReactDOM = { later: true }
  const realm = { React: existingReact }
  const requests = []
  let allow = false
  const bindings = new OwnedGlobalBindings({
    bindings: { React: { replacement: true }, ReactDOM: installedReactDOM, jsxRuntime: installedJsxRuntime },
    realm,
  })

  assert.throws(
    () =>
      bindings.install((request, effect) => {
        requests.push(request)
        if (!allow) throw new Error('policy denied')
        return effect()
      }),
    /policy denied/,
  )
  assert.deepEqual(realm, { React: existingReact })
  assert.deepEqual(requests, [{ name: 'window.ReactDOM', resourceType: 'runtime-global', type: 'registration' }])

  allow = true
  bindings.install((request, effect) => {
    requests.push(request)
    return effect()
  })
  assert.strictEqual(realm.React, existingReact)
  assert.strictEqual(realm.ReactDOM, installedReactDOM)
  assert.strictEqual(realm.jsxRuntime, installedJsxRuntime)

  realm.ReactDOM = laterReactDOM
  bindings.dispose()
  assert.strictEqual(realm.React, existingReact)
  assert.strictEqual(realm.ReactDOM, laterReactDOM)
  assert.equal(Reflect.has(realm, 'jsxRuntime'), false)
})

test('same-realm UMD claims are reserved before insertion and survive owner disposal', async () => {
  const realm = {}
  const createClaims = instanceId => {
    const scope = new RemoteResourceScope(() => {})
    scope.activate()
    return {
      claims: new GlobalExportClaims({ environment: { window: realm }, instanceId, scope }),
      scope,
    }
  }
  const first = createClaims('engine-a')
  const second = createClaims('engine-b')
  const request = { name: 'SharedUMD', type: 'global-claim', resourceType: 'material' }
  const identity = '@scope/material@1.0.0/dist/index.min.js'

  first.claims.prepare('SharedUMD', identity, request)
  first.claims.prepare('SharedUMD', identity, request)
  assert.throws(
    () => first.claims.prepare('SharedUMD', '@scope/material@2.0.0/dist/index.min.js', request),
    /already bound to @scope\/material@1\.0\.0\/dist\/index\.min\.js/,
  )
  assert.throws(() => second.claims.prepare('SharedUMD', identity, request), /reserved by Dashboard engine engine-a/)
  const sameEngineDifferentLoader = createClaims('engine-a')
  assert.throws(
    () => sameEngineDifferentLoader.claims.prepare('SharedUMD', identity, request),
    /reserved by Dashboard engine engine-a/,
  )

  realm.SharedUMD = { meta: true }
  assert.deepEqual(first.claims.read('SharedUMD'), { meta: true })
  await first.scope.dispose()

  const third = createClaims('engine-c')
  assert.throws(() => third.claims.prepare('SharedUMD', identity, request), /reserved by Dashboard engine engine-a/)
  await Promise.all([second.scope.dispose(), sameEngineDifferentLoader.scope.dispose(), third.scope.dispose()])
})

test('same-realm UMD reservations retain only an opaque owner token', async () => {
  const source = await readFile(join(sourceRoot, 'editor/remote/global-export-claims.js'), 'utf8')

  assert.match(source, /#ownerToken\s*=\s*Symbol/)
  assert.match(source, /ownerToken:\s*this\.#ownerToken/)
  assert.doesNotMatch(source, /realmClaims\.set\([^\n]+\{\s*claims:\s*this/)
})

test('late asynchronous completion cannot register after disposal', async () => {
  const scope = new RemoteResourceScope(() => {})
  scope.activate()
  const operation = scope.beginOperation('deferred registration')
  let resolveRemote
  let registrations = 0
  const remoteResult = new Promise(resolve => {
    resolveRemote = resolve
  })
  const completion = remoteResult.then(() => {
    scope.assertCurrent(operation)
    registrations++
  })

  await scope.dispose()
  resolveRemote()

  await assert.rejects(completion, /completed after/)
  assert.equal(registrations, 0)
})

test('URL-keyed operations abort disconnected work and reject older refresh completions', async () => {
  const operations = new LatestOperationRegistry()
  const applied = []
  const deferred = () => {
    let resolve
    const promise = new Promise(next => {
      resolve = next
    })
    return { promise, resolve }
  }
  const run = async (operation, completion, value) => {
    await completion
    operations.assertCurrent(operation)
    applied.push(`${value}:meta`)
    operations.assertCurrent(operation)
    applied.push(`${value}:websocket`)
    operations.finish(operation)
  }

  const independent = operations.begin('http://localhost:2999')

  const disconnectedCompletion = deferred()
  const disconnected = operations.begin('http://localhost:3000')
  assert.equal(independent.signal.aborted, false)
  const disconnectedRun = run(disconnected, disconnectedCompletion.promise, 'disconnected')
  operations.invalidate('http://localhost:3000')
  disconnectedCompletion.resolve()
  await assert.rejects(disconnectedRun, /invalidated/)
  assert.equal(disconnected.signal.aborted, true)
  assert.deepEqual(applied, [])

  const olderCompletion = deferred()
  const newerCompletion = deferred()
  const older = operations.begin('http://localhost:3001')
  const olderRun = run(older, olderCompletion.promise, 'older')
  const newer = operations.begin('http://localhost:3001')
  const newerRun = run(newer, newerCompletion.promise, 'newer')
  operations.finish(older)
  operations.assertCurrent(newer)

  newerCompletion.resolve()
  await newerRun
  olderCompletion.resolve()
  await assert.rejects(olderRun, /invalidated/)
  assert.equal(older.signal.aborted, true)
  assert.deepEqual(applied, ['newer:meta', 'newer:websocket'])
  operations.finish(independent)
})

test('single-flight coalesces same-version work and permits a clean retry', async () => {
  const flights = new SingleFlight()
  let calls = 0
  let registrations = 0
  let resolveFirst
  const task = () => {
    calls++
    return new Promise(resolve => {
      resolveFirst = () => {
        registrations++
        resolve('component')
      }
    })
  }

  const first = flights.run('package@1.0.0', task)
  const joined = flights.run('package@1.0.0', task)
  assert.strictEqual(joined, first)
  await Promise.resolve()
  assert.equal(calls, 1)
  resolveFirst()
  assert.equal(await first, 'component')
  assert.equal(registrations, 1)

  const retried = flights.run('package@1.0.0', async () => {
    calls++
    registrations++
    return 'component-2'
  })
  assert.notStrictEqual(retried, first)
  assert.equal(await retried, 'component-2')
  assert.deepEqual({ calls, registrations }, { calls: 2, registrations: 2 })

  let invalidatedCalls = 0
  const invalidated = flights.run('http://localhost:3000', () => {
    invalidatedCalls++
  })
  flights.forget('http://localhost:3000')
  await assert.rejects(invalidated, /invalidated/)
  assert.equal(invalidatedCalls, 0)

  const failed = flights.run('package@failed', () => {
    throw new Error('load failed')
  })
  assert.strictEqual(
    flights.run('package@failed', () => {
      throw new Error('must not run')
    }),
    failed,
  )
  await assert.rejects(failed, /load failed/)
  assert.equal(await flights.run('package@failed', () => 'recovered'), 'recovered')
})

test('setter identity flights do not merge versions or globals and stale package completions cannot commit', async () => {
  const flights = new SingleFlight()
  const packageOperations = new LatestOperationRegistry()
  const registrations = []
  let calls = 0
  const deferred = () => {
    let resolve
    const promise = new Promise(next => {
      resolve = next
    })
    return { promise, resolve }
  }
  const identityKey = ({ globalName, packageName, version }) =>
    [packageName, version, globalName].map(encodeURIComponent).join('::')
  const load = (identity, completion, value) =>
    flights.run(identityKey(identity), async () => {
      calls++
      const operation = packageOperations.begin(identity.packageName)
      try {
        await completion
        packageOperations.assertCurrent(operation)
        packageOperations.assertCurrent(operation)
        registrations.push(value)
        return value
      } finally {
        packageOperations.finish(operation)
      }
    })

  const versionOneGlobalA = { packageName: '@scope/setters', version: '1.0.0', globalName: 'SettersA' }
  const versionOneGlobalB = { packageName: '@scope/setters', version: '1.0.0', globalName: 'SettersB' }
  const versionTwoGlobalB = { packageName: '@scope/setters', version: '2.0.0', globalName: 'SettersB' }
  const firstCompletion = deferred()
  const differentGlobalCompletion = deferred()
  const latestCompletion = deferred()

  const first = load(versionOneGlobalA, firstCompletion.promise, 'v1-a')
  const joined = load(versionOneGlobalA, Promise.resolve(), 'must-not-run')
  assert.strictEqual(joined, first)
  await Promise.resolve()

  const differentGlobal = load(versionOneGlobalB, differentGlobalCompletion.promise, 'v1-b')
  assert.notStrictEqual(differentGlobal, first)
  await Promise.resolve()

  const latest = load(versionTwoGlobalB, latestCompletion.promise, 'v2-b')
  assert.notStrictEqual(latest, differentGlobal)
  await Promise.resolve()

  latestCompletion.resolve()
  assert.equal(await latest, 'v2-b')
  differentGlobalCompletion.resolve()
  firstCompletion.resolve()
  await assert.rejects(differentGlobal, /invalidated/)
  await assert.rejects(first, /invalidated/)
  assert.deepEqual(registrations, ['v2-b'])
  assert.equal(calls, 3)

  const retry = load(versionOneGlobalA, Promise.resolve(), 'v1-a-retry')
  assert.notStrictEqual(retry, first)
  assert.equal(await retry, 'v1-a-retry')
  assert.deepEqual(registrations, ['v2-b', 'v1-a-retry'])
  assert.equal(calls, 4)

  const disposalCompletion = deferred()
  const disposed = load(versionTwoGlobalB, disposalCompletion.promise, 'must-not-commit-after-dispose')
  await Promise.resolve()
  packageOperations.invalidateAll()
  flights.clear()
  disposalCompletion.resolve()
  await assert.rejects(disposed, /invalidated/)
  assert.deepEqual(registrations, ['v2-b', 'v1-a-retry'])
  assert.equal(calls, 5)
})

test('setter registry commit stays behind the manager latest boundary when a newer load fails', async () => {
  const flights = new SingleFlight()
  const managerOperations = new LatestOperationRegistry()
  const registrations = ['previous-stable-registration']
  const deferred = () => {
    let resolve
    const promise = new Promise(next => {
      resolve = next
    })
    return { promise, resolve }
  }
  const identityKey = ({ globalName, packageName, version }) =>
    [packageName, version, globalName].map(encodeURIComponent).join('::')
  const load = (identity, task) => flights.run(identityKey(identity), task)
  const loadAndRegister = (identity, task) => {
    const operation = managerOperations.begin(identity.packageName)
    return (async () => {
      try {
        const loaded = await load(identity, task)
        managerOperations.assertCurrent(operation)
        managerOperations.assertCurrent(operation)
        registrations.push(loaded)
      } finally {
        managerOperations.finish(operation)
      }
    })()
  }

  const cachedIdentity = { packageName: '@scope/setters', version: '1.0.0', globalName: 'SettersA' }
  const newerIdentity = { packageName: '@scope/setters', version: '2.0.0', globalName: 'SettersB' }
  const newerCompletion = deferred()
  const cachedAttempt = loadAndRegister(cachedIdentity, () => 'cached-v1-a')
  const newerAttempt = loadAndRegister(newerIdentity, async () => {
    await newerCompletion.promise
    throw new Error('newer load failed')
  })

  await assert.rejects(cachedAttempt, /invalidated/)
  newerCompletion.resolve()
  await assert.rejects(newerAttempt, /newer load failed/)
  assert.deepEqual(registrations, ['previous-stable-registration'])
})

test('failed disposal can retry without repeating successful cleanup steps', async () => {
  const calls = { first: 0, flaky: 0, last: 0 }
  let shouldFail = true
  let joinedAttempt
  const disposal = new RetryableDisposal([
    {
      name: 'first',
      run: () => {
        calls.first++
        joinedAttempt = disposal.dispose()
      },
    },
    {
      name: 'flaky',
      run: () => {
        calls.flaky++
        if (shouldFail) throw new Error('cleanup failed')
      },
    },
    { name: 'last', run: () => calls.last++ },
  ])

  const firstAttempt = disposal.dispose()
  assert.strictEqual(joinedAttempt, firstAttempt)
  assert.strictEqual(disposal.dispose(), firstAttempt)
  await assert.rejects(firstAttempt, /Retryable disposal completed with errors/)
  assert.deepEqual(calls, { first: 1, flaky: 1, last: 1 })

  shouldFail = false
  const retry = disposal.dispose()
  assert.notStrictEqual(retry, firstAttempt)
  await retry
  assert.deepEqual(calls, { first: 1, flaky: 2, last: 1 })

  await disposal.dispose()
  assert.deepEqual(calls, { first: 1, flaky: 2, last: 1 })
})

test('Dashboard production code does not value-import the legacy Core facade', async () => {
  const files = (await walk(sourceRoot)).filter(path => ['.ts', '.tsx'].includes(extname(path)))
  const violations = []

  for (const path of files) {
    const sourcePath = relative(sourceRoot, path)
    const source = await readFile(path, 'utf8')
    const imports = source.matchAll(/import\s*{([^}]*)}\s*from\s*['"]@easy-editor\/core['"]/gs)

    for (const match of imports) {
      const valueNames = match[1]
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => !part.startsWith('type '))
        .map(part => part.split(/\s+as\s+/)[0].trim())
      const forbidden = valueNames.filter(name => forbiddenFacadeNames.includes(name))
      if (forbidden.length) violations.push(`${sourcePath}: ${forbidden.join(', ')}`)
    }
  }

  assert.deepEqual(violations, [])
})

test('Dashboard production code does not import deleted Core-owned Agent or AI entrypoints', async () => {
  const productionFiles = [
    ...(await walk(sourceRoot)).filter(path => ['.js', '.mjs', '.mts', '.ts', '.tsx'].includes(extname(path))),
    join(dashboardRoot, 'server/index.mjs'),
    join(dashboardRoot, 'vite.config.mts'),
  ]
  const forbiddenPatterns = [
    ['Core Agent import', /@easy-editor\/core\/agent(?:-channel)?(?:\/[^'"\s]*)?/],
    ['Core AI import', /@easy-editor\/core\/ai(?:\/[^'"\s]*)?/],
  ]
  const violations = []

  for (const path of productionFiles) {
    const source = await readFile(path, 'utf8')
    for (const [name, pattern] of forbiddenPatterns) {
      if (pattern.test(source)) violations.push(`${relative(dashboardRoot, path)}: ${name}`)
    }
  }

  for (const allowedPath of [
    '@easy-editor/agent-runtime',
    '@easy-editor/agent-runtime/worker',
    'src/editor/agent/agent.worker.ts',
    '/api/ai/chat',
  ]) {
    for (const [name, pattern] of forbiddenPatterns) {
      assert.equal(
        pattern.test(allowedPath),
        false,
        `${name} guard must not reject the independent runtime path ${allowedPath}`,
      )
    }
  }

  assert.deepEqual(violations, [])
})

test('Dashboard strict build refreshes every declaration path it consumes', async () => {
  const manifest = JSON.parse(await readFile(join(sourceRoot, '../package.json'), 'utf8'))
  const buildDependencies = manifest.scripts['build:deps']

  assert.equal(manifest.scripts.prebuild, 'pnpm run build:deps')
  assert.equal(manifest.dependencies['@easy-editor/agent-runtime'], 'workspace:*')
  for (const packageName of [
    '@easy-editor/agent-runtime',
    '@easy-editor/core',
    '@easy-editor/plugin-dashboard',
    '@easy-editor/plugin-datasource',
    '@easy-editor/plugin-hotkey',
    '@easy-editor/renderer-core',
    '@easy-editor/react-renderer',
    '@easy-editor/react-renderer-dashboard',
  ]) {
    assert.match(buildDependencies, new RegExp(`--filter ${packageName.replace('/', '\\/')}(?:\\s|$)`))
  }
})

test('Dashboard runtime has one explicit engine and no remote loader or manager module singletons', async () => {
  const runtime = await readFile(join(sourceRoot, 'editor/runtime.ts'), 'utf8')
  assert.match(runtime, /from ['"]@easy-editor\/core\/instance['"]/)
  assert.doesNotMatch(runtime, /from ['"]@easy-editor\/core['"]/)
  assert.match(runtime, /export const engine:\s*EngineInstance\s*=\s*createEngine/)
  assert.match(runtime, /trustPolicy:\s*['"]legacyTrusted['"]/)
  assert.match(runtime, /hostWindow/)
  assert.match(runtime, /remoteAdapter/)

  const remoteFiles = (await walk(join(sourceRoot, 'editor/remote'))).filter(path =>
    ['/loaders/', '/managers/'].some(segment => path.includes(segment)),
  )
  const singletonExports = []
  for (const path of remoteFiles) {
    const source = await readFile(path, 'utf8')
    if (/export\s+const\s+\w+\s*=\s*new\s+/m.test(source)) {
      singletonExports.push(relative(sourceRoot, path))
    }
  }
  assert.deepEqual(singletonExports, [])
})

test('legacy UMD globals are installed only by the lifecycle-owned remote adapter', async () => {
  const globals = await readFile(join(sourceRoot, 'globals.ts'), 'utf8')
  const main = await readFile(join(sourceRoot, 'main.tsx'), 'utf8')
  const runtime = await readFile(join(sourceRoot, 'editor/runtime.ts'), 'utf8')
  const adapter = await readFile(join(sourceRoot, 'editor/remote/dashboard-remote-resources.ts'), 'utf8')

  assert.doesNotMatch(globals, /\$EasyEditor|window\./)
  assert.doesNotMatch(main, /initGlobals|\.\/globals/)
  assert.match(runtime, /hostGlobals:\s*createDashboardUmdGlobals\(\)/)
  assert.match(adapter, /this\.hostGlobals\.install/)
  assert.match(adapter, /name:\s*['"]hostGlobals['"]/)
})

test('local loader and remote material component paths install keyed race guards', async () => {
  const localLoader = await readFile(join(sourceRoot, 'editor/remote/loaders/local-loader.ts'), 'utf8')
  const materialLoader = await readFile(join(sourceRoot, 'editor/remote/loaders/material-loader.ts'), 'utf8')
  const materialManager = await readFile(join(sourceRoot, 'editor/remote/managers/material-manager.ts'), 'utf8')
  const setterLoader = await readFile(join(sourceRoot, 'editor/remote/loaders/setter-loader.ts'), 'utf8')
  const setterManager = await readFile(join(sourceRoot, 'editor/remote/managers/setter-manager.ts'), 'utf8')

  assert.match(localLoader, /new LatestOperationRegistry/)
  assert.match(localLoader, /this\.operations\.invalidate\(normalizedUrl\)/)
  assert.match(localLoader, /this\.assertUrlOperationCurrent\(operation\)/)
  assert.match(localLoader, /connection\.componentName\s*=\s*meta\.componentName/)
  assert.match(localLoader, /removeOwnedMaterial\(url, previousComponentName\)/)
  assert.match(materialLoader, /createCacheKey\(packageName, version, globalName\)/)
  assert.match(materialLoader, /componentLoads\.run\(cacheKey/)
  assert.doesNotMatch(materialLoader, /registry\.register/)
  assert.match(materialManager, /new LatestOperationRegistry/)
  assert.match(materialManager, /packageOperations\.assertCurrent\(packageOperation\)/)
  assert.match(materialManager, /componentRegistrations\.run\(cacheKey/)
  assert.match(materialManager, /assertCommittedIdentityCompatible\(packageName, version, globalName\)/)
  assert.match(
    materialManager,
    /scope\.perform\([\s\S]*packageOperations\.assertCurrent\(packageOperation\)[\s\S]*registry\.register/,
  )
  assert.match(setterLoader, /createCacheKey\(packageName, version, globalName\)/)
  assert.match(
    setterLoader,
    /return \[packageName, version, globalName\]\.map\(encodeURIComponent\)\.join\(['"]::['"]\)/,
  )
  assert.match(setterLoader, /setterLoads\.run\(cacheKey/)
  assert.match(setterLoader, /packageOperations\.begin\(packageName\)/)
  assert.match(setterLoader, /packageOperations\.assertCurrent\(packageOperation\)/)
  assert.match(setterLoader, /packageOperations\.invalidateAll\(\)/)
  assert.doesNotMatch(setterLoader, /registry\.register/)
  assert.match(
    setterManager,
    /await this\.loader\.loadSetters[\s\S]*packageOperations\.assertCurrent\(packageOperation\)[\s\S]*setters\.registerSetter/,
  )
  assert.match(
    setterManager,
    /scope\.perform\([\s\S]*packageOperations\.assertCurrent\(packageOperation\)[\s\S]*setters\.registerSetter/,
  )
  assert.match(
    setterManager,
    /scope\.perform\([\s\S]*packageOperations\.assertCurrent\(packageOperation\)[\s\S]*registry\.register/,
  )
  assert.match(setterManager, /packageOperations\.invalidateAll\(\)/)
  assert.match(setterManager, /assertCommittedIdentityCompatible\(packageName, version, globalName\)/)
})

test('remote cleanup settlement and batch APIs preserve ownership and failure identity', async () => {
  const cleanup = await readFile(join(sourceRoot, 'editor/remote/owned-resource-cleanup.js'), 'utf8')
  const localLoader = await readFile(join(sourceRoot, 'editor/remote/loaders/local-loader.ts'), 'utf8')
  const scriptLoader = await readFile(join(sourceRoot, 'editor/remote/loaders/script-loader.ts'), 'utf8')
  const remoteResources = await readFile(join(sourceRoot, 'editor/remote/dashboard-remote-resources.ts'), 'utf8')
  const materialManager = await readFile(join(sourceRoot, 'editor/remote/managers/material-manager.ts'), 'utf8')
  const setterManager = await readFile(join(sourceRoot, 'editor/remote/managers/setter-manager.ts'), 'utf8')

  assert.ok(cleanup.indexOf('socket.close()') < cleanup.indexOf('scope.releaseSocket(socket)'))
  assert.match(localLoader, /pendingSocketClosures/)
  assert.match(localLoader, /closeOwnedSocket\(this\.services\.scope, ws\)/)
  assert.match(localLoader, /this\.services\.scope\.ownSocket\(socket\)/)
  assert.match(localLoader, /handleHMRUpdate\(normalizedUrl, connection\.info, true\)/)
  assert.match(localLoader, /Material meta not found in refreshed module/)
  assert.match(localLoader, /assertMaterialNameAvailable\(url, meta\.componentName\)/)
  assert.match(localLoader, /removeOwnedMaterial\(normalizedUrl, connection\.componentName\)/)
  assert.match(localLoader, /throw new AggregateError\(failures, 'Local material loader disposal failed'\)/)
  assert.equal((scriptLoader.match(/removeOwnedNodeForSettlement\(/g) || []).length, 2)
  assert.doesNotMatch(scriptLoader, /if \(remove && (?:link|script)\) this\.services\.scope\.removeOwnedNode/)
  assert.equal((remoteResources.match(/settleRemotePackageLoads\(/g) || []).length, 2)
  assert.equal((materialManager.match(/settleRemotePackageLoads\(/g) || []).length, 1)
  assert.equal((setterManager.match(/settleRemotePackageLoads\(/g) || []).length, 1)
  assert.match(materialManager, /loadMetaMultiple[\s\S]*Promise<RemotePackageLoadResult>/)
  assert.match(setterManager, /loadMultiple[\s\S]*Promise<RemotePackageLoadResult>/)
  assert.match(remoteResources, /materials:\s*RemotePackageLoadResult/)
  assert.match(remoteResources, /setters:\s*RemotePackageLoadResult/)
  assert.match(remoteResources, /releaseEngineRegistrations\s*&&=/)
  assert.match(remoteResources, /\['disposing', 'disposed', 'failed'\]\.includes/)
  assert.match(localLoader, /dispose\(releaseEngineRegistrations\s*=\s*true\)/)
  assert.match(materialManager, /dispose\(releaseEngineRegistrations\s*=\s*true\)/)
  assert.match(setterManager, /dispose\(releaseEngineRegistrations\s*=\s*true\)/)
})

test('Dashboard bootstrap orders plugin registration, engine init, remote load, and project load under lifecycle disposal', async () => {
  const bootstrap = await readFile(join(sourceRoot, 'editor/index.ts'), 'utf8')
  const registerIndex = bootstrap.indexOf('await engine.plugins.registerPlugins')
  const initIndex = bootstrap.indexOf('await engine.init({')
  const remoteIndex = bootstrap.indexOf('await remoteResources.loadAllRemoteResources()')
  const setterFallbackIndex = bootstrap.indexOf('registerMissingLocalSetters()', remoteIndex)
  const persistenceIndex = bootstrap.indexOf('const initialProject = await createInitialProjectSchema()')
  const projectIndex = bootstrap.indexOf('await loadDashboardProjectAfterMaterialAdmission({', persistenceIndex)

  assert.ok(registerIndex >= 0 && registerIndex < initIndex)
  assert.ok(initIndex < remoteIndex)
  assert.ok(remoteIndex < setterFallbackIndex)
  assert.ok(setterFallbackIndex < persistenceIndex)
  assert.ok(persistenceIndex < projectIndex)
  assert.match(bootstrap, /window\.addEventListener\(['"]pagehide['"]/)
  assert.match(bootstrap, /event\.persisted/)
  assert.doesNotMatch(bootstrap, /addEventListener\(['"]pagehide['"][^\n]+once:\s*true/)
  assert.match(bootstrap, /import\.meta\.hot\.dispose/)
  assert.match(bootstrap, /disposeDashboardEditor\(\)\.catch/)
  assert.match(bootstrap, /new AggregateError\(\[startupError, cleanupError\]/)
  assert.match(bootstrap, /await dashboardPersistence\.dispose\(\)/)
  assert.match(bootstrap, /await engine\.destroy\(\)/)
  assert.match(bootstrap, /new AggregateError\(failures, ['"]Dashboard editor disposal failed['"]\)/)
  assert.match(bootstrap, /validateProjectSchema\([\s\S]*draft\.projectSchema[\s\S]*engine\.trustPolicy/)
  assert.match(bootstrap, /assertRequiredRemoteMaterialsLoaded\(result\)/)
  assert.match(bootstrap, /reportOptionalRemoteFailures\(['"]material metadata['"], remoteResult\.materials\)/)
  assert.match(bootstrap, /reportOptionalRemoteFailures\(['"]setter package['"], remoteResult\.setters\)/)
  assert.match(bootstrap, /for \(const \[type, setter\] of Object\.entries\(setterMap\)\)/)
  assert.match(bootstrap, /if \(!engine\.setters\.getSetter\(type\)\) engine\.setters\.registerSetter\(type, setter\)/)
  assert.match(bootstrap, /runBackground\(['"]auto-load remote component implementations['"]/)
  assert.match(bootstrap, /if \(!dashboardMaterialGcAdmissionPort\) \{\s*loadProject\(\)\s*return\s*\}/)
  assert.match(bootstrap, /withDashboardMaterialAdmissionBeforeExposure\(\{/)
  assert.match(
    bootstrap,
    /readMaterialGcSnapshot: projectId => dashboardPersistence\.readMaterialGcSnapshot\(projectId\)/,
  )
  assert.match(bootstrap, /reason: ['"]editor-startup['"]/)
  assert.match(bootstrap, /reason: ['"]editor-draft-restore['"]/)
  assert.equal(
    bootstrap.match(/await loadDashboardProjectAfterMaterialAdmission\(\{/g)?.length,
    2,
    'startup and durable draft restore must share the admission boundary',
  )
})

test('Dashboard runtime conditionally composes the direct Host admission port and non-Host catalog lease', async () => {
  const runtime = await readFile(join(sourceRoot, 'editor/runtime.ts'), 'utf8')

  assert.match(
    runtime,
    /dashboardLocalMaterialCatalogRuntime = createDashboardLocalMaterialCatalogRuntime\([\s\S]*dashboardMaterialGcAdmissionPort[\s\S]*withMaterialAdmission:/,
  )
  assert.equal(
    runtime.match(/dashboardMaterialGcAdmissionPort\.admitMaterialRefsUnderSharedMutation/g)?.length,
    2,
    'the admission port must bind promotion semantics and Host semantics directly',
  )
  assert.match(
    runtime,
    /dashboardAgentRuntimeFeatureFlags\.promotion\s*&&\s*dashboardMaterialGcEnabled\s*&&\s*dashboardMaterialGcAdmissionPort/,
    'promotion composition must remain disabled unless durable GC admission is available',
  )
  assert.match(
    runtime,
    /createDashboardLocalMaterialPromotionRuntime\([\s\S]*admitMaterialRefsUnderSharedMutation:[\s\S]*dashboardMaterialGcAdmissionPort\.admitMaterialRefsUnderSharedMutation/,
  )
  assert.match(
    runtime,
    /createDashboardAgentHost\([\s\S]*admitMaterialRefsUnderSharedMutation:[\s\S]*dashboardMaterialGcAdmissionPort\.admitMaterialRefsUnderSharedMutation/,
  )
})

test('Dashboard persistence is versioned and hotkey cleanup uses engine-owned leases', async () => {
  const schemaStorage = await readFile(join(sourceRoot, 'lib/schema.ts'), 'utf8')
  const preview = await readFile(join(sourceRoot, 'pages/preview/index.tsx'), 'utf8')
  const header = await readFile(join(sourceRoot, 'pages/editor/Header.tsx'), 'utf8')
  const moveHotkey = await readFile(join(sourceRoot, 'editor/plugins/plugin-hotkey-move-node/index.ts'), 'utf8')

  assert.match(schemaStorage, /normalizeProjectSchema/)
  assert.match(schemaStorage, /version:\s*schema\.version\s*\?\?\s*CURRENT_PROJECT_SCHEMA_VERSION/)
  assert.doesNotMatch(schemaStorage, /(?:localStorage|storage)\.(?:setItem|removeItem)\s*\(/)
  assert.match(preview, /createDashboardPersistenceRuntime/)
  assert.match(preview, /draft\.projectSchema/)
  assert.match(preview, /selectDashboardActiveDocumentSchema/)
  assert.match(header, /window\.open\(['"]['"], ['"]_blank['"]\)/)
  assert.match(header, /openDashboardPreviewAfterSave/)
  assert.match(header, /await persistDashboardProject\(['"]manual-save['"]\)/)
  assert.match(header, /await dashboardPersistence\.flush\(\)/)
  assert.match(header, /const materialGcAdmissionPort = dashboardMaterialGcAdmissionPort/)
  assert.match(header, /\.\.\.\(materialGcAdmissionPort\s*\?\s*\{/)
  assert.match(header, /beforeNavigate:/)
  assert.match(header, /withDashboardMaterialAdmissionBeforeExposure\(\{/)
  assert.match(header, /dashboardPersistence\.readMaterialGcSnapshot\(activeProjectId\)/)
  assert.match(header, /operation: \(\) => handle\.navigate\(url\)/)
  assert.match(moveHotkey, /hotkey\.acquireBinding\(\.\.\.binding\)/)
  assert.match(moveHotkey, /ctx\.onDispose\(release\)/)
  assert.doesNotMatch(moveHotkey, /hotkey\.unbind/)
  assert.doesNotMatch(moveHotkey, /destroy\(ctx\)/)
})
