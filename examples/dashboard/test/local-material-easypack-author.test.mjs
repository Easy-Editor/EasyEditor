import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createEasypackTrustedWrapperAuthor } from '../server/promotion/easypack-author.mjs'
import { createCanonicalDurableMaterialIdentity } from '../server/promotion/request-contract.mjs'
import { canonicalJsonStringify } from '../src/lib/storage/canonical-json.mjs'

const childFixturePath = fileURLToPath(new URL('./fixtures/local-material-author-child.mjs', import.meta.url))

const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const sha256Hex = value => createHash('sha256').update(value).digest('hex')
const sha256Sri = value => `sha256-${createHash('sha256').update(value).digest('base64')}`
const digest = character => `sha256:${character.repeat(64)}`
const delay = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))

const rawSource = `
globalThis.__easyEditorRawPromotionSourceExecuted = true
export default {
  mount(root) { root.textContent = 'untrusted generated KPI' },
  update() {},
  destroy(root) { root.replaceChildren() },
}
`.trim()

const dependencySource = 'export default { render() {} }'
const lockedDependencies = Object.freeze([
  Object.freeze({
    package: 'echarts',
    range: '^5.6.0',
    exactVersion: '5.6.0',
    finalUrl: 'https://cdn.example.test/echarts@5.6.0/index.mjs',
    integrity: sha256Sri(dependencySource),
    cached: true,
    module: Object.freeze({
      format: 'bundled-esm',
      contentType: 'text/javascript',
      encoding: 'base64',
      byteLength: Buffer.byteLength(dependencySource),
      bytes: Buffer.from(dependencySource).toString('base64'),
    }),
  }),
])
const dependencyLockDigest = sha256(canonicalJsonStringify(lockedDependencies))

const artifact = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-promotion',
  artifactId: 'artifact-kpi',
  sourceRevision: 'source-revision-7',
  logicalComponentId: 'logical-kpi',
  sourceIntegrity: sha256(rawSource),
  source: rawSource,
  css: ':host { display: block; }',
  safeManifest: { schemaVersion: 1, title: 'Durable KPI' },
  lockedDependencies,
  dependencyLockDigest,
  diagnostics: [],
  provenance: { actor: 'agent-test' },
  createdAt: 100,
  supersedes: null,
  ...overrides,
})

const canonicalPromotionId = request =>
  sha256(
    canonicalJsonStringify({
      schemaVersion: 1,
      kind: 'local-material-promotion-identity',
      authority: {
        projectId: request.projectId,
        branchId: request.branchId,
        sessionId: request.sessionId,
        taskId: request.taskId,
      },
      callId: request.callId,
      callDigest: request.callDigest,
      artifact: {
        artifactId: request.artifact.artifactId,
        sourceRevision: request.artifact.sourceRevision,
        logicalComponentId: request.artifact.logicalComponentId,
        sourceIntegrity: request.artifact.sourceIntegrity,
        dependencyLockDigest: request.artifact.dependencyLockDigest,
      },
    }),
  )

const promotionRequest = (overrides = {}) => {
  const request = {
    schemaVersion: 1,
    projectId: 'project-promotion',
    branchId: 'main',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    callId: 'call-1',
    callDigest: digest('a'),
    artifact: artifact(),
    ...overrides,
  }
  return { ...request, promotionId: overrides.promotionId ?? canonicalPromotionId(request) }
}

test('canonical durable identity separates registry lineage from logical source identity', () => {
  const firstRequest = promotionRequest()
  const first = createCanonicalDurableMaterialIdentity(firstRequest)
  const repeated = createCanonicalDurableMaterialIdentity(firstRequest)
  const nextSource = `${rawSource}\n// next frozen revision`
  const nextPromotionRequest = promotionRequest({
    artifact: artifact({
      sourceRevision: 'source-revision-8',
      source: nextSource,
      sourceIntegrity: sha256(nextSource),
    }),
  })
  const nextPromotion = createCanonicalDurableMaterialIdentity(nextPromotionRequest)
  const otherArtifactRequest = promotionRequest({ artifact: artifact({ artifactId: 'artifact-secondary' }) })
  const otherProjectRequest = promotionRequest({
    projectId: 'project-secondary',
    artifact: artifact({ projectId: 'project-secondary' }),
  })

  const expectedMaterialId = `local-material-${sha256Hex(
    canonicalJsonStringify({
      schemaVersion: 1,
      kind: 'local-material-registry-lineage',
      projectId: firstRequest.projectId,
      artifactId: firstRequest.artifact.artifactId,
    }),
  )}`
  const expectedMaterialVersion = `local-version-${sha256Hex(
    canonicalJsonStringify({
      schemaVersion: 1,
      kind: 'local-material-registry-version',
      materialId: expectedMaterialId,
      promotionId: firstRequest.promotionId,
    }),
  )}`

  assert.deepEqual(first, { materialId: expectedMaterialId, materialVersion: expectedMaterialVersion })
  assert.deepEqual(repeated, first)
  assert.match(first.materialId, /^local-material-[\da-f]{64}$/u)
  assert.match(first.materialVersion, /^local-version-[\da-f]{64}$/u)
  assert.notEqual(first.materialId, firstRequest.artifact.logicalComponentId)
  assert.notEqual(first.materialVersion, firstRequest.artifact.sourceRevision)
  assert.equal(nextPromotion.materialId, first.materialId)
  assert.notEqual(nextPromotion.materialVersion, first.materialVersion)
  assert.notEqual(createCanonicalDurableMaterialIdentity(otherArtifactRequest).materialId, first.materialId)
  assert.notEqual(createCanonicalDurableMaterialIdentity(otherProjectRequest).materialId, first.materialId)
})

const isInside = (root, candidate) => {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  )
}

const waitForMessage = (child, predicate, timeoutMs = 5_000) =>
  new Promise((resolve, reject) => {
    const stdout = []
    const stderr = []
    child.stdout?.on('data', chunk => stdout.push(chunk))
    child.stderr?.on('data', chunk => stderr.push(chunk))
    const cleanup = () => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    const onMessage = message => {
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(
        new Error(
          `author child exited before expected message (code=${code}, signal=${signal})\n${Buffer.concat(stdout).toString()}${Buffer.concat(stderr).toString()}`,
        ),
      )
    }
    const onError = error => {
      cleanup()
      reject(error)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          `timed out waiting for author child\n${Buffer.concat(stdout).toString()}${Buffer.concat(stderr).toString()}`,
        ),
      )
    }, timeoutMs)
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })

const waitForExit = child =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
    : new Promise((resolvePromise, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => resolvePromise({ code, signal }))
      })

const startAuthorChild = (children, workspaceRoot, config = {}) => {
  const child = fork(childFixturePath, [], {
    env: {
      ...process.env,
      EASY_EDITOR_AUTHOR_CHILD_CONFIG: JSON.stringify({ workspaceRoot, ...config }),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

const killAuthorChild = async child => {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  const exit = await waitForExit(child)
  assert.equal(exit.signal, 'SIGKILL')
}

const workspaceNamePattern =
  /^promotion-v2-([\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12})-([\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12})-([A-Za-z0-9]{6})$/u
const workspaceMarkerName = '.easy-editor-workspace-owner.json'
const hostKey = value => createHash('sha256').update(value).digest('hex').slice(0, 16)
const processLeasePath = (workspaceRoot, instanceToken) =>
  join(workspaceRoot, `.promotion-process-v1-${instanceToken}.lease.json`)

const createFastAuthor = ({ workspaceRoot, clock }) =>
  createEasypackTrustedWrapperAuthor({
    workspaceRoot,
    nodeVersion: '20.0.0',
    workspaceLease: { heartbeatMs: 20, staleAfterMs: 100, now: () => clock.value },
    async loadEasypack() {
      return {
        async buildEasypack({ rootDir }) {
          const output = 'export default Object.freeze({ componentName: "GeneratedMaterialHost" })\n'
          await mkdir(join(rootDir, 'dist'))
          await writeFile(join(rootDir, 'dist/index.esm.js'), output)
          return { artifacts: [{ path: 'dist/index.esm.js' }] }
        },
      }
    },
  })

const readWorkspaceOwner = async buildDirectory =>
  JSON.parse(await readFile(join(buildDirectory, workspaceMarkerName), 'utf8'))

const rewriteWorkspaceOwner = async ({ buildDirectory, instanceToken, ownerHostname, pid, createdAt }) => {
  const match = workspaceNamePattern.exec(basename(buildDirectory))
  assert.ok(match)
  const workspaceName = `promotion-v2-${instanceToken}-${match[2]}-${match[3]}`
  const rewrittenDirectory = join(dirname(buildDirectory), workspaceName)
  await rename(buildDirectory, rewrittenDirectory)
  const marker = await readWorkspaceOwner(rewrittenDirectory)
  await writeFile(
    join(rewrittenDirectory, workspaceMarkerName),
    `${JSON.stringify({
      ...marker,
      hostname: ownerHostname,
      hostnameKey: hostKey(ownerHostname),
      pid,
      instanceToken,
      workspaceName,
      createdAt,
    })}\n`,
  )
  return rewrittenDirectory
}

const writeProcessLease = async ({ workspaceRoot, instanceToken, ownerHostname, pid, heartbeatAt }) => {
  await writeFile(
    processLeasePath(workspaceRoot, instanceToken),
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'easy-editor-easypack-process-lease',
      hostname: ownerHostname,
      hostnameKey: hostKey(ownerHostname),
      pid,
      instanceToken,
      heartbeatAt,
    })}\n`,
  )
}

test('Node below 20 returns typed unavailable without eagerly loading Easypack', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'easy-editor-author-node18-'))
  let loadCalls = 0
  const author = createEasypackTrustedWrapperAuthor({
    workspaceRoot,
    nodeVersion: '18.20.8',
    async loadEasypack() {
      loadCalls += 1
      throw new Error('Node 18 must never import the Node 20 Easypack package')
    },
  })
  t.after(async () => {
    await author.dispose()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  assert.equal(loadCalls, 0, 'constructing the optional promotion author must not import Easypack')
  await assert.rejects(
    author.authorPromotion({
      principal: { tenantId: 'tenant-from-server', userId: 'user-from-server' },
      request: promotionRequest(),
    }),
    error => {
      assert.equal(error?.code, 'promotion-runtime-unavailable')
      assert.equal(error?.status, 503)
      assert.equal(error?.retryable, false)
      assert.equal(error?.message, 'Local material promotion requires Node 20 or newer')
      return true
    },
  )
  assert.equal(loadCalls, 0, 'the unavailable path must not evaluate or import Easypack')
})

test('restart recovery reclaims SIGKILL workspaces without deleting live owners or following symlinks', async t => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'easy-editor-author-recovery-'))
  const workspaceRoot = join(fixtureRoot, 'workspaces')
  const children = new Set()
  let loadCalls = 0
  const restartedAuthor = createEasypackTrustedWrapperAuthor({
    workspaceRoot,
    nodeVersion: '18.20.8',
    async loadEasypack() {
      loadCalls += 1
      throw new Error('workspace recovery must not import Easypack')
    },
  })
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await waitForExit(child).catch(() => undefined)
    }
    await restartedAuthor.dispose()
    await rm(fixtureRoot, { recursive: true, force: true })
  })

  const liveChild = startAuthorChild(children, workspaceRoot)
  const liveWorkspace = await waitForMessage(liveChild, message => message?.type === 'workspace-ready')
  assert.match(basename(liveWorkspace.buildDirectory), /^promotion-v2-/u)
  await access(join(liveWorkspace.buildDirectory, '.easy-editor-workspace-owner.json'))
  assert.deepEqual(await restartedAuthor.recoverPromotionWorkspaces(), [])
  await access(liveWorkspace.buildDirectory)
  await unlink(join(liveWorkspace.buildDirectory, '.easy-editor-workspace-owner.json'))
  assert.deepEqual(await restartedAuthor.recoverPromotionWorkspaces(), [])
  await access(liveWorkspace.buildDirectory)

  await killAuthorChild(liveChild)
  const recoveryChildren = [
    startAuthorChild(children, workspaceRoot, { action: 'recover' }),
    startAuthorChild(children, workspaceRoot, { action: 'recover' }),
  ]
  const recoveryMessages = await Promise.all(
    recoveryChildren.map(child => waitForMessage(child, message => message?.type === 'recovered')),
  )
  await Promise.all(recoveryChildren.map(waitForExit))
  assert.deepEqual(recoveryMessages.flatMap(message => message.recovered).sort(), [
    basename(liveWorkspace.buildDirectory),
  ])
  await assert.rejects(access(liveWorkspace.buildDirectory), error => error?.code === 'ENOENT')
  assert.deepEqual(await restartedAuthor.recoverPromotionWorkspaces(), [])

  const preMarkerChild = startAuthorChild(children, workspaceRoot)
  const preMarkerWorkspace = await waitForMessage(preMarkerChild, message => message?.type === 'workspace-ready')
  await killAuthorChild(preMarkerChild)
  await unlink(join(preMarkerWorkspace.buildDirectory, '.easy-editor-workspace-owner.json'))
  assert.deepEqual(await restartedAuthor.recoverPromotionWorkspaces(), [basename(preMarkerWorkspace.buildDirectory)])
  await assert.rejects(access(preMarkerWorkspace.buildDirectory), error => error?.code === 'ENOENT')

  const externalDirectory = join(fixtureRoot, 'external-directory')
  await mkdir(externalDirectory)
  await writeFile(join(externalDirectory, 'sentinel.txt'), 'do not delete')
  const symlinkChild = startAuthorChild(children, workspaceRoot)
  const symlinkWorkspace = await waitForMessage(symlinkChild, message => message?.type === 'workspace-ready')
  await killAuthorChild(symlinkChild)
  await rm(symlinkWorkspace.buildDirectory, { recursive: true })
  await symlink(externalDirectory, symlinkWorkspace.buildDirectory, 'dir')
  assert.deepEqual(await restartedAuthor.recoverPromotionWorkspaces(), [])
  assert.equal(await readFile(join(externalDirectory, 'sentinel.txt'), 'utf8'), 'do not delete')
  await unlink(symlinkWorkspace.buildDirectory)

  const externalMarker = join(fixtureRoot, 'external-marker.json')
  await writeFile(externalMarker, '{"mustRemain":true}\n')
  const markerSymlinkChild = startAuthorChild(children, workspaceRoot)
  const markerSymlinkWorkspace = await waitForMessage(
    markerSymlinkChild,
    message => message?.type === 'workspace-ready',
  )
  await killAuthorChild(markerSymlinkChild)
  const markerPath = join(markerSymlinkWorkspace.buildDirectory, '.easy-editor-workspace-owner.json')
  await unlink(markerPath)
  await symlink(externalMarker, markerPath)
  assert.deepEqual(await restartedAuthor.recoverPromotionWorkspaces(), [
    basename(markerSymlinkWorkspace.buildDirectory),
  ])
  assert.equal(await readFile(externalMarker, 'utf8'), '{"mustRemain":true}\n')
  assert.equal(loadCalls, 0)
})

test('process leases distinguish incarnations and bound foreign or missing-owner retention', async t => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'easy-editor-author-incarnations-'))
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))

  await t.test(
    'same PID with an old instance token is reclaimed immediately, including recovery quarantine',
    async t => {
      const workspaceRoot = join(fixtureRoot, 'same-pid')
      const clock = { value: 1_000 }
      const author = createFastAuthor({ workspaceRoot, clock })
      t.after(() => author.dispose())
      const currentHostname = hostname()

      const staleBuild = await author.authorPromotion({
        principal: { tenantId: 'trusted-tenant', userId: 'trusted-user' },
        request: promotionRequest(),
      })
      const staleToken = randomUUID()
      const staleDirectory = await rewriteWorkspaceOwner({
        buildDirectory: staleBuild.buildDirectory,
        instanceToken: staleToken,
        ownerHostname: currentHostname,
        pid: process.pid,
        createdAt: clock.value,
      })
      await writeProcessLease({
        workspaceRoot,
        instanceToken: staleToken,
        ownerHostname: currentHostname,
        pid: process.pid,
        heartbeatAt: clock.value,
      })
      assert.deepEqual(await author.recoverPromotionWorkspaces(), [basename(staleDirectory)])
      await assert.rejects(access(staleDirectory), error => error?.code === 'ENOENT')
      await assert.rejects(access(processLeasePath(workspaceRoot, staleToken)), error => error?.code === 'ENOENT')
      await author.releasePromotion(staleBuild)

      const quarantineBuild = await author.authorPromotion({
        principal: { tenantId: 'trusted-tenant', userId: 'trusted-user' },
        request: promotionRequest(),
      })
      const oldRecoveryToken = randomUUID()
      const quarantineName = `.promotion-recovery-v2-${oldRecoveryToken}-${randomUUID()}-${basename(quarantineBuild.buildDirectory)}`
      const quarantineDirectory = join(workspaceRoot, quarantineName)
      await rename(quarantineBuild.buildDirectory, quarantineDirectory)
      await writeProcessLease({
        workspaceRoot,
        instanceToken: oldRecoveryToken,
        ownerHostname: currentHostname,
        pid: process.pid,
        heartbeatAt: clock.value,
      })
      assert.deepEqual(await author.recoverPromotionWorkspaces(), [quarantineName])
      await assert.rejects(access(quarantineDirectory), error => error?.code === 'ENOENT')
      await author.releasePromotion(quarantineBuild)
    },
  )

  await t.test('fresh foreign owner is retained and the same owner is auditably reclaimable after TTL', async t => {
    const workspaceRoot = join(fixtureRoot, 'foreign-owner')
    const clock = { value: 2_000 }
    const author = createFastAuthor({ workspaceRoot, clock })
    t.after(() => author.dispose())
    const foreignToken = randomUUID()
    const foreignHostname = 'restarted-container.example.test'
    const build = await author.authorPromotion({
      principal: { tenantId: 'trusted-tenant', userId: 'trusted-user' },
      request: promotionRequest(),
    })
    const foreignDirectory = await rewriteWorkspaceOwner({
      buildDirectory: build.buildDirectory,
      instanceToken: foreignToken,
      ownerHostname: foreignHostname,
      pid: 1,
      createdAt: clock.value,
    })
    await writeProcessLease({
      workspaceRoot,
      instanceToken: foreignToken,
      ownerHostname: foreignHostname,
      pid: 1,
      heartbeatAt: clock.value,
    })

    assert.deepEqual(await author.recoverPromotionWorkspaces(), [])
    await access(foreignDirectory)
    await unlink(processLeasePath(workspaceRoot, foreignToken))
    assert.deepEqual(await author.recoverPromotionWorkspaces(), [])
    await access(foreignDirectory)
    clock.value += 101
    assert.deepEqual(await author.recoverPromotionWorkspaces(), [basename(foreignDirectory)])
    await assert.rejects(access(foreignDirectory), error => error?.code === 'ENOENT')
    await assert.rejects(access(processLeasePath(workspaceRoot, foreignToken)), error => error?.code === 'ENOENT')
    await author.releasePromotion(build)
  })

  await t.test('multiple authors in one process share an incarnation and never reap each other', async t => {
    const workspaceRoot = join(fixtureRoot, 'same-process')
    const clock = { value: 3_000 }
    const firstAuthor = createFastAuthor({ workspaceRoot, clock })
    const secondAuthor = createFastAuthor({ workspaceRoot, clock })
    t.after(async () => {
      await Promise.all([firstAuthor.dispose(), secondAuthor.dispose()])
    })
    const first = await firstAuthor.authorPromotion({
      principal: { tenantId: 'trusted-tenant', userId: 'trusted-user' },
      request: promotionRequest(),
    })
    const second = await secondAuthor.authorPromotion({
      principal: { tenantId: 'trusted-tenant', userId: 'trusted-user' },
      request: promotionRequest(),
    })
    const [firstMarker, secondMarker] = await Promise.all([
      readWorkspaceOwner(first.buildDirectory),
      readWorkspaceOwner(second.buildDirectory),
    ])
    assert.equal(firstMarker.instanceToken, secondMarker.instanceToken)
    assert.notEqual(firstMarker.workspaceToken, secondMarker.workspaceToken)
    assert.deepEqual(await firstAuthor.recoverPromotionWorkspaces(), [])
    const leaseEntries = (await readdir(workspaceRoot)).filter(name =>
      /^\.promotion-process-v1-.*\.lease\.json$/u.test(name),
    )
    assert.equal(leaseEntries.length, 1)
    await firstAuthor.releasePromotion(second)
    await secondAuthor.releasePromotion(first)
  })
})

test('shared author disposal drains one heartbeat, releases the final lease, and never recreates the root', async t => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'easy-editor-author-dispose-'))
  const workspaceRoot = join(fixtureRoot, 'workspaces')
  const clock = { value: 4_000 }
  const firstAuthor = createFastAuthor({ workspaceRoot, clock })
  const secondAuthor = createFastAuthor({ workspaceRoot, clock })
  t.after(async () => {
    await Promise.all([firstAuthor.dispose(), secondAuthor.dispose()])
    await rm(fixtureRoot, { recursive: true, force: true })
  })

  await mkdir(workspaceRoot)
  await Promise.all([firstAuthor.recoverPromotionWorkspaces(), secondAuthor.recoverPromotionWorkspaces()])
  await delay(45)
  const leaseEntries = (await readdir(workspaceRoot)).filter(name =>
    /^\.promotion-process-v1-.*\.lease\.json$/u.test(name),
  )
  const transientEntries = (await readdir(workspaceRoot)).filter(name =>
    /^\.promotion-process-v1-.*\.lease\.tmp$/u.test(name),
  )
  assert.equal(leaseEntries.length, 1, 'parallel authors share one durable process lease')
  assert.equal(transientEntries.length <= 1, true, 'at most one atomic heartbeat write may be in flight')

  const build = await secondAuthor.authorPromotion({
    principal: { tenantId: 'trusted-tenant', userId: 'trusted-user' },
    request: promotionRequest(),
  })
  const instanceToken = (await readWorkspaceOwner(build.buildDirectory)).instanceToken
  await firstAuthor.dispose()
  await firstAuthor.dispose()
  await secondAuthor.dispose()
  await access(build.buildDirectory)
  await access(processLeasePath(workspaceRoot, instanceToken))

  await secondAuthor.releasePromotion(build)
  await assert.rejects(access(processLeasePath(workspaceRoot, instanceToken)), error => error?.code === 'ENOENT')
  await rm(workspaceRoot, { recursive: true })
  await delay(85)
  await assert.rejects(access(workspaceRoot), error => error?.code === 'ENOENT')
})

test('Node 20 author builds only a fixed trusted sandbox-proxy wrapper in a confined workspace', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'easy-editor-author-node20-'))
  const buildCalls = []
  const wrapperSources = []
  let loadCalls = 0

  const loadEasypack = async () => {
    loadCalls += 1
    return {
      async buildEasypack(options) {
        buildCalls.push(structuredClone(options))
        assert.equal(isInside(workspaceRoot, options.rootDir), true)
        assert.deepEqual(options.config.entry, { main: 'src/index.mjs' })
        assert.equal(options.config.preset, 'library')
        assert.equal(options.config.output.dir, 'dist')
        assert.equal(options.config.output.esm, true)
        assert.equal(options.config.output.cjs, false)
        assert.equal(options.config.output.umd, false)
        assert.equal(options.config.output.sourcemap, false)
        assert.equal(options.config.output.types, false)

        const wrapperSource = await readFile(join(options.rootDir, 'src/index.mjs'), 'utf8')
        wrapperSources.push(wrapperSource)
        const packageManifest = JSON.parse(await readFile(join(options.rootDir, 'package.json'), 'utf8'))
        assert.equal(packageManifest.name, '@easy-editor/local-material-logical-kpi')
        assert.match(packageManifest.version, /^0\.0\.0-[0-9A-Za-z.-]+$/u)
        assert.equal(packageManifest.private, true)
        assert.equal(packageManifest.type, 'module')
        assert.match(wrapperSource, /GeneratedMaterialHost/u)
        assert.match(wrapperSource, /sandbox-proxy/u)
        assert.match(wrapperSource, /source-revision-7/u)
        assert.match(wrapperSource, new RegExp(artifact().sourceIntegrity.replace(':', '\\:')))
        assert.match(wrapperSource, new RegExp(artifact().dependencyLockDigest.replace(':', '\\:')))
        assert.doesNotMatch(wrapperSource, /__easyEditorRawPromotionSourceExecuted/u)
        assert.doesNotMatch(wrapperSource, /untrusted generated KPI/u)
        assert.doesNotMatch(wrapperSource, /tenant-from-server|user-from-server/u)
        assert.doesNotMatch(wrapperSource, /\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\(/u)

        const output = `export const wrapper = ${JSON.stringify(wrapperSource)}\n`
        const outputDirectory = join(options.rootDir, 'dist')
        const outputPath = join(outputDirectory, 'index.esm.js')
        await mkdir(outputDirectory, { recursive: true })
        await writeFile(outputPath, output)
        return {
          package: { name: packageManifest.name, version: packageManifest.version },
          preset: 'library',
          artifacts: [
            {
              path: 'dist/index.esm.js',
              type: 'chunk',
              bytes: Buffer.byteLength(output),
              sha256: createHash('sha256').update(output).digest('hex'),
            },
          ],
        }
      },
    }
  }

  const author = createEasypackTrustedWrapperAuthor({
    workspaceRoot,
    nodeVersion: '20.12.2',
    loadEasypack,
    now: () => 123,
  })
  const authored = []
  t.after(async () => {
    for (const promotion of authored) await author.releasePromotion(promotion).catch(() => undefined)
    await author.dispose()
    await rm(workspaceRoot, { recursive: true, force: true })
  })
  globalThis.__easyEditorRawPromotionSourceExecuted = undefined
  const input = {
    principal: { tenantId: 'tenant-from-server', userId: 'user-from-server' },
    request: promotionRequest(),
  }
  const first = await author.authorPromotion(input)
  authored.push(first)
  const second = await author.authorPromotion(input)
  authored.push(second)

  assert.equal(globalThis.__easyEditorRawPromotionSourceExecuted, undefined)
  assert.equal(loadCalls > 0, true)
  assert.equal(buildCalls.length, 2)
  assert.equal(wrapperSources[0], wrapperSources[1], 'the trusted wrapper recipe must be deterministic')
  assert.equal(isInside(workspaceRoot, first.buildDirectory), true)
  assert.equal(isInside(workspaceRoot, second.buildDirectory), true)
  assert.notEqual(first.buildDirectory, second.buildDirectory, 'each attempt must use an isolated workspace')
  assert.deepEqual(first.sourceRevision, {
    artifactId: 'artifact-kpi',
    sourceRevision: 'source-revision-7',
    logicalComponentId: 'logical-kpi',
    sourceIntegrity: artifact().sourceIntegrity,
  })
  assert.equal(first.schemaVersion, 1)
  assert.equal(first.promotionId, input.request.promotionId)
  assert.equal(first.projectId, 'project-promotion')
  assert.deepEqual(
    { materialId: first.materialId, materialVersion: first.materialVersion },
    createCanonicalDurableMaterialIdentity(input.request),
  )
  assert.notEqual(first.materialId, first.logicalComponentId)
  assert.notEqual(first.materialVersion, first.sourceRevision.sourceRevision)
  assert.equal(first.logicalComponentId, 'logical-kpi')
  assert.equal(first.dependencyLockDigest, dependencyLockDigest)
  assert.equal(first.entryFile, 'dist/index.esm.js')
  assert.equal(first.createdAt, 123)
  assert.deepEqual(second.files, first.files)
  assert.equal(second.buildIntegrity, first.buildIntegrity)
  assert.deepEqual(first.files, [
    {
      path: 'dist/index.esm.js',
      byteLength: first.files[0].byteLength,
      integrity: first.buildIntegrity,
    },
  ])
  const outputBytes = await readFile(join(first.buildDirectory, first.entryFile))
  assert.equal(first.files[0].byteLength, outputBytes.byteLength)
  assert.equal(first.buildIntegrity, sha256(outputBytes))
})

test('default Node 20 loader lazily materializes compiled Easypack from a clean checkout', async t => {
  if (Number.parseInt(process.versions.node.split('.')[0], 10) < 20) {
    t.skip('real Easypack promotion requires Node 20 or newer')
    return
  }
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'easy-editor-author-clean-dist-'))
  const easypackDirectory = fileURLToPath(new URL('../../../packages/easypack/', import.meta.url))
  const distDirectory = join(easypackDirectory, 'dist')
  const backupDirectory = join(easypackDirectory, `.dist-promotion-test-${process.pid}`)
  await rm(backupDirectory, { recursive: true, force: true })
  let hadDist = true
  try {
    await rename(distDirectory, backupDirectory)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    hadDist = false
  }
  const author = createEasypackTrustedWrapperAuthor({ workspaceRoot, nodeVersion: process.versions.node })
  t.after(async () => {
    await author?.dispose()
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(distDirectory, { recursive: true, force: true })
    if (hadDist) await rename(backupDirectory, distDirectory)
  })

  await assert.rejects(access(join(distDirectory, 'index.js')), error => error?.code === 'ENOENT')
  const result = await author.authorPromotion({
    principal: { tenantId: 'trusted-tenant', userId: 'trusted-user' },
    request: promotionRequest(),
  })
  await access(join(distDirectory, 'index.js'))
  const output = await readFile(join(result.buildDirectory, result.entryFile), 'utf8')
  assert.match(output, /GeneratedMaterialHost/u)
  assert.match(output, /sandbox-proxy/u)
  await author.releasePromotion(result)
})
