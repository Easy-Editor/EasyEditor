import type { FC } from 'react'

export interface CheckboxOption {
  label: string
  value: string
  disabled?: boolean
}

export interface CheckboxProps {
  /**
   * 选项列表 (多选模式)
   */
  options?: CheckboxOption[]
  /**
   * 当前选中的值 (多选模式下为数组，单选模式下为布尔值)
   */
  value?: string[] | boolean
  /**
   * 标签文本 (单选模式)
   */
  label?: string
  /**
   * 字段名称
   */
  name?: string
  /**
   * 是否必填
   */
  required?: boolean
  /**
   * 是否禁用
   */
  disabled?: boolean
  /**
   * 是否为单个复选框模式
   */
  single?: boolean
  /**
   * 自定义className
   */
  className?: string
  /**
   * 值变化回调
   */
  onChange?: (value: string[] | boolean) => void
}

const Checkbox: FC<CheckboxProps> = ({
  options = [],
  value,
  label,
  name,
  required = false,
  disabled = false,
  single = false,
  className = '',
  onChange,
}) => {
  const handleSingleChange = (checked: boolean) => {
    if (onChange) {
      onChange(checked)
    }
  }

  const handleMultipleChange = (optionValue: string, checked: boolean) => {
    if (!onChange) return

    const currentValues = Array.isArray(value) ? value : []
    let newValues: string[]

    if (checked) {
      newValues = [...currentValues, optionValue]
    } else {
      newValues = currentValues.filter(v => v !== optionValue)
    }

    onChange(newValues)
  }

  // 单个复选框模式
  if (single || label) {
    const isChecked = typeof value === 'boolean' ? value : false

    return (
      <label
        className={`flex items-center space-x-2 cursor-pointer ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${className}`}
      >
        <input
          type='checkbox'
          name={name}
          checked={isChecked}
          disabled={disabled}
          required={required}
          onChange={e => handleSingleChange(e.target.checked)}
          className='w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2'
        />
        <span className='text-sm text-gray-900'>{label}</span>
      </label>
    )
  }

  // 多选模式
  const selectedValues = Array.isArray(value) ? value : []

  return (
    <div className={`space-y-2 ${className}`}>
      {options.map((option, index) => {
        const isChecked = selectedValues.includes(option.value)

        return (
          <label
            key={`${option.value}-${index}`}
            className={`flex items-center space-x-2 cursor-pointer ${
              option.disabled || disabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <input
              type='checkbox'
              name={name}
              value={option.value}
              checked={isChecked}
              disabled={option.disabled || disabled}
              required={required}
              onChange={e => handleMultipleChange(option.value, e.target.checked)}
              className='w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2'
            />
            <span className='text-sm text-gray-900'>{option.label}</span>
          </label>
        )
      })}
    </div>
  )
}

export default Checkbox
