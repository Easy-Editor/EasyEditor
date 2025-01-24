import type { Ref } from 'react'

interface InputProps {
  ref: Ref<HTMLInputElement>
  value?: string
  placeholder?: string
}

const Input = (props: InputProps) => {
  return <input ref={props.ref} type='text' value={props?.value} placeholder={props?.placeholder} />
}

export default Input
