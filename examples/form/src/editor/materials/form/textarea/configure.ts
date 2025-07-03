import type { Configure } from '@easy-editor/core'
import { formFieldConfigure, generalBasicConfigure } from '../../configure'
import Textarea from './component'

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
              title: '文本域配置',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: 'placeholder',
                  title: '占位符',
                  setter: 'StringSetter',
                },
                {
                  name: 'rows',
                  title: '行数',
                  setter: 'NumberSetter',
                },
                {
                  name: 'disabled',
                  title: '禁用',
                  setter: 'BoolSetter',
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
    view: Textarea,
  },
}

export default configure
