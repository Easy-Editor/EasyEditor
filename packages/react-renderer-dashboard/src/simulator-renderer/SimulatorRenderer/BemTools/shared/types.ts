import type { Designer, Node, Rect } from '@easy-editor/core'
import type { Direction } from '../drag-resize-engine'

/**
 * 缩放手柄的 Refs 集合
 */
export interface ResizeRefs {
  borderN: HTMLDivElement | null
  borderE: HTMLDivElement | null
  borderS: HTMLDivElement | null
  borderW: HTMLDivElement | null
  cornerNE: HTMLDivElement | null
  cornerNW: HTMLDivElement | null
  cornerSE: HTMLDivElement | null
  cornerSW: HTMLDivElement | null
}

/**
 * 缩放信息
 */
export interface ResizeInfo {
  node: Node
  direction: Direction
  moveX: number
  moveY: number
}

/**
 * 缩放选项
 */
export interface ResizeOptions {
  designer: Designer
  node: Node | null
  onStart?: (info: { direction: Direction; node: Node }) => void
  onResize?: (rect: Rect) => void
  onEnd?: (info: { direction: Direction; node: Node }) => void
}

/**
 * 点坐标
 */
export interface Point {
  x: number
  y: number
}
