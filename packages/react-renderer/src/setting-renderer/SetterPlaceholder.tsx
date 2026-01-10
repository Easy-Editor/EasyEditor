/**
 * Setter Placeholder
 * 设置器加载占位符组件
 */

interface SetterPlaceholderProps {
  /** 设置器类型名称 */
  setterType?: string
}

/**
 * 设置器加载占位符
 * 当设置器尚未加载完成时显示
 */
export const SetterPlaceholder = ({ setterType }: SetterPlaceholderProps) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px',
        fontSize: '12px',
        color: '#999',
        backgroundColor: '#f5f5f5',
        borderRadius: '4px',
      }}
    >
      <LoadingSpinner />
      <span>{setterType ? `加载中: ${setterType}` : '设置器加载中...'}</span>
    </div>
  )
}

/**
 * 简单的加载动画
 */
const LoadingSpinner = () => {
  return (
    <svg
      width='14'
      height='14'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      style={{
        animation: 'spin 1s linear infinite',
      }}
    >
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      <path d='M21 12a9 9 0 1 1-6.219-8.56' />
    </svg>
  )
}
