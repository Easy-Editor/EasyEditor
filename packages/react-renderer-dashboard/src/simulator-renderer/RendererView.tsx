import { DESIGNER_EVENT } from '@easy-editor/core/instance'
import { observer } from 'mobx-react'
import type React from 'react'
import { Component, type ReactInstance, createElement } from 'react'
import { unstable_HistoryRouter as HistoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import LowCodeRenderer from '../renderer-core'
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

export const SimulatorRendererView: React.FC<{
  simulatorRenderer: SimulatorRendererContainer
}> = props => {
  const { simulatorRenderer } = props
  return (
    <HistoryRouter history={simulatorRenderer.history as any}>
      <Layout simulatorRenderer={simulatorRenderer}>
        <RouteList simulatorRenderer={simulatorRenderer} />
      </Layout>
    </HistoryRouter>
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

const RouteList: React.FC<{
  simulatorRenderer: SimulatorRendererContainer
}> = props => {
  return (
    <Routes>
      <Route path='*' element={<DocumentRoute simulatorRenderer={props.simulatorRenderer} />} />
    </Routes>
  )
}

const DocumentRoute: React.FC<{
  simulatorRenderer: SimulatorRendererContainer
}> = observer(props => {
  const { simulatorRenderer } = props
  const { pathname } = useLocation()
  const { documentInstances, host } = simulatorRenderer
  const currentDocumentId = host.currentDocument?.id
  const documentInstance =
    documentInstances.find(instance => instance.path === pathname) ??
    documentInstances.find(instance => instance.document.id === currentDocumentId) ??
    documentInstances[0]

  if (!documentInstance) {
    return null
  }

  return (
    <Renderer
      key={documentInstance.document.id}
      documentInstance={documentInstance}
      simulatorRenderer={simulatorRenderer}
    />
  )
})

export const Renderer = observer(
  class Renderer extends Component<{
    documentInstance: DocumentInstance
    simulatorRenderer: SimulatorRendererContainer
  }> {
    startTime: number | null = null
    schemaChangedSymbol = false

    componentDidUpdate() {
      this.recordTime()
    }

    recordTime() {
      if (this.startTime) {
        const { host } = this.props.simulatorRenderer
        const time = Date.now() - this.startTime
        const nodeCount = host.currentDocument?.getNodeCount?.()
        host.designer.postEvent(DESIGNER_EVENT.NODE_RENDER, {
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
      const { documentInstance, simulatorRenderer: renderer } = this.props
      const { host } = renderer
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
          expressionEvaluator={container.context.expressionEvaluator}
          designMode={designMode}
          device={device}
          documentId={document.id}
          suspended={documentInstance.suspended}
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
          excuteLifeCycleInDesignMode={host.excuteLifeCycleInDesignMode}
        />
      )
    }
  },
)
