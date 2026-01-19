import { NotFoundComponent } from '@easy-editor/react-renderer'
import type { NotFoundComponentProps } from '@easy-editor/renderer-core'
import type { FC } from 'react'
import DashboardWrapper from './DashboardWrapper'

/**
 * 带定位的 NotFoundComponent
 */
const DashboardNotFoundComponent: FC<NotFoundComponentProps> = props => {
  return (
    <DashboardWrapper schema={props.schema} mask={false}>
      <NotFoundComponent {...props} />
    </DashboardWrapper>
  )
}

export default DashboardNotFoundComponent
