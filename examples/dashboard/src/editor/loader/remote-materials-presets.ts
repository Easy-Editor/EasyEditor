/**
 * 远程物料配置
 * 用于快速添加远程物料到画布
 */

import type { NpmInfo } from '@easy-editor/core'

export interface RemoteMaterialPreset {
  /** 预设 ID */
  id: string
  /** 预设标题 */
  title: string
  /** 预设描述 */
  description?: string
  /** 预设截图 */
  screenshot?: string
  /** 预设图标 */
  icon?: string
  /** npm 信息 */
  npm: Required<Pick<NpmInfo, 'package' | 'version' | 'globalName'>> &
    Partial<Pick<NpmInfo, 'componentName' | 'exportName'>>
  /**
   * 使用远程物料的哪个 snippet
   * 可以是索引（number）或标题（string）
   */
  snippetSelector?: number | string
  /** 分组 */
  group?: string
}

/**
 * 远程物料预设列表
 */
export const remoteMaterialsPresets: RemoteMaterialPreset[] = [
  {
    id: 'text-remote',
    title: '文本组件',
    icon: '📝',
    npm: {
      package: '@easy-editor/materials-dashboard-text',
      version: 'latest',
      globalName: 'EasyEditorMaterialsText',
      componentName: 'Text',
    },
    snippetSelector: 'Text', // 使用 snippet 标题
    group: 'basic',
  },
  {
    id: 'heading-remote',
    title: '标题组件',
    icon: '📋',
    npm: {
      package: '@easy-editor/materials-dashboard-text',
      version: 'latest',
      globalName: 'EasyEditorMaterialsText',
      componentName: 'Text',
    },
    snippetSelector: 'Heading', // 使用 snippet 标题
    group: 'basic',
  },

  // 未来可以添加更多远程物料预设
  // {
  //   id: 'chart-remote',
  //   title: '图表组件（远程）',
  //   description: '从 NPM 动态加载的图表组件',
  //   icon: '📊',
  //   npm: {
  //     package: '@easy-editor/materials-dashboard-chart',
  //     version: 'latest',
  //     globalName: 'EasyEditorMaterialsDashboardChart',
  //     componentName: 'Chart',
  //   },
  //   defaultProps: {
  //     type: 'bar',
  //     data: [],
  //   },
  //   group: 'chart',
  // },
]

/**
 * 获取指定分组的预设
 */
export const getPresetsByGroup = (group: string): RemoteMaterialPreset[] => {
  return remoteMaterialsPresets.filter(preset => preset.group === group)
}

/**
 * 获取所有分组
 */
export const getAllGroups = (): string[] => {
  const groups = new Set(remoteMaterialsPresets.map(preset => preset.group).filter(Boolean))
  return Array.from(groups)
}

/**
 * 根据 ID 获取预设
 */
export const getPresetById = (id: string): RemoteMaterialPreset | undefined => {
  return remoteMaterialsPresets.find(preset => preset.id === id)
}
