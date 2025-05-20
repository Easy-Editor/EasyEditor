import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { SettingField } from '@easy-editor/core'
import type { ReactNode } from 'react'

export const customFieldItem = (field: SettingField, setter: ReactNode) => {
  const { label = true, wrap = false } = field.config.extraProps || {}

  if (typeof label === 'boolean' && !label) {
    return <div className='flex w-full items-center'>{setter}</div>
  }

  return (
    <div className={cn('flex w-full text-xs', wrap ? 'flex-col' : 'items-center ')}>
      <Label className={cn('text-xs shrink-0 grow-0', wrap ? 'basis-[26px]' : 'basis-[100px]')} htmlFor={field.id}>
        {field.title}
      </Label>
      <div className='flex-1 flex items-center justify-between'>
        <div className='flex-1'>{setter}</div>
      </div>
    </div>
  )
}
