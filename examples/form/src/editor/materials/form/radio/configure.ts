import type { Configure } from '@easy-editor/core'
import { formFieldConfigure, generalBasicConfigure } from '../../configure'
import Radio from './component'

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
              title: '单选框配置',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: 'value',
                  title: '选项值',
                  setter: 'StringSetter',
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
    view: Radio,
  },
}

export default configure
