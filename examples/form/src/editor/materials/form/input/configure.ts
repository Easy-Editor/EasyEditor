import type { Configure } from '@easy-editor/core'
import { formFieldConfigure, generalBasicConfigure } from '../../configure'
import Input from './component'

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
              title: '输入框配置',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: 'type',
                  title: '输入类型',
                  setter: 'StringSetter',
                },
                {
                  name: 'placeholder',
                  title: '占位符',
                  setter: 'StringSetter',
                },
                {
                  name: 'defaultValue',
                  title: '默认值',
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
    view: Input,
  },
}

export default configure
