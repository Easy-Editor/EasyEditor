import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import { type ProjectSchema, type RootSchema, init, materials, plugins, project, setters } from '@easy-editor/core'
import FormPlugin from '@easy-editor/plugin-form'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultRootSchema } from './const'
import { componentMetaMap } from './materials'
import { pluginList } from './plugins'
import { setterMap } from './setters'

import './overrides.css'

plugins.registerPlugins([
  FormPlugin({
    form: {
      submitUrl: '/api/form/submit',
      submitMethod: 'POST',
      validateTrigger: 'onChange',
      showValidationErrors: true,
    },
    onSubmit: async (formData: any) => {
      console.log('Form submitted:', formData)
      // 这里可以添加自定义的表单提交逻辑
      return { success: true, message: '表单提交成功！' }
    },
  }),
  HotkeyPlugin(),
  ...pluginList,
])

// 注册表单组件materials
materials.buildComponentMetasMap(Object.values(componentMetaMap))
setters.registerSetter(setterMap)

await init()

project.onSimulatorReady(simulator => {
  // 设置模拟器尺寸 - 适合表单展示
  simulator.set('deviceStyle', { viewport: { width: 400, height: 800 } })

  // 设置表单相关配置
  simulator.set('formConfig', {
    theme: 'default',
    layout: 'vertical',
    size: 'default',
  })
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
