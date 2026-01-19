import type { NodeSchema } from '@easy-editor/core'
import type { FC } from 'react'
import DashboardWrapper from './DashboardWrapper'

interface RemoteComponentLoadingProps {
  schema: NodeSchema
}

/**
 * 远程组件加载器
 * 显示简单的白色蒙版渐隐渐显效果
 * 注意：外层已经处理了定位，这里只需要填充整个容器
 */
const RemoteComponentLoading: FC<RemoteComponentLoadingProps> = ({ schema }) => {
  return (
    <DashboardWrapper schema={schema}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(255, 255, 255, 0.8)',
          animation: 'pulse 4s infinite',
          pointerEvents: 'none',
        }}
      />
    </DashboardWrapper>
  )
}

export default RemoteComponentLoading
