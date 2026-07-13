import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PolicyViolation,
  checkPropTypes,
  createDenyExpressionEvaluator,
  parseData,
  parseExpression,
} from '../.test-dist/index.js'

const expression = value => ({ type: 'JSExpression', value })

test('parseData propagates a deny policy before schema code executes', () => {
  globalThis.__easyEditorParseDataExecuted = false
  const source = 'globalThis.__easyEditorParseDataExecuted = true'

  assert.throws(
    () =>
      parseData(
        expression(source),
        {},
        {
          expressionEvaluator: createDenyExpressionEvaluator('parseData disabled'),
        },
      ),
    error => error instanceof PolicyViolation && error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.equal(globalThis.__easyEditorParseDataExecuted, false)
  globalThis.__easyEditorParseDataExecuted = undefined
})

test('parseExpression treats an explicitly undefined evaluator as missing', () => {
  assert.throws(
    () =>
      parseExpression({
        str: expression('40 + 2'),
        self: {},
        evaluator: undefined,
      }),
    error => error instanceof PolicyViolation && error.reason === 'missing-evaluator',
  )
})

test('prop-type evaluation propagates a deny policy instead of accepting the value', () => {
  globalThis.__easyEditorPropTypeExecuted = false
  const source = 'props => { globalThis.__easyEditorPropTypeExecuted = true; return null }'

  assert.throws(
    () => checkPropTypes(7, 'value', source, 'TestComponent', createDenyExpressionEvaluator()),
    error => error instanceof PolicyViolation && error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.equal(globalThis.__easyEditorPropTypeExecuted, false)
  globalThis.__easyEditorPropTypeExecuted = undefined
})
