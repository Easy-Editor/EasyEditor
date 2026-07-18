import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createEasypackTrustedWrapperAuthor } from '../server/promotion/easypack-author.mjs'
import { canonicalJsonStringify } from '../src/lib/storage/canonical-json.mjs'

const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const sha256Sri = value => `sha256-${createHash('sha256').update(value).digest('base64')}`
const digest = character => `sha256:${character.repeat(64)}`

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

const isInside = (root, candidate) => {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  )
}

test('Node below 20 returns typed unavailable without eagerly loading Easypack', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'easy-editor-author-node18-'))
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }))
  let loadCalls = 0
  const author = createEasypackTrustedWrapperAuthor({
    workspaceRoot,
    nodeVersion: '18.20.8',
    async loadEasypack() {
      loadCalls += 1
      throw new Error('Node 18 must never import the Node 20 Easypack package')
    },
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

test('Node 20 author builds only a fixed trusted sandbox-proxy wrapper in a confined workspace', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'easy-editor-author-node20-'))
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }))
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
  globalThis.__easyEditorRawPromotionSourceExecuted = undefined
  const input = {
    principal: { tenantId: 'tenant-from-server', userId: 'user-from-server' },
    request: promotionRequest(),
  }
  const first = await author.authorPromotion(input)
  const second = await author.authorPromotion(input)

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
  assert.equal(first.materialId, 'logical-kpi')
  assert.equal(first.materialVersion, 'source-revision-7')
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
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(distDirectory, { recursive: true, force: true })
    if (hadDist) await rename(backupDirectory, distDirectory)
  })

  await assert.rejects(access(join(distDirectory, 'index.js')), error => error?.code === 'ENOENT')
  const author = createEasypackTrustedWrapperAuthor({ workspaceRoot, nodeVersion: process.versions.node })
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
