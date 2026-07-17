import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AgentWorkspaceActiveTargetLayer, projectAgentWorkspaceActiveTargetLayer } from './ActiveTargetLayer'
import type { AgentWorkspaceTargetProjection } from './types'

const EDITOR_OVERLAY_MOUNT_SELECTOR = '[data-easy-editor-surface-overlay-mount="editor"]'

const findEditorOverlayMount = (): HTMLElement | null => {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>(EDITOR_OVERLAY_MOUNT_SELECTOR)
}

const useEditorOverlayMount = (enabled: boolean): HTMLElement | null => {
  const [discoveredMount, setDiscoveredMount] = useState<HTMLElement | null>(null)
  const currentMount = enabled ? findEditorOverlayMount() : null

  useEffect(() => {
    if (!enabled || currentMount || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      const nextMount = findEditorOverlayMount()
      if (!nextMount) return
      observer.disconnect()
      setDiscoveredMount(nextMount)
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [currentMount, enabled])

  if (!enabled) return null
  if (currentMount) return currentMount
  return discoveredMount?.isConnected ? discoveredMount : null
}

export interface AgentWorkspaceActiveTargetOverlayProps {
  readonly sessionId?: string
  readonly targets: readonly AgentWorkspaceTargetProjection[]
}

export const AgentWorkspaceActiveTargetOverlay = ({ sessionId, targets }: AgentWorkspaceActiveTargetOverlayProps) => {
  const projection = useMemo(() => projectAgentWorkspaceActiveTargetLayer({ sessionId, targets }), [sessionId, targets])
  const mount = useEditorOverlayMount(projection.targets.length > 0)
  if (!mount || projection.targets.length === 0) return null

  return createPortal(<AgentWorkspaceActiveTargetLayer projection={projection} />, mount, projection.sessionKey)
}
