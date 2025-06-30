import { LowCodeRenderer, SimulatorRenderer } from '@easy-editor/react-renderer-form'
import type React from 'react'

// 基础表单组件映射
const components = {
  Form: 'form',
  Input: 'input',
  TextArea: 'textarea',
  Select: 'select',
  Option: 'option',
  Button: 'button',
  Checkbox: 'input',
  Radio: 'input',
  Label: 'label',
  Div: 'div',
}

// 垂直布局表单示例
const verticalFormSchema = {
  componentName: 'Form',
  props: {
    className: 'user-registration-form',
    onSubmit: (e: Event) => {
      e.preventDefault()
      console.log('Form submitted')
    },
  },
  children: [
    {
      componentName: 'Input',
      props: {
        type: 'text',
        name: 'username',
        placeholder: 'Enter your username',
      },
      $form: {
        fieldType: 'text',
        label: 'Username',
        name: 'username',
        required: true,
        rules: [
          { type: 'required', message: 'Username is required' },
          { type: 'minLength', value: 3, message: 'Username must be at least 3 characters' },
          {
            type: 'pattern',
            value: /^[a-zA-Z0-9_]+$/,
            message: 'Username can only contain letters, numbers, and underscores',
          },
        ],
        tooltip: 'Choose a unique username for your account',
      },
    },
    {
      componentName: 'Input',
      props: {
        type: 'email',
        name: 'email',
        placeholder: 'Enter your email address',
      },
      $form: {
        fieldType: 'email',
        label: 'Email Address',
        name: 'email',
        required: true,
        rules: [
          { type: 'required', message: 'Email is required' },
          { type: 'email', message: 'Please enter a valid email address' },
        ],
      },
    },
    {
      componentName: 'Input',
      props: {
        type: 'password',
        name: 'password',
        placeholder: 'Create a password',
      },
      $form: {
        fieldType: 'password',
        label: 'Password',
        name: 'password',
        required: true,
        rules: [
          { type: 'required', message: 'Password is required' },
          { type: 'minLength', value: 8, message: 'Password must be at least 8 characters' },
          {
            type: 'pattern',
            value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
            message: 'Password must contain at least one lowercase letter, one uppercase letter, and one number',
          },
        ],
      },
    },
    {
      componentName: 'TextArea',
      props: {
        name: 'bio',
        placeholder: 'Tell us about yourself',
        rows: 4,
      },
      $form: {
        fieldType: 'textarea',
        label: 'Biography',
        name: 'bio',
        required: false,
        rules: [{ type: 'maxLength', value: 500, message: 'Biography must not exceed 500 characters' }],
      },
    },
    {
      componentName: 'Checkbox',
      props: {
        type: 'checkbox',
        name: 'terms',
        value: 'agreed',
      },
      $form: {
        fieldType: 'checkbox',
        label: 'I agree to the Terms and Conditions',
        name: 'terms',
        required: true,
        rules: [{ type: 'required', message: 'You must agree to the terms and conditions' }],
      },
    },
    {
      componentName: 'Button',
      props: {
        type: 'submit',
        children: 'Create Account',
      },
    },
  ],
}

// 水平布局表单示例
const horizontalFormSchema = {
  componentName: 'Form',
  props: {
    className: 'contact-form',
  },
  children: [
    {
      componentName: 'Input',
      props: {
        type: 'text',
        name: 'firstName',
        placeholder: 'First name',
      },
      $form: {
        fieldType: 'text',
        label: 'First Name',
        name: 'firstName',
        required: true,
        layout: 'horizontal',
        labelCol: { span: 6 },
        wrapperCol: { span: 18 },
      },
    },
    {
      componentName: 'Input',
      props: {
        type: 'text',
        name: 'lastName',
        placeholder: 'Last name',
      },
      $form: {
        fieldType: 'text',
        label: 'Last Name',
        name: 'lastName',
        required: true,
        layout: 'horizontal',
        labelCol: { span: 6 },
        wrapperCol: { span: 18 },
      },
    },
    {
      componentName: 'Select',
      props: {
        name: 'country',
      },
      children: [
        {
          componentName: 'Option',
          props: {
            value: '',
            children: 'Select a country',
          },
        },
        {
          componentName: 'Option',
          props: {
            value: 'us',
            children: 'United States',
          },
        },
        {
          componentName: 'Option',
          props: {
            value: 'cn',
            children: 'China',
          },
        },
        {
          componentName: 'Option',
          props: {
            value: 'uk',
            children: 'United Kingdom',
          },
        },
      ],
      $form: {
        fieldType: 'select',
        label: 'Country',
        name: 'country',
        required: true,
        layout: 'horizontal',
        labelCol: { span: 6 },
        wrapperCol: { span: 18 },
      },
    },
  ],
}

// 表单渲染器使用示例
export const FormExample: React.FC = () => {
  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Vertical Layout Form</h2>
      <LowCodeRenderer
        schema={verticalFormSchema}
        components={components}
        formConfig={{
          layout: 'vertical',
          size: 'middle',
          showValidationErrors: true,
          validateTrigger: 'onChange',
          colon: true,
        }}
      />

      <hr style={{ margin: '40px 0' }} />

      <h2>Horizontal Layout Form</h2>
      <LowCodeRenderer
        schema={horizontalFormSchema}
        components={components}
        formConfig={{
          layout: 'horizontal',
          size: 'large',
          labelCol: { span: 6 },
          wrapperCol: { span: 18 },
          showValidationErrors: true,
          validateTrigger: 'onBlur',
          colon: true,
        }}
      />
    </div>
  )
}

// 设计模式示例（用于 EasyEditor 设计器中）
export const DesignModeExample: React.FC<{ simulator: any }> = ({ simulator }) => {
  return (
    <SimulatorRenderer
      host={simulator}
      formConfig={{
        layout: 'vertical',
        size: 'middle',
        showValidationErrors: true,
        validateTrigger: 'onChange',
      }}
    />
  )
}

// 默认导出
export default FormExample
