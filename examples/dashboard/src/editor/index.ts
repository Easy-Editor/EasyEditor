import {
  type ComponentMetadata,
  type Setter,
  type Simulator,
  init,
  materials,
  plugins,
  project,
  setters,
} from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultProjectSchema } from './const'
import { formatMapFromESModule } from './utils'

const setterMap = formatMapFromESModule<Setter>(await import('./setters'))
const componentMetaMap = formatMapFromESModule<ComponentMetadata>(await import('./materials/meta'))

plugins.registerPlugins([
  DashboardPlugin({
    group: {
      meta: componentMetaMap.Group,
      initSchema: {
        componentName: 'Group',
        title: '分组',
        isGroup: true,
      },
    },
  }),
  DataSourcePlugin(),
  HotkeyPlugin(),
])
materials.buildComponentMetasMap(Object.values(componentMetaMap))
setters.registerSetter(setterMap)

await init({
  designMode: 'design',
  appHelper: {
    utils: {
      test: 'test',
    },
  },
})

const { designer } = project

project.onSimulatorReady((simulator: Simulator) => {
  simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
  project.load(defaultProjectSchema, true)
})

export { designer, materials, plugins, project, setters }

// export const editor = createEasyEditor({
//   lifeCycles: {
//     init: () => {
//       console.log('init')
//     },
//     destroy: () => {
//       console.log('destroy')
//     },
//   },
//   plugins: [DashboardPlugin(), HotkeyPlugin(), ...plugins],
//   setters: formatMapFromESModule<Setter>(setterMap),
//   components: formatMapFromESModule<Component>(componentMap),
//   componentMetas: formatMapFromESModule<ComponentMetadata>(componentMetaMap),
//   hotkeys: [
//     {
//       combos: ['ctrl+a'],
//       callback: e => {
//         e.preventDefault()
//         console.log('ctrl+a', e)
//       },
//     },
//   ],
// })
// console.log('🚀 ~ easyEditor:', editor)

// export const designer = await editor.onceGot<Designer>('designer')
// export const project = await editor.onceGot<Project>('project')
// export const simulator = await editor.onceGot<Simulator>('simulator')

// console.log('--------------------------------')
// console.log('designer', designer)
// console.log('project', project)
// console.log('simulator', simulator)

// const setterManager = await editor.onceGot<SetterManager>('setterManager')
// const componentMetaManager = await editor.onceGot<ComponentMetaManager>('componentMetaManager')

// console.log('--------------------------------')
// console.log('setters', setterManager.settersMap)
// console.log('components', simulator.components)
// console.log('componentMetas', componentMetaManager.componentMetasMap)

// console.log('--------------------------------')
// // simulator.setupEvents()
// // renderer.mount(simulator)

// project.open(defaultRootSchema)

// // 设置模拟器样式
// simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
