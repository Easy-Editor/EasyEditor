import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'

const meta: ComponentMetadata = {
  componentName: 'GlobeScene',
  title: '全球地球场景',
  group: MaterialGroup.DATA,
  configure,
}

export default meta
