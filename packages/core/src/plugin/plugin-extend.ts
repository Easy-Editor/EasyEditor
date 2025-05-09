import type {
  ComponentMeta,
  Designer,
  Detecting,
  Document,
  Dragon,
  DropLocation,
  History,
  Materials,
  Node,
  NodeChildren,
  OffsetObserver,
  Project,
  Prop,
  Props,
  Selection,
  Setters,
  Simulator,
  Viewport,
} from '..'

export interface PluginExtend {
  extendClass: PluginExtendClass
  extend: <T extends keyof PluginExtendClass>(
    extendClass: T,
    properties: Record<PropertyKey, () => any> | (PropertyDescriptorMap & ThisType<InstanceType<PluginExtendClass[T]>>),
  ) => void
}

export interface PluginExtendClass {
  Simulator: typeof Simulator
  Viewport: typeof Viewport

  Designer: typeof Designer
  Dragon: typeof Dragon
  Detecting: typeof Detecting
  Selection: typeof Selection
  DropLocation: typeof DropLocation
  OffsetObserver: typeof OffsetObserver
  // Sensor: typeof Sensor

  Project: typeof Project
  Document: typeof Document
  History: typeof History
  Node: typeof Node
  NodeChildren: typeof NodeChildren
  Props: typeof Props
  Prop: typeof Prop

  Materials: typeof Materials
  Setters: typeof Setters
  ComponentMeta: typeof ComponentMeta
}

/**
 * 扩展类
 * @param extendMap 扩展类映射
 * @param extendClass 扩展类
 * @param properties 扩展属性
 */
export const extend = <T extends keyof PluginExtendClass>(
  extendMap: Record<T, PluginExtendClass[T]>,
  extendClass: T,
  properties: Record<PropertyKey, () => any> | (PropertyDescriptorMap & ThisType<InstanceType<PluginExtendClass[T]>>),
) => {
  const newProperties: PropertyDescriptorMap & ThisType<InstanceType<PluginExtendClass[T]>> = {}
  for (const key in properties) {
    if (typeof properties[key] === 'function') {
      newProperties[key] = {
        value: properties[key],
      }
    } else {
      newProperties[key] = properties[key]
    }
  }

  Object.defineProperties(extendMap[extendClass].prototype, newProperties)
}
