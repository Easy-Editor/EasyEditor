import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

const assertReadonlyMapMutation = (operation, message) => {
  assert.throws(operation, /read-only.*registerSetter/i, message)
}

test('registered setters own and freeze plain data while retaining opaque component identity', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(async () => engine.destroy())

  const component = { revision: 1 }
  const defaultProps = {
    appearance: { tone: 'calm' },
    choices: [{ value: 'first' }],
  }
  const customData = {
    nested: { enabled: true },
    labels: ['one', 'two'],
  }
  const input = {
    component,
    customData,
    defaultProps,
    name: 'OwnedSetter',
  }

  engine.setters.registerSetter('OwnedSetter', input)
  const registered = engine.setters.getSetter('OwnedSetter')

  assert.ok(registered)
  assert.ok(Object.isFrozen(registered))
  assert.strictEqual(registered.component, component)
  assert.notStrictEqual(registered.defaultProps, defaultProps)
  assert.notStrictEqual(registered.customData, customData)
  assert.ok(Object.isFrozen(registered.defaultProps))
  assert.ok(Object.isFrozen(registered.defaultProps.appearance))
  assert.ok(Object.isFrozen(registered.defaultProps.choices))
  assert.ok(Object.isFrozen(registered.defaultProps.choices[0]))
  assert.ok(Object.isFrozen(registered.customData))
  assert.ok(Object.isFrozen(registered.customData.nested))
  assert.ok(Object.isFrozen(registered.customData.labels))

  defaultProps.appearance.tone = 'mutated outside'
  defaultProps.choices[0].value = 'mutated outside'
  customData.nested.enabled = false
  customData.labels.push('mutated outside')

  assert.equal(registered.defaultProps.appearance.tone, 'calm')
  assert.equal(registered.defaultProps.choices[0].value, 'first')
  assert.equal(registered.customData.nested.enabled, true)
  assert.deepEqual(registered.customData.labels, ['one', 'two'])
  assert.throws(() => {
    registered.defaultProps.appearance.tone = 'mutated through output'
  }, TypeError)
  assert.throws(() => {
    registered.customData.labels.push('mutated through output')
  }, TypeError)

  component.revision = 2
  assert.equal(registered.component.revision, 2)
  assert.equal(Object.isFrozen(component), false)
})

test('setter storage remains private when public names are reflectively shadowed', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(async () => engine.destroy())
  const setters = engine.setters
  const facade = setters.getSettersMap()
  const shadowMap = new Map([['ShadowOnly', Object.freeze({ component() {}, type: 'ShadowOnly' })]])

  assert.equal(Reflect.ownKeys(setters).includes('registeredSetters'), false)
  Object.defineProperty(setters, 'registeredSetters', {
    configurable: true,
    value: shadowMap,
    writable: true,
  })

  const component = () => null
  setters.registerSetter('Actual', component)

  assert.strictEqual(setters.getSetter('Actual')?.component, component)
  assert.equal(setters.getSetter('ShadowOnly'), undefined)
  assert.equal(facade.has('Actual'), true)
  assert.equal(facade.has('ShadowOnly'), false)

  assert.equal(Reflect.defineProperty(setters, 'settersMap', { value: new Map() }), false)
  assert.equal(Reflect.defineProperty(setters, 'getSettersMap', { value: () => new Map() }), false)
  assert.strictEqual(setters.settersMap, facade)
  assert.strictEqual(setters.getSettersMap(), facade)
})

test('the stable setters map facade rejects mutation in every lifecycle generation', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(async () => engine.destroy())
  const facade = engine.setters.getSettersMap()

  await engine.init()
  engine.setters.registerSetter('ReadySetter', () => null)
  assertReadonlyMapMutation(
    () => facade.set('Injected', { component() {}, type: 'Injected' }),
    'ready generation set must be denied',
  )
  assertReadonlyMapMutation(() => facade.delete('ReadySetter'), 'ready generation delete must be denied')
  assertReadonlyMapMutation(() => facade.clear(), 'ready generation clear must be denied')
  assert.ok(engine.setters.getSetter('ReadySetter'))

  await engine.destroy()
  assert.strictEqual(engine.setters.getSettersMap(), facade)
  assertReadonlyMapMutation(
    () => facade.set('DisposedInjection', { component() {}, type: 'DisposedInjection' }),
    'disposed generation set must be denied by the map boundary itself',
  )

  await engine.init()
  assert.strictEqual(engine.setters.getSettersMap(), facade)
  engine.setters.registerSetter('RestartedSetter', () => null)
  assertReadonlyMapMutation(() => facade.delete('RestartedSetter'), 'restarted generation delete must be denied')
  assert.ok(engine.setters.getSetter('RestartedSetter'))
})

test('atomic batch rollback preserves frozen registrations and the stable facade', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(async () => engine.destroy())
  const existingComponent = () => null
  const validComponent = () => null
  const facade = engine.setters.getSettersMap()

  engine.setters.registerSetter('Existing', {
    component: existingComponent,
    defaultProps: { nested: { value: 'stable' } },
  })
  const existing = engine.setters.getSetter('Existing')

  assert.throws(
    () => engine.setters.registerSetter({ Valid: validComponent, Invalid: 1 }),
    /Setter Invalid must be a component or setter object/,
  )

  assert.strictEqual(engine.setters.getSettersMap(), facade)
  assert.strictEqual(engine.setters.getSetter('Existing'), existing)
  assert.strictEqual(existing.component, existingComponent)
  assert.ok(Object.isFrozen(existing))
  assert.ok(Object.isFrozen(existing.defaultProps.nested))
  assert.equal(engine.setters.getSetter('Valid'), undefined)
})
