import { useRef } from 'react'
import type { ResizeRefs } from '../../shared/types'

/**
 * 缩放手柄 Refs 管理 Hook
 * 管理8个缩放手柄的 refs
 */
export function useResizeRefs(): ResizeRefs {
  const refs = useRef<ResizeRefs>({
    borderN: null,
    borderE: null,
    borderS: null,
    borderW: null,
    cornerNE: null,
    cornerNW: null,
    cornerSE: null,
    cornerSW: null,
  })

  return refs.current
}
