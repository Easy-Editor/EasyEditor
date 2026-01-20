import { type NotFoundComponentProps, logger } from '@easy-editor/renderer-core'
import type { FC } from 'react'

const NotFoundComponent: FC<NotFoundComponentProps> = ({ componentName = '', enableStrictNotFoundMode, children }) => {
  logger.warn(`Component ${componentName} not found`)

  if (enableStrictNotFoundMode) {
    return <>{`${componentName} Component Not Found`}</>
  }

  return (
    <div
      role='alert'
      aria-label={`${componentName} component not found`}
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        textAlign: 'center',
        fontSize: '15px',
        color: '#eab308',
        border: '2px solid #eab308',
      }}
    >
      <span>{`${componentName} Component Not Found`}</span>
    </div>
  )
}

export default NotFoundComponent
