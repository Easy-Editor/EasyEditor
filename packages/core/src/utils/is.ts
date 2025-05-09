import type { Viewport } from '../simulator/viewport'
import type { ComponentMap, LowCodeComponent, ProCodeComponent, SetterConfig } from '../types'

export const isObject = (value: any): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object'
}

export const isPlainObject = (value: any): value is any => {
  if (!isObject(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null || Object.getPrototypeOf(proto) === null
}

export const isTextNode = (node: any): node is Text => {
  return node.nodeType === Node.TEXT_NODE
}

export const isElementNode = (node: any): node is Element => {
  return node.nodeType === Node.ELEMENT_NODE
}

export const isDocumentNode = (node: any): node is Document => {
  return node.nodeType === Node.DOCUMENT_NODE
}

/**
 * 判断节点是否在 viewport 内，判断依据：只要节点有一部分在 viewport 内，都算 true，其余情况 false
 * @param domNode 待检测的节点
 * @param viewport 画布 viewport
 * @returns 是否在 viewport 内
 */
export function isDOMNodeVisible(domNode: Element, viewport: Viewport) {
  const domNodeRect = domNode.getBoundingClientRect()
  const { width, height } = viewport.contentBounds
  const { left, right, top, bottom, width: nodeWidth, height: nodeHeight } = domNodeRect
  return left >= -nodeWidth && top >= -nodeHeight && bottom <= height + nodeHeight && right <= width + nodeWidth
}

export const isProCodeComponentType = (desc: ComponentMap): desc is ProCodeComponent => {
  if (!isObject(desc)) {
    return false
  }
  return 'package' in desc
}

export const isLowCodeComponentType = (desc: ComponentMap): desc is LowCodeComponent => {
  return !isProCodeComponentType(desc)
}

export const isSetterConfig = (obj: any): obj is SetterConfig => {
  if (!isObject(obj)) {
    return false
  }
  return 'componentName' in obj
}

export const isPluginEventName = (eventName: string): boolean => {
  if (!eventName) {
    return false
  }

  const eventSegments = eventName.split(':')
  return eventSegments.length > 1 && eventSegments[0].length > 0
}
