import type { Setters, SettingsManager } from '@easy-editor/core'
import type { SettingRendererProps } from '@easy-editor/renderer-core'
import { createContext, useContext } from 'react'

export interface SettingRendererContext extends SettingRendererProps {
  setters: Setters
  settingsManager: SettingsManager
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
