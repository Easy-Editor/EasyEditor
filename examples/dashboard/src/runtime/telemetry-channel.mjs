const consumeRejectedThenable = value => {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return
  try {
    if (typeof value.then === 'function') void Promise.resolve(value).catch(() => undefined)
  } catch {
    // A hostile thenable cannot escape the passive telemetry boundary.
  }
}

export const createDashboardTelemetryChannel = (telemetry, clock = Date.now) => {
  if (telemetry !== undefined && telemetry !== null && typeof telemetry?.record !== 'function') {
    throw new TypeError('Dashboard telemetry must expose record')
  }
  const record = telemetry?.record
  if (!record) {
    return Object.freeze({
      enabled: false,
      start: () => null,
      emit: () => undefined,
    })
  }
  if (typeof clock !== 'function') throw new TypeError('Dashboard telemetry clock must be a function')
  const readTimestamp = () => {
    if (!record) return null
    try {
      const timestampMs = clock()
      return Number.isFinite(timestampMs) && timestampMs >= 0 ? timestampMs : null
    } catch {
      return null
    }
  }

  return Object.freeze({
    enabled: true,
    start: readTimestamp,
    emit(event, startedAt) {
      const timestampMs = readTimestamp()
      if (timestampMs === null) return
      try {
        const result = record.call(telemetry, {
          schemaVersion: 1,
          ...event,
          timestampMs,
          ...(Number.isFinite(startedAt) ? { durationMs: Math.max(0, timestampMs - startedAt) } : {}),
        })
        consumeRejectedThenable(result)
      } catch {
        // Telemetry is passive and cannot alter Dashboard behavior.
      }
    },
  })
}
