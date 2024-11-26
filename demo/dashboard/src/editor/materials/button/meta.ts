import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Button',
  title: '按钮',
  category: '通用',
  snippets,
  configure,
}

export default meta
