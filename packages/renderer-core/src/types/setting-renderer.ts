import type { Component, Editor, Setters, SettingField } from '@easy-editor/core'

export interface SettingRendererProps {
  editor: Editor

  setters: Setters

  /** 自定义渲染 Field Item */
  customFieldItem?: (field: SettingField, setter: Component) => Component

  /** 自定义渲染 Field Group */
  customFieldGroup?: (field: SettingField, setters: Component) => Component

  [extra: string]: any
}
