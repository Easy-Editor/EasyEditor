import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

const expectCapabilityError = (error, code) => {
  assert.equal(error.name, 'AgentCapabilityError')
  assert.equal(error.code, code)
  assert.equal(error.committed, false)
}

const createDashboardExtraPolicy = () => ({
  requiredOnInsert: true,
  policy: {
    type: 'object',
    properties: {
      rect: {
        type: 'object',
        properties: {
          x: { type: 'number', minimum: -100_000, maximum: 100_000 },
          y: { type: 'number', minimum: -100_000, maximum: 100_000 },
          width: { type: 'number', minimum: 0, maximum: 16_384, exclusiveMinimum: true },
          height: { type: 'number', minimum: 0, maximum: 16_384, exclusiveMinimum: true },
        },
        required: ['x', 'y', 'width', 'height'],
        additionalProperties: false,
      },
    },
    required: ['rect'],
    additionalProperties: false,
  },
})

const createReadyEngine = async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema(), true)
  return { document: engine.project.currentDocument, engine }
}

const createCapability = (engine, document, dashboardPolicy = createDashboardExtraPolicy()) =>
  engine.agentCapabilities.issue({
    subjectId: 'agent:dashboard-extra-policy',
    documentIds: [document.id],
    commandTypes: ['insertNode', 'updateProps'],
    componentNames: ['Text'],
    componentProps: { Text: {} },
    extraKeys: ['$dashboard'],
    extraValues: { $dashboard: dashboardPolicy },
  })

const validDashboard = () => ({ rect: { x: -100, y: 200, width: 320, height: 180 } })

test('extra value policies validate updates and require the extra on inserted nodes', async t => {
  const { document, engine } = await createReadyEngine(t)
  const dashboardPolicy = createDashboardExtraPolicy()
  const capability = createCapability(engine, document, dashboardPolicy)
  dashboardPolicy.policy.properties.rect.properties.width.maximum = 1_000_000
  const issuedPolicy = capability.descriptor.grant.extraValues.$dashboard
  assert.equal(issuedPolicy.policy.properties.rect.properties.width.maximum, 16_384)
  assert.equal(Object.isFrozen(issuedPolicy), true)
  assert.equal(Object.isFrozen(issuedPolicy.policy), true)
  assert.equal(Object.isFrozen(issuedPolicy.policy.properties.rect), true)
  assert.equal(Object.isFrozen(issuedPolicy.policy.properties.rect.properties.width), true)
  const snapshot = capability.snapshot(document.id)

  const updatePlan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, extras: { $dashboard: validDashboard() } }],
  })
  assert.equal(updatePlan.commandCount, 1)

  const invalidValues = [
    null,
    'invalid',
    {},
    { rect: null },
    { rect: { x: 0, y: 0, width: 10 } },
    { rect: { x: 0, y: 0, width: -1, height: 10 } },
    { rect: { x: 0, y: 0, width: 10, height: 0 } },
    { rect: { x: 0, y: 0, width: 16_385, height: 10 } },
    { rect: { x: 100_001, y: 0, width: 10, height: 10 } },
    { rect: { x: 0, y: 0, width: 10, height: 10, rotation: 45 } },
  ]
  for (const value of invalidValues) {
    const error = await captureFailure(() =>
      capability.preview({
        documentId: document.id,
        baseRevision: snapshot.revision,
        commands: [{ type: 'updateProps', nodeId: document.root.id, extras: { $dashboard: value } }],
      }),
    )
    expectCapabilityError(error, 'agent.grant.extraValueDenied')
  }

  const infinityError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: snapshot.revision,
      commands: [
        {
          type: 'updateProps',
          nodeId: document.root.id,
          extras: { $dashboard: { rect: { x: Number.POSITIVE_INFINITY, y: 0, width: 10, height: 10 } } },
        },
      ],
    }),
  )
  expectCapabilityError(infinityError, 'agent.data.invalid')

  const missingRequiredError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: snapshot.revision,
      commands: [
        {
          type: 'insertNode',
          parentId: document.root.id,
          node: { componentName: 'Text', props: {}, children: [] },
        },
      ],
    }),
  )
  expectCapabilityError(missingRequiredError, 'agent.grant.extraValueDenied')

  const insertPlan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      {
        type: 'insertNode',
        parentId: document.root.id,
        node: { componentName: 'Text', props: {}, children: [], $dashboard: validDashboard() },
      },
    ],
  })
  assert.equal(insertPlan.commandCount, 1)
})

test('extra key grants and value policies must be declared together', async t => {
  const { document, engine } = await createReadyEngine(t)
  for (const grant of [
    { extraKeys: ['$dashboard'] },
    { extraKeys: [], extraValues: { $dashboard: createDashboardExtraPolicy() } },
  ]) {
    const error = await captureFailure(() =>
      engine.agentCapabilities.issue({
        subjectId: 'agent:invalid-extra-policy',
        documentIds: [document.id],
        commandTypes: ['updateProps'],
        ...grant,
      }),
    )
    expectCapabilityError(error, 'agent.grant.invalid')
  }
})
