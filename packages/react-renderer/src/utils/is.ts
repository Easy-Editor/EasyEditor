import { Component, type ComponentClass, type ComponentType } from 'react'

export const isReactClass = (obj: any): obj is ComponentClass<any> => {
  return obj && obj.prototype && (obj.prototype.isReactComponent || obj.prototype instanceof Component)
}

export const isReactComponent = (obj: any): obj is ComponentType<any> => {
  return obj && (isReactClass(obj) || typeof obj === 'function')
}
