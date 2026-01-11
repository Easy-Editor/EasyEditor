import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import {
  type ComponentsMap,
  type NpmInfo,
  type ProjectSchema,
  type RootSchema,
  init,
  loadingState,
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
import {
  loadAllRemoteResources,
  loadRemoteMaterialsMeta,
  loadRemoteSetters,
  materialManager,
  waitForSetters,
} from './remote'

import './overrides.css'
import { setterMap } from './setters'

// 注册插件
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
// setters.registerSetter(setterMap)

// 启动远程资源加载（异步）
loadAllRemoteResources()

// 等待核心初始化
await init()

// 等待设置器加载完成（阻塞，确保属性面板可用）
try {
  await waitForSetters(30000)
  console.log('[EasyEditor] Remote setters loaded successfully')
} catch (error) {
  console.warn('[EasyEditor] Setters loading timeout, continuing with available setters')
}

// 设置模拟器
project.onSimulatorReady(simulator => {
  simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
})

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
    if ('package' in component && 'globalName' in component) {
      const npmInfo = component as NpmInfo
      const packageKey = `${npmInfo.package}@${npmInfo.version || 'latest'}`

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
      await materialManager.loadMetaMultiple(remoteMaterials)
      console.log('[EasyEditor] Remote material metas from componentsMap loaded successfully')
    } catch (error) {
      console.error('[EasyEditor] Failed to load remote material metas from componentsMap:', error)
    }
  }
}

/**
 * 自动批量加载所有远程组件代码（后台异步，不阻塞）
 */
const autoLoadAllRemoteComponents = async () => {
  const packages = materialManager.getLoadedPackages()
  const pendingPackages = packages.filter(p => !p.hasComponent)

  if (pendingPackages.length === 0) {
    return
  }

  console.log(`[EasyEditor] Auto-loading ${pendingPackages.length} remote components...`)

  // 并行加载所有组件
  const results = await Promise.allSettled(pendingPackages.map(p => materialManager.addComponent(p.name)))

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  console.log(`[EasyEditor] Auto-load completed: ${succeeded} success, ${failed} failed`)
}

const initProjectSchema = async () => {
  const defaultSchema = {
    componentsTree: [defaultRootSchema],
    version: '0.0.1',
  }

  const pageInfo = getPageInfoFromLocalStorage()

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
      const allComponentsMap: ComponentsMap = []
      const seenComponents = new Set<string>()

      for (const schema of schemas) {
        if (schema.componentsMap) {
          for (const component of schema.componentsMap) {
            let key: string
            if ('package' in component) {
              key = `${component.package}@${component.componentName || ''}`
            } else {
              key = component.componentName || ''
            }

            if (!seenComponents.has(key)) {
              seenComponents.add(key)
              allComponentsMap.push(component)
            }
          }
        }
      }

      const projectSchema: ProjectSchema = {
        componentsTree: schemas.map(s => s.componentsTree[0]),
        componentsMap: allComponentsMap,
        version: '1.0.0',
      }

      await loadRemoteMaterialsFromComponentsMap(allComponentsMap)
      project.load(projectSchema, true)

      // 后台自动加载远程组件代码（不阻塞）
      autoLoadAllRemoteComponents().catch(error => {
        console.error('[EasyEditor] Failed to auto-load remote components:', error)
      })
    } else {
      project.load(defaultSchema, true)
    }
  } else {
    project.load(defaultSchema, true)
  }
}

initProjectSchema()
