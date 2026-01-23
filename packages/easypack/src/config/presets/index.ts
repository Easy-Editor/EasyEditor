/**
 * Presets Export
 * 预设导出
 */

export { materialPreset } from './material'
export { setterPreset } from './setter'
export { libraryPreset } from './library'

import type { Preset, EasypackConfig } from '../types'
import { materialPreset } from './material'
import { setterPreset } from './setter'
import { libraryPreset } from './library'

/**
 * 根据预设名称获取预设配置
 */
export function getPreset(preset: Preset): Partial<EasypackConfig> {
  switch (preset) {
    case 'material':
      return materialPreset
    case 'setter':
      return setterPreset
    case 'library':
      return libraryPreset
    default:
      throw new Error(`Unknown preset: ${preset}`)
  }
}
