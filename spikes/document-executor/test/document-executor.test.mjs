import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  FIXTURE_MATERIAL_MANIFEST,
  createMinimalExecutionInput,
  createMinimalPrepareInput,
} from '../fixtures/minimal-draft.mjs'
import { DocumentExecutorError, executeDocument, executeDocumentWorkflow } from '../src/executor.mjs'
import {
  computeWorkspaceArtifactCompatibility,
  createBrowserArtifactManifest,
  hashWorkspaceArtifactDirectory,
} from '../src/workspace-artifacts.mjs'

const PORT = 43_117
const DASHBOARD_URL = `http://127.0.0.1:${PORT}/index.html`
const BUNDLED_EASY_EDITOR_MATERIAL_IDS = [
  'EasyEditorMaterialsBarChart',
  'EasyEditorMaterialsGeoMap',
  'EasyEditorMaterialsLineChart',
  'EasyEditorMaterialsNumberFlip',
  'EasyEditorMaterialsPieChart',
  'EasyEditorMaterialsProgress',
  'EasyEditorMaterialsScrollList',
  'EasyEditorMaterialsText',
]
const PREPARED_RESULT_KEYS = [
  'actorId',
  'baseDraftVersion',
  'candidateProject',
  'compatibility',
  'compatibilitySha256',
  'contractVersion',
  'evidence',
  'executorId',
  'inputSha256',
  'operationId',
  'postRevision',
  'preRevision',
  'preparedAt',
  'projectId',
  'semanticReceipt',
  'stageId',
  'taskId',
]

const canonicalJson = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

const sha256 = value => createHash('sha256').update(value).digest('hex')

const waitForServer = async (processHandle, port) => {
  let lastError
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Dashboard Vite server exited with ${processHandle.exitCode}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/index.html`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Dashboard Vite server did not start: ${String(lastError)}`)
}

const buildBrowserArtifact = async ({ artifactDirectory, viteE2E }) => {
  const build = spawn(
    'pnpm',
    [
      '--dir',
      '../../examples/dashboard',
      'exec',
      'vite',
      'build',
      '--config',
      '../../spikes/document-executor/vite.config.mts',
      '--outDir',
      artifactDirectory,
    ],
    {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        VITE_DASHBOARD_AGENT_RUNTIME: '1',
        VITE_DASHBOARD_AGENT_DATA: '0',
        VITE_DASHBOARD_AGENT_ONLINE: '0',
        VITE_DASHBOARD_AGENT_PROMOTION: '0',
        VITE_E2E: viteE2E,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stderr = ''
  build.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })
  const [exitCode] = await once(build, 'exit')
  if (exitCode !== 0) throw new Error(`Harness build failed: ${stderr}`)
}

const startServer = async ({ port = PORT, artifactDirectory } = {}) => {
  const serverProcess = spawn(
    'pnpm',
    [
      '--dir',
      '../../examples/dashboard',
      'exec',
      'vite',
      'preview',
      '--config',
      '../../spikes/document-executor/vite.config.mts',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
      ...(artifactDirectory ? ['--outDir', artifactDirectory] : []),
    ],
    {
      cwd: new URL('..', import.meta.url),
      detached: true,
      env: {
        ...process.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stderr = ''
  serverProcess.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })
  await waitForServer(serverProcess, port).catch(error => {
    process.kill(-serverProcess.pid, 'SIGTERM')
    throw new AggregateError([error, new Error(stderr)], 'Dashboard server failed')
  })
  return serverProcess
}

const stopServer = async serverProcess => {
  if (!serverProcess || serverProcess.exitCode !== null) return
  process.kill(-serverProcess.pid, 'SIGTERM')
  await Promise.race([once(serverProcess, 'exit'), new Promise(resolve => setTimeout(resolve, 5_000))])
}

const startStatefulArtifactServer = async ({ tamperJavaScriptAt }) => {
  const artifactDirectory = fileURLToPath(new URL('../.browser-dist/', import.meta.url))
  const manifest = await createBrowserArtifactManifest(artifactDirectory)
  const paths = new Set(Object.keys(manifest.files))
  const requestCounts = new Map()
  const server = createServer(async (request, response) => {
    const relativePath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname.slice(1))
    if (!paths.has(relativePath)) {
      response.statusCode = 404
      response.end()
      return
    }
    const count = (requestCounts.get(relativePath) ?? 0) + 1
    requestCounts.set(relativePath, count)
    const bytes = await readFile(join(artifactDirectory, relativePath))
    response.statusCode = 200
    response.setHeader(
      'content-type',
      relativePath.endsWith('.html')
        ? 'text/html'
        : relativePath.endsWith('.js')
          ? 'text/javascript'
          : relativePath.endsWith('.css')
            ? 'text/css'
            : relativePath.endsWith('.svg')
              ? 'image/svg+xml'
              : 'application/octet-stream',
    )
    response.end(
      relativePath.endsWith('.js') && count >= tamperJavaScriptAt
        ? Buffer.concat([bytes, Buffer.from('\n/* stateful-tamper-body */')])
        : bytes,
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return {
    dashboardUrl: `http://127.0.0.1:${address.port}/index.html`,
    async close() {
      server.close()
      await once(server, 'close')
    },
  }
}

const readJsonBody = async request => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const startDurableWorkflowServer = async (
  prepareInput,
  { mutationGrantToken, recoveryGrantToken, initialStatus = 'issued', initialCandidateSha256, outcomeExtras = {} },
) => {
  const requests = []
  let status = initialStatus
  let prepared = null
  let commitCount = 0
  const hono = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      origin: request.headers.origin,
      csrf: request.headers['x-csrf-token'],
    })
    response.setHeader('content-type', 'application/json')
    const isOutcomeRequest = request.method === 'GET' && request.url === '/outcome'
    const expectedGrantToken = isOutcomeRequest ? recoveryGrantToken : mutationGrantToken
    if (request.headers.authorization !== `Bearer ${expectedGrantToken}`) {
      response.statusCode = 401
      response.end(JSON.stringify({ error: 'grant rejected' }))
      return
    }
    if (request.method === 'GET' && request.url === '/input') {
      response.end(JSON.stringify({ input: prepareInput }))
      return
    }
    if (request.method === 'PUT' && request.url === '/prepared') {
      prepared = await readJsonBody(request)
      status = 'prepared'
      response.end(JSON.stringify({ outcome: { status } }))
      return
    }
    if (request.method === 'POST' && request.url === '/commit') {
      const body = await readJsonBody(request)
      assert.equal(body.candidateSha256, prepared.candidateProject.sha256)
      if (status !== 'committed') commitCount += 1
      status = 'committed'
      response.end(JSON.stringify({ receipt: { status } }))
      return
    }
    if (request.method === 'GET' && request.url === '/outcome') {
      response.end(
        JSON.stringify({
          outcome: {
            ...outcomeExtras,
            operationId: prepareInput.operationId,
            status,
            ...(prepared
              ? { candidateSha256: prepared.candidateProject.sha256 }
              : initialCandidateSha256
                ? { candidateSha256: initialCandidateSha256 }
                : {}),
          },
        }),
      )
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'not found' }))
  })
  hono.listen(0, '127.0.0.1')
  await once(hono, 'listening')
  const address = hono.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    endpoints: {
      input: `${origin}/input`,
      prepared: `${origin}/prepared`,
      commit: `${origin}/commit`,
      outcome: `${origin}/outcome`,
    },
    requests,
    getCommitCount: () => commitCount,
    async close() {
      hono.close()
      await once(hono, 'close')
    },
  }
}

let server

test.before(async () => {
  server = await startServer()
})

test.after(async () => {
  await stopServer(server)
})

test('five fresh browser/context runs produce strict full-envelope candidates', { timeout: 180_000 }, async () => {
  const browserSessionIds = new Set()
  const suffix = 'repeat-identical'
  const input = await createMinimalExecutionInput({ suffix })
  let baselineCandidate
  for (let run = 1; run <= 5; run += 1) {
    const result = await executeDocument(input, { dashboardUrl: DASHBOARD_URL })

    assert.deepEqual(Object.keys(result).sort(), [...PREPARED_RESULT_KEYS].sort())
    assert.equal(result.contractVersion, 'easy-dashboard.executor.v1')
    assert.equal(result.semanticReceipt.status, 'applied')
    assert.equal(result.semanticReceipt.branchId, 'draft')
    assert.equal(result.semanticReceipt.callId, input.prepareInput.invocation.callId)
    assert.equal(result.semanticReceipt.revision, result.postRevision)
    assert.notEqual(result.preRevision, result.postRevision)
    assert.equal(result.evidence.consoleErrors.length, 0)
    assert.equal(result.evidence.render.rendererReady, true)
    assert.match(result.evidence.render.screenshotSha256, /^[a-f0-9]{64}$/u)
    assert.deepEqual(result.evidence.render.viewport, { width: 1920, height: 1080 })
    assert.equal(result.evidence.render.layout.status, 'passed')
    assert.equal(result.evidence.render.layout.viewportMatchesTarget, true)
    assert.deepEqual(result.evidence.render.layout.browserViewport, { width: 1920, height: 1080 })
    assert.deepEqual(result.evidence.render.layout.simulatorViewport, {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
    assert.equal(result.evidence.render.layout.componentElementCount, 1)
    assert.equal(result.evidence.render.layout.visibleElementCount, 1)
    assert.equal(result.evidence.render.layout.hiddenElementCount, 0)
    assert.equal(result.evidence.render.layout.zeroAreaElementCount, 0)
    assert.equal(result.evidence.render.layout.overflowingElementCount, 0)
    assert.equal(result.evidence.render.layout.clippedElementCount, 0)
    assert.deepEqual(result.evidence.render.layout.documentOverflow, { horizontal: false, vertical: false })

    const candidate = result.candidateProject.schema
    assert.equal(candidate.formatVersion, 1)
    assert.deepEqual(
      candidate.presentation,
      input.prepareInput.baseProject.schema.presentation,
      'presentation metadata must survive the editor-only Host round trip',
    )
    assert.equal(candidate.editorSchema.componentsTree[0].children[0].props.text, `After executor ${suffix}`)
    const expectedEnvelope = structuredClone(input.prepareInput.baseProject.schema)
    expectedEnvelope.editorSchema = candidate.editorSchema
    assert.deepEqual(candidate, expectedEnvelope, 'only editorSchema may change inside the project envelope')
    const serialized = canonicalJson(candidate)
    assert.equal(result.candidateProject.bytes, Buffer.byteLength(serialized, 'utf8'))
    assert.equal(result.candidateProject.sha256, sha256(serialized))
    if (baselineCandidate) assert.deepEqual(result.candidateProject, baselineCandidate)
    else baselineCandidate = structuredClone(result.candidateProject)

    const isolation = result.evidence.console.find(entry =>
      entry.message.startsWith('document-executor isolation verified:'),
    )
    assert.ok(isolation)
    assert.match(isolation.message, /contexts=2/u)
    assert.match(isolation.message, /hostPersistence=memory/u)
    assert.match(isolation.message, /reloadEditUndo=verified/u)
    assert.match(isolation.message, /primaryCookiesBefore=0/u)
    assert.match(isolation.message, /primaryCookiesAfter=0/u)
    assert.match(isolation.message, /verificationCookiesBefore=0/u)
    assert.match(isolation.message, /verificationCookiesAfter=0/u)
    for (const field of [
      'primaryLocalStorageBefore',
      'primarySessionStorageBefore',
      'verificationLocalStorageBefore',
      'verificationSessionStorageBefore',
    ]) {
      assert.match(isolation.message, new RegExp(`${field}=0`, 'u'))
    }
    for (const field of [
      'primaryLocalStorageAfter',
      'primarySessionStorageAfter',
      'verificationLocalStorageAfter',
      'verificationSessionStorageAfter',
    ]) {
      assert.match(isolation.message, new RegExp(`${field}=\\d+`, 'u'))
    }
    const browserId = isolation.message.match(/browser=([a-f0-9-]+)/u)?.[1]
    assert.ok(browserId)
    browserSessionIds.add(browserId)
    const materialEvidence = result.evidence.console.find(entry =>
      entry.message.startsWith('document-executor material manifest verified:'),
    )
    assert.ok(materialEvidence)
    assert.match(materialEvidence.message, new RegExp(`schemaVersion=${FIXTURE_MATERIAL_MANIFEST.version}`, 'u'))
    assert.match(materialEvidence.message, /registryVersion=\d+/u)
    assert.match(
      materialEvidence.message,
      new RegExp(`sha256=${input.prepareInput.compatibility.materialManifestSha256}`, 'u'),
    )
    assert.ok(result.evidence.materials.loaded.some(material => material.materialId === 'Root'))
    assert.ok(result.evidence.materials.loaded.some(material => material.materialId === 'Text'))
    const loadedMaterialIds = new Set(result.evidence.materials.loaded.map(material => material.materialId))
    assert.ok(
      result.evidence.materials.loaded.every(material => material.version === FIXTURE_MATERIAL_MANIFEST.version),
    )
    for (const materialId of BUNDLED_EASY_EDITOR_MATERIAL_IDS) {
      assert.ok(loadedMaterialIds.has(materialId), `Host writable manifest must include ${materialId}`)
    }
    const artifactEvidence = result.evidence.console.find(entry =>
      entry.message.startsWith('document-executor browser artifacts verified:'),
    )
    assert.ok(artifactEvidence)
    assert.match(artifactEvidence.message, /files=[1-9]\d*/u)
    assert.match(artifactEvidence.message, /manifestRequests=[1-9]\d*/u)
    assert.match(artifactEvidence.message, /developmentRequests=0/u)
    assert.match(artifactEvidence.message, /unexpectedProvenanceRequests=0/u)
    assert.doesNotMatch(artifactEvidence.message, /\/src|\/@@?fs|\/@@?vite|@react-refresh|node_modules\/\.vite/u)

    const serializedResult = JSON.stringify(result)
    assert.doesNotMatch(serializedResult, new RegExp(input.grantToken, 'u'))
    assert.doesNotMatch(serializedResult, /postgres(?:ql)?:\/\//iu)
  }
  assert.equal(browserSessionIds.size, 5)
})

test(
  'render evidence uses the project target viewport and reports deterministic overflow',
  { timeout: 60_000 },
  async () => {
    const suffix = 'target-viewport-overflow'
    const input = await createMinimalExecutionInput({ suffix })
    const root = input.prepareInput.baseProject.schema.editorSchema.componentsTree[0]
    root.$dashboard.rect.width = 1600
    root.$dashboard.rect.height = 900
    input.prepareInput.invocation.arguments.operations = [
      {
        opId: 'overflow-title',
        type: 'set',
        nodeId: `document-executor-title-${suffix}`,
        fieldId: 'shared.rect',
        value: { x: 1500, y: 80, width: 720, height: 80 },
      },
    ]
    const serialized = canonicalJson(input.prepareInput.baseProject.schema)
    input.prepareInput.baseProject.bytes = Buffer.byteLength(serialized, 'utf8')
    input.prepareInput.baseProject.sha256 = sha256(serialized)

    const result = await executeDocument(input, { dashboardUrl: DASHBOARD_URL })

    assert.deepEqual(result.evidence.render.viewport, { width: 1600, height: 900 })
    assert.deepEqual(result.evidence.render.layout.targetViewport, { width: 1600, height: 900 })
    assert.deepEqual(result.evidence.render.layout.browserViewport, { width: 1600, height: 900 })
    assert.equal(result.evidence.render.layout.viewportMatchesTarget, true)
    assert.equal(result.evidence.render.layout.status, 'failed')
    assert.equal(result.evidence.render.layout.visibleElementCount, 1)
    assert.equal(result.evidence.render.layout.overflowingElementCount, 1)
    assert.equal(result.evidence.render.layout.clippedElementCount, 1)
  },
)

test('render viewport is bounded before Chromium launches', async () => {
  const input = await createMinimalExecutionInput({ suffix: 'render-budget' })
  const root = input.prepareInput.baseProject.schema.editorSchema.componentsTree[0]
  root.$dashboard.rect.width = 16_384
  const serialized = canonicalJson(input.prepareInput.baseProject.schema)
  input.prepareInput.baseProject.bytes = Buffer.byteLength(serialized, 'utf8')
  input.prepareInput.baseProject.sha256 = sha256(serialized)

  await assert.rejects(
    executeDocument(input, { dashboardUrl: DASHBOARD_URL }),
    error => error instanceof DocumentExecutorError && error.code === 'INVALID_RENDER_VIEWPORT',
  )
})

test(
  'remove plus insert keeps browser provenance at the exact candidate and mutation closure',
  { timeout: 60_000 },
  async () => {
    const suffix = 'replace-legacy-node'
    const input = await createMinimalExecutionInput({ suffix })
    const rootId = `document-executor-root-${suffix}`
    input.prepareInput.invocation.arguments.operations = [
      { opId: 'remove-legacy', type: 'remove', nodeId: `document-executor-title-${suffix}` },
      {
        opId: 'set-root',
        type: 'set',
        nodeId: rootId,
        fieldId: 'props.backgroundColor',
        value: '#edf2f6',
      },
      {
        opId: 'insert-header',
        type: 'insert',
        parentId: rootId,
        componentName: 'Text',
        position: { place: 'first' },
        fields: {
          'props.text': 'Header',
          'shared.title': 'Header',
          'shared.rect': { x: 55, y: 92, width: 800, height: 54 },
        },
      },
      {
        opId: 'insert-kpi',
        type: 'insert',
        parentId: rootId,
        componentName: 'Text',
        position: { place: 'first' },
        fields: {
          'props.text': 'KPI',
          'shared.title': 'KPI',
          'shared.rect': { x: 55, y: 169, width: 417, height: 145 },
        },
      },
    ]

    const result = await executeDocument(input, { dashboardUrl: DASHBOARD_URL })
    const root = result.candidateProject.schema.editorSchema.componentsTree[0]
    assert.equal(root.props.backgroundColor, '#edf2f6')
    assert.deepEqual(root.children.map(node => node.props.text).sort(), ['Header', 'KPI'])
    assert.ok(result.semanticReceipt.witness.affectedSlotTokens.some(({ slotKey }) => slotKey.includes('/existence')))
  },
)

test(
  'nested move keeps browser provenance for a newly populated parent children order',
  { timeout: 60_000 },
  async () => {
    const suffix = 'nested-move-provenance'
    const input = await createMinimalExecutionInput({ suffix })
    const parentId = `document-executor-container-${suffix}`
    input.prepareInput.baseProject.schema.editorSchema.componentsMap.push({
      devMode: 'lowCode',
      componentName: 'Div',
      version: 'workspace',
    })
    input.prepareInput.baseProject.schema.editorSchema.componentsTree[0].children.push({
      id: parentId,
      componentName: 'Div',
      props: { background: 'transparent' },
      children: [],
    })
    const serializedProject = canonicalJson(input.prepareInput.baseProject.schema)
    input.prepareInput.baseProject.bytes = Buffer.byteLength(serializedProject, 'utf8')
    input.prepareInput.baseProject.sha256 = sha256(serializedProject)
    input.prepareInput.invocation.arguments.operations = [
      {
        opId: 'move-child',
        type: 'move',
        nodeId: `document-executor-title-${suffix}`,
        parentId,
        position: { place: 'last' },
      },
    ]

    const result = await executeDocument(input, { dashboardUrl: DASHBOARD_URL })
    const parent = result.candidateProject.schema.editorSchema.componentsTree[0].children.find(
      node => node.id === parentId,
    )
    assert.deepEqual(
      parent?.children.map(node => node.props.text),
      ['Before executor'],
    )
  },
)

test('presentation.startPageId selects the active page in a multi-page project', { timeout: 60_000 }, async () => {
  const input = await createMinimalExecutionInput({ suffix: 'multi-page' })
  const storedProject = input.prepareInput.baseProject.schema
  const inactivePage = structuredClone(storedProject.editorSchema.componentsTree[0])
  inactivePage.id = 'document-executor-root-inactive'
  inactivePage.docId = 'document-executor-page-inactive'
  inactivePage.fileName = 'inactive'
  inactivePage.children[0].id = 'document-executor-title-inactive'
  inactivePage.children[0].props.text = 'Inactive page remains unchanged'
  storedProject.editorSchema.componentsTree.unshift(inactivePage)
  const serialized = canonicalJson(storedProject)
  input.prepareInput.baseProject = {
    schema: storedProject,
    bytes: Buffer.byteLength(serialized, 'utf8'),
    sha256: sha256(serialized),
  }

  const result = await executeDocument(input, { dashboardUrl: DASHBOARD_URL }).catch(error => {
    assert.fail(`${error.code}: ${error.message}; details=${JSON.stringify(error.details)}`)
  })

  assert.equal(
    result.candidateProject.schema.editorSchema.componentsTree[0].children[0].props.text,
    'Inactive page remains unchanged',
  )
  assert.equal(
    result.candidateProject.schema.editorSchema.componentsTree[1].children[0].props.text,
    'After executor multi-page',
  )
})

test('stale seam fails before candidate preparation', { timeout: 60_000 }, async () => {
  const input = await createMinimalExecutionInput({
    suffix: 'stale',
    seams: { staleAfterObserve: true },
  })
  await assert.rejects(
    executeDocument(input, { dashboardUrl: DASHBOARD_URL }),
    error => error instanceof DocumentExecutorError && error.code === 'STALE_REVISION',
  )
})

test('crash seam terminates after apply and remains machine-detectable', { timeout: 60_000 }, async () => {
  const input = await createMinimalExecutionInput({
    suffix: 'crash',
    seams: { crashAfterApply: true },
  })
  await assert.rejects(
    executeDocument(input, { dashboardUrl: DASHBOARD_URL }),
    error =>
      error instanceof DocumentExecutorError &&
      error.code === 'FORCED_CRASH_AFTER_APPLY' &&
      error.details.receipt?.status === 'applied',
  )
})

test('a forbidden browser resource request fails the M0 operation', { timeout: 60_000 }, async () => {
  const input = await createMinimalExecutionInput({
    suffix: 'forbidden-browser-resource',
    seams: { forbiddenResourceRequest: true },
  })
  await assert.rejects(
    executeDocument(input, { dashboardUrl: DASHBOARD_URL }),
    error =>
      error instanceof DocumentExecutorError &&
      error.code === 'FORBIDDEN_BROWSER_RESOURCE_REQUEST' &&
      error.details.blockedNetworkRequests?.length === 1,
  )
})

test('a same-origin resource outside the static manifest fails closed', { timeout: 60_000 }, async () => {
  const input = await createMinimalExecutionInput({
    suffix: 'unexpected-static-resource',
    seams: { unexpectedArtifactRequest: true },
  })
  await assert.rejects(
    executeDocument(input, { dashboardUrl: DASHBOARD_URL }),
    error =>
      error instanceof DocumentExecutorError &&
      error.code === 'FORBIDDEN_BROWSER_RESOURCE_REQUEST' &&
      error.details.blockedNetworkRequests?.some(request => request.url.endsWith('/unexpected-browser-artifact.js')),
  )
})

test('tampered static JavaScript fails artifact verification before Chromium and Host', async () => {
  const artifactDirectory = fileURLToPath(new URL('../.browser-dist/', import.meta.url))
  const manifest = await createBrowserArtifactManifest(artifactDirectory)
  const paths = new Set(Object.keys(manifest.files))
  const tamperedServer = createServer(async (request, response) => {
    const relativePath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname.slice(1))
    if (!paths.has(relativePath)) {
      response.statusCode = 404
      response.end()
      return
    }
    const bytes = await readFile(join(artifactDirectory, relativePath))
    response.statusCode = 200
    response.setHeader(
      'content-type',
      relativePath.endsWith('.html')
        ? 'text/html'
        : relativePath.endsWith('.js')
          ? 'text/javascript'
          : relativePath.endsWith('.css')
            ? 'text/css'
            : 'application/octet-stream',
    )
    response.end(relativePath.endsWith('.js') ? Buffer.concat([bytes, Buffer.from('\n/* tampered */')]) : bytes)
  })
  tamperedServer.listen(0, '127.0.0.1')
  await once(tamperedServer, 'listening')
  const address = tamperedServer.address()
  assert.ok(address && typeof address !== 'string')
  try {
    const input = await createMinimalExecutionInput({ suffix: 'tampered-static-js' })
    const dashboardUrl = `http://127.0.0.1:${address.port}/index.html`
    await assert.rejects(
      executeDocument(input, {
        dashboardUrl,
      }),
      error =>
        error instanceof DocumentExecutorError &&
        error.code === 'BROWSER_ARTIFACT_MISMATCH' &&
        !JSON.stringify(error).includes('tampered'),
    )

    const cli = spawn(process.execPath, ['src/cli.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL: dashboardUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    cli.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    cli.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    cli.stdin.end(JSON.stringify(input))
    const [exitCode] = await once(cli, 'exit')
    assert.equal(exitCode, 1)
    assert.equal(stderr, '')
    assert.deepEqual(JSON.parse(stdout).failure, {
      code: 'BROWSER_ARTIFACT_MISMATCH',
      message: 'Browser artifact verification failed',
    })
    assert.doesNotMatch(stdout, /tampered/u)
    assert.doesNotMatch(stdout, new RegExp(input.grantToken, 'u'))
  } finally {
    tamperedServer.close()
    await once(tamperedServer, 'close')
  }
})

test('stateful static JavaScript tampering is rejected in both browser contexts after a clean preflight', async () => {
  for (const [label, tamperJavaScriptAt] of [
    ['primary', 2],
    ['verification', 3],
  ]) {
    const stateful = await startStatefulArtifactServer({ tamperJavaScriptAt })
    try {
      const input = await createMinimalExecutionInput({ suffix: `stateful-${label}-tamper` })
      await assert.rejects(
        executeDocument(input, { dashboardUrl: stateful.dashboardUrl }),
        error =>
          error instanceof DocumentExecutorError &&
          error.code === 'BROWSER_ARTIFACT_MISMATCH' &&
          !JSON.stringify(error).includes('stateful-tamper-body') &&
          !JSON.stringify(error).includes(input.grantToken),
      )
    } finally {
      await stateful.close()
    }
  }

  const statefulCli = await startStatefulArtifactServer({ tamperJavaScriptAt: 2 })
  try {
    const input = await createMinimalExecutionInput({ suffix: 'stateful-cli-tamper' })
    const cli = spawn(process.execPath, ['src/cli.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL: statefulCli.dashboardUrl },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    cli.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    cli.stdin.end(JSON.stringify(input))
    const [exitCode] = await once(cli, 'exit')
    assert.equal(exitCode, 1)
    assert.deepEqual(JSON.parse(stdout).failure, {
      code: 'BROWSER_ARTIFACT_MISMATCH',
      message: 'Browser artifact verification failed',
    })
    assert.doesNotMatch(stdout, /stateful-tamper-body/u)
    assert.doesNotMatch(stdout, new RegExp(input.grantToken, 'u'))
  } finally {
    await statefulCli.close()
  }
})

test('a real VITE_E2E=0 Harness fails before Host invocation', { timeout: 60_000 }, async () => {
  const port = PORT + 1
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-non-e2e-browser-dist-'))
  await buildBrowserArtifact({ artifactDirectory, viteE2E: '0' })
  const nonE2EServer = await startServer({ port, artifactDirectory })
  try {
    const input = await createMinimalExecutionInput({ suffix: 'vite-e2e-zero' })
    input.prepareInput.compatibility = await computeWorkspaceArtifactCompatibility(
      {
        materialManifestVersion: FIXTURE_MATERIAL_MANIFEST.version,
        materialManifestSha256: FIXTURE_MATERIAL_MANIFEST.sha256,
      },
      { browserArtifactDirectory: artifactDirectory },
    )
    await assert.rejects(
      executeDocument(input, {
        dashboardUrl: `http://127.0.0.1:${port}/index.html`,
        artifactDirectory,
      }),
      error => error instanceof DocumentExecutorError && error.code === 'HARNESS_E2E_BUILD_REQUIRED',
    )
  } finally {
    await stopServer(nonE2EServer)
  }
})

test('executor rejects nested database credentials at its Node input boundary', async () => {
  const input = await createMinimalExecutionInput({
    suffix: 'credentials',
  })
  input.prepareInput.invocation.arguments.databaseUrl = 'postgres://not-accepted'
  await assert.rejects(
    executeDocument(input, { dashboardUrl: DASHBOARD_URL }),
    error => error instanceof DocumentExecutorError && error.code === 'CREDENTIAL_INPUT_FORBIDDEN',
  )
})

test('executor credential keys match the Hono contract and reject hidden mutation authority before Chromium', async () => {
  for (const key of ['databasePassword', 'pgPassword', 'supabaseServiceRoleKey']) {
    const input = await createMinimalExecutionInput({ suffix: `credential-key-${key}` })
    input.prepareInput.baseProject.schema.presentation[key] = 'must-not-enter-browser'
    await assert.rejects(
      executeDocument(input, { dashboardUrl: 'http://127.0.0.1:1/index.html' }),
      error => error instanceof DocumentExecutorError && error.code === 'CREDENTIAL_INPUT_FORBIDDEN',
    )
  }

  const input = await createMinimalExecutionInput({ suffix: 'hidden-mutation-grant' })
  input.prepareInput.baseProject.schema.presentation.operatorNote = `Bearer ${input.grantToken}`
  await assert.rejects(
    executeDocument(input, { dashboardUrl: 'http://127.0.0.1:1/index.html' }),
    error =>
      error instanceof DocumentExecutorError &&
      error.code === 'CREDENTIAL_INPUT_FORBIDDEN' &&
      !error.message.includes(input.grantToken),
  )

  const cli = spawn(process.execPath, ['src/cli.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL: 'http://127.0.0.1:1/index.html' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  cli.stdout.on('data', chunk => {
    stdout += chunk.toString()
  })
  cli.stdin.end(JSON.stringify(input))
  const [exitCode] = await once(cli, 'exit')
  assert.equal(exitCode, 1)
  assert.equal(JSON.parse(stdout).failure.code, 'CREDENTIAL_INPUT_FORBIDDEN')
  assert.doesNotMatch(stdout, new RegExp(input.grantToken, 'u'))
})

test('workflow recovery authority hidden in prepare input fails before Chromium and Host', async () => {
  const prepareInput = await createMinimalPrepareInput('hidden-recovery-grant')
  const grantToken = 'hidden-recovery-mutation-token'
  const recoveryGrantToken = 'hidden-recovery-authority-token'
  prepareInput.baseProject.schema.presentation.operatorNote = `Bearer ${recoveryGrantToken}`
  const durable = await startDurableWorkflowServer(prepareInput, {
    mutationGrantToken: grantToken,
    recoveryGrantToken,
  })
  try {
    await assert.rejects(
      executeDocumentWorkflow(
        {
          operationId: prepareInput.operationId,
          grantToken,
          recoveryGrantToken,
          honoOrigin: durable.origin,
          endpoints: durable.endpoints,
        },
        { dashboardUrl: 'http://127.0.0.1:1/index.html' },
      ),
      error =>
        error instanceof DocumentExecutorError &&
        error.code === 'CREDENTIAL_INPUT_FORBIDDEN' &&
        !error.message.includes(recoveryGrantToken),
    )
    assert.deepEqual(
      durable.requests.map(request => `${request.method} ${request.url}`),
      ['GET /outcome', 'GET /input'],
    )
  } finally {
    await durable.close()
  }
})

test('browser storage rejects unrelated, credential, unexpected database, and IndexedDB record contamination', async () => {
  for (const [suffix, seams] of [
    ['storage-unrelated', { storageUnrelatedKey: true }],
    ['storage-credential', { storageCredentialValue: true }],
    [
      'storage-unexpected-db-verification',
      {
        storageUnexpectedDatabase: true,
        storageTarget: 'verification',
      },
    ],
    ['storage-indexeddb-credential', { storageIndexedDbCredential: true }],
  ]) {
    const input = await createMinimalExecutionInput({ suffix, seams })
    await assert.rejects(
      executeDocument(input, { dashboardUrl: DASHBOARD_URL }),
      error =>
        error instanceof DocumentExecutorError &&
        error.code === 'BROWSER_STORAGE_ISOLATION_FAILED' &&
        !JSON.stringify(error).includes(input.grantToken),
    )
  }

  const input = await createMinimalExecutionInput({
    suffix: 'storage-cli-credential',
    seams: { storageCredentialValue: true },
  })
  const cli = spawn(process.execPath, ['src/cli.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL: DASHBOARD_URL },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  cli.stdout.on('data', chunk => {
    stdout += chunk.toString()
  })
  cli.stdin.end(JSON.stringify(input))
  const [exitCode] = await once(cli, 'exit')
  assert.equal(exitCode, 1)
  assert.deepEqual(JSON.parse(stdout).failure, {
    code: 'BROWSER_STORAGE_ISOLATION_FAILED',
    message: 'Browser storage isolation verification failed',
  })
  assert.doesNotMatch(stdout, /browser-storage-credential/u)
  assert.doesNotMatch(stdout, new RegExp(input.grantToken, 'u'))
})

test('operation input cannot select the Harness browser origin', async () => {
  const input = await createMinimalExecutionInput({ suffix: 'forbidden-origin' })
  await assert.rejects(
    executeDocument(
      { ...input, dashboardUrl: 'https://operation-controlled.invalid' },
      {
        dashboardUrl: DASHBOARD_URL,
      },
    ),
    error => error instanceof DocumentExecutorError && error.code === 'OPERATION_ORIGIN_FORBIDDEN',
  )
})

test('operation input cannot select the browser artifact directory', async () => {
  const input = await createMinimalExecutionInput({ suffix: 'forbidden-artifact-directory' })
  await assert.rejects(
    executeDocument({ ...input, artifactDirectory: '/tmp/operator-controlled' }, { dashboardUrl: DASHBOARD_URL }),
    error => error instanceof DocumentExecutorError && error.code === 'OPERATION_ORIGIN_FORBIDDEN',
  )
})

test('operator dashboard origin accepts only credential-free loopback HTTP without fragments', async () => {
  const input = await createMinimalExecutionInput({ suffix: 'invalid-operator-origin' })
  for (const dashboardUrl of [
    'https://127.0.0.1:5173/editor',
    'http://192.0.2.1:5173/editor',
    'http://user:password@127.0.0.1:5173/editor',
    'http://127.0.0.1:5173/index.html#fragment',
    'ftp://localhost/index.html',
    'not a URL',
  ]) {
    await assert.rejects(
      executeDocument(input, { dashboardUrl }),
      error =>
        error instanceof DocumentExecutorError &&
        error.code === 'INVALID_OPERATOR_DASHBOARD_URL' &&
        Object.keys(error.details).length === 0,
    )
  }
})

test('executor rejects a tuple that is not bound to its built workspace artifacts', async () => {
  const input = await createMinimalExecutionInput({
    suffix: 'artifact-mismatch',
  })
  input.prepareInput.compatibility.runtimeSha256 = '7'.repeat(64)
  await assert.rejects(
    executeDocument(input, { dashboardUrl: DASHBOARD_URL }),
    error => error instanceof DocumentExecutorError && error.code === 'WORKSPACE_ARTIFACT_MISMATCH',
  )
})

test(
  'executor rejects a material manifest hash that is not the Host-observed binding',
  { timeout: 60_000 },
  async () => {
    const input = await createMinimalExecutionInput({
      suffix: 'material-mismatch',
    })
    input.prepareInput.compatibility.materialManifestSha256 = '6'.repeat(64)
    await assert.rejects(
      executeDocument(input, { dashboardUrl: DASHBOARD_URL }),
      error => error instanceof DocumentExecutorError && error.code === 'MATERIAL_MANIFEST_MISMATCH',
    )
  },
)

test('workspace compatibility hashes real artifacts and changes with artifact bytes', async () => {
  const compatibility = await computeWorkspaceArtifactCompatibility({
    materialManifestVersion: FIXTURE_MATERIAL_MANIFEST.version,
    materialManifestSha256: FIXTURE_MATERIAL_MANIFEST.sha256,
  })
  for (const key of ['runtimeSha256', 'coreSha256', 'rendererSha256', 'dashboardAgentHostSha256']) {
    assert.match(compatibility[key], /^[a-f0-9]{64}$/u)
    assert.doesNotMatch(compatibility[key], /^(.)\1{63}$/u)
  }
  assert.equal(compatibility.browserArtifactVersion, '0.0.0')
  assert.match(compatibility.browserArtifactSha256, /^[a-f0-9]{64}$/u)

  const firstDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-artifact-hash-a-'))
  const secondDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-artifact-hash-b-'))
  await writeFile(join(firstDirectory, 'artifact.js'), 'export const value = 1\n')
  await writeFile(join(secondDirectory, 'artifact.js'), 'export const value = 1\n')
  const before = await hashWorkspaceArtifactDirectory(firstDirectory)
  assert.equal(await hashWorkspaceArtifactDirectory(secondDirectory), before)
  await writeFile(join(firstDirectory, 'artifact.js'), 'export const value = 2\n')
  const after = await hashWorkspaceArtifactDirectory(firstDirectory)
  assert.notEqual(after, before)

  const firstBrowserDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-browser-hash-a-'))
  const secondBrowserDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-browser-hash-b-'))
  for (const directory of [firstBrowserDirectory, secondBrowserDirectory]) {
    await mkdir(join(directory, 'assets'), { recursive: true })
    await writeFile(join(directory, 'index.html'), '<!doctype html>\n')
    await writeFile(join(directory, 'assets', 'style.css'), 'body { color: red; }\n')
  }
  const firstBrowserManifest = await createBrowserArtifactManifest(firstBrowserDirectory)
  const secondBrowserManifest = await createBrowserArtifactManifest(secondBrowserDirectory)
  assert.equal(firstBrowserManifest.sha256, secondBrowserManifest.sha256)
  assert.deepEqual(firstBrowserManifest.files, secondBrowserManifest.files)
  assert.deepEqual(Object.keys(firstBrowserManifest.files), ['assets/style.css', 'index.html'])
  await writeFile(join(firstBrowserDirectory, 'assets', 'style.css'), 'body { color: blue; }\n')
  const changedBrowserManifest = await createBrowserArtifactManifest(firstBrowserDirectory)
  assert.notEqual(changedBrowserManifest.sha256, firstBrowserManifest.sha256)
  assert.notEqual(changedBrowserManifest.files['assets/style.css'], firstBrowserManifest.files['assets/style.css'])

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'easy-editor-dist-compatibility-'))
  const browserArtifactDirectory = await mkdtemp(join(tmpdir(), 'easy-editor-browser-artifact-'))
  await writeFile(join(browserArtifactDirectory, 'index.html'), '<!doctype html><title>artifact</title>')
  await mkdir(join(workspaceRoot, 'spikes', 'document-executor'), { recursive: true })
  await writeFile(
    join(workspaceRoot, 'spikes', 'document-executor', 'package.json'),
    JSON.stringify({ version: '0.0.0' }),
  )
  const artifactPackages = [
    ['agent-runtime', '0.0.0'],
    ['core', '1.0.3'],
    ['react-renderer-dashboard', '1.0.4'],
    ['dashboard-agent-host', '0.0.0'],
  ]
  for (const [packageName, version] of artifactPackages) {
    await mkdir(join(workspaceRoot, 'packages', packageName, 'dist'), { recursive: true })
    await writeFile(join(workspaceRoot, 'packages', packageName, 'package.json'), JSON.stringify({ version }))
    await writeFile(join(workspaceRoot, 'packages', packageName, 'dist', 'index.js'), 'export const value = 1\n')
  }
  const distTupleBefore = await computeWorkspaceArtifactCompatibility(
    {
      materialManifestVersion: FIXTURE_MATERIAL_MANIFEST.version,
      materialManifestSha256: FIXTURE_MATERIAL_MANIFEST.sha256,
    },
    { workspaceRoot, browserArtifactDirectory },
  )
  await writeFile(join(workspaceRoot, 'packages', 'core', 'dist', 'index.js'), 'export const value = 2\n')
  const distTupleAfter = await computeWorkspaceArtifactCompatibility(
    {
      materialManifestVersion: FIXTURE_MATERIAL_MANIFEST.version,
      materialManifestSha256: FIXTURE_MATERIAL_MANIFEST.sha256,
    },
    { workspaceRoot, browserArtifactDirectory },
  )
  assert.notEqual(
    distTupleAfter.coreSha256,
    distTupleBefore.coreSha256,
    'changing browser-aliased dist bytes must change the compatibility tuple',
  )
})

test(
  'Node-only bearer workflow checks outcome before GET input, PUT prepared, POST commit, and final outcome',
  { timeout: 60_000 },
  async () => {
    const suffix = 'workflow'
    const prepareInput = await createMinimalPrepareInput(suffix)
    const grantToken = 'grant-node-only-workflow-mutation'
    const recoveryGrantToken = 'grant-node-only-workflow-recovery'
    const durable = await startDurableWorkflowServer(prepareInput, {
      mutationGrantToken: grantToken,
      recoveryGrantToken,
    })

    try {
      const result = await executeDocumentWorkflow(
        {
          operationId: prepareInput.operationId,
          grantToken,
          recoveryGrantToken,
          honoOrigin: durable.origin,
          endpoints: durable.endpoints,
        },
        { dashboardUrl: DASHBOARD_URL },
      )
      assert.equal(result.outcome.status, 'committed')
      assert.equal(result.prepared.semanticReceipt.status, 'applied')
      assert.deepEqual(result.recovery, {
        classification: 'executed',
        browserExecuted: true,
      })
      assert.deepEqual(
        durable.requests.map(request => `${request.method} ${request.url}`),
        ['GET /outcome', 'GET /input', 'PUT /prepared', 'POST /commit', 'GET /outcome'],
      )
      for (const request of durable.requests) {
        assert.equal(
          request.authorization,
          request.url === '/outcome' ? `Bearer ${recoveryGrantToken}` : `Bearer ${grantToken}`,
        )
      }
      for (const request of durable.requests.filter(item => item.method !== 'GET')) {
        assert.equal(request.origin, durable.origin)
        assert.equal(request.csrf, '1')
      }
      assert.doesNotMatch(JSON.stringify(result), new RegExp(grantToken, 'u'))
      assert.doesNotMatch(JSON.stringify(result), new RegExp(recoveryGrantToken, 'u'))
    } finally {
      await durable.close()
    }
  },
)

test('crash after durable prepare resumes commit without a second browser execution', { timeout: 60_000 }, async () => {
  const prepareInput = await createMinimalPrepareInput('recover-prepared')
  const grantToken = 'grant-recover-prepared-mutation'
  const recoveryGrantToken = 'grant-recover-prepared-outcome'
  const durable = await startDurableWorkflowServer(prepareInput, {
    mutationGrantToken: grantToken,
    recoveryGrantToken,
  })
  const workflow = {
    operationId: prepareInput.operationId,
    grantToken,
    recoveryGrantToken,
    honoOrigin: durable.origin,
    endpoints: durable.endpoints,
  }
  try {
    await assert.rejects(
      executeDocumentWorkflow(
        {
          ...workflow,
          seams: { crashAfterPrepare: true },
        },
        { dashboardUrl: DASHBOARD_URL },
      ),
      error => error instanceof DocumentExecutorError && error.code === 'FORCED_CRASH_AFTER_PREPARE',
    )
    const restartRequestIndex = durable.requests.length
    const recovered = await executeDocumentWorkflow(workflow, {
      dashboardUrl: DASHBOARD_URL,
    })
    assert.equal(recovered.prepared, null)
    assert.equal(recovered.outcome.status, 'committed')
    assert.deepEqual(recovered.recovery, {
      classification: 'prepared',
      browserExecuted: false,
    })
    assert.deepEqual(
      durable.requests.slice(restartRequestIndex).map(request => `${request.method} ${request.url}`),
      ['GET /outcome', 'POST /commit', 'GET /outcome'],
    )
    assert.equal(durable.getCommitCount(), 1)
  } finally {
    await durable.close()
  }
})

test(
  'crash after commit acknowledgement returns committed outcome without repeating commit or browser',
  { timeout: 60_000 },
  async () => {
    const prepareInput = await createMinimalPrepareInput('recover-committed')
    const grantToken = 'grant-recover-committed-mutation'
    const recoveryGrantToken = 'grant-recover-committed-outcome'
    const durable = await startDurableWorkflowServer(prepareInput, {
      mutationGrantToken: grantToken,
      recoveryGrantToken,
    })
    const workflow = {
      operationId: prepareInput.operationId,
      grantToken,
      recoveryGrantToken,
      honoOrigin: durable.origin,
      endpoints: durable.endpoints,
    }
    try {
      await assert.rejects(
        executeDocumentWorkflow(
          {
            ...workflow,
            seams: { crashAfterCommitAck: true },
          },
          { dashboardUrl: DASHBOARD_URL },
        ),
        error => error instanceof DocumentExecutorError && error.code === 'FORCED_CRASH_AFTER_COMMIT_ACK',
      )
      const restartRequestIndex = durable.requests.length
      const recovered = await executeDocumentWorkflow(workflow, {
        dashboardUrl: DASHBOARD_URL,
      })
      assert.equal(recovered.prepared, null)
      assert.equal(recovered.outcome.status, 'committed')
      assert.deepEqual(recovered.recovery, {
        classification: 'committed',
        browserExecuted: false,
      })
      assert.deepEqual(
        durable.requests.slice(restartRequestIndex).map(request => `${request.method} ${request.url}`),
        ['GET /outcome'],
      )
      assert.equal(durable.getCommitCount(), 1)
    } finally {
      await durable.close()
    }
  },
)

test('expired mutation grant cannot block committed recovery through the exact outcome grant', async () => {
  const prepareInput = await createMinimalPrepareInput('expired-mutation-recovery')
  const grantToken = 'expired-mutation-grant'
  const recoveryGrantToken = 'valid-exact-outcome-recovery-grant'
  const durable = await startDurableWorkflowServer(prepareInput, {
    mutationGrantToken: 'server-rejects-the-expired-mutation-grant',
    recoveryGrantToken,
    initialStatus: 'committed',
    initialCandidateSha256: '8'.repeat(64),
  })
  try {
    const recovered = await executeDocumentWorkflow(
      {
        operationId: prepareInput.operationId,
        grantToken,
        recoveryGrantToken,
        honoOrigin: durable.origin,
        endpoints: durable.endpoints,
      },
      { dashboardUrl: 'http://127.0.0.1:1/unreachable-browser' },
    )
    assert.equal(recovered.prepared, null)
    assert.equal(recovered.outcome.status, 'committed')
    assert.deepEqual(recovered.recovery, {
      classification: 'committed',
      browserExecuted: false,
    })
    assert.deepEqual(
      durable.requests.map(request => `${request.method} ${request.url}`),
      ['GET /outcome'],
    )
    assert.equal(durable.requests[0].authorization, `Bearer ${recoveryGrantToken}`)
    assert.equal(durable.getCommitCount(), 0)
    assert.doesNotMatch(JSON.stringify(recovered), new RegExp(grantToken, 'u'))
    assert.doesNotMatch(JSON.stringify(recovered), new RegExp(recoveryGrantToken, 'u'))
  } finally {
    await durable.close()
  }
})

test('successful CLI recovery drops arbitrary durable outcome fields', async () => {
  const prepareInput = await createMinimalPrepareInput('successful-outcome-sanitization')
  const grantToken = 'successful-outcome-mutation-token'
  const recoveryGrantToken = 'successful-outcome-recovery-token'
  const durable = await startDurableWorkflowServer(prepareInput, {
    mutationGrantToken: grantToken,
    recoveryGrantToken,
    initialStatus: 'committed',
    initialCandidateSha256: '9'.repeat(64),
    outcomeExtras: {
      reflectedToken: recoveryGrantToken,
      arbitrary: {
        authorization: `Bearer ${recoveryGrantToken}`,
      },
    },
  })
  try {
    const cli = spawn(process.execPath, ['src/cli.mjs'], {
      cwd: new URL('..', import.meta.url),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    cli.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    cli.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    cli.stdin.end(
      JSON.stringify({
        operationId: prepareInput.operationId,
        grantToken,
        recoveryGrantToken,
        honoOrigin: durable.origin,
        endpoints: durable.endpoints,
      }),
    )
    const [exitCode] = await once(cli, 'exit')
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
    const output = JSON.parse(stdout)
    assert.deepEqual(Object.keys(output.outcome).sort(), ['candidateSha256', 'operationId', 'status'])
    assert.doesNotMatch(stdout, /reflectedToken|authorization|Bearer/u)
    assert.doesNotMatch(stdout, new RegExp(recoveryGrantToken, 'u'))
  } finally {
    await durable.close()
  }
})

test('stale, failed, indeterminate, and unknown durable outcomes never request input', async () => {
  for (const status of ['rejected_stale', 'failed_not_applied', 'indeterminate', 'unknown']) {
    const prepareInput = await createMinimalPrepareInput(`blocked-outcome-${status}`)
    const grantToken = `mutation-${status}`
    const recoveryGrantToken = `recovery-${status}`
    const durable = await startDurableWorkflowServer(prepareInput, {
      mutationGrantToken: grantToken,
      recoveryGrantToken,
      initialStatus: status,
    })
    try {
      await assert.rejects(
        executeDocumentWorkflow(
          {
            operationId: prepareInput.operationId,
            grantToken,
            recoveryGrantToken,
            honoOrigin: durable.origin,
            endpoints: durable.endpoints,
          },
          { dashboardUrl: 'http://127.0.0.1:1/unreachable-browser' },
        ),
        error => error instanceof DocumentExecutorError && error.code === 'DURABLE_OUTCOME_NOT_EXECUTABLE',
      )
      assert.deepEqual(
        durable.requests.map(request => `${request.method} ${request.url}`),
        ['GET /outcome'],
      )
    } finally {
      await durable.close()
    }
  }
})

test('malicious durable status text cannot reflect a Bearer token through errors or CLI output', async () => {
  const prepareInput = await createMinimalPrepareInput('malicious-status-reflection')
  const grantToken = 'malicious-status-mutation-token'
  const recoveryGrantToken = 'malicious-status-recovery-token'
  const maliciousStatus = `blocked Bearer ${recoveryGrantToken}`
  const durable = await startDurableWorkflowServer(prepareInput, {
    mutationGrantToken: grantToken,
    recoveryGrantToken,
    initialStatus: maliciousStatus,
  })
  const workflow = {
    operationId: prepareInput.operationId,
    grantToken,
    recoveryGrantToken,
    honoOrigin: durable.origin,
    endpoints: durable.endpoints,
  }
  try {
    await assert.rejects(
      executeDocumentWorkflow(workflow, {
        dashboardUrl: 'http://127.0.0.1:1/unreachable-browser',
      }),
      error =>
        error instanceof DocumentExecutorError &&
        error.code === 'DURABLE_OUTCOME_NOT_EXECUTABLE' &&
        error.message === 'durable outcome forbids execution' &&
        !error.message.includes(recoveryGrantToken),
    )

    const cli = spawn(process.execPath, ['src/cli.mjs'], {
      cwd: new URL('..', import.meta.url),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    cli.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    cli.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    cli.stdin.end(JSON.stringify(workflow))
    const [exitCode] = await once(cli, 'exit')
    assert.equal(exitCode, 1)
    assert.equal(stderr, '')
    const output = JSON.parse(stdout)
    assert.deepEqual(output.failure, {
      code: 'DURABLE_OUTCOME_NOT_EXECUTABLE',
      message: 'Durable outcome forbids execution',
    })
    assert.doesNotMatch(stdout, /Bearer/u)
    assert.doesNotMatch(stdout, new RegExp(recoveryGrantToken, 'u'))
  } finally {
    await durable.close()
  }
})

test('outcome redirects fail closed without following or exposing response payloads', async () => {
  const prepareInput = await createMinimalPrepareInput('redirect-fail-closed')
  const recoveryGrantToken = 'redirect-recovery-token'
  const responseSecret = 'server-response-database-password'
  const requests = []
  const redirectServer = createServer((request, response) => {
    requests.push(request.url)
    if (request.url === '/outcome') {
      response.statusCode = 302
      response.setHeader('location', '/leak?secret=server-response-secret')
      response.end('redirect-body-secret')
      return
    }
    if (request.url === '/invalid-json') {
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(responseSecret)
      return
    }
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ secret: responseSecret }))
  })
  redirectServer.listen(0, '127.0.0.1')
  await once(redirectServer, 'listening')
  const address = redirectServer.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    await assert.rejects(
      executeDocumentWorkflow(
        {
          operationId: prepareInput.operationId,
          grantToken: 'redirect-mutation-token',
          recoveryGrantToken,
          honoOrigin: origin,
          endpoints: {
            input: `${origin}/input`,
            prepared: `${origin}/prepared`,
            commit: `${origin}/commit`,
            outcome: `${origin}/outcome`,
          },
        },
        { dashboardUrl: 'http://127.0.0.1:1/unreachable-browser' },
      ),
      error =>
        error instanceof DocumentExecutorError &&
        error.code === 'TRANSPORT_FAILED' &&
        Object.keys(error.details).length === 0 &&
        !JSON.stringify(error).includes('server-response-secret') &&
        !JSON.stringify(error).includes(recoveryGrantToken),
    )
    assert.deepEqual(requests, ['/outcome'])

    await assert.rejects(
      executeDocumentWorkflow(
        {
          operationId: prepareInput.operationId,
          grantToken: 'invalid-json-mutation-token',
          recoveryGrantToken,
          honoOrigin: origin,
          endpoints: {
            input: `${origin}/input`,
            prepared: `${origin}/prepared`,
            commit: `${origin}/commit`,
            outcome: `${origin}/invalid-json`,
          },
        },
        { dashboardUrl: 'http://127.0.0.1:1/unreachable-browser' },
      ),
      error =>
        error instanceof DocumentExecutorError &&
        error.code === 'TRANSPORT_FAILED' &&
        Object.keys(error.details).length === 0 &&
        !error.message.includes(responseSecret),
    )
    assert.deepEqual(requests, ['/outcome', '/invalid-json'])
  } finally {
    redirectServer.close()
    await once(redirectServer, 'close')
  }
})

test('CLI failure output omits arbitrary details, input secrets, and bearer tokens', async () => {
  const secret = 'postgres://db-user:db-password@db.invalid/private'
  const grantToken = 'cli-private-bearer-token'
  const cli = spawn(process.execPath, ['src/cli.mjs'], {
    cwd: new URL('..', import.meta.url),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  cli.stdout.on('data', chunk => {
    stdout += chunk.toString()
  })
  cli.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })
  cli.stdin.end(
    JSON.stringify({
      grantToken,
      nested: {
        databaseUrl: secret,
      },
    }),
  )
  const [exitCode] = await once(cli, 'exit')
  assert.equal(exitCode, 1)
  assert.equal(stderr, '')
  const output = JSON.parse(stdout)
  assert.deepEqual(Object.keys(output.failure).sort(), ['code', 'message'])
  assert.equal(output.failure.code, 'CREDENTIAL_INPUT_FORBIDDEN')
  assert.doesNotMatch(stdout, new RegExp(grantToken, 'u'))
  assert.doesNotMatch(stdout, /db-password|postgres(?:ql)?:\/\//iu)
})
