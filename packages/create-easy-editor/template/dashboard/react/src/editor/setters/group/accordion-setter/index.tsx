import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import type { SetterProps } from '@easy-editor/core'
import type { PropsWithChildren } from 'react'

interface AccordionSetterProps extends SetterProps<string>, PropsWithChildren {
  disabled?: boolean
  dir?: 'ltr' | 'rtl'
  orientation?: 'horizontal' | 'vertical'
}

const AccordionSetter = (props: AccordionSetterProps) => {
  const { field, children, initialValue, disabled = false, dir = 'ltr', orientation = 'vertical' } = props

  return (
    <Accordion
      type='single'
      defaultValue={initialValue ? String(initialValue) : ''}
      dir={dir}
      disabled={disabled}
      orientation={orientation}
      className='w-full'
      collapsible
    >
      <AccordionItem value={field.id}>
        <AccordionTrigger className='text-xs font-bold py-0 pb-3'>{field.title}</AccordionTrigger>
        <AccordionContent className='space-y-3'>{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

export default AccordionSetter
