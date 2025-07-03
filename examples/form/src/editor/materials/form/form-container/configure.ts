import type { Configure } from '@easy-editor/core'
import { generalBasicConfigure } from '../../configure'
import FormContainer from './component'

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
              title: '表单配置',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: 'layout',
                  title: '布局方式',
                  setter: 'StringSetter',
                },
                {
                  name: 'labelCol',
                  title: '标签列宽',
                  setter: 'NumberSetter',
                },
                {
                  name: 'wrapperCol',
                  title: '输入控件列宽',
                  setter: 'NumberSetter',
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
    view: FormContainer,
  },
}

export default configure
