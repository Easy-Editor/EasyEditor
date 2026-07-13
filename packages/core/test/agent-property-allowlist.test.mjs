import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

const expectCapabilityError = (error, code) => {
  assert.equal(error.name, 'AgentCapabilityError')
  assert.equal(error.code, code)
  assert.equal(error.committed, false)
}

const createSchemaWithText = () => {
  const schema = createProjectSchema()
  schema.componentsTree[0].children.push({
    id: 'text-1',
    componentName: 'Text',
    props: { text: 'before' },
    children: [],
  })
  return schema
}

const createReadyEngine = async (t, schema = createProjectSchema()) => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(schema, true)
  return { document: engine.project.currentDocument, engine }
}

test('component property grants fail closed for insertNode and updateProps with a stable denial code', async t => {
  const { document, engine } = await createReadyEngine(t)
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:property-default-deny',
    documentIds: [document.id],
    commandTypes: ['insertNode', 'updateProps'],
    componentNames: ['Text'],
  })
  const before = structuredClone(document.exportRaw())

  const insertSnapshot = capability.snapshot(document.id)
  const insertError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: insertSnapshot.revision,
      commands: [
        {
          type: 'insertNode',
          parentId: document.root.id,
          node: { componentName: 'Text', props: { text: 'injected' }, children: [] },
        },
      ],
    }),
  )
  expectCapabilityError(insertError, 'agent.grant.propDenied')

  const updateSnapshot = capability.snapshot(document.id)
  const updateError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: updateSnapshot.revision,
      commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'injected' } }],
    }),
  )
  expectCapabilityError(updateError, 'agent.grant.propDenied')
  assert.deepEqual(document.exportRaw(), before)
})

test('component property grants resolve update targets and inspect every inserted descendant', async t => {
  const { document, engine } = await createReadyEngine(t, createSchemaWithText())
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:property-targets',
    documentIds: [document.id],
    commandTypes: ['insertNode', 'updateProps'],
    componentNames: ['Group', 'Text'],
    componentProps: {
      Group: {},
      Text: { text: { type: 'string', maxBytes: 4096 } },
    },
  })

  const updateSnapshot = capability.snapshot(document.id)
  const updateError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: updateSnapshot.revision,
      commands: [
        {
          type: 'updateProps',
          nodeId: 'text-1',
          props: { dangerouslySetInnerHTML: { __html: '<img src=x onerror=alert(1)>' } },
        },
      ],
    }),
  )
  expectCapabilityError(updateError, 'agent.grant.propDenied')

  const insertSnapshot = capability.snapshot(document.id)
  const insertError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: insertSnapshot.revision,
      commands: [
        {
          type: 'insertNode',
          parentId: document.root.id,
          node: {
            componentName: 'Group',
            props: {},
            children: [
              {
                componentName: 'Text',
                props: { onClick: 'javascript:alert(1)' },
                children: [],
              },
            ],
          },
        },
      ],
    }),
  )
  expectCapabilityError(insertError, 'agent.grant.propDenied')
})

test('property grants do not implicitly grant insertion authority for that component', async t => {
  const { document, engine } = await createReadyEngine(t)
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:independent-component-authority',
    documentIds: [document.id],
    commandTypes: ['insertNode', 'updateProps'],
    componentNames: ['Text'],
    componentProps: { Page: { title: { type: 'string', maxBytes: 4096 } } },
  })
  const snapshot = capability.snapshot(document.id)

  const updatePlan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'allowed' } }],
  })
  assert.equal(updatePlan.commandCount, 1)

  const insertError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: snapshot.revision,
      commands: [
        {
          type: 'insertNode',
          parentId: document.root.id,
          node: { componentName: 'Page', props: { title: 'not insertable' }, children: [] },
        },
      ],
    }),
  )
  expectCapabilityError(insertError, 'agent.grant.componentDenied')
})

test('component property value policies reject wrong types and oversized UTF-8 strings', async t => {
  const { document, engine } = await createReadyEngine(t, createSchemaWithText())
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:property-value-policy',
    documentIds: [document.id],
    commandTypes: ['insertNode', 'updateProps'],
    componentNames: ['Text'],
    componentProps: {
      Text: {
        text: { type: 'string', maxBytes: 4 },
      },
    },
  })
  const snapshot = capability.snapshot(document.id)

  const safePlan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: 'text-1', props: { text: 'safe' } }],
  })
  assert.equal(safePlan.commandCount, 1)

  const wrongTypeError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: snapshot.revision,
      commands: [{ type: 'updateProps', nodeId: 'text-1', props: { text: { bad: 'object' } } }],
    }),
  )
  expectCapabilityError(wrongTypeError, 'agent.grant.propValueDenied')

  const oversizedInsertError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: snapshot.revision,
      commands: [
        {
          type: 'insertNode',
          parentId: document.root.id,
          node: { componentName: 'Text', props: { text: '你好' }, children: [] },
        },
      ],
    }),
  )
  expectCapabilityError(oversizedInsertError, 'agent.grant.propValueDenied')
})

test('component property grants are copied, deeply frozen, and cannot be widened after issue', async t => {
  const { document, engine } = await createReadyEngine(t, createSchemaWithText())
  const textPolicy = { type: 'string', maxBytes: 4096 }
  const componentProps = {
    Page: { title: { type: 'string', maxBytes: 4096 } },
    Text: { text: textPolicy },
  }
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:immutable-properties',
    documentIds: [document.id],
    commandTypes: ['updateProps'],
    componentProps,
  })

  textPolicy.maxBytes = 256 * 1024
  componentProps.Page.onClick = { type: 'string', maxBytes: 4096 }
  componentProps.Image = { src: { type: 'string', maxBytes: 4096 } }

  assert.deepEqual(capability.descriptor.grant.componentProps, {
    Page: { title: { type: 'string', maxBytes: 4096 } },
    Text: { text: { type: 'string', maxBytes: 4096 } },
  })
  assert.equal(Object.isFrozen(capability.descriptor.grant.componentProps), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant.componentProps.Page), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant.componentProps.Text), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant.componentProps.Page.title), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant.componentProps.Text.text), true)

  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      { type: 'updateProps', nodeId: document.root.id, props: { title: 'allowed' } },
      { type: 'updateProps', nodeId: 'text-1', props: { text: 'allowed' } },
    ],
  })
  const receipt = capability.execute(plan.planId)
  assert.equal(receipt.status, 'committed')
  assert.equal(document.root.getPropValue('title'), 'allowed')
  assert.equal(document.getNode('text-1').getPropValue('text'), 'allowed')

  const deniedSnapshot = capability.snapshot(document.id)
  const deniedError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: deniedSnapshot.revision,
      commands: [{ type: 'updateProps', nodeId: 'text-1', props: { dangerouslySetInnerHTML: {} } }],
    }),
  )
  expectCapabilityError(deniedError, 'agent.grant.propDenied')
})

test('component property grant declarations reject wildcards, unsafe paths, and reserved keys', async t => {
  const { document, engine } = await createReadyEngine(t)
  for (const componentProps of [
    { '*': {} },
    { Page: { '*': { type: 'string', maxBytes: 4096 } } },
    { Page: { 'style.color': { type: 'string', maxBytes: 4096 } } },
    { Page: { title: { type: 'string' } } },
    { Page: { title: { type: 'number', maxBytes: 4096 } } },
    { Page: { title: { type: 'string', maxBytes: 0 } } },
    { Page: { title: { type: 'string', maxBytes: 4096, coerce: true } } },
  ]) {
    const error = await captureFailure(() =>
      engine.agentCapabilities.issue({
        subjectId: 'agent:invalid-property-grant',
        documentIds: [document.id],
        commandTypes: ['updateProps'],
        componentProps,
      }),
    )
    expectCapabilityError(error, 'agent.grant.invalid')
  }

  for (const key of ['__proto__', 'prototype', 'constructor']) {
    const componentProps = { Page: Object.fromEntries([[key, { type: 'string', maxBytes: 4096 }]]) }
    const error = await captureFailure(() =>
      engine.agentCapabilities.issue({
        subjectId: 'agent:reserved-property-grant',
        documentIds: [document.id],
        commandTypes: ['updateProps'],
        componentProps,
      }),
    )
    expectCapabilityError(error, 'agent.data.invalid')
  }
})
