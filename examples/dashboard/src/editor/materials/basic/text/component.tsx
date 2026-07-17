import type { Ref } from 'react'
import {
  type DashboardRendererDataSource,
  resolveDashboardMaterialBinding,
  resolveDashboardText,
} from '../../../data/binding'

interface TextProps {
  ref: Ref<HTMLParagraphElement>
  text?: string
  dataBindings?: unknown
  __dataSource?: DashboardRendererDataSource
}

const Text = (props: TextProps) => {
  const { ref, text, dataBindings, __dataSource } = props
  const fallbackText = resolveDashboardText(text)
  const renderedText = resolveDashboardText(
    resolveDashboardMaterialBinding({
      bindingField: 'text',
      dataBindings,
      dataSource: __dataSource,
      fallback: fallbackText,
    }),
    fallbackText,
  )

  return (
    <p ref={ref} className='w-full h-full leading-7 [&:not(:first-child)]:mt-6'>
      {renderedText}
    </p>
  )
}

export default Text
