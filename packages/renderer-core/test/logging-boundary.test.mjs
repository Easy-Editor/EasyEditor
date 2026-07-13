import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.location = { href: '?__logConf__=error:Renderer' }
const logs = []
const originalConsoleError = console.error
console.error = (...args) => logs.push(args)
const { createTrustedExpressionEvaluator, parseExpression } = await import('../.test-dist/index.js')
console.error = originalConsoleError

test('expression failures log bounded metadata without source or evaluation context', () => {
  const source = 'this.privateToken + }'
  const self = { privateToken: 'do-not-log-this-context' }
  parseExpression({
    str: { type: 'JSExpression', value: source },
    self,
    evaluator: createTrustedExpressionEvaluator({ policyName: 'test-trusted' }),
  })

  assert.equal(logs.length, 1)
  const serialized = JSON.stringify(logs)
  assert.equal(serialized.includes(source), false)
  assert.equal(serialized.includes(self.privateToken), false)
  assert.deepEqual(logs[0].at(-1), {
    code: 'EXPRESSION_EVALUATION_FAILED',
    policy: 'test-trusted',
    kind: 'expression',
    sourceLength: source.length,
  })
})
