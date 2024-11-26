import { type PropsWithChildren, type Ref, forwardRef } from 'react'

interface GroupProps extends PropsWithChildren {}

const Group = (props: GroupProps, ref: Ref<HTMLDivElement>) => {
  return <div ref={ref}>{props?.children}</div>
}

export default forwardRef(Group)
