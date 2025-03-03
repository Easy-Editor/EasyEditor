import type { Editor, SetterManager, SettingField } from '@easy-editor/core'
import { type ReactNode, createContext, useContext } from 'react'

export interface SettingRendererContext {
  editor: Editor

  setterManager: SetterManager

  /** 自定义渲染 Field Item */
  customFieldItem?: (field: SettingField, setter: ReactNode) => ReactNode

  /** 自定义渲染 Field Item */
  customFieldGroup?: (field: SettingField, setters: ReactNode) => ReactNode

  [extra: string]: any
}

export const SettingRendererContext = createContext<SettingRendererContext>({} as SettingRendererContext)

export const useSettingRendererContext = () => {
  try {
    return useContext(SettingRendererContext)
  } catch (error) {
    console.warn('useSettingRendererContext must be used within a SettingRendererContextProvider')
  }
  return {} as SettingRendererContext
}
