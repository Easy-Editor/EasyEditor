import type { FC } from 'react'

export interface InputProps {
  type?: 'text' | 'email' | 'password' | 'number'
  placeholder?: string
  name?: string
  value?: string
  required?: boolean
  className?: string
  onChange?: (value: string) => void
}

const Input: FC<InputProps> = ({
  type = 'text',
  placeholder,
  name,
  value,
  required = false,
  className = '',
  onChange,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onChange) {
      onChange(e.target.value)
    }
  }

  return (
    <input
      type={type}
      placeholder={placeholder}
      name={name}
      value={value}
      required={required}
      onChange={handleChange}
      className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
    />
  )
}

export default Input
