import { DESIGNER_EVENT, type Designer, type Viewport } from '@easy-editor/core'
import { action, computed, observable } from 'mobx'

type GuideLineType = 'horizontal' | 'vertical'

interface GuideLineItem {
  id: string
  type: GuideLineType
  position: number
}

/**
 * 用户辅助线项（从游尺添加）
 */
export interface UserGuideLineItem {
  id: string
  type: GuideLineType
  position: number
}

interface AlignmentLine {
  type: GuideLineType
  position: number
}

interface AdsorptionLine {
  /**
   * 吸附位置
   *  - 0: 左 | 上
   *  - 1: 中
   *  - 2: 右 | 下
   */
  adsorption: number
  position: number
}

/**
 * 距离线段信息（用于渲染组件间的距离指示器）
 */
export interface DistanceSegment {
  /** 距离值（像素） */
  distance: number
  /** 线段起点坐标 */
  start: number
  /** 线段终点坐标 */
  end: number
  /** 线段的固定坐标位置（垂直距离线段的 x 坐标，水平距离线段的 y 坐标） */
  fixedPos: number
  /** 标签中心位置 */
  labelPos: number
}

/**
 * 吸附辅助线信息（带距离标签）
 */
export interface AdsorptionLineInfo {
  /** 辅助线位置 */
  position: number
  /** 辅助线类型 */
  type: 'vertical' | 'horizontal'
  /** 距离线段列表（可能有多个方向的距离） */
  distanceSegments?: DistanceSegment[]
}

export class GuideLine {
  /**
   * 是否启用辅助线
   */
  @observable accessor enabled = true

  /**
   * 自定义辅助线数组
   */
  @observable.shallow accessor guideLines: GuideLineItem[] = []

  @computed
  get guideLinesMap() {
    const result = Object.groupBy(this.guideLines, item => item.type)
    return {
      verticalLinesMap: new Map(result.vertical?.map(item => [item.position, item])),
      horizontalLinesMap: new Map(result.horizontal?.map(item => [item.position, item])),
    }
  }

  /**
   * Document Node 的辅助线信息
   */
  @observable.shallow accessor nodeLineMap = {
    verticalLinesMap: new Map<number, AlignmentLine>(),
    horizontalLinesMap: new Map<number, AlignmentLine>(),
  }

  /**
   * 实时显示的吸附辅助线
   */
  @observable accessor adsorptionLines = {
    verticalLines: new Set<number>(),
    horizontalLines: new Set<number>(),
  }

  /**
   * 带距离标签的吸附辅助线信息
   */
  @observable.shallow accessor adsorptionLinesWithDistance: AdsorptionLineInfo[] = []

  /**
   * 用户辅助线（从游尺添加）
   */
  @observable.shallow accessor userGuideLines: UserGuideLineItem[] = []

  /**
   * 用户辅助线 ID 计数器
   */
  private userGuideLineIdCounter = 0

  get currentDocument() {
    return this.designer.currentDocument
  }

  constructor(readonly designer: Designer) {
    // 添加画布视口的辅助线
    this.designer.onEvent(DESIGNER_EVENT.VIEWPORT_MOUNT, ({ viewport }: { viewport: Viewport }) => {
      this.addGuideLine({
        id: 'viewport-vertical-left',
        type: 'vertical',
        position: 0,
      })
      this.addGuideLine({
        id: 'viewport-vertical-middle',
        type: 'vertical',
        position: viewport.width / 2,
      })
      this.addGuideLine({
        id: 'viewport-vertical-right',
        type: 'vertical',
        position: viewport.width,
      })
      this.addGuideLine({
        id: 'viewport-horizontal-top',
        type: 'horizontal',
        position: 0,
      })
      this.addGuideLine({
        id: 'viewport-horizontal-middle',
        type: 'horizontal',
        position: viewport.height / 2,
      })
      this.addGuideLine({
        id: 'viewport-horizontal-bottom',
        type: 'horizontal',
        position: viewport.height,
      })
    })
  }

  /**
   * 添加额外的辅助线，用于尺寸调整
   */
  @action
  addGuideLine(guideLine: GuideLineItem) {
    this.guideLines.push(guideLine)
  }

  /**
   * 删除辅助线
   */
  @action
  removeGuideLine(id: string) {
    const index = this.guideLines.findIndex(item => item.id === id)
    if (index !== -1) {
      this.guideLines.splice(index, 1)
    }
  }

  /**
   * 修改辅助线
   */
  @action
  updateGuideLine(id: string, guideLine: GuideLineItem) {
    const index = this.guideLines.findIndex(item => item.id === id)
    if (index !== -1) {
      this.guideLines[index] = guideLine
    }
  }

  /**
   * 获取用户辅助线的计算映射
   */
  @computed
  get userGuideLinesMap() {
    const result = Object.groupBy(this.userGuideLines, item => item.type)
    return {
      verticalLinesMap: new Map(result.vertical?.map(item => [item.position, item])),
      horizontalLinesMap: new Map(result.horizontal?.map(item => [item.position, item])),
    }
  }

  /**
   * 添加用户辅助线（从游尺添加）
   */
  @action
  addUserGuideLine(type: GuideLineType, position: number): UserGuideLineItem {
    const id = `user-guideline-${++this.userGuideLineIdCounter}`
    const guideLine: UserGuideLineItem = { id, type, position: Math.round(position) }
    this.userGuideLines.push(guideLine)
    return guideLine
  }

  /**
   * 更新用户辅助线位置
   */
  @action
  updateUserGuideLine(id: string, position: number) {
    const index = this.userGuideLines.findIndex(item => item.id === id)
    if (index !== -1) {
      this.userGuideLines[index] = { ...this.userGuideLines[index], position: Math.round(position) }
    }
  }

  /**
   * 删除用户辅助线
   */
  @action
  removeUserGuideLine(id: string) {
    const index = this.userGuideLines.findIndex(item => item.id === id)
    if (index !== -1) {
      this.userGuideLines.splice(index, 1)
    }
  }

  /**
   * 清空所有用户辅助线
   */
  @action
  clearUserGuideLines() {
    this.userGuideLines = []
  }

  /**
   * 计算页面组件的辅助线信息
   */
  @action
  calculateGuideLineInfo() {
    if (!this.enabled) return

    const verticalLinesMap = new Map<number, AlignmentLine>()
    const horizontalLinesMap = new Map<number, AlignmentLine>()

    // 获取画布上所有的组件，得到每个可以被参照对齐的组件的位置信息
    const nodes = [...this.currentDocument!.nodesMap.values()]

    // 将选中的组合和组件抛开计算之外
    const selected: string[] = []
    for (const node of this.designer.selection.getNodes()) {
      if (node.isGroup) {
        selected.push(...node.getAllNodesInGroup().map(node => node.id))
      } else {
        selected.push(node.id)
      }
    }

    nodes
      .filter(node => !node.hidden)
      .forEach(node => {
        if (selected.includes(node.id) || node.isRoot || node.isGroup) return

        const nodeRect = node.getDashboardRect()
        const verticalNodeLines = [nodeRect.left, nodeRect.left + nodeRect.width / 2, nodeRect.right]
        const horizontalNodeLines = [nodeRect.top, nodeRect.top + nodeRect.height / 2, nodeRect.bottom]

        for (const line of verticalNodeLines) {
          const position = Math.round(line)
          verticalLinesMap.set(position, {
            type: 'vertical',
            position,
          })
        }
        for (const line of horizontalNodeLines) {
          const position = Math.round(line)
          horizontalLinesMap.set(position, {
            type: 'horizontal',
            position,
          })
        }
      })

    this.nodeLineMap.verticalLinesMap = verticalLinesMap
    this.nodeLineMap.horizontalLinesMap = horizontalLinesMap
  }

  /**
   * 组件的吸附距离
   */
  private adsorptionSize = 10

  /**
   * 距离线段显示的最大距离阈值
   * 只有当组件间距离在 [adsorptionSize, maxDistanceDisplay] 范围内才显示距离线段
   */
  private maxDistanceDisplay = 300

  /**
   * 设置画布上要实时展示的对齐辅助线，返回要吸附的距离
   * @param rect 为拖动过程中组件的位置信息
   * @param adsorption 指定需要吸附位置
   *  - 0: 左 | 上
   *  - 1: 中
   *  - 2: 右 | 下
   */
  @action
  getAdsorptionPosition(rect: DOMRect, adsorption?: number | Array<number>) {
    if (typeof adsorption === 'number') {
      adsorption = [adsorption]
    }

    this.resetAdsorptionLines()

    const adsorptionVerticalLines: AdsorptionLine[] = []
    const adsorptionHorizontalLines: AdsorptionLine[] = []
    const currentVerticalLine = [rect.left, rect.left + rect.width / 2, rect.right]
    const currentHorizontalLine = [rect.top, rect.top + rect.height / 2, rect.bottom]

    // 计算需要显示的辅助线和吸附信息
    currentVerticalLine.forEach((item, index) => {
      let minDistance = Number.POSITIVE_INFINITY
      let closestPosition: number | null = null

      this.nodeLineMap.verticalLinesMap.forEach((_, pos) => {
        const distance = Math.abs(item - pos)
        if (distance !== 0 && distance < this.adsorptionSize && distance < minDistance) {
          minDistance = distance
          closestPosition = pos
        }
      })
      this.guideLinesMap.verticalLinesMap.forEach((_, pos) => {
        const distance = Math.abs(item - pos)
        if (distance !== 0 && distance < this.adsorptionSize && distance < minDistance) {
          minDistance = distance
          closestPosition = pos
        }
      })
      // 用户辅助线也参与吸附
      this.userGuideLinesMap.verticalLinesMap.forEach((_, pos) => {
        const distance = Math.abs(item - pos)
        if (distance !== 0 && distance < this.adsorptionSize && distance < minDistance) {
          minDistance = distance
          closestPosition = pos
        }
      })

      if (
        closestPosition !== null &&
        adsorptionVerticalLines.findIndex(item => item.position === closestPosition) === -1
      ) {
        adsorptionVerticalLines.push({
          adsorption: index,
          position: closestPosition,
        })
      }
    })
    currentHorizontalLine.forEach((item, index) => {
      let minDistance = Number.POSITIVE_INFINITY
      let closestPosition: number | null = null

      this.nodeLineMap.horizontalLinesMap.forEach((_, pos) => {
        const distance = Math.abs(item - pos)
        if (distance !== 0 && distance < this.adsorptionSize && distance < minDistance) {
          minDistance = distance
          closestPosition = pos
        }
      })
      this.guideLinesMap.horizontalLinesMap.forEach((_, pos) => {
        const distance = Math.abs(item - pos)
        if (distance !== 0 && distance < this.adsorptionSize && distance < minDistance) {
          minDistance = distance
          closestPosition = pos
        }
      })
      // 用户辅助线也参与吸附
      this.userGuideLinesMap.horizontalLinesMap.forEach((_, pos) => {
        const distance = Math.abs(item - pos)
        if (distance !== 0 && distance < this.adsorptionSize && distance < minDistance) {
          minDistance = distance
          closestPosition = pos
        }
      })

      if (
        closestPosition !== null &&
        adsorptionHorizontalLines.findIndex(item => item.position === closestPosition) === -1
      ) {
        adsorptionHorizontalLines.push({
          adsorption: index,
          position: closestPosition,
        })
      }
    })

    const isAdsorption = adsorptionVerticalLines.length > 0 || adsorptionHorizontalLines.length > 0
    const adsorb: Record<'x' | 'y', AdsorptionLine | undefined> = { x: undefined, y: undefined }
    const linesWithDistance: AdsorptionLineInfo[] = []

    if (isAdsorption) {
      // 将吸附的辅助线添加到吸附辅助线集合中，用于显示到页面上
      adsorptionVerticalLines.forEach(item => this.adsorptionLines.verticalLines.add(item.position))
      adsorptionHorizontalLines.forEach(item => this.adsorptionLines.horizontalLines.add(item.position))

      // 计算垂直辅助线的距离线段
      for (const line of adsorptionVerticalLines) {
        const lineInfo: AdsorptionLineInfo = {
          position: line.position,
          type: 'vertical',
        }
        // 查找在这条线上对齐的其他组件，计算距离线段
        const segments = this.calculateVerticalLineSegments(rect, line.position)
        if (segments.length > 0) {
          lineInfo.distanceSegments = segments
        }
        linesWithDistance.push(lineInfo)
      }

      // 计算水平辅助线的距离线段
      for (const line of adsorptionHorizontalLines) {
        const lineInfo: AdsorptionLineInfo = {
          position: line.position,
          type: 'horizontal',
        }
        // 查找在这条线上对齐的其他组件，计算距离线段
        const segments = this.calculateHorizontalLineSegments(rect, line.position)
        if (segments.length > 0) {
          lineInfo.distanceSegments = segments
        }
        linesWithDistance.push(lineInfo)
      }

      // 如果吸附，则计算吸附的距离
      if (adsorptionVerticalLines.length > 0) {
        if (adsorption) {
          adsorb.x = adsorptionVerticalLines.find(item => adsorption.includes(item.adsorption))!
        } else {
          const adsorptionPosition = Math.min(...adsorptionVerticalLines.map(item => item.position))
          adsorb.x = adsorptionVerticalLines.find(item => item.position === adsorptionPosition)!
        }
      }
      if (adsorptionHorizontalLines.length > 0) {
        if (adsorption) {
          adsorb.y = adsorptionHorizontalLines.find(item => adsorption.includes(item.adsorption))!
        } else {
          const adsorptionPosition = Math.min(...adsorptionHorizontalLines.map(item => item.position))
          adsorb.y = adsorptionHorizontalLines.find(item => item.position === adsorptionPosition)!
        }
      }
    }

    this.adsorptionLinesWithDistance = linesWithDistance

    return {
      isAdsorption,
      adsorb,
    }
  }

  @action
  resetAdsorptionLines() {
    this.adsorptionLines.verticalLines.clear()
    this.adsorptionLines.horizontalLines.clear()
    this.adsorptionLinesWithDistance = []
  }

  /**
   * 计算垂直辅助线上的距离线段（当前组件与对齐组件之间的垂直距离）
   * 返回所有方向的距离线段
   */
  private calculateVerticalLineSegments(rect: DOMRect, linePosition: number): DistanceSegment[] {
    const segments: DistanceSegment[] = []
    const selected = this.getSelectedNodeIds()

    const nodes = [...this.currentDocument!.nodesMap.values()].filter(
      node => !node.hidden && !selected.includes(node.id) && !node.isRoot && !node.isGroup,
    )

    // 查找在这条垂直线上对齐的组件（上方和下方）
    let nearestAbove: { distance: number; nodeRect: DOMRect } | null = null
    let nearestBelow: { distance: number; nodeRect: DOMRect } | null = null

    for (const node of nodes) {
      const nodeRect = node.getDashboardRect()
      if (!nodeRect) continue

      // 检查这个组件是否在这条线上（左、中、右任一位置）
      const nodeLines = [nodeRect.left, nodeRect.left + nodeRect.width / 2, nodeRect.right]
      const isOnLine = nodeLines.some(pos => Math.abs(pos - linePosition) < 1)

      if (!isOnLine) continue

      // 检查组件在上方还是下方
      if (nodeRect.bottom <= rect.top) {
        const distance = rect.top - nodeRect.bottom
        if (!nearestAbove || distance < nearestAbove.distance) {
          nearestAbove = { distance, nodeRect }
        }
      } else if (nodeRect.top >= rect.bottom) {
        const distance = nodeRect.top - rect.bottom
        if (!nearestBelow || distance < nearestBelow.distance) {
          nearestBelow = { distance, nodeRect }
        }
      }
    }

    // 上方距离线段（只在距离范围内显示）
    if (nearestAbove && this.isDistanceInDisplayRange(nearestAbove.distance)) {
      segments.push({
        distance: Math.round(nearestAbove.distance),
        start: nearestAbove.nodeRect.bottom,
        end: rect.top,
        fixedPos: linePosition,
        labelPos: nearestAbove.nodeRect.bottom + nearestAbove.distance / 2,
      })
    }

    // 下方距离线段（只在距离范围内显示）
    if (nearestBelow && this.isDistanceInDisplayRange(nearestBelow.distance)) {
      segments.push({
        distance: Math.round(nearestBelow.distance),
        start: rect.bottom,
        end: nearestBelow.nodeRect.top,
        fixedPos: linePosition,
        labelPos: rect.bottom + nearestBelow.distance / 2,
      })
    }

    return segments
  }

  /**
   * 计算水平辅助线上的距离线段（当前组件与对齐组件之间的水平距离）
   * 返回所有方向的距离线段
   */
  private calculateHorizontalLineSegments(rect: DOMRect, linePosition: number): DistanceSegment[] {
    const segments: DistanceSegment[] = []
    const selected = this.getSelectedNodeIds()

    const nodes = [...this.currentDocument!.nodesMap.values()].filter(
      node => !node.hidden && !selected.includes(node.id) && !node.isRoot && !node.isGroup,
    )

    // 查找在这条水平线上对齐的组件（左边和右边）
    let nearestLeft: { distance: number; nodeRect: DOMRect } | null = null
    let nearestRight: { distance: number; nodeRect: DOMRect } | null = null

    for (const node of nodes) {
      const nodeRect = node.getDashboardRect()
      if (!nodeRect) continue

      // 检查这个组件是否在这条线上（上、中、下任一位置）
      const nodeLines = [nodeRect.top, nodeRect.top + nodeRect.height / 2, nodeRect.bottom]
      const isOnLine = nodeLines.some(pos => Math.abs(pos - linePosition) < 1)

      if (!isOnLine) continue

      // 检查组件在左边还是右边
      if (nodeRect.right <= rect.left) {
        const distance = rect.left - nodeRect.right
        if (!nearestLeft || distance < nearestLeft.distance) {
          nearestLeft = { distance, nodeRect }
        }
      } else if (nodeRect.left >= rect.right) {
        const distance = nodeRect.left - rect.right
        if (!nearestRight || distance < nearestRight.distance) {
          nearestRight = { distance, nodeRect }
        }
      }
    }

    // 左边距离线段（只在距离范围内显示）
    if (nearestLeft && this.isDistanceInDisplayRange(nearestLeft.distance)) {
      segments.push({
        distance: Math.round(nearestLeft.distance),
        start: nearestLeft.nodeRect.right,
        end: rect.left,
        fixedPos: linePosition,
        labelPos: nearestLeft.nodeRect.right + nearestLeft.distance / 2,
      })
    }

    // 右边距离线段（只在距离范围内显示）
    if (nearestRight && this.isDistanceInDisplayRange(nearestRight.distance)) {
      segments.push({
        distance: Math.round(nearestRight.distance),
        start: rect.right,
        end: nearestRight.nodeRect.left,
        fixedPos: linePosition,
        labelPos: rect.right + nearestRight.distance / 2,
      })
    }

    return segments
  }

  /**
   * 获取所有选中节点的 ID（包括组合内的节点）
   */
  private getSelectedNodeIds(): string[] {
    const selected: string[] = []
    for (const node of this.designer.selection.getNodes()) {
      if (node.isGroup) {
        selected.push(...node.getAllNodesInGroup().map(n => n.id))
      } else {
        selected.push(node.id)
      }
    }
    return selected
  }

  /**
   * 判断距离是否在显示范围内
   * 范围：[adsorptionSize, maxDistanceDisplay]
   */
  private isDistanceInDisplayRange(distance: number): boolean {
    return distance >= this.adsorptionSize && distance <= this.maxDistanceDisplay
  }
}
