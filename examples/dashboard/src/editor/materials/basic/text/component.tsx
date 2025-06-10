import type { Ref } from 'react'

interface TextProps {
  ref: Ref<HTMLParagraphElement>
  text?: string
}

const Text = (props: TextProps) => {
  const { ref, text, ...rest } = props

  return (
    <p ref={ref} className='w-full h-full leading-7 [&:not(:first-child)]:mt-6' {...rest}>
      {text}
    </p>
  )
}

export default Text
