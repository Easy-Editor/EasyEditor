import type { Editor, SettingField } from '@easy-editor/core'
import { type ReactNode, createContext, use } from 'react'

export interface SettingRendererContext {
  editor: Editor

  /** 自定义渲染 Field Item */
  customFieldItem?: (field: SettingField, setter: ReactNode) => ReactNode

  /** 自定义渲染 Field Item */
  customFieldGroup?: (field: SettingField, setters: ReactNode) => ReactNode

  [extra: string]: any
}

export const SettingRendererContext = createContext<SettingRendererContext>({} as SettingRendererContext)

export const useSettingRendererContext = () => {
  try {
    return use(SettingRendererContext)
  } catch (error) {
    console.warn('useSettingRendererContext must be used within a SettingRendererContextProvider')
  }
  return {} as SettingRendererContext
}
