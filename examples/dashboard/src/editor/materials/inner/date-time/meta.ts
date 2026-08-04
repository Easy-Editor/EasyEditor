import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'

const meta: ComponentMetadata = {
  componentName: 'DateTime',
  title: '日期时间',
  group: MaterialGroup.DATA,
  configure,
}

export default meta
