import { project } from '@easy-editor/core'
import { SettingRenderer } from '@easy-editor/react-renderer'
import { observer } from 'mobx-react'

const Right = observer(() => {
  return (
    <div className='w-72 bg-white border-l border-gray-200 flex flex-col'>
      <div className='p-4 border-b border-gray-200'>
        <h2 className='text-lg font-medium text-gray-700'>Property Setting</h2>
      </div>
      <SettingRenderer designer={project.designer} />
    </div>
  )
})

export default Right
