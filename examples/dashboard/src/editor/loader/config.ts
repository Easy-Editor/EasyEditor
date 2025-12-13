/**
 * Remote Materials Configuration
 * 远程物料配置文件
 */

import type { RemoteMaterialConfig } from './RemoteMaterialManager'

export const remoteMaterialsConfig: RemoteMaterialConfig[] = [
  {
    package: '@easy-editor/materials-dashboard-text',
    version: 'latest',
    globalName: 'EasyEditor_Materials_Dashboard_Text',
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
