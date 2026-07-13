import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

function createAgentStructuralSchema() {
  const schema = createProjectSchema()
  schema.componentsTree[0].children = [
    { id: 'replace-me', componentName: 'Text', props: { label: 'old' }, children: [] },
    {
      id: 'target',
      componentName: 'Container',
      props: { label: 'target' },
      children: [{ id: 'target-child', componentName: 'Text', props: {}, children: [] }],
    },
    { id: 'tail', componentName: 'Text', props: { label: 'tail' }, children: [] },
  ]
  return schema
}

async function createHarness(t, grant = {}) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(createAgentStructuralSchema(), true)
  const document = engine.project.currentDocument
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:structural-test',
    documentIds: [document.id],
    commandTypes: grant.commandTypes ?? ['replace', 'insertBefore', 'insertAfter', 'wrap', 'unwrap'],
    componentNames: grant.componentNames ?? ['Text', 'Container'],
  })
  return { capability, document, engine }
}

const childIds = node => node.childrenNodes.map(child => child.id)

test('Agent preview and execute share the exact structural plan, generated IDs, and one undo unit', async t => {
  const { capability, document } = await createHarness(t)
  const original = structuredClone(document.exportRaw())
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      {
        type: 'insertBefore',
        nodeId: 'target',
        node: { componentName: 'Text', props: { label: 'before' }, children: [] },
      },
      {
        type: 'insertAfter',
        nodeId: 'target',
        node: { componentName: 'Text', props: { label: 'after' }, children: [] },
      },
      {
        type: 'wrap',
        nodeId: 'target',
        node: { id: 'agent-wrapper', componentName: 'Container', props: {}, children: [] },
      },
      { type: 'unwrap', nodeId: 'agent-wrapper' },
      {
        type: 'replace',
        nodeId: 'replace-me',
        node: { componentName: 'Text', props: { label: 'replacement' }, children: [] },
      },
    ],
  })

  assert.deepEqual(
    plan.effects.map(effect => effect.type),
    ['insertBefore', 'insertAfter', 'wrap', 'unwrap', 'replace'],
  )
  const beforeId = plan.effects[0].nodeIds[0]
  const afterId = plan.effects[1].nodeIds[0]
  const replacementId = plan.effects[4].nodeIds[1]
  assert.match(beforeId, /^node-/)
  assert.match(afterId, /^node-/)
  assert.match(replacementId, /^node-/)
  assert.deepEqual(plan.effects[2].nodeIds, ['agent-wrapper', 'target'])
  assert.deepEqual(plan.effects[3].nodeIds, ['agent-wrapper', 'target'])
  assert.deepEqual(childIds(document.root), ['replace-me', 'target', 'tail'], 'preview must remain observational')

  const receipt = capability.execute(plan.planId)

  assert.equal(receipt.status, 'committed')
  assert.equal(receipt.commandCount, 5)
  assert.deepEqual(childIds(document.root), [replacementId, beforeId, 'target', afterId, 'tail'])
  assert.deepEqual(childIds(document.getNode('target')), ['target-child'])
  assert.equal(document.getNode('agent-wrapper'), null)
  assert.equal(document.getNode('replace-me'), null)
  assert.equal(document.getNode(replacementId).getPropValue('label'), 'replacement')
  assert.ok(receipt.affectedNodeIds.includes(beforeId))
  assert.ok(receipt.affectedNodeIds.includes(afterId))
  assert.ok(receipt.affectedNodeIds.includes(replacementId))

  document.history.back()
  assert.deepEqual(document.exportRaw(), original)
  assert.equal(document.history.isUndoable(), false)
})

test('Agent structural plans reject root, grant, and component boundary violations before mutation', async t => {
  const { capability, document, engine } = await createHarness(t)
  const before = structuredClone(document.exportRaw())

  for (const command of [
    { type: 'replace', nodeId: document.root.id, node: { componentName: 'Text', props: {} } },
    { type: 'insertBefore', nodeId: document.root.id, node: { componentName: 'Text', props: {} } },
    { type: 'insertAfter', nodeId: document.root.id, node: { componentName: 'Text', props: {} } },
    { type: 'wrap', nodeId: document.root.id, node: { componentName: 'Container', props: {} } },
    { type: 'unwrap', nodeId: document.root.id },
  ]) {
    const snapshot = capability.snapshot(document.id)
    const error = await captureFailure(() =>
      capability.preview({ documentId: document.id, baseRevision: snapshot.revision, commands: [command] }),
    )
    assert.equal(error.name, 'AgentCapabilityError')
    assert.equal(error.code, 'agent.plan.rootMutation')
    assert.deepEqual(document.exportRaw(), before)
  }

  const denied = engine.agentCapabilities.issue({
    subjectId: 'agent:structural-denied',
    documentIds: [document.id],
    commandTypes: ['updateProps'],
    componentNames: ['Text'],
  })
  const deniedSnapshot = denied.snapshot(document.id)
  const grantError = await captureFailure(() =>
    denied.preview({
      documentId: document.id,
      baseRevision: deniedSnapshot.revision,
      commands: [
        {
          type: 'insertBefore',
          nodeId: 'target',
          node: { componentName: 'Text', props: {}, children: [] },
        },
      ],
    }),
  )
  assert.equal(grantError.code, 'agent.grant.commandDenied')

  const textOnly = engine.agentCapabilities.issue({
    subjectId: 'agent:structural-component-denied',
    documentIds: [document.id],
    commandTypes: ['wrap'],
    componentNames: ['Text'],
  })
  const textSnapshot = textOnly.snapshot(document.id)
  const componentError = await captureFailure(() =>
    textOnly.preview({
      documentId: document.id,
      baseRevision: textSnapshot.revision,
      commands: [
        {
          type: 'wrap',
          nodeId: 'target',
          node: { componentName: 'Container', props: {}, children: [] },
        },
      ],
    }),
  )
  assert.equal(componentError.code, 'agent.grant.componentDenied')
  assert.deepEqual(document.exportRaw(), before)
})

test('a prepared structural plan is stale after any intervening host mutation', async t => {
  const { capability, document, engine } = await createHarness(t)
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      {
        type: 'insertAfter',
        nodeId: 'target',
        node: { id: 'stale-agent-node', componentName: 'Text', props: {}, children: [] },
      },
    ],
  })

  engine.commands.execute({ type: 'updateProps', nodeId: document.root.id, props: { hostMutation: true } })
  const beforeExecute = structuredClone(document.exportRaw())
  const error = await captureFailure(() => capability.execute(plan.planId))

  assert.equal(error.name, 'AgentPlanStaleError')
  assert.equal(error.code, 'agent.plan.stale')
  assert.deepEqual(document.exportRaw(), beforeExecute)
  assert.equal(document.getNode('stale-agent-node'), null)
})
