import {
  ONLINE_COMPONENT_PROTOCOL,
  ONLINE_COMPONENT_PROTOCOL_VERSION,
  OnlineComponentProtocolError,
} from './surface-protocol.mjs'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/
const EVENT_TYPES = new Set(['select', 'drag-start', 'drag-move', 'drag-end', 'activate'])
const EDITOR_DESIGN_EVENTS = new Set(['select', 'drag-start', 'drag-move', 'drag-end'])

const fail = (code, message) => {
  throw new OnlineComponentProtocolError(code, message)
}

const assertIdentifier = (value, name) => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) fail('invalid-identifier', `${name} is invalid`)
  return value
}

const finiteOrZero = value => (Number.isFinite(value) ? value : 0)

export const normalizeTrustedShellEvent = input => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('invalid-shell-event', 'shell event input must be an object')
  }
  const { mode, surfaceId, instanceId, type, event = {} } = input
  if (mode !== 'editor' && mode !== 'preview') fail('invalid-mode', 'mode must be editor or preview')
  if (!EVENT_TYPES.has(type)) fail('unsupported-shell-event', `shell event ${String(type)} is unsupported`)

  return Object.freeze({
    kind: ONLINE_COMPONENT_PROTOCOL.shellEvent,
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    surfaceId: assertIdentifier(surfaceId, 'surfaceId'),
    instanceId: assertIdentifier(instanceId, 'instanceId'),
    mode,
    type,
    pointer: Object.freeze({
      button: Number.isSafeInteger(event.button) ? event.button : 0,
      clientX: finiteOrZero(event.clientX),
      clientY: finiteOrZero(event.clientY),
      altKey: event.altKey === true,
      ctrlKey: event.ctrlKey === true,
      metaKey: event.metaKey === true,
      shiftKey: event.shiftKey === true,
    }),
  })
}

export const createTrustedShellEventAdapter = options => {
  const {
    mode,
    surfaceId,
    allowedRuntimeEvents = ['activate'],
    onSelection = () => {},
    onRuntimeEvent = () => {},
  } = options ?? {}
  if (mode !== 'editor' && mode !== 'preview') fail('invalid-mode', 'mode must be editor or preview')
  assertIdentifier(surfaceId, 'surfaceId')
  if (!Array.isArray(allowedRuntimeEvents)) {
    fail('invalid-event-allowlist', 'allowedRuntimeEvents must be an array')
  }
  const runtimeAllowlist = new Set(allowedRuntimeEvents)
  for (const type of runtimeAllowlist) {
    if (!EVENT_TYPES.has(type) || EDITOR_DESIGN_EVENTS.has(type)) {
      fail('invalid-event-allowlist', `runtime event ${String(type)} is unsupported`)
    }
  }
  if (typeof onSelection !== 'function' || typeof onRuntimeEvent !== 'function') {
    fail('invalid-event-handler', 'trusted shell handlers must be functions')
  }

  const dispatch = input => {
    const event = normalizeTrustedShellEvent({ ...input, mode, surfaceId })
    if (EDITOR_DESIGN_EVENTS.has(event.type)) {
      if (mode !== 'editor') fail('forbidden-design-event', 'preview surfaces cannot emit design events')
      onSelection(event)
      return event
    }
    if (!runtimeAllowlist.has(event.type)) {
      fail('event-not-allowed', `runtime event ${event.type} is not allowlisted`)
    }
    onRuntimeEvent(event)
    return event
  }

  return Object.freeze({ mode, surfaceId, dispatch })
}
