import type { Configure } from '@easy-editor/core'
import { generalBasicConfigure } from '../../configure'
import Button from './component'

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
              title: '按钮配置',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: 'type',
                  title: '按钮类型',
                  setter: 'StringSetter',
                },
                {
                  name: 'variant',
                  title: '变体',
                  setter: 'StringSetter',
                },
                {
                  name: 'children',
                  title: '按钮文字',
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
    view: Button,
  },
}

export default configure
