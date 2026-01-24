import type { ComponentInstance } from '@easy-editor/core'
import type { GuideLine } from './designer/guideline'
import type { Alignment } from './designer/alignment'
import type { MarqueeSelection } from './designer/marquee-selection'

declare module '@easy-editor/core' {
  interface Designer {
    /**
     * 辅助线
     */
    guideline: GuideLine

    /**
     * 对齐功能
     */
    alignment: Alignment

    /**
     * 框选功能
     */
    marqueeSelection: MarqueeSelection
  }

  interface Document {
    /**
     * 将一批 Node 组合成 Group
     * TODO: Group 插入到哪里
     */
    group(nodeIdList: Node[] | string[]): Node | null

    /**
     * 取消组合
     * TODO: 取消组合后，Node 插入到哪里
     */
    ungroup(group: Node | string): void
  }

  interface Node {
    /**
     * 获取 dashboard 容器 DOM
     */
    getDashboardContainer(): HTMLElement | null

    /**
     * 获取 dashboard 位置信息
     */
    getDashboardRect(): DOMRect

    /**
     * 更新 dashboard 位置信息
     */
    updateDashboardRect(rect: Partial<DOMRect>): void

    /**
     * 是否是 Group
     */
    isGroup: boolean

    /**
     * 获取当前处于的 Group
     */
    getCurrentGroup(): Node | null

    /**
     * 获取最顶层的 Group
     */
    getTopGroup(): Node | null

    /**
     * 获取当前 Node 的所有 Group
     */
    getAllGroups(): Node[]

    /**
     * 获取当前 Group 下的 Node
     */
    getNodesInGroup(): Node[]

    /**
     * 获取当前 Group 下的所有 Node
     */
    getAllNodesInGroup(): Node[]

    /**
     * 移动到指定层级
     */
    moveToLevel(level: number): void

    /**
     * 置顶
     */
    levelTop(): void

    /**
     * 置底
     */
    levelBottom(): void

    /**
     * 上移一层
     */
    levelUp(): void

    /**
     * 下移一层
     */
    levelDown(): void
  }

  interface NodeSchema {
    /**
     * 是否是根节点
     */
    isRoot?: boolean

    /**
     * 是否是分组
     */
    isGroup?: boolean

    /**
     * dashboard 额外信息
     */
    $dashboard?: {
      /**
       * 位置信息
       */
      rect?: DashboardRect
    }
  }

  interface Simulator {
    /**
     * 获取 dashboard 配置
     */
    dashboardStyle: {
      /**
       * 组件是否显示 mask 遮罩层(在 design 模式下)
       * @default true
       */
      mask?: boolean
    }

    /**
     * 获取组件在 dashboard 中的位置
     */
    computeDashboardRect(node: Node): DOMRect

    /**
     * 获取组件实例在 dashboard 中的位置
     */
    computeComponentInstanceDashboardRect(instance: ComponentInstance): DOMRect
  }
}

export interface DashboardRect {
  x?: number
  y?: number
  width?: number
  height?: number
}
