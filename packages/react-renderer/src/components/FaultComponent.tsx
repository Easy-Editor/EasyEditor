import { type FaultComponentProps, logger } from '@easy-editor/renderer-core'
import type { FC } from 'react'

const FaultComponent: FC<FaultComponentProps> = ({ componentName = '', error }) => {
  logger.error(`${componentName} 组件渲染异常, 异常原因: ${(error as Error)?.message || error || '未知'}`)

  return (
    <div
      role='alert'
      aria-label={`${componentName} 组件渲染异常`}
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        textAlign: 'center',
        fontSize: '15px',
        color: '#ef4444',
        border: '2px solid #ef4444',
      }}
    >
      <span>{componentName} 组件渲染异常，请查看控制台日志</span>
    </div>
  )
}

export default FaultComponent
