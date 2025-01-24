import type { SetterProps } from '@easy-editor/core'
import type { PropsWithChildren } from 'react'

interface GroupSetterProps extends SetterProps<string>, PropsWithChildren {}

const GroupSetter = (props: GroupSetterProps) => {
  const { children } = props

  return <div className='space-y-4 flex flex-col gap-2'>{children}</div>
}

export default GroupSetter
