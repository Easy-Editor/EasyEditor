import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { SetterProps } from '@easy-editor/core'

interface NumberSetterProps extends SetterProps<number> {
  placeholder?: string
  suffix?: string
}

const NumberSetter = (props: NumberSetterProps) => {
  const { value, initialValue, placeholder, onChange, suffix } = props

  return (
    <div className='relative w-full'>
      <Input
        type='number'
        className={cn(
          'h-8 !text-xs px-2 py-[5px] pr-8 [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
          suffix && 'pr-8',
        )}
        placeholder={placeholder || ''}
        value={value ?? initialValue}
        onChange={e => onChange(+e.target.value)}
      />
      {suffix && (
        <span
          className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none'
          aria-label={`Unit: ${suffix}`}
        >
          {suffix}
        </span>
      )}
    </div>
  )
}

export default NumberSetter
