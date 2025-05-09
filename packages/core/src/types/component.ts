// export type ComponentInstance = Element
export type ComponentInstance = any

// export type ComponentType<T> = React.ComponentType<T>
export type ComponentType<T = any> = any

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
