import type { Node, NodeSchema, Prop } from '../document'
import { isObject } from '../document'

export interface ComponentMetadata {
  componentName: string
  title?: string
  icon?: string
  tags?: string[]
  description?: string

  /**
   * component screenshot, for left panel to display component screenshot
   */
  screenshot?: string

  /**
   * component dev mode
   */
  devMode?: 'proCode' | 'lowCode'

  /**
   * component configure, for right panel to use setter to config component
   */
  configure?: Configure

  /**
   * available snippets, one snippet is a schema(a component)
   */
  snippets?: Snippet[]

  /**
   * first level group
   */
  group?: string

  /**
   * second level group
   */
  category?: string

  /**
   * component priority for sorting
   */
  priority?: number

  [key: string]: any
}

export interface Snippet {
  /**
   * same as component title
   */
  title?: string

  /**
   * same as component screenshot
   */
  screenshot?: string

  /**
   * schema to be inserted
   */
  schema?: NodeSchema
}

export interface Configure {
  /**
   * configure component props
   */
  props?: FieldConfig[]

  /**
   * component behavior configure
   */
  component?: ComponentConfigure

  /**
   * 通用扩展面板支持性配置
   */
  supports?: ConfigureSupport

  /**
   * 高级特性配置
   */
  advanced?: Advanced
}

export type SettingField = Prop

export interface FieldConfig {
  /**
   * default is field, if is group, the items will be used
   */
  type?: 'field' | 'group'

  /**
   * the setting items which group body contains when .type = 'group'
   */
  items?: FieldConfig[]

  /**
   * the name of this setting field, the name can refer to the props of the component, such as `title` or `obj.a` ...
   */
  name?: string | number

  /**
   * the field title, for configure tooltip
   */
  title?: string

  /**
   * the field body contains when .type = 'field'
   */
  setter?: SetterType

  /**
   * extra props for field
   */
  extraProps?: FieldExtraProps
}

export interface FieldExtraProps {
  /**
   * is required
   */
  isRequired?: boolean

  /**
   * default value of target prop for setter use
   */
  defaultValue?: any

  /**
   * get value for field
   */
  getValue?: (target: SettingField, fieldValue: any) => any

  /**
   * set value for field
   */
  setValue?: (target: SettingField, value: any) => void

  /**
   * the field conditional show, is not set always true
   */
  condition?: (target: SettingField) => boolean

  /**
   * autorun when something change
   */
  autorun?: (target: SettingField) => void

  /**
   * support variable
   */
  supportVariable?: boolean

  onChange?: (value: any, field: any) => void
}

export interface ComponentConfigure {
  isContainer?: boolean

  descriptor?: string

  /**
   * disable some behaviors, such as `'copy'`, `'move'`, `'remove'` or array of them
   */
  disableBehaviors?: string[] | string
}

export interface ConfigureSupport {
  /**
   * supported events
   */
  events?: string[]

  /**
   * supported className
   */
  className?: boolean

  /**
   * supported style
   */
  style?: boolean

  /**
   * supported lifecycle
   */
  lifecycles?: any[]

  /**
   * supported loop component
   */
  loop?: boolean

  /**
   * supported condition render
   */
  condition?: boolean
}

export interface Advanced {
  /**
   * callbacks/hooks which can be used to do things on some special cations like onNodeAdd or onResize
   */
  callbacks?: Callbacks

  /**
   * auto add children when drag into container
   */
  initialChildren?: NodeSchema[] | ((target: Node) => NodeSchema[])
}

// TODO
export interface Callbacks {
  // hooks
  onMouseDownHook?: (e: MouseEvent, currentNode: Node | null) => any
  onDblClickHook?: (e: MouseEvent, currentNode: Node | null) => any
  onClickHook?: (e: MouseEvent, currentNode: Node | null) => any
  onMoveHook?: (currentNode: Node) => boolean

  // thinkof 限制性拖拽
  onHoverHook?: (currentNode: Node) => boolean

  /** 选中 hook，如果返回值是 false，可以控制组件不可被选中 */
  onSelectHook?: (currentNode: Node) => boolean
  onChildMoveHook?: (childNode: Node, currentNode: Node) => boolean

  // events
  onNodeRemove?: (removedNode: Node | null, currentNode: Node | null) => void
  onNodeAdd?: (addedNode: Node | null, currentNode: Node | null) => void
  onSubtreeModified?: (currentNode: Node, options: any) => void
  onResize?: (
    e: MouseEvent & {
      trigger: string
      deltaX?: number
      deltaY?: number
    },
    currentNode: any,
  ) => void
  onResizeStart?: (
    e: MouseEvent & {
      trigger: string
      deltaX?: number
      deltaY?: number
    },
    currentNode: any,
  ) => void
  onResizeEnd?: (
    e: MouseEvent & {
      trigger: string
      deltaX?: number
      deltaY?: number
    },
    currentNode: Node,
  ) => void
}

export type SetterType = SetterConfig | SetterConfig[] | string

export interface SetterConfig {
  /**
   * the name of the setter
   */
  componentName: string

  /**
   * the props pass to Setter Component
   */
  props?: Record<string, unknown> | ((target: SettingField) => Record<string, unknown>)

  /**
   * is required
   */
  isRequired?: boolean

  /**
   * Setter initial value
   */
  // initialValue?: any | ((target: SettingField) => any)

  /**
   * Setter default value
   */
  defaultValue?: any

  /**
   *  judge which one to be selected
   */
  // condition?: (target: SettingField) => boolean
}

export type ComponentInstance = Element

// export type ComponentType<T> = React.ComponentType<T>
export type ComponentType<T> = any

/**
 * component type
 */
export type Component = ComponentType<any> | object

export interface LowCodeComponent {
  /**
   * 研发模式
   */
  devMode: 'lowCode'
  /**
   * 组件名称
   */
  componentName: string
}

// export type ProCodeComponent = TypeNpmInfo;
export interface ProCodeComponent {
  /**
   * 研发模式
   */
  devMode: 'proCode'
  /**
   * 组件名称
   */
  componentName: string
}

export type ComponentMap = ProCodeComponent | LowCodeComponent

export type ComponentsMap = ComponentMap[]

export function isProCodeComponentType(desc: ComponentMap): desc is ProCodeComponent {
  if (!isObject(desc)) {
    return false
  }
  return 'package' in desc
}

export function isLowCodeComponentType(desc: ComponentMap): desc is LowCodeComponent {
  return !isProCodeComponentType(desc)
}
