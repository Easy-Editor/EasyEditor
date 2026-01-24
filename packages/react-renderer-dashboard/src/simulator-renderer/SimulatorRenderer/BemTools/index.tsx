import type { Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { BorderDetecting } from './BorderDetecting'
import { BorderResizing } from './BorderResizing'
import { BorderSelecting } from './BorderSelecting'
import { GuideLine } from './GuideLine'
import { MarqueeSelection } from './MarqueeSelection'

import './index.css'
import './tools.css'

interface BemToolsProps {
  host: Simulator
}

export const BemTools: React.FC<BemToolsProps> = observer(({ host }) => {
  return (
    <div className='lc-bem-tools'>
      <BorderDetecting host={host} />
      <BorderSelecting host={host} />
      <BorderResizing host={host} />
      <GuideLine host={host} />
      <MarqueeSelection host={host} />
    </div>
  )
})
