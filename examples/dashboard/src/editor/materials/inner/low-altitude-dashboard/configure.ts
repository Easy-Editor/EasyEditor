import type { Configure } from '@easy-editor/core'
import { generalAdvancedConfigure, generalBasicConfigure } from '../../configure'
import LowAltitudeDashboard from './component'
import { defaultLowAltitudeDashboardData } from './data'

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
              name: 'heading',
              title: '画面标题',
              setter: {
                componentName: 'StringSetter',
                defaultValue: '彭州低空经济运行态势',
              },
            },
            {
              name: 'data',
              title: '低空运营数据',
              setter: {
                componentName: 'JsonSetter',
                defaultValue: defaultLowAltitudeDashboardData,
              },
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
    view: LowAltitudeDashboard,
  },
}

export default configure
