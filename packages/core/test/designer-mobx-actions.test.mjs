import assert from 'node:assert/strict'
import test from 'node:test'
import { autorun } from 'mobx'
import { loadCore } from './helpers/kernel.mjs'

test('designer configuration mutations execute inside a MobX action', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const stopObserving = autorun(() => engine.designer.simulatorProps)
  t.after(async () => {
    stopObserving()
    await engine.destroy()
  })

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    engine.designer.setProps({ simulatorProps: { deviceStyle: { viewport: { width: 1920, height: 1080 } } } })
  } finally {
    console.warn = originalWarn
  }

  assert.equal(
    warnings.some(message => message.includes('changing (observed) observable values without using an action')),
    false,
  )
})
