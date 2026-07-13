import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { assertKernelApi, captureFailure, loadCore } from './helpers/kernel.mjs'

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

test('document-level schema ingress validates before createDocument and import mutate', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const before = structuredClone(document.export())
  const beforeCount = engine.project.documents.length
  const unsafeRoot = structuredClone(before)
  unsafeRoot.props = { handler: { type: 'JSExpression', value: 'globalThis.secret' } }

  const createError = await captureFailure(() => engine.project.createDocument(unsafeRoot))
  assert.equal(createError.name, 'PolicyViolation')
  assert.equal(engine.project.documents.length, beforeCount)

  const importError = await captureFailure(() => document.import(unsafeRoot))
  assert.equal(importError.name, 'PolicyViolation')
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
