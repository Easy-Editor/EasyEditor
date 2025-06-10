import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { SetterProps } from '@easy-editor/core'
import Sketch from '@uiw/react-color-sketch'

interface ColorSetterProps extends SetterProps<string> {
  disableAlpha?: boolean
}

const ColorSetter = (props: ColorSetterProps) => {
  const { value, initialValue, onChange, disableAlpha = false } = props

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={'outline'}
          className={'w-full h-8 justify-start text-left font-normal text-xs gap-2 px-2 py-[5px] bg-transparent'}
          aria-label='Select color'
        >
          <div
            className='h-3.5 w-3.5 rounded-full border border-muted-foreground'
            style={{ backgroundColor: value ?? initialValue }}
            aria-label='Current color'
          />
          <span className='font-mono truncate'>{value ?? initialValue}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0' align='start'>
        <Sketch color={value} onChange={res => onChange(res.hexa)} disableAlpha={disableAlpha} presetColors={[]} />
      </PopoverContent>
    </Popover>
  )
}

export default ColorSetter
