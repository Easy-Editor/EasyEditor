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
        name: 'className',
        title: '样式类名',
        setter: 'StringSetter',
      },
      {
        name: 'style',
        title: '自定义样式',
        // setter: 'JsonSetter',
        setter: 'StringSetter',
      },
    ],
  },
]

export const formFieldConfigure: FieldConfig[] = [
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
        name: 'fieldName',
        title: '字段名',
        setter: 'StringSetter',
        extraProps: {
          getValue(target) {
            return target.getExtraPropValue('$form.fieldName')
          },
          setValue(target, value) {
            target.setExtraPropValue('$form.fieldName', value)
          },
        },
      },
      {
        name: 'label',
        title: '字段标签',
        setter: 'StringSetter',
        extraProps: {
          getValue(target) {
            return target.getExtraPropValue('$form.label')
          },
          setValue(target, value) {
            target.setExtraPropValue('$form.label', value)
          },
        },
      },
      {
        name: 'required',
        title: '必填',
        setter: 'SwitchSetter',
        extraProps: {
          getValue(target) {
            return target.getExtraPropValue('$form.required')
          },
          setValue(target, value) {
            target.setExtraPropValue('$form.required', value)
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
        name: 'condition',
        title: '显隐条件',
        setter: 'SwitchSetter',
        extraProps: {
          supportVariable: true,
          getValue(target) {
            return target.getExtraPropValue('condition')
          },
          setValue(target, value: boolean) {
            target.setExtraPropValue('condition', value)
          },
        },
      },
    ],
  },
]
