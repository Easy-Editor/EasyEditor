import {
  type CompositeValue,
  type JSExpression,
  type JSFunction,
  type JSONObject,
  isJSExpression,
  isJSFunction,
} from '@easy-editor/core'
import type { IDataSourceRuntimeContext, InterpretDataSourceConfig, RuntimeOptionsConfig } from './types'

function isObject(obj: unknown) {
  return Object.prototype.toString.call(obj).indexOf('Object') !== -1
}

export const transformExpression = (code: string, context: IDataSourceRuntimeContext) => {
  // 补充异常情况兼容性
  if (code === undefined) {
    return () => {}
  }
  if (code === '') {
    return () => ''
  }
  try {
    return new Function(`return (${code})`).call(context)
  } catch (error) {
    console.error(`transformExpression error, code is ${code}, context is ${context}, error is ${error}`)
  }
}

export const transformFunction = (code: string, context: IDataSourceRuntimeContext) => {
  if (code === undefined) {
    return () => {}
  }
  if (code === '') {
    return () => ''
  }
  try {
    return new Function(`return (${code})`).call(context).bind(context)
  } catch (error) {
    console.error(`transformFunction error, code is ${code}, context is ${context}, error is ${error}`)
  }
}

export const transformBoolStr = (str: string) => {
  return str !== 'false'
}

export const getRuntimeJsValue = (value: JSExpression | JSFunction, context: IDataSourceRuntimeContext) => {
  if (!['JSExpression', 'JSFunction'].includes(value.type)) {
    console.error(`translate error, value is ${JSON.stringify(value)}`)
    return ''
  }
  // TODO: 类型修复
  const code = value.compiled || value.value
  return value.type === 'JSFunction' ? transformFunction(code, context) : transformExpression(code, context)
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

export const getRuntimeValueFromConfig = (type: string, value: CompositeValue, context: IDataSourceRuntimeContext) => {
  if (value === undefined) {
    return undefined
  }

  if (isJSExpression(value) || isJSFunction(value)) {
    return getRuntimeBaseValue(type, getRuntimeJsValue(value, context))
  }

  return value
}

export const buildJsonObj = (params: JSONObject | JSExpression, context: IDataSourceRuntimeContext) => {
  if (isJSExpression(params)) {
    return transformExpression(params.value, context)
  } else if (isObject(params)) {
    // 处理params内部为JSExpression的问题
    const newParams: Record<string, unknown> = {}
    for (const [name, param] of Object.entries(params)) {
      if (isJSExpression(param)) {
        newParams[name] = transformExpression(param?.value, context)
      } else if (isObject(param)) {
        newParams[name] = buildJsonObj(param as JSONObject, context)
      } else {
        newParams[name] = param
      }
    }
    return newParams
  }
  return params
}

export const buildShouldFetch = (ds: InterpretDataSourceConfig, context: IDataSourceRuntimeContext) => {
  if (!ds.options || !ds.shouldFetch) {
    return true // 默认为 true
  }
  if (isJSExpression(ds.shouldFetch) || isJSFunction(ds.shouldFetch)) {
    return getRuntimeJsValue(ds.shouldFetch, context)
  }

  return getRuntimeBaseValue('boolean', ds.shouldFetch)
}

export const buildOptions = (ds: InterpretDataSourceConfig, context: IDataSourceRuntimeContext) => {
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
          fetchOptions.uri = getRuntimeValueFromConfig('string', options.uri, context)
          break
        case 'params':
          fetchOptions.params = buildJsonObj(options.params!, context)
          break
        case 'method':
          fetchOptions.method = getRuntimeValueFromConfig('string', options.method, context)
          break
        case 'isCors':
          fetchOptions.isCors = getRuntimeValueFromConfig('boolean', options.isCors, context)
          break
        case 'timeout':
          fetchOptions.timeout = getRuntimeValueFromConfig('number', options.timeout, context)
          break
        case 'headers':
          fetchOptions.headers = buildJsonObj(options.headers!, context)
          break
        case 'v':
          fetchOptions.v = getRuntimeValueFromConfig('string', options.v, context)
          break
        default:
          // 其余的除了做表达式或者 function 的转换，直接透传
          fetchOptions[key] = getRuntimeValueFromConfig('unknown', options[key], context)
      }
    })
    return fetchOptions
  }
}
