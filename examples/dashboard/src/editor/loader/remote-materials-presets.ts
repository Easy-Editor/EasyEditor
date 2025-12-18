/**
 * 远程物料配置
 * 用于加载远程物料的元数据，加载后会自动注册到物料系统中，与本地物料一起显示
 */

import RemoteMaterialManager from './RemoteMaterialManager'

export interface RemoteMaterialConfig {
  /** 包名 */
  package: string
  /** 版本 */
  version?: string
  /** UMD 暴露的全局变量名 */
  globalName: string
  /** 是否启用 */
  enabled?: boolean
}

/**
 * 远程物料配置列表
 * 这些物料的元数据会在编辑器初始化时加载，并自动注册到物料系统中
 */
export const remoteMaterialsConfig: RemoteMaterialConfig[] = [
  {
    package: '@easy-editor/materials-dashboard-text',
    version: 'latest',
    globalName: 'EasyEditorMaterialsText',
    enabled: true,
  },
  // 未来可以添加更多远程物料
  // {
  //   package: '@easy-editor/materials-dashboard-chart',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsDashboardChart',
  //   enabled: true,
  // },
]

/**
 * 批量加载所有远程物料的元数据
 * 加载后会自动注册到物料系统中，与本地物料一起显示
 */
export const loadRemoteMaterialsMeta = async () => {
  const configs = remoteMaterialsConfig.filter(config => config.enabled !== false)

  if (configs.length > 0) {
    console.log(`[EasyEditor] Loading ${configs.length} remote materials meta...`)
    try {
      await RemoteMaterialManager.loadMetaMultiple(configs)
      console.log('[EasyEditor] Remote materials meta loaded successfully')
    } catch (error) {
      console.error('[EasyEditor] Failed to load remote materials meta:', error)
    }
  }
}
