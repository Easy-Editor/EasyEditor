import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DataHelper,
  PolicyViolation,
  checkPropTypes,
  createDenyExpressionEvaluator,
  legacyTrustedExpressionEvaluator,
  parseData,
  parseExpression,
  parseThisRequiredExpression,
  transformStringToFunction,
} from '../.test-dist/index.js'

const expression = value => ({ type: 'JSExpression', value })

const isMissingEvaluatorViolation = error =>
  error instanceof PolicyViolation && error.reason === 'missing-evaluator' && error.policy === 'missing'

test('modern renderer helpers fail closed when the host omits an evaluator', () => {
  globalThis.__easyEditorMissingPolicyExecuted = false
  const sideEffect = 'globalThis.__easyEditorMissingPolicyExecuted = true'

  assert.throws(() => parseExpression({ str: expression(sideEffect), self: {} }), isMissingEvaluatorViolation)
  assert.throws(() => parseThisRequiredExpression(expression(sideEffect), {}), isMissingEvaluatorViolation)
  assert.throws(() => parseData(expression(sideEffect), {}), isMissingEvaluatorViolation)
  assert.throws(() => transformStringToFunction('() => 42'), isMissingEvaluatorViolation)
  assert.throws(() => checkPropTypes(7, 'value', '() => null', 'TestComponent'), isMissingEvaluatorViolation)

  assert.equal(globalThis.__easyEditorMissingPolicyExecuted, false)
  globalThis.__easyEditorMissingPolicyExecuted = undefined
})

test('renderer compatibility remains available only through the named legacy evaluator', () => {
  assert.equal(
    parseExpression({
      str: expression('this.answer + 1'),
      self: { answer: 41 },
      evaluator: legacyTrustedExpressionEvaluator,
    }),
    42,
  )
  assert.equal(
    parseData(
      expression('this.answer + 1'),
      { answer: 41 },
      {
        expressionEvaluator: legacyTrustedExpressionEvaluator,
      },
    ),
    42,
  )
  assert.equal(
    parseThisRequiredExpression(expression('this.answer + 1'), { answer: 41 }, legacyTrustedExpressionEvaluator),
    42,
  )
  assert.equal(transformStringToFunction('value => value * 2', legacyTrustedExpressionEvaluator)(4), 8)
  assert.equal(checkPropTypes(7, 'value', '() => null', 'TestComponent', legacyTrustedExpressionEvaluator), true)
})

test('DataHelper fails closed when its host app helper omits an evaluator', () => {
  assert.throws(
    () => new DataHelper({}, { dataHandler: expression('data => data') }, {}, value => value),
    isMissingEvaluatorViolation,
  )
})

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
