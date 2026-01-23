import type { Simulator } from '@easy-editor/core'
import type { UserGuideLineItem } from '@easy-editor/plugin-dashboard'
import { observer } from 'mobx-react'
import { useCallback, useRef, useState } from 'react'

interface UserGuideLineProps {
  host: Simulator
  guideLine: UserGuideLineItem
}

const defaultDeviceStyle = {
  viewport: { width: 1920, height: 1080 },
}

/**
 * 用户辅助线组件
 * 支持拖动调整位置，双击删除，拖出画布删除
 */
export const UserGuideLine: React.FC<UserGuideLineProps> = observer(({ host, guideLine }) => {
  const [isDragging, setIsDragging] = useState(false)
  const [showLabel, setShowLabel] = useState(false)
  const dragStartRef = useRef({ pos: 0, guidePos: 0 })

  const { viewport, designer } = host
  const { guideline } = designer
  const isHorizontal = guideLine.type === 'horizontal'

  // 获取画布尺寸
  const { viewport: viewportStyle } = host.deviceStyle || {}
  const { width: canvasWidth, height: canvasHeight } =
    (viewportStyle as { width: number; height: number }) || defaultDeviceStyle.viewport

  // 双击删除
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      guideline.removeUserGuideLine(guideLine.id)
    },
    [guideLine.id, guideline],
  )

  // 拖动开始
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(true)

      const startPos = isHorizontal ? e.clientY : e.clientX
      dragStartRef.current = { pos: startPos, guidePos: guideLine.position }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const currentPos = isHorizontal ? moveEvent.clientY : moveEvent.clientX
        // 将屏幕坐标差转换为画布坐标差
        const delta = (currentPos - dragStartRef.current.pos) / viewport.scale
        const newPosition = dragStartRef.current.guidePos + delta

        // 检查是否在画布范围内（允许一定的溢出）
        const maxPos = isHorizontal ? canvasHeight : canvasWidth
        if (newPosition >= -50 && newPosition <= maxPos + 50) {
          guideline.updateUserGuideLine(guideLine.id, newPosition)
        }
      }

      const handleMouseUp = (upEvent: MouseEvent) => {
        setIsDragging(false)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)

        // 检查是否拖出画布范围（删除）- 使用拖拽距离判断
        const currentPos = isHorizontal ? upEvent.clientY : upEvent.clientX
        const dragDistance = Math.abs(currentPos - dragStartRef.current.pos)
        const delta = (currentPos - dragStartRef.current.pos) / viewport.scale
        const finalPosition = dragStartRef.current.guidePos + delta
        const maxPos = isHorizontal ? canvasHeight : canvasWidth

        // 只有当拖拽距离超过阈值，且最终位置在画布外时才删除
        if (dragDistance > 10 && (finalPosition < -50 || finalPosition > maxPos + 50)) {
          guideline.removeUserGuideLine(guideLine.id)
        }
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [isHorizontal, viewport.scale, guideLine, canvasWidth, canvasHeight, guideline],
  )

  // 位置直接使用画布坐标，因为父容器已应用 scale 变换
  const style: React.CSSProperties = isHorizontal
    ? { top: guideLine.position, left: 0, right: 0 }
    : { left: guideLine.position, top: 0, bottom: 0 }

  return (
    <div
      className={`lc-user-guideline ${isHorizontal ? 'horizontal' : 'vertical'}`}
      style={style}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setShowLabel(true)}
      onMouseLeave={() => !isDragging && setShowLabel(false)}
    >
      {(showLabel || isDragging) && <span className='lc-user-guideline-label'>{Math.round(guideLine.position)}</span>}
    </div>
  )
})
