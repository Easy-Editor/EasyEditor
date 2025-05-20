import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SetterProps } from '@easy-editor/core'

interface SelectSetterProps extends SetterProps<string> {
  options: { label: string; value: string; group?: boolean; items?: { label: string; value: string }[] }[]
  orientation?: 'horizontal' | 'vertical'
  placeholder?: string
}

const SelectSetter = (props: SelectSetterProps) => {
  const { value, onChange, initialValue, options, placeholder } = props

  return (
    <Select defaultValue={value || initialValue} onValueChange={onChange}>
      <SelectTrigger className='w-full text-xs h-8'>
        <SelectValue placeholder={placeholder || ''} />
      </SelectTrigger>
      <SelectContent>
        {options.map(item => {
          if (item.group) {
            return (
              <SelectGroup key={item.value}>
                <SelectLabel className='text-xs px-2'>{item.label}</SelectLabel>
                {item.items?.map(item => (
                  <SelectItem key={item.value} value={item.value} className='text-xs'>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )
          }
          return (
            <SelectItem key={item.value} value={item.value} className='text-xs'>
              {item.label}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

export default SelectSetter
