import type { Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useMemo } from 'react'
import { UserGuideLine } from './UserGuideLine'

interface GuideLineProps {
  host: Simulator
}

export const GuideLine: React.FC<GuideLineProps> = observer(({ host }) => {
  const { guideline } = host.designer
  const { enabled, adsorptionLinesWithDistance = [], userGuideLines } = guideline

  // 去重：横向和纵向各只保留一个距离线段
  const uniqueDistanceSegments = useMemo(() => {
    let verticalSegment: {
      line: (typeof adsorptionLinesWithDistance)[0]
      segment: NonNullable<(typeof adsorptionLinesWithDistance)[0]['distanceSegments']>[0]
    } | null = null
    let horizontalSegment: {
      line: (typeof adsorptionLinesWithDistance)[0]
      segment: NonNullable<(typeof adsorptionLinesWithDistance)[0]['distanceSegments']>[0]
    } | null = null

    for (const line of adsorptionLinesWithDistance) {
      if (!line.distanceSegments?.length) continue

      for (const segment of line.distanceSegments) {
        if (line.type === 'vertical' && !verticalSegment) {
          verticalSegment = { line, segment }
        } else if (line.type === 'horizontal' && !horizontalSegment) {
          horizontalSegment = { line, segment }
        }

        // 两个方向都有了就退出
        if (verticalSegment && horizontalSegment) break
      }

      if (verticalSegment && horizontalSegment) break
    }

    const result: Array<{
      line: (typeof adsorptionLinesWithDistance)[0]
      segment: NonNullable<(typeof adsorptionLinesWithDistance)[0]['distanceSegments']>[0]
    }> = []
    if (verticalSegment) result.push(verticalSegment)
    if (horizontalSegment) result.push(horizontalSegment)

    return result
  }, [adsorptionLinesWithDistance])

  if (!enabled) {
    return null
  }

  return (
    <>
      {/* 吸附辅助线（拖动时显示） */}
      {adsorptionLinesWithDistance.map((line, index) => (
        <div
          key={`line-${line.type}-${line.position}-${index}`}
          className={`lc-guideline ${line.type}`}
          style={line.type === 'vertical' ? { left: line.position } : { top: line.position }}
        />
      ))}

      {/* 距离线段 - 横向和纵向各一个 */}
      {uniqueDistanceSegments.map(({ line, segment }, index) => (
        <div
          key={`segment-${line.type}-${index}`}
          className={`lc-distance-segment ${line.type}`}
          style={
            line.type === 'vertical'
              ? {
                  left: line.position,
                  top: segment.start,
                  height: Math.abs(segment.end - segment.start),
                }
              : {
                  top: line.position,
                  left: segment.start,
                  width: Math.abs(segment.end - segment.start),
                }
          }
        >
          {/* 端点标记 */}
          <span className='lc-distance-cap start' />
          <span className='lc-distance-cap end' />

          {/* 距离标签 */}
          <span
            className='lc-distance-label'
            style={
              line.type === 'vertical'
                ? { top: segment.labelPos - segment.start }
                : { left: segment.labelPos - segment.start }
            }
          >
            {segment.distance}
          </span>
        </div>
      ))}

      {/* 用户辅助线（从游尺添加） */}
      {userGuideLines.map(gl => (
        <UserGuideLine key={gl.id} host={host} guideLine={gl} />
      ))}
    </>
  )
})
