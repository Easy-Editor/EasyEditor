import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { SetterProps } from '@easy-editor/core'

interface StringSetterProps extends SetterProps<string> {
  placeholder?: string
  suffix?: string
}

const StringSetter = (props: StringSetterProps) => {
  const { value, initialValue, placeholder, onChange, suffix } = props

  return (
    <div className='relative w-full'>
      <Input
        value={value || initialValue}
        placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)}
        className={cn('h-8 !text-xs px-2 py-[5px]', suffix && 'pr-8')}
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

export default StringSetter
