import { type ProjectSchema, isElement } from '@easy-editor/core'
import type { ComponentType } from 'react'

export type Component = ComponentType<any> | object

export const buildComponents = (
  libraryMap: Record<string, any>,
  componentsMap: { [componentName: string]: ComponentType<any> },
  createComponent?: (schema: ProjectSchema) => Component | null,
) => {
  const components: any = {}
  Object.keys(componentsMap).forEach(componentName => {
    const component = componentsMap[componentName]
    components[componentName] = component
  })
  // Object.keys(componentsMap).forEach((componentName) => {
  //   let component = componentsMap[componentName];
  //   if (component && (isLowcodeProjectSchema(component) || isComponentSchema(component))) {
  //     if (isComponentSchema(component)) {
  //       components[componentName] = createComponent({
  //         version: '',
  //         componentsMap: [],
  //         componentsTree: [component],
  //       });
  //     } else {
  //       components[componentName] = createComponent(component);
  //     }
  //   } else if (isReactComponent(component)) {
  //     if (!acceptsRef(component)) {
  //       component = wrapReactClass(component as FunctionComponent);
  //     }
  //     components[componentName] = component;
  //   } else if (isMixinComponent(component)) {
  //     components[componentName] = component;
  //   } else {
  //     component = findComponent(libraryMap, componentName, component);
  //     if (component) {
  //       if (!acceptsRef(component) && isReactComponent(component)) {
  //         component = wrapReactClass(component as FunctionComponent);
  //       }
  //       components[componentName] = component;
  //     }
  //   }
  // });
  return components
}

// a range for test TextNode clientRect
const cycleRange = document.createRange()

export function getClientRects(node: Element | Text) {
  if (isElement(node)) {
    return [node.getBoundingClientRect()]
  }

  cycleRange.selectNode(node)
  return Array.from(cycleRange.getClientRects())
}

/**
 * Stringify object to query parammeters
 * @param  {Object} obj
 * @return {String}
 */
export function stringifyQuery(obj: any): string {
  const param: string[] = []
  Object.keys(obj).forEach(key => {
    let value = obj[key]
    if (value && typeof value === 'object') {
      value = JSON.stringify(value)
    }
    param.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  })
  return param.join('&')
}

export function withQueryParams(url: string, params?: object) {
  const queryStr = params ? stringifyQuery(params) : ''
  if (queryStr === '') {
    return url
  }
  const urlSplit = url.split('#')
  const hash = urlSplit[1] ? `#${urlSplit[1]}` : ''
  const urlWithoutHash = urlSplit[0]
  return `${urlWithoutHash}${~urlWithoutHash.indexOf('?') ? '&' : '?'}${queryStr}${hash}`
}
