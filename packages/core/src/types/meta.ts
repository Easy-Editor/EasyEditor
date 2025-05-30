import type { SettingField } from '../designer'
import type { Node, PropKey } from '../document'
import type { ComponentType } from './component'
import type { NodeSchema } from './schema'
import type { DynamicSetter, SetterType } from './setter'

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
  name?: PropKey

  /**
   * the field key, for group items
   */
  key?: string

  /**
   * the field title, for configure tooltip
   */
  title?: string

  /**
   * the field body contains when .type = 'field'
   */
  setter?: SetterType | DynamicSetter

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
   * default collapsed
   */
  defaultCollapsed?: boolean

  /**
   * get value for field
   */
  getValue?: (target: SettingField, fieldValue: any) => any

  /**
   * set value for field
   */
  setValue?: (target: SettingField, value: any, oldValue?: any) => void

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

  onChange?: (target: SettingField, value: any) => void
}

export interface ComponentConfigure {
  /**
   * 是否容器组件
   */
  isContainer?: boolean

  /**
   * 组件树描述信息
   */
  descriptor?: string

  /**
   * 禁用的行为，可以为 `'copy'`, `'move'`, `'remove'` 或它们组成的数组
   */
  disableBehaviors?: string[] | string

  /**
   * 是否是最小渲染单元
   * 最小渲染单元下的组件渲染和更新都从单元的根节点开始渲染和更新。如果嵌套了多层最小渲染单元，渲染会从最外层的最小渲染单元开始渲染。
   */
  isMinimalRenderUnit?: boolean
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

  /**
   * 物料组件
   */
  view?: ComponentType<any>
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
