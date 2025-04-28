import { createFetchHandler } from '@easy-editor/datasource-engine/handlers/fetch'
import type { RendererProps } from '@easy-editor/react-renderer'
import { LowCodeRenderer as Renderer } from './renderer'

const LowCodeRenderer = (props: RendererProps) => {
  return (
    <Renderer
      {...props}
      appHelper={{
        ...props.appHelper,
        requestHandlersMap: {
          ...props.appHelper?.requestHandlersMap,
          fetch: createFetchHandler(),
        },
      }}
    />
  )
}

export default LowCodeRenderer
