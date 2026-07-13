import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { assertKernelApi, captureFailure, loadCore } from './helpers/kernel.mjs'

test('legacy schemas migrate to the canonical version with an immutable preparation report', async () => {
  const core = await loadCore()
  const validator = new core.SchemaValidator(core.resolveTrustPolicy('legacyTrusted'))
  const input = createProjectSchema()
  const before = structuredClone(input)

  const result = validator.prepareWithReport(input)

  assert.deepEqual(input, before, 'preparation must not mutate the caller-owned input')
  assert.notStrictEqual(result.schema, input)
  assert.equal(result.schema.version, core.CURRENT_PROJECT_SCHEMA_VERSION)
  assert.deepEqual(result.report, {
    sourceVersion: core.LEGACY_PROJECT_SCHEMA_VERSION,
    targetVersion: core.CURRENT_PROJECT_SCHEMA_VERSION,
    migrated: true,
    migrations: [
      {
        fromVersion: core.LEGACY_PROJECT_SCHEMA_VERSION,
        toVersion: core.CURRENT_PROJECT_SCHEMA_VERSION,
      },
    ],
    normalizations: [],
  })
  assert.equal(Object.isFrozen(result.report), true)
  assert.equal(Object.isFrozen(result.report.migrations), true)
})

test('current-version schema preparation is idempotent and detached from its input', async () => {
  const core = await loadCore()
  const validator = new core.SchemaValidator(core.resolveTrustPolicy('legacyTrusted'))
  const input = createProjectSchema({ version: core.CURRENT_PROJECT_SCHEMA_VERSION })
  const before = structuredClone(input)

  const first = validator.prepareWithReport(input)
  const second = validator.prepareWithReport(first.schema)

  assert.deepEqual(input, before)
  assert.notStrictEqual(first.schema, input)
  assert.deepEqual(first.schema, input)
  assert.deepEqual(second.schema, first.schema)
  assert.equal(first.report.migrated, false)
  assert.deepEqual(first.report.migrations, [])
  assert.deepEqual(first.report.normalizations, [])
  assert.deepEqual(second.report, first.report)
})

test('normalization defaults an omitted componentsMap without changing the input', async () => {
  const core = await loadCore()
  const validator = new core.SchemaValidator(core.resolveTrustPolicy('legacyTrusted'))
  const source = createProjectSchema({ version: core.CURRENT_PROJECT_SCHEMA_VERSION })
  const input = {
    id: source.id,
    version: source.version,
    componentsTree: source.componentsTree,
  }

  const result = validator.prepareWithReport(input)

  assert.equal('componentsMap' in input, false)
  assert.deepEqual(result.schema.componentsMap, [])
  assert.deepEqual(result.report.normalizations, [
    {
      code: 'project.componentsMap.defaulted',
      message: 'componentsMap was defaulted to an empty array',
      path: '$.componentsMap',
    },
  ])
})

test('schema detachment preserves __proto__ as inert data instead of applying the prototype setter', async () => {
  const core = await loadCore()
  const validator = new core.SchemaValidator(core.resolveTrustPolicy('agentRestricted'))
  const schema = createProjectSchema({
    version: core.CURRENT_PROJECT_SCHEMA_VERSION,
    meta: JSON.parse('{"__proto__":{"polluted":true}}'),
  })

  const result = validator.prepareWithReport(schema)

  assert.strictEqual(Object.getPrototypeOf(result.schema.meta), Object.prototype)
  assert.equal(Object.hasOwn(result.schema.meta, '__proto__'), true)
  assert.deepEqual(result.schema.meta.__proto__, { polluted: true })
  assert.equal({}.polluted, undefined)
})

test('invalid schema reports structured JSON paths before mutating the loaded project', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())

  engine.project.load(createProjectSchema(), true)
  const beforeExport = structuredClone(engine.project.export())
  const beforeDocument = engine.project.currentDocument
  const beforeHistoryState = beforeDocument.history.getState()

  const error = await captureFailure(
    () =>
      engine.project.load(
        {
          version: '0.0.1',
          componentsTree: 'not-an-array',
        },
        true,
      ),
    'invalid schema must be rejected',
  )

  assert.equal(error.name, 'SchemaValidationError')
  assert.ok(Array.isArray(error.issues))
  assert.ok(
    error.issues.some(issue => issue.path === '$.componentsTree' && typeof issue.code === 'string'),
    'validation issues must identify $.componentsTree with a stable code',
  )
  assert.deepEqual(engine.project.export(), beforeExport)
  assert.strictEqual(engine.project.currentDocument, beforeDocument)
  assert.equal(beforeDocument.history.getState(), beforeHistoryState)
})

test('falsy schemas are rejected before unloading the current project', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.loadProject(createProjectSchema(), true)
  const beforeExport = structuredClone(engine.project.export())
  const beforeDocument = engine.project.currentDocument

  for (const invalidSchema of [null, false, 0, '']) {
    const error = await captureFailure(() => engine.loadProject(invalidSchema, true))

    assert.equal(error.name, 'SchemaValidationError')
    assert.ok(error.issues.some(issue => issue.code === 'project.type' && issue.path === '$'))
    assert.deepEqual(engine.project.export(), beforeExport)
    assert.strictEqual(engine.project.currentDocument, beforeDocument)
  }
})

test('invalid descendant nodes identify their exact JSON path', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const schema = createProjectSchema()
  schema.componentsTree[0].children.push({ id: 'invalid-child', props: {} })

  const error = await captureFailure(() => engine.project.load(schema))
  assert.equal(error.name, 'SchemaValidationError')
  assert.ok(error.issues.some(issue => issue.path === '$.componentsTree[0].children[0].componentName'))
})

test('missing componentsTree is explicitly rejected for legacy and current schemas', async () => {
  const core = await loadCore()
  const validator = new core.SchemaValidator(core.resolveTrustPolicy('legacyTrusted'))

  for (const version of [core.LEGACY_PROJECT_SCHEMA_VERSION, core.CURRENT_PROJECT_SCHEMA_VERSION]) {
    const schema = { version, componentsMap: [] }
    const error = await captureFailure(() => validator.prepareWithReport(schema))

    assert.equal(error.name, 'SchemaValidationError')
    assert.ok(
      error.issues.some(issue => issue.code === 'project.componentsTree.required' && issue.path === '$.componentsTree'),
    )
  }
})

test('future and unsupported schema versions are rejected without mutating the loaded project', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.loadProject(createProjectSchema(), true)
  const beforeExport = structuredClone(engine.project.export())
  const beforeDocument = engine.project.currentDocument

  for (const [version, code] of [
    ['2.0.0', 'project.version.future'],
    ['0.9.0', 'project.version.unsupported'],
  ]) {
    const input = createProjectSchema({ version })
    const inputBefore = structuredClone(input)
    const error = await captureFailure(() => engine.loadProject(input, true))

    assert.equal(error.name, 'SchemaValidationError')
    assert.ok(error.issues.some(issue => issue.code === code && issue.path === '$.version'))
    assert.deepEqual(input, inputBefore)
    assert.deepEqual(engine.project.export(), beforeExport)
    assert.strictEqual(engine.project.currentDocument, beforeDocument)
  }
})

test('loading a new schema replaces stale config, metadata, extensions, and documents', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.loadProject(
    createProjectSchema({
      config: { theme: 'stale' },
      meta: { owner: 'stale' },
      extensionState: { token: 'stale' },
    }),
    true,
  )
  const previousDocument = engine.project.currentDocument

  engine.loadProject(
    {
      version: core.CURRENT_PROJECT_SCHEMA_VERSION,
      componentsTree: [],
    },
    true,
  )

  const exported = engine.project.export()
  assert.equal(exported.version, core.CURRENT_PROJECT_SCHEMA_VERSION)
  assert.deepEqual(exported.componentsMap, [])
  assert.deepEqual(exported.componentsTree, [])
  assert.equal('id' in exported, false)
  assert.equal('config' in exported, false)
  assert.equal('meta' in exported, false)
  assert.equal('extensionState' in exported, false)
  assert.equal(engine.project.config, undefined)
  assert.equal(engine.project.get('meta'), undefined)
  assert.equal(engine.project.get('extensionState'), undefined)
  assert.equal(engine.project.documents.length, 0)
  assert.equal(engine.project.currentDocument, undefined)
  assert.equal(engine.project.getDocument(previousDocument.id), undefined)
  assert.equal(previousDocument.rootNode, null)
})

test('restricted document-level raw ingress is denied before createDocument and import mutate', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.loadProject(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const before = structuredClone(document.export())
  const beforeCount = engine.project.documents.length
  const unsafeRoot = structuredClone(before)
  unsafeRoot.props = { handler: { type: 'JSExpression', value: 'globalThis.secret' } }

  const createError = await captureFailure(() => engine.project.createDocument(unsafeRoot))
  assert.equal(createError.name, 'PolicyViolation')
  assert.equal(createError.capability, 'model.mutation')
  assert.equal(engine.project.documents.length, beforeCount)

  const importError = await captureFailure(() => document.import(unsafeRoot))
  assert.equal(importError.name, 'PolicyViolation')
  assert.equal(importError.capability, 'model.mutation')
  assert.deepEqual(document.export(), before)
})

test('legacyTrusted still rejects circular schema data before unloading the current project', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.project.load(createProjectSchema(), true)
  const before = structuredClone(engine.project.export())
  const beforeDocument = engine.project.currentDocument

  const schema = createProjectSchema()
  const circular = { label: 'cycle' }
  circular.self = circular
  schema.componentsTree[0].props = { circular }

  const error = await captureFailure(() => engine.project.load(schema, true))
  assert.equal(error.name, 'SchemaValidationError')
  assert.ok(error.issues.some(issue => issue.code === 'schema.circular' && /props.*circular.*self/.test(issue.path)))
  assert.strictEqual(engine.project.currentDocument, beforeDocument)
  assert.deepEqual(engine.project.export(), before)
})

test('legacyTrusted rejects schema accessors without invoking them', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const schema = createProjectSchema()
  let getterCalls = 0
  Object.defineProperty(schema.componentsTree[0].props, 'danger', {
    enumerable: true,
    get() {
      getterCalls += 1
      return 'executed'
    },
  })

  const error = await captureFailure(() => engine.project.load(schema, true))
  assert.equal(error.name, 'SchemaValidationError')
  assert.ok(error.issues.some(issue => issue.code === 'schema.accessor'))
  assert.equal(getterCalls, 0)
})
