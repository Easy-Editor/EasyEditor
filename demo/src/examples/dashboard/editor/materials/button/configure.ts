import type { Configure } from '@easy-editor/core'

const configure: Configure = {
  props: [
    {
      title: '功能',
      display: 'block',
      type: 'group',
      items: [
        {
          name: 'text',
          title: '内容',
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
