import { project } from '@easy-editor/core'
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { observer } from 'mobx-react'

const Center = observer(() => {
  return (
    <div className='flex-1 bg-gray-50 overflow-auto'>
      <div className='h-full box-border'>
        <SimulatorRenderer designer={project.designer} />
      </div>
    </div>
  )
})

export default Center
