import { Switch } from '@/components/ui/switch'
import type { SetterProps } from '@easy-editor/core'

interface SwitchSetterProps extends SetterProps<boolean> {}

const SwitchSetter = (props: SwitchSetterProps) => {
  const { value, initialValue, onChange } = props

  return (
    <div className='py-0.5'>
      <Switch checked={value || initialValue} onCheckedChange={onChange} />
    </div>
  )
}

export default SwitchSetter
