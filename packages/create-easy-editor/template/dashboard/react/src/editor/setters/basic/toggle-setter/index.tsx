import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { SetterProps } from '@easy-editor/core'
import type React from 'react'

interface ToggleSetterProps extends SetterProps<string> {
  options: { label: string; value: string; icon?: React.ReactNode }[]
}

const ToggleSetter = (props: ToggleSetterProps) => {
  const { value, onChange, initialValue, options } = props

  return (
    <ToggleGroup type='single' value={value || initialValue} onValueChange={onChange} className='w-full text-xs border'>
      {options.map(item => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          className='flex-1 justify-center px-2 py-1 h-7 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground'
          title={item.label}
          aria-label={item.label}
        >
          {item.icon ?? item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export default ToggleSetter
