import assert from 'node:assert/strict'
import test from 'node:test'

import { MODEL_GATEWAY_DEFAULT_TIMEOUT_MS, OPENAI_PROVIDER_DEFAULT_TIMEOUT_MS } from '../server/gateway/index.mjs'
import { GATEWAY_MODEL_DEFAULT_DEADLINE_MS } from '../src/agent-runtime/gateway-model-adapter.mjs'

test('layers the provider, Gateway, and browser deadlines from inner to outer', () => {
  assert.equal(OPENAI_PROVIDER_DEFAULT_TIMEOUT_MS, 150_000)
  assert.equal(MODEL_GATEWAY_DEFAULT_TIMEOUT_MS, 165_000)
  assert.equal(GATEWAY_MODEL_DEFAULT_DEADLINE_MS, 180_000)
  assert.ok(OPENAI_PROVIDER_DEFAULT_TIMEOUT_MS < MODEL_GATEWAY_DEFAULT_TIMEOUT_MS)
  assert.ok(MODEL_GATEWAY_DEFAULT_TIMEOUT_MS < GATEWAY_MODEL_DEFAULT_DEADLINE_MS)
})
