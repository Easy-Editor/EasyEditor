import assert from 'node:assert/strict'
import test from 'node:test'

import { compileSafeMaterialManifest, createSafeMaterialManifestCache } from '../src/editor/agent/manifest/index.mjs'
import { dashboardConfigureAnnotations } from '../src/editor/agent/phase-0-contracts.mjs'

const callback = () => {
  throw new Error('configure callback must never cross the manifest boundary')
}

const sharedFields = () => [
  {
    name: 'id',
    setter: 'NodeIdSetter',
    title: 'ID',
  },
  {
    extraProps: { getValue: callback, setValue: callback },
    name: 'title',
    setter: 'StringSetter',
    title: '标题',
  },
  {
    items: [
      {
        extraProps: { getValue: callback, setValue: callback },
        name: 'rect',
        setter: 'RectSetter',
        title: '位置尺寸',
      },
    ],
    title: '基础属性',
    type: 'group',
  },
]

const createMetadata = ({ componentName = 'Text', extraFields = [], includeVisibility = true } = {}) => ({
  apiToken: 'must-not-leak',
  componentName,
  configure: {
    advanced: { view: function ReactMaterialView() {} },
    props: [
      {
        items: [
          {
            items: [...sharedFields(), ...extraFields],
            key: 'basic',
            type: 'group',
          },
          ...(includeVisibility
            ? [
                {
                  items: [
                    {
                      items: [
                        {
                          extraProps: { condition: callback, getValue: callback, setValue: callback },
                          name: 'condition',
                          setter: 'SwitchSetter',
                          title: '显隐',
                        },
                      ],
                      type: 'group',
                    },
                  ],
                  key: 'advanced',
                  type: 'group',
                },
              ]
            : []),
        ],
        type: 'group',
      },
    ],
  },
  group: '基础',
  secret: { credential: 'never' },
  snippets: [{ schema: { props: { password: 'never' } } }],
  title: componentName,
})

const field = (manifest, fieldId) => manifest.fields.find(item => item.fieldId === fieldId)

test('safe configure compiler emits annotated shared fields and conservative props fallback', () => {
  const metadata = createMetadata({
    extraFields: [
      {
        extraProps: { isRequired: true },
        name: 'text',
        setter: {
          componentName: 'StringSetter',
          props: { maxLength: 80, minLength: 1, pattern: '^[^<>]+$' },
        },
        title: '文本',
      },
      {
        name: 'count',
        setter: {
          componentName: 'NumberSetter',
          props: { max: 10, min: 0, step: 0.5 },
        },
      },
      {
        name: 'mode',
        setter: {
          componentName: 'SelectSetter',
          props: {
            options: [
              { label: 'A', value: 'a' },
              { label: 'B', value: 'b' },
            ],
          },
        },
      },
      {
        name: 'unsafe',
        setter: () => 'StringSetter',
      },
    ],
  })

  const manifest = compileSafeMaterialManifest({ materialRegistryVersion: 7, metadata })

  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.materialRegistryVersion, 7)
  assert.deepEqual(field(manifest, 'shared.id'), {
    access: 'read-only',
    fieldId: 'shared.id',
    readPath: ['node', 'id'],
    title: 'ID',
    verifyPaths: [['node', 'id']],
  })
  assert.deepEqual(field(manifest, 'shared.title')?.writeTargets, [{ path: ['extra', 'title'] }])
  assert.deepEqual(field(manifest, 'shared.title')?.unsetTargets, [{ path: ['extra', 'title'] }])
  assert.deepEqual(
    field(manifest, 'shared.rect')?.valueSchema,
    dashboardConfigureAnnotations['shared.rect'].valueSchema,
  )
  assert.deepEqual(field(manifest, 'shared.visibility')?.readPath, ['extra', 'condition'])
  assert.deepEqual(field(manifest, 'shared.visibility')?.verifyPaths, [['extra', 'condition']])

  assert.deepEqual(field(manifest, 'props.text'), {
    access: 'read-write',
    fieldId: 'props.text',
    readPath: ['props', 'text'],
    required: true,
    title: '文本',
    unsetTargets: [{ path: ['props', 'text'] }],
    valueSchema: { maxLength: 80, minLength: 1, pattern: '^[^<>]+$', type: 'string' },
    verifyPaths: [['props', 'text']],
    writeTargets: [{ path: ['props', 'text'] }],
  })
  assert.deepEqual(field(manifest, 'props.count')?.valueSchema, {
    maximum: 10,
    minimum: 0,
    multipleOf: 0.5,
    type: 'number',
  })
  assert.deepEqual(field(manifest, 'props.mode')?.valueSchema, { enum: ['a', 'b'] })
  assert.equal(manifest.fields.find(item => item.fieldId.startsWith('unsupported:unsafe:'))?.access, 'unsupported')
  assert.ok(manifest.diagnostics.some(item => item.code === 'callback-annotation-required'))

  const serialized = JSON.stringify(manifest)
  assert.doesNotMatch(
    serialized,
    /must-not-leak|credential|ReactMaterialView|password|snippets|apiToken|advanced\.view/,
  )
  assert.doesNotMatch(serialized, /function\s|=>/)
  assert.ok(Object.isFrozen(manifest))
  assert.ok(Object.isFrozen(manifest.fields))
})

test('callback-backed Root and Image fields use explicit rename and multi-target annotations', () => {
  const createImageField = () => ({
    extraProps: { getValue: callback, onChange: callback, setValue: callback },
    name: '__image',
    setter: 'UploadSetter',
    title: '图片地址',
  })
  const root = compileSafeMaterialManifest({
    materialRegistryVersion: 2,
    metadata: createMetadata({ componentName: 'Root', extraFields: [createImageField()], includeVisibility: false }),
  })
  const image = compileSafeMaterialManifest({
    materialRegistryVersion: 2,
    metadata: createMetadata({ componentName: 'Image', extraFields: [createImageField()] }),
  })

  assert.deepEqual(field(root, 'root.image'), {
    access: 'read-write',
    fieldId: 'root.image',
    readPath: ['props', 'backgroundImage'],
    title: '图片地址',
    unsetTargets: [{ path: ['props', 'backgroundImage'] }],
    valueSchema: dashboardConfigureAnnotations['root.image'].valueSchema,
    verifyPaths: [['props', 'backgroundImage']],
    writeTargets: [{ path: ['props', 'backgroundImage'], valuePath: ['base64'] }],
  })
  assert.deepEqual(field(image, 'image.source')?.writeTargets, [
    { path: ['props', 'src'], valuePath: ['base64'] },
    { path: ['extra', '$dashboard', 'rect', 'width'], valuePath: ['raw', 'width'] },
    { path: ['extra', '$dashboard', 'rect', 'height'], valuePath: ['raw', 'height'] },
  ])
  assert.deepEqual(field(image, 'image.source')?.unsetTargets, [{ path: ['props', 'src'] }])
  assert.deepEqual(field(image, 'image.source')?.verifyPaths, [
    ['props', 'src'],
    ['extra', '$dashboard', 'rect', 'width'],
    ['extra', '$dashboard', 'rect', 'height'],
  ])
})

test('invalid annotations and callback fields fail closed instead of guessing paths', () => {
  const cyclicSchema = { type: 'object' }
  cyclicSchema.properties = cyclicSchema
  const manifest = compileSafeMaterialManifest({
    annotationBindings: { '*': { danger: 'custom.danger' } },
    annotations: {
      ...dashboardConfigureAnnotations,
      'custom.danger': {
        access: 'read-write',
        fieldId: 'custom.danger',
        readPath: ['props', 'danger'],
        valueSchema: cyclicSchema,
        verifyPaths: [['props', 'danger']],
        writeTargets: [{ path: ['props', 'danger'] }],
      },
    },
    materialRegistryVersion: 1,
    metadata: createMetadata({
      extraFields: [{ extraProps: { setValue: callback }, name: 'danger', setter: 'StringSetter' }],
    }),
  })

  assert.equal(field(manifest, 'custom.danger')?.access, 'unsupported')
  assert.ok(manifest.diagnostics.some(item => item.code === 'cycle-detected' && item.fieldId === 'custom.danger'))
  assert.doesNotThrow(() => JSON.stringify(manifest))
})

test('cyclic, oversized, accessor-backed, and malformed configure data produce bounded diagnostics', () => {
  const cycle = []
  cycle.push({ items: cycle, type: 'group' })
  const cyclic = compileSafeMaterialManifest({
    materialRegistryVersion: 1,
    metadata: { componentName: 'Cyclic', configure: { props: cycle } },
  })
  assert.deepEqual(cyclic.fields, [])
  assert.ok(cyclic.diagnostics.some(item => item.code === 'cycle-detected'))

  const huge = compileSafeMaterialManifest({
    limits: { maxFields: 4 },
    materialRegistryVersion: 1,
    metadata: {
      componentName: 'Huge',
      configure: {
        props: Array.from({ length: 8 }, (_, index) => ({ name: `value${index}`, setter: 'StringSetter' })),
      },
    },
  })
  assert.equal(huge.fields.length, 4)
  assert.ok(huge.diagnostics.some(item => item.code === 'configure-limit-exceeded'))

  const accessorField = {}
  Object.defineProperty(accessorField, 'name', { get: callback })
  const accessor = compileSafeMaterialManifest({
    materialRegistryVersion: 1,
    metadata: { componentName: 'Accessor', configure: { props: [accessorField] } },
  })
  assert.deepEqual(accessor.fields, [])
  assert.ok(accessor.diagnostics.some(item => item.code === 'accessor-rejected'))

  const malformed = compileSafeMaterialManifest({
    materialRegistryVersion: 1,
    metadata: { componentName: 'Malformed', configure: { props: { nope: true } } },
  })
  assert.deepEqual(malformed.fields, [])
  assert.ok(malformed.diagnostics.some(item => item.code === 'invalid-configure'))
})

test('field-name bindings survive reorder and fail closed on duplicate, unnamed, or ambiguous callback fields', () => {
  const id = { name: 'id', setter: 'NodeIdSetter', title: 'ID' }
  const title = { extraProps: { setValue: callback }, name: 'title', setter: 'StringSetter', title: '标题' }
  const rect = { extraProps: { getValue: callback }, name: 'rect', setter: 'RectSetter', title: '位置尺寸' }
  const condition = { extraProps: { condition: callback }, name: 'condition', setter: 'SwitchSetter', title: '显隐' }
  const compile = props =>
    compileSafeMaterialManifest({
      materialRegistryVersion: 1,
      metadata: { componentName: 'Fixture', configure: { props } },
    })

  assert.deepEqual(compile([id, title, rect, condition]).fields, compile([condition, rect, id, title]).fields)

  const duplicate = compile([title, { ...title }])
  assert.equal(field(duplicate, 'shared.title'), undefined)
  assert.equal(duplicate.fields.filter(item => item.access === 'unsupported').length, 2)
  assert.equal(duplicate.diagnostics.filter(item => item.code === 'ambiguous-field-binding').length, 2)

  const unnamed = compile([{ extraProps: { setValue: callback }, setter: 'SwitchSetter', title: '显隐' }])
  assert.equal(field(unnamed, 'shared.visibility'), undefined)
  assert.equal(unnamed.fields[0].access, 'unsupported')
  assert.ok(unnamed.diagnostics.some(item => item.code === 'callback-annotation-required'))

  const specificWins = compileSafeMaterialManifest({
    annotationBindings: {
      '*': { __image: 'shared.title' },
      Image: { __image: 'image.source' },
    },
    materialRegistryVersion: 1,
    metadata: {
      componentName: 'Image',
      configure: { props: [{ extraProps: { setValue: callback }, name: '__image', setter: 'UploadSetter' }] },
    },
  })
  assert.ok(field(specificWins, 'image.source'))
  assert.equal(field(specificWins, 'shared.title'), undefined)
})

test('manifest readiness reports future material gaps without inventing Text or chart fields', () => {
  for (const [componentName, missingFieldId] of [
    ['Text', 'props.text'],
    ['BarChart', 'props.data'],
    ['LineChart', 'props.data'],
  ]) {
    const manifest = compileSafeMaterialManifest({
      materialRegistryVersion: 1,
      metadata: createMetadata({ componentName }),
    })
    assert.equal(field(manifest, missingFieldId), undefined)
    assert.equal(manifest.readiness.status, 'not-ready')
    assert.deepEqual(manifest.readiness.missingFieldIds, [missingFieldId])
  }
})

test('annotation validation rejects prototype segments and overlapping writes without invoking callbacks', () => {
  let callbackInvocations = 0
  const neverInvoke = () => {
    callbackInvocations += 1
    throw new Error('must not invoke')
  }
  const metadata = {
    componentName: 'Hostile',
    configure: {
      props: [
        { extraProps: { setValue: neverInvoke }, name: 'overlap', setter: 'StringSetter' },
        { extraProps: { getValue: neverInvoke }, name: 'poison', setter: 'StringSetter' },
      ],
    },
  }
  const manifest = compileSafeMaterialManifest({
    annotationBindings: { Hostile: { overlap: 'custom.overlap', poison: 'custom.prototype' } },
    annotations: {
      ...dashboardConfigureAnnotations,
      'custom.overlap': {
        access: 'read-write',
        fieldId: 'custom.overlap',
        readPath: ['props', 'config'],
        verifyPaths: [['props', 'config']],
        writeTargets: [{ path: ['props', 'config'] }, { path: ['props', 'config', 'nested'] }],
      },
      'custom.prototype': {
        access: 'read-write',
        fieldId: 'custom.prototype',
        readPath: ['props', 'safe'],
        verifyPaths: [['props', 'safe']],
        writeTargets: [{ path: ['props', '__proto__'] }],
      },
    },
    materialRegistryVersion: 1,
    metadata,
  })

  assert.equal(callbackInvocations, 0)
  assert.equal(field(manifest, 'custom.overlap')?.access, 'unsupported')
  assert.equal(field(manifest, 'custom.prototype')?.access, 'unsupported')
  assert.ok(manifest.diagnostics.some(item => item.code === 'overlapping-write-targets'))
  assert.ok(manifest.diagnostics.some(item => item.code === 'invalid-annotation'))
})

test('manifest cache loads per material, keys by registry version, and supports explicit invalidation', async () => {
  const loads = []
  let registryVersion = 4
  const cache = createSafeMaterialManifestCache({
    loadMetadata(componentName) {
      loads.push(componentName)
      return createMetadata({ componentName })
    },
    readMaterialRegistryVersion: () => registryVersion,
  })

  const firstText = await cache.get('Text', 4)
  const secondText = await cache.get('Text', 4)
  assert.strictEqual(secondText, firstText)
  assert.deepEqual(loads, ['Text'])
  assert.equal(cache.size, 1)

  await cache.get('Image', 4)
  assert.deepEqual(loads, ['Text', 'Image'])
  assert.equal(cache.size, 2)

  registryVersion = 5
  const nextText = await cache.get('Text', 5)
  assert.notStrictEqual(nextText, firstText)
  assert.deepEqual(loads, ['Text', 'Image', 'Text'])
  assert.equal(cache.size, 1)
  assert.equal(cache.materialRegistryVersion, 5)

  cache.invalidate(5)
  await cache.get('Text', 5)
  assert.deepEqual(loads, ['Text', 'Image', 'Text', 'Text'])
})

test('manifest cache single-flights requests and caches fail-closed load results', async () => {
  let loadCount = 0
  let resolveMetadata
  const metadataReady = new Promise(resolve => {
    resolveMetadata = resolve
  })
  const cache = createSafeMaterialManifestCache({
    loadMetadata: async componentName => {
      loadCount += 1
      await metadataReady
      return createMetadata({ componentName })
    },
    readMaterialRegistryVersion: () => 1,
  })

  const first = cache.get('Fixture', 1)
  const second = cache.get('Fixture', 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(loadCount, 1)
  resolveMetadata()
  const [firstManifest, secondManifest] = await Promise.all([first, second])
  assert.strictEqual(firstManifest, secondManifest)

  let failedLoads = 0
  const failingCache = createSafeMaterialManifestCache({
    loadMetadata() {
      failedLoads += 1
      throw new Error('secret-token-must-not-leak')
    },
    readMaterialRegistryVersion: () => 1,
  })
  const firstFailure = await failingCache.get('Broken', 1)
  const secondFailure = await failingCache.get('Broken', 1)
  assert.strictEqual(firstFailure, secondFailure)
  assert.equal(failedLoads, 1)
  assert.equal(firstFailure.diagnostics[0].code, 'material-load-failed')
  assert.doesNotMatch(JSON.stringify(firstFailure), /secret-token/)
})

test('stale delayed compiles cannot poison a newer material registry version', async () => {
  let registryVersion = 1
  let loadCount = 0
  let resolveFirstLoad
  const firstLoad = new Promise(resolve => {
    resolveFirstLoad = resolve
  })
  const cache = createSafeMaterialManifestCache({
    async loadMetadata(componentName) {
      loadCount += 1
      if (loadCount === 1) return firstLoad
      return createMetadata({ componentName })
    },
    readMaterialRegistryVersion: () => registryVersion,
  })

  const oldRequest = cache.get('Fixture', 1)
  await new Promise(resolve => setImmediate(resolve))
  registryVersion = 2
  const currentManifest = await cache.get('Fixture', 2)
  resolveFirstLoad(createMetadata({ componentName: 'Fixture' }))
  const staleManifest = await oldRequest

  assert.equal(staleManifest.diagnostics[0].code, 'stale-material-registry-version')
  assert.equal(currentManifest.materialRegistryVersion, 2)
  assert.strictEqual(await cache.get('Fixture', 2), currentManifest)
  assert.equal(loadCount, 2)

  const mismatched = await cache.get('Fixture', 1)
  assert.equal(mismatched.diagnostics[0].code, 'stale-material-registry-version')
  assert.equal(loadCount, 2)
})
