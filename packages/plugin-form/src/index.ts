import {
  DESIGNER_EVENT,
  type Document,
  type Node,
  type PluginCreator,
  type PropValue,
  type Simulator,
  getConvertedExtraKey,
} from '@easy-editor/core'
import { FormDataManager } from './form/form-data-manager'
import { FormStateManager } from './form/form-state-manager'
import { FormValidator } from './form/form-validator'
import type {
  FieldValidationResult,
  FormData,
  FormSubmitResult,
  FormValidationResult,
  FormValidationRule,
} from './type'

export * from './type'

interface FormPluginOptions {
  /**
   * 表单配置
   */
  form?: {
    /**
     * 默认表单提交URL
     */
    submitUrl?: string

    /**
     * 默认表单提交方法
     */
    submitMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE'

    /**
     * 默认验证触发时机
     */
    validateTrigger?: 'onChange' | 'onBlur' | 'onSubmit'

    /**
     * 是否显示验证错误
     */
    showValidationErrors?: boolean
  }

  /**
   * 自定义表单提交处理器
   */
  onSubmit?: (formData: FormData, options: any) => Promise<FormSubmitResult>
}

const FormPlugin: PluginCreator<FormPluginOptions> = (options = {}) => {
  const { form: formConfig, onSubmit } = options

  // Default form submit function
  const defaultFormSubmit = async (formData: FormData): Promise<FormSubmitResult> => {
    const submitUrl = formConfig?.submitUrl || '/api/form/submit'
    const submitMethod = formConfig?.submitMethod || 'POST'

    try {
      const response = await fetch(submitUrl, {
        method: submitMethod,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const responseData = await response.json()

      return {
        success: response.ok,
        data: responseData,
        status: response.status,
        error: response.ok ? undefined : responseData.message || 'Submit failed',
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  return {
    name: 'FormPlugin',
    deps: [],
    init(ctx) {
      const { project } = ctx
      const { designer } = project

      // 初始化表单管理器
      const formValidator = new FormValidator()
      const formDataManager = new FormDataManager()
      const formStateManager = new FormStateManager()

      // 将管理器实例挂载到 designer 上
      Object.defineProperty(designer, 'formValidator', {
        value: formValidator,
        writable: false,
        enumerable: true,
        configurable: false,
      })

      Object.defineProperty(designer, 'formDataManager', {
        value: formDataManager,
        writable: false,
        enumerable: true,
        configurable: false,
      })

      Object.defineProperty(designer, 'formStateManager', {
        value: formStateManager,
        writable: false,
        enumerable: true,
        configurable: false,
      })

      // 监听字段值变化，触发验证和状态更新
      formDataManager.onFieldChange(async ({ fieldName, value }) => {
        // 标记字段为已修改
        formStateManager.markFieldDirty(fieldName)

        // 根据配置决定是否立即验证
        const trigger = formConfig?.validateTrigger || 'onChange'
        if (trigger === 'onChange') {
          const validationResult = await formValidator.validateField(fieldName, value, formDataManager.data)
          formStateManager.setFieldValidation(fieldName, validationResult.valid, validationResult.errors)
        }
      })

      // 监听节点删除，清理表单数据
      designer.onEvent(DESIGNER_EVENT.NODE_REMOVE, (e: { node: Node }) => {
        const { node } = e
        if (node.isFormField) {
          const fieldName = node.getFieldName()
          if (fieldName) {
            formDataManager.removeField(fieldName)
            formStateManager.removeFieldState(fieldName)
          }
        }
      })
    },

    extend({ extendClass, extend }) {
      const { Node } = extendClass

      /* -------------------------------- Designer -------------------------------- */
      // Note: Designer properties are set during init phase via Object.defineProperty

      /* -------------------------------- Document -------------------------------- */
      extend('Document', {
        getFormData: {
          value(this: Document): FormData {
            return this.designer.formDataManager.data
          },
        },
        setFormData: {
          value(this: Document, data: FormData): void {
            this.designer.formDataManager.setFormData(data)
          },
        },
        validateForm: {
          async value(this: Document): Promise<FormValidationResult> {
            const formData = this.getFormData()
            return this.designer.formValidator.validateForm(formData)
          },
        },
        submitForm: {
          async value(this: Document): Promise<FormSubmitResult> {
            const { formDataManager, formStateManager, formValidator } = this.designer

            try {
              // 开始提交状态
              formStateManager.startSubmitting()

              // 验证表单
              const validationResult = await formValidator.validateForm(formDataManager.data)
              if (!validationResult.valid) {
                formStateManager.endSubmitting(false)
                return {
                  success: false,
                  error: 'Form validation failed',
                  data: validationResult,
                }
              }

              // 执行提交
              let result: FormSubmitResult
              if (onSubmit) {
                result = await onSubmit(formDataManager.data, formConfig)
              } else {
                // 默认提交逻辑
                result = await defaultFormSubmit(formDataManager.data)
              }

              formStateManager.endSubmitting(result.success)
              return result
            } catch (error) {
              formStateManager.endSubmitting(false)
              return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            }
          },
        },
        resetForm: {
          value(this: Document): void {
            this.designer.formDataManager.resetForm()
            this.designer.formStateManager.resetFormState()
          },
        },
      })

      /* ---------------------------------- Node ---------------------------------- */
      const originalInitProps = Node.prototype.initBuiltinProps
      extend('Node', {
        isFormField: {
          get(this: Node) {
            return Boolean(this.schema.isFormField || this.schema.$form)
          },
        },
        isFormContainer: {
          get(this: Node) {
            return Boolean(this.schema.isFormContainer)
          },
        },
        getFieldValue: {
          value(this: Node): PropValue {
            const fieldName = this.getFieldName()
            if (!fieldName) return undefined
            return this.document.designer.formDataManager.getFieldValue(fieldName)
          },
        },
        setFieldValue: {
          value(this: Node, value: PropValue): void {
            const fieldName = this.getFieldName()
            if (!fieldName) return
            this.document.designer.formDataManager.setFieldValue(fieldName, value)
          },
        },
        getValidationRules: {
          value(this: Node): FormValidationRule[] {
            const fieldName = this.getFieldName()
            if (!fieldName) return []
            return this.document.designer.formValidator.getFieldValidationRules(fieldName)
          },
        },
        validateField: {
          async value(this: Node): Promise<FieldValidationResult> {
            const fieldName = this.getFieldName()
            if (!fieldName) {
              return {
                valid: true,
                errors: [],
                fieldName: '',
              }
            }
            const value = this.getFieldValue()
            const formData = this.document.getFormData()
            return this.document.designer.formValidator.validateField(fieldName, value, formData)
          },
        },
        getFieldErrors: {
          value(this: Node): string[] {
            const fieldName = this.getFieldName()
            if (!fieldName) return []
            return this.document.designer.formValidator.getFieldErrors(fieldName)
          },
        },
        isRequired: {
          value(this: Node): boolean {
            const rules = this.getValidationRules()
            return rules.some(rule => rule.type === 'required')
          },
        },
        getFieldName: {
          value(this: Node): string {
            return this.schema.$form?.fieldName || this.getExtraPropValue('$form.fieldName') || this.id
          },
        },
        setFieldName: {
          value(this: Node, name: string): void {
            this.setExtraPropValue('$form.fieldName', name)
          },
        },
        initBuiltinProps: {
          value(this: Node) {
            // 调用父类的 initBuiltinProps 方法
            originalInitProps.call(this)

            // 初始化表单相关属性
            this.props.has(getConvertedExtraKey('isFormField')) ||
              this.props.add(getConvertedExtraKey('isFormField'), false)
            this.props.has(getConvertedExtraKey('isFormContainer')) ||
              this.props.add(getConvertedExtraKey('isFormContainer'), false)
            this.props.has(getConvertedExtraKey('$form')) || this.props.add(getConvertedExtraKey('$form'), undefined)
          },
        },
      })

      /* -------------------------------- Simulator ------------------------------- */
      extend('Simulator', {
        formConfig: {
          get(this: Simulator) {
            return {
              submitUrl: formConfig?.submitUrl || '/api/form/submit',
              submitMethod: formConfig?.submitMethod || 'POST',
              showValidationErrors: formConfig?.showValidationErrors !== false,
              validateTrigger: formConfig?.validateTrigger || 'onChange',
            }
          },
        },
      })
    },
  }
}

export default FormPlugin
