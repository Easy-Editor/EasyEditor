/**
 * Remote Materials Configuration
 * 远程物料配置文件
 */

import { type RemoteMaterialConfig, remoteMaterialManager } from './remote-manager'

export const remoteMaterialsConfig: RemoteMaterialConfig[] = [
  {
    package: '@easy-editor/materials-dashboard-text',
    version: 'latest',
    globalName: 'EasyEditorMaterialsText',
    enabled: true,
  },
  // 后续可以添加更多远程物料
  // {
  //   package: '@easy-editor/materials-dashboard-button',
  //   version: 'latest',
  //   globalName: 'Button',
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
      await remoteMaterialManager.loadMetaMultiple(configs)
      console.log('[EasyEditor] Remote materials meta loaded successfully')
    } catch (error) {
      console.error('[EasyEditor] Failed to load remote materials meta:', error)
    }
  }
}
