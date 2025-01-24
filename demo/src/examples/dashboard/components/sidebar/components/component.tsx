import { designer, simulator } from '@/examples/dashboard/editor'
import type { Snippet as ISnippet } from '@easy-editor/core'
import { observer } from 'mobx-react'
import React, { useEffect } from 'react'

const Snippet = ({ snippet }: { snippet: ISnippet }) => {
  const ref = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unlink = simulator.linkSnippet(ref.current!, snippet)
    return () => {
      unlink()
    }
  }, [snippet])

  return (
    <div ref={ref} className='p-3 rounded-md cursor-move text-center select-none'>
      {snippet?.title}
    </div>
  )
}

export const ComponentSidebar = observer(() => {
  const snippets = designer.componentMetaManager.getComponentSnippets()

  return (
    <div className='flex flex-col'>
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
