import type { UploadValue } from '@/editor/setters/basic/upload-setter'
import type { Configure } from '@easy-editor/core'
import { generalAdvancedConfigure, generalBasicConfigure } from '../../configure'
import Image from './component'

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
              title: '图片属性',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: '__image',
                  title: '图片地址',
                  setter: 'UploadSetter',
                  extraProps: {
                    setValue(target, value: UploadValue) {
                      if (value) {
                        const { base64, raw } = value
                        base64 && target.parent.setPropValue('src', base64)
                        raw?.width && target.parent.setExtraPropValue('$dashboard.rect.width', raw.width)
                        raw?.height && target.parent.setExtraPropValue('$dashboard.rect.height', raw.height)
                      } else {
                        target.parent.clearPropValue('src')
                      }
                    },
                  },
                },
              ],
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
    view: Image,
  },
}

export default configure
