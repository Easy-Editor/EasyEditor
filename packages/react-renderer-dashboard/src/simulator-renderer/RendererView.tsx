import { DESIGNER_EVENT, type Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import type React from 'react'
import { Component, type ReactInstance, createElement } from 'react'
import { RouterProvider } from 'react-router'
import { LowCodeRenderer } from '../renderer'
import type { DocumentInstance } from './document-instance'
import type { SimulatorRendererContainer } from './simulator-renderer'

/**
 * judges if current simulator renderer detached or not
 * @returns detached or not
 */
export function isRendererDetached() {
  // if current iframe detached from host document, the `window.parent` will be undefined.
  return !window.parent
}

const SimulatorRendererView: React.FC<{
  simulatorRenderer: SimulatorRendererContainer
}> = props => {
  const { simulatorRenderer } = props
  return (
    <Layout simulatorRenderer={simulatorRenderer}>
      <RouterProvider router={simulatorRenderer.router} />
    </Layout>
  )
}

const Layout: React.FC<
  {
    simulatorRenderer: SimulatorRendererContainer
  } & React.PropsWithChildren
> = observer(props => {
  const { simulatorRenderer, children } = props
  const { layout } = simulatorRenderer

  if (layout) {
    const { Component, props, componentName } = layout
    if (Component) {
      return (
        <Component key='layout' props={props}>
          {children}
        </Component>
      )
    }
    if (componentName && simulatorRenderer.getComponent(componentName)) {
      return createElement(
        simulatorRenderer.getComponent(componentName)!,
        {
          ...props,
          key: 'layout',
        },
        [children],
      )
    }
  }

  return <>{children}</>
})

const Routes: React.FC<{
  simulatorRenderer: SimulatorRendererContainer
}> = props => {
  const { simulatorRenderer } = props
  return <Routes></Routes>
}

export const Renderer = observer(
  class Renderer extends Component<{
    documentInstance: DocumentInstance
    simulatorRenderer: SimulatorRendererContainer
    host: Simulator
  }> {
    startTime: number | null = null
    schemaChangedSymbol = false

    componentDidUpdate() {
      this.recordTime()
    }

    recordTime() {
      if (this.startTime) {
        const time = Date.now() - this.startTime
        const nodeCount = this.props.host.currentDocument?.getNodeCount?.()
        this.props.host.designer.postEvent(DESIGNER_EVENT.NODE_RENDER, {
          componentName: 'Renderer',
          type: 'All',
          time,
          nodeCount,
        })
      }
    }

    componentDidMount() {
      this.recordTime()
    }

    getSchemaChangedSymbol = () => {
      return this.schemaChangedSymbol
    }

    setSchemaChangedSymbol = (symbol: boolean) => {
      this.schemaChangedSymbol = symbol
    }

    render() {
      const { documentInstance, simulatorRenderer: renderer, host } = this.props
      const { container, document } = documentInstance
      const { designMode, device } = container
      this.startTime = Date.now()
      this.schemaChangedSymbol = false

      if (!container.autoRender || isRendererDetached()) {
        return null
      }

      return (
        <LowCodeRenderer
          schema={documentInstance.schema}
          components={container.components}
          appHelper={container.context}
          designMode={designMode}
          device={device}
          documentId={document.id}
          // suspended={!document._opened}
          suspended={renderer.suspended}
          self={renderer.scope}
          getSchemaChangedSymbol={this.getSchemaChangedSymbol}
          setSchemaChangedSymbol={this.setSchemaChangedSymbol}
          getNode={(id: string) => documentInstance.getNode(id)!}
          rendererName='PageRenderer'
          notFoundComponent={host.notFoundComponent}
          faultComponent={host.faultComponent}
          __host={host}
          __container={container}
          onCompGetRef={(schema: any, ref: ReactInstance | null) => {
            documentInstance.mountInstance(schema.id, ref)
          }}
          enableStrictNotFoundMode={host.enableStrictNotFoundMode}
        />
      )
    }
  },
)
