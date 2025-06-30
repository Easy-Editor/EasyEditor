# @easy-editor/react-renderer-form

React renderer specifically designed for form layouts in EasyEditor, providing comprehensive form rendering capabilities.

## Features

- **Form Layout Support**: Vertical, horizontal, and inline layout modes
- **Field Validation**: Real-time validation with error display
- **Form Data Binding**: Automatic form data collection and management
- **Responsive Design**: Mobile-first responsive form layouts
- **Theme Support**: Light and dark theme compatibility
- **Accessibility**: WCAG compliant form rendering
- **TypeScript Support**: Full TypeScript support with type definitions

## Installation

```bash
npm install @easy-editor/react-renderer-form
```

## Peer Dependencies

```bash
npm install @easy-editor/core @easy-editor/plugin-form react react-dom mobx mobx-react
```

## Basic Usage

### Form Renderer

```tsx
import React from 'react'
import { LowCodeRenderer } from '@easy-editor/react-renderer-form'

const schema = {
  componentName: 'Form',
  props: {
    layout: 'vertical',
    size: 'middle'
  },
  children: [
    {
      componentName: 'Input',
      props: {
        name: 'username',
        placeholder: 'Enter username'
      },
      $form: {
        label: 'Username',
        required: true,
        rules: [
          { type: 'required', message: 'Username is required' },
          { type: 'minLength', value: 3, message: 'Username must be at least 3 characters' }
        ]
      }
    },
    {
      componentName: 'Input',
      props: {
        type: 'email',
        name: 'email',
        placeholder: 'Enter email'
      },
      $form: {
        label: 'Email',
        required: true,
        rules: [
          { type: 'required', message: 'Email is required' },
          { type: 'email', message: 'Please enter a valid email' }
        ]
      }
    },
    {
      componentName: 'Button',
      props: {
        type: 'submit',
        children: 'Submit'
      }
    }
  ]
}

const components = {
  Form: 'form',
  Input: 'input',
  Button: 'button'
}

function App() {
  return (
    <LowCodeRenderer
      schema={schema}
      components={components}
      formConfig={{
        layout: 'vertical',
        labelCol: { span: 6 },
        wrapperCol: { span: 18 },
        showValidationErrors: true,
        validateTrigger: 'onChange'
      }}
    />
  )
}
```

### Design Mode

```tsx
import React from 'react'
import { SimulatorRenderer } from '@easy-editor/react-renderer-form'

function DesignApp() {
  return (
    <SimulatorRenderer
      host={simulator}
      formConfig={{
        layout: 'horizontal',
        size: 'large',
        colon: true,
        showValidationErrors: true
      }}
    />
  )
}
```

## Form Configuration

### Layout Options

```typescript
interface FormConfig {
  // Layout mode
  layout?: 'vertical' | 'horizontal' | 'inline'

  // Label column configuration (for horizontal layout)
  labelCol?: { span: number }

  // Wrapper column configuration (for horizontal layout)
  wrapperCol?: { span: number }

  // Size of form components
  size?: 'small' | 'middle' | 'large'

  // Whether to show colon after labels
  colon?: boolean

  // When to trigger validation
  validateTrigger?: 'onChange' | 'onBlur' | 'onSubmit'

  // Whether to show validation errors
  showValidationErrors?: boolean
}
```

### Field Configuration

```typescript
interface FormFieldConfig {
  // Field type
  fieldType?: 'text' | 'email' | 'password' | 'number' | 'textarea' | 'select' | 'checkbox' | 'radio'

  // Field label
  label?: string

  // Field name (for form data binding)
  name?: string

  // Whether field is required
  required?: boolean

  // Validation rules
  rules?: FormValidationRule[]

  // Help tooltip
  tooltip?: string

  // Whether field is hidden
  hidden?: boolean

  // Whether field is disabled
  disabled?: boolean

  // Placeholder text
  placeholder?: string

  // Default value
  defaultValue?: any

  // Custom layout for this field
  layout?: 'vertical' | 'horizontal' | 'inline'
  labelCol?: { span: number }
  wrapperCol?: { span: number }

  // Custom validation trigger
  validateTrigger?: 'onChange' | 'onBlur' | 'onSubmit'

  // Custom styling
  className?: string
  style?: React.CSSProperties
}
```

## Schema Structure

### Form Schema

```typescript
const formSchema = {
  componentName: 'Form',
  props: {
    // Standard React props
    className: 'my-form',
    onSubmit: (data) => console.log(data)
  },
  // Form-specific configuration
  $form: {
    // This can be omitted for container components
  },
  children: [
    // Form field schemas...
  ]
}
```

### Field Schema

```typescript
const fieldSchema = {
  componentName: 'Input',
  props: {
    // Standard component props
    type: 'text',
    placeholder: 'Enter value'
  },
  // Form field configuration
  $form: {
    label: 'Field Label',
    name: 'fieldName',
    required: true,
    rules: [
      { type: 'required', message: 'This field is required' },
      { type: 'pattern', value: /^[A-Za-z]+$/, message: 'Only letters allowed' }
    ],
    tooltip: 'This is a help message',
    defaultValue: 'default value'
  }
}
```

## Validation Rules

### Built-in Validators

```typescript
// Required field
{ type: 'required', message: 'Field is required' }

// Minimum length
{ type: 'minLength', value: 3, message: 'Minimum 3 characters' }

// Maximum length
{ type: 'maxLength', value: 100, message: 'Maximum 100 characters' }

// Email validation
{ type: 'email', message: 'Invalid email format' }

// Number validation
{ type: 'number', message: 'Must be a number' }

// Pattern matching
{ type: 'pattern', value: /^[0-9]+$/, message: 'Only numbers allowed' }

// Custom validator
{
  type: 'custom',
  validator: async (value, rule) => {
    // Custom validation logic
    if (value !== 'expected') {
      return { valid: false, message: 'Custom validation failed' }
    }
    return { valid: true }
  }
}
```

## Styling

### CSS Classes

The renderer provides comprehensive CSS classes for styling:

```css
/* Form container */
.lc-form-container { }

/* Form items */
.lc-form-item { }
.lc-form-item-vertical { }
.lc-form-item-horizontal { }
.lc-form-item-inline { }

/* Labels */
.lc-form-item-label { }
.lc-form-item-required { }

/* Form fields */
.lc-form-field { }
.lc-form-field:focus { }
.lc-form-field:disabled { }

/* Error states */
.lc-form-item-error { }
.lc-form-item.has-error .lc-form-field { }

/* Size variants */
.lc-form-item-size-small { }
.lc-form-item-size-large { }
```

### Custom Styling

```tsx
// Custom CSS
import './my-form-styles.css'

// Inline styles
<LowCodeRenderer
  schema={schema}
  components={components}
  style={{
    '--form-primary-color': '#1890ff',
    '--form-error-color': '#ff4d4f'
  }}
/>
```

## Advanced Usage

### Integration with Form Plugin

```tsx
import { FormPlugin } from '@easy-editor/plugin-form'
import { LowCodeRenderer } from '@easy-editor/react-renderer-form'

// Initialize form plugin
const formPlugin = FormPlugin({
  form: {
    submitUrl: '/api/form/submit',
    submitMethod: 'POST'
  },
  onSubmit: async (formData) => {
    // Custom submit handling
    console.log('Form submitted:', formData)
    return { success: true }
  }
})

// Use with renderer
<LowCodeRenderer
  schema={schema}
  components={components}
  plugins={[formPlugin]}
/>
```

### Form Data Management

```tsx
// Access form data
const formData = document.formDataManager.data

// Set field value
document.formDataManager.setFieldValue('username', 'john')

// Validate form
const validationResult = await document.formValidator.validateForm()

// Get form state
const formState = document.formStateManager.formState
```

## API Reference

### Exports

- `LowCodeRenderer` - Main form renderer component
- `Renderer` - Form renderer with viewport support
- `SimulatorRenderer` - Design mode form renderer
- `simulatorRenderer` - Simulator renderer instance

### Types

All TypeScript types are exported from `@easy-editor/plugin-form`.

## Browser Support

- Chrome >= 88
- Firefox >= 85
- Safari >= 14
- Edge >= 88

## License

MIT

## Contributing

Please read our [contributing guidelines](../../CONTRIBUTING.md) before submitting pull requests.

## Related Packages

- [`@easy-editor/core`](../core) - Core EasyEditor functionality
- [`@easy-editor/plugin-form`](../plugin-form) - Form plugin for EasyEditor
- [`@easy-editor/react-renderer`](../react-renderer) - Base React renderer
- [`@easy-editor/renderer-core`](../renderer-core) - Renderer core utilities
