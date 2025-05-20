import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { SetterProps } from '@easy-editor/core'
import { type PropsWithChildren, useMemo, useState } from 'react'

interface ToggleGroupSetterProps extends SetterProps<string>, PropsWithChildren {
  options?: { label: string; value: string }[]
}

const ToggleGroupSetter = (props: ToggleGroupSetterProps) => {
  const { initialValue, options, children } = props

  const optionsList = useMemo(() => {
    if (options) return options
    if (Array.isArray(children) && children.length > 0) {
      return children.map(child => ({ label: child.props.field.config.title, value: child.props.field.config.key }))
    }
    throw new Error('ToggleGroupSetter: children or options must be an array')
  }, [options, children])
  const firstOptionValue = useMemo(() => optionsList[0]?.value, [optionsList])
  const [value, setValue] = useState(initialValue ?? firstOptionValue)

  const renderChild = useMemo(() => {
    if (Array.isArray(children)) {
      return children.find(child => child.props.field.config.key === value)
    }
    return null
  }, [children, value])

  return (
    <div>
      <ToggleGroup
        type='single'
        value={value}
        defaultValue={initialValue ?? firstOptionValue}
        onValueChange={setValue}
        className='w-full text-xs border'
      >
        {optionsList.map(item => (
          <ToggleGroupItem
            key={item.value}
            value={item.value}
            className='flex-1 justify-center px-2 py-1 h-7 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground'
            title={item.label}
            aria-label={item.label}
          >
            {item?.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className='mt-4 space-y-4'>{renderChild}</div>
    </div>
  )
}

export default ToggleGroupSetter
