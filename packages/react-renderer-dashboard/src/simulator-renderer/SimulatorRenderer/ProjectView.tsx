import { type Designer, config } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useEffect, useState } from 'react'
import Logo from '../../assets/logo.svg'
import { SimulatorView } from './SimulatorView'

import './loading.css'

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
      <div className='loading-logo-container'>
        <Logo className='breathing-logo' />
        <div className='loading-text'>LOADING</div>
      </div>
    </div>
  )
}
