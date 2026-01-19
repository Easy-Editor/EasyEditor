import { FaultComponent } from '@easy-editor/react-renderer'
import type { FaultComponentProps } from '@easy-editor/renderer-core'
import type { FC } from 'react'
import DashboardWrapper from './DashboardWrapper'

/**
 * 带定位的 FaultComponent
 */
const DashboardFaultComponent: FC<FaultComponentProps> = props => {
  return (
    <DashboardWrapper schema={props.schema}>
      <FaultComponent {...props} />
    </DashboardWrapper>
  )
}

export default DashboardFaultComponent
