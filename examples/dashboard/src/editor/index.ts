import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import {
  ComponentsMap,
  NpmInfo,
  type ProjectSchema,
  type RootSchema,
  init,
  materials,
  plugins,
  project,
  setters,
} from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultRootSchema } from './const'
import { Group, componentMetaMap } from './materials'
import { pluginList } from './plugins'
import { setterMap } from './setters'
import { RemoteMaterialManager } from './loader'
import { loadRemoteMaterialsMeta } from './loader/remote-materials-presets'

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

// // 动态加载远程物料
// ;(async () => {
//   try {
//     console.log('[EasyEditor] Loading remote materials...')
//     await RemoteMaterialManager.loadMultiple(remoteMaterialsConfig)
//     console.log('[EasyEditor] Remote materials loaded successfully')
//   } catch (error) {
//     console.error('[EasyEditor] Failed to load remote materials:', error)
//   }
// })()

setters.registerSetter(setterMap)

await init()

project.onSimulatorReady(simulator => {
  // 设置模拟器尺寸
  simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
})

// 批量加载远程物料元数据（加载后会自动注册到物料系统中，与本地物料一起显示）
loadRemoteMaterialsMeta()

/**
 * 从 componentsMap 加载远程物料元数据
 */
const loadRemoteMaterialsFromComponentsMap = async (componentsMap?: ComponentsMap) => {
  if (!componentsMap || componentsMap.length === 0) {
    return
  }

  // 提取所有 ProCode 组件（NpmInfo）
  const remoteMaterials: Array<{ package: string; version?: string; globalName: string }> = []
  const seenPackages = new Set<string>()

  for (const component of componentsMap) {
    // 检查是否是 ProCode 组件（NpmInfo）
    if ('package' in component && 'globalName' in component) {
      const npmInfo = component as NpmInfo
      const packageKey = `${npmInfo.package}@${npmInfo.version || 'latest'}`

      // 避免重复加载
      if (!seenPackages.has(packageKey) && npmInfo.globalName) {
        seenPackages.add(packageKey)
        remoteMaterials.push({
          package: npmInfo.package,
          version: npmInfo.version || 'latest',
          globalName: npmInfo.globalName,
        })
      }
    }
  }

  if (remoteMaterials.length > 0) {
    console.log(`[EasyEditor] Loading ${remoteMaterials.length} remote material metas from componentsMap...`)
    try {
      await RemoteMaterialManager.loadMetaMultiple(remoteMaterials)
      console.log('[EasyEditor] Remote material metas from componentsMap loaded successfully')
    } catch (error) {
      console.error('[EasyEditor] Failed to load remote material metas from componentsMap:', error)
    }
  }
}

const initProjectSchema = async () => {
  const defaultSchema = {
    componentsTree: [defaultRootSchema],
    version: '0.0.1',
  }

  // 从本地获取
  const pageInfo = getPageInfoFromLocalStorage()
  let projectSchema: ProjectSchema

  if (pageInfo && pageInfo.length > 0) {
    let isLoad = true
    const schemas = pageInfo.map(item => {
      const schema = getPageSchemaFromLocalStorage(item.path)
      if (!schema) {
        isLoad = false
      }
      return schema as ProjectSchema<RootSchema>
    })

    if (isLoad && schemas.length > 0) {
      // 合并所有 schema 的 componentsMap
      const allComponentsMap: ComponentsMap = []
      const seenComponents = new Set<string>()

      for (const schema of schemas) {
        if (schema.componentsMap) {
          for (const component of schema.componentsMap) {
            // 生成唯一 key
            let key: string
            if ('package' in component) {
              // ProCodeComponent (NpmInfo)
              key = `${component.package}@${component.componentName || ''}`
            } else {
              // LowCodeComponent
              key = component.componentName || ''
            }

            if (!seenComponents.has(key)) {
              seenComponents.add(key)
              allComponentsMap.push(component)
            }
          }
        }
      }

      projectSchema = {
        componentsTree: schemas.map(s => s.componentsTree[0]),
        componentsMap: allComponentsMap,
        version: '1.0.0',
      }

      // 先加载远程物料，再加载 schema
      await loadRemoteMaterialsFromComponentsMap(allComponentsMap)
      project.load(projectSchema, true)
    } else {
      project.load(defaultSchema, true)
    }
  } else {
    project.load(defaultSchema, true)
  }
}

initProjectSchema()
