import Banner from '@/assets/banner.png'
import type { Ref } from 'react'

interface ImageProps {
  ref: Ref<HTMLDivElement>
  src?: string
}

const Image = (props: ImageProps) => {
  const { ref, src } = props

  return (
    <div ref={ref} className='w-full h-full'>
      <img className='w-full h-full' src={src ?? Banner} alt='img' onDragStart={e => e.preventDefault()} />
    </div>
  )
}

export default Image
