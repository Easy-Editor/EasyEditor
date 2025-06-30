import type { PropValue } from '@easy-editor/core'
import { createEventBus } from '@easy-editor/core'
import { action, computed, observable } from 'mobx'
import type { FieldValidationResult, FormData, FormValidationResult, FormValidationRule } from '../type'

export class FormValidator {
  private emitter = createEventBus('FormValidator')

  @observable.shallow private accessor validationRules = new Map<string, FormValidationRule[]>()

  @observable.shallow private accessor fieldErrors = new Map<string, string[]>()

  @computed
  get isFormValid(): boolean {
    for (const errors of this.fieldErrors.values()) {
      if (errors.length > 0) {
        return false
      }
    }
    return true
  }

  /**
   * 设置字段验证规则
   */
  @action
  setFieldValidationRules(fieldName: string, rules: FormValidationRule[]): void {
    this.validationRules.set(fieldName, rules)
  }

  /**
   * 获取字段验证规则
   */
  getFieldValidationRules(fieldName: string): FormValidationRule[] {
    return this.validationRules.get(fieldName) || []
  }

  /**
   * 验证单个字段
   */
  async validateField(fieldName: string, value: PropValue, formData?: FormData): Promise<FieldValidationResult> {
    const rules = this.getFieldValidationRules(fieldName)
    const errors: string[] = []

    for (const rule of rules) {
      const isValid = await this.validateRule(rule, value, formData)
      if (!isValid) {
        errors.push(rule.message)
      }
    }

    const result: FieldValidationResult = {
      valid: errors.length === 0,
      errors,
      fieldName,
    }

    this.setFieldErrors(fieldName, errors)
    this.emitter.emit('field:validate', result)

    return result
  }

  /**
   * 验证整个表单
   */
  async validateForm(formData: FormData): Promise<FormValidationResult> {
    const fieldResults: Record<string, FieldValidationResult> = {}
    const allErrors: string[] = []

    for (const [fieldName, value] of Object.entries(formData)) {
      const fieldResult = await this.validateField(fieldName, value, formData)
      fieldResults[fieldName] = fieldResult
      allErrors.push(...fieldResult.errors)
    }

    const result: FormValidationResult = {
      valid: allErrors.length === 0,
      fieldResults,
      errors: allErrors,
    }

    this.emitter.emit('form:validate', result)

    return result
  }

  /**
   * 验证单个规则
   */
  private async validateRule(rule: FormValidationRule, value: PropValue, formData?: FormData): Promise<boolean> {
    switch (rule.type) {
      case 'required':
        return this.validateRequired(value)
      case 'minLength':
        return this.validateMinLength(value, rule.value)
      case 'maxLength':
        return this.validateMaxLength(value, rule.value)
      case 'pattern':
        return this.validatePattern(value, rule.value)
      case 'email':
        return this.validateEmail(value)
      case 'number':
        return this.validateNumber(value)
      case 'custom':
        if (rule.validator) {
          return await rule.validator(value, formData || {})
        }
        return true
      default:
        return true
    }
  }

  /**
   * 验证必填
   */
  private validateRequired(value: PropValue): boolean {
    if (value === null || value === undefined) {
      return false
    }
    if (typeof value === 'string') {
      return value.trim().length > 0
    }
    if (Array.isArray(value)) {
      return value.length > 0
    }
    return true
  }

  /**
   * 验证最小长度
   */
  private validateMinLength(value: PropValue, minLength: number): boolean {
    if (value === null || value === undefined) {
      return true
    }
    const str = String(value)
    return str.length >= minLength
  }

  /**
   * 验证最大长度
   */
  private validateMaxLength(value: PropValue, maxLength: number): boolean {
    if (value === null || value === undefined) {
      return true
    }
    const str = String(value)
    return str.length <= maxLength
  }

  /**
   * 验证正则表达式
   */
  private validatePattern(value: PropValue, pattern: string | RegExp): boolean {
    if (value === null || value === undefined) {
      return true
    }
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
    return regex.test(String(value))
  }

  /**
   * 验证邮箱
   */
  private validateEmail(value: PropValue): boolean {
    if (value === null || value === undefined) {
      return true
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(String(value))
  }

  /**
   * 验证数字
   */
  private validateNumber(value: PropValue): boolean {
    if (value === null || value === undefined) {
      return true
    }
    return !Number.isNaN(Number(value))
  }

  /**
   * 设置字段错误
   */
  @action
  setFieldErrors(fieldName: string, errors: string[]): void {
    this.fieldErrors.set(fieldName, errors)
  }

  /**
   * 获取字段错误
   */
  getFieldErrors(fieldName: string): string[] {
    return this.fieldErrors.get(fieldName) || []
  }

  /**
   * 清除字段错误
   */
  @action
  clearFieldErrors(fieldName: string): void {
    this.fieldErrors.delete(fieldName)
  }

  /**
   * 清除所有错误
   */
  @action
  clearAllErrors(): void {
    this.fieldErrors.clear()
  }

  /**
   * 监听验证事件
   */
  onValidate(event: 'field:validate' | 'form:validate', listener: (result: any) => void): () => void {
    this.emitter.on(event, listener)
    return () => {
      this.emitter.off(event, listener)
    }
  }
}
