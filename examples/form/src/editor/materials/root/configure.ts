import type { Configure } from '@easy-editor/core'
import { generalBasicConfigure } from '../configure'
import Root from './component'

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
              type: 'group',
              title: '全局属性',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: 'backgroundColor',
                  title: '背景颜色',
                  setter: 'ColorSetter',
                },
              ],
            },
          ],
        },
        {
          type: 'group',
          key: 'advanced',
          title: '高级',
          items: [],
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Root,
  },
}

export default configure
