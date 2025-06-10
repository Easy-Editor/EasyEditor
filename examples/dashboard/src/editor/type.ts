declare module '@easy-editor/core' {
  interface JSFunction {
    /**
     * 标识（TODO）
     */
    key?: string

    /**
     * 方法名称（TODO）
     */
    name?: string

    /**
     * 方法描述
     */
    description?: string
  }

  interface JSExpression {
    /**
     * 标识（TODO）
     */
    key?: string

    /**
     * 状态名称（TODO）
     */
    name?: string

    /**
     * 状态描述
     */
    description?: string
  }

  interface FieldExtraProps {
    /**
     * 是否显示 label
     * @default true
     */
    label?: boolean

    /**
     * 是否换行
     * @default false
     */
    wrap?: boolean

    /**
     * 是否支持变量绑定
     * @default false
     */
    supportVariable?: boolean
  }
}
