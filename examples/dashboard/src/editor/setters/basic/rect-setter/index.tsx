import { Input } from '@/components/ui/input'
import type { SetterProps } from '@easy-editor/core'

interface RectSetterProps extends SetterProps<DOMRect> {}

const RectSetter = (props: RectSetterProps) => {
  const { value, onChange } = props

  const handleChange = (key: keyof DOMRect, newValue: number) => {
    onChange({ ...value, [key]: newValue })
  }

  return (
    <div className='w-full flex flex-wrap gap-2'>
      <div className='relative w-[calc(50%_-_4px)]'>
        <Input
          className='h-8 !text-xs px-2 py-[5px] pr-8 [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
          type='number'
          value={formatDecimal(value.x)}
          onChange={e => handleChange('x', Number(e.target.value))}
        />
        <span
          className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none'
          aria-label={'Unit: X'}
        >
          X
        </span>
      </div>
      <div className='relative w-[calc(50%_-_4px)]'>
        <Input
          className='h-8 !text-xs px-2 py-[5px] pr-8 [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
          type='number'
          value={formatDecimal(value.y)}
          onChange={e => handleChange('y', Number(e.target.value))}
        />
        <span
          className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none'
          aria-label={'Unit: Y'}
        >
          Y
        </span>
      </div>
      <div className='relative w-[calc(50%_-_4px)]'>
        <Input
          className='h-8 !text-xs px-2 py-[5px] pr-8 [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
          type='number'
          value={formatDecimal(value.width)}
          onChange={e => handleChange('width', Number(e.target.value))}
        />
        <span
          className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none'
          aria-label={'Unit: W'}
        >
          W
        </span>
      </div>
      <div className='relative w-[calc(50%_-_4px)]'>
        <Input
          className='h-8 !text-xs px-2 py-[5px] pr-8 [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
          type='number'
          value={formatDecimal(value.height)}
          onChange={e => handleChange('height', Number(e.target.value))}
        />
        <span
          className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none'
          aria-label={'Unit: H'}
        >
          H
        </span>
      </div>
    </div>
  )
}

export default RectSetter

const formatDecimal = (num: number) => {
  return num.toString().replace(/(\.\d{2})\d+$/, '$1')
}
