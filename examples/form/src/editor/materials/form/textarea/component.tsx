import type { FC } from 'react'

export interface TextareaProps {
  /**
   * 占位符文本
   */
  placeholder?: string
  /**
   * 字段名称
   */
  name?: string
  /**
   * 当前值
   */
  value?: string
  /**
   * 是否必填
   */
  required?: boolean
  /**
   * 是否禁用
   */
  disabled?: boolean
  /**
   * 最大长度
   */
  maxLength?: number
  /**
   * 行数
   */
  rows?: number
  /**
   * 是否可调整大小
   */
  resizable?: boolean
  /**
   * 自定义className
   */
  className?: string
  /**
   * 值变化回调
   */
  onChange?: (value: string) => void
}

const Textarea: FC<TextareaProps> = ({
  placeholder,
  name,
  value,
  required = false,
  disabled = false,
  maxLength,
  rows = 4,
  resizable = true,
  className = '',
  onChange,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (onChange) {
      onChange(e.target.value)
    }
  }

  return (
    <div className='w-full'>
      <textarea
        name={name}
        value={value || ''}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        rows={rows}
        onChange={handleChange}
        className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
          resizable ? 'resize-y' : 'resize-none'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      />
      {maxLength && (
        <div className='mt-1 text-right text-sm text-gray-500'>
          {(value || '').length}/{maxLength}
        </div>
      )}
    </div>
  )
}

export default Textarea
