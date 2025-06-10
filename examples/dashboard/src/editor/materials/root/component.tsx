import type { Ref } from 'react'

interface RootProps {
  ref: Ref<HTMLDivElement>
  children?: React.ReactNode
  backgroundColor?: string
  backgroundImage?: string
}

const Root = (props: RootProps) => {
  const { ref, backgroundColor, children, backgroundImage } = props

  return (
    <div
      ref={ref}
      className='w-full h-full'
      style={{
        background: backgroundImage ? `url(${backgroundImage}) center center / cover no-repeat` : backgroundColor,
      }}
    >
      {children}
    </div>
  )
}

export default Root
