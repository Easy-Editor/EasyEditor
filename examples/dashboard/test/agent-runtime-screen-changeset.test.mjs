import assert from 'node:assert/strict'
import test from 'node:test'

import { loadCore } from '../../../packages/core/test/helpers/kernel.mjs'
import {
  DEFAULT_SCREEN_CHANGESET_LIMITS,
  ScreenChangeSetCompileError,
  compileScreenChangeSet,
  deriveInsertedScreenNodeId,
} from '../src/editor/agent/capabilities/screen/index.mjs'
import { compileSafeMaterialManifest } from '../src/editor/agent/manifest/index.mjs'

const CALL_ID = 'call-screen-a'
const REGISTRY_VERSION = 7

const callback = () => {
  throw new Error('configure callbacks must not run while compiling a ChangeSet')
}

const configureField = (name, setter, extraProps) => ({
  ...(extraProps ? { extraProps } : {}),
  name,
  setter,
})

const sharedFields = () => [
  configureField('id', 'NodeIdSetter'),
  configureField('title', 'StringSetter', { getValue: callback, setValue: callback }),
  configureField('rect', 'RectSetter', { getValue: callback, setValue: callback }),
]

const metadata = (componentName, fields = [], includeShared = true) => ({
  componentName,
  configure: { props: [...(includeShared ? sharedFields() : []), ...fields] },
  title: componentName,
})

const imageField = () =>
  configureField('__image', 'UploadSetter', {
    getValue: callback,
    onChange: callback,
    setValue: callback,
  })

const manifests = () => [
  compileSafeMaterialManifest({
    materialRegistryVersion: REGISTRY_VERSION,
    metadata: metadata('Root', [imageField()]),
  }),
  compileSafeMaterialManifest({
    materialRegistryVersion: REGISTRY_VERSION,
    metadata: metadata('Image', [imageField()]),
  }),
  compileSafeMaterialManifest({
    materialRegistryVersion: REGISTRY_VERSION,
    metadata: metadata('Text', [configureField('text', { componentName: 'StringSetter', props: { maxLength: 80 } })]),
  }),
  compileSafeMaterialManifest({
    materialRegistryVersion: REGISTRY_VERSION,
    metadata: metadata('Container', [], false),
  }),
]

const rect = (x, y, width, height) => ({ height, width, x, y })

const createSchema = () => ({
  $dashboard: { rect: rect(0, 0, 1920, 1080) },
  componentName: 'Root',
  id: 'root',
  props: { backgroundImage: 'old-root.png' },
  title: 'Operations',
  children: [
    {
      $dashboard: { rect: rect(10, 20, 200, 80) },
      componentName: 'Text',
      id: 'text-a',
      props: { text: 'before' },
      title: 'Before title',
    },
    {
      $dashboard: { rect: rect(300, 30, 320, 180) },
      componentName: 'Image',
      id: 'image-a',
      props: { src: 'old-image.png' },
    },
    {
      componentName: 'Container',
      id: 'container-a',
      props: {},
      children: [
        {
          componentName: 'Text',
          id: 'nested-text',
          props: { text: 'nested' },
        },
      ],
    },
  ],
})

const compile = (operations, overrides = {}) => {
  const document = overrides.document ?? { id: 'document-a', mutationVersion: 11, schema: createSchema() }
  return compileScreenChangeSet(
    {
      schemaVersion: 1,
      projectId: 'project-a',
      branchId: 'branch-a',
      callId: overrides.callId ?? CALL_ID,
      materialRegistryVersion: overrides.materialRegistryVersion ?? REGISTRY_VERSION,
      expectedMutationVersion: document.mutationVersion,
      document,
      manifests: overrides.manifests ?? manifests(),
      changeSet: {
        schemaVersion: 1,
        documentId: document.id,
        operations,
      },
    },
    overrides.options,
  )
}

const expectCompileError = (fn, code, pathPattern, reasonPattern) => {
  assert.throws(fn, error => {
    assert.ok(error instanceof ScreenChangeSetCompileError)
    assert.equal(error.code, code)
    if (pathPattern) assert.match(error.path, pathPattern)
    if (reasonPattern) assert.match(error.reason, reasonPattern)
    return true
  })
}

const operation = (opId, value) => ({ opId, ...value })

const replaceTextManifest = mutate => {
  const all = manifests()
  const index = all.findIndex(manifest => manifest.componentName === 'Text')
  const textManifest = structuredClone(all[index])
  mutate(textManifest)
  all[index] = textManifest
  return all
}

test('compiler emits closed command DTOs for every accepted semantic operation', () => {
  const set = compile([operation('set-text', { type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'after' })])
  assert.deepEqual(set.commands, [
    {
      type: 'updateProps',
      documentId: 'document-a',
      nodeId: 'text-a',
      props: { text: 'after' },
    },
  ])
  assert.deepEqual(set.inverseOperations, [
    {
      sourceOperationId: 'set-text',
      sourceOperationIndex: 0,
      operation: {
        opId: 'inverse:set-text',
        type: 'set',
        nodeId: 'text-a',
        fieldId: 'props.text',
        value: 'before',
      },
    },
  ])

  const unset = compile([operation('unset-title', { type: 'unset', nodeId: 'text-a', fieldId: 'shared.title' })])
  assert.deepEqual(unset.commands, [
    {
      type: 'updateProps',
      documentId: 'document-a',
      nodeId: 'text-a',
      unsetExtraPaths: ['title'],
    },
  ])
  assert.equal(unset.expectedPostImages[0].existed, false)

  const resize = compile([operation('resize-text', { type: 'resize', nodeId: 'text-a', rect: rect(30, 40, 500, 90) })])
  assert.deepEqual(resize.commands, [
    {
      type: 'updateProps',
      documentId: 'document-a',
      nodeId: 'text-a',
      extras: { '$dashboard.rect': rect(30, 40, 500, 90) },
    },
  ])
  assert.deepEqual(resize.inverseOperations[0].operation, {
    opId: 'inverse:resize-text',
    type: 'resize',
    nodeId: 'text-a',
    rect: rect(10, 20, 200, 80),
  })

  const insertedNodeId = deriveInsertedScreenNodeId(CALL_ID, 'insert-text')
  assert.equal(deriveInsertedScreenNodeId(CALL_ID, 'insert-text'), insertedNodeId)
  assert.notEqual(deriveInsertedScreenNodeId('another-call', 'insert-text'), insertedNodeId)
  const insert = compile([
    operation('insert-text', {
      type: 'insert',
      parentId: 'root',
      componentName: 'Text',
      position: { place: 'before', siblingId: 'image-a' },
      fields: {
        'props.text': 'created',
        'shared.rect': rect(100, 120, 240, 60),
      },
    }),
  ])
  assert.deepEqual(insert.insertedNodeIdentities, [{ opId: 'insert-text', nodeId: insertedNodeId }])
  assert.deepEqual(insert.commands, [
    {
      type: 'insertNode',
      documentId: 'document-a',
      parentId: 'root',
      at: 1,
      node: {
        $dashboard: { rect: rect(100, 120, 240, 60) },
        componentName: 'Text',
        id: insertedNodeId,
        props: { text: 'created' },
      },
    },
  ])
  assert.deepEqual(insert.inverseOperations[0].operation, {
    opId: 'inverse:insert-text',
    type: 'remove',
    nodeId: insertedNodeId,
  })
  assert.equal(Object.hasOwn(insert.operations[0], 'node'), false)

  const move = compile([
    operation('move-text', {
      type: 'move',
      nodeId: 'text-a',
      parentId: 'container-a',
      position: { place: 'after', siblingId: 'nested-text' },
    }),
  ])
  assert.deepEqual(move.commands, [
    {
      type: 'moveNode',
      documentId: 'document-a',
      nodeId: 'text-a',
      parentId: 'container-a',
      at: 1,
    },
  ])
  assert.deepEqual(move.inverseOperations[0], {
    sourceOperationId: 'move-text',
    sourceOperationIndex: 0,
    anchors: { beforeId: null, afterId: 'image-a' },
    operation: {
      opId: 'inverse:move-text',
      type: 'move',
      nodeId: 'text-a',
      parentId: 'root',
      position: { place: 'before', siblingId: 'image-a' },
    },
  })

  const reorder = compile([
    operation('reorder-image', {
      type: 'reorder',
      nodeId: 'image-a',
      position: { place: 'first' },
    }),
  ])
  assert.deepEqual(reorder.commands[0], {
    type: 'moveNode',
    documentId: 'document-a',
    nodeId: 'image-a',
    parentId: 'root',
    at: 0,
  })

  const remove = compile([operation('remove-container', { type: 'remove', nodeId: 'container-a' })])
  assert.deepEqual(remove.commands, [{ type: 'removeNode', documentId: 'document-a', nodeId: 'container-a' }])
  assert.deepEqual(remove.inverseOperations[0], {
    sourceOperationId: 'remove-container',
    sourceOperationIndex: 0,
    anchors: { beforeId: 'image-a', afterId: null },
    operation: {
      opId: 'inverse:remove-container',
      type: 'insert',
      parentId: 'root',
      position: { place: 'after', siblingId: 'image-a' },
      node: {
        componentName: 'Container',
        id: 'container-a',
        props: {},
        children: [{ componentName: 'Text', id: 'nested-text', props: { text: 'nested' } }],
      },
    },
  })
})

test('relative positions resolve on the sequential shadow document, including earlier inserts', () => {
  const parentId = deriveInsertedScreenNodeId(CALL_ID, 'insert-parent')
  const childId = deriveInsertedScreenNodeId(CALL_ID, 'insert-child')
  const compiled = compile([
    operation('insert-parent', {
      type: 'insert',
      parentId: 'root',
      componentName: 'Container',
    }),
    operation('insert-child', {
      type: 'insert',
      parentId,
      componentName: 'Text',
    }),
    operation('set-child', {
      type: 'set',
      nodeId: childId,
      fieldId: 'props.text',
      value: 'updated',
    }),
    operation('move-image', {
      type: 'move',
      nodeId: 'image-a',
      parentId,
      position: { place: 'before', siblingId: childId },
    }),
  ])

  assert.deepEqual(compiled.insertedNodeIdentities, [
    { opId: 'insert-parent', nodeId: parentId },
    { opId: 'insert-child', nodeId: childId },
  ])
  assert.equal(compiled.commands[0].at, 3, 'omitted insert position means last')
  assert.equal(compiled.commands[1].parentId, parentId)
  assert.equal(compiled.commands[1].at, 0)
  assert.equal(compiled.commands[2].nodeId, childId)
  assert.equal(compiled.commands[3].parentId, parentId)
  assert.equal(compiled.commands[3].at, 0)

  expectCompileError(
    () =>
      compile([
        operation('bad-anchor-parent', {
          type: 'move',
          nodeId: 'text-a',
          parentId: 'container-a',
          position: { place: 'before', siblingId: 'image-a' },
        }),
      ]),
    'AMBIGUOUS_STRUCTURE',
    /siblingId/,
  )
  expectCompileError(
    () =>
      compile([
        operation('self-anchor', {
          type: 'reorder',
          nodeId: 'text-a',
          position: { place: 'after', siblingId: 'text-a' },
        }),
      ]),
    'AMBIGUOUS_STRUCTURE',
    /siblingId/,
  )
})

test('callback-backed root rename and Image multi-write mappings compile without executing callbacks', () => {
  const rootImage = compile([
    operation('root-image', {
      type: 'set',
      nodeId: 'root',
      fieldId: 'root.image',
      value: { base64: 'new-root.png' },
    }),
  ])
  assert.deepEqual(rootImage.commands[0], {
    type: 'updateProps',
    documentId: 'document-a',
    nodeId: 'root',
    props: { backgroundImage: 'new-root.png' },
  })

  const image = compile([
    operation('image-source', {
      type: 'set',
      nodeId: 'image-a',
      fieldId: 'image.source',
      value: { base64: 'new-image.png', raw: { height: 90, width: 160 } },
    }),
  ])
  assert.deepEqual(image.commands[0], {
    type: 'updateProps',
    documentId: 'document-a',
    nodeId: 'image-a',
    props: { src: 'new-image.png' },
    extras: {
      '$dashboard.rect.height': 90,
      '$dashboard.rect.width': 160,
    },
  })
  assert.equal(image.preImages.length, 3)
  assert.deepEqual(image.inverseOperations[0].operation, {
    opId: 'inverse:image-source',
    type: 'set',
    nodeId: 'image-a',
    fieldId: 'image.source',
    value: { base64: 'old-image.png', raw: { height: 180, width: 320 } },
  })
})

test('compiler rejects malformed DTOs, duplicate opIds, overlap, stale context, and ambiguous structure', () => {
  let getterInvocations = 0
  const accessorOperation = operation('accessor', { type: 'remove', nodeId: 'text-a' })
  Object.defineProperty(accessorOperation, 'secret', {
    enumerable: true,
    get() {
      getterInvocations += 1
      throw new Error('secret-must-not-leak')
    },
  })
  expectCompileError(() => compile([accessorOperation]), 'INVALID_JSON')
  assert.equal(getterInvocations, 0)

  expectCompileError(() => compile([{ op: 'remove', nodeId: 'text-a' }]), 'INVALID_CHANGESET', /operations\[0\]/)
  expectCompileError(
    () =>
      compile([
        {
          opId: 'legacy-insert',
          type: 'insert',
          parentId: 'root',
          at: 0,
          node: { id: 'model-id', componentName: 'Text' },
        },
      ]),
    'INVALID_CHANGESET',
  )
  expectCompileError(
    () =>
      compile([
        operation('duplicate', { type: 'remove', nodeId: 'text-a' }),
        operation('duplicate', { type: 'remove', nodeId: 'image-a' }),
      ]),
    'INVALID_CHANGESET',
    /opId/,
  )
  expectCompileError(
    () => compile([operation('unknown-node', { type: 'set', nodeId: 'missing', fieldId: 'props.text', value: 'x' })]),
    'UNKNOWN_NODE',
  )
  expectCompileError(
    () =>
      compile([operation('unknown-field', { type: 'set', nodeId: 'text-a', fieldId: 'props.missing', value: 'x' })]),
    'UNKNOWN_FIELD',
  )
  expectCompileError(
    () =>
      compile([operation('unknown-material', { type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'x' })], {
        manifests: manifests().filter(manifest => manifest.componentName !== 'Text'),
      }),
    'UNKNOWN_MATERIAL',
  )
  expectCompileError(
    () => compile([operation('readonly', { type: 'set', nodeId: 'text-a', fieldId: 'shared.id', value: 'other' })]),
    'UNSUPPORTED_FIELD',
  )
  expectCompileError(
    () => compile([operation('bad-rect', { type: 'resize', nodeId: 'text-a', rect: { ...rect(0, 0, 1, 1), z: 2 } })]),
    'INVALID_CHANGESET',
    /rect/,
  )
  expectCompileError(
    () => compile([operation('negative-rect', { type: 'resize', nodeId: 'text-a', rect: rect(0, 0, -1, 1) })]),
    'VALUE_CONSTRAINT',
  )
  expectCompileError(
    () => compile([operation('undefined', { type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: undefined })]),
    'INVALID_JSON',
  )
  expectCompileError(
    () =>
      compile([
        operation('expression', {
          type: 'set',
          nodeId: 'text-a',
          fieldId: 'props.text',
          value: { type: 'JSExpression', value: 'globalThis.alert(1)' },
        }),
      ]),
    'INVALID_JSON',
  )
  expectCompileError(
    () =>
      compile([
        operation('write-one', { type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'one' }),
        operation('write-two', { type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'two' }),
      ]),
    'WRITE_CONFLICT',
  )

  const document = { id: 'document-a', mutationVersion: 12, schema: createSchema() }
  expectCompileError(
    () =>
      compileScreenChangeSet({
        schemaVersion: 1,
        projectId: 'project-a',
        branchId: 'branch-a',
        callId: CALL_ID,
        materialRegistryVersion: REGISTRY_VERSION,
        expectedMutationVersion: 11,
        document,
        manifests: manifests(),
        changeSet: {
          schemaVersion: 1,
          documentId: document.id,
          operations: [operation('remove-stale', { type: 'remove', nodeId: 'text-a' })],
        },
      }),
    'STALE_MUTATION_VERSION',
  )

  const lockedOldParent = createSchema()
  lockedOldParent.children[2].locked = true
  expectCompileError(
    () =>
      compile([operation('move-from-locked', { type: 'move', nodeId: 'nested-text', parentId: 'root' })], {
        document: { id: 'document-a', mutationVersion: 11, schema: lockedOldParent },
      }),
    'AMBIGUOUS_STRUCTURE',
  )

  const identityCollision = createSchema()
  identityCollision.children.push({
    componentName: 'Text',
    id: deriveInsertedScreenNodeId(CALL_ID, 'colliding-insert'),
    props: { text: 'existing' },
  })
  expectCompileError(
    () =>
      compile(
        [
          operation('colliding-insert', {
            type: 'insert',
            parentId: 'root',
            componentName: 'Text',
          }),
        ],
        { document: { id: 'document-a', mutationVersion: 11, schema: identityCollision } },
      ),
    'AMBIGUOUS_STRUCTURE',
    /opId/,
    /already-exists/,
  )
})

test('Core-incompatible manifest paths and non-executable unset inverses fail closed', () => {
  for (const segment of ['style.color', 'items[0]', 'white space']) {
    const unsafe = replaceTextManifest(manifest => {
      manifest.fields.push({
        access: 'read-write',
        fieldId: `unsafe-${segment}`,
        writeTargets: [{ path: ['props', segment] }],
        unsetTargets: [{ path: ['props', segment] }],
      })
    })
    expectCompileError(
      () =>
        compile([operation('path-check', { type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'x' })], {
          manifests: unsafe,
        }),
      'INVALID_MANIFEST',
      /path/,
      /not-supported-by-core/,
    )
  }

  const asymmetric = replaceTextManifest(manifest => {
    manifest.fields.push({
      access: 'read-write',
      fieldId: 'asymmetric',
      valueSchema: { type: 'object' },
      writeTargets: [{ path: ['props', 'a'], valuePath: ['a'] }],
      unsetTargets: [{ path: ['props', 'b'], valuePath: ['b'] }],
    })
  })
  const schema = createSchema()
  schema.children[0].props.b = 'before'
  expectCompileError(
    () =>
      compile([operation('asymmetric-unset', { type: 'unset', nodeId: 'text-a', fieldId: 'asymmetric' })], {
        manifests: asymmetric,
        document: { id: 'document-a', mutationVersion: 11, schema },
      }),
    'INVERSE_UNREPRESENTABLE',
    /operations\[0\]/,
    /not-symmetric/,
  )
})

test('untrusted manifest regex patterns are rejected before evaluating a long Agent string', () => {
  const unsafe = replaceTextManifest(manifest => {
    const textField = manifest.fields.find(candidate => candidate.fieldId === 'props.text')
    textField.valueSchema = { pattern: '(a+)+$', type: 'string' }
  })
  const longAgentValue = `${'a'.repeat(64_000)}!`
  const NativeRegExp = globalThis.RegExp
  let regexConstructionCount = 0
  let caught

  try {
    globalThis.RegExp = function ForbiddenAgentRegexEvaluation() {
      regexConstructionCount += 1
      throw new Error('Screen validation must not construct material-provided regular expressions')
    }
    try {
      compile(
        [
          operation('unsafe-pattern', {
            type: 'set',
            nodeId: 'text-a',
            fieldId: 'props.text',
            value: longAgentValue,
          }),
        ],
        { manifests: unsafe },
      )
    } catch (error) {
      caught = error
    }
  } finally {
    globalThis.RegExp = NativeRegExp
  }

  assert.equal(regexConstructionCount, 0)
  assert.ok(caught instanceof ScreenChangeSetCompileError)
  assert.equal(caught.code, 'UNSUPPORTED_VALUE_SCHEMA')
  assert.equal(caught.path, 'manifest.valueSchema.pattern')
  assert.equal(caught.reason, 'unsupported-schema-keyword')
})

test('null is a value, descendant aliases are prepared, and unset is always explicit', () => {
  const nullableManifests = replaceTextManifest(manifest => {
    manifest.fields.push({
      access: 'read-write',
      fieldId: 'nullable',
      readPath: ['props', 'nullable'],
      unsetTargets: [{ path: ['props', 'nullable'] }],
      valueSchema: { enum: [null] },
      verifyPaths: [['props', 'nullable']],
      writeTargets: [{ path: ['props', 'nullable'] }],
    })
  })
  const nullable = compile(
    [operation('set-null', { type: 'set', nodeId: 'text-a', fieldId: 'nullable', value: null })],
    { manifests: nullableManifests },
  )
  assert.deepEqual(nullable.commands[0].props, { nullable: null })
  assert.equal(nullable.commands[0].unsetPropPaths, undefined)
  assert.equal(nullable.expectedPostImages[0].existed, true)
  assert.equal(nullable.expectedPostImages[0].value, null)

  const descendantManifests = replaceTextManifest(manifest => {
    manifest.fields.push({
      access: 'read-write',
      fieldId: 'style-object',
      valueSchema: { type: 'object' },
      writeTargets: [{ path: ['props', 'style'] }],
      unsetTargets: [{ path: ['props', 'style'] }],
    })
  })
  const schema = createSchema()
  schema.children[0].props.style = { color: 'red', nested: { weight: 400 } }
  const descendants = compile(
    [
      operation('set-style', {
        type: 'set',
        nodeId: 'text-a',
        fieldId: 'style-object',
        value: { color: 'blue', nested: { italic: true } },
      }),
    ],
    { manifests: descendantManifests, document: { id: 'document-a', mutationVersion: 11, schema } },
  )
  const aliases = descendants.affectedFieldSlots.find(slot => slot.fieldId === 'style-object').aliases
  assert.ok(aliases.some(alias => alias.endsWith('/props/style/color')))
  assert.ok(aliases.some(alias => alias.endsWith('/props/style/nested/weight')))
  assert.ok(aliases.some(alias => alias.endsWith('/props/style/nested/italic')))
})

test('registry fences, semantic fingerprints, input budgets, and canonical output are deterministic', () => {
  const leftValue = { base64: 'stable.png', raw: { height: 20, width: 30 } }
  const rightValue = { raw: { width: 30, height: 20 }, base64: 'stable.png' }
  const left = compile([
    operation('stable', { type: 'set', nodeId: 'image-a', fieldId: 'image.source', value: leftValue }),
  ])
  const right = compile(
    [operation('stable', { value: rightValue, fieldId: 'image.source', nodeId: 'image-a', type: 'set' })],
    { manifests: manifests().reverse() },
  )

  assert.deepEqual(left, right)
  assert.equal(JSON.stringify(left.fingerprintInputs), JSON.stringify(right.fingerprintInputs))
  assert.equal(left.baseMutationVersion, 11)
  assert.equal(left.materialRegistryVersion, REGISTRY_VERSION)
  assert.equal(left.fingerprintInputs.transactionFingerprint.baseMutationVersion, 11)
  assert.deepEqual(left.fingerprintInputs.preparedHash.affectedFieldSlots, left.affectedFieldSlots)
  assert.deepEqual(left.fingerprintInputs.preparedHash.affectedStructuralSlots, left.affectedStructuralSlots)
  assert.ok(left.manifestFingerprints.every(item => item.semanticDigest.startsWith('manifest-v1-')))
  assert.ok(left.manifestFingerprints.every(item => Object.isFrozen(item.semanticDescriptor)))
  assert.ok(Object.isFrozen(left))
  assert.ok(Object.isFrozen(left.commands))

  const changedSemantics = replaceTextManifest(manifest => {
    const field = manifest.fields.find(candidate => candidate.fieldId === 'props.text')
    field.valueSchema = { ...field.valueSchema, maxLength: 79 }
  })
  const changed = compile(
    [operation('stable', { type: 'set', nodeId: 'image-a', fieldId: 'image.source', value: leftValue })],
    { manifests: changedSemantics },
  )
  assert.notEqual(
    left.manifestFingerprints.find(item => item.componentName === 'Text').semanticDigest,
    changed.manifestFingerprints.find(item => item.componentName === 'Text').semanticDigest,
  )
  assert.notDeepEqual(left.fingerprintInputs.preparedHash, changed.fingerprintInputs.preparedHash)

  expectCompileError(
    () =>
      compile([operation('stale-registry', { type: 'remove', nodeId: 'text-a' })], {
        materialRegistryVersion: REGISTRY_VERSION + 1,
      }),
    'INVALID_MANIFEST',
    /materialRegistryVersion/,
  )
  const mixed = manifests()
  mixed[0] = { ...mixed[0], materialRegistryVersion: REGISTRY_VERSION + 1 }
  expectCompileError(
    () => compile([operation('mixed-registry', { type: 'remove', nodeId: 'text-a' })], { manifests: mixed }),
    'INVALID_MANIFEST',
    /materialRegistryVersion/,
  )
  const notReady = manifests()
  notReady[0] = {
    ...notReady[0],
    readiness: { status: 'not-ready', missingFieldIds: ['missing'], unsupportedFieldIds: [] },
  }
  const readyManifestSubset = notReady.filter(manifest => manifest.readiness.status === 'ready')
  const readySubsetResult = compile([operation('unrelated-not-ready', { type: 'remove', nodeId: 'text-a' })], {
    manifests: readyManifestSubset,
  })
  assert.equal(
    readySubsetResult.manifestFingerprints.some(fingerprint => fingerprint.componentName === 'Root'),
    false,
  )
  expectCompileError(
    () =>
      compile(
        [operation('budget', { type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'x'.repeat(1000) })],
        {
          options: { limits: { maxInputBytes: 512 } },
        },
      ),
    'BUDGET_EXCEEDED',
  )
  expectCompileError(
    () =>
      compile(
        [
          operation('budget-one', { type: 'remove', nodeId: 'text-a' }),
          operation('budget-two', { type: 'remove', nodeId: 'image-a' }),
        ],
        { options: { limits: { maxOperations: 1 } } },
      ),
    'BUDGET_EXCEEDED',
  )
  assert.ok(DEFAULT_SCREEN_CHANGESET_LIMITS.maxInputBytes > 0)
})

test('compiled Core commands execute and public field inverses recompile to restore the raw schema', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  const initialSchema = createSchema()
  initialSchema.docId = 'document-a'
  engine.loadProject(
    {
      id: 'project-a',
      version: '0.0.1',
      componentsMap: [],
      componentsTree: [initialSchema],
    },
    true,
  )
  const document = engine.project.currentDocument
  const before = structuredClone(document.exportRaw())
  const forward = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: 'project-a',
    branchId: 'branch-a',
    callId: 'core-forward',
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: { id: document.id, mutationVersion: document.mutationVersion, schema: before },
    manifests: manifests(),
    changeSet: {
      schemaVersion: 1,
      documentId: document.id,
      operations: [
        operation('core-set', { type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'core-after' }),
        operation('core-unset', { type: 'unset', nodeId: 'text-a', fieldId: 'shared.title' }),
      ],
    },
  })
  engine.transactions.runOnDocument(document, forward.commands, {
    expectedMutationVersion: forward.baseMutationVersion,
  })
  assert.equal(document.getNode('text-a').getPropValue('text'), 'core-after')
  assert.equal(Object.hasOwn(document.getNode('text-a').exportRaw(), 'title'), false)

  const inverseOperations = forward.inverseOperations.map(record => record.operation)
  const inverse = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: 'project-a',
    branchId: 'branch-a',
    callId: 'core-inverse',
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: { id: document.id, mutationVersion: document.mutationVersion, schema: document.exportRaw() },
    manifests: manifests(),
    changeSet: { schemaVersion: 1, documentId: document.id, operations: inverseOperations },
  })
  engine.transactions.runOnDocument(document, inverse.commands, {
    expectedMutationVersion: inverse.baseMutationVersion,
  })
  assert.deepEqual(document.exportRaw(), before)

  const structuralForward = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: 'project-a',
    branchId: 'branch-a',
    callId: 'core-insert-forward',
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: { id: document.id, mutationVersion: document.mutationVersion, schema: document.exportRaw() },
    manifests: manifests(),
    changeSet: {
      schemaVersion: 1,
      documentId: document.id,
      operations: [
        operation('core-insert', {
          type: 'insert',
          parentId: 'root',
          componentName: 'Text',
          fields: { 'props.text': 'temporary' },
        }),
      ],
    },
  })
  engine.transactions.runOnDocument(document, structuralForward.commands, {
    expectedMutationVersion: structuralForward.baseMutationVersion,
  })
  const insertedNodeId = structuralForward.insertedNodeIdentities[0].nodeId
  assert.equal(document.getNode(insertedNodeId).getPropValue('text'), 'temporary')

  const structuralInverse = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: 'project-a',
    branchId: 'branch-a',
    callId: 'core-insert-inverse',
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: { id: document.id, mutationVersion: document.mutationVersion, schema: document.exportRaw() },
    manifests: manifests(),
    changeSet: {
      schemaVersion: 1,
      documentId: document.id,
      operations: [structuralForward.inverseOperations[0].operation],
    },
  })
  engine.transactions.runOnDocument(document, structuralInverse.commands, {
    expectedMutationVersion: structuralInverse.baseMutationVersion,
  })
  assert.deepEqual(document.exportRaw(), before)

  const moveForward = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: 'project-a',
    branchId: 'branch-a',
    callId: 'core-move-forward',
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: { id: document.id, mutationVersion: document.mutationVersion, schema: document.exportRaw() },
    manifests: manifests(),
    changeSet: {
      schemaVersion: 1,
      documentId: document.id,
      operations: [
        operation('core-move', {
          type: 'move',
          nodeId: 'text-a',
          parentId: 'container-a',
          position: { place: 'after', siblingId: 'nested-text' },
        }),
      ],
    },
  })
  engine.transactions.runOnDocument(document, moveForward.commands, {
    expectedMutationVersion: moveForward.baseMutationVersion,
  })
  assert.equal(document.getNode('text-a').parent.id, 'container-a')

  const moveInverse = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: 'project-a',
    branchId: 'branch-a',
    callId: 'core-move-inverse',
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: { id: document.id, mutationVersion: document.mutationVersion, schema: document.exportRaw() },
    manifests: manifests(),
    changeSet: {
      schemaVersion: 1,
      documentId: document.id,
      operations: [moveForward.inverseOperations[0].operation],
    },
  })
  engine.transactions.runOnDocument(document, moveInverse.commands, {
    expectedMutationVersion: moveInverse.baseMutationVersion,
  })
  assert.deepEqual(document.exportRaw(), before)

  const reorderForward = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: 'project-a',
    branchId: 'branch-a',
    callId: 'core-reorder-forward',
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: { id: document.id, mutationVersion: document.mutationVersion, schema: document.exportRaw() },
    manifests: manifests(),
    changeSet: {
      schemaVersion: 1,
      documentId: document.id,
      operations: [
        operation('core-reorder', {
          type: 'reorder',
          nodeId: 'container-a',
          position: { place: 'first' },
        }),
      ],
    },
  })
  engine.transactions.runOnDocument(document, reorderForward.commands, {
    expectedMutationVersion: reorderForward.baseMutationVersion,
  })
  assert.deepEqual(
    document.root.children.children.map(node => node.id),
    ['container-a', 'text-a', 'image-a'],
  )

  const reorderInverse = compileScreenChangeSet({
    schemaVersion: 1,
    projectId: 'project-a',
    branchId: 'branch-a',
    callId: 'core-reorder-inverse',
    materialRegistryVersion: REGISTRY_VERSION,
    expectedMutationVersion: document.mutationVersion,
    document: { id: document.id, mutationVersion: document.mutationVersion, schema: document.exportRaw() },
    manifests: manifests(),
    changeSet: {
      schemaVersion: 1,
      documentId: document.id,
      operations: [reorderForward.inverseOperations[0].operation],
    },
  })
  engine.transactions.runOnDocument(document, reorderInverse.commands, {
    expectedMutationVersion: reorderInverse.baseMutationVersion,
  })
  assert.deepEqual(document.exportRaw(), before)
})
