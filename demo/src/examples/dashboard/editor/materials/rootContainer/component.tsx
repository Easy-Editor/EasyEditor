import { type Ref, forwardRef } from 'react'

interface RootContainerProps {
  backgroundColor?: string
  children?: React.ReactNode
}

const RootContainer = (props: RootContainerProps, ref: Ref<HTMLDivElement>) => {
  return (
    <div ref={ref} className='w-full h-full' style={{ backgroundColor: props?.backgroundColor }}>
      {props?.children}
    </div>
  )
}

export default forwardRef(RootContainer)
