import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'BarChart',
  title: 'Bar Chart',
  group: MaterialGroup.CHART,
  snippets,
  configure,
}

export default meta
