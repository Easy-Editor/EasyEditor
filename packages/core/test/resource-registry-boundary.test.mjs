import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

const createResource = (overrides = {}) => ({
  data: { capability: 'adapter-owned' },
  globalName: 'BoundaryResource',
  loadedAt: 1,
  name: 'boundary-resource',
  type: 'material',
  version: '1.0.0',
  ...overrides,
})

test('ResourceRegistry owns and freezes resource metadata while preserving the opaque data capability', async t => {
  const { ResourceRegistry } = await loadCore()
  const registry = new ResourceRegistry()
  t.after(() => registry.dispose())

  const data = { capability: 'adapter-owned' }
  const input = createResource({ data })
  registry.register(input)

  input.type = 'setter'
  input.name = 'rewritten-input'
  input.version = '9.9.9'
  input.globalName = 'RewrittenInput'
  input.loadedAt = 999

  const output = registry.get('material', 'boundary-resource')
  assert.ok(output)
  assert.notStrictEqual(output, input, 'the registry must own its metadata envelope')
  assert.equal(Object.isFrozen(output), true)
  assert.deepEqual(
    {
      globalName: output.globalName,
      loadedAt: output.loadedAt,
      name: output.name,
      type: output.type,
      version: output.version,
    },
    {
      globalName: 'BoundaryResource',
      loadedAt: 1,
      name: 'boundary-resource',
      type: 'material',
      version: '1.0.0',
    },
  )

  assert.throws(() => {
    output.name = 'rewritten-output'
  }, TypeError)
  assert.equal(Reflect.defineProperty(output, 'version', { value: '8.8.8' }), false)

  const all = registry.getAll()
  const materialNames = registry.getMaterialNames()
  const setterNames = registry.getSetterNames()
  assert.equal(Object.isFrozen(all), true)
  assert.equal(Object.isFrozen(materialNames), true)
  assert.equal(Object.isFrozen(setterNames), true)
  assert.strictEqual(all[0], output, 'bulk reads must expose the same frozen owned envelope')
  assert.throws(() => all.push(createResource()), TypeError)
  assert.throws(() => materialNames.push('forged'), TypeError)
  assert.throws(() => setterNames.push('forged'), TypeError)

  assert.strictEqual(output.data, data, 'data is an explicitly opaque adapter-owned capability leaf')
  data.capability = 'still-shared'
  assert.equal(registry.get('material', 'boundary-resource').data.capability, 'still-shared')
})

test('ResourceRegistry runtime-private maps resist reflection shadowing and validate routing metadata', async t => {
  const { ResourceRegistry } = await loadCore()
  const registry = new ResourceRegistry()
  t.after(() => registry.dispose())

  assert.equal(Reflect.get(registry, 'materials'), undefined)
  assert.equal(Reflect.get(registry, 'setters'), undefined)
  assert.equal(Reflect.get(registry, 'getMap'), undefined)
  assert.equal(Reflect.ownKeys(registry).includes('materials'), false)
  assert.equal(Reflect.ownKeys(registry).includes('setters'), false)

  const forgedResource = Object.freeze(createResource({ name: 'forged' }))
  const forgedMaterials = new Map([['forged', forgedResource]])
  const forgedSetters = new Map([['forged', forgedResource]])
  Object.defineProperties(registry, {
    getMap: { value: () => forgedMaterials },
    materials: { value: forgedMaterials },
    setters: { value: forgedSetters },
  })

  registry.register(createResource({ name: 'owned' }))
  assert.equal(registry.has('material', 'owned'), true)
  assert.equal(registry.has('material', 'forged'), false)
  assert.deepEqual(registry.getMaterialNames(), ['owned'])
  registry.clearAll()
  assert.equal(registry.materialCount, 0)
  assert.equal(forgedMaterials.has('forged'), true, 'shadow state must never become registry backing state')
  assert.equal(forgedSetters.has('forged'), true, 'shadow state must never become registry backing state')

  const invalidResources = [
    [null, /must be an object/],
    [createResource({ type: 'script' }), /type must be "material" or "setter"/],
    [createResource({ name: '  ' }), /name must be a non-empty string/],
    [createResource({ version: '' }), /version must be a non-empty string/],
    [createResource({ globalName: '' }), /globalName must be a non-empty string/],
    [createResource({ loadedAt: Number.NaN }), /loadedAt must be a finite non-negative number/],
    [createResource({ loadedAt: -1 }), /loadedAt must be a finite non-negative number/],
  ]
  for (const [resource, expected] of invalidResources) {
    assert.throws(() => registry.register(resource), expected)
  }
  let accessorReads = 0
  const accessorResource = createResource()
  Object.defineProperty(accessorResource, 'name', {
    enumerable: true,
    get() {
      accessorReads += 1
      return 'must-not-run'
    },
  })
  assert.throws(() => registry.register(accessorResource), /name must be an own data property/)
  assert.equal(accessorReads, 0)
  assert.equal(registry.materialCount, 0)
  assert.equal(registry.setterCount, 0)
  assert.throws(() => registry.getAll('script'), /type must be "material" or "setter"/)
})

test('ResourceRegistry preserves unload behavior and is reusable across engine lifecycle generations', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => engine.destroy())

  await engine.init()
  const registry = engine.remote.registry
  registry.register(createResource({ name: 'generation-one' }))
  assert.equal(registry.unload('material', 'generation-one'), true)
  assert.equal(registry.unload('material', 'generation-one'), false)
  registry.register(createResource({ name: 'generation-one' }))

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(registry.has('material', 'generation-one'), false)
  assert.deepEqual(registry.getAll(), [])

  await engine.init()
  const data = { generation: 2 }
  registry.register(
    createResource({
      data,
      name: 'generation-two',
      type: 'setter',
    }),
  )

  const restarted = registry.get('setter', 'generation-two')
  assert.ok(restarted)
  assert.equal(Object.isFrozen(restarted), true)
  assert.strictEqual(restarted.data, data)
  assert.deepEqual(registry.getSetterNames(), ['generation-two'])
})
