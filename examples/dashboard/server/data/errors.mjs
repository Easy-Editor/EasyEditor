export class DataProxyError extends Error {
  constructor(code, status, message, retryable = false) {
    super(message)
    this.name = 'DataProxyError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const SAFE_ERROR_POLICIES = Object.freeze({
  'credential-unavailable': {
    message: 'Credential is unavailable',
    statuses: new Set([403, 503]),
    defaultStatus: 503,
    retryable: false,
  },
  'destination-denied': {
    message: 'Destination is not allowed',
    statuses: new Set([403]),
    defaultStatus: 403,
    retryable: false,
  },
  'invalid-request': {
    message: 'Request is invalid',
    statuses: new Set([400, 403, 404, 405, 413, 415]),
    defaultStatus: 400,
    retryable: false,
  },
  'request-aborted': {
    message: 'Request was aborted',
    statuses: new Set([408]),
    defaultStatus: 408,
    retryable: true,
  },
  unauthorized: {
    message: 'Request is not authorized',
    statuses: new Set([401, 403]),
    defaultStatus: 401,
    retryable: false,
  },
  'upstream-failed': {
    message: 'Upstream request failed',
    statuses: new Set([502]),
    defaultStatus: 502,
    retryable: true,
  },
  'upstream-response-invalid': {
    message: 'Upstream response was rejected',
    statuses: new Set([502]),
    defaultStatus: 502,
    retryable: false,
  },
  'upstream-timeout': {
    message: 'Upstream request timed out',
    statuses: new Set([504]),
    defaultStatus: 504,
    retryable: true,
  },
})

export const toSafeError = error => {
  const policy = error instanceof DataProxyError ? SAFE_ERROR_POLICIES[error.code] : undefined
  if (policy) {
    return new DataProxyError(
      error.code,
      policy.statuses.has(error.status) ? error.status : policy.defaultStatus,
      policy.message,
      policy.retryable,
    )
  }
  return new DataProxyError('upstream-failed', 502, 'Upstream request failed', true)
}

export const createErrorEnvelope = error => {
  const safe = toSafeError(error)
  return {
    status: safe.status,
    body: {
      schemaVersion: 1,
      error: { code: safe.code, message: safe.message, retryable: safe.retryable },
    },
  }
}
