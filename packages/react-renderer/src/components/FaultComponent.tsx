import { type FaultComponentProps, logger } from '@easy-editor/renderer-core'
import type { FC } from 'react'

const FaultComponent: FC<FaultComponentProps> = ({ componentName = '', error }) => {
  logger.error(`${componentName} 组件渲染异常, 异常原因: ${(error as Error)?.message || error || '未知'}`)

  return (
    <div
      role='alert'
      aria-label={`${componentName} 组件渲染异常`}
      style={{
        width: '100%',
        height: '50px',
        lineHeight: '50px',
        textAlign: 'center',
        fontSize: '15px',
        color: '#ef4444',
        border: '2px solid #ef4444',
      }}
    >
      {componentName} 组件渲染异常，请查看控制台日志
    </div>
  )
}

export default FaultComponent
