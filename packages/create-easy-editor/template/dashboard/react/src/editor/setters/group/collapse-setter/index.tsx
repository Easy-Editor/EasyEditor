import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { SetterProps } from '@easy-editor/core'
import { ChevronsUpDown } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { useState } from 'react'

interface CollapseSetterProps extends SetterProps<boolean>, PropsWithChildren {
  icon?: boolean
}

const CollapseSetter = (props: CollapseSetterProps) => {
  const { field, children, initialValue, icon = true } = props
  const [isOpen, setIsOpen] = useState(initialValue ?? true)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className='w-[calc(100%_+_32px)] space-y-2 -translate-x-4'>
      <div className='flex items-center justify-between space-x-4 px-4 h-8 bg-muted'>
        <h4>{field.title}</h4>
        {icon && (
          <CollapsibleTrigger asChild>
            <Button variant='ghost' size='sm'>
              <ChevronsUpDown className='h-4 w-4' />
              <span className='sr-only'>Toggle</span>
            </Button>
          </CollapsibleTrigger>
        )}
      </div>
      <CollapsibleContent className='space-y-3 px-4 py-2'>{children}</CollapsibleContent>
    </Collapsible>
  )
}

export default CollapseSetter
