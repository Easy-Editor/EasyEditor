import type { Designer, Node } from '@easy-editor/core'
import { action } from 'mobx'

/**
 * 对齐类型枚举
 */
export enum AlignType {
  LEFT = 'left',
  RIGHT = 'right',
  TOP = 'top',
  BOTTOM = 'bottom',
  HORIZONTAL_CENTER = 'horizontalCenter',
  VERTICAL_CENTER = 'verticalCenter',
}

/**
 * 分布类型枚举
 */
export enum DistributeType {
  HORIZONTAL = 'horizontal',
  VERTICAL = 'vertical',
}

interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

/**
 * 多组件对齐功能类
 */
export class Alignment {
  constructor(readonly designer: Designer) {}

  get selection() {
    return this.designer.selection
  }

  /**
   * 获取选中节点（排除 root）
   */
  private getSelectedNodes(): Node[] {
    return this.selection.getTopNodes(false).filter(node => node && !node.isRoot)
  }

  /**
   * 计算选中组件的包围盒
   */
  private calculateBoundingBox(nodes: Node[]): BoundingBox {
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

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    }
  }

  /**
   * 更新节点位置（支持 Group）
   */
  private updateNodePosition(node: Node, x: number, y: number) {
    if (node.isGroup) {
      const nodeRect = node.getDashboardRect()
      const deltaX = x - nodeRect.x
      const deltaY = y - nodeRect.y

      for (const child of node.getAllNodesInGroup()) {
        const childRect = child.getDashboardRect()
        child.updateDashboardRect({
          x: childRect.x + deltaX,
          y: childRect.y + deltaY,
        })
      }
    } else {
      node.updateDashboardRect({ x, y })
    }
  }

  /**
   * 执行对齐操作
   */
  @action
  align(type: AlignType): boolean {
    const nodes = this.getSelectedNodes()
    if (nodes.length < 2) return false

    const box = this.calculateBoundingBox(nodes)

    for (const node of nodes) {
      const rect = node.getDashboardRect()
      let newX = rect.x
      let newY = rect.y

      switch (type) {
        case AlignType.LEFT:
          newX = box.minX
          break
        case AlignType.RIGHT:
          newX = box.maxX - rect.width
          break
        case AlignType.TOP:
          newY = box.minY
          break
        case AlignType.BOTTOM:
          newY = box.maxY - rect.height
          break
        case AlignType.HORIZONTAL_CENTER:
          newX = box.minX + (box.width - rect.width) / 2
          break
        case AlignType.VERTICAL_CENTER:
          newY = box.minY + (box.height - rect.height) / 2
          break
      }

      this.updateNodePosition(node, newX, newY)
    }

    return true
  }

  /**
   * 执行分布操作
   */
  @action
  distribute(type: DistributeType): boolean {
    const nodes = this.getSelectedNodes()
    if (nodes.length < 3) return false

    const box = this.calculateBoundingBox(nodes)

    if (type === DistributeType.HORIZONTAL) {
      const sorted = [...nodes].sort((a, b) => a.getDashboardRect().x - b.getDashboardRect().x)
      const totalWidth = sorted.reduce((sum, n) => sum + n.getDashboardRect().width, 0)
      const gap = (box.width - totalWidth) / (nodes.length - 1)

      let currentX = box.minX
      for (const node of sorted) {
        const rect = node.getDashboardRect()
        this.updateNodePosition(node, currentX, rect.y)
        currentX += rect.width + gap
      }
    } else {
      const sorted = [...nodes].sort((a, b) => a.getDashboardRect().y - b.getDashboardRect().y)
      const totalHeight = sorted.reduce((sum, n) => sum + n.getDashboardRect().height, 0)
      const gap = (box.height - totalHeight) / (nodes.length - 1)

      let currentY = box.minY
      for (const node of sorted) {
        const rect = node.getDashboardRect()
        this.updateNodePosition(node, rect.x, currentY)
        currentY += rect.height + gap
      }
    }

    return true
  }

  // 便捷方法
  alignLeft = () => this.align(AlignType.LEFT)
  alignRight = () => this.align(AlignType.RIGHT)
  alignTop = () => this.align(AlignType.TOP)
  alignBottom = () => this.align(AlignType.BOTTOM)
  alignHorizontalCenter = () => this.align(AlignType.HORIZONTAL_CENTER)
  alignVerticalCenter = () => this.align(AlignType.VERTICAL_CENTER)
  distributeHorizontal = () => this.distribute(DistributeType.HORIZONTAL)
  distributeVertical = () => this.distribute(DistributeType.VERTICAL)
}
