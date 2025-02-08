import { type NodeSchema, isJSExpression } from '@easy-editor/core'
// import { default as factoryWithTypeCheckers } from 'prop-types/factoryWithTypeCheckers'
// import { default as ReactPropTypesSecret } from 'prop-types/lib/ReactPropTypesSecret'
import { Component, type ComponentClass, type ComponentType } from 'react'
import { logger } from './logger'

// const PropTypes2 = factoryWithTypeCheckers(ReactIs.isElement, true)
const PropTypes2 = true

export function inSameDomain() {
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
export function getFileCssName(fileName: string) {
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

export function transformArrayToMap(arr: any[], key: string, overwrite = true) {
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

interface IParseOptions {
  thisRequiredInJSE?: boolean
  logScope?: string
}

export const parseData = (schema: unknown, self: any, options: IParseOptions = {}): any => {
  if (isJSExpression(schema)) {
    return parseExpression({
      str: schema,
      self,
      thisRequired: options.thisRequiredInJSE,
      logScope: options.logScope,
    })
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

export function checkPropTypes(value: any, name: string, rule: any, componentName: string): boolean {
  let ruleFunction = rule
  if (typeof rule === 'string') {
    ruleFunction = new Function(`"use strict"; const PropTypes = arguments[0]; return ${rule}`)(PropTypes2)
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
export function transformStringToFunction(str: string) {
  if (typeof str !== 'string') {
    return str
  }
  if (inSameDomain() && (window.parent as any).__newFunc) {
    return (window.parent as any).__newFunc(`"use strict"; return ${str}`)()
  } else {
    return new Function(`"use strict"; return ${str}`)()
  }
}

/**
 * 对象类型JSExpression，支持省略this
 * @param str expression in string form
 * @param self scope object
 * @returns funtion
 */
function parseExpression(options: {
  str: any
  self: any
  thisRequired?: boolean
  logScope?: string
}): any
function parseExpression(str: any, self: any, thisRequired?: boolean): any
function parseExpression(a: any, b?: any, c = false) {
  let str
  let self
  let thisRequired
  let logScope
  if (typeof a === 'object' && b === undefined) {
    str = a.str
    self = a.self
    thisRequired = a.thisRequired
    logScope = a.logScope
  } else {
    str = a
    self = b
    thisRequired = c
  }
  try {
    const contextArr = ['"use strict";', 'var __self = arguments[0];']
    contextArr.push('return ')
    let tarStr: string

    tarStr = (str.value || '').trim()

    // NOTE: use __self replace 'this' in the original function str
    // may be wrong in extreme case which contains '__self' already
    tarStr = tarStr.replace(/this(\W|$)/g, (_a: any, b: any) => `__self${b}`)
    tarStr = contextArr.join('\n') + tarStr

    // 默认调用顶层窗口的parseObj, 保障new Function的window对象是顶层的window对象
    if (inSameDomain() && (window.parent as any).__newFunc) {
      return (window.parent as any).__newFunc(tarStr)(self)
    }
    const code = `with(${thisRequired ? '{}' : '$scope || {}'}) { ${tarStr} }`
    return new Function('$scope', code)(self)
  } catch (err) {
    logger.error(`${logScope || ''} parseExpression.error`, err, str, self?.__self ?? self)
    return undefined
  }
}

export { parseExpression }

export function parseThisRequiredExpression(str: any, self: any) {
  return parseExpression(str, self, true)
}

/**
 * check str passed in is a string type of not
 * @param str obj to be checked
 * @returns boolean
 */
export function isString(str: any): boolean {
  return {}.toString.call(str) === '[object String]'
}

/**
 * capitalize first letter
 * @param word string to be proccessed
 * @returns string capitalized string
 */
export function capitalizeFirstLetter(word: string) {
  if (!word || !isString(word) || word.length === 0) {
    return word
  }
  return word[0].toUpperCase() + word.slice(1)
}

export const isReactClass = (obj: any): obj is ComponentClass<any> => {
  return obj && obj.prototype && (obj.prototype.isReactComponent || obj.prototype instanceof Component)
}

export function isReactComponent(obj: any): obj is ComponentType<any> {
  return obj && (isReactClass(obj) || typeof obj === 'function')
}
