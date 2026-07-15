import { type NodeSchema, isJSExpression } from '@easy-editor/core/instance'
import { forEach } from 'lodash-es'
import {
  type ExpressionEvaluationKind,
  type ExpressionEvaluator,
  evaluateExpression,
  isPolicyViolation,
} from '../expression-evaluator'
import { logger } from './logger'

const PropTypes2 = true

const getEvaluationFailureDetails = (
  evaluator: ExpressionEvaluator | null | undefined,
  kind: ExpressionEvaluationKind,
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

export const inSameDomain = () => {
  try {
    return window.parent !== window && window.parent.location.host === window.location.host
  } catch (e) {
    return false
  }
}

/**
 * get css styled name from schema`s fileName
 * FileName -> lce-file-name
 * @returns string
 */
export const getFileCssName = (fileName: string) => {
  if (!fileName) {
    return
  }
  const name = fileName.replace(/([A-Z])/g, '-$1').toLowerCase()
  return `lce-${name}`
    .split('-')
    .filter(p => !!p)
    .join('-')
}

export const isSchema = (schema: any): schema is NodeSchema => {
  if (!schema) {
    return false
  }
  // Leaf and Slot should be valid
  if (schema.componentName === 'Leaf' || schema.componentName === 'Slot') {
    return true
  }
  if (Array.isArray(schema)) {
    return schema.every(item => isSchema(item))
  }
  // check if props is valid
  const isValidProps = (props: any) => {
    if (!props) {
      return false
    }
    return typeof schema.props === 'object' && !Array.isArray(props)
  }
  return !!(schema.componentName && isValidProps(schema.props))
}

export const getValue = (obj: any, path: string, defaultValue = {}) => {
  // array is not valid type, return default value
  if (Array.isArray(obj)) {
    return defaultValue
  }

  if (!obj || typeof obj !== 'object') {
    return defaultValue
  }

  const res = path.split('.').reduce((pre, cur) => {
    return pre && pre[cur]
  }, obj)
  if (res === undefined) {
    return defaultValue
  }
  return res
}

export const transformArrayToMap = (arr: any[], key: string, overwrite = true) => {
  if (!arr || !Array.isArray(arr)) {
    return {}
  }
  const res: any = {}
  arr.forEach(item => {
    const curKey = item[key]
    if (item[key] === undefined) {
      return
    }
    if (res[curKey] && !overwrite) {
      return
    }
    res[curKey] = item
  })
  return res
}

export interface ParseDataOptions {
  logScope?: string
  /** Omission is fail-closed when executable schema is encountered. */
  expressionEvaluator?: ExpressionEvaluator
}

export const parseData = (schema: unknown, self: any, options: ParseDataOptions = {}): any => {
  if (isJSExpression(schema)) {
    const parseOptions: ParseExpressionOptions = {
      str: schema,
      self,
      thisRequired: true,
      logScope: options.logScope,
      evaluator: options.expressionEvaluator,
    }
    return parseExpression(parseOptions)
  }
  if (typeof schema === 'string') {
    return schema.trim()
  } else if (Array.isArray(schema)) {
    return schema.map(item => parseData(item, self, options))
  } else if (typeof schema === 'function') {
    return schema.bind(self)
  } else if (typeof schema === 'object') {
    // 对于undefined及null直接返回
    if (!schema) {
      return schema
    }
    const res: any = {}
    Object.entries(schema).forEach(([key, val]) => {
      if (key.startsWith('__')) {
        return
      }
      res[key] = parseData(val, self, options)
    })
    return res
  }
  return schema
}

export const isUseLoop = (loop: null | any[], isDesignMode: boolean): boolean => {
  if (!isDesignMode) {
    return true
  }

  if (!Array.isArray(loop)) {
    return false
  }

  return loop.length > 0
}

export function checkPropTypes(value: any, name: string, rule: any, componentName: string): boolean
export function checkPropTypes(
  value: any,
  name: string,
  rule: any,
  componentName: string,
  evaluator: ExpressionEvaluator | undefined,
): boolean
export function checkPropTypes(
  value: any,
  name: string,
  rule: any,
  componentName: string,
  ...evaluatorArgs: [] | [ExpressionEvaluator | undefined]
): boolean {
  const selectedEvaluator = evaluatorArgs[0]
  let ruleFunction = rule
  if (typeof rule === 'string') {
    try {
      ruleFunction = evaluateExpression(selectedEvaluator, {
        source: rule,
        kind: 'prop-type-rule',
        bindings: { PropTypes: PropTypes2 },
      })
    } catch (error) {
      if (isPolicyViolation(error)) {
        throw error
      }
      logger.warn(
        'checkPropTypes could not evaluate the string rule',
        getEvaluationFailureDetails(selectedEvaluator, 'prop-type-rule', rule.length, error),
      )
      return true
    }
  }
  if (!ruleFunction || typeof ruleFunction !== 'function') {
    logger.warn('checkPropTypes should have a function type rule argument')
    return true
  }
  const err = ruleFunction(
    {
      [name]: value,
    },
    name,
    componentName,
    'prop',
    null,
    // ReactPropTypesSecret,
  )
  if (err) {
    logger.warn(err)
  }
  return !err
}

/**
 * transform string to a function
 * @param str function in string form
 * @returns funtion
 */
export function transformStringToFunction(str: string): any
export function transformStringToFunction(str: string, evaluator: ExpressionEvaluator | undefined): any
export function transformStringToFunction(str: string, ...evaluatorArgs: [] | [ExpressionEvaluator | undefined]) {
  if (typeof str !== 'string') {
    return str
  }
  const selectedEvaluator = evaluatorArgs[0]
  return evaluateExpression(selectedEvaluator, {
    source: str,
    kind: 'function',
  })
}

/**
 * 对象类型JSExpression，支持省略this
 * @param str expression in string form
 * @param self scope object
 * @returns funtion
 */
export interface ParseExpressionOptions {
  str: any
  self: any
  thisRequired?: boolean
  logScope?: string
  /** Omission is treated as a missing host policy and raises `PolicyViolation`. */
  evaluator?: ExpressionEvaluator
}

function parseExpression(options: ParseExpressionOptions): any
function parseExpression(str: any, self: any, thisRequired?: boolean): any
function parseExpression(str: any, self: any, thisRequired: boolean, evaluator: ExpressionEvaluator | undefined): any
function parseExpression(a: any, b?: any, c = false, ...evaluatorArgs: [] | [ExpressionEvaluator | undefined]) {
  let str: any
  let self: any
  let thisRequired: boolean
  let evaluator: ExpressionEvaluator | undefined
  if (typeof a === 'object' && b === undefined) {
    str = a.str
    self = a.self
    thisRequired = a.thisRequired
    evaluator = a.evaluator
  } else {
    str = a
    self = b
    thisRequired = c
    evaluator = evaluatorArgs[0]
  }
  let sourceLength = 0
  try {
    const source = (str.value || '').trim()
    sourceLength = source.length
    return evaluateExpression(evaluator, {
      source,
      kind: 'expression',
      scope: thisRequired ? undefined : self,
      thisValue: self,
      allowScopeAccess: !thisRequired,
    })
  } catch (err) {
    if (isPolicyViolation(err)) {
      throw err
    }
    logger.error('parseExpression.error', getEvaluationFailureDetails(evaluator, 'expression', sourceLength, err))
    return undefined
  }
}

export { parseExpression }

export const parseThisRequiredExpression = (str: any, self: any, evaluator?: ExpressionEvaluator) => {
  return parseExpression(str, self, true, evaluator)
}

/**
 * check str passed in is a string type of not
 * @param str obj to be checked
 * @returns boolean
 */
export const isString = (str: any): boolean => {
  return {}.toString.call(str) === '[object String]'
}

/**
 * capitalize first letter
 * @param word string to be proccessed
 * @returns string capitalized string
 */
export const capitalizeFirstLetter = (word: string) => {
  if (!word || !isString(word) || word.length === 0) {
    return word
  }
  return word[0].toUpperCase() + word.slice(1)
}

/**
 * process params for using in a url query
 * @param obj params to be processed
 * @returns string
 */
export const serializeParams = (obj: any) => {
  const result: any = []
  forEach(obj, (val: any, key: any) => {
    if (val === null || val === undefined || val === '') {
      return
    }
    if (typeof val === 'object') {
      result.push(`${key}=${encodeURIComponent(JSON.stringify(val))}`)
    } else {
      result.push(`${key}=${encodeURIComponent(val)}`)
    }
  })
  return result.join('&')
}
