import type { NodeSchema } from '@easy-editor/core'
import { FaultComponent } from '@easy-editor/react-renderer'
import type { FaultComponentProps } from '@easy-editor/renderer-core'
import type { FC } from 'react'
import DashboardWrapper from './DashboardWrapper'

type DashboardFaultComponentProps = FaultComponentProps & {
  schema?: NodeSchema
  __schema?: NodeSchema
}

/**
 * 带定位的 FaultComponent
 */
const DashboardFaultComponent: FC<DashboardFaultComponentProps> = props => {
  const schema = props.schema ?? props.__schema
  if (!schema) return <FaultComponent {...props} />

  return (
    <DashboardWrapper schema={schema}>
      <FaultComponent {...props} />
    </DashboardWrapper>
  )
}

export default DashboardFaultComponent
