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
