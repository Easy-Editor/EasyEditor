import { type PropsMap, TRANSFORM_STAGE } from '@easy-editor/core/instance'
import type { Node } from '@easy-editor/core/instance'
import { composeDashboardDataSource } from './composition'

/**
 * Adds the composed datasource only to the rendered root schema. SAVE and
 * SERIALIZE exports keep the user-authored legacy and safe catalog shapes.
 */
export const dashboardDataSourceRenderStage = TRANSFORM_STAGE.RENDER

export const createDashboardDataSourceRenderReducer = ({ safeDataEnabled = false } = {}) => {
  const awaitingRootExtras = new WeakSet<Node>()
  return (props: PropsMap, node: Node): PropsMap => {
    if (!node.isRoot) return props
    // Node.export(RENDER) invokes reducers for `props` and then `extras`
    // synchronously. Pairing those supported calls avoids guessing from keys,
    // which breaks for empty bags or the same key authored in both locations.
    if (!awaitingRootExtras.has(node)) {
      awaitingRootExtras.add(node)
      queueMicrotask(() => awaitingRootExtras.delete(node))
      return props
    }
    awaitingRootExtras.delete(node)

    try {
      return {
        ...props,
        dataSource: composeDashboardDataSource(
          node.document.project.get('dataSource'),
          node.getExtraPropValue('dataSource'),
          node.getPropValue('dataSources'),
          { safeDataEnabled },
        ),
      } as unknown as PropsMap
    } catch {
      // Renderer reducers are intentionally fault-contained by Core. Returning
      // an empty list here prevents invalid/colliding safe declarations from
      // falling through to a legacy network request.
      return { ...props, dataSource: { list: [] } } as unknown as PropsMap
    }
  }
}

export const dashboardDataSourceRenderReducer = createDashboardDataSourceRenderReducer()
