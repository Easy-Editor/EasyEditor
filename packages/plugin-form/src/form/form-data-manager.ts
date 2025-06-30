import type { PropValue } from '@easy-editor/core'
import { createEventBus } from '@easy-editor/core'
import { action, computed, observable } from 'mobx'
import type { FormData } from '../type'

export class FormDataManager {
  private emitter = createEventBus('FormDataManager')

  @observable.shallow private accessor formData = new Map<string, PropValue>()

  @observable.shallow private accessor defaultValues = new Map<string, PropValue>()

  @computed
  get data(): FormData {
    const result: FormData = {}
    for (const [key, value] of this.formData.entries()) {
      result[key] = value
    }
    return result
  }

  @computed
  get isEmpty(): boolean {
    return this.formData.size === 0
  }

  @computed
  get isDirty(): boolean {
    for (const [fieldName, value] of this.formData.entries()) {
      const defaultValue = this.defaultValues.get(fieldName)
      if (value !== defaultValue) {
        return true
      }
    }
    return false
  }

  /**
   * 设置字段值
   */
  @action
  setFieldValue(fieldName: string, value: PropValue): void {
    const oldValue = this.formData.get(fieldName)
    this.formData.set(fieldName, value)

    this.emitter.emit('field:change', {
      fieldName,
      value,
      oldValue,
    })

    this.emitter.emit('data:change', this.data)
  }

  /**
   * 获取字段值
   */
  getFieldValue(fieldName: string): PropValue {
    return this.formData.get(fieldName)
  }

  /**
   * 批量设置表单数据
   */
  @action
  setFormData(data: FormData): void {
    const oldData = this.data
    this.formData.clear()

    for (const [fieldName, value] of Object.entries(data)) {
      this.formData.set(fieldName, value)
    }

    this.emitter.emit('data:change', this.data)
    this.emitter.emit('data:replace', {
      oldData,
      newData: this.data,
    })
  }

  /**
   * 设置字段默认值
   */
  @action
  setFieldDefaultValue(fieldName: string, value: PropValue): void {
    this.defaultValues.set(fieldName, value)

    // 如果当前字段没有值，则设置为默认值
    if (!this.formData.has(fieldName)) {
      this.setFieldValue(fieldName, value)
    }
  }

  /**
   * 获取字段默认值
   */
  getFieldDefaultValue(fieldName: string): PropValue {
    return this.defaultValues.get(fieldName)
  }

  /**
   * 重置字段到默认值
   */
  @action
  resetField(fieldName: string): void {
    const defaultValue = this.defaultValues.get(fieldName)
    if (defaultValue !== undefined) {
      this.setFieldValue(fieldName, defaultValue)
    } else {
      this.removeField(fieldName)
    }
  }

  /**
   * 重置整个表单到默认值
   */
  @action
  resetForm(): void {
    this.formData.clear()

    for (const [fieldName, defaultValue] of this.defaultValues.entries()) {
      this.formData.set(fieldName, defaultValue)
    }

    this.emitter.emit('data:reset', this.data)
    this.emitter.emit('data:change', this.data)
  }

  /**
   * 移除字段
   */
  @action
  removeField(fieldName: string): void {
    const oldValue = this.formData.get(fieldName)
    this.formData.delete(fieldName)

    this.emitter.emit('field:remove', {
      fieldName,
      oldValue,
    })

    this.emitter.emit('data:change', this.data)
  }

  /**
   * 清空表单数据
   */
  @action
  clear(): void {
    const oldData = this.data
    this.formData.clear()

    this.emitter.emit('data:clear', oldData)
    this.emitter.emit('data:change', this.data)
  }

  /**
   * 判断字段是否存在
   */
  hasField(fieldName: string): boolean {
    return this.formData.has(fieldName)
  }

  /**
   * 获取所有字段名
   */
  getFieldNames(): string[] {
    return Array.from(this.formData.keys())
  }

  /**
   * 序列化表单数据
   */
  serialize(): string {
    return JSON.stringify(this.data)
  }

  /**
   * 反序列化表单数据
   */
  @action
  deserialize(jsonString: string): void {
    try {
      const data = JSON.parse(jsonString)
      this.setFormData(data)
    } catch (error) {
      console.error('Failed to deserialize form data:', error)
    }
  }

  /**
   * 监听数据变化事件
   */
  onDataChange(listener: (data: FormData) => void): () => void {
    this.emitter.on('data:change', listener)
    return () => {
      this.emitter.off('data:change', listener)
    }
  }

  /**
   * 监听字段变化事件
   */
  onFieldChange(listener: (event: { fieldName: string; value: PropValue; oldValue?: PropValue }) => void): () => void {
    this.emitter.on('field:change', listener)
    return () => {
      this.emitter.off('field:change', listener)
    }
  }

  /**
   * 监听表单重置事件
   */
  onReset(listener: (data: FormData) => void): () => void {
    this.emitter.on('data:reset', listener)
    return () => {
      this.emitter.off('data:reset', listener)
    }
  }

  /**
   * 监听表单清空事件
   */
  onClear(listener: (oldData: FormData) => void): () => void {
    this.emitter.on('data:clear', listener)
    return () => {
      this.emitter.off('data:clear', listener)
    }
  }
}
