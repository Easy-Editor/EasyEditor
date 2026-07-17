import type { Configure } from '@easy-editor/core'
import { generalAdvancedConfigure, generalBasicConfigure } from '../../configure'
import Text from './component'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '功能',
      setter: 'TabSetter',
      items: [
        {
          type: 'group',
          key: 'basic',
          title: '基本',
          items: [
            ...generalBasicConfigure,
            {
              name: 'text',
              title: '文本',
              setter: 'StringSetter',
            },
            {
              name: 'dataBindings',
              title: '数据绑定',
              setter: 'JsonSetter',
            },
          ],
        },
        {
          type: 'group',
          key: 'advanced',
          title: '高级',
          items: [...generalAdvancedConfigure],
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Text,
  },
}

export default configure
