import type { FC, Ref } from 'react'

export interface ButtonProps {
  ref: Ref<HTMLButtonElement>

  /**
   * 按钮文本
   */
  text: string
  /**
   * 按钮类型
   */
  type?: 'button' | 'submit' | 'reset'
  /**
   * 按钮大小
   */
  size?: 'small' | 'default' | 'large'
  /**
   * 按钮样式类型
   */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive'
  /**
   * 是否禁用
   */
  disabled?: boolean
  /**
   * 是否全宽度
   */
  fullWidth?: boolean
  /**
   * 点击事件
   */
  onClick?: () => void
  /**
   * 自定义className
   */
  className?: string
}

const Button: FC<ButtonProps> = ({
  text = '按钮',
  type = 'button',
  size = 'default',
  variant = 'primary',
  disabled = false,
  fullWidth = false,
  onClick,
  className,
  ref,
}) => {
  const handleClick = () => {
    if (disabled || !onClick) return
    onClick()
  }

  const sizeClasses = {
    small: 'px-3 py-1.5 text-sm',
    default: 'px-4 py-2 text-base',
    large: 'px-6 py-3 text-lg',
  }

  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600',
    secondary: 'bg-gray-600 hover:bg-gray-700 text-white border-gray-600',
    outline: 'bg-transparent hover:bg-blue-50 text-blue-600 border-blue-600',
    ghost: 'bg-transparent hover:bg-gray-100 text-gray-900 border-transparent',
    link: 'bg-transparent hover:underline text-blue-600 border-transparent p-0',
    destructive: 'bg-red-600 hover:bg-red-700 text-white border-red-600',
  }

  const baseClasses =
    'inline-flex items-center justify-center rounded-md border font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'

  const classes = [
    baseClasses,
    sizeClasses[size],
    variantClasses[variant],
    fullWidth ? 'w-full' : '',
    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled}
      onClick={handleClick}
      tabIndex={0}
      aria-label={text}
    >
      {text}
    </button>
  )
}

export default Button
