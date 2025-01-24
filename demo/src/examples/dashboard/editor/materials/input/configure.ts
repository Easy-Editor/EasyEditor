import type { Configure } from '@easy-editor/core'
import Input from './component'

const configure: Configure = {
  props: [
    {
      title: '功能',
      display: 'block',
      type: 'group',
      items: [
        {
          name: 'value',
          title: '当前值',
          defaultValue: '',
          setter: 'StringSetter',
        },
        {
          name: 'placeholder',
          title: '占位提示',
          defaultValue: '请输入',
          setter: 'StringSetter',
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Input,
  },
}

export default configure
