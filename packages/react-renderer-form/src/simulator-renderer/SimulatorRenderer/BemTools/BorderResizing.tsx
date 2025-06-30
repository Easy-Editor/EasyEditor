import type { Designer, Node, Rect, Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { Component } from 'react'
import DragResizeEngine, { Direction } from './drag-resize-engine'
import { calculateDashboardRectBox } from './utils'

/** resize 的最小宽度 */
const RESIZE_MIN_WIDTH = 50
/** resize 的最小高度 */
const RESIZE_MIN_HEIGHT = 50

/**
 * 计算 resize 后的 rect
 * @param designer
 * @param direction 方向
 * @param delta 偏移量
 * @param startNodeRect 拖拽开始时的 rect
 */
const calculateResizeRectByDirection = (
  designer: Designer,
  direction: Direction,
  delta: { x: number; y: number },
  startNodeRect: Rect,
) => {
  let adsorption: ReturnType<typeof designer.guideline.getAdsorptionPosition>
  const newRect = {
    width: startNodeRect.width,
    height: startNodeRect.height,
    x: startNodeRect.x,
    y: startNodeRect.y,
  }

  switch (direction) {
    case Direction.N:
      newRect.height = startNodeRect.height - delta.y
      newRect.y = startNodeRect.y + delta.y

      // 计算吸附位置
      adsorption = designer.guideline.getAdsorptionPosition(
        new DOMRect(newRect.x, newRect.y, newRect.width, newRect.height),
        0,
      )
      if (adsorption.isAdsorption) {
        if (adsorption.adsorb.y) {
          newRect.y = adsorption.adsorb.y.position
          newRect.height = startNodeRect.height - (newRect.y - startNodeRect.y)
        }
      }

      // 限制缩放最小宽高
      if (newRect.height < RESIZE_MIN_HEIGHT) {
        newRect.height = RESIZE_MIN_HEIGHT
        newRect.y = startNodeRect.y + startNodeRect.height - RESIZE_MIN_HEIGHT
      }
      break
    case Direction.S:
      newRect.height = startNodeRect.height + delta.y

      // 计算吸附位置
      adsorption = designer.guideline.getAdsorptionPosition(
        new DOMRect(newRect.x, newRect.y, newRect.width, newRect.height),
        2,
      )
      if (adsorption.isAdsorption) {
        if (adsorption.adsorb.y) {
          newRect.height = adsorption.adsorb.y.position - newRect.y
        }
      }

      // 限制缩放最小宽高
      if (newRect.height < RESIZE_MIN_HEIGHT) {
        newRect.height = RESIZE_MIN_HEIGHT
      }
      break
    case Direction.W:
      newRect.width = startNodeRect.width - delta.x
      newRect.x = startNodeRect.x + delta.x

      // 计算吸附位置
      adsorption = designer.guideline.getAdsorptionPosition(
        new DOMRect(newRect.x, newRect.y, newRect.width, newRect.height),
        0,
      )
      if (adsorption.isAdsorption) {
        if (adsorption.adsorb.x) {
          newRect.x = adsorption.adsorb.x.position
          newRect.width = startNodeRect.width - (newRect.x - startNodeRect.x)
        }
      }

      // 限制缩放最小宽高
      if (newRect.width < RESIZE_MIN_WIDTH) {
        newRect.width = RESIZE_MIN_WIDTH
        newRect.x = startNodeRect.x + startNodeRect.width - RESIZE_MIN_WIDTH
      }
      break
    case Direction.E:
      newRect.width = startNodeRect.width + delta.x

      // 计算吸附位置
      adsorption = designer.guideline.getAdsorptionPosition(
        new DOMRect(newRect.x, newRect.y, newRect.width, newRect.height),
        2,
      )
      if (adsorption.isAdsorption) {
        if (adsorption.adsorb.x) {
          newRect.width = adsorption.adsorb.x.position - newRect.x
        }
      }

      // 限制缩放最小宽高
      if (newRect.width < RESIZE_MIN_WIDTH) {
        newRect.width = RESIZE_MIN_WIDTH
      }
      break
    case Direction.NW:
      newRect.x = startNodeRect.x + delta.x
      newRect.width = startNodeRect.width - delta.x
      newRect.y = startNodeRect.y + delta.y
      newRect.height = startNodeRect.height - delta.y

      // 计算吸附位置
      adsorption = designer.guideline.getAdsorptionPosition(
        new DOMRect(newRect.x, newRect.y, newRect.width, newRect.height),
        0,
      )
      if (adsorption.isAdsorption) {
        if (adsorption.adsorb.x) {
          newRect.x = adsorption.adsorb.x.position
          newRect.width = startNodeRect.width - (newRect.x - startNodeRect.x)
        }
        if (adsorption.adsorb.y) {
          newRect.y = adsorption.adsorb.y.position
          newRect.height = startNodeRect.height - (newRect.y - startNodeRect.y)
        }
      }

      // 限制缩放最小宽高
      if (newRect.width < RESIZE_MIN_WIDTH) {
        newRect.width = RESIZE_MIN_WIDTH
        newRect.x = startNodeRect.x + startNodeRect.width - RESIZE_MIN_WIDTH
      }
      if (newRect.height < RESIZE_MIN_HEIGHT) {
        newRect.height = RESIZE_MIN_HEIGHT
        newRect.y = startNodeRect.y + startNodeRect.height - RESIZE_MIN_HEIGHT
      }
      break
    case Direction.NE:
      newRect.width = startNodeRect.width + delta.x
      newRect.height = startNodeRect.height - delta.y
      newRect.y = startNodeRect.y + delta.y

      // 计算吸附位置
      adsorption = designer.guideline.getAdsorptionPosition(
        new DOMRect(newRect.x, newRect.y, newRect.width, newRect.height),
        [0, 2],
      )
      if (adsorption.isAdsorption) {
        if (adsorption.adsorb.x && adsorption.adsorb.x.position > newRect.x) {
          newRect.width = adsorption.adsorb.x.position - newRect.x
        }
        if (adsorption.adsorb.y && adsorption.adsorb.y.position <= newRect.y) {
          newRect.y = adsorption.adsorb.y.position
          newRect.height = startNodeRect.height - (newRect.y - startNodeRect.y)
        }
      }

      // 限制缩放最小宽高
      if (newRect.width < RESIZE_MIN_WIDTH) {
        newRect.width = RESIZE_MIN_WIDTH
      }
      if (newRect.height < RESIZE_MIN_HEIGHT) {
        newRect.height = RESIZE_MIN_HEIGHT
        newRect.y = startNodeRect.y + startNodeRect.height - RESIZE_MIN_HEIGHT
      }
      break
    case Direction.SE:
      newRect.width = startNodeRect.width + delta.x
      newRect.height = startNodeRect.height + delta.y

      // 计算吸附位置
      adsorption = designer.guideline.getAdsorptionPosition(
        new DOMRect(newRect.x, newRect.y, newRect.width, newRect.height),
        2,
      )
      if (adsorption.isAdsorption) {
        if (adsorption.adsorb.x && adsorption.adsorb.x.position > newRect.x) {
          newRect.width = adsorption.adsorb.x.position - newRect.x
        }
        if (adsorption.adsorb.y && adsorption.adsorb.y.position > newRect.y) {
          newRect.height = adsorption.adsorb.y.position - newRect.y
        }
      }

      // 限制缩放最小宽高
      if (newRect.width < RESIZE_MIN_WIDTH) {
        newRect.width = RESIZE_MIN_WIDTH
      }
      if (newRect.height < RESIZE_MIN_HEIGHT) {
        newRect.height = RESIZE_MIN_HEIGHT
      }
      break
    case Direction.SW:
      newRect.x = startNodeRect.x + delta.x
      newRect.width = startNodeRect.width - delta.x
      newRect.height = startNodeRect.height + delta.y
      // 计算吸附位置
      adsorption = designer.guideline.getAdsorptionPosition(
        new DOMRect(newRect.x, newRect.y, newRect.width, newRect.height),
        [0, 2],
      )
      if (adsorption.isAdsorption) {
        if (adsorption.adsorb.x && adsorption.adsorb.x.position <= newRect.x) {
          newRect.x = adsorption.adsorb.x.position
          newRect.width = startNodeRect.width - (newRect.x - startNodeRect.x)
        }
        if (adsorption.adsorb.y && adsorption.adsorb.y.position > newRect.y) {
          newRect.height = adsorption.adsorb.y.position - newRect.y
        }
      }

      // 限制缩放最小宽高
      if (newRect.width < RESIZE_MIN_WIDTH) {
        newRect.width = RESIZE_MIN_WIDTH
        newRect.x = startNodeRect.x + startNodeRect.width - RESIZE_MIN_WIDTH
      }
      if (newRect.height < RESIZE_MIN_HEIGHT) {
        newRect.height = RESIZE_MIN_HEIGHT
      }
      break
  }

  return new DOMRect(newRect.x, newRect.y, newRect.width, newRect.height)
}

interface BorderResizingInstanceProps {
  node: Node
  highlight?: boolean
  dragging?: boolean
  designer: Designer
}

const BorderResizingInstance = observer(
  class BoxResizingInstance extends Component<BorderResizingInstanceProps> {
    private willUnbind: () => any

    // outline of eight direction
    private resizeBorderN: any
    private resizeBorderE: any
    private resizeBorderS: any
    private resizeBorderW: any
    private resizeCornerNE: any
    private resizeCornerNW: any
    private resizeCornerSE: any
    private resizeCornerSW: any

    private dragEngine: DragResizeEngine

    constructor(props: BorderResizingInstanceProps) {
      super(props)
      this.dragEngine = new DragResizeEngine(props.designer)
    }

    /**
     * 计算 resize 后的 rect
     * @param node 节点
     * @param direction 方向
     * @param delta 偏移量
     * @param startNodeRect 拖拽开始时的 rect
     */
    private updateResizeRectByDirection(
      node: Node,
      direction: Direction,
      delta: { x: number; y: number },
      startNodeRect: Rect,
    ) {
      const resizeRect = calculateResizeRectByDirection(this.props.designer, direction, delta, startNodeRect)

      switch (direction) {
        case Direction.N:
          node.updateDashboardRect({
            y: resizeRect.y,
            height: resizeRect.height,
          })
          break
        case Direction.S:
          node.updateDashboardRect({
            height: resizeRect.height,
          })
          break
        case Direction.W:
          node.updateDashboardRect({
            x: resizeRect.x,
            width: resizeRect.width,
          })
          break
        case Direction.E:
          node.updateDashboardRect({
            width: resizeRect.width,
          })
          break
        case Direction.NW:
          node.updateDashboardRect({
            x: resizeRect.x,
            y: resizeRect.y,
            width: resizeRect.width,
            height: resizeRect.height,
          })
          break
        case Direction.NE:
          node.updateDashboardRect({
            y: resizeRect.y,
            width: resizeRect.width,
            height: resizeRect.height,
          })
          break
        case Direction.SE:
          node.updateDashboardRect({
            width: resizeRect.width,
            height: resizeRect.height,
          })
          break
        case Direction.SW:
          node.updateDashboardRect({
            x: resizeRect.x,
            width: resizeRect.width,
            height: resizeRect.height,
          })
          break
      }

      // 如果是分组的话，还需要更新子节点的位置和大小
      if (node.isGroup) {
        // 根据分组的缩放大小计算，缩放比例
        const ratioWidth = resizeRect.width / startNodeRect.width
        const ratioHeight = resizeRect.height / startNodeRect.height

        for (const child of node.getAllNodesInGroup()) {
          // 子节点根据新的缩放比例重新计算位置
          const childRect = child.getDashboardRect()
          child.updateDashboardRect({
            x: resizeRect.x + (childRect.x - startNodeRect.x) * ratioWidth,
            y: resizeRect.y + (childRect.y - startNodeRect.y) * ratioHeight,
            width: childRect.width * ratioWidth,
            height: childRect.height * ratioHeight,
          })
        }
      }
    }

    /**
     * 计算 resize 后的 rect 通过 DOM 计算
     * @param node 节点
     * @param direction 方向
     * @param delta 偏移量
     * @param startNodeRect 拖拽开始时的 rect
     */
    private updateResizeRectByDirectionByDOM(
      node: Node,
      direction: Direction,
      delta: { x: number; y: number },
      startNodeRect: Rect,
    ) {
      const domNode = node.getDashboardContainer()
      if (!domNode) {
        return
      }

      const resizeRect = calculateResizeRectByDirection(this.props.designer, direction, delta, startNodeRect)
      domNode.style.left = `${resizeRect.x}px`
      domNode.style.top = `${resizeRect.y}px`
      domNode.style.width = `${resizeRect.width}px`
      domNode.style.height = `${resizeRect.height}px`
      this.updateAllOutlines(resizeRect)

      // 如果是分组的话，还需要更新子节点的位置和大小
      if (node.isGroup) {
        // 根据分组的缩放大小计算，缩放比例
        const ratioWidth = resizeRect.width / startNodeRect.width
        const ratioHeight = resizeRect.height / startNodeRect.height

        for (const child of node.getAllNodesInGroup()) {
          const childDom = child.getDashboardContainer()
          if (!childDom) continue

          // 子节点根据新的缩放比例重新计算位置
          const childRect = child.getDashboardRect()
          childDom.style.left = `${startNodeRect.x + (childRect.x - startNodeRect.x) * ratioWidth}px`
          childDom.style.top = `${startNodeRect.y + (childRect.y - startNodeRect.y) * ratioHeight}px`
          childDom.style.width = `${childRect.width * ratioWidth}px`
          childDom.style.height = `${childRect.height * ratioHeight}px`
        }
      }
    }

    /**
     * 更新所有 outline 通过 DOM
     * @param rect 矩形
     */
    private updateAllOutlines(rect: { x: number; y: number; width: number; height: number }) {
      // 更新四边
      this.resizeBorderN.style.width = `${rect.width}px`
      this.resizeBorderN.style.transform = `translate(${rect.x}px, ${rect.y}px)`

      this.resizeBorderS.style.width = `${rect.width}px`
      this.resizeBorderS.style.transform = `translate(${rect.x}px, ${rect.y + rect.height}px)`

      this.resizeBorderE.style.height = `${rect.height}px`
      this.resizeBorderE.style.transform = `translate(${rect.x + rect.width}px, ${rect.y}px)`

      this.resizeBorderW.style.height = `${rect.height}px`
      this.resizeBorderW.style.transform = `translate(${rect.x}px, ${rect.y}px)`

      // 更新四角
      this.resizeCornerNW.style.transform = `translate(${rect.x - 3}px, ${rect.y - 3}px)`
      this.resizeCornerNE.style.transform = `translate(${rect.x + rect.width - 5}px, ${rect.y - 3}px)`
      this.resizeCornerSW.style.transform = `translate(${rect.x - 3}px, ${rect.y + rect.height - 5}px)`
      this.resizeCornerSE.style.transform = `translate(${rect.x + rect.width - 5}px, ${rect.y + rect.height - 5}px)`
    }

    componentWillUnmount() {
      if (this.willUnbind) {
        this.willUnbind()
      }
    }

    componentDidMount() {
      this.willBind()

      let startNodeRect: Rect
      let lastNodeInfo: any

      const resizeStart = ({ e, direction, node }: { e: MouseEvent; direction: Direction; node: Node }) => {
        // 计算辅助线位置
        this.props.designer.guideline.calculateGuideLineInfo()

        const { advanced } = node.componentMeta
        if (advanced.callbacks && typeof advanced.callbacks.onResizeStart === 'function') {
          ;(e as any).trigger = direction
          advanced.callbacks.onResizeStart({ ...e, trigger: direction }, node)
        }
        startNodeRect = node.getDashboardRect()
      }

      const resize = ({
        e,
        direction,
        node,
        moveX,
        moveY,
      }: { e: MouseEvent; direction: Direction; node: Node; moveX: number; moveY: number }) => {
        const { advanced } = node.componentMeta
        if (advanced.callbacks && typeof advanced.callbacks.onResize === 'function') {
          ;(e as any).trigger = direction
          ;(e as any).deltaX = moveX
          ;(e as any).deltaY = moveY
          advanced.callbacks.onResize({ ...e, trigger: direction, deltaX: moveX, deltaY: moveY }, node)
        }
        this.updateResizeRectByDirectionByDOM(node, direction, { x: moveX, y: moveY }, startNodeRect)
        lastNodeInfo = {
          node,
          direction,
          moveX,
          moveY,
        }
      }

      const resizeEnd = ({ e, direction, node }: { e: MouseEvent; direction: Direction; node: Node }) => {
        // 计算辅助线位置
        this.props.designer.guideline.resetAdsorptionLines()

        const { advanced } = node.componentMeta
        if (advanced.callbacks && typeof advanced.callbacks.onResizeEnd === 'function') {
          ;(e as any).trigger = direction
          advanced.callbacks.onResizeEnd({ ...e, trigger: direction }, node)
        }

        if (lastNodeInfo) {
          this.updateResizeRectByDirection(
            lastNodeInfo.node,
            lastNodeInfo.direction,
            {
              x: lastNodeInfo.moveX,
              y: lastNodeInfo.moveY,
            },
            startNodeRect,
          )
        }

        const editor = node.document?.designer.editor
        const selected = node?.componentMeta?.componentName || ''
        editor?.eventBus.emit('designer.border.resize', {
          selected,
          layout: node?.parent?.getPropValue('layout') || '',
        })
      }

      this.dragEngine.onResize(resize)
      this.dragEngine.onResizeStart(resizeStart)
      this.dragEngine.onResizeEnd(resizeEnd)
    }

    willBind() {
      if (this.willUnbind) {
        this.willUnbind()
      }

      if (
        !this.resizeBorderN &&
        !this.resizeBorderE &&
        !this.resizeBorderS &&
        !this.resizeBorderW &&
        !this.resizeCornerNE &&
        !this.resizeCornerNW &&
        !this.resizeCornerSE &&
        !this.resizeCornerSW
      ) {
        return
      }

      const unBind: any[] = []
      const { node } = this.props
      unBind.push(
        ...[
          this.dragEngine.from(this.resizeBorderN, Direction.N, () => node),
          this.dragEngine.from(this.resizeBorderE, Direction.E, () => node),
          this.dragEngine.from(this.resizeBorderS, Direction.S, () => node),
          this.dragEngine.from(this.resizeBorderW, Direction.W, () => node),
          this.dragEngine.from(this.resizeCornerNE, Direction.NE, () => node),
          this.dragEngine.from(this.resizeCornerNW, Direction.NW, () => node),
          this.dragEngine.from(this.resizeCornerSE, Direction.SE, () => node),
          this.dragEngine.from(this.resizeCornerSW, Direction.SW, () => node),
        ],
      )

      this.willUnbind = () => {
        if (unBind && unBind.length > 0) {
          unBind.forEach(item => {
            item()
          })
        }
        this.willUnbind = () => {}
      }
    }

    render() {
      const { node } = this.props
      const rect = node.getDashboardRect()
      const offsetLeft = rect.x
      const offsetTop = rect.y
      const offsetWidth = rect.width
      const offsetHeight = rect.height

      const baseBorderClass = 'lc-borders lc-resize-border'
      const baseSideClass = 'lc-borders lc-resize-side'
      const baseCornerClass = 'lc-borders lc-resize-corner'

      return (
        <div>
          <div
            ref={ref => {
              this.resizeBorderN = ref
            }}
            className={baseBorderClass}
            style={{
              width: offsetWidth,
              height: 1,
              transform: `translate(${offsetLeft}px, ${offsetTop}px)`,
            }}
          >
            <div
              className={`${baseSideClass} n`}
              style={{
                height: 20,
                transform: 'translateY(-10px)',
                width: '100%',
              }}
            />
          </div>

          <div
            ref={ref => {
              this.resizeCornerNE = ref
            }}
            className={`${baseCornerClass} ne`}
            style={{
              transform: `translate(${offsetLeft + offsetWidth - 5}px, ${offsetTop - 3}px)`,
              cursor: 'nesw-resize',
            }}
          />

          <div
            ref={ref => {
              this.resizeBorderE = ref
            }}
            className={baseBorderClass}
            style={{
              width: 1,
              height: offsetHeight,
              transform: `translate(${offsetLeft + offsetWidth}px, ${offsetTop}px)`,
            }}
          >
            <div
              className={`${baseSideClass} e`}
              style={{
                height: '100%',
                transform: 'translateX(-10px)',
                width: 20,
              }}
            />
          </div>

          <div
            ref={ref => {
              this.resizeCornerSE = ref
            }}
            className={`${baseCornerClass} se`}
            style={{
              transform: `translate(${offsetLeft + offsetWidth - 5}px, ${offsetTop + offsetHeight - 5}px)`,
              cursor: 'nwse-resize',
            }}
          />

          <div
            ref={ref => {
              this.resizeBorderS = ref
            }}
            className={baseBorderClass}
            style={{
              width: offsetWidth,
              height: 1,
              transform: `translate(${offsetLeft}px, ${offsetTop + offsetHeight}px)`,
            }}
          >
            <div
              className={`${baseSideClass} s`}
              style={{
                height: 20,
                transform: 'translateY(-10px)',
                width: '100%',
              }}
            />
          </div>

          <div
            ref={ref => {
              this.resizeCornerSW = ref
            }}
            className={`${baseCornerClass} sw`}
            style={{
              transform: `translate(${offsetLeft - 3}px, ${offsetTop + offsetHeight - 5}px)`,
              cursor: 'nesw-resize',
            }}
          />

          <div
            ref={ref => {
              this.resizeBorderW = ref
            }}
            className={baseBorderClass}
            style={{
              width: 1,
              height: offsetHeight,
              transform: `translate(${offsetLeft}px, ${offsetTop}px)`,
            }}
          >
            <div
              className={`${baseSideClass} w`}
              style={{
                height: '100%',
                transform: 'translateX(-10px)',
                width: 20,
              }}
            />
          </div>

          <div
            ref={ref => {
              this.resizeCornerNW = ref
            }}
            className={`${baseCornerClass} nw`}
            style={{
              transform: `translate(${offsetLeft - 3}px, ${offsetTop - 3}px)`,
              cursor: 'nwse-resize',
            }}
          />
        </div>
      )
    }
  },
)

interface BorderResizingForNodeProps {
  host: Simulator
  node: Node
  dragging: boolean
}

const BorderResizingForNode: React.FC<BorderResizingForNodeProps> = observer(({ host, node, dragging }) => {
  const { designer } = host

  if (dragging) {
    return null
  }

  return <BorderResizingInstance key={node.id} dragging={dragging} node={node} designer={designer} />
})

interface BorderResizingBoxProps {
  designer: Designer
  nodes: Node[]
  dragging: boolean
}

const BorderResizingBox = observer(
  class BoxResizingBox extends Component<BorderResizingBoxProps> {
    private willUnbind: () => any

    // outline of eight direction
    private resizeBorderN: any
    private resizeBorderE: any
    private resizeBorderS: any
    private resizeBorderW: any
    private resizeCornerNE: any
    private resizeCornerNW: any
    private resizeCornerSE: any
    private resizeCornerSW: any

    private dragEngine: DragResizeEngine

    constructor(props: BorderResizingBoxProps) {
      super(props)
      this.dragEngine = new DragResizeEngine(props.designer)
    }

    /**
     * 计算 resize 后的 rect
     * @param node 节点
     * @param direction 方向
     * @param delta 偏移量
     * @param startNodeRect 拖拽开始时的 rect
     */
    private updateResizeRectByDirection(
      node: Node,
      direction: Direction,
      delta: { x: number; y: number },
      startNodeRect: Rect,
    ) {
      const resizeRect = calculateResizeRectByDirection(this.props.designer, direction, delta, startNodeRect)
      // 根据 box 的缩放大小计算，缩放比例
      const ratioWidth = resizeRect.width / startNodeRect.width
      const ratioHeight = resizeRect.height / startNodeRect.height

      for (const node of this.props.nodes) {
        // // 如果是分组的话，还需要更新子节点的位置和大小
        if (node.isGroup) {
          for (const child of node.getAllNodesInGroup()) {
            // 子节点根据新的缩放比例重新计算位置
            const childRect = child.getDashboardRect()
            child.updateDashboardRect({
              x: resizeRect.x + (childRect.x - startNodeRect.x) * ratioWidth,
              y: resizeRect.y + (childRect.y - startNodeRect.y) * ratioHeight,
              width: childRect.width * ratioWidth,
              height: childRect.height * ratioHeight,
            })
          }
        } else {
          const rect = node.getDashboardRect()
          node.updateDashboardRect({
            x: resizeRect.x + (rect.x - startNodeRect.x) * ratioWidth,
            y: resizeRect.y + (rect.y - startNodeRect.y) * ratioHeight,
            width: rect.width * ratioWidth,
            height: rect.height * ratioHeight,
          })
        }
      }
    }

    /**
     * 计算 resize 后的 rect 通过 DOM 计算
     * @param node 节点
     * @param direction 方向
     * @param delta 偏移量
     * @param startNodeRect 拖拽开始时的 rect
     */
    private updateResizeRectByDirectionByDOM(
      node: Node,
      direction: Direction,
      delta: { x: number; y: number },
      startNodeRect: Rect,
    ) {
      const resizeRect = calculateResizeRectByDirection(this.props.designer, direction, delta, startNodeRect)
      const ratioWidth = resizeRect.width / startNodeRect.width
      const ratioHeight = resizeRect.height / startNodeRect.height

      for (const node of this.props.nodes) {
        // // 如果是分组的话，还需要更新子节点的位置和大小
        if (node.isGroup) {
          // 根据分组的缩放大小计算，缩放比例
          const ratioWidth = resizeRect.width / startNodeRect.width
          const ratioHeight = resizeRect.height / startNodeRect.height

          for (const child of node.getAllNodesInGroup()) {
            const childDom = child.getDashboardContainer()
            if (!childDom) continue

            // 子节点根据新的缩放比例重新计算位置
            const childRect = child.getDashboardRect()
            childDom.style.left = `${resizeRect.x + (childRect.x - startNodeRect.x) * ratioWidth}px`
            childDom.style.top = `${resizeRect.y + (childRect.y - startNodeRect.y) * ratioHeight}px`
            childDom.style.width = `${childRect.width * ratioWidth}px`
            childDom.style.height = `${childRect.height * ratioHeight}px`
          }
        } else {
          const domNode = node.getDashboardContainer()
          if (!domNode) continue

          const rect = node.getDashboardRect()
          domNode.style.left = `${resizeRect.x + (rect.x - startNodeRect.x) * ratioWidth}px`
          domNode.style.top = `${resizeRect.y + (rect.y - startNodeRect.y) * ratioHeight}px`
          domNode.style.width = `${rect.width * ratioWidth}px`
          domNode.style.height = `${rect.height * ratioHeight}px`
        }
      }

      this.updateAllOutlines(resizeRect)
    }

    /**
     * 更新所有 outline 通过 DOM
     * @param rect 矩形
     */
    private updateAllOutlines(rect: { x: number; y: number; width: number; height: number }) {
      // 更新四边
      this.resizeBorderN.style.width = `${rect.width}px`
      this.resizeBorderN.style.transform = `translate(${rect.x}px, ${rect.y}px)`

      this.resizeBorderS.style.width = `${rect.width}px`
      this.resizeBorderS.style.transform = `translate(${rect.x}px, ${rect.y + rect.height}px)`

      this.resizeBorderE.style.height = `${rect.height}px`
      this.resizeBorderE.style.transform = `translate(${rect.x + rect.width}px, ${rect.y}px)`

      this.resizeBorderW.style.height = `${rect.height}px`
      this.resizeBorderW.style.transform = `translate(${rect.x}px, ${rect.y}px)`

      // 更新四角
      this.resizeCornerNW.style.transform = `translate(${rect.x - 3}px, ${rect.y - 3}px)`
      this.resizeCornerNE.style.transform = `translate(${rect.x + rect.width - 5}px, ${rect.y - 3}px)`
      this.resizeCornerSW.style.transform = `translate(${rect.x - 3}px, ${rect.y + rect.height - 5}px)`
      this.resizeCornerSE.style.transform = `translate(${rect.x + rect.width - 5}px, ${rect.y + rect.height - 5}px)`
    }

    componentWillUnmount() {
      if (this.willUnbind) {
        this.willUnbind()
      }
    }

    componentDidMount() {
      this.willBind()

      let startNodeRect: Rect
      let lastNodeInfo: any

      const resizeStart = () => {
        startNodeRect = this.getRect()
      }

      const resize = ({
        e,
        direction,
        node,
        moveX,
        moveY,
      }: { e: MouseEvent; direction: Direction; node: Node; moveX: number; moveY: number }) => {
        this.updateResizeRectByDirectionByDOM(node, direction, { x: moveX, y: moveY }, startNodeRect)
        lastNodeInfo = {
          node,
          direction,
          moveX,
          moveY,
        }
        console.log('resizelog', e, direction, node, moveX, moveY)
      }

      const resizeEnd = ({ e, direction, node }: { e: MouseEvent; direction: Direction; node: Node }) => {
        if (lastNodeInfo) {
          this.updateResizeRectByDirection(
            lastNodeInfo.node,
            lastNodeInfo.direction,
            {
              x: lastNodeInfo.moveX,
              y: lastNodeInfo.moveY,
            },
            startNodeRect,
          )
        }

        const editor = node.document?.designer.editor
        const selected = node?.componentMeta?.componentName || ''
        editor?.eventBus.emit('designer.border.resize', {
          selected,
          layout: node?.parent?.getPropValue('layout') || '',
        })
      }

      this.dragEngine.onResize(resize)
      this.dragEngine.onResizeStart(resizeStart)
      this.dragEngine.onResizeEnd(resizeEnd)
    }

    willBind() {
      if (this.willUnbind) {
        this.willUnbind()
      }

      if (
        !this.resizeBorderN &&
        !this.resizeBorderE &&
        !this.resizeBorderS &&
        !this.resizeBorderW &&
        !this.resizeCornerNE &&
        !this.resizeCornerNW &&
        !this.resizeCornerSE &&
        !this.resizeCornerSW
      ) {
        return
      }

      const unBind: any[] = []

      unBind.push(
        ...[
          this.dragEngine.from(this.resizeBorderN, Direction.N, () => null),
          this.dragEngine.from(this.resizeBorderE, Direction.E, () => null),
          this.dragEngine.from(this.resizeBorderS, Direction.S, () => null),
          this.dragEngine.from(this.resizeBorderW, Direction.W, () => null),
          this.dragEngine.from(this.resizeCornerNE, Direction.NE, () => null),
          this.dragEngine.from(this.resizeCornerNW, Direction.NW, () => null),
          this.dragEngine.from(this.resizeCornerSE, Direction.SE, () => null),
          this.dragEngine.from(this.resizeCornerSW, Direction.SW, () => null),
        ],
      )

      this.willUnbind = () => {
        if (unBind && unBind.length > 0) {
          unBind.forEach(item => {
            item()
          })
        }
        this.willUnbind = () => {}
      }
    }

    getRect() {
      return calculateDashboardRectBox(this.props.nodes)
    }

    render() {
      const rect = this.getRect()
      const offsetLeft = rect.x
      const offsetTop = rect.y
      const offsetWidth = rect.width
      const offsetHeight = rect.height

      const baseBorderClass = 'lc-borders lc-resize-border'
      const baseSideClass = 'lc-borders lc-resize-side'
      const baseCornerClass = 'lc-borders lc-resize-corner'

      return (
        <div>
          <div
            ref={ref => {
              this.resizeBorderN = ref
            }}
            className={baseBorderClass}
            style={{
              width: offsetWidth,
              height: 1,
              transform: `translate(${offsetLeft}px, ${offsetTop}px)`,
            }}
          >
            <div
              className={`${baseSideClass} n`}
              style={{
                height: 20,
                transform: 'translateY(-10px)',
                width: '100%',
              }}
            />
          </div>

          <div
            ref={ref => {
              this.resizeCornerNE = ref
            }}
            className={`${baseCornerClass} ne`}
            style={{
              transform: `translate(${offsetLeft + offsetWidth - 5}px, ${offsetTop - 3}px)`,
              cursor: 'nesw-resize',
            }}
          />

          <div
            ref={ref => {
              this.resizeBorderE = ref
            }}
            className={baseBorderClass}
            style={{
              width: 1,
              height: offsetHeight,
              transform: `translate(${offsetLeft + offsetWidth}px, ${offsetTop}px)`,
            }}
          >
            <div
              className={`${baseSideClass} e`}
              style={{
                height: '100%',
                transform: 'translateX(-10px)',
                width: 20,
              }}
            />
          </div>

          <div
            ref={ref => {
              this.resizeCornerSE = ref
            }}
            className={`${baseCornerClass} se`}
            style={{
              transform: `translate(${offsetLeft + offsetWidth - 5}px, ${offsetTop + offsetHeight - 5}px)`,
              cursor: 'nwse-resize',
            }}
          />

          <div
            ref={ref => {
              this.resizeBorderS = ref
            }}
            className={baseBorderClass}
            style={{
              width: offsetWidth,
              height: 1,
              transform: `translate(${offsetLeft}px, ${offsetTop + offsetHeight}px)`,
            }}
          >
            <div
              className={`${baseSideClass} s`}
              style={{
                height: 20,
                transform: 'translateY(-10px)',
                width: '100%',
              }}
            />
          </div>

          <div
            ref={ref => {
              this.resizeCornerSW = ref
            }}
            className={`${baseCornerClass} sw`}
            style={{
              transform: `translate(${offsetLeft - 3}px, ${offsetTop + offsetHeight - 5}px)`,
              cursor: 'nesw-resize',
            }}
          />

          <div
            ref={ref => {
              this.resizeBorderW = ref
            }}
            className={baseBorderClass}
            style={{
              width: 1,
              height: offsetHeight,
              transform: `translate(${offsetLeft}px, ${offsetTop}px)`,
            }}
          >
            <div
              className={`${baseSideClass} w`}
              style={{
                height: '100%',
                transform: 'translateX(-10px)',
                width: 20,
              }}
            />
          </div>

          <div
            ref={ref => {
              this.resizeCornerNW = ref
            }}
            className={`${baseCornerClass} nw`}
            style={{
              transform: `translate(${offsetLeft - 3}px, ${offsetTop - 3}px)`,
              cursor: 'nwse-resize',
            }}
          />
        </div>
      )
    }
  },
)

interface BorderResizingForBoxProps {
  host: Simulator
  nodes: Node[]
  dragging: boolean
}

const BorderResizingForBox: React.FC<BorderResizingForBoxProps> = observer(({ host, nodes, dragging }) => {
  const { designer } = host

  if (dragging) {
    return null
  }

  return <BorderResizingBox dragging={dragging} nodes={nodes} designer={designer} />
})

interface BorderResizingProps {
  host: Simulator
}

export const BorderResizing: React.FC<BorderResizingProps> = observer(({ host }) => {
  const { selection } = host.designer
  const dragging = host.designer.dragon.dragging
  let selecting = dragging ? selection.getTopNodes() : selection.getNodes()
  selecting = selecting.filter(node => !node.isRoot)

  if (!selecting) {
    return null
  }

  if (selecting.length > 1) {
    return <BorderResizingForBox host={host} nodes={selecting} dragging={dragging} />
  }

  return (
    <>
      {selecting.map(node => (
        <BorderResizingForNode key={node.id} host={host} node={node} dragging={dragging} />
      ))}
    </>
  )
})
