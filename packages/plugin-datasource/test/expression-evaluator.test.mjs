import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PolicyViolation,
  createDataSourceEngine,
  createDenyExpressionEvaluator,
  createTrustedExpressionEvaluator,
  evaluateExpression,
} from '../.test-dist/index.js'

const context = {
  state: { token: 'abc' },
  setState() {},
}

test('trusted evaluator preserves datasource expression and function semantics', () => {
  const evaluator = createTrustedExpressionEvaluator()

  assert.equal(
    evaluateExpression(evaluator, {
      source: 'this.state.token',
      kind: 'expression',
      thisValue: context,
    }),
    'abc',
  )

  const handler = evaluateExpression(evaluator, {
    source: 'function (suffix) { return this.state.token + suffix }',
    kind: 'function',
    thisValue: context,
  }).bind(context)
  assert.equal(handler('-123'), 'abc-123')
})

test('deny evaluator rejects before datasource code can execute', () => {
  const evaluator = createDenyExpressionEvaluator('datasource expressions are disabled')
  globalThis.__easyEditorDatasourceExecuted = false

  assert.throws(
    () =>
      evaluateExpression(evaluator, {
        source: 'globalThis.__easyEditorDatasourceExecuted = true',
        kind: 'expression',
        thisValue: context,
      }),
    error => error instanceof PolicyViolation && error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.equal(globalThis.__easyEditorDatasourceExecuted, false)
  globalThis.__easyEditorDatasourceExecuted = undefined
})

test('missing datasource evaluator is a structured policy violation', () => {
  assert.throws(
    () => evaluateExpression(undefined, { source: '1 + 1', kind: 'expression' }),
    error => error instanceof PolicyViolation && error.reason === 'missing-evaluator',
  )
})

test('structurally compatible external evaluators preserve policy violations', () => {
  const externalDenial = new Error('external policy denied')
  externalDenial.code = 'EXPRESSION_EVALUATION_DENIED'
  const evaluator = {
    policy: 'external-deny',
    evaluate() {
      throw externalDenial
    },
  }

  assert.throws(
    () => evaluateExpression(evaluator, { source: '1 + 1', kind: 'expression' }),
    error => error === externalDenial,
  )
})

test('datasource construction propagates deny policy before handlers execute', () => {
  globalThis.__easyEditorDatasourceIntegrationExecuted = false
  const source = 'globalThis.__easyEditorDatasourceIntegrationExecuted = true'

  assert.throws(
    () =>
      createDataSourceEngine(
        {
          list: [],
          dataHandler: { type: 'JSExpression', value: source },
        },
        context,
        { expressionEvaluator: createDenyExpressionEvaluator() },
      ),
    error => error instanceof PolicyViolation && error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.equal(globalThis.__easyEditorDatasourceIntegrationExecuted, false)
  globalThis.__easyEditorDatasourceIntegrationExecuted = undefined
})

test('an explicitly undefined plugin evaluator never falls back to legacy trusted execution', () => {
  assert.throws(
    () =>
      createDataSourceEngine(
        {
          list: [],
          dataHandler: { type: 'JSExpression', value: '40 + 2' },
        },
        context,
        { expressionEvaluator: undefined },
      ),
    error => error instanceof PolicyViolation && error.reason === 'missing-evaluator',
  )
})

test('datasource evaluation failure logs contain metadata but no source or context', () => {
  const source = 'this.state.superSecretToken + }'
  const logs = []
  const originalConsoleError = console.error
  console.error = (...args) => logs.push(args)
  try {
    createDataSourceEngine(
      {
        list: [],
        dataHandler: { type: 'JSExpression', value: source },
      },
      context,
      { expressionEvaluator: createTrustedExpressionEvaluator({ policyName: 'test-trusted' }) },
    )
  } finally {
    console.error = originalConsoleError
  }

  assert.deepEqual(logs, [
    [
      'transformExpression.error',
      {
        code: 'EXPRESSION_EVALUATION_FAILED',
        policy: 'test-trusted',
        kind: 'expression',
        sourceLength: source.length,
      },
    ],
  ])
  assert.equal(JSON.stringify(logs).includes('superSecretToken'), false)
  assert.equal(JSON.stringify(logs).includes(context.state.token), false)
})
