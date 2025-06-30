import { createEventBus } from '@easy-editor/core'
import { action, computed, observable } from 'mobx'
import type { FieldState, FormState } from '../type'

export class FormStateManager {
  private emitter = createEventBus('FormStateManager')

  @observable.shallow private accessor fieldStates = new Map<string, FieldState>()

  @observable private accessor _submitting = false

  @observable private accessor _submitted = false

  @computed
  get formState(): FormState {
    const fields: Record<string, FieldState> = {}

    for (const [fieldName, fieldState] of this.fieldStates.entries()) {
      fields[fieldName] = fieldState
    }

    return {
      pristine: this.isPristine,
      dirty: this.isDirty,
      valid: this.isValid,
      submitting: this._submitting,
      submitted: this._submitted,
      fields,
    }
  }

  @computed
  get isPristine(): boolean {
    for (const fieldState of this.fieldStates.values()) {
      if (!fieldState.pristine) {
        return false
      }
    }
    return true
  }

  @computed
  get isDirty(): boolean {
    return !this.isPristine
  }

  @computed
  get isValid(): boolean {
    for (const fieldState of this.fieldStates.values()) {
      if (!fieldState.valid) {
        return false
      }
    }
    return true
  }

  @computed
  get isSubmitting(): boolean {
    return this._submitting
  }

  @computed
  get isSubmitted(): boolean {
    return this._submitted
  }

  /**
   * 初始化字段状态
   */
  @action
  initFieldState(fieldName: string, initialState?: Partial<FieldState>): void {
    const defaultState: FieldState = {
      pristine: true,
      dirty: false,
      valid: true,
      touched: false,
      errors: [],
    }

    this.fieldStates.set(fieldName, {
      ...defaultState,
      ...initialState,
    })

    this.emitter.emit('field:init', {
      fieldName,
      fieldState: this.fieldStates.get(fieldName),
    })
  }

  /**
   * 设置字段状态
   */
  @action
  setFieldState(fieldName: string, partialState: Partial<FieldState>): void {
    const currentState = this.fieldStates.get(fieldName)
    if (!currentState) {
      this.initFieldState(fieldName, partialState)
      return
    }

    const newState = { ...currentState, ...partialState }
    this.fieldStates.set(fieldName, newState)

    this.emitter.emit('field:state-change', {
      fieldName,
      fieldState: newState,
      changes: partialState,
    })

    this.emitter.emit('form:state-change', this.formState)
  }

  /**
   * 获取字段状态
   */
  getFieldState(fieldName: string): FieldState | undefined {
    return this.fieldStates.get(fieldName)
  }

  /**
   * 标记字段为已修改
   */
  @action
  markFieldDirty(fieldName: string): void {
    this.setFieldState(fieldName, {
      pristine: false,
      dirty: true,
    })
  }

  /**
   * 标记字段为已访问
   */
  @action
  markFieldTouched(fieldName: string): void {
    this.setFieldState(fieldName, {
      touched: true,
    })
  }

  /**
   * 设置字段验证状态
   */
  @action
  setFieldValidation(fieldName: string, valid: boolean, errors: string[] = []): void {
    this.setFieldState(fieldName, {
      valid,
      errors,
    })
  }

  /**
   * 重置字段状态
   */
  @action
  resetFieldState(fieldName: string): void {
    this.setFieldState(fieldName, {
      pristine: true,
      dirty: false,
      valid: true,
      touched: false,
      errors: [],
    })

    this.emitter.emit('field:reset', {
      fieldName,
      fieldState: this.fieldStates.get(fieldName),
    })
  }

  /**
   * 重置表单状态
   */
  @action
  resetFormState(): void {
    for (const fieldName of this.fieldStates.keys()) {
      this.resetFieldState(fieldName)
    }

    this._submitting = false
    this._submitted = false

    this.emitter.emit('form:reset', this.formState)
  }

  /**
   * 开始提交
   */
  @action
  startSubmitting(): void {
    this._submitting = true
    this.emitter.emit('form:submit-start', this.formState)
  }

  /**
   * 结束提交
   */
  @action
  endSubmitting(success: boolean): void {
    this._submitting = false
    this._submitted = true

    this.emitter.emit('form:submit-end', {
      formState: this.formState,
      success,
    })
  }

  /**
   * 移除字段状态
   */
  @action
  removeFieldState(fieldName: string): void {
    const fieldState = this.fieldStates.get(fieldName)
    this.fieldStates.delete(fieldName)

    this.emitter.emit('field:remove', {
      fieldName,
      fieldState,
    })

    this.emitter.emit('form:state-change', this.formState)
  }

  /**
   * 获取所有字段名
   */
  getFieldNames(): string[] {
    return Array.from(this.fieldStates.keys())
  }

  /**
   * 监听字段状态变化事件
   */
  onFieldStateChange(
    listener: (event: { fieldName: string; fieldState: FieldState; changes: Partial<FieldState> }) => void,
  ): () => void {
    this.emitter.on('field:state-change', listener)
    return () => {
      this.emitter.off('field:state-change', listener)
    }
  }

  /**
   * 监听表单状态变化事件
   */
  onFormStateChange(listener: (formState: FormState) => void): () => void {
    this.emitter.on('form:state-change', listener)
    return () => {
      this.emitter.off('form:state-change', listener)
    }
  }

  /**
   * 监听提交事件
   */
  onSubmit(event: 'form:submit-start' | 'form:submit-end', listener: (data: any) => void): () => void {
    this.emitter.on(event, listener)
    return () => {
      this.emitter.off(event, listener)
    }
  }
}
