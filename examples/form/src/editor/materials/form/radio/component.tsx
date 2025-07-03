import type { FC } from 'react'

export interface RadioOption {
  label: string
  value: string
  disabled?: boolean
}

export interface RadioProps {
  /**
   * 选项列表
   */
  options: RadioOption[]
  /**
   * 当前选中的值
   */
  value?: string
  /**
   * 字段名称
   */
  name?: string
  /**
   * 是否必填
   */
  required?: boolean
  /**
   * 自定义className
   */
  className?: string
  /**
   * 值变化回调
   */
  onChange?: (value: string) => void
}

const Radio: FC<RadioProps> = ({ options = [], value, name, required = false, className = '', onChange }) => {
  const handleChange = (optionValue: string) => {
    if (onChange) {
      onChange(optionValue)
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {options.map((option, index) => (
        <label
          key={`${option.value}-${index}`}
          className={`flex items-center space-x-2 cursor-pointer ${
            option.disabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <input
            type='radio'
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            required={required}
            onChange={() => handleChange(option.value)}
            className='w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 focus:ring-2'
          />
          <span className='text-sm text-gray-900'>{option.label}</span>
        </label>
      ))}
    </div>
  )
}

export default Radio
