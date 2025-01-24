import type { SetterProps } from '@easy-editor/core'

interface StringSetterProps extends SetterProps<string> {
  placeholder: string
}

const StringSetter = (props: StringSetterProps) => {
  const { value, placeholder, onChange } = props

  return (
    <input
      value={value}
      placeholder={placeholder || ''}
      onChange={e => onChange(e.target.value)}
      style={{ width: '100%' }}
    />
  )
}

export default StringSetter
