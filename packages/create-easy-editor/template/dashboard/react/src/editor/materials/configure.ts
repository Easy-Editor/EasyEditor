import type { FieldConfig } from '@easy-editor/core'

export const generalBasicConfigure: FieldConfig[] = [
  {
    name: 'id',
    title: 'ID',
    setter: 'NodeIdSetter',
    extraProps: {
      label: false,
    },
  },
  {
    name: 'title',
    title: '标题',
    setter: 'StringSetter',
    extraProps: {
      getValue(target) {
        return target.getExtraPropValue('title')
      },
      setValue(target, value) {
        target.setExtraPropValue('title', value)
      },
    },
  },
  {
    type: 'group',
    title: '基础属性',
    setter: {
      componentName: 'CollapseSetter',
      props: {
        icon: false,
      },
    },
    items: [
      {
        name: 'rect',
        title: '位置尺寸',
        setter: 'RectSetter',
        extraProps: {
          getValue(target) {
            return target.getExtraPropValue('$dashboard.rect')
          },
          setValue(target, value) {
            target.setExtraPropValue('$dashboard.rect', value)
          },
        },
      },
    ],
  },
]

export const generalAdvancedConfigure: FieldConfig[] = [
  {
    type: 'group',
    title: '高级设置',
    setter: {
      componentName: 'CollapseSetter',
      props: {
        icon: false,
      },
    },
    items: [
      {
        title: '显隐',
        setter: 'SwitchSetter',
        extraProps: {
          supportVariable: true,
          getValue(target) {
            return target.getNode().getExtraPropValue('condition')
          },
          setValue(target, value: boolean) {
            target.getNode().setExtraProp('condition', value)
          },
        },
      },
    ],
  },
]
