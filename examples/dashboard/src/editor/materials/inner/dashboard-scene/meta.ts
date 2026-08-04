import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'

const meta: ComponentMetadata = {
  componentName: 'DashboardScene',
  title: '通用可视化大屏场景',
  group: MaterialGroup.INNER,
  configure,
}

export default meta
