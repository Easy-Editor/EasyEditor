import type { SetterProps } from '@easy-editor/core'

interface NodeIdSetterProps extends SetterProps<string> {}

const NodeIdSetter = (props: NodeIdSetterProps) => {
  const { selected } = props

  return (
    <div className='flex flex-col'>
      <p className='leading-7'>{selected.id}</p>
      <p className='text-xs text-muted-foreground'>{selected.componentMeta.componentName}</p>
    </div>
  )
}

export default NodeIdSetter
