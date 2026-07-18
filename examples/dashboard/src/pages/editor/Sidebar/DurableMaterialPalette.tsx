import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Card, CardContent } from '@/components/ui/card'
import {
  type DashboardDurableCatalogMaterialV1,
  createDurableMaterialSnippet,
} from '@/editor/agent/capabilities/promotion/index.mjs'
import { dashboardLocalMaterialCatalogRuntime, engine } from '@/editor/runtime'
import type { Snippet } from '@easy-editor/core'
import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

export const DURABLE_MATERIAL_ACCORDION_VALUE = 'DURABLE_MATERIALS'

const unavailableLabel = (reason: DashboardDurableCatalogMaterialV1['unavailableReason']) => {
  switch (reason) {
    case 'artifact-missing':
      return '源制品已缺失'
    case 'artifact-unreadable':
      return '源制品暂不可读取'
    case 'artifact-invalid':
      return '源制品完整性校验失败'
    case 'artifact-identity-mismatch':
      return '源制品身份不匹配'
    default:
      return '当前不可用'
  }
}

const DurableMaterialSnippet = ({ material }: { material: DashboardDurableCatalogMaterialV1 }) => {
  const ref = useRef<HTMLDivElement>(null)
  const snippet = useMemo<Readonly<Snippet> | null>(
    () => (material.availability === 'available' ? createDurableMaterialSnippet(material) : null),
    [material],
  )

  useEffect(() => {
    const element = ref.current
    if (!element || !snippet) return
    const unlink = engine.project.simulator?.linkSnippet(element, snippet)
    return () => unlink?.()
  }, [snippet])

  const unavailable = material.availability !== 'available'
  return (
    <Card
      ref={ref}
      aria-disabled={unavailable}
      className={
        unavailable
          ? 'select-none aspect-square border-dashed opacity-55'
          : 'cursor-move select-none aspect-square hover:scale-105 transition-all duration-300'
      }
    >
      <CardContent className='flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center'>
        <span className='w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium'>
          {material.title}
        </span>
        <span className='max-w-full truncate font-mono text-[10px] text-muted-foreground'>
          {material.artifactRef.target.materialVersion}
        </span>
        {unavailable && (
          <span className='text-[10px] leading-tight text-destructive'>
            {unavailableLabel(material.unavailableReason)}
          </span>
        )}
      </CardContent>
    </Card>
  )
}

export const DurableMaterialPalette = () => {
  const snapshot = useSyncExternalStore(
    dashboardLocalMaterialCatalogRuntime.subscribe,
    dashboardLocalMaterialCatalogRuntime.getSnapshot,
    dashboardLocalMaterialCatalogRuntime.getSnapshot,
  )

  if (snapshot.status === 'disabled') return null

  return (
    <AccordionItem value={DURABLE_MATERIAL_ACCORDION_VALUE}>
      <AccordionTrigger>
        <span className='flex items-center gap-2'>
          本地耐久物料
          {snapshot.status === 'ready' && (
            <span className='text-xs text-muted-foreground'>({snapshot.materials.length})</span>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent className='transition-all data-[state=closed]:animate-[accordion-up_300ms_ease-out] data-[state=open]:animate-[accordion-down_400ms_ease-out]'>
        {snapshot.status === 'loading' && (
          <div className='px-2 py-4 text-center text-xs text-muted-foreground'>正在读取耐久物料…</div>
        )}
        {(snapshot.status === 'error' || snapshot.status === 'fail-closed') && (
          <div className='flex flex-col items-center gap-2 px-2 py-4 text-center'>
            <span className='text-xs text-destructive'>
              {snapshot.status === 'fail-closed' ? '物料目录校验失败，已安全停用' : '物料目录暂不可用'}
            </span>
            <button
              type='button'
              className='inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
              onClick={() => void dashboardLocalMaterialCatalogRuntime.refresh()}
            >
              <RefreshCw className='h-3 w-3' />
              重试
            </button>
          </div>
        )}
        {snapshot.status === 'ready' && snapshot.materials.length === 0 && (
          <div className='px-2 py-4 text-center text-xs text-muted-foreground'>当前项目还没有已发布物料</div>
        )}
        {snapshot.status === 'ready' && snapshot.materials.length > 0 && (
          <div className='grid grid-cols-2 gap-2 p-2'>
            {snapshot.materials.map(material => (
              <DurableMaterialSnippet
                key={`${material.artifactRef.target.materialId}:${material.artifactRef.target.materialVersion}:${material.artifactRef.target.buildIntegrity}`}
                material={material}
              />
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}
