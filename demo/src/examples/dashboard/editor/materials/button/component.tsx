import type { Ref } from 'react'

interface ButtonProps {
  ref: Ref<HTMLButtonElement>
  type?: 'primary' | 'default'
  text?: string
  onClick?: () => void
}

const Button = (props: ButtonProps) => {
  return (
    <button ref={props.ref} type='button' className='w-full h-full' onClick={props.onClick}>
      {props?.text}
    </button>
  )
}

export default Button
