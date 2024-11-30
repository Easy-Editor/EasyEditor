import type {
  ComponentMeta,
  ComponentMetaManager,
  Designer,
  Detecting,
  Document,
  Dragon,
  DropLocation,
  History,
  Node,
  NodeChildren,
  Project,
  Prop,
  Props,
  Selection,
  SetterManager,
  Simulator,
  Viewport,
} from '..'

export interface PluginExtend {
  Simulator: typeof Simulator
  Viewport: typeof Viewport

  Designer: typeof Designer
  Dragon: typeof Dragon
  Detecting: typeof Detecting
  Selection: typeof Selection
  DropLocation: typeof DropLocation
  // Sensor: typeof Sensor

  Project: typeof Project
  Document: typeof Document
  History: typeof History
  Node: typeof Node
  NodeChildren: typeof NodeChildren
  Props: typeof Props
  Prop: typeof Prop

  ComponentMetaManager: typeof ComponentMetaManager
  SetterManager: typeof SetterManager
  ComponentMeta: typeof ComponentMeta
}
