import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'

const meta: ComponentMetadata = {
  componentName: 'Input',
  title: '输入框',
  category: '表单组件',
  configure,
}

export default meta
