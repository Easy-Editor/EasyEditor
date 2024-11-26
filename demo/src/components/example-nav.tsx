import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Link, useLocation } from 'react-router-dom'

const examples = [
  {
    name: 'Dashboard',
    href: '/',
  },
]

interface ExamplesNavProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ExamplesNav({ className, ...props }: ExamplesNavProps) {
  const pathname = useLocation().pathname

  return (
    <div className='relative'>
      <ScrollArea className='max-w-[600px] lg:max-w-none'>
        <div className={cn('mb-4 flex items-center', className)} {...props}>
          {examples.map(example => (
            <Link
              key={example.name}
              to={example.href}
              className={cn(
                'flex h-7 items-center justify-center rounded-full px-4 text-center text-sm transition-colors hover:text-primary',
                example.href === pathname ? 'bg-muted font-medium text-primary' : 'text-muted-foreground',
              )}
            >
              {example.name}
            </Link>
          ))}
        </div>
        <ScrollBar orientation='horizontal' className='invisible' />
      </ScrollArea>
    </div>
  )
}
