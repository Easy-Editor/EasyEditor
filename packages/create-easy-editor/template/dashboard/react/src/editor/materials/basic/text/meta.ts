import type { ComponentMetadata } from '@easy-editor/core'
import { MaterialGroup } from '../../type'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Text',
  title: 'Text',
  group: MaterialGroup.BASIC,
  snippets,
  configure,
}

export default meta
