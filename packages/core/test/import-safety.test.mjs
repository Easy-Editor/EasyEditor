import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { coreBundleUrl, instanceBundleUrl } from './helpers/kernel.mjs'

test('the core bundle is importable in a headless Node process', () => {
  const script = `await import(${JSON.stringify(coreBundleUrl().href)})`
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
  })

  assert.equal(
    result.status,
    0,
    `headless import must not read window, document, location, or navigator at module evaluation time\n${result.stderr}`,
  )
})

test('the instance entry is isolated from the legacy facade and version banner', () => {
  const script = `
    import EventEmitter from 'events'

    let editorConstructionSignals = 0
    const originalSetMaxListeners = EventEmitter.prototype.setMaxListeners
    EventEmitter.prototype.setMaxListeners = function (...args) {
      editorConstructionSignals += 1
      return Reflect.apply(originalSetMaxListeners, this, args)
    }

    const instance = await import(${JSON.stringify(instanceBundleUrl().href)})
    if (editorConstructionSignals !== 0) {
      throw new Error('importing @easy-editor/core/instance constructed the legacy default engine')
    }
    if ('defaultEngine' in instance) {
      throw new Error('the instance entry exposed the legacy default engine')
    }
    if ('EngineInstance' in instance || typeof instance.createEngine !== 'function') {
      throw new Error('the instance entry must expose only the factory construction path')
    }
    for (const runtimeExport of [
      'CURRENT_PROJECT_SCHEMA_VERSION',
      'DEFAULT_TIMEOUT',
      'DESIGNER_EVENT',
      'MaterialSource',
      'RemoteLoadError',
      'TRANSFORM_STAGE',
      'createEventBus',
      'insertChildren',
      'validateProjectSchema',
    ]) {
      if (!(runtimeExport in instance)) {
        throw new Error('the instance entry is missing runtime export ' + runtimeExport)
      }
    }
    process.stdout.write('INSTANCE_ENTRY_IMPORTED')
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'INSTANCE_ENTRY_IMPORTED', 'the isolated entry must not print the legacy version banner')

  const requireScript = `
    const EventEmitter = require('events')

    let editorConstructionSignals = 0
    const originalSetMaxListeners = EventEmitter.prototype.setMaxListeners
    EventEmitter.prototype.setMaxListeners = function (...args) {
      editorConstructionSignals += 1
      return Reflect.apply(originalSetMaxListeners, this, args)
    }

    const instance = require(${JSON.stringify(fileURLToPath(instanceBundleUrl()).replace(/\.js$/, '.cjs'))})
    if (editorConstructionSignals !== 0 || 'defaultEngine' in instance) {
      throw new Error('requiring @easy-editor/core/instance loaded the legacy default engine')
    }
    if ('EngineInstance' in instance || typeof instance.createEngine !== 'function') {
      throw new Error('the CommonJS instance entry must expose only the factory construction path')
    }
    for (const runtimeExport of [
      'CURRENT_PROJECT_SCHEMA_VERSION',
      'DEFAULT_TIMEOUT',
      'DESIGNER_EVENT',
      'MaterialSource',
      'RemoteLoadError',
      'TRANSFORM_STAGE',
      'createEventBus',
      'insertChildren',
      'validateProjectSchema',
    ]) {
      if (!(runtimeExport in instance)) {
        throw new Error('the CommonJS instance entry is missing runtime export ' + runtimeExport)
      }
    }
    process.stdout.write('INSTANCE_ENTRY_REQUIRED')
  `
  const requireResult = spawnSync(process.execPath, ['--eval', requireScript], { encoding: 'utf8' })

  assert.equal(requireResult.status, 0, requireResult.stderr)
  assert.equal(
    requireResult.stdout,
    'INSTANCE_ENTRY_REQUIRED',
    'the CommonJS isolated entry must not print the legacy version banner',
  )

  const bundle = readFileSync(fileURLToPath(instanceBundleUrl()), 'utf8')
  assert.doesNotMatch(bundle, /defaultEngine|EasyEditor %c v/, 'the isolated bundle must not include the legacy facade')
})
