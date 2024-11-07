import {
  type ComponentMetaManager,
  type Designer,
  type Project,
  type SetterManager,
  type Simulator,
  createEasyEditor,
} from '@easy-editor/core'

const componentMap = await import('./materials/component')
const componentMetaMap = await import('./materials/meta')
console.log('🚀 ~ componentMap:', componentMap)
console.log('🚀 ~ componentMetaMap:', componentMetaMap)

const easyEditor = createEasyEditor()
console.log('🚀 ~ easyEditor:', easyEditor)

// need param
easyEditor.init({
  constants: {
    a: 1,
  },
  lifeCycles: {
    init: () => {
      console.log('init')
    },
    destroy: () => {
      console.log('destroy')
    },
  },
  utils: [
    {
      name: 'test',
      type: 'function',
      content: () => {
        console.log('test')
      },
    },
  ],
  components: componentMap,
  componentMetas: componentMetaMap,
  // hotkeys: [],
  // components: {
  //   'text-block': TextBlock,
  // },
})

const designer = await easyEditor.onceGot<Designer>('designer')
const project = await easyEditor.onceGot<Project>('project')
const setterManager = await easyEditor.onceGot<SetterManager>('setterManager')
const componentMetaManager = await easyEditor.onceGot<ComponentMetaManager>('componentMetaManager')
const simulator = await easyEditor.onceGot<Simulator>('simulator')
console.log('🚀 ~ designer:', designer)
console.log('🚀 ~ project:', project)
console.log('🚀 ~ setterManager:', setterManager)
console.log('🚀 ~ componentMetaManager:', componentMetaManager)
console.log('🚀 ~ simulator:', simulator)

console.log('--------------------------------')
console.log('components', simulator.components)
console.log('componentMetas', componentMetaManager.componentMetasMap)
