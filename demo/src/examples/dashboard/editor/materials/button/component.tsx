import type { Ref } from 'react'

interface ButtonProps {
  ref: Ref<HTMLButtonElement>
  type?: 'primary' | 'default'
  text?: string
}

const Button = (props: ButtonProps) => {
  return (
    <button ref={props.ref} type='button' className='w-full h-full'>
      {props?.text}
    </button>
  )
}

export default Button
