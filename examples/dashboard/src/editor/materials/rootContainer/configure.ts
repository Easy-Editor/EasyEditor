import type { Configure } from '@easy-editor/core'

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
  advanced: {},
}

export default configure
