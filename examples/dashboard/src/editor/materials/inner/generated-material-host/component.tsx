import type { NodeSchema } from '@easy-editor/core/instance'
import { type Ref, useCallback, useLayoutEffect, useRef } from 'react'
import {
  DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY,
  type DashboardOnlineComponentBindingHandle,
  type DashboardOnlineComponentBindingInput,
  type DashboardOnlineComponentSurfaceBridge,
} from '../../../../runtime/online-components/surface-bridge.mjs'

interface GeneratedMaterialHostAppHelper {
  readonly [DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY]?: DashboardOnlineComponentSurfaceBridge
}

interface GeneratedMaterialHostProps extends Readonly<Record<string, unknown>> {
  readonly ref?: Ref<HTMLDivElement>
  readonly __id?: string
  readonly __schema?: NodeSchema
  readonly __appHelper?: GeneratedMaterialHostAppHelper
}

const assignRef = (ref: Ref<HTMLDivElement> | undefined, element: HTMLDivElement | null) => {
  if (typeof ref === 'function') ref(element)
  else if (ref) ref.current = element
}

const GeneratedMaterialHost = (props: GeneratedMaterialHostProps) => {
  const { ref, __id: instanceId, __schema: node, __appHelper: appHelper } = props
  const elementRef = useRef<HTMLDivElement | null>(null)
  const bindingRef = useRef<DashboardOnlineComponentBindingHandle | null>(null)
  const bridge = appHelper?.[DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY]
  const latestInputRef = useRef({ node, props })
  latestInputRef.current = { node, props }
  const setElement = useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element
      assignRef(ref, element)
    },
    [ref],
  )

  useLayoutEffect(() => {
    const element = elementRef.current
    const current = latestInputRef.current
    if (!bridge || !instanceId || !current.node || !element) return
    const binding = bridge.connect({
      instanceId,
      node: current.node as DashboardOnlineComponentBindingInput['node'],
      props: current.props,
      element,
    })
    bindingRef.current = binding
    return () => {
      if (bindingRef.current === binding) bindingRef.current = null
      binding.dispose()
    }
  }, [bridge, instanceId])

  useLayoutEffect(() => {
    const element = elementRef.current
    if (!bindingRef.current || !node || !element) return
    bindingRef.current.update({
      node: node as DashboardOnlineComponentBindingInput['node'],
      props,
      element,
    })
  })

  return (
    <div
      ref={setElement}
      data-easy-editor-generated-material-host={instanceId}
      className='h-full w-full'
      style={{ background: 'transparent', pointerEvents: 'none' }}
    />
  )
}

export default GeneratedMaterialHost
