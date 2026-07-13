import type { AgentMessagePort } from '../types'

interface AgentMessageEvent {
  readonly data: unknown
}

interface RuntimeMessagePort extends AgentMessagePort {
  addEventListener?: (type: string, listener: (event: AgentMessageEvent) => void) => void
  removeEventListener?: (type: string, listener: (event: AgentMessageEvent) => void) => void
  on?: (type: string, listener: (value: unknown) => void) => unknown
  off?: (type: string, listener: (value: unknown) => void) => unknown
  onmessage?: ((event: AgentMessageEvent) => void) | null
  onmessageerror?: ((event: unknown) => void) | null
  onclose?: ((event: unknown) => void) | null
}

export const listenToAgentMessagePort = (
  port: AgentMessagePort,
  onMessage: (value: unknown) => void,
  onMessageError: () => void,
  onClose: () => void,
): (() => void) => {
  const runtime = port as RuntimeMessagePort
  if (typeof runtime.addEventListener === 'function' && typeof runtime.removeEventListener === 'function') {
    const message = (event: AgentMessageEvent) => onMessage(event.data)
    const messageError = () => onMessageError()
    const close = () => onClose()
    runtime.addEventListener('message', message)
    runtime.addEventListener('messageerror', messageError)
    runtime.addEventListener('close', close)
    port.start?.()
    let listening = true
    return () => {
      if (!listening) return
      listening = false
      runtime.removeEventListener?.('message', message)
      runtime.removeEventListener?.('messageerror', messageError)
      runtime.removeEventListener?.('close', close)
    }
  }
  if (typeof runtime.on === 'function' && typeof runtime.off === 'function') {
    const message = (value: unknown) => onMessage(value)
    const messageError = () => onMessageError()
    const close = () => onClose()
    runtime.on('message', message)
    runtime.on('messageerror', messageError)
    runtime.on('close', close)
    port.start?.()
    let listening = true
    return () => {
      if (!listening) return
      listening = false
      runtime.off?.('message', message)
      runtime.off?.('messageerror', messageError)
      runtime.off?.('close', close)
    }
  }
  if ('onmessage' in runtime) {
    runtime.onmessage = event => onMessage(event.data)
    runtime.onmessageerror = () => onMessageError()
    if ('onclose' in runtime) runtime.onclose = () => onClose()
    port.start?.()
    let listening = true
    return () => {
      if (!listening) return
      listening = false
      runtime.onmessage = null
      runtime.onmessageerror = null
      if ('onclose' in runtime) runtime.onclose = null
    }
  }
  throw new Error('The Agent MessagePort does not expose a supported message listener API')
}
