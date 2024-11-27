import { cn } from '@/lib/utils'
import { MainNav } from './main-nav'
import { Button } from './ui/button'

export function SiteHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        'w-full border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 dark:border-border',
        className,
      )}
    >
      <div className='flex h-[var(--site-header-height)] items-center px-4'>
        <MainNav />
        <div className='flex flex-1 items-center justify-between gap-2 md:justify-end'>
          <div className='w-full flex-1 md:w-auto md:flex-none'>
            <div className='flex items-center gap-2'>
              <Button variant='outline'>预览</Button>
              <Button variant='outline'>保存</Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
