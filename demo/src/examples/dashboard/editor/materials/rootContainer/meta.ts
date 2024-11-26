import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'RootContainer',
  title: '根容器',
  category: '通用',
  snippets,
  configure,
}

export default meta
