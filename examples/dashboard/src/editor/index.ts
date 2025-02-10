import {
  type Component,
  type ComponentMetaManager,
  type ComponentMetadata,
  type Designer,
  type Project,
  type Setter,
  type SetterManager,
  type Simulator,
  createEasyEditor,
} from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultRootSchema } from './const'
import { formatMapFromESModule } from './utils'

const plugins = (await import('./plugins')).default
const setterMap = await import('./setters')
const componentMap = await import('./materials/component')
const componentMetaMap = await import('./materials/meta')

export const components = formatMapFromESModule<Component>(componentMap)

export const editor = createEasyEditor({
  lifeCycles: {
    init: () => {
      console.log('init')
    },
    destroy: () => {
      console.log('destroy')
    },
  },
  plugins: [DashboardPlugin(), HotkeyPlugin(), ...plugins],
  setters: formatMapFromESModule<Setter>(setterMap),
  components: formatMapFromESModule<Component>(componentMap),
  componentMetas: formatMapFromESModule<ComponentMetadata>(componentMetaMap),
  hotkeys: [
    {
      combos: ['ctrl+a'],
      callback: e => {
        e.preventDefault()
        console.log('ctrl+a', e)
      },
    },
  ],
})
console.log('🚀 ~ easyEditor:', editor)

export const designer = await editor.onceGot<Designer>('designer')
export const project = await editor.onceGot<Project>('project')
export const simulator = await editor.onceGot<Simulator>('simulator')

console.log('--------------------------------')
console.log('designer', designer)
console.log('project', project)
console.log('simulator', simulator)

const setterManager = await editor.onceGot<SetterManager>('setterManager')
const componentMetaManager = await editor.onceGot<ComponentMetaManager>('componentMetaManager')

console.log('--------------------------------')
console.log('setters', setterManager.settersMap)
console.log('components', simulator.components)
console.log('componentMetas', componentMetaManager.componentMetasMap)

console.log('--------------------------------')
// simulator.setupEvents()
// renderer.mount(simulator)

project.open(defaultRootSchema)

// 设置模拟器样式
simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
