import { dashboardExpressionEvaluator } from '@/editor/expression-policy'
import { components } from '@/editor/materials'
import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import { resolveTrustPolicy, validateProjectSchema } from '@easy-editor/core/instance'
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { useEffect, useRef, useState } from 'react'

const Preview = () => {
  const [schema, setSchema] = useState<any>(null)
  const pageInfoRef = useRef(getPageInfoFromLocalStorage())

  useEffect(() => {
    const pageInfo = pageInfoRef.current
    if (pageInfo.length === 0) {
      console.warn('pageInfo is empty')
      return
    }

    const pageSchema = getPageSchemaFromLocalStorage(pageInfo[0].path)
    if (!pageSchema) {
      console.warn('pageSchema is empty')
      return
    }

    const validatedSchema = validateProjectSchema(pageSchema, resolveTrustPolicy('legacyTrusted'))
    setSchema(validatedSchema.componentsTree[0])
  }, [])

  return (
    <div className='h-full w-full'>
      {schema ? (
        <Renderer
          schema={schema}
          components={components}
          expressionEvaluator={dashboardExpressionEvaluator}
          viewport={{ width: 1920, height: 1080 }}
        />
      ) : (
        <div className='flex h-full w-full items-center justify-center'>
          <div className='text-sm text-muted-foreground'>loading...</div>
        </div>
      )}
    </div>
  )
}

export default Preview
