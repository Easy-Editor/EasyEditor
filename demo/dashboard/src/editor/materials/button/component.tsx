import { type Ref, forwardRef } from 'react'

interface ButtonProps {
  type?: 'primary' | 'default'
  text?: string
}

const Button = (props: ButtonProps, ref: Ref<HTMLButtonElement>) => {
  return (
    <button ref={ref} type='button'>
      {props?.text}
    </button>
  )
}

export default forwardRef(Button)
