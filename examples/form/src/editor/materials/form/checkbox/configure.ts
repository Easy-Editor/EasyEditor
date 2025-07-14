import type { Configure } from '@easy-editor/core'
import { formFieldConfigure, generalBasicConfigure } from '../../configure'
import Checkbox from './component'

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
            ...formFieldConfigure,
            {
              type: 'group',
              title: '复选框配置',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: 'checked',
                  title: '选中状态',
                  setter: 'SwitchSetter',
                },
                {
                  name: 'disabled',
                  title: '禁用',
                  setter: 'SwitchSetter',
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
  supports: {
    style: true,
    className: true,
  },
  advanced: {
    view: Checkbox,
  },
}

export default configure
