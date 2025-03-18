import { observer } from 'mobx-react'
import type { SimulatorRendererProps } from '..'
import { BorderDetecting } from './BorderDetecting'
import { BorderResizing } from './BorderResizing'
import { BorderSelecting } from './BorderSelecting'
import { GuideLine } from './GuideLine'

import './index.css'
import './tools.css'

interface BemToolsProps extends SimulatorRendererProps {}

export const BemTools: React.FC<BemToolsProps> = observer(({ host, bemTools }) => {
  const { designMode } = host

  if (typeof bemTools === 'boolean' && !bemTools) {
    return null
  }

  if (designMode !== 'design') {
    return null
  }

  const { detecting = true, resizing = true, selecting = true, guideLine = true, extra } = bemTools || ({} as any)

  return (
    <div className='easy-editor-bem-tools'>
      {detecting && <BorderDetecting host={host} />}
      {selecting && <BorderSelecting host={host} />}
      {resizing && <BorderResizing host={host} />}
      {guideLine && <GuideLine host={host} />}
      {extra}
    </div>
  )
})
