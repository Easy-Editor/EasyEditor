import type { SetterProps } from '@easy-editor/core'
import { useEffect, useState } from 'react'

interface JsonSetterProps extends SetterProps<unknown> {
  readonly placeholder?: string
}

const stringify = (value: unknown): string => (value === undefined ? '' : JSON.stringify(value, null, 2))

const JsonSetter = ({ value, initialValue, onChange, placeholder }: JsonSetterProps) => {
  const externalValue = value === undefined ? initialValue : value
  const [draft, setDraft] = useState(() => stringify(externalValue))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setDraft(stringify(externalValue))
    setInvalid(false)
  }, [externalValue])

  return (
    <textarea
      aria-invalid={invalid}
      className='min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive'
      value={draft}
      placeholder={placeholder}
      onChange={event => {
        const next = event.target.value
        setDraft(next)
        if (!next.trim()) {
          setInvalid(false)
          onChange(undefined)
          return
        }
        try {
          onChange(JSON.parse(next))
          setInvalid(false)
        } catch {
          setInvalid(true)
        }
      }}
    />
  )
}

export default JsonSetter
