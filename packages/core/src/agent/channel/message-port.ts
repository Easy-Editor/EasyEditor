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

interface ListenerRegistration {
  active: boolean
  readonly acquire: () => void
  readonly release: () => void
}

export interface AgentMessagePortListenerLease {
  listen(): void
  dispose(): void
}

const createRegistration = (acquire: () => void, release: () => void): ListenerRegistration => ({
  acquire,
  active: false,
  release,
})

const createLease = (port: AgentMessagePort, registrations: ListenerRegistration[]): AgentMessagePortListenerLease => {
  let listening = false

  const dispose = () => {
    const failures: unknown[] = []
    for (const registration of [...registrations].reverse()) {
      if (!registration.active) continue
      try {
        registration.release()
        registration.active = false
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Agent MessagePort listener disposal failed')
  }

  return {
    dispose,
    listen: () => {
      if (listening) return
      listening = true
      try {
        for (const registration of registrations) {
          // Publish provisional ownership before acquisition. Even an API that
          // registers and then throws is therefore cleaned up conservatively.
          registration.active = true
          registration.acquire()
        }
        port.start?.()
      } catch (error) {
        try {
          dispose()
        } catch (rollbackError) {
          const rollbackFailures = rollbackError instanceof AggregateError ? rollbackError.errors : [rollbackError]
          throw new AggregateError(
            [error, ...rollbackFailures],
            'Agent MessagePort listener acquisition rollback failed',
          )
        }
        throw error
      }
    },
  }
}

export const createAgentMessagePortListenerLease = (
  port: AgentMessagePort,
  onMessage: (value: unknown) => void,
  onMessageError: () => void,
  onClose: () => void,
): AgentMessagePortListenerLease => {
  const runtime = port as RuntimeMessagePort
  const message = (event: AgentMessageEvent) => onMessage(event.data)
  const messageError = () => onMessageError()
  const close = () => onClose()

  if (typeof runtime.addEventListener === 'function' && typeof runtime.removeEventListener === 'function') {
    const addEventListener = runtime.addEventListener.bind(runtime)
    const removeEventListener = runtime.removeEventListener.bind(runtime)
    return createLease(port, [
      createRegistration(
        () => addEventListener('message', message),
        () => removeEventListener('message', message),
      ),
      createRegistration(
        () => addEventListener('messageerror', messageError),
        () => removeEventListener('messageerror', messageError),
      ),
      createRegistration(
        () => addEventListener('close', close),
        () => removeEventListener('close', close),
      ),
    ])
  }
  if (typeof runtime.on === 'function' && typeof runtime.off === 'function') {
    const on = runtime.on.bind(runtime)
    const off = runtime.off.bind(runtime)
    const nodeMessage = (value: unknown) => onMessage(value)
    return createLease(port, [
      createRegistration(
        () => on('message', nodeMessage),
        () => off('message', nodeMessage),
      ),
      createRegistration(
        () => on('messageerror', messageError),
        () => off('messageerror', messageError),
      ),
      createRegistration(
        () => on('close', close),
        () => off('close', close),
      ),
    ])
  }
  if ('onmessage' in runtime) {
    const registrations = [
      createRegistration(
        () => {
          runtime.onmessage = message
        },
        () => {
          runtime.onmessage = null
        },
      ),
      createRegistration(
        () => {
          runtime.onmessageerror = messageError
        },
        () => {
          runtime.onmessageerror = null
        },
      ),
    ]
    if ('onclose' in runtime) {
      registrations.push(
        createRegistration(
          () => {
            runtime.onclose = close
          },
          () => {
            runtime.onclose = null
          },
        ),
      )
    }
    return createLease(port, registrations)
  }
  throw new Error('The Agent MessagePort does not expose a supported message listener API')
}

export const listenToAgentMessagePort = (
  port: AgentMessagePort,
  onMessage: (value: unknown) => void,
  onMessageError: () => void,
  onClose: () => void,
): (() => void) => {
  const lease = createAgentMessagePortListenerLease(port, onMessage, onMessageError, onClose)
  lease.listen()
  return lease.dispose
}
