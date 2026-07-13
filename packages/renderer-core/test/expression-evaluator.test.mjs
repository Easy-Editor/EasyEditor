import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ExpressionEvaluationError,
  PolicyViolation,
  createDenyExpressionEvaluator,
  createTrustedExpressionEvaluator,
  evaluateExpression,
} from '../dist/expression-evaluator.js'

test('trusted evaluator preserves scoped renderer expression semantics', () => {
  const evaluator = createTrustedExpressionEvaluator()

  assert.equal(
    evaluateExpression(evaluator, {
      source: 'count + this.offset',
      kind: 'expression',
      scope: { count: 2 },
      thisValue: { offset: 3 },
      allowScopeAccess: true,
    }),
    5,
  )
})

test('trusted evaluator preserves string-to-function semantics', () => {
  const evaluator = createTrustedExpressionEvaluator()
  const handler = evaluateExpression(evaluator, {
    source: '(value) => value * 2',
    kind: 'function',
  })

  assert.equal(handler(4), 8)
})

test('deny evaluator rejects before user code can execute', () => {
  const evaluator = createDenyExpressionEvaluator('renderer expressions are disabled')
  globalThis.__easyEditorExpressionExecuted = false

  assert.throws(
    () =>
      evaluateExpression(evaluator, {
        source: 'globalThis.__easyEditorExpressionExecuted = true',
        kind: 'expression',
      }),
    error => error instanceof PolicyViolation && error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.equal(globalThis.__easyEditorExpressionExecuted, false)
  globalThis.__easyEditorExpressionExecuted = undefined
})

test('missing evaluator and runtime failures are structured errors', () => {
  assert.throws(
    () => evaluateExpression(undefined, { source: '1 + 1', kind: 'expression' }),
    error => error instanceof PolicyViolation && error.reason === 'missing-evaluator',
  )

  const evaluator = createTrustedExpressionEvaluator()
  const source = 'not valid javascript }'
  assert.throws(
    () => evaluateExpression(evaluator, { source, kind: 'expression' }),
    error => {
      assert.ok(error instanceof ExpressionEvaluationError)
      assert.equal(error.code, 'EXPRESSION_EVALUATION_FAILED')
      assert.deepEqual(error.details, {
        kind: 'expression',
        sourceLength: source.length,
        allowScopeAccess: false,
      })
      assert.equal('request' in error, false)
      assert.equal(Object.keys(error).includes('cause'), false)
      return true
    },
  )
})
