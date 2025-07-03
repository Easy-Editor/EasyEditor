import type { RootSchema } from '@easy-editor/core'

export const defaultRootSchema: RootSchema = {
  fileName: 'form',
  fileDesc: '表单页面',
  componentName: 'Root',
  props: {
    backgroundColor: '#f5f5f5',
    className: 'form-page',
  },
  isRoot: true,
  children: [
    {
      componentName: 'FormContainer',
      title: '表单容器',
      props: {
        title: '用户信息表单',
        layout: 'vertical',
        size: 'default',
      },
      isFormContainer: true,
      children: [
        {
          componentName: 'Input',
          title: '用户名',
          props: {
            type: 'text',
            placeholder: '请输入用户名',
            name: 'username',
          },
          isFormField: true,
          $form: {
            fieldName: 'username',
            label: '用户名',
            required: true,
            validationRules: [
              { type: 'required', message: '用户名不能为空' },
              { type: 'minLength', value: 3, message: '用户名至少3个字符' },
            ],
          },
        },
        {
          componentName: 'Input',
          title: '邮箱',
          props: {
            type: 'email',
            placeholder: '请输入邮箱地址',
            name: 'email',
          },
          isFormField: true,
          $form: {
            fieldName: 'email',
            label: '邮箱',
            required: true,
            validationRules: [
              { type: 'required', message: '邮箱不能为空' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ],
          },
        },
        {
          componentName: 'Button',
          title: '提交按钮',
          props: {
            text: '提交表单',
            type: 'submit',
            variant: 'primary',
          },
        },
      ],
    },
  ],
}
