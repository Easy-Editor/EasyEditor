import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'

const meta: ComponentMetadata = {
  componentName: 'DashboardIcon',
  title: '大屏图标',
  group: MaterialGroup.DATA,
  configure,
}

export default meta
