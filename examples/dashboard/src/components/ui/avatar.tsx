import * as React from 'react'

import { cn } from '@/lib/utils'

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

interface AvatarImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  className?: string
}

interface AvatarFallbackProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)}
    {...props}
  />
))
Avatar.displayName = 'Avatar'

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(({ className, ...props }, ref) => (
  <img ref={ref} className={cn('aspect-square h-full w-full object-cover', className)} {...props} />
))
AvatarImage.displayName = 'AvatarImage'

const AvatarFallback = React.forwardRef<HTMLDivElement, AvatarFallbackProps>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'bg-muted text-muted-foreground flex h-full w-full items-center justify-center rounded-full',
      className,
    )}
    {...props}
  />
))
AvatarFallback.displayName = 'AvatarFallback'

export { Avatar, AvatarFallback, AvatarImage }
