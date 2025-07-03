import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'

const meta: ComponentMetadata = {
  componentName: 'Textarea',
  title: '文本域',
  category: '表单组件',
  configure,
}

export default meta
