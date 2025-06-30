# @easy-editor/plugin-form

Form plugin for EasyEditor that provides comprehensive form management capabilities including validation, data management, and state tracking.

## Features

- **Form Validation**: Built-in validators for common validation rules (required, minLength, maxLength, pattern, email, number) with support for custom validators
- **Form Data Management**: Reactive data management with change tracking, default values, and form reset capabilities
- **Form State Management**: Track form and field states (pristine, dirty, valid, touched, submitting, submitted)
- **Automatic Field Discovery**: Automatically detects and manages form fields based on node metadata
- **Event-Driven Architecture**: Comprehensive event system for reacting to form changes
- **TypeScript Support**: Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install @easy-editor/plugin-form
```

## Basic Usage

```typescript
import { createEngine } from '@easy-editor/core'
import FormPlugin from '@easy-editor/plugin-form'

const engine = createEngine({
  plugins: [
    FormPlugin({
      form: {
        submitUrl: '/api/form/submit',
        submitMethod: 'POST',
        validateTrigger: 'onChange',
        showValidationErrors: true
      },
      onSubmit: async (formData, options) => {
        // Custom submit handler
        const response = await fetch('/api/custom-submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        })
        return {
          success: response.ok,
          data: await response.json(),
          status: response.status
        }
      }
    })
  ]
})
```

## Plugin Options

### FormPluginOptions

```typescript
interface FormPluginOptions {
  form?: {
    submitUrl?: string                              // Default: '/api/form/submit'
    submitMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE' // Default: 'POST'
    validateTrigger?: 'onChange' | 'onBlur' | 'onSubmit' // Default: 'onChange'
    showValidationErrors?: boolean                  // Default: true
  }
  onSubmit?: (formData: FormData, options: any) => Promise<FormSubmitResult>
}
```

## Form Field Configuration

Configure form fields using the `$form` property in node schemas:

```typescript
const textFieldSchema = {
  componentName: 'TextInput',
  isFormField: true,
  $form: {
    fieldName: 'username',
    label: 'Username',
    required: true,
    fieldType: 'text',
    defaultValue: '',
    validationRules: [
      {
        type: 'required',
        message: 'Username is required'
      },
      {
        type: 'minLength',
        value: 3,
        message: 'Username must be at least 3 characters'
      }
    ]
  }
}
```

## API Reference

### Document Methods

#### `getFormData(): FormData`
Returns the current form data.

#### `setFormData(data: FormData): void`
Sets the form data.

#### `validateForm(): Promise<FormValidationResult>`
Validates the entire form and returns validation results.

#### `submitForm(): Promise<FormSubmitResult>`
Submits the form after validation.

#### `resetForm(): void`
Resets the form to its initial state.

### Node Methods

#### `isFormField: boolean`
Indicates if the node is a form field.

#### `isFormContainer: boolean`
Indicates if the node is a form container.

#### `getFieldValue(): PropValue`
Gets the current field value.

#### `setFieldValue(value: PropValue): void`
Sets the field value.

#### `getValidationRules(): FormValidationRule[]`
Gets the validation rules for the field.

#### `validateField(): Promise<FieldValidationResult>`
Validates the individual field.

#### `getFieldErrors(): string[]`
Gets current validation errors for the field.

#### `isRequired(): boolean`
Checks if the field is required.

#### `getFieldName(): string`
Gets the field name.

#### `setFieldName(name: string): void`
Sets the field name.

### Designer Properties

#### `formValidator: FormValidator`
Access to the form validator instance.

#### `formDataManager: FormDataManager`
Access to the form data manager instance.

#### `formStateManager: FormStateManager`
Access to the form state manager instance.

## Validation Rules

### Built-in Validators

- **required**: Field must have a value
- **minLength**: Minimum string length
- **maxLength**: Maximum string length
- **pattern**: Regex pattern matching
- **email**: Valid email format
- **number**: Valid number format

### Custom Validators

```typescript
const customValidationRule: FormValidationRule = {
  type: 'custom',
  message: 'Value must be unique',
  validator: async (value, formData) => {
    // Your custom validation logic
    const response = await fetch('/api/validate-unique', {
      method: 'POST',
      body: JSON.stringify({ value })
    })
    return response.ok
  }
}
```

## Events

### FormValidator Events

```typescript
// Listen to field validation
designer.formValidator.onValidate('field:validate', (result) => {
  console.log('Field validation result:', result)
})

// Listen to form validation
designer.formValidator.onValidate('form:validate', (result) => {
  console.log('Form validation result:', result)
})
```

### FormDataManager Events

```typescript
// Listen to data changes
designer.formDataManager.onDataChange((data) => {
  console.log('Form data changed:', data)
})

// Listen to field changes
designer.formDataManager.onFieldChange(({ fieldName, value, oldValue }) => {
  console.log('Field changed:', fieldName, value, oldValue)
})

// Listen to form reset
designer.formDataManager.onReset((data) => {
  console.log('Form reset:', data)
})
```

### FormStateManager Events

```typescript
// Listen to form state changes
designer.formStateManager.onFormStateChange((formState) => {
  console.log('Form state changed:', formState)
})

// Listen to field state changes
designer.formStateManager.onFieldStateChange(({ fieldName, fieldState, changes }) => {
  console.log('Field state changed:', fieldName, fieldState, changes)
})

// Listen to form submission
designer.formStateManager.onSubmit('form:submit-start', (formState) => {
  console.log('Form submission started:', formState)
})

designer.formStateManager.onSubmit('form:submit-end', ({ formState, success }) => {
  console.log('Form submission ended:', formState, success)
})
```

## Form Field Types

```typescript
type FormFieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'tel'
  | 'url'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'time'
  | 'file'
```

## Examples

### Basic Form Setup

```typescript
// Create a simple contact form
const contactFormSchema = {
  componentName: 'Form',
  isFormContainer: true,
  children: [
    {
      componentName: 'TextInput',
      isFormField: true,
      $form: {
        fieldName: 'name',
        label: 'Full Name',
        fieldType: 'text',
        validationRules: [
          { type: 'required', message: 'Name is required' },
          { type: 'minLength', value: 2, message: 'Name must be at least 2 characters' }
        ]
      }
    },
    {
      componentName: 'EmailInput',
      isFormField: true,
      $form: {
        fieldName: 'email',
        label: 'Email Address',
        fieldType: 'email',
        validationRules: [
          { type: 'required', message: 'Email is required' },
          { type: 'email', message: 'Please enter a valid email address' }
        ]
      }
    }
  ]
}
```

### Programmatic Form Interaction

```typescript
// Get form data
const formData = document.getFormData()
console.log('Current form data:', formData)

// Validate form
const validationResult = await document.validateForm()
if (validationResult.valid) {
  console.log('Form is valid!')
} else {
  console.log('Validation errors:', validationResult.errors)
}

// Submit form
const submitResult = await document.submitForm()
if (submitResult.success) {
  console.log('Form submitted successfully:', submitResult.data)
} else {
  console.log('Form submission failed:', submitResult.error)
}

// Reset form
document.resetForm()
```

## License

MIT
