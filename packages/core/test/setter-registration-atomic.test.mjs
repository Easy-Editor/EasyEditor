import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

test('batch setter registration rolls back every entry when a later setter is invalid', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  const existing = () => null
  const valid = () => null
  engine.setters.registerSetter('Existing', existing)
  const settersMap = engine.setters.getSettersMap()

  assert.throws(
    () => engine.setters.registerSetter({ Valid: valid, Invalid: 1 }),
    /Setter Invalid must be a component or setter object/,
  )
  assert.strictEqual(engine.setters.getSettersMap(), settersMap)
  assert.equal(engine.setters.getSetter('Valid'), undefined)
  assert.strictEqual(engine.setters.getSetter('Existing')?.component, existing)

  await engine.destroy()
})

test('batch setter registration rejects accessors without invoking them', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  let invoked = false
  const setterMap = Object.defineProperty({}, 'Hidden', {
    enumerable: true,
    get() {
      invoked = true
      return () => null
    },
  })

  assert.throws(() => engine.setters.registerSetter(setterMap), /must be a data property/)
  assert.equal(invoked, false)
  assert.equal(engine.setters.getSetter('Hidden'), undefined)

  await engine.destroy()
})
