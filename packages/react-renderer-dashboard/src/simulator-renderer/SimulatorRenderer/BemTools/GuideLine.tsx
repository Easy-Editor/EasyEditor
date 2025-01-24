import type { Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'

interface GuideLineProps {
  host: Simulator
}

export const GuideLine: React.FC<GuideLineProps> = observer(({ host }) => {
  const { guideline } = host.designer
  const { enabled, adsorptionLines } = guideline

  if (!enabled) {
    return <></>
  }

  return (
    <>
      {Array.from(adsorptionLines.verticalLines.values()).map(pos => (
        <div
          key={pos}
          className='lc-guideline vertical'
          style={{
            left: pos,
          }}
        />
      ))}
      {Array.from(adsorptionLines.horizontalLines.values()).map(pos => (
        <div
          key={pos}
          className='lc-guideline horizontal'
          style={{
            top: pos,
          }}
        />
      ))}
    </>
  )
})
