import { components } from '@/editor/materials'
import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import { Renderer } from '@easy-editor/react-renderer-form'
import { useEffect, useRef, useState } from 'react'

const Preview = () => {
  const [schema, setSchema] = useState<any>(null)
  const pageInfoRef = useRef(getPageInfoFromLocalStorage())

  const navigate = (path?: string) => {
    const pageInfo = pageInfoRef.current
    if (pageInfo.length === 0) {
      console.warn('pageInfo is empty')
      return
    }

    const pageSchema = getPageSchemaFromLocalStorage(path || pageInfo[0].path)
    if (!pageSchema) {
      console.warn('pageSchema is empty')
      return
    }

    setSchema(pageSchema?.componentsTree[0])
    console.log(pageInfo, pageSchema)
  }

  useEffect(() => {
    navigate()
  }, [])

  return (
    <div className='h-full w-full'>
      {schema ? (
        <Renderer schema={schema} components={components} viewport={{ width: 800, height: 600 }} />
      ) : (
        <div className='flex h-full w-full items-center justify-center'>
          <div className='text-sm text-muted-foreground'>loading...</div>
        </div>
      )}
    </div>
  )
}

export default Preview
