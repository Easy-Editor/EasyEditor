import type { RendererProps } from '@easy-editor/react-renderer'
import { LowCodeRenderer as Renderer } from './renderer'

const LowCodeRenderer = (props: RendererProps) => {
  return <Renderer {...props} />
}

export default LowCodeRenderer
