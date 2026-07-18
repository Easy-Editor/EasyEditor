const unsafeIdentifierCharacter = /[\p{C}\p{Z}]/u
const encoder = new TextEncoder()

export const createAgentTelemetryChangeSetId = (callId: string): string => {
  if (
    typeof callId !== 'string' ||
    callId.length < 1 ||
    callId.length > 256 ||
    unsafeIdentifierCharacter.test(callId)
  ) {
    throw new TypeError('Agent telemetry callId is invalid')
  }
  let encoded = ''
  for (const byte of encoder.encode(callId)) encoded += byte.toString(16).padStart(2, '0')
  return `change-set-v1-${encoded}`
}
