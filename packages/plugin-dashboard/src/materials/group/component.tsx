import type { PropsWithChildren, Ref } from 'react'

interface GroupProps extends PropsWithChildren {
  ref: Ref<HTMLDivElement>
}

const Group = (props: GroupProps) => {
  return (
    // TODO: className 需要调整，需要通用的方式
    <div ref={props.ref} className='relative w-full h-full'>
      {props?.children}
    </div>
  )
}

export default Group
