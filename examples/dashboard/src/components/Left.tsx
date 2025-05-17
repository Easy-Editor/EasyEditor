import { type Snippet as ISnippet, materials, project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useEffect, useRef } from 'react'

const Snippet = ({ snippet }: { snippet: ISnippet }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unlink = project.simulator?.linkSnippet(ref.current!, snippet)
    return () => {
      unlink?.()
    }
  }, [snippet])

  return (
    <div ref={ref} className='p-3 bg-gray-50 rounded-md cursor-move hover:bg-gray-100 text-center select-none'>
      {snippet?.title}
    </div>
  )
}

const Left = observer(() => {
  const snippets = materials.getComponentSnippets()

  return (
    <div className='w-64 bg-white border-r border-gray-200 flex flex-col'>
      <div className='p-4 border-b border-gray-200'>
        <h2 className='text-lg font-medium text-gray-700'>组件库</h2>
      </div>
      <div className='flex-1 overflow-y-auto p-4'>
        <div className='space-y-2'>
          {snippets.map(snippet => (
            <Snippet key={snippet?.title} snippet={snippet} />
          ))}
        </div>
      </div>
    </div>
  )
})

export default Left
