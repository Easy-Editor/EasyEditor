/**
 * Remote Resource Config
 * 远程资源配置
 */

import type { RemoteMaterialConfig } from './managers/material-manager'
import type { RemoteSetterConfig } from './managers/setter-manager'

/** 远程物料配置列表 */
export const remoteMaterialsConfig: RemoteMaterialConfig[] = [
  {
    package: '@easy-editor/materials-dashboard-text',
    version: 'latest',
    globalName: 'EasyEditorMaterialsText',
    enabled: true,
  },
]

/** 远程设置器配置列表 */
export const remoteSettersConfig: RemoteSetterConfig[] = [
  {
    package: '@easy-editor/setters',
    version: 'latest',
    globalName: 'EasyEditorSetters',
    enabled: true,
  },
]
