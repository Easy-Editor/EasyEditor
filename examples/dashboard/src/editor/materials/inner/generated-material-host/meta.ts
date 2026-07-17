import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'

const meta: ComponentMetadata = {
  componentName: 'GeneratedMaterialHost',
  title: 'Generated Material Host',
  group: MaterialGroup.INNER,
  configure,
}

export default meta
