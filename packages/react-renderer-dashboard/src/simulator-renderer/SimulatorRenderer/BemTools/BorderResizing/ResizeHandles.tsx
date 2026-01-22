import type { Rect } from '@easy-editor/core'
import { memo, useCallback } from 'react'
import type { ResizeRefs } from '../shared/types'

interface ResizeHandlesProps {
  rect: Rect
  onRefReady: (refs: ResizeRefs) => void
}

/**
 * 缩放手柄组件
 * 提取重复的 JSX 结构，渲染8个缩放手柄（4个边框 + 4个角点）
 */
export const ResizeHandles = memo<ResizeHandlesProps>(({ rect, onRefReady }) => {
  const setRef = useCallback(
    (key: keyof ResizeRefs) => (el: HTMLDivElement | null) => {
      const refs = {} as ResizeRefs
      refs[key] = el
      onRefReady(refs)
    },
    [onRefReady],
  )

  const baseBorderClass = 'lc-borders lc-resize-border'
  const baseSideClass = 'lc-resize-side'
  const baseCornerClass = 'lc-resize-corner'

  return (
    <div>
      {/* 北边框 */}
      <div
        ref={setRef('borderN')}
        className={baseBorderClass}
        style={{
          width: rect.width,
          height: 1,
          transform: `translate(${rect.x}px, ${rect.y}px)`,
        }}
      >
        <div
          className={`${baseSideClass} n`}
          style={{
            height: 20,
            transform: 'translateY(-10px)',
            width: '100%',
          }}
        />
      </div>

      {/* 东北角 */}
      <div
        ref={setRef('cornerNE')}
        className={`${baseCornerClass} ne`}
        style={{
          left: rect.x + rect.width - 4,
          top: rect.y - 4,
          cursor: 'nesw-resize',
        }}
      />

      {/* 东边框 */}
      <div
        ref={setRef('borderE')}
        className={baseBorderClass}
        style={{
          width: 1,
          height: rect.height,
          transform: `translate(${rect.x + rect.width}px, ${rect.y}px)`,
        }}
      >
        <div
          className={`${baseSideClass} e`}
          style={{
            width: 20,
            transform: 'translateX(-10px)',
            height: '100%',
          }}
        />
      </div>

      {/* 东南角 */}
      <div
        ref={setRef('cornerSE')}
        className={`${baseCornerClass} se`}
        style={{
          left: rect.x + rect.width - 4,
          top: rect.y + rect.height - 4,
          cursor: 'nwse-resize',
        }}
      />

      {/* 南边框 */}
      <div
        ref={setRef('borderS')}
        className={baseBorderClass}
        style={{
          width: rect.width,
          height: 1,
          transform: `translate(${rect.x}px, ${rect.y + rect.height}px)`,
        }}
      >
        <div
          className={`${baseSideClass} s`}
          style={{
            height: 20,
            transform: 'translateY(-10px)',
            width: '100%',
          }}
        />
      </div>

      {/* 西南角 */}
      <div
        ref={setRef('cornerSW')}
        className={`${baseCornerClass} sw`}
        style={{
          left: rect.x - 4,
          top: rect.y + rect.height - 4,
          cursor: 'nesw-resize',
        }}
      />

      {/* 西边框 */}
      <div
        ref={setRef('borderW')}
        className={baseBorderClass}
        style={{
          width: 1,
          height: rect.height,
          transform: `translate(${rect.x}px, ${rect.y}px)`,
        }}
      >
        <div
          className={`${baseSideClass} w`}
          style={{
            width: 20,
            transform: 'translateX(-10px)',
            height: '100%',
          }}
        />
      </div>

      {/* 西北角 */}
      <div
        ref={setRef('cornerNW')}
        className={`${baseCornerClass} nw`}
        style={{
          left: rect.x - 4,
          top: rect.y - 4,
          cursor: 'nwse-resize',
        }}
      />
    </div>
  )
})

ResizeHandles.displayName = 'ResizeHandles'
