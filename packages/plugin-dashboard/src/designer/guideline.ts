import { DESIGNER_EVENT, type Designer, type Viewport } from '@easy-editor/core'
import { action, computed, observable } from 'mobx'

type GuideLineType = 'horizontal' | 'vertical'

interface GuideLineItem {
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

      this.nodeLineMap.verticalLinesMap.forEach((_, pos) => {
        const distance = Math.abs(item - pos)
        if (distance !== 0 && distance < this.adsorptionSize && distance < minDistance) {
          minDistance = pos
        }
      })
      this.guideLinesMap.verticalLinesMap.forEach((_, pos) => {
        const distance = Math.abs(item - pos)
        if (distance !== 0 && distance < this.adsorptionSize && distance < minDistance) {
          minDistance = pos
        }
      })

      if (
        minDistance !== Number.POSITIVE_INFINITY &&
        adsorptionVerticalLines.findIndex(item => item.position === minDistance) === -1
      ) {
        adsorptionVerticalLines.push({
          adsorption: index,
          position: minDistance,
        })
      }
    })
    currentHorizontalLine.forEach((item, index) => {
      let minDistance = -1

      this.nodeLineMap.horizontalLinesMap.forEach((_, pos) => {
        if (Math.abs(item - pos) < this.adsorptionSize) {
          minDistance = pos
        }
      })
      this.guideLinesMap.horizontalLinesMap.forEach((_, pos) => {
        const distance = Math.abs(item - pos)
        if (distance < this.adsorptionSize && distance < minDistance) {
          minDistance = pos
        }
      })

      if (minDistance !== -1 && adsorptionHorizontalLines.findIndex(item => item.position === minDistance) === -1) {
        adsorptionHorizontalLines.push({
          adsorption: index,
          position: minDistance,
        })
      }
    })

    const isAdsorption = adsorptionVerticalLines.length > 0 || adsorptionHorizontalLines.length > 0
    const adsorb: Record<'x' | 'y', AdsorptionLine | undefined> = { x: undefined, y: undefined }
    if (isAdsorption) {
      // 将吸附的辅助线添加到吸附辅助线集合中，用于显示到页面上
      adsorptionVerticalLines.forEach(item => this.adsorptionLines.verticalLines.add(item.position))
      adsorptionHorizontalLines.forEach(item => this.adsorptionLines.horizontalLines.add(item.position))

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

    return {
      isAdsorption,
      adsorb,
    }

    // let fillX: number | undefined
    // let fillY: number | undefined

    // adsorptionVerticalLine.forEach(item => {
    //   if (Math.abs(item - rect.left) < this.adsorptionSize) {
    //     fillX = item
    //   }

    //   if (Math.abs(item - rect.right) < this.adsorptionSize) {
    //     fillX = item - rect.width
    //   }

    //   const center = rect.left + rect.width / 2

    //   if (Math.abs(item - center) < this.adsorptionSize) {
    //     fillX = item - rect.width / 2
    //   }
    // })

    // adsorptionHorizontalLine.forEach(item => {
    //   if (Math.abs(item - rect.top) < this.adsorptionSize) {
    //     fillY = item
    //   }

    //   if (Math.abs(item - rect.bottom) < this.adsorptionSize) {
    //     fillY = item - rect.height
    //   }

    //   const center = rect.top + rect.height / 2

    //   if (Math.abs(item - center) < this.adsorptionSize) {
    //     fillY = item - rect.height / 2
    //   }
    // })
  }

  @action
  resetAdsorptionLines() {
    this.adsorptionLines.verticalLines.clear()
    this.adsorptionLines.horizontalLines.clear()
  }
}
