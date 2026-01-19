import type { RendererProps } from '@easy-editor/renderer-core'
import { DashboardFaultComponent, DashboardNotFoundComponent } from './components'
import { LowCodeRenderer as Renderer } from './renderer'

const LowCodeRenderer = (props: RendererProps) => {
  return <Renderer {...props} notFoundComponent={DashboardNotFoundComponent} faultComponent={DashboardFaultComponent} />
}

export default LowCodeRenderer
