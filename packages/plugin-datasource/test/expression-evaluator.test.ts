import {
  type ExpressionEvaluator,
  createDenyExpressionEvaluator,
  createTrustedExpressionEvaluator,
  evaluateExpression,
} from '../src/expression-evaluator.js'

const trusted: ExpressionEvaluator = createTrustedExpressionEvaluator()
const denied: ExpressionEvaluator = createDenyExpressionEvaluator()
evaluateExpression<number>(trusted, { source: '1 + 1', kind: 'expression' })
evaluateExpression<number>(denied, { source: '1 + 1', kind: 'expression' })
