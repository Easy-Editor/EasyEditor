import {
  type ComponentInstance,
  DESIGNER_EVENT,
  type Designer,
  type Document,
  DragObjectType,
  type DropLocation,
  type Node,
  type OffsetObserver,
  type PluginCreator,
  type Simulator,
  getConvertedExtraKey,
} from '@easy-editor/core'
import { GuideLine } from './designer/guideline'
import { GroupComponent, GroupComponentMeta } from './materials/group'
import { updateNodeRect, updateNodeRectByDOM } from './utils'

interface DashboardPluginOptions {
  dndMode?: 'props' | 'dom'

  // TODO: 配置分组内容(schema、meta)
  xxx?: string
}

const groupSchema = {
  componentName: 'Group',
  title: '分组',
  isGroup: true,
}

const DashboardPlugin: PluginCreator<DashboardPluginOptions> = options => {
  const { dndMode = 'dom' } = options || {}

  return {
    name: 'DashboardPlugin',
    deps: [],
    init(ctx) {
      const { designer, simulator, componentMetaManager } = ctx

      // add guideline
      designer.onEvent(DESIGNER_EVENT.INIT, (designer: Designer) => {
        designer.guideline = new GuideLine(designer)
        console.log('🚀 ~ designer.onEvent ~ designer:', designer)
      })

      // add componentMeta
      componentMetaManager.createComponentMeta(GroupComponentMeta)
      simulator.addComponent('Group', GroupComponent)

      /* ---------------------------- NodeData to Node ---------------------------- */
      const startOffsetNodeData = { x: 0, y: 0 }

      designer.dragon.onDragstart(e => {
        const { dragObject } = e

        if (dragObject && dragObject.type === DragObjectType.NodeData) {
          startOffsetNodeData.x = e.globalX! - e.target!.offsetLeft
          startOffsetNodeData.y = e.globalY! - e.target!.offsetTop
        }
      })

      designer.onEvent(DESIGNER_EVENT.INSERT_NODE_BEFORE, (e: DropLocation) => {
        const { event } = e
        const { dragObject } = event

        // add dashboard rect
        if (dragObject && dragObject.type === DragObjectType.NodeData) {
          const nodeData = Array.isArray(dragObject.data) ? dragObject.data : [dragObject.data]
          for (const schema of nodeData) {
            if (!schema) continue
            if (!schema.$dashboard) {
              schema.$dashboard = {}
            }
            if (!schema.$dashboard.rect) {
              schema.$dashboard.rect = {}
            }
            schema.$dashboard.rect.x = event.canvasX! - startOffsetNodeData.x
            schema.$dashboard.rect.y = event.canvasY! - startOffsetNodeData.y
          }
        }
      })

      /* ----------------------------------- DND ---------------------------------- */
      let startNodes: { [key: string]: DOMRect } = {}
      let startOffsetNodes: { [key: string]: { x: number; y: number } } = {}
      let lastOffsetNodes: { [key: string]: { x: number; y: number } } = {}

      designer.dragon.onDragstart(e => {
        const { dragObject } = e

        if (dragObject && dragObject.type === DragObjectType.Node) {
          // 计算辅助线位置
          designer.guideline.calculateGuideLineInfo()

          for (const node of dragObject.nodes!) {
            if (!node) continue

            // 计算鼠标偏移量
            const rect = node.getDashboardRect()
            if (rect) {
              startNodes[node.id] = rect
              startOffsetNodes[node.id] = { x: e.canvasX! - rect.x, y: e.canvasY! - rect.y }
            }
          }

          // 计算整个拖拽包围盒的 Rect
          const boxRect = calculateDashboardRectBox(dragObject.nodes as Node[])
          if (boxRect) {
            startNodes.box = boxRect
            startOffsetNodes.box = { x: e.canvasX! - boxRect.x, y: e.canvasY! - boxRect.y }
          }
        }
      })

      designer.dragon.onDrag(e => {
        const { dragObject } = e
        if (dragObject && dragObject.type === DragObjectType.Node) {
          // 根据拖拽包围盒的 Rect 计算吸附位置
          const { x: boxStartX = 0, y: boxStartY = 0, width = 0, height = 0 } = startNodes.box
          const { x: boxX = 0, y: boxY = 0 } = startOffsetNodes.box
          const { isAdsorption, adsorb } = designer.guideline.getAdsorptionPosition(
            new DOMRect(e.canvasX! - boxX, e.canvasY! - boxY, width, height),
          )

          // 根据辅助线位置，计算对应吸附位置
          let adsorbX = undefined
          let adsorbY = undefined
          if (isAdsorption) {
            if (adsorb.x) {
              if (adsorb.x.adsorption === 0) {
                adsorbX = adsorb.x.position
              } else if (adsorb.x.adsorption === 1) {
                adsorbX = adsorb.x.position - width / 2
              } else if (adsorb.x.adsorption === 2) {
                adsorbX = adsorb.x.position - width
              }
            }
            if (adsorb.y) {
              if (adsorb.y.adsorption === 0) {
                adsorbY = adsorb.y.position
              } else if (adsorb.y.adsorption === 1) {
                adsorbY = adsorb.y.position - height / 2
              } else if (adsorb.y.adsorption === 2) {
                adsorbY = adsorb.y.position - height
              }
            }
          }

          for (const node of dragObject.nodes!) {
            if (!node) continue

            // 更新节点位置
            const { x: nodeStartX = 0, y: nodeStartY = 0 } = startNodes[node.id]
            const { x, y } = startOffsetNodes[node.id]
            let offsetX = e.canvasX! - x
            let offsetY = e.canvasY! - y

            if (isAdsorption) {
              // 吸附位置 需要减去拖拽包围盒的 Rect 的偏移量 得到节点吸附位置
              offsetX = adsorbX ? adsorbX + nodeStartX - boxStartX : offsetX
              offsetY = adsorbY ? adsorbY + nodeStartY - boxStartY : offsetY
            }
            updateNodeRectByDOM(node, { x: offsetX, y: offsetY })
            lastOffsetNodes[node.id] = { x: offsetX, y: offsetY }
          }
        }
      })

      designer.dragon.onDragend(e => {
        const { dragObject, esc } = e

        if (dragObject && dragObject.type === DragObjectType.Node) {
          for (const node of dragObject.nodes!) {
            if (!node) continue

            if (esc) {
              // dom 的话，因为没有更新内部节点值，所以直接重新渲染就行了
              simulator.rerender()
            } else {
              const { x: lastX = 0, y: lastY = 0 } = lastOffsetNodes[node.id]
              updateNodeRect(node, { x: lastX, y: lastY })
            }
          }

          // 清空辅助线
          designer.guideline.resetAdsorptionLines()
        }

        startNodes = {}
        startOffsetNodes = {}
        lastOffsetNodes = {}
      })
    },
    extend(ctx) {
      const { Document, Node, Simulator, OffsetObserver, Designer } = ctx

      /* -------------------------------- Designer -------------------------------- */
      const originalInit = Designer.prototype.init
      Object.defineProperties(Designer.prototype, {
        init: {
          value(this: Designer) {
            originalInit.call(this)

            this.guideline = new GuideLine(this)
          },
        },
      })

      /* -------------------------------- Document -------------------------------- */
      Object.defineProperties(Document.prototype, {
        group: {
          value(this: Document, nodeIdList: Node[] | string[]) {
            if (nodeIdList.length === 0) return

            let nodeList: Node[] = []
            if (typeof nodeIdList[0] === 'string') {
              nodeList = (nodeIdList as string[]).map(id => this.getNode(id)!)
            }

            const groupNode = this.createNode(groupSchema)

            // 计算所有节点的 index，确定分组的插入位置
            let maxZIndex = Number.POSITIVE_INFINITY
            for (const node of nodeList) {
              if (node.index < maxZIndex) {
                maxZIndex = node.index
              }
              if (node && !node.isRoot) {
                this.migrateNode(node, groupNode)
              }
            }

            this.rootNode?.insert(groupNode, maxZIndex)

            return groupNode
          },
        },
        ungroup: {
          value(this: Document, group: Node | string) {
            let groupNode: Node | null
            if (typeof group === 'string') {
              groupNode = this.getNode(group)
            } else {
              groupNode = group
            }

            if (!groupNode || !groupNode.isGroup || !groupNode.children) return

            const nodes = groupNode.childrenNodes
            // TODO: 这里写法很奇怪，因为children是响应式的，所以迁移之后，children也会更新
            while (nodes.length > 0) {
              if (groupNode.parent) {
                this.migrateNode(nodes[0], groupNode.parent)
              }
            }

            this.removeNode(groupNode)
          },
        },
      })

      /* ---------------------------------- Node ---------------------------------- */
      const originalInitProps = Node.prototype.initBuiltinProps
      Object.defineProperties(Node.prototype, {
        getDashboardContainer: {
          value(this: Node) {
            return document.getElementById(`${this.id}-mask`)
          },
        },
        getDashboardRect: {
          value(this: Node) {
            if (!this.isGroup) {
              const rect = this.getExtraPropValue('$dashboard.rect') as any
              return new DOMRect(rect.x ?? 0, rect.y ?? 0, rect.width ?? 0, rect.height ?? 0)
            }

            let [minX, minY, maxX, maxY] = [
              Number.POSITIVE_INFINITY,
              Number.POSITIVE_INFINITY,
              Number.NEGATIVE_INFINITY,
              Number.NEGATIVE_INFINITY,
            ]

            for (const child of this.childrenNodes) {
              const childRect = child.getDashboardRect()

              minX = Math.min(minX, childRect.x)
              minY = Math.min(minY, childRect.y)
              maxX = Math.max(maxX, childRect.x + childRect.width)
              maxY = Math.max(maxY, childRect.y + childRect.height)
            }

            return new DOMRect(minX, minY, maxX - minX, maxY - minY)
          },
        },
        updateDashboardRect: {
          value(this: Node, rect: Partial<DOMRect>) {
            if (this.isGroup) return

            if (typeof rect.x === 'number') {
              this.setExtraPropValue('$dashboard.rect.x', rect.x)
            }
            if (typeof rect.y === 'number') {
              this.setExtraPropValue('$dashboard.rect.y', rect.y)
            }
            if (typeof rect.width === 'number') {
              this.setExtraPropValue('$dashboard.rect.width', rect.width)
            }
            if (typeof rect.height === 'number') {
              this.setExtraPropValue('$dashboard.rect.height', rect.height)
            }
          },
        },
        isGroup: {
          get(this: Node) {
            return this.getExtraPropValue('isGroup')
          },
        },
        getCurrentGroup: {
          value(this: Node) {
            let parent = this.parent
            while (parent && !parent.isGroup) {
              parent = parent.parent
            }
            return parent
          },
        },
        getTopGroup: {
          value(this: Node) {
            let parent = this.parent
            let topGroup: Node | null = null
            while (parent) {
              if (parent.isGroup) {
                topGroup = parent
              }
              parent = parent.parent
            }
            return topGroup
          },
        },
        getAllGroups: {
          value(this: Node) {
            const groups: Node[] = []
            let parent = this.parent
            while (parent) {
              if (parent.isGroup) {
                groups.push(parent)
              }
              parent = parent.parent
            }
            return groups
          },
        },
        getNodesInGroup: {
          value(this: Node) {
            if (!this.isGroup) return []

            const nodes: Node[] = []
            for (const node of this.childrenNodes) {
              if (!node.isGroup) {
                nodes.push(node)
              }
            }
            return nodes
          },
        },
        getAllNodesInGroup: {
          value(this: Node) {
            if (!this.isGroup) return []

            const nodes: Node[] = []
            for (const node of this.childrenNodes) {
              if (node.isGroup) {
                nodes.push(...node.getAllNodesInGroup())
              } else {
                nodes.push(node)
              }
            }
            return nodes
          },
        },
        // override
        initBuiltinProps: {
          value(this: Node) {
            // 实现类似 super.initBuiltinProps 的效果
            // 调用父类的 initBuiltinProps 方法
            originalInitProps.call(this)

            this.props.has(getConvertedExtraKey('isGroup')) || this.props.add(getConvertedExtraKey('isGroup'), false)
          },
        },
      })

      /* -------------------------------- Simulator ------------------------------- */
      // TODO: 是否需要
      Object.defineProperties(Simulator.prototype, {
        computeDashboardRect: {
          value(this: Simulator, node: Node) {
            const instances = this.getComponentInstances(node)
            if (!instances) {
              return null
            }
            return this.computeComponentInstanceRect(instances[0])
          },
        },
        computeComponentInstanceDashboardRect: {
          value(this: Simulator, instance: ComponentInstance) {
            if (!instance || !instance.parentNode) return new DOMRect(0, 0, 0, 0)

            // const style = instance.parentNode.style
            const properties = getComputedStyle(instance.parentNode)
            return new DOMRect(
              Number.parseFloat(properties.left ?? 0),
              Number.parseFloat(properties.top ?? 0),
              Number.parseFloat(properties.width ?? 0),
              Number.parseFloat(properties.height ?? 0),
            )
          },
        },
      })

      /* ----------------------------- OffsetObserver ----------------------------- */
      Object.defineProperties(OffsetObserver.prototype, {
        computeRect: {
          value(this: OffsetObserver) {
            return this.node.getDashboardRect()
          },
        },
        height: {
          get(this: OffsetObserver) {
            return this.isRoot ? this.viewport.height : this._height
          },
        },
        width: {
          get(this: OffsetObserver) {
            return this.isRoot ? this.viewport.width : this._width
          },
        },
        top: {
          get(this: OffsetObserver) {
            return this.isRoot ? 0 : this._top
          },
        },
        left: {
          get(this: OffsetObserver) {
            return this.isRoot ? 0 : this._left
          },
        },
        bottom: {
          get(this: OffsetObserver) {
            return this.isRoot ? this.viewport.height : this._bottom
          },
        },
        right: {
          get(this: OffsetObserver) {
            return this.isRoot ? this.viewport.width : this._right
          },
        },
      })

      /* -------------------------------- Viewport -------------------------------- */
      /**
       * 这里需要对坐标转换的偏移做额外的处理，因为在大屏的使用中，外层画布容器使用到了 translate(-50%, -50%) 进行居中定位，但是
       * 在计算坐标的时候，需要减去这个偏移量，否则会导致坐标转换不准确
       */
      // Object.defineProperties(Viewport.prototype, {
      //   // 局部坐标 -> 缩放(×scale) -> 加上视口偏移(+rect.left/top) -> 减去居中偏移(-centerOffset) -> 全局坐标
      //   toGlobalPoint: {
      //     value(this: Viewport, point: Point) {
      //       if (!this.viewportElement) {
      //         return point
      //       }

      //       const rect = this.bounds
      //       const centerOffsetX = rect.width * 0.5
      //       const centerOffsetY = rect.height * 0.5

      //       return {
      //         clientX: point.clientX * this.scale + rect.left - centerOffsetX,
      //         clientY: point.clientY * this.scale + rect.top - centerOffsetY,
      //       }
      //     },
      //   },
      //   // 全局坐标 -> 减去视口偏移(-rect.left/top) -> 加上居中偏移(+centerOffset) -> 缩放还原(/scale) -> 局部坐标
      //   toLocalPoint: {
      //     value(this: Viewport, point: Point): Point {
      //       if (!this.viewportElement) {
      //         return point
      //       }

      //       const rect = this.bounds
      //       const centerOffsetX = rect.width * 0.5
      //       const centerOffsetY = rect.height * 0.5

      //       return {
      //         clientX: (point.clientX - rect.left + centerOffsetX) / this.scale,
      //         clientY: (point.clientY - rect.top + centerOffsetY) / this.scale,
      //       }
      //     },
      //   },
      // })
    },
  }
}

export default DashboardPlugin

/**
 * 计算节点的外围矩形 Rect，包括分支节点、多个节点计算
 * @param nodes 分组节点
 * @returns 外围矩形 {DOMRect}
 */
const calculateDashboardRectBox = (nodes: Node[]) => {
  let [minX, minY, maxX, maxY] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]

  for (const node of nodes) {
    const rect = node.getDashboardRect()
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  return new DOMRect(minX, minY, maxX - minX, maxY - minY)
}
