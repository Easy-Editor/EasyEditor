import { DESIGNER_EVENT, type Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { Component, type ReactInstance } from 'react'
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

interface RendererViewProps {
  documentInstance: DocumentInstance
  simulatorRenderer: SimulatorRendererContainer
  host: Simulator
}

export const RendererView = observer(
  class RendererView extends Component<RendererViewProps> {
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
          suspended={!document._opened}
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
