import type { ProtocolEnvelope } from './envelope.js'

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

export const createProtocolBusinessFingerprint = (envelope: ProtocolEnvelope): string => {
  const { sentAt: _sentAt, ...businessEnvelope } = envelope
  return JSON.stringify(canonicalize(businessEnvelope))
}
