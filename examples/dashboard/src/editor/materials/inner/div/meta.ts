import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'

const meta: ComponentMetadata = {
  componentName: 'Div',
  title: 'Div 容器',
  group: MaterialGroup.INNER,
  configure,
}

export default meta
