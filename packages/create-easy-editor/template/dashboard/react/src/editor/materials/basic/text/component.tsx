import type { Ref } from 'react'

interface TextProps {
  ref: Ref<HTMLParagraphElement>
  text?: string
}

const Text = (props: TextProps) => {
  const { ref, text } = props

  return (
    <p ref={ref} className='w-full h-full leading-7 [&:not(:first-child)]:mt-6'>
      {text}
    </p>
  )
}

export default Text
