import type { Configure } from '@easy-editor/core'

const configure: Configure = {
  props: [
    {
      title: '功能',
      type: 'group',
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
