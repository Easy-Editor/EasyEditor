import { type Ref, forwardRef } from 'react'

interface InputProps {
  value?: string
  placeholder?: string
}

const Input = (props: InputProps, ref: Ref<HTMLInputElement>) => {
  return <input ref={ref} type='text' value={props?.value} placeholder={props?.placeholder} />
}

export default forwardRef(Input)
