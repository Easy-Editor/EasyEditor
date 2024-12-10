import type { NodeSchema } from '@easy-editor/core'
import type { FC } from 'react'
import { logger } from '../utils'

interface FaultComponentProps extends NodeSchema {
  error?: Error | string
}

const FaultComponent: FC<FaultComponentProps> = ({ componentName = '', error }) => {
  logger.error(`%c${componentName} 组件渲染异常, 异常原因: ${error?.message || error || '未知'}`, 'color: #ff0000;')

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
