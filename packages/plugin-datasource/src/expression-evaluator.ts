export type ExpressionEvaluationKind = 'expression' | 'function' | 'prop-type-rule'

export interface ExpressionEvaluationRequest {
  /** JavaScript source that is treated as a single expression. */
  source: string
  kind: ExpressionEvaluationKind
  /** Optional object exposed to unqualified identifier lookup. */
  scope?: unknown
  /** Value used as `this` while evaluating the expression. */
  thisValue?: unknown
  /** Explicit lexical bindings required by compatibility adapters. */
  bindings?: Readonly<Record<string, unknown>>
  /** Enables legacy `with (scope)` identifier lookup. Trusted mode only. */
  allowScopeAccess?: boolean
}

export interface ExpressionEvaluator {
  readonly policy: string
  evaluate<T = unknown>(request: ExpressionEvaluationRequest): T
}

export type CompiledExpression = (this: unknown, ...args: unknown[]) => unknown
export type ExpressionFunctionFactory = (...args: string[]) => CompiledExpression

export interface TrustedExpressionEvaluatorOptions {
  functionFactory?: ExpressionFunctionFactory
  policyName?: string
}

export interface ExpressionEvaluationFailureDetails {
  kind: ExpressionEvaluationKind
  sourceLength: number
  allowScopeAccess: boolean
}

export class ExpressionEvaluationError extends Error {
  readonly code: string = 'EXPRESSION_EVALUATION_FAILED'
  readonly details: ExpressionEvaluationFailureDetails
  readonly cause: unknown

  constructor(message: string, request: ExpressionEvaluationRequest, cause?: unknown) {
    super(message)
    this.name = 'ExpressionEvaluationError'
    this.details = {
      kind: request.kind,
      sourceLength: request.source.length,
      allowScopeAccess: request.allowScopeAccess === true,
    }
    this.cause = cause
    Object.defineProperty(this, 'cause', {
      configurable: true,
      enumerable: false,
      value: cause,
    })
  }
}

export class PolicyViolation extends ExpressionEvaluationError {
  override readonly code = 'EXPRESSION_EVALUATION_DENIED'
  readonly reason: 'missing-evaluator' | 'policy-denied'
  readonly policy: string

  constructor(options: {
    message: string
    request: ExpressionEvaluationRequest
    reason: 'missing-evaluator' | 'policy-denied'
    policy: string
  }) {
    super(options.message, options.request)
    this.name = 'PolicyViolation'
    this.reason = options.reason
    this.policy = options.policy
  }
}

const hasEvaluationErrorCode = (error: unknown): error is { code: string } => {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
}

export const isExpressionEvaluationError = (error: unknown): error is ExpressionEvaluationError => {
  return (
    error instanceof ExpressionEvaluationError ||
    (error instanceof Error &&
      hasEvaluationErrorCode(error) &&
      ['EXPRESSION_EVALUATION_FAILED', 'EXPRESSION_EVALUATION_DENIED'].includes(error.code))
  )
}

export const isPolicyViolation = (error: unknown): error is PolicyViolation => {
  return error instanceof Error && hasEvaluationErrorCode(error) && error.code === 'EXPRESSION_EVALUATION_DENIED'
}

const assertBindingName = (name: string, request: ExpressionEvaluationRequest) => {
  if (!/^[A-Z_$][\w$]*$/i.test(name)) {
    throw new ExpressionEvaluationError(`Invalid expression binding name: ${name}`, request)
  }
}

const defaultFunctionFactory: ExpressionFunctionFactory = (...args) => new Function(...args) as CompiledExpression

export const createTrustedExpressionEvaluator = (
  options: TrustedExpressionEvaluatorOptions = {},
): ExpressionEvaluator => {
  const functionFactory = options.functionFactory ?? defaultFunctionFactory

  return Object.freeze({
    policy: options.policyName ?? 'legacy-trusted',
    evaluate<T>(request: ExpressionEvaluationRequest): T {
      try {
        const bindingEntries = Object.entries(request.bindings ?? {})
        bindingEntries.forEach(([name]) => assertBindingName(name, request))

        const parameters = ['$scope', ...bindingEntries.map(([name]) => name)]
        const body = request.allowScopeAccess
          ? `with ($scope || {}) { return (${request.source}); }`
          : `"use strict"; return (${request.source});`
        const expression = functionFactory(...parameters, body)

        return expression.call(request.thisValue, request.scope, ...bindingEntries.map(([, value]) => value)) as T
      } catch (error) {
        if (isExpressionEvaluationError(error)) {
          throw error
        }
        throw new ExpressionEvaluationError(
          `Failed to evaluate ${request.kind} with policy ${options.policyName ?? 'legacy-trusted'}`,
          request,
          error,
        )
      }
    },
  })
}

export const createDenyExpressionEvaluator = (
  message = 'Dynamic expression evaluation is disabled',
): ExpressionEvaluator => {
  return Object.freeze({
    policy: 'deny',
    evaluate<T>(request: ExpressionEvaluationRequest): T {
      throw new PolicyViolation({
        message,
        request,
        reason: 'policy-denied',
        policy: 'deny',
      })
    },
  })
}

/**
 * Explicit compatibility evaluator for hosts that intentionally trust schema code.
 * Restricted hosts should inject `createDenyExpressionEvaluator()` instead.
 */
export const legacyTrustedExpressionEvaluator = createTrustedExpressionEvaluator()

export const evaluateExpression = <T>(
  evaluator: ExpressionEvaluator | null | undefined,
  request: ExpressionEvaluationRequest,
): T => {
  if (!evaluator) {
    throw new PolicyViolation({
      message: 'An ExpressionEvaluator must be provided before evaluating datasource code',
      request,
      reason: 'missing-evaluator',
      policy: 'missing',
    })
  }

  try {
    return evaluator.evaluate<T>(request)
  } catch (error) {
    if (isExpressionEvaluationError(error)) {
      throw error
    }
    throw new ExpressionEvaluationError(`Expression evaluator ${evaluator.policy} failed`, request, error)
  }
}
