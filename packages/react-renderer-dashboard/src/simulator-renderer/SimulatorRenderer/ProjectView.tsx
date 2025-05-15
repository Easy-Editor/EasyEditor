import { type Designer, config } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useEffect, useState } from 'react'
import { SimulatorView } from './SimulatorView'

interface ProjectViewProps {
  designer: Designer
}

export const ProjectView: React.FC<ProjectViewProps> = observer(props => {
  const { designer } = props
  const { project, projectSimulatorProps: simulatorProps } = designer
  const [isReady, setIsReady] = useState(false)
  const Loading = config.get('loadingComponent', BuiltinLoading)

  useEffect(() => {
    project.onRendererReady(() => {
      setIsReady(true)
    })
  }, [project])

  return (
    <div className='lc-project'>
      <div className='lc-simulator-shell'>
        {(!isReady || !project?.simulator?.renderer) && <Loading />}
        <SimulatorView {...simulatorProps} />
      </div>
    </div>
  )
})

export const BuiltinLoading = () => {
  return (
    <div id='engine-loading-wrapper'>
      <img
        width='154'
        height='100'
        src='https://img.alicdn.com/tfs/TB1CmVgayERMeJjy0FcXXc7opXa-308-200.gif'
        alt='loading'
      />
    </div>
  )
}
