import logo from '@/assets/logo.svg'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type * as React from 'react'

interface AiChatButtonProps {
  onClick: () => void
  className?: string
}

export const AiChatButton: React.FC<AiChatButtonProps> = ({ onClick, className }) => {
  return (
    <Button
      onClick={onClick}
      size='lg'
      className={cn(
        'fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all duration-500 bg-primary/80 hover:bg-primary/90 px-3.5 backdrop-blur-sm',
        'animate-float hover:animate-none',
        'opacity-70 hover:opacity-100',
        'transform hover:scale-105',
        className,
      )}
      aria-label='打开AI助手'
      tabIndex={0}
    >
      <img src={logo} alt='AI助手' className='w-[100px] transition-transform duration-500 hover:rotate-3' />
    </Button>
  )
}
