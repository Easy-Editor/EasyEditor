import type { PropValue } from '@easy-editor/core'

declare module '@easy-editor/core' {
  interface Designer {
    /**
     * 表单验证器
     */
    formValidator: any

    /**
     * 表单数据管理器
     */
    formDataManager: any

    /**
     * 表单状态管理器
     */
    formStateManager: any
  }

  interface Document {
    /**
     * 获取表单数据
     */
    getFormData(): FormData

    /**
     * 设置表单数据
     */
    setFormData(data: FormData): void

    /**
     * 验证表单
     */
    validateForm(): FormValidationResult

    /**
     * 提交表单
     */
    submitForm(): Promise<FormSubmitResult>

    /**
     * 重置表单
     */
    resetForm(): void
  }

  interface Node {
    /**
     * 是否是表单字段
     */
    isFormField: boolean

    /**
     * 是否是表单容器
     */
    isFormContainer: boolean

    /**
     * 获取字段值
     */
    getFieldValue(): PropValue

    /**
     * 设置字段值
     */
    setFieldValue(value: PropValue): void

    /**
     * 获取字段验证规则
     */
    getValidationRules(): FormValidationRule[]

    /**
     * 验证字段
     */
    validateField(): FieldValidationResult

    /**
     * 获取字段错误信息
     */
    getFieldErrors(): string[]

    /**
     * 是否字段必填
     */
    isRequired(): boolean

    /**
     * 获取字段名称
     */
    getFieldName(): string

    /**
     * 设置字段名称
     */
    setFieldName(name: string): void
  }

  interface NodeSchema {
    /**
     * 是否是表单字段
     */
    isFormField?: boolean

    /**
     * 是否是表单容器
     */
    isFormContainer?: boolean

    /**
     * 表单相关配置
     */
    $form?: {
      /**
       * 字段名称
       */
      fieldName?: string

      /**
       * 字段标签
       */
      label?: string

      /**
       * 是否必填
       */
      required?: boolean

      /**
       * 验证规则
       */
      validationRules?: FormValidationRule[]

      /**
       * 默认值
       */
      defaultValue?: PropValue

      /**
       * 字段类型
       */
      fieldType?: FormFieldType
    }
  }

  interface Simulator {
    /**
     * 获取表单配置
     */
    formConfig: {
      /**
       * 表单提交URL
       */
      submitUrl?: string

      /**
       * 表单提交方法
       */
      submitMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE'

      /**
       * 是否显示验证错误
       */
      showValidationErrors?: boolean

      /**
       * 验证触发时机
       */
      validateTrigger?: 'onChange' | 'onBlur' | 'onSubmit'
    }
  }
}

/**
 * 表单字段类型
 */
export type FormFieldType =
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

/**
 * 表单验证规则
 */
export interface FormValidationRule {
  /**
   * 规则类型
   */
  type: 'required' | 'minLength' | 'maxLength' | 'pattern' | 'email' | 'number' | 'custom'

  /**
   * 规则值
   */
  value?: any

  /**
   * 错误消息
   */
  message: string

  /**
   * 自定义验证函数
   */
  validator?: (value: PropValue, formData: FormData) => boolean | Promise<boolean>
}

/**
 * 字段验证结果
 */
export interface FieldValidationResult {
  /**
   * 是否通过验证
   */
  valid: boolean

  /**
   * 错误消息列表
   */
  errors: string[]

  /**
   * 字段名称
   */
  fieldName: string
}

/**
 * 表单验证结果
 */
export interface FormValidationResult {
  /**
   * 是否通过验证
   */
  valid: boolean

  /**
   * 字段验证结果
   */
  fieldResults: Record<string, FieldValidationResult>

  /**
   * 所有错误消息
   */
  errors: string[]
}

/**
 * 表单数据
 */
export interface FormData {
  [fieldName: string]: PropValue
}

/**
 * 表单状态
 */
export interface FormState {
  /**
   * 是否是初始状态
   */
  pristine: boolean

  /**
   * 是否已修改
   */
  dirty: boolean

  /**
   * 是否通过验证
   */
  valid: boolean

  /**
   * 是否正在提交
   */
  submitting: boolean

  /**
   * 是否已提交
   */
  submitted: boolean

  /**
   * 字段状态
   */
  fields: Record<string, FieldState>
}

/**
 * 字段状态
 */
export interface FieldState {
  /**
   * 是否是初始状态
   */
  pristine: boolean

  /**
   * 是否已修改
   */
  dirty: boolean

  /**
   * 是否通过验证
   */
  valid: boolean

  /**
   * 是否已访问
   */
  touched: boolean

  /**
   * 错误消息
   */
  errors: string[]
}

/**
 * 表单提交结果
 */
export interface FormSubmitResult {
  /**
   * 是否成功
   */
  success: boolean

  /**
   * 响应数据
   */
  data?: any

  /**
   * 错误信息
   */
  error?: string

  /**
   * 响应状态码
   */
  status?: number
}
