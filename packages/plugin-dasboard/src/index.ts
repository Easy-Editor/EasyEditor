import { DESIGNER_EVENT, DragObjectType, type DropLocation, type PluginCreator } from '@easy-editor/core'

declare module '@easy-editor/core' {
  interface Project {
    customExtend(name: string): void
    customExtend2(name: string): void
  }
}

const DashboardPlugin: PluginCreator = () => {
  return {
    name: 'DashboardPlugin',
    deps: [],
    init(ctx) {
      const { designer, logger, simulator } = ctx
      const startOffsetNodes: { [key: string]: { x: number; y: number } } = {}
      const startOffsetNodeData = { x: 0, y: 0 }

      designer.dragon.onDragstart(e => {
        const { dragObject } = e

        if (dragObject && dragObject.type === DragObjectType.Node) {
          for (const node of dragObject.nodes!) {
            if (!node) continue
            const rect = simulator.computeRect(node)
            if (rect) {
              startOffsetNodes[node.id] = { x: e.globalX - rect.x, y: e.globalY - rect.y }
            }
          }
        } else if (dragObject && dragObject.type === DragObjectType.NodeData) {
          startOffsetNodeData.x = e.globalX - e.target.offsetLeft
          startOffsetNodeData.y = e.globalY - e.target.offsetTop
        }
      })

      designer.dragon.onDrag(e => {
        if (e.dragObject && e.dragObject.type === DragObjectType.Node) {
          logger.log('drag', e)

          const nodes = e.dragObject.nodes!
          for (const node of nodes) {
            if (!node) continue
            const { x = 0, y = 0 } = startOffsetNodes[node.id]
            // TODO: 想一下名字，对应插件的可以放在特地的位置
            node?.setExtraProp('$.dashboard.position', { x: e.canvasX - x, y: e.canvasY - y })
          }
        }
      })

      designer.onEvent(DESIGNER_EVENT.INSERT_NODE_BEFORE, (e: DropLocation) => {
        const { event } = e
        const { dragObject } = event

        // add dashboard position
        if (dragObject && dragObject.type === DragObjectType.NodeData) {
          const nodeData = Array.isArray(dragObject.data) ? dragObject.data : [dragObject.data]
          for (const schema of nodeData) {
            if (!schema) continue
            if (!schema.$) {
              schema.$ = {}
            }
            if (!schema.$.dashboard) {
              schema.$.dashboard = {}
            }
            if (!schema.$.dashboard.position) {
              schema.$.dashboard.position = {}
            }
            schema.$.dashboard.position = {
              x: event.canvasX - startOffsetNodeData.x,
              y: event.canvasY - startOffsetNodeData.y,
            }
          }
        }
      })
    },
    extend(ctx) {
      const { Project } = ctx

      // 1
      Project.prototype.customExtend = function (name) {
        console.log('customExtend', name, this)
      }

      // 2
      Object.defineProperty(Project.prototype, 'customExtend2', {
        value: function (name) {
          console.log('customExtend2', name, this)
        },
      })

      console.log('extend', Project)
    },
  }
}

export default DashboardPlugin
