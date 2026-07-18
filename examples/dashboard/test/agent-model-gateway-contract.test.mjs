import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GatewayError,
  MODEL_GATEWAY_MAX_BODY_BYTES,
  MODEL_GATEWAY_PATH,
  parseModelGatewayRequestBody,
} from '../server/gateway/contract.mjs'

function validBody(overrides = {}) {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'branch-1',
    sessionId: 'session-1',
    taskId: 'task-1',
    stepId: 'step-1',
    modelRequestId: 'request-1',
    providerId: 'provider-1',
    model: 'model-1',
    phase: 'PLAN_STEP',
    messages: [
      { role: 'system', content: 'Follow the plan.' },
      { role: 'user', content: 'Implement the next step.' },
      { role: 'assistant', content: 'Ready.' },
    ],
    maxOutputTokens: 8192,
    ...overrides,
  }
}

function expectGatewayError(body, expectedCode) {
  assert.throws(
    () => parseModelGatewayRequestBody(body),
    error => {
      assert.ok(error instanceof GatewayError)
      assert.equal(error.code, expectedCode)
      assert.equal(error.status, expectedCode === 'BODY_TOO_LARGE' ? 413 : 400)
      assert.equal(error.retryable, false)
      return true
    },
  )
}

test('exports the model gateway path and accepts the exact request contract', () => {
  assert.equal(MODEL_GATEWAY_PATH, '/api/agent/model/stream')

  const body = validBody()
  assert.equal(parseModelGatewayRequestBody(body), body)

  const { maxOutputTokens: _maxOutputTokens, ...withoutOptionalTokens } = validBody()
  assert.equal(parseModelGatewayRequestBody(withoutOptionalTokens), withoutOptionalTokens)
})

test('rejects unknown top-level and message fields', () => {
  expectGatewayError(validBody({ unexpected: true }), 'INVALID_FIELDS')
  expectGatewayError(validBody({ messages: [{ role: 'user', content: 'hello', name: 'unsafe' }] }), 'INVALID_MESSAGES')
})

test('rejects a body whose encoded JSON exceeds the byte limit', () => {
  const body = validBody({ messages: [{ role: 'user', content: 'x'.repeat(16_384) }] })
  body.padding = 'x'.repeat(MODEL_GATEWAY_MAX_BODY_BYTES)
  expectGatewayError(body, 'BODY_TOO_LARGE')
})

test('rejects invalid message roles', () => {
  expectGatewayError(validBody({ messages: [{ role: 'tool', content: 'not allowed' }] }), 'INVALID_MESSAGES')
})

test('rejects invalid phases', () => {
  expectGatewayError(validBody({ phase: 'EXECUTE' }), 'INVALID_PHASE')
})

test('rejects invalid maxOutputTokens values', () => {
  for (const maxOutputTokens of [0, 8193, 1.5, '1024', null]) {
    expectGatewayError(validBody({ maxOutputTokens }), 'INVALID_MAX_OUTPUT_TOKENS')
  }
})

test('never reflects offending values in errors', () => {
  const secret = 'DO_NOT_REFLECT_THIS_VALUE'
  let captured
  try {
    parseModelGatewayRequestBody(validBody({ phase: secret }))
  } catch (error) {
    captured = error
  }

  assert.ok(captured instanceof GatewayError)
  assert.equal(JSON.stringify(captured).includes(secret), false)
  assert.equal(captured.message.includes(secret), false)
  assert.equal(captured.stack.includes(secret), false)
})
