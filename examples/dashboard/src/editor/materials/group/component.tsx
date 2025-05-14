import { type PropsWithChildren, type Ref, forwardRef } from 'react'

interface GroupProps extends PropsWithChildren {}

const Group = forwardRef((props: GroupProps, ref: Ref<HTMLDivElement>) => {
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {props?.children}
    </div>
  )
})

export default Group
