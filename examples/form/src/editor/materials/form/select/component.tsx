import type { FC } from 'react'

export interface SelectOption {
  label: string
  value: string
  disabled?: boolean
}

export interface SelectProps {
  /**
   * 选项列表
   */
  options: SelectOption[]
  /**
   * 当前选中的值
   */
  value?: string
  /**
   * 占位符文本
   */
  placeholder?: string
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
   * 自定义className
   */
  className?: string
  /**
   * 值变化回调
   */
  onChange?: (value: string) => void
}

const Select: FC<SelectProps> = ({
  options = [],
  value,
  placeholder = '请选择',
  name,
  required = false,
  disabled = false,
  className = '',
  onChange,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (onChange) {
      onChange(e.target.value)
    }
  }

  return (
    <select
      name={name}
      value={value || ''}
      disabled={disabled}
      required={required}
      onChange={handleChange}
      className={`w-full px-3 py-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    >
      {placeholder && (
        <option value='' disabled>
          {placeholder}
        </option>
      )}
      {options.map((option, index) => (
        <option key={`${option.value}-${index}`} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export default Select
