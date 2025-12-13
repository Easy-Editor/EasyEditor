import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import { type ProjectSchema, type RootSchema, init, materials, plugins, project, setters } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultRootSchema } from './const'
import { Group, componentMetaMap } from './materials'
import { pluginList } from './plugins'
import { setterMap } from './setters'
import { RemoteMaterialManager } from './loader'
import { remoteMaterialsConfig } from './loader/config'

import './overrides.css'

plugins.registerPlugins([
  DashboardPlugin({
    group: {
      meta: Group,
      initSchema: {
        componentName: 'Group',
        title: 'Group',
        isGroup: true,
      },
    },
  }),
  HotkeyPlugin(),
  ...pluginList,
])

// 注册本地物料
materials.buildComponentMetasMap(Object.values(componentMetaMap))

// 动态加载远程物料
;(async () => {
  try {
    console.log('[EasyEditor] Loading remote materials...')
    await RemoteMaterialManager.loadMultiple(remoteMaterialsConfig)
    console.log('[EasyEditor] Remote materials loaded successfully')
  } catch (error) {
    console.error('[EasyEditor] Failed to load remote materials:', error)
  }
})()

setters.registerSetter(setterMap)

await init()

project.onSimulatorReady(simulator => {
  // 设置模拟器尺寸
  simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
})

const initProjectSchema = async () => {
  const defaultSchema = {
    componentsTree: [defaultRootSchema],
    version: '0.0.1',
  }

  // 从本地获取
  const pageInfo = getPageInfoFromLocalStorage()
  if (pageInfo && pageInfo.length > 0) {
    let isLoad = true
    const projectSchema = {
      componentsTree: pageInfo.map(item => {
        const schema = getPageSchemaFromLocalStorage(item.path)
        if (!schema) {
          isLoad = false
        }
        return (schema as ProjectSchema<RootSchema>).componentsTree[0]
      }),
      version: '1.0.0',
    }
    if (isLoad) {
      project.load(projectSchema, true)
    } else {
      project.load(defaultSchema, true)
    }
  } else {
    project.load(defaultSchema, true)
  }
}

initProjectSchema()
