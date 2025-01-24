import type { Configure } from '@easy-editor/core'
import RootContainer from './component'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '功能',
      setter: 'GroupSetter',
      items: [
        {
          name: 'backgroundColor',
          title: '背景颜色',
          setter: 'StringSetter',
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: RootContainer,
  },
}

export default configure
