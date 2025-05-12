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
        width: '100%',
        height: '50px',
        lineHeight: '50px',
        textAlign: 'center',
        fontSize: '15px',
        color: '#eab308',
        border: '2px solid #eab308',
      }}
    >
      {/* {children || `${componentName} Component Not Found`} */}
      {`${componentName} Component Not Found`}
    </div>
  )
}

export default NotFoundComponent
