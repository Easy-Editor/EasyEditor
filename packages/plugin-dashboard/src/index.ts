import {
  type ComponentMetadata,
  DESIGNER_EVENT,
  type Document,
  DragObjectType,
  type DropLocation,
  type Node,
  type NodeSchema,
  type OffsetObserver,
  type PluginCreator,
  type Simulator,
  getConvertedExtraKey,
} from '@easy-editor/core'
import { AlignType, Alignment, DistributeType } from './designer/alignment'
import { type AdsorptionLineInfo, type DistanceSegment, GuideLine, type UserGuideLineItem } from './designer/guideline'
import { type MarqueeEvent, type MarqueeRect, MarqueeSelection } from './designer/marquee-selection'
import { updateNodeRect, updateNodeRectByDOM } from './utils'

export * from './type'
export {
  AlignType,
  Alignment,
  DistributeType,
  GuideLine,
  updateNodeRect,
  updateNodeRectByDOM,
  type AdsorptionLineInfo,
  type DistanceSegment,
  type MarqueeEvent,
  type MarqueeRect,
  type UserGuideLineItem,
}

interface DashboardPluginOptions {
  /**
   * 分组组件，用于大屏设计。允许将多个组件组合在一起，便于整体管理和移动。
   */
  group: {
    /**
     * 分组元数据
     */
    meta: ComponentMetadata

    /**
     * 创建分组时的初始化 schema
     * @example
     * ```ts
     * {
     *   componentName: 'Group',
     *   title: '分组',
     *   isGroup: true,
     * }
     * ```
     */
    initSchema: NodeSchema
  }
}

const DashboardPlugin: PluginCreator<DashboardPluginOptions> = options => {
  const { group } = options || {}
  const { meta: groupMeta, initSchema: groupInitSchema } = group || {}

  if (!groupMeta || !groupInitSchema) {
    throw new Error('group meta and group init schema are required')
  }

  return {
    name: 'DashboardPlugin',
    deps: [],
    init(ctx) {
      const { materials, project } = ctx
      const { designer } = project

      // add group componentMeta
      materials.createComponentMeta(groupMeta)

      /* ---------------------------- NodeData to Node ---------------------------- */
      const startOffsetNodeData = { x: 0, y: 0 }

      designer.dragon.onDragstart(e => {
        if (!e.shell) return
        const { simulator } = project
        if (!simulator) return
        const { viewport } = simulator

        const { dragObject } = e
        const shellRect = simulator.computeComponentInstanceRect(e.shell)

        if (dragObject && dragObject.type === DragObjectType.NodeData) {
          startOffsetNodeData.x = (e.globalX! - shellRect?.left!) / viewport.scale
          startOffsetNodeData.y = (e.globalY! - shellRect?.top!) / viewport.scale
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
          const currentRect = new DOMRect(e.canvasX! - boxX, e.canvasY! - boxY, width, height)
          const { isAdsorption, adsorb } = designer.guideline.getAdsorptionPosition(currentRect)

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
        const { simulator } = project
        if (!simulator) return
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
    extend({ extendClass, extend }) {
      const { Node } = extendClass

      /* -------------------------------- Designer -------------------------------- */
      let guideline: GuideLine | null = null
      let alignment: Alignment | null = null
      let marqueeSelection: MarqueeSelection | null = null
      extend('Designer', {
        guideline: {
          get() {
            if (!guideline) {
              guideline = new GuideLine(this)
            }
            return guideline
          },
        },
        alignment: {
          get() {
            if (!alignment) {
              alignment = new Alignment(this)
            }
            return alignment
          },
        },
        marqueeSelection: {
          get() {
            if (!marqueeSelection) {
              marqueeSelection = new MarqueeSelection(this)
            }
            return marqueeSelection
          },
        },
      })

      /* -------------------------------- Document -------------------------------- */
      // TODO: group 和 ungroup 优化
      extend('Document', {
        group: {
          value(this: Document, nodeIdList: Node[] | string[]) {
            if (nodeIdList.length === 0) return

            let nodeList: Node[] = []
            if (typeof nodeIdList[0] === 'string') {
              nodeList = (nodeIdList as string[]).map(id => this.getNode(id)!)
            } else {
              nodeList = nodeIdList as Node[]
            }

            // 过滤无效节点
            nodeList = nodeList.filter(node => node && !node.isRoot)
            if (nodeList.length === 0) return

            // 获取共同父节点（使用第一个节点的父节点）
            const targetParent = nodeList[0].parent || this.rootNode

            const groupNode = this.createNode(groupInitSchema)

            // 计算所有节点的最小 index，确定分组的插入位置
            let minIndex = Number.POSITIVE_INFINITY
            for (const node of nodeList) {
              if (node.index < minIndex) {
                minIndex = node.index
              }
              this.migrateNode(node, groupNode)
            }

            // 将新分组插入到共同父节点下
            targetParent?.insert(groupNode, minIndex)

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

            const parent = groupNode.parent
            if (!parent) return

            // 记录分组的原始位置
            const groupIndex = groupNode.index
            const nodes = [...groupNode.childrenNodes] // 复制数组避免响应式问题

            // 将子节点迁移到父节点，并保持在原分组位置
            for (let i = 0; i < nodes.length; i++) {
              this.migrateNode(nodes[i], parent)
            }

            this.removeNode(groupNode)
          },
        },
      })

      /* ---------------------------------- Node ---------------------------------- */
      const originalInitProps = Node.prototype.initBuiltinProps
      extend('Node', {
        // Dashboard
        getDashboardContainer: {
          value(this: Node) {
            const domNodes = this.getDOMNode()
            return domNodes.length > 0 ? domNodes[0] : null
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
        // Group
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
        initBuiltinProps: {
          value(this: Node) {
            // 实现类似 super.initBuiltinProps 的效果
            // 调用父类的 initBuiltinProps 方法
            originalInitProps.call(this)

            this.props.has(getConvertedExtraKey('isGroup')) || this.props.add(getConvertedExtraKey('isGroup'), false)
          },
        },
        // Level
        moveToLevel: {
          value(this: Node, level: number) {
            if (level < -1 || level >= this.parent!.childrenNodes.length) return
            if (this.index === level) return
            if (this.isRoot) return

            this.parent!.insert(this, level)
          },
        },
        levelTop: {
          value(this: Node) {
            this.moveToLevel(0)
          },
        },
        levelBottom: {
          value(this: Node) {
            this.moveToLevel(-1)
          },
        },
        levelUp: {
          value(this: Node) {
            this.moveToLevel(this.index - 1)
          },
        },
        levelDown: {
          value(this: Node) {
            this.moveToLevel(this.index + 1)
          },
        },
      })

      /* ----------------------------- OffsetObserver ----------------------------- */
      extend('OffsetObserver', {
        computeRect: {
          value(this: OffsetObserver) {
            // return this.node.getDashboardRect()
            const { node, instance } = this.nodeInstance
            const host = node.document?.simulator!
            const rect = host.computeComponentInstanceRect(instance!)

            const { viewport } = node.document.simulator!
            const local = viewport.toLocalPoint({ clientX: rect!.x, clientY: rect!.y })

            return new DOMRect(
              local.clientX,
              local.clientY,
              rect!.width / viewport.scale,
              rect!.height / viewport.scale,
            )
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

      /* -------------------------------- Simulator ------------------------------- */
      extend('Simulator', {
        getDashboardStyle: {
          get(this: Simulator) {
            return this.get('dashboardStyle') || {}
          },
        },
      })
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
