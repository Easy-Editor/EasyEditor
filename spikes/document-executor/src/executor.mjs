import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'

import {
  MATERIAL_MANIFEST_BINDING_VERSION,
  computeWorkspaceArtifactCompatibility,
  createBrowserArtifactManifest,
  hashMaterialManifestBinding,
} from './workspace-artifacts.mjs'

const DEFAULT_DASHBOARD_URL = 'http://127.0.0.1:5173/index.html'
const DEFAULT_BROWSER_ARTIFACT_DIRECTORY = new URL('../.browser-dist/', import.meta.url)
const FORBIDDEN_INPUT_KEYS = new Set([
  'connectionstring',
  'databasecredentials',
  'databasecredential',
  'databasehost',
  'databasename',
  'databasepassword',
  'databaseport',
  'databaseuri',
  'databaseurl',
  'databaseuser',
  'databaseusername',
  'dbcredential',
  'dbcredentials',
  'dbhost',
  'dbname',
  'dbpassword',
  'dbport',
  'dburl',
  'dbuser',
  'dbusername',
  'pgconnectionstring',
  'pgdatabase',
  'pghost',
  'pgpassword',
  'pgport',
  'pguser',
  'postgrespassword',
  'postgresuser',
  'postgresusername',
  'postgresqlurl',
  'postgresurl',
  'servicerolekey',
  'supabaseservicerolekey',
])
const CREDENTIAL_ENV_PATTERN =
  /(?:API[_-]?KEY|AUTHORIZATION|BEARER|CONNECTION[_-]?STRING|DATABASE|DB[_-]|PASSWORD|POSTGRES|PRIVATE[_-]?KEY|SECRET|SERVICE[_-]?ROLE|SUPABASE|TOKEN)/iu
const EXECUTOR_CONTRACT_VERSION = 'easy-dashboard.executor.v1'
const PREPARE_INPUT_KEYS = Object.freeze([
  'actorId',
  'baseProject',
  'baseDraftVersion',
  'compatibility',
  'contractVersion',
  'executorId',
  'invocation',
  'operationId',
  'projectId',
  'stageId',
  'taskId',
])
const COMPATIBILITY_KEYS = Object.freeze([
  'browserArtifactSha256',
  'browserArtifactVersion',
  'coreSha256',
  'coreVersion',
  'dashboardAgentHostSha256',
  'dashboardAgentHostVersion',
  'materialManifestSha256',
  'materialManifestVersion',
  'rendererSha256',
  'rendererVersion',
  'runtimeSha256',
  'runtimeVersion',
])

export class DocumentExecutorError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DocumentExecutorError'
    this.code = code
    this.details = details
  }
}

const requireRecord = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DocumentExecutorError('INVALID_INPUT', `${label} must be an object`)
  }
  return value
}

const requireString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DocumentExecutorError('INVALID_INPUT', `${label} must be a non-empty string`)
  }
  return value
}

const assertExactKeys = (value, expected, label) => {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new DocumentExecutorError('INVALID_CONTRACT', `${label} fields must match the v1 contract`)
  }
}

const canonicalJson = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

const sha256 = value => createHash('sha256').update(value).digest('hex')

const documentDescriptor = schema => {
  const serialized = canonicalJson(schema)
  return {
    schema: structuredClone(schema),
    bytes: Buffer.byteLength(serialized, 'utf8'),
    sha256: sha256(serialized),
  }
}

const sanitizeBrowserEnvironment = source =>
  Object.fromEntries(Object.entries(source).filter(([key]) => !CREDENTIAL_ENV_PATTERN.test(key)))

const normalizedKey = value => value.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')

const assertNoDatabaseCredentials = (value, path = '$') => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoDatabaseCredentials(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_INPUT_KEYS.has(normalizedKey(key))) {
      throw new DocumentExecutorError('CREDENTIAL_INPUT_FORBIDDEN', `${path}.${key} is not accepted by the executor`)
    }
    assertNoDatabaseCredentials(child, `${path}.${key}`)
  }
}

const assertNoAuthoritySecrets = (value, authoritySecrets, path = '$') => {
  if (typeof value === 'string') {
    if (authoritySecrets.some(secret => secret.length > 0 && value.includes(secret))) {
      throw new DocumentExecutorError('CREDENTIAL_INPUT_FORBIDDEN', `${path} contains executor authority`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAuthoritySecrets(item, authoritySecrets, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assertNoAuthoritySecrets(child, authoritySecrets, `${path}.${key}`)
  }
}

const redactUrl = value => {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '<invalid-url>'
  }
}

const normalizeInput = (input, { authoritySecrets = [] } = {}) => {
  requireRecord(input, 'input')
  assertNoDatabaseCredentials(input)
  const grantToken = requireString(input.grantToken, 'input.grantToken')
  const forbiddenAuthorities = [grantToken, ...authoritySecrets]
  assertNoAuthoritySecrets(input.prepareInput, forbiddenAuthorities, 'input.prepareInput')
  if (input.seams !== undefined) assertNoAuthoritySecrets(input.seams, forbiddenAuthorities, 'input.seams')
  if (Object.hasOwn(input, 'dashboardUrl')) {
    throw new DocumentExecutorError(
      'OPERATION_ORIGIN_FORBIDDEN',
      'dashboardUrl is operator configuration and is forbidden in operation input',
    )
  }
  if (Object.hasOwn(input, 'artifactDirectory')) {
    throw new DocumentExecutorError(
      'OPERATION_ORIGIN_FORBIDDEN',
      'artifactDirectory is operator configuration and is forbidden in operation input',
    )
  }
  const prepareInput = structuredClone(requireRecord(input.prepareInput, 'input.prepareInput'))
  assertExactKeys(prepareInput, PREPARE_INPUT_KEYS, 'input.prepareInput')
  if (prepareInput.contractVersion !== EXECUTOR_CONTRACT_VERSION) {
    throw new DocumentExecutorError('INVALID_CONTRACT', 'input.prepareInput.contractVersion is unsupported')
  }
  const compatibility = requireRecord(prepareInput.compatibility, 'input.prepareInput.compatibility')
  assertExactKeys(compatibility, COMPATIBILITY_KEYS, 'input.prepareInput.compatibility')
  for (const [key, value] of Object.entries(compatibility)) {
    requireString(value, `input.prepareInput.compatibility.${key}`)
    if (key.endsWith('Sha256') && !/^[a-f0-9]{64}$/u.test(value)) {
      throw new DocumentExecutorError('INVALID_CONTRACT', `${key} must be a lowercase SHA-256`)
    }
  }
  const baseProject = requireRecord(prepareInput.baseProject, 'input.prepareInput.baseProject')
  assertExactKeys(baseProject, ['bytes', 'schema', 'sha256'], 'input.prepareInput.baseProject')
  const storedProject = requireRecord(baseProject.schema, 'input.prepareInput.baseProject.schema')
  const actualBaseProject = documentDescriptor(storedProject)
  if (actualBaseProject.bytes !== baseProject.bytes || actualBaseProject.sha256 !== baseProject.sha256) {
    throw new DocumentExecutorError('DOCUMENT_DESCRIPTOR_MISMATCH', 'baseProject bytes or SHA-256 is invalid')
  }
  if (storedProject.formatVersion !== 1) {
    throw new DocumentExecutorError('INVALID_CONTRACT', 'base project formatVersion must be 1')
  }
  const editorSchema = requireRecord(storedProject.editorSchema, 'input.prepareInput.baseProject.schema.editorSchema')
  if (!Array.isArray(editorSchema.componentsTree) || editorSchema.componentsTree.length === 0) {
    throw new DocumentExecutorError('INVALID_CONTRACT', 'base project editorSchema.componentsTree must not be empty')
  }
  const presentation = requireRecord(storedProject.presentation, 'base project presentation')
  const startPageId = requireString(presentation.startPageId, 'base project presentation.startPageId')
  const invocation = requireRecord(prepareInput.invocation, 'input.prepareInput.invocation')
  assertExactKeys(
    invocation,
    ['arguments', 'callId', 'capability', 'sessionId', 'stepId'],
    'input.prepareInput.invocation',
  )
  if (invocation.capability !== 'screen.applyChangeSet') {
    throw new DocumentExecutorError('INVALID_CONTRACT', 'M0 supports only screen.applyChangeSet')
  }
  const semanticChangeSet = structuredClone(
    requireRecord(invocation.arguments, 'input.prepareInput.invocation.arguments'),
  )
  assertExactKeys(
    semanticChangeSet,
    ['documentId', 'operations', 'schemaVersion'],
    'input.prepareInput.invocation.arguments',
  )
  if (semanticChangeSet.schemaVersion !== 1) {
    throw new DocumentExecutorError('INVALID_CONTRACT', 'screen.applyChangeSet schemaVersion must be 1')
  }
  if (!Array.isArray(semanticChangeSet.operations) || semanticChangeSet.operations.length === 0) {
    throw new DocumentExecutorError('INVALID_CONTRACT', 'screen.applyChangeSet operations must not be empty')
  }
  const operationIds = semanticChangeSet.operations.map((operation, index) =>
    requireString(requireRecord(operation, `operations[${index}]`).opId, `operations[${index}].opId`),
  )
  if (new Set(operationIds).size !== operationIds.length) {
    throw new DocumentExecutorError('INVALID_CONTRACT', 'screen operation IDs must be unique')
  }
  if (!Number.isSafeInteger(prepareInput.baseDraftVersion) || prepareInput.baseDraftVersion < 0) {
    throw new DocumentExecutorError('INVALID_CONTRACT', 'baseDraftVersion must be a non-negative safe integer')
  }
  const activePages = editorSchema.componentsTree
    .map((page, index) => {
      const root = requireRecord(page, `base project editorSchema.componentsTree[${index}]`)
      const easyDashboard =
        root.meta && typeof root.meta === 'object' && !Array.isArray(root.meta)
          ? root.meta.easyDashboard &&
            typeof root.meta.easyDashboard === 'object' &&
            !Array.isArray(root.meta.easyDashboard)
            ? root.meta.easyDashboard
            : null
          : null
      const pageId = easyDashboard?.pageId ?? root.docId ?? root.id
      return { index, pageId, root }
    })
    .filter(page => page.pageId === startPageId)
  if (activePages.length !== 1) {
    throw new DocumentExecutorError(
      'INVALID_CONTRACT',
      `base project presentation.startPageId must identify exactly one editor page: ${startPageId}`,
    )
  }
  const [{ index: activePageIndex, root }] = activePages
  const documentId = root.docId ?? root.id
  requireString(documentId, 'baseProject active document id')
  if (semanticChangeSet.documentId !== documentId) {
    throw new DocumentExecutorError('INVALID_CONTRACT', 'invocation documentId must match the active editor document')
  }

  return {
    grantToken,
    prepareInput,
    operationId: requireString(prepareInput.operationId, 'input.prepareInput.operationId'),
    draft: {
      projectId: prepareInput.projectId,
      branchId: 'draft',
      activeDocument: {
        documentId,
        fileName: root.fileName ?? 'home',
        index: activePageIndex,
      },
      projectSchema: structuredClone(editorSchema),
    },
    storedProject: structuredClone(storedProject),
    changeSet: semanticChangeSet,
    seams: input.seams === undefined ? {} : structuredClone(requireRecord(input.seams, 'input.seams')),
  }
}

const waitForRender = async page => {
  const frameElement = page.locator('.lc-simulator-content-frame')
  await frameElement.waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(50)
  const screenshot = await page.screenshot({ animations: 'disabled', fullPage: false })
  const frames = page.frames()
  const visibleText = (
    await Promise.all(
      frames.map(frame =>
        frame
          .locator('body')
          .innerText({ timeout: 2_000 })
          .catch(() => ''),
      ),
    )
  )
    .join('\n')
    .trim()
    .slice(0, 2_000)
  return {
    screenshotBytes: screenshot.byteLength,
    screenshotSha256: createHash('sha256').update(screenshot).digest('hex'),
    simulatorFrameCount: await frameElement.count(),
    visibleText,
  }
}

const requireE2EHarnessBuild = async page => {
  const marker = await page
    .waitForFunction(() => globalThis.__EASY_EDITOR_DOCUMENT_EXECUTOR_BUILD__ !== undefined, undefined, {
      timeout: 10_000,
    })
    .then(() => page.evaluate(() => globalThis.__EASY_EDITOR_DOCUMENT_EXECUTOR_BUILD__))
    .catch(() => null)
  if (!marker) {
    throw new DocumentExecutorError(
      'HARNESS_E2E_BUILD_REQUIRED',
      'Document Executor Harness must be built with VITE_E2E=1',
    )
  }
  if (
    marker.viteE2E !== true ||
    marker.remoteResourcesDisabled !== true ||
    marker.enabledRemoteMaterialCount !== 0 ||
    marker.enabledRemoteSetterCount !== 0
  ) {
    throw new DocumentExecutorError(
      'HARNESS_E2E_BUILD_REQUIRED',
      'Document Executor Harness must disable remote resources through its VITE_E2E build',
    )
  }
}

const readBrowserStorage = page =>
  page.evaluate(async () => {
    const requestResult = request =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const databases = []
    for (const descriptor of await indexedDB.databases()) {
      if (!descriptor.name) continue
      const database = await requestResult(indexedDB.open(descriptor.name))
      const stores = []
      for (const name of [...database.objectStoreNames]) {
        const transaction = database.transaction(name, 'readonly')
        const store = transaction.objectStore(name)
        const count = await requestResult(store.count())
        const records =
          count === 0 ? [] : await Promise.all([requestResult(store.getAllKeys()), requestResult(store.getAll())])
        stores.push({ name, count, records })
      }
      database.close()
      databases.push({ name: descriptor.name, version: descriptor.version, stores })
    }
    return {
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
      indexedDB: databases,
      cacheStorage: await caches.keys(),
    }
  })

const flushBrowserPersistence = page =>
  page.evaluate(async () => {
    const flush = globalThis.__EASY_EDITOR_E2E__?.flushPersistence
    if (typeof flush === 'function') await flush()
  })

const browserStorageCounts = storage => ({
  localStorage: storage.localStorage.length,
  sessionStorage: storage.sessionStorage.length,
  indexedDB: storage.indexedDB.length,
  cacheStorage: storage.cacheStorage.length,
})

const browserStorageContains = (storage, secret) => JSON.stringify(storage).includes(secret)

const EXPECTED_INDEXED_DB_STORES = Object.freeze([
  'agentCheckpoints',
  'agentSessions',
  'applyWitnesses',
  'artifactRefs',
  'artifacts',
  'failureWitnesses',
  'grants',
  'migrationState',
  'mutationProvenance',
  'projectVersions',
  'projects',
  'receiptIntents',
  'taskJournals',
  'toolReceipts',
  'workingDrafts',
])
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const STORAGE_CREDENTIAL_VALUE_PATTERN =
  /(?:bearer\s+\S+|postgres(?:ql)?:\/\/\S+|(?:api[_-]?key|authorization|password|private[_-]?key|token)\s*[:=]\s*\S+)/iu
const EXTRA_STORAGE_CREDENTIAL_KEYS = new Set([
  'apikey',
  'authorization',
  'password',
  'privatekey',
  'accesstoken',
  'refreshtoken',
])

const storageContainsCredential = value => {
  if (typeof value === 'string') return STORAGE_CREDENTIAL_VALUE_PATTERN.test(value)
  if (Array.isArray(value)) return value.some(storageContainsCredential)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_INPUT_KEYS.has(normalizedKey(key)) ||
      EXTRA_STORAGE_CREDENTIAL_KEYS.has(normalizedKey(key)) ||
      storageContainsCredential(child),
  )
}

const parseStorageJson = value => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const isProjectSchemaStorage = value => {
  const parsed = parseStorageJson(value)
  return parsed?.version === '1.0.0' && Array.isArray(parsed.componentsTree)
}

const isAllowedLocalStorageEntry = ([key, value]) => {
  if (key === 'projectSchema') return isProjectSchemaStorage(value)
  if (key === 'pageInfo') {
    const parsed = parseStorageJson(value)
    return (
      Array.isArray(parsed) && parsed.every(page => typeof page?.path === 'string' && typeof page?.title === 'string')
    )
  }
  if (key.startsWith('pageSchema:')) {
    return /^[A-Za-z0-9._-]+$/u.test(key.slice('pageSchema:'.length)) && isProjectSchemaStorage(value)
  }
  const parsed = parseStorageJson(value)
  if (!parsed || parsed.schemaVersion !== 1) return false
  if (key === 'easy-editor:storage:active:v1') {
    return UUID_PATTERN.test(parsed.projectId) && parsed.branchId === 'main'
  }
  if (key === 'easy-editor:storage:compatibility:v1') {
    return (
      UUID_PATTERN.test(parsed.projectId) &&
      parsed.branchId === 'main' &&
      parsed.writerVersion === 1 &&
      parsed.minReaderVersion === 1 &&
      parsed.canonicalBackend === 'indexeddb' &&
      Number.isSafeInteger(parsed.draftGeneration) &&
      /^sha256:[a-f0-9]{64}$/u.test(parsed.projectHash) &&
      Number.isSafeInteger(parsed.updatedAt)
    )
  }
  const legacy = key.match(/^easy-editor:storage:legacy-snapshot(?:-fence)?:v1:([a-f0-9-]+):main$/u)
  return (
    legacy !== null &&
    UUID_PATTERN.test(legacy[1]) &&
    parsed.projectId === legacy[1] &&
    parsed.branchId === 'main' &&
    Number.isSafeInteger(parsed.draftGeneration) &&
    /^sha256:[a-f0-9]{64}$/u.test(parsed.projectHash)
  )
}

const rfc6901Segment = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1')

const collectPersistedFieldSlots = (value, prefix, slots) => {
  slots.add(prefix)
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectPersistedFieldSlots(child, `${prefix}/${index}`, slots))
    return
  }
  for (const [key, child] of Object.entries(value)) {
    collectPersistedFieldSlots(child, `${prefix}/${rfc6901Segment(key)}`, slots)
  }
}

const expectedMutationProvenanceSlots = (
  projectSchema,
  projectId,
  {
    includeStructural = false,
    includeNestedChildrenOrder = true,
    structuralDocumentId = null,
    additionalSlots = [],
  } = {},
) => {
  const slots = new Set(additionalSlots)
  const visit = (node, parent = null, structuralPage = false) => {
    const nodePrefix = `${projectId}/main/${rfc6901Segment(node.id)}`
    collectPersistedFieldSlots(node.props ?? {}, `${nodePrefix}/props`, slots)
    const extras = Object.fromEntries(
      Object.entries(node).filter(([key]) => !['children', 'componentName', 'id', 'props'].includes(key)),
    )
    collectPersistedFieldSlots(extras, `${nodePrefix}/extras`, slots)
    if (includeStructural && structuralPage && !parent) {
      slots.add(`${projectId}/main/node/${rfc6901Segment(node.id)}/subtree`)
      slots.add(`${projectId}/main/parent/${rfc6901Segment(node.id)}/children-order`)
    }
    if (includeStructural && structuralPage && parent) {
      const structuralPrefix = `${projectId}/main/node/${rfc6901Segment(node.id)}`
      slots.add(`${structuralPrefix}/existence`)
      slots.add(`${structuralPrefix}/parent`)
      slots.add(`${structuralPrefix}/subtree`)
      slots.add(`${projectId}/main/node/${rfc6901Segment(parent.id)}/subtree`)
      if (includeNestedChildrenOrder) {
        slots.add(`${projectId}/main/parent/${rfc6901Segment(parent.id)}/children-order`)
      }
    }
    for (const child of node.children ?? []) visit(child, node, structuralPage)
  }
  for (const root of projectSchema.componentsTree) {
    const documentId = root?.docId ?? root?.id
    visit(root, null, structuralDocumentId === null || documentId === structuralDocumentId)
  }
  return [...slots].sort()
}

const rebaseMutationProvenanceSlots = (slotTokens, projectId) => {
  if (!Array.isArray(slotTokens)) return []
  const prefix = `${rfc6901Segment(projectId)}/main/`
  return slotTokens.flatMap(entry => {
    if (typeof entry?.slotKey !== 'string') return []
    const segments = entry.slotKey.split('/')
    return segments.length >= 3 ? [`${prefix}${segments.slice(2).join('/')}`] : []
  })
}

const expectedLegacySnapshot = projectSchema => {
  const pageInfo = []
  const pageSchemas = new Map()
  for (const [index, root] of projectSchema.componentsTree.entries()) {
    const path =
      [root?.fileName, root?.docId, root?.id].find(value => typeof value === 'string' && value.length > 0) ??
      `page-${index + 1}`
    const title = [root?.fileDesc, root?.title].find(value => typeof value === 'string' && value.length > 0) ?? path
    pageInfo.push({ path, title })
    pageSchemas.set(`pageSchema:${path}`, { ...projectSchema, componentsTree: [root] })
  }
  return { pageInfo, pageSchemas }
}

const normalizeProjectComponentsMap = projectSchema => {
  if (!projectSchema || typeof projectSchema !== 'object' || !Array.isArray(projectSchema.componentsMap)) {
    return projectSchema
  }
  return {
    ...projectSchema,
    componentsMap: [...projectSchema.componentsMap].sort((left, right) => {
      const leftKey = `${left?.componentName ?? ''}\u0000${left?.package ?? ''}\u0000${left?.globalName ?? ''}`
      const rightKey = `${right?.componentName ?? ''}\u0000${right?.package ?? ''}\u0000${right?.globalName ?? ''}`
      return leftKey.localeCompare(rightKey)
    }),
  }
}

const canonicalProjectJson = projectSchema => canonicalJson(normalizeProjectComponentsMap(projectSchema))

const assertBrowserStorageIsolation = (
  storageIsolation,
  authoritySecrets,
  candidateProjects,
  activeDocumentId,
  primaryAffectedSlotTokens,
) => {
  const initialStages = [storageIsolation.primaryBefore, storageIsolation.verificationBefore]
  if (
    initialStages.some(
      storage =>
        storage.localStorage.length !== 0 ||
        storage.sessionStorage.length !== 0 ||
        storage.indexedDB.length !== 0 ||
        storage.cacheStorage.length !== 0,
    )
  ) {
    throw new DocumentExecutorError(
      'BROWSER_STORAGE_ISOLATION_FAILED',
      'fresh browser contexts must begin with every storage surface empty',
    )
  }
  for (const [stage, storage] of [
    ['primaryAfter', storageIsolation.primaryAfter],
    ['verificationAfter', storageIsolation.verificationAfter],
  ]) {
    const candidateProject = stage === 'primaryAfter' ? candidateProjects.primary : candidateProjects.verification
    const active = parseStorageJson(storage.localStorage.find(([key]) => key === 'easy-editor:storage:active:v1')?.[1])
    const activeProjectId = active?.projectId
    const provenanceOptions = {
      includeStructural: stage === 'verificationAfter',
      // A fresh candidate reload attributes node structure and the root order,
      // but constructing an existing nested subtree is not a nested-order
      // mutation. Only primary execution is receipt-exact for those slots.
      includeNestedChildrenOrder: stage !== 'verificationAfter',
      structuralDocumentId: activeDocumentId,
      additionalSlots:
        stage === 'primaryAfter' ? rebaseMutationProvenanceSlots(primaryAffectedSlotTokens, activeProjectId) : [],
    }
    if (
      storage.sessionStorage.length !== 0 ||
      storage.cacheStorage.length !== 0 ||
      !storage.localStorage.every(isAllowedLocalStorageEntry)
    ) {
      throw new DocumentExecutorError(
        'BROWSER_STORAGE_ISOLATION_FAILED',
        'browser storage contains an entry outside the Dashboard M0 schema allowlist',
      )
    }
    if (
      storageContainsCredential(storage) ||
      authoritySecrets.some(secret => secret.length > 0 && browserStorageContains(storage, secret))
    ) {
      throw new DocumentExecutorError(
        'BROWSER_STORAGE_ISOLATION_FAILED',
        'browser storage contains executor authority or credential-shaped data',
      )
    }
    if (storage.indexedDB.length !== 1) {
      throw new DocumentExecutorError(
        'BROWSER_STORAGE_ISOLATION_FAILED',
        'browser IndexedDB must contain only the Dashboard schema shell',
      )
    }
    const [database] = storage.indexedDB
    const storeNames = database.stores.map(store => store.name).sort()
    const counts = Object.fromEntries(database.stores.map(store => [store.name, store.count]))
    const observedProvenanceSlots =
      database.stores.find(store => store.name === 'mutationProvenance')?.records?.[0]?.map(key => key[2]) ?? []
    const derivedProvenanceSlots = expectedMutationProvenanceSlots(candidateProject, activeProjectId, provenanceOptions)
    if (
      database.name !== 'easy-editor-dashboard-storage' ||
      database.version !== 1 ||
      canonicalJson(storeNames) !== canonicalJson(EXPECTED_INDEXED_DB_STORES) ||
      EXPECTED_INDEXED_DB_STORES.some(name => {
        const expected =
          name === 'migrationState' || name === 'workingDrafts'
            ? 1
            : name === 'mutationProvenance'
              ? derivedProvenanceSlots.length
              : 0
        return counts[name] !== expected
      })
    ) {
      throw new DocumentExecutorError(
        'BROWSER_STORAGE_ISOLATION_FAILED',
        'browser IndexedDB schema or record census is outside the Dashboard M0 allowlist',
        {
          expectedMutationProvenanceCount: derivedProvenanceSlots.length,
          actualMutationProvenanceCount: counts.mutationProvenance,
          missingExpectedSlots: derivedProvenanceSlots.filter(slot => !observedProvenanceSlots.includes(slot)),
          unexpectedObservedSlots: observedProvenanceSlots.filter(slot => !derivedProvenanceSlots.includes(slot)),
        },
      )
    }
    const compatibility = parseStorageJson(
      storage.localStorage.find(([key]) => key === 'easy-editor:storage:compatibility:v1')?.[1],
    )
    const migrationStore = database.stores.find(store => store.name === 'migrationState')
    const workingDraftStore = database.stores.find(store => store.name === 'workingDrafts')
    const provenanceStore = database.stores.find(store => store.name === 'mutationProvenance')
    const migrationKey = migrationStore?.records?.[0]?.[0]
    const migration = migrationStore?.records?.[1]?.[0]
    const workingDraftKey = workingDraftStore?.records?.[0]?.[0]
    const workingDraft = workingDraftStore?.records?.[1]?.[0]
    const provenanceKeys = provenanceStore?.records?.[0] ?? []
    const provenanceRecords = provenanceStore?.records?.[1] ?? []
    const expectedScopeKey = canonicalJson([active?.projectId, 'main'])
    const expectedSlots = activeProjectId
      ? expectedMutationProvenanceSlots(candidateProject, activeProjectId, provenanceOptions)
      : []
    const expectedProvenanceKeys = expectedSlots.map(slotKey => [activeProjectId, 'main', slotKey])
    const legacy = expectedLegacySnapshot(candidateProject)
    const local = new Map(storage.localStorage)
    const expectedLocalKeys = [
      'easy-editor:storage:active:v1',
      'easy-editor:storage:compatibility:v1',
      `easy-editor:storage:legacy-snapshot-fence:v1:${encodeURIComponent(activeProjectId)}:main`,
      `easy-editor:storage:legacy-snapshot:v1:${activeProjectId}:main`,
      'pageInfo',
      ...legacy.pageSchemas.keys(),
      'projectSchema',
    ].sort()
    const legacyMetadata = parseStorageJson(local.get(`easy-editor:storage:legacy-snapshot:v1:${activeProjectId}:main`))
    const legacyFence = parseStorageJson(
      local.get(`easy-editor:storage:legacy-snapshot-fence:v1:${encodeURIComponent(activeProjectId)}:main`),
    )
    if (
      !active ||
      active.schemaVersion !== 1 ||
      active.branchId !== 'main' ||
      canonicalJson([...local.keys()].sort()) !== canonicalJson(expectedLocalKeys) ||
      canonicalProjectJson(parseStorageJson(local.get('projectSchema'))) !== canonicalProjectJson(candidateProject) ||
      canonicalJson(parseStorageJson(local.get('pageInfo'))) !== canonicalJson(legacy.pageInfo) ||
      [...legacy.pageSchemas].some(
        ([key, schema]) => canonicalProjectJson(parseStorageJson(local.get(key))) !== canonicalProjectJson(schema),
      ) ||
      compatibility?.schemaVersion !== 1 ||
      compatibility.projectId !== activeProjectId ||
      compatibility.branchId !== 'main' ||
      compatibility.writerVersion !== 1 ||
      compatibility.minReaderVersion !== 1 ||
      compatibility.canonicalBackend !== 'indexeddb' ||
      compatibility.draftGeneration !== 2 ||
      !Number.isSafeInteger(compatibility.updatedAt) ||
      canonicalJson(migrationKey) !== expectedScopeKey ||
      canonicalJson(workingDraftKey) !== expectedScopeKey ||
      canonicalJson(Object.keys(migration ?? {}).sort()) !==
        canonicalJson(
          [
            'branchId',
            'diagnostics',
            'projectId',
            'schemaVersion',
            'source',
            'sourceDraftGeneration',
            'status',
            'targetGeneration',
            'updatedAt',
          ].sort(),
        ) ||
      migration.schemaVersion !== 1 ||
      migration.projectId !== active.projectId ||
      migration.branchId !== 'main' ||
      migration.status !== 'draft-committed' ||
      migration.source !== 'unknown' ||
      migration.sourceDraftGeneration !== 0 ||
      migration.targetGeneration !== 1 ||
      canonicalJson(migration.diagnostics) !== canonicalJson([{ code: 'empty-storage-default-project' }]) ||
      !Number.isSafeInteger(migration.updatedAt) ||
      canonicalJson(Object.keys(workingDraft ?? {}).sort()) !==
        canonicalJson(
          [
            'activeDocument',
            'branchId',
            'commitKind',
            'draftGeneration',
            'projectHash',
            'projectId',
            'projectSchema',
            'schemaVersion',
            'updatedAt',
          ].sort(),
        ) ||
      workingDraft.schemaVersion !== 1 ||
      workingDraft.projectId !== active.projectId ||
      workingDraft.branchId !== 'main' ||
      workingDraft.draftGeneration !== 2 ||
      workingDraft.commitKind !== 'autosave' ||
      !/^sha256:[a-f0-9]{64}$/u.test(workingDraft.projectHash) ||
      canonicalProjectJson(workingDraft.projectSchema) !== canonicalProjectJson(candidateProject) ||
      typeof workingDraft.activeDocument?.documentId !== 'string' ||
      typeof workingDraft.activeDocument?.fileName !== 'string' ||
      !Number.isSafeInteger(workingDraft.activeDocument?.index) ||
      !Number.isSafeInteger(workingDraft.updatedAt) ||
      compatibility.projectHash !== workingDraft.projectHash ||
      legacyMetadata?.schemaVersion !== 1 ||
      legacyMetadata.projectId !== activeProjectId ||
      legacyMetadata.branchId !== 'main' ||
      legacyMetadata.draftGeneration !== 2 ||
      legacyMetadata.projectHash !== workingDraft.projectHash ||
      !Number.isSafeInteger(legacyMetadata.updatedAt) ||
      legacyFence?.schemaVersion !== 1 ||
      legacyFence.projectId !== activeProjectId ||
      legacyFence.branchId !== 'main' ||
      legacyFence.draftGeneration !== 2 ||
      legacyFence.projectHash !== workingDraft.projectHash ||
      canonicalJson(provenanceKeys) !== canonicalJson(expectedProvenanceKeys) ||
      provenanceRecords.length !== expectedSlots.length ||
      provenanceRecords.some(
        (record, index) =>
          canonicalJson(Object.keys(record ?? {}).sort()) !==
            canonicalJson(['branchId', 'draftGeneration', 'projectId', 'schemaVersion', 'slotKey', 'token'].sort()) ||
          record.schemaVersion !== 1 ||
          record.projectId !== activeProjectId ||
          record.branchId !== 'main' ||
          record.slotKey !== expectedSlots[index] ||
          record.draftGeneration !== 2 ||
          record.token !== 'external',
      )
    ) {
      throw new DocumentExecutorError(
        'BROWSER_STORAGE_ISOLATION_FAILED',
        'browser IndexedDB records do not match the exact Dashboard startup persistence schema',
      )
    }
  }
}

const assertNoForbiddenBrowserRequests = (blockedApiRequests, blockedNetworkRequests) => {
  if (blockedApiRequests.length === 0 && blockedNetworkRequests.length === 0) return
  throw new DocumentExecutorError(
    'FORBIDDEN_BROWSER_RESOURCE_REQUEST',
    'Document Executor Harness requested a resource outside the M0 allowlist',
    {
      blockedApiRequests,
      blockedNetworkRequests,
    },
  )
}

const FORBIDDEN_DEVELOPMENT_REQUEST_PATTERNS = Object.freeze([
  '/src/',
  '/@fs/',
  '/@@fs/',
  '/@@vite/',
  '/@vite/',
  '/@react-refresh',
  '/node_modules/.vite/',
])
const INLINE_EXECUTABLE_RESOURCE_TYPES = new Set(['script', 'worker'])

const requireStaticBrowserArtifactGraph = (requestEvidence, dashboardUrl, browserArtifactManifest) => {
  const expectedPaths = new Set(Object.keys(browserArtifactManifest.files).map(path => `/${path}`))
  const developmentRequests = requestEvidence.filter(request =>
    FORBIDDEN_DEVELOPMENT_REQUEST_PATTERNS.some(pattern => new URL(request.url).pathname.includes(pattern)),
  )
  const unexpectedProvenanceRequests = requestEvidence.filter(request => {
    const url = new URL(request.url)
    if (['blob:', 'data:'].includes(url.protocol)) {
      return INLINE_EXECUTABLE_RESOURCE_TYPES.has(request.resourceType)
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== dashboardUrl.origin) return false
    return !expectedPaths.has(url.pathname)
  })
  if (developmentRequests.length > 0 || unexpectedProvenanceRequests.length > 0) {
    throw new DocumentExecutorError(
      'BROWSER_ARTIFACT_PROVENANCE_MISMATCH',
      'Browser executed resources outside the immutable artifact manifest',
      {
        developmentRequestCount: developmentRequests.length,
        unexpectedProvenanceRequestCount: unexpectedProvenanceRequests.length,
      },
    )
  }
  return {
    manifestRequestCount: requestEvidence.filter(request => {
      const url = new URL(request.url)
      return url.origin === dashboardUrl.origin && expectedPaths.has(url.pathname)
    }).length,
    developmentRequestCount: 0,
    unexpectedProvenanceRequestCount: 0,
  }
}

const applyInPage = async (page, input) =>
  page.evaluate(
    async ({ changeSet, draft, invocation, materialManifestSchemaVersion, operationId, seams }) => {
      const startedAt = performance.now()
      if (seams.forbiddenResourceRequest === true) {
        await fetch('https://document-executor-forbidden.invalid/m0-probe').catch(() => undefined)
      }
      if (seams.unexpectedArtifactRequest === true) {
        await fetch('/unexpected-browser-artifact.js').catch(() => undefined)
      }
      if (seams.storageTarget !== 'verification' && seams.storageUnrelatedKey === true) {
        localStorage.setItem('unrelated', 'unexpected')
      }
      if (seams.storageTarget !== 'verification' && seams.storageCredentialValue === true) {
        localStorage.setItem('dbPassword', 'browser-storage-credential')
      }
      if (
        seams.storageTarget !== 'verification' &&
        (seams.storageUnexpectedDatabase === true || seams.storageIndexedDbCredential === true)
      ) {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open(
            seams.storageUnexpectedDatabase === true
              ? 'unexpected-document-executor-db'
              : 'easy-editor-dashboard-storage',
            1,
          )
          request.onupgradeneeded = () => {
            if (seams.storageUnexpectedDatabase === true) request.result.createObjectStore('unexpected')
          }
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const database = request.result
            if (seams.storageIndexedDbCredential !== true) {
              database.close()
              resolve(undefined)
              return
            }
            const transaction = database.transaction('grants', 'readwrite')
            transaction.objectStore('grants').put({
              userId: 'executor',
              projectId: draft.projectId,
              scope: 'test',
              policyVersion: 1,
              dbPassword: 'indexed-db-credential',
            })
            transaction.oncomplete = () => {
              database.close()
              resolve(undefined)
            }
            transaction.onerror = () => reject(transaction.error)
          }
        })
      }
      const bridge = globalThis.__EASY_EDITOR_DOCUMENT_EXECUTOR_BRIDGE__
      if (!bridge || !Object.isFrozen(bridge)) throw new Error('Document Executor Harness bridge is unavailable')
      await bridge.editorReady
      await bridge.loadDashboardEditorDraft(draft)
      const runtime = bridge
      const authority = {
        projectId: draft.projectId,
        branchId: 'draft',
        sessionId: invocation.sessionId,
        taskId: invocation.taskId,
      }
      const factory = bridge.createInMemoryDashboardAgentHostFactory({
        engine: runtime.engine,
      })
      const host = factory.create(authority)
      try {
        const hostReadyAt = performance.now()
        const observed = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
        const coreProjection = observed.projection?.['dashboard.core']
        const observedMaterials = coreProjection?.materials
        if (!observedMaterials || !Number.isSafeInteger(observedMaterials.registryVersion)) {
          throw new Error('Dashboard Host observe did not expose the material registry version')
        }
        const materialManifestBinding = {
          schemaVersion: materialManifestSchemaVersion,
          registryVersion: observedMaterials.registryVersion,
          writableManifests: observedMaterials.writableManifests ?? [],
        }
        const currentDocumentId = runtime.engine.project.currentDocument?.id
        if (!currentDocumentId) throw new Error('Document Executor Harness has no current document')
        const expectedRevision = seams.staleAfterObserve ? `${observed.revision}:forced-stale` : observed.revision
        const call = {
          schemaVersion: 1,
          ...authority,
          stepId: invocation.stepId,
          callId: invocation.callId,
          capability: 'screen.applyChangeSet',
          expectedRevision,
          arguments: { ...changeSet, documentId: currentDocumentId },
        }
        const applyStartedAt = performance.now()
        const invocationResult = await host.invoke(call, { schemaVersion: 1 })
        const applyCompletedAt = performance.now()
        const receipt = await host.queryReceipt({
          schemaVersion: 1,
          ...authority,
          callId: call.callId,
        })
        const document = runtime.engine.project.currentDocument
        const exportStartedAt = performance.now()
        const candidateDocument = document?.exportRaw() ?? null
        const candidateProject = runtime.engine.project.export()
        const exportCompletedAt = performance.now()
        return {
          observedRevision: observed.revision,
          materialManifestBinding,
          invocation: invocationResult,
          receipt,
          candidateDocument,
          candidateProject,
          compatibility: factory.compatibility,
          hostPersistence: factory.persistence.snapshot(),
          engineState: runtime.engine.lifecycleState,
          timing: {
            hostStartupMs: hostReadyAt - startedAt,
            applyChangeSetMs: applyCompletedAt - applyStartedAt,
            exportMs: exportCompletedAt - exportStartedAt,
          },
        }
      } finally {
        host.dispose()
      }
    },
    {
      changeSet: input.changeSet,
      draft: input.draft,
      invocation: {
        sessionId: input.prepareInput.invocation.sessionId,
        taskId: input.prepareInput.taskId,
        stepId: input.prepareInput.invocation.stepId,
        callId: input.prepareInput.invocation.callId,
      },
      materialManifestSchemaVersion: Number(MATERIAL_MANIFEST_BINDING_VERSION),
      operationId: input.operationId,
      seams: input.seams,
    },
  )

const verifyCandidateInFreshPage = async (page, input, candidateProject) =>
  page.evaluate(
    async ({ candidateProject, draft, invocation, operationId, seams }) => {
      const stableJson = value => {
        if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
        if (value && typeof value === 'object') {
          return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(',')}}`
        }
        return JSON.stringify(value)
      }
      const normalizeProject = project => {
        if (!project || typeof project !== 'object' || !Array.isArray(project.componentsMap)) return project
        return {
          ...project,
          componentsMap: [...project.componentsMap].sort((left, right) => {
            const leftKey = `${left?.componentName ?? ''}\u0000${left?.package ?? ''}\u0000${left?.globalName ?? ''}`
            const rightKey = `${right?.componentName ?? ''}\u0000${right?.package ?? ''}\u0000${right?.globalName ?? ''}`
            return leftKey.localeCompare(rightKey)
          }),
        }
      }
      const firstDifference = (actual, expected, path = '$') => {
        if (Object.is(actual, expected)) return null
        if (Array.isArray(actual) || Array.isArray(expected)) {
          if (!Array.isArray(actual) || !Array.isArray(expected)) return `${path}: array type mismatch`
          if (actual.length !== expected.length) return `${path}: length ${actual.length} !== ${expected.length}`
          for (let index = 0; index < actual.length; index += 1) {
            const difference = firstDifference(actual[index], expected[index], `${path}[${index}]`)
            if (difference) return difference
          }
          return null
        }
        if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
          const actualKeys = Object.keys(actual).sort()
          const expectedKeys = Object.keys(expected).sort()
          if (stableJson(actualKeys) !== stableJson(expectedKeys)) {
            const missing = expectedKeys.find(key => !Object.hasOwn(actual, key))
            const unexpected = actualKeys.find(key => !Object.hasOwn(expected, key))
            return `${path}: keys differ${missing ? ` missing=${missing}` : ''}${unexpected ? ` unexpected=${unexpected}` : ''}`
          }
          for (const key of actualKeys) {
            const difference = firstDifference(actual[key], expected[key], `${path}.${key}`)
            if (difference) return difference
          }
          return null
        }
        return `${path}: ${stableJson(actual).slice(0, 120)} !== ${stableJson(expected).slice(0, 120)}`
      }
      if (seams.storageTarget === 'verification' && seams.storageUnexpectedDatabase === true) {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('unexpected-document-executor-db', 1)
          request.onupgradeneeded = () => request.result.createObjectStore('unexpected')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            request.result.close()
            resolve(undefined)
          }
        })
      }
      const bridge = globalThis.__EASY_EDITOR_DOCUMENT_EXECUTOR_BRIDGE__
      if (!bridge || !Object.isFrozen(bridge)) throw new Error('Document Executor Harness bridge is unavailable')
      await bridge.editorReady
      await bridge.loadDashboardEditorDraft({
        ...draft,
        projectSchema: candidateProject,
      })
      const runtime = bridge
      const authority = {
        projectId: draft.projectId,
        branchId: 'draft',
        sessionId: invocation.sessionId,
        taskId: `${invocation.taskId}-reload-proof`,
      }
      const factory = bridge.createInMemoryDashboardAgentHostFactory({
        engine: runtime.engine,
      })
      const host = factory.create(authority)
      try {
        const observation = await host.observe({
          schemaVersion: 1,
          ...authority,
          mode: 'full',
        })
        const document = runtime.engine.project.currentDocument
        const reloadedProject = runtime.engine.project.export()
        const normalizedReloadedProject = normalizeProject(reloadedProject)
        const normalizedCandidateProject = normalizeProject(candidateProject)
        if (!document || stableJson(normalizedReloadedProject) !== stableJson(normalizedCandidateProject)) {
          throw new Error(
            `candidate project did not round-trip through a fresh browser context (${firstDifference(normalizedReloadedProject, normalizedCandidateProject) ?? 'unknown difference'})`,
          )
        }
        const beforeEdit = document.exportRaw()
        const invocation = await host.invoke(
          {
            schemaVersion: 1,
            ...authority,
            stepId: `reload-proof-step-${operationId}`,
            callId: `reload-proof-call-${operationId}`,
            capability: 'screen.applyChangeSet',
            expectedRevision: observation.revision,
            arguments: {
              schemaVersion: 1,
              documentId: document.id,
              operations: [
                {
                  opId: `reload-proof-${operationId}`,
                  type: 'set',
                  nodeId: beforeEdit.id,
                  fieldId: 'props.backgroundColor',
                  value: beforeEdit.props?.backgroundColor === '#101829' ? '#101828' : '#101829',
                },
              ],
            },
          },
          { schemaVersion: 1 },
        )
        if (invocation.status !== 'applied') {
          throw new Error('fresh candidate context could not accept a subsequent semantic edit')
        }
        runtime.engine.undo(document)
        if (stableJson(document.exportRaw()) !== stableJson(beforeEdit)) {
          throw new Error('fresh candidate context did not restore exactly through Core undo')
        }
        return {
          status: 'verified',
          hostPersistence: factory.persistence.snapshot(),
          candidateProject: runtime.engine.project.export(),
        }
      } finally {
        host.dispose()
      }
    },
    {
      candidateProject,
      draft: input.draft,
      invocation: {
        sessionId: input.prepareInput.invocation.sessionId,
        taskId: input.prepareInput.taskId,
      },
      operationId: input.operationId,
      seams: input.seams,
    },
  )

const resolveOperatorDashboardUrl = options => {
  const configured =
    options?.dashboardUrl ?? process.env.EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL
  let dashboardUrl
  try {
    dashboardUrl = new URL(configured)
  } catch {
    throw new DocumentExecutorError(
      'INVALID_OPERATOR_DASHBOARD_URL',
      'operator dashboardUrl must be a valid loopback HTTP URL',
    )
  }
  const loopbackHostnames = new Set(['127.0.0.1', 'localhost', '[::1]'])
  if (
    dashboardUrl.protocol !== 'http:' ||
    !loopbackHostnames.has(dashboardUrl.hostname) ||
    dashboardUrl.username !== '' ||
    dashboardUrl.password !== '' ||
    dashboardUrl.hash !== ''
  ) {
    throw new DocumentExecutorError(
      'INVALID_OPERATOR_DASHBOARD_URL',
      'operator dashboardUrl must be credential-free loopback HTTP without a fragment',
    )
  }
  return dashboardUrl
}

const resolveOperatorArtifactDirectory = options =>
  resolve(options?.artifactDirectory ?? fileURLToPath(DEFAULT_BROWSER_ARTIFACT_DIRECTORY))

const artifactUrl = (dashboardUrl, relativePath) => {
  const encodedPath = relativePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return new URL(`/${encodedPath}`, dashboardUrl.origin)
}

const verifyServedBrowserArtifacts = async (dashboardUrl, browserArtifactManifest) => {
  for (const [relativePath, expectedSha256] of Object.entries(browserArtifactManifest.files)) {
    let localBytes
    let response
    try {
      localBytes = await readFile(resolve(browserArtifactManifest.directory, relativePath))
      response = await fetch(artifactUrl(dashboardUrl, relativePath), { redirect: 'error' })
    } catch {
      throw new DocumentExecutorError(
        'BROWSER_ARTIFACT_MISMATCH',
        'Browser artifact could not be verified from the operator loopback server',
        { path: relativePath },
      )
    }
    if (!response.ok) {
      throw new DocumentExecutorError(
        'BROWSER_ARTIFACT_MISMATCH',
        'Browser artifact could not be verified from the operator loopback server',
        { path: relativePath, status: response.status },
      )
    }
    let servedBytes
    try {
      servedBytes = Buffer.from(await response.arrayBuffer())
    } catch {
      throw new DocumentExecutorError('BROWSER_ARTIFACT_MISMATCH', 'Browser artifact response could not be read', {
        path: relativePath,
      })
    }
    const actualSha256 = createHash('sha256').update(servedBytes).digest('hex')
    if (
      createHash('sha256').update(localBytes).digest('hex') !== expectedSha256 ||
      actualSha256 !== expectedSha256 ||
      !servedBytes.equals(localBytes)
    ) {
      throw new DocumentExecutorError(
        'BROWSER_ARTIFACT_MISMATCH',
        'Browser artifact bytes do not match the immutable local manifest',
        {
          path: relativePath,
          expectedSha256,
          actualSha256,
        },
      )
    }
  }
  return Object.keys(browserArtifactManifest.files).length
}

export const executeDocument = async (rawInput, options = {}) => {
  const authoritySecrets = Array.isArray(options.authoritySecrets)
    ? options.authoritySecrets.map((secret, index) => requireString(secret, `options.authoritySecrets[${index}]`))
    : []
  const input = normalizeInput(rawInput, { authoritySecrets })
  const dashboardUrl = resolveOperatorDashboardUrl(options)
  const artifactDirectory = resolveOperatorArtifactDirectory(options)
  const browserArtifactManifest = await createBrowserArtifactManifest(artifactDirectory)
  const browserArtifactPaths = new Set(Object.keys(browserArtifactManifest.files).map(path => `/${path}`))
  const workspaceCompatibility = await computeWorkspaceArtifactCompatibility(
    {
      materialManifestVersion: input.prepareInput.compatibility.materialManifestVersion,
      materialManifestSha256: input.prepareInput.compatibility.materialManifestSha256,
    },
    { browserArtifactDirectory: artifactDirectory },
  )
  if (canonicalJson(workspaceCompatibility) !== canonicalJson(input.prepareInput.compatibility)) {
    throw new DocumentExecutorError(
      'WORKSPACE_ARTIFACT_MISMATCH',
      'Executor workspace artifacts do not match the compatibility tuple',
      { workspaceCompatibility },
    )
  }
  const verifiedBrowserArtifactCount = await verifyServedBrowserArtifacts(dashboardUrl, browserArtifactManifest)
  const startedAt = performance.now()
  const requestStartedAt = new Date()
  const rssBefore = process.memoryUsage().rss
  const browserEnvironment = sanitizeBrowserEnvironment(process.env)
  const browserSessionId = randomUUID()
  const consoleEvidence = []
  const requestEvidence = []
  const blockedApiRequests = []
  const blockedNetworkRequests = []
  const requestFailures = []
  const pageErrors = []
  let browserArtifactFailure = null
  let browser
  let context
  let verificationContext
  let page
  try {
    browser = await chromium.launch({
      headless: true,
      env: browserEnvironment,
    })
    const configurePage = async configuredPage => {
      await configuredPage.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (
          ['blob:', 'data:'].includes(url.protocol) &&
          INLINE_EXECUTABLE_RESOURCE_TYPES.has(route.request().resourceType())
        ) {
          blockedNetworkRequests.push({
            method: route.request().method(),
            url: redactUrl(url.toString()),
          })
          await route.abort('blockedbyclient')
          return
        }
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          blockedApiRequests.push({
            method: route.request().method(),
            url: redactUrl(url.toString()),
          })
          await route.abort('blockedbyclient')
          return
        }
        if (
          ['http:', 'https:'].includes(url.protocol) &&
          url.origin === dashboardUrl.origin &&
          !browserArtifactPaths.has(url.pathname)
        ) {
          blockedNetworkRequests.push({
            method: route.request().method(),
            url: redactUrl(url.toString()),
          })
          await route.abort('blockedbyclient')
          return
        }
        if (!['blob:', 'data:'].includes(url.protocol) && url.origin !== dashboardUrl.origin) {
          blockedNetworkRequests.push({
            method: route.request().method(),
            url: redactUrl(url.toString()),
          })
          await route.abort('blockedbyclient')
          return
        }
        if (url.origin === dashboardUrl.origin && browserArtifactPaths.has(url.pathname)) {
          const relativePath = decodeURIComponent(url.pathname.slice(1))
          const expectedSha256 = browserArtifactManifest.files[relativePath]
          try {
            const response = await route.fetch({ maxRedirects: 0 })
            const status = response.status()
            const body = await response.body()
            const actualSha256 = createHash('sha256').update(body).digest('hex')
            if (status < 200 || status >= 300 || actualSha256 !== expectedSha256) {
              browserArtifactFailure ??= new DocumentExecutorError(
                'BROWSER_ARTIFACT_MISMATCH',
                'Browser artifact response changed after preflight verification',
                { path: relativePath, status, expectedSha256, actualSha256 },
              )
              await route.abort('blockedbyclient')
              return
            }
            await route.fulfill({ response, body })
            return
          } catch {
            browserArtifactFailure ??= new DocumentExecutorError(
              'BROWSER_ARTIFACT_MISMATCH',
              'Browser artifact response could not be verified during navigation',
              { path: relativePath },
            )
            await route.abort('blockedbyclient')
            return
          }
        }
        await route.continue()
      })
      configuredPage.on('console', message => {
        consoleEvidence.push({
          level: message.type() === 'warning' ? 'warn' : message.type(),
          message: message.text().slice(0, 16_384),
          timestampMs: Math.max(0, performance.now() - startedAt),
        })
      })
      configuredPage.on('pageerror', error => {
        pageErrors.push({
          message: error.message.slice(0, 16_384),
          ...(error.stack ? { stackSha256: sha256(error.stack) } : {}),
          timestampMs: Math.max(0, performance.now() - startedAt),
        })
      })
      configuredPage.on('request', request => {
        requestEvidence.push({
          method: request.method(),
          resourceType: request.resourceType(),
          url: redactUrl(request.url()),
        })
      })
      configuredPage.on('requestfailed', request => {
        const failure = request.failure()
        requestFailures.push({
          requestUrlSha256: sha256(redactUrl(request.url())),
          method: request.method(),
          errorCode: (failure?.errorText ?? 'request-failed').replaceAll(/[^A-Za-z0-9._:-]/gu, '-').slice(0, 160),
        })
      })
    }
    const assertNoBrowserArtifactFailure = () => {
      if (browserArtifactFailure) throw browserArtifactFailure
    }
    const navigateVerified = async (targetPage, url) => {
      try {
        await targetPage.goto(url, { waitUntil: 'load' })
      } catch (error) {
        assertNoBrowserArtifactFailure()
        throw error
      }
      assertNoBrowserArtifactFailure()
    }
    context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 900 },
    })
    const primaryCookiesBefore = await context.cookies()
    page = await context.newPage()
    await configurePage(page)

    await navigateVerified(page, new URL('/logo.svg', dashboardUrl.origin).toString())
    const primaryStorageBefore = await readBrowserStorage(page)
    const harnessUrl = new URL('/index.html', dashboardUrl.origin)
    await navigateVerified(page, harnessUrl.toString())
    await requireE2EHarnessBuild(page)
    assertNoForbiddenBrowserRequests(blockedApiRequests, blockedNetworkRequests)
    const pageResult = await applyInPage(page, input)
    assertNoForbiddenBrowserRequests(blockedApiRequests, blockedNetworkRequests)
    await flushBrowserPersistence(page)
    const primaryStorageAfter = await readBrowserStorage(page)

    if (input.seams.crashAfterApply === true) {
      await page.close()
      throw new DocumentExecutorError('FORCED_CRASH_AFTER_APPLY', 'forced crash seam after Host invocation', {
        receipt: pageResult.receipt,
      })
    }

    if (pageResult.invocation.status !== 'applied') {
      throw new DocumentExecutorError(
        pageResult.invocation.failure?.code ?? 'HOST_INVOCATION_REJECTED',
        'Dashboard Host rejected the prepared invocation',
        { invocation: pageResult.invocation },
      )
    }
    const materialManifestSha256 = hashMaterialManifestBinding(pageResult.materialManifestBinding)
    if (
      String(pageResult.materialManifestBinding.schemaVersion) !==
        input.prepareInput.compatibility.materialManifestVersion ||
      materialManifestSha256 !== input.prepareInput.compatibility.materialManifestSha256
    ) {
      throw new DocumentExecutorError(
        'MATERIAL_MANIFEST_MISMATCH',
        `Host material manifest binding does not match compatibility tuple: schemaVersion=${pageResult.materialManifestBinding.schemaVersion} registryVersion=${pageResult.materialManifestBinding.registryVersion} sha256=${materialManifestSha256}`,
        {
          materialManifestBinding: pageResult.materialManifestBinding,
          materialManifestSha256,
        },
      )
    }
    const renderEvidence = await waitForRender(page)
    const primaryCookiesAfter = await context.cookies()
    verificationContext = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 900 },
    })
    const verificationCookiesBefore = await verificationContext.cookies()
    const verificationPage = await verificationContext.newPage()
    await configurePage(verificationPage)
    await navigateVerified(verificationPage, new URL('/logo.svg', dashboardUrl.origin).toString())
    const verificationStorageBefore = await readBrowserStorage(verificationPage)
    const verificationHarnessUrl = new URL('/index.html', dashboardUrl.origin)
    await navigateVerified(verificationPage, verificationHarnessUrl.toString())
    await requireE2EHarnessBuild(verificationPage)
    assertNoForbiddenBrowserRequests(blockedApiRequests, blockedNetworkRequests)
    const reloadEditUndo = await verifyCandidateInFreshPage(verificationPage, input, pageResult.candidateProject)
    assertNoForbiddenBrowserRequests(blockedApiRequests, blockedNetworkRequests)
    await flushBrowserPersistence(verificationPage)
    const verificationStorageAfter = await readBrowserStorage(verificationPage)
    const verificationCookiesAfter = await verificationContext.cookies()
    const browserArtifactGraph = requireStaticBrowserArtifactGraph(
      requestEvidence,
      dashboardUrl,
      browserArtifactManifest,
    )
    const cookieIsolation = {
      primaryBefore: primaryCookiesBefore.length,
      primaryAfter: primaryCookiesAfter.length,
      verificationBefore: verificationCookiesBefore.length,
      verificationAfter: verificationCookiesAfter.length,
    }
    if (Object.values(cookieIsolation).some(count => count !== 0)) {
      throw new DocumentExecutorError(
        'COOKIE_ISOLATION_FAILED',
        'fresh browser contexts must not contain cookies before or after Harness navigation',
        { cookieIsolation },
      )
    }
    const storageIsolation = {
      primaryBefore: primaryStorageBefore,
      primaryAfter: primaryStorageAfter,
      verificationBefore: verificationStorageBefore,
      verificationAfter: verificationStorageAfter,
    }
    const storageCounts = Object.fromEntries(
      Object.entries(storageIsolation).map(([stage, storage]) => [stage, browserStorageCounts(storage)]),
    )
    if (
      storageContainsCredential([
        ...primaryCookiesBefore,
        ...primaryCookiesAfter,
        ...verificationCookiesBefore,
        ...verificationCookiesAfter,
      ]) ||
      [input.grantToken, ...authoritySecrets].some(secret =>
        JSON.stringify([
          ...primaryCookiesBefore,
          ...primaryCookiesAfter,
          ...verificationCookiesBefore,
          ...verificationCookiesAfter,
        ]).includes(secret),
      )
    ) {
      throw new DocumentExecutorError(
        'COOKIE_ISOLATION_FAILED',
        'browser cookies contain executor authority or credential-shaped data',
      )
    }
    assertBrowserStorageIsolation(
      storageIsolation,
      [input.grantToken, ...authoritySecrets],
      {
        primary: pageResult.candidateProject,
        verification: reloadEditUndo.candidateProject,
      },
      input.draft.activeDocument.documentId,
      pageResult.receipt?.witness?.affectedSlotTokens,
    )
    const expectedBlockedConsoleBudget = blockedApiRequests.length + blockedNetworkRequests.length
    let expectedBlockedConsoleCount = 0
    const unexpectedConsoleErrors = consoleEvidence.filter(entry => {
      if (entry.level !== 'error') return false
      if (
        entry.message.includes('ERR_BLOCKED_BY_CLIENT') &&
        expectedBlockedConsoleCount < expectedBlockedConsoleBudget
      ) {
        expectedBlockedConsoleCount += 1
        return false
      }
      return true
    })
    const expectedBlockedHashes = new Set(
      [...blockedApiRequests, ...blockedNetworkRequests].map(request => sha256(request.url)),
    )
    const unexpectedRequestFailures = requestFailures.filter(
      failure => !expectedBlockedHashes.has(failure.requestUrlSha256),
    )
    if (pageErrors.length || unexpectedConsoleErrors.length || unexpectedRequestFailures.length) {
      const summary = [...unexpectedConsoleErrors, ...pageErrors]
        .map(entry => entry.message)
        .slice(0, 3)
        .join(' | ')
      throw new DocumentExecutorError(
        'UNEXPECTED_BROWSER_ERROR',
        `Harness emitted unexpected browser errors${summary ? `: ${summary}` : ''}`,
        {
          consoleErrors: unexpectedConsoleErrors,
          pageErrors,
          requestFailures: unexpectedRequestFailures,
        },
      )
    }
    const candidateProject = documentDescriptor({
      ...structuredClone(input.storedProject),
      editorSchema: pageResult.candidateProject,
    })
    const prepareInput = input.prepareInput
    const rssAfter = process.memoryUsage().rss
    const completedAt = new Date()
    consoleEvidence.push({
      level: 'info',
      message: `document-executor isolation verified: browser=${browserSessionId} contexts=2 hostPersistence=${pageResult.hostPersistence.kind} reloadEditUndo=${reloadEditUndo.status} rssDelta=${rssAfter - rssBefore} primaryCookiesBefore=${cookieIsolation.primaryBefore} primaryCookiesAfter=${cookieIsolation.primaryAfter} verificationCookiesBefore=${cookieIsolation.verificationBefore} verificationCookiesAfter=${cookieIsolation.verificationAfter} primaryLocalStorageBefore=${storageCounts.primaryBefore.localStorage} primarySessionStorageBefore=${storageCounts.primaryBefore.sessionStorage} primaryLocalStorageAfter=${storageCounts.primaryAfter.localStorage} primarySessionStorageAfter=${storageCounts.primaryAfter.sessionStorage} verificationLocalStorageBefore=${storageCounts.verificationBefore.localStorage} verificationSessionStorageBefore=${storageCounts.verificationBefore.sessionStorage} verificationLocalStorageAfter=${storageCounts.verificationAfter.localStorage} verificationSessionStorageAfter=${storageCounts.verificationAfter.sessionStorage}`,
      timestampMs: Math.max(0, performance.now() - startedAt),
    })
    consoleEvidence.push({
      level: 'info',
      message: `document-executor material manifest verified: schemaVersion=${pageResult.materialManifestBinding.schemaVersion} registryVersion=${pageResult.materialManifestBinding.registryVersion} writableManifestCount=${pageResult.materialManifestBinding.writableManifests.length} sha256=${materialManifestSha256}`,
      timestampMs: Math.max(0, performance.now() - startedAt),
    })
    consoleEvidence.push({
      level: 'info',
      message: `document-executor browser artifacts verified: files=${verifiedBrowserArtifactCount} manifestRequests=${browserArtifactGraph.manifestRequestCount} developmentRequests=${browserArtifactGraph.developmentRequestCount} unexpectedProvenanceRequests=${browserArtifactGraph.unexpectedProvenanceRequestCount} sha256=${browserArtifactManifest.sha256}`,
      timestampMs: Math.max(0, performance.now() - startedAt),
    })
    return {
      contractVersion: EXECUTOR_CONTRACT_VERSION,
      executorId: prepareInput.executorId,
      operationId: prepareInput.operationId,
      projectId: prepareInput.projectId,
      actorId: prepareInput.actorId,
      taskId: prepareInput.taskId,
      stageId: prepareInput.stageId,
      baseDraftVersion: prepareInput.baseDraftVersion,
      inputSha256: sha256(canonicalJson(prepareInput)),
      compatibilitySha256: sha256(canonicalJson(prepareInput.compatibility)),
      compatibility: prepareInput.compatibility,
      candidateProject,
      semanticReceipt: pageResult.receipt,
      evidence: {
        console: consoleEvidence.slice(-10_000),
        consoleErrors: pageErrors,
        requestFailures,
        render: {
          status: requestFailures.length ? 'rendered_with_errors' : 'rendered',
          rendererReady: true,
          viewport: { width: 1440, height: 900 },
          durationMs: Math.max(0, performance.now() - startedAt),
          screenshotSha256: renderEvidence.screenshotSha256,
          resourceErrors: [...blockedApiRequests, ...blockedNetworkRequests].map(request => ({
            resourceUrlSha256: sha256(request.url),
            kind: 'blocked',
            message: `${request.method} request blocked by the Document Executor browser allowlist`,
          })),
        },
        materials: {
          manifestVersion: prepareInput.compatibility.materialManifestVersion,
          loaded: pageResult.materialManifestBinding.writableManifests.map(manifest => ({
            materialId: manifest.componentName,
            version: String(pageResult.materialManifestBinding.schemaVersion),
          })),
          missing: [],
        },
        request: {
          requestId: `document-executor-${prepareInput.operationId}`,
          startedAt: requestStartedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        },
        timing: {
          totalMs: Math.max(0, performance.now() - startedAt),
          hostStartupMs: pageResult.timing.hostStartupMs,
          applyChangeSetMs: pageResult.timing.applyChangeSetMs,
          exportMs: pageResult.timing.exportMs,
        },
      },
      preRevision: pageResult.observedRevision,
      postRevision: pageResult.receipt.revision,
      preparedAt: completedAt.toISOString(),
    }
  } finally {
    await verificationContext?.close().catch(() => undefined)
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
  }
}

const requireSameOriginEndpoint = (value, origin, label) => {
  const endpoint = new URL(requireString(value, label))
  if (endpoint.origin !== origin) {
    throw new DocumentExecutorError('INVALID_TRANSPORT', `${label} must use the configured Hono origin`)
  }
  return endpoint
}

const requestJson = async (url, { grantToken, method = 'GET', origin, body } = {}) => {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${grantToken}`,
  }
  if (method !== 'GET' && method !== 'HEAD') {
    headers['content-type'] = 'application/json'
    headers.origin = origin
    headers['x-csrf-token'] = '1'
  }
  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new DocumentExecutorError('TRANSPORT_FAILED', `${method} ${url.pathname} request failed`)
  }
  if (!response.ok) {
    throw new DocumentExecutorError('TRANSPORT_FAILED', `${method} ${url.pathname} returned ${response.status}`, {
      status: response.status,
    })
  }
  try {
    return await response.json()
  } catch {
    throw new DocumentExecutorError('TRANSPORT_FAILED', `${method} ${url.pathname} returned invalid JSON`)
  }
}

const normalizeCommitReceipt = (value, operationId, candidateSha256, committedDraftVersion, label) => {
  if (value === undefined || value === null) return undefined
  const receipt = requireRecord(value, `${label}.commitReceipt`)
  if (
    receipt.receiptVersion !== 'easy-dashboard.cas-commit-receipt.v1' ||
    receipt.operationId !== operationId ||
    receipt.candidateSha256 !== candidateSha256 ||
    !Number.isSafeInteger(receipt.committedDraftVersion) ||
    receipt.committedDraftVersion < 1 ||
    (committedDraftVersion !== undefined && receipt.committedDraftVersion !== committedDraftVersion)
  ) {
    throw new DocumentExecutorError('DURABLE_OUTCOME_MISMATCH', 'durable commit receipt does not match')
  }
  const repositoryWitness = requireRecord(receipt.repositoryWitness, `${label}.commitReceipt.repositoryWitness`)
  if (repositoryWitness.kind !== 'hono.repository.cas') {
    throw new DocumentExecutorError('DURABLE_OUTCOME_MISMATCH', 'durable commit receipt witness is unsupported')
  }
  return {
    receiptVersion: 'easy-dashboard.cas-commit-receipt.v1',
    operationId,
    committedDraftVersion: receipt.committedDraftVersion,
    candidateSha256,
    repositoryWitness: {
      kind: 'hono.repository.cas',
    },
  }
}

const requireOutcome = (payload, operationId, label) => {
  const outcome = requireRecord(requireRecord(payload, `${label} response`).outcome, label)
  if (outcome.operationId !== operationId) {
    throw new DocumentExecutorError('DURABLE_OUTCOME_MISMATCH', `${label} operationId does not match`)
  }
  if (!['issued', 'prepared', 'committed'].includes(outcome.status)) {
    return {
      operationId,
      status: 'not-executable',
    }
  }
  if (outcome.status === 'issued') {
    return {
      operationId,
      status: 'issued',
    }
  }
  const candidateSha256 = requireString(outcome.candidateSha256, `${label}.candidateSha256`)
  if (!/^[a-f0-9]{64}$/u.test(candidateSha256)) {
    throw new DocumentExecutorError('DURABLE_OUTCOME_MISMATCH', 'durable candidate digest is invalid')
  }
  if (outcome.status === 'prepared') {
    return {
      operationId,
      status: 'prepared',
      candidateSha256,
    }
  }
  const committedDraftVersion =
    outcome.committedDraftVersion === undefined
      ? undefined
      : Number.isSafeInteger(outcome.committedDraftVersion) && outcome.committedDraftVersion > 0
        ? outcome.committedDraftVersion
        : null
  if (committedDraftVersion === null) {
    throw new DocumentExecutorError('DURABLE_OUTCOME_MISMATCH', 'committed draft version is invalid')
  }
  const commitReceipt = normalizeCommitReceipt(
    outcome.commitReceipt,
    operationId,
    candidateSha256,
    committedDraftVersion,
    label,
  )
  return {
    operationId,
    status: 'committed',
    candidateSha256,
    ...(committedDraftVersion === undefined ? {} : { committedDraftVersion }),
    ...(commitReceipt === undefined ? {} : { commitReceipt }),
  }
}

const requireCandidateSha256 = (outcome, label) => {
  const candidateSha256 = requireString(outcome.candidateSha256, `${label}.candidateSha256`)
  if (!/^[a-f0-9]{64}$/u.test(candidateSha256)) {
    throw new DocumentExecutorError('DURABLE_OUTCOME_MISMATCH', `${label}.candidateSha256 must be a lowercase SHA-256`)
  }
  return candidateSha256
}

export const executeDocumentWorkflow = async (rawInput, options = {}) => {
  requireRecord(rawInput, 'input')
  assertNoDatabaseCredentials(rawInput)
  if (Object.hasOwn(rawInput, 'dashboardUrl')) {
    throw new DocumentExecutorError(
      'OPERATION_ORIGIN_FORBIDDEN',
      'dashboardUrl is operator configuration and is forbidden in operation input',
    )
  }
  if (Object.hasOwn(rawInput, 'artifactDirectory')) {
    throw new DocumentExecutorError(
      'OPERATION_ORIGIN_FORBIDDEN',
      'artifactDirectory is operator configuration and is forbidden in operation input',
    )
  }
  const grantToken = requireString(rawInput.grantToken, 'input.grantToken')
  const recoveryGrantToken = requireString(rawInput.recoveryGrantToken, 'input.recoveryGrantToken')
  if (rawInput.seams !== undefined) {
    assertNoAuthoritySecrets(rawInput.seams, [grantToken, recoveryGrantToken], 'input.seams')
  }
  const operationId = requireString(rawInput.operationId, 'input.operationId')
  const endpoints = requireRecord(rawInput.endpoints, 'input.endpoints')
  assertExactKeys(endpoints, ['commit', 'input', 'outcome', 'prepared'], 'input.endpoints')
  const origin = new URL(requireString(rawInput.honoOrigin, 'input.honoOrigin')).origin
  const inputUrl = requireSameOriginEndpoint(endpoints.input, origin, 'input.endpoints.input')
  const preparedUrl = requireSameOriginEndpoint(endpoints.prepared, origin, 'input.endpoints.prepared')
  const commitUrl = requireSameOriginEndpoint(endpoints.commit, origin, 'input.endpoints.commit')
  const outcomeUrl = requireSameOriginEndpoint(endpoints.outcome, origin, 'input.endpoints.outcome')

  const initialOutcomePayload = await requestJson(outcomeUrl, {
    grantToken: recoveryGrantToken,
  })
  const initialOutcomeRecord = requireOutcome(initialOutcomePayload, operationId, 'initial executor outcome')
  if (initialOutcomeRecord.status === 'committed') {
    requireCandidateSha256(initialOutcomeRecord, 'committed outcome')
    return {
      prepared: null,
      outcome: initialOutcomeRecord,
      recovery: {
        classification: 'committed',
        browserExecuted: false,
      },
    }
  }
  if (initialOutcomeRecord.status === 'prepared') {
    const candidateSha256 = requireCandidateSha256(initialOutcomeRecord, 'prepared outcome')
    await requestJson(commitUrl, {
      grantToken,
      method: 'POST',
      origin,
      body: { candidateSha256 },
    })
    if (rawInput.seams?.crashAfterCommitAck === true) {
      throw new DocumentExecutorError(
        'FORCED_CRASH_AFTER_COMMIT_ACK',
        'forced crash seam after durable commit acknowledgement',
        { candidateSha256 },
      )
    }
    const recoveredOutcomePayload = await requestJson(outcomeUrl, {
      grantToken: recoveryGrantToken,
    })
    const recoveredOutcome = requireOutcome(recoveredOutcomePayload, operationId, 'recovered executor outcome')
    if (
      recoveredOutcome.status !== 'committed' ||
      requireCandidateSha256(recoveredOutcome, 'recovered committed outcome') !== candidateSha256
    ) {
      throw new DocumentExecutorError(
        'DURABLE_OUTCOME_MISMATCH',
        'prepared recovery did not finish as the same committed candidate',
      )
    }
    return {
      prepared: null,
      outcome: recoveredOutcome,
      recovery: {
        classification: 'prepared',
        browserExecuted: false,
      },
    }
  }
  if (initialOutcomeRecord.status !== 'issued') {
    throw new DocumentExecutorError('DURABLE_OUTCOME_NOT_EXECUTABLE', 'durable outcome forbids execution')
  }

  const inputPayload = await requestJson(inputUrl, { grantToken })
  const prepareInput = requireRecord(inputPayload, 'executor input response').input
  if (requireRecord(prepareInput, 'executor prepare input').operationId !== operationId) {
    throw new DocumentExecutorError(
      'DURABLE_OUTCOME_MISMATCH',
      'executor input operationId does not match the durable operation',
    )
  }
  const prepared = await executeDocument(
    {
      grantToken,
      prepareInput,
      ...(rawInput.seams === undefined ? {} : { seams: rawInput.seams }),
    },
    {
      ...options,
      authoritySecrets: [
        ...(Array.isArray(options.authoritySecrets) ? options.authoritySecrets : []),
        recoveryGrantToken,
      ],
    },
  )
  await requestJson(preparedUrl, {
    grantToken,
    method: 'PUT',
    origin,
    body: prepared,
  })
  if (rawInput.seams?.crashAfterPrepare === true) {
    throw new DocumentExecutorError(
      'FORCED_CRASH_AFTER_PREPARE',
      'forced crash seam after durable candidate preparation',
      { candidateSha256: prepared.candidateProject.sha256 },
    )
  }
  await requestJson(commitUrl, {
    grantToken,
    method: 'POST',
    origin,
    body: { candidateSha256: prepared.candidateProject.sha256 },
  })
  if (rawInput.seams?.crashAfterCommitAck === true) {
    throw new DocumentExecutorError(
      'FORCED_CRASH_AFTER_COMMIT_ACK',
      'forced crash seam after durable commit acknowledgement',
      { candidateSha256: prepared.candidateProject.sha256 },
    )
  }
  const outcomePayload = await requestJson(outcomeUrl, {
    grantToken: recoveryGrantToken,
  })
  const outcome = requireOutcome(outcomePayload, operationId, 'final executor outcome')
  if (
    outcome.status !== 'committed' ||
    requireCandidateSha256(outcome, 'final committed outcome') !== prepared.candidateProject.sha256
  ) {
    throw new DocumentExecutorError('DURABLE_OUTCOME_MISMATCH', 'final outcome did not commit the prepared candidate')
  }
  return {
    prepared,
    outcome,
    recovery: {
      classification: 'executed',
      browserExecuted: true,
    },
  }
}

export const executeDocumentFromJson = async (json, options = {}) => {
  const input = JSON.parse(json)
  return input.endpoints ? executeDocumentWorkflow(input, options) : executeDocument(input, options)
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (invokedDirectly) {
  throw new Error('Use src/cli.mjs as the document executor command entry')
}
