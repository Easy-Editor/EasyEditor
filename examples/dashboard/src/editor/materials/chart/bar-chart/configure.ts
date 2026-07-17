import type { Configure } from '@easy-editor/core'
import { generalAdvancedConfigure, generalBasicConfigure } from '../../configure'
import MBarChart from './component'

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
            { name: 'data', title: '数据', setter: 'JsonSetter' },
            { name: 'xKey', title: '横轴字段', setter: 'StringSetter' },
            { name: 'series', title: '序列', setter: 'JsonSetter' },
            { name: 'dataBindings', title: '数据绑定', setter: 'JsonSetter' },
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
    view: MBarChart,
  },
}

export default configure
