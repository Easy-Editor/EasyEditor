import assert from 'node:assert/strict'
import { installLegacyBrowserGlobals } from './fake-browser.mjs'

const coreUrl = new URL('../../dist/index.js', import.meta.url)

export async function loadCore() {
  installLegacyBrowserGlobals()
  return import(coreUrl.href)
}

export function assertKernelApi(core) {
  assert.equal(typeof core.createEngine, 'function', 'core must export createEngine(options)')
  assert.ok(core.defaultEngine, 'core must export defaultEngine')
}

export async function captureFailure(action, message = 'expected operation to fail') {
  try {
    await action()
  } catch (error) {
    return error
  }
  assert.fail(message)
}

export function assertStructuredPolicyViolation(error, capabilityPattern) {
  assert.ok(error instanceof Error)
  assert.equal(error.name, 'PolicyViolation')
  assert.equal(typeof error.capability, 'string')
  assert.match(error.capability, capabilityPattern)
  assert.equal(typeof error.origin, 'string')
  assert.equal(typeof error.rule, 'string')
  assert.ok(error.message.length > 0)
}

export function coreBundleUrl() {
  return coreUrl
}
