import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Group',
  title: '分组',
  category: '通用',
  snippets,
  configure,
}

export default meta
