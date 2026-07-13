import {
  type CompositeValue,
  type JSExpression,
  type JSFunction,
  type JSONObject,
  isJSExpression,
  isJSFunction,
} from '@easy-editor/core'
import {
  type ExpressionEvaluator,
  evaluateExpression,
  isPolicyViolation,
  legacyTrustedExpressionEvaluator,
} from './expression-evaluator'
import type { IDataSourceRuntimeContext, InterpretDataSourceConfig, RuntimeOptionsConfig } from './types'

function isObject(obj: unknown) {
  return Object.prototype.toString.call(obj).indexOf('Object') !== -1
}

const getEvaluationFailureDetails = (
  evaluator: ExpressionEvaluator | null | undefined,
  kind: 'expression' | 'function',
  sourceLength: number,
  error: unknown,
) => ({
  code:
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'EXPRESSION_EVALUATION_FAILED',
  policy: evaluator?.policy ?? 'missing',
  kind,
  sourceLength,
})

export function transformExpression(code: string, context: IDataSourceRuntimeContext): any
export function transformExpression(
  code: string,
  context: IDataSourceRuntimeContext,
  evaluator: ExpressionEvaluator | undefined,
): any
export function transformExpression(
  code: string,
  context: IDataSourceRuntimeContext,
  ...evaluatorArgs: [] | [ExpressionEvaluator | undefined]
) {
  // 补充异常情况兼容性
  if (code === undefined) {
    return () => {}
  }
  if (code === '') {
    return () => ''
  }
  const selectedEvaluator = evaluatorArgs.length === 0 ? legacyTrustedExpressionEvaluator : evaluatorArgs[0]
  try {
    return evaluateExpression(selectedEvaluator, {
      source: code,
      kind: 'expression',
      thisValue: context,
    })
  } catch (error) {
    if (isPolicyViolation(error)) {
      throw error
    }
    console.error(
      'transformExpression.error',
      getEvaluationFailureDetails(selectedEvaluator, 'expression', code.length, error),
    )
  }
}

export function transformFunction(code: string, context: IDataSourceRuntimeContext): any
export function transformFunction(
  code: string,
  context: IDataSourceRuntimeContext,
  evaluator: ExpressionEvaluator | undefined,
): any
export function transformFunction(
  code: string,
  context: IDataSourceRuntimeContext,
  ...evaluatorArgs: [] | [ExpressionEvaluator | undefined]
) {
  if (code === undefined) {
    return () => {}
  }
  if (code === '') {
    return () => ''
  }
  const selectedEvaluator = evaluatorArgs.length === 0 ? legacyTrustedExpressionEvaluator : evaluatorArgs[0]
  try {
    const result = evaluateExpression<unknown>(selectedEvaluator, {
      source: code,
      kind: 'function',
      thisValue: context,
    })
    return typeof result === 'function' ? result.bind(context) : result
  } catch (error) {
    if (isPolicyViolation(error)) {
      throw error
    }
    console.error(
      'transformFunction.error',
      getEvaluationFailureDetails(selectedEvaluator, 'function', code.length, error),
    )
  }
}

export const transformBoolStr = (str: string) => {
  return str !== 'false'
}

export const getRuntimeJsValue = (
  value: JSExpression | JSFunction,
  context: IDataSourceRuntimeContext,
  evaluator: ExpressionEvaluator | undefined,
) => {
  if (!['JSExpression', 'JSFunction'].includes(value.type)) {
    console.error('getRuntimeJsValue received an unsupported executable value type', {
      type: value.type,
    })
    return ''
  }
  // TODO: 类型修复
  const code = value.compiled || value.value
  return value.type === 'JSFunction'
    ? transformFunction(code, context, evaluator)
    : transformExpression(code, context, evaluator)
}

export const getRuntimeBaseValue = (type: string, value: any) => {
  switch (type) {
    case 'string':
      return `${value}`
    case 'boolean':
      return typeof value === 'string' ? transformBoolStr(value as string) : !!value
    case 'number':
      return Number(value)
    default:
      return value
  }
}

export const getRuntimeValueFromConfig = (
  type: string,
  value: CompositeValue,
  context: IDataSourceRuntimeContext,
  evaluator: ExpressionEvaluator | undefined,
) => {
  if (value === undefined) {
    return undefined
  }

  if (isJSExpression(value) || isJSFunction(value)) {
    return getRuntimeBaseValue(type, getRuntimeJsValue(value, context, evaluator))
  }

  return value
}

export const buildJsonObj = (
  params: JSONObject | JSExpression,
  context: IDataSourceRuntimeContext,
  evaluator: ExpressionEvaluator | undefined,
) => {
  if (isJSExpression(params)) {
    return transformExpression(params.value, context, evaluator)
  } else if (isObject(params)) {
    // 处理params内部为JSExpression的问题
    const newParams: Record<string, unknown> = {}
    for (const [name, param] of Object.entries(params)) {
      if (isJSExpression(param)) {
        newParams[name] = transformExpression(param?.value, context, evaluator)
      } else if (isObject(param)) {
        newParams[name] = buildJsonObj(param as JSONObject, context, evaluator)
      } else {
        newParams[name] = param
      }
    }
    return newParams
  }
  return params
}

export const buildShouldFetch = (
  ds: InterpretDataSourceConfig,
  context: IDataSourceRuntimeContext,
  evaluator: ExpressionEvaluator | undefined,
) => {
  if (!ds.options || !ds.shouldFetch) {
    return true // 默认为 true
  }
  if (isJSExpression(ds.shouldFetch) || isJSFunction(ds.shouldFetch)) {
    return getRuntimeJsValue(ds.shouldFetch, context, evaluator)
  }

  return getRuntimeBaseValue('boolean', ds.shouldFetch)
}

export const buildOptions = (
  ds: InterpretDataSourceConfig,
  context: IDataSourceRuntimeContext,
  evaluator: ExpressionEvaluator | undefined,
) => {
  const { options } = ds
  if (!options) return undefined
  // eslint-disable-next-line space-before-function-paren
  return () => {
    // 默认值
    const fetchOptions: RuntimeOptionsConfig = {
      uri: '',
      params: {},
      method: 'GET',
      isCors: true,
      timeout: 5000,
      headers: undefined,
      v: '1.0',
    }
    Object.keys(options).forEach((key: string) => {
      switch (key) {
        case 'uri':
          fetchOptions.uri = getRuntimeValueFromConfig('string', options.uri, context, evaluator)
          break
        case 'params':
          fetchOptions.params = buildJsonObj(options.params!, context, evaluator)
          break
        case 'method':
          fetchOptions.method = getRuntimeValueFromConfig('string', options.method, context, evaluator)
          break
        case 'isCors':
          fetchOptions.isCors = getRuntimeValueFromConfig('boolean', options.isCors, context, evaluator)
          break
        case 'timeout':
          fetchOptions.timeout = getRuntimeValueFromConfig('number', options.timeout, context, evaluator)
          break
        case 'headers':
          fetchOptions.headers = buildJsonObj(options.headers!, context, evaluator)
          break
        case 'v':
          fetchOptions.v = getRuntimeValueFromConfig('string', options.v, context, evaluator)
          break
        default:
          // 其余的除了做表达式或者 function 的转换，直接透传
          fetchOptions[key] = getRuntimeValueFromConfig('unknown', options[key], context, evaluator)
      }
    })
    return fetchOptions
  }
}
