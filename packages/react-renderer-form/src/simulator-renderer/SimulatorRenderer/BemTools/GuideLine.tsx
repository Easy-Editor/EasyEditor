import type { Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'

interface GuideLineProps {
  host: Simulator
}

export const GuideLine: React.FC<GuideLineProps> = observer(({ host }) => {
  // 表单场景下暂不支持辅助线功能，直接返回空
  return <></>
})
