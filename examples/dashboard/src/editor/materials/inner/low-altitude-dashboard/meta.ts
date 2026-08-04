import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'

const meta: ComponentMetadata = {
  componentName: 'LowAltitudeDashboard',
  title: '低空经济运行态势大屏',
  group: MaterialGroup.INNER,
  configure,
}

export default meta
