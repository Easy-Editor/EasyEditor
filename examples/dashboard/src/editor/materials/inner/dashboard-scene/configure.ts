import type { Configure } from '@easy-editor/core'
import { generalAdvancedConfigure, generalBasicConfigure } from '../../configure'
import DashboardScene from './component'
import { defaultLocalizedDashboardSceneSpec } from './spec'

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
              name: 'spec',
              title: '大屏场景规范',
              setter: {
                componentName: 'JsonSetter',
                defaultValue: defaultLocalizedDashboardSceneSpec,
              },
            },
            {
              name: 'widgetData',
              title: '主物料数据覆盖',
              setter: {
                componentName: 'JsonSetter',
                defaultValue: {},
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
    view: DashboardScene,
  },
}

export default configure
