export class OnlineComponentDependencyError extends Error {
  constructor(code, status, message, retryable = false) {
    super(message)
    this.name = 'OnlineComponentDependencyError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const SAFE_ERRORS = Object.freeze({
  'dependency-lock-drift': {
    status: 409,
    message: 'Online component dependency lock changed',
    retryable: false,
  },
  'dependency-unavailable': {
    status: 503,
    message: 'Online component dependency resolver is unavailable',
    retryable: true,
  },
  'destination-denied': { status: 403, message: 'Destination is not allowed', retryable: false },
  'invalid-request': { status: 400, message: 'Request is invalid', retryable: false },
  'request-aborted': { status: 408, message: 'Request was aborted', retryable: true },
  'upstream-failed': { status: 502, message: 'Upstream request failed', retryable: true },
  'upstream-response-invalid': { status: 502, message: 'Upstream response was rejected', retryable: false },
  'upstream-timeout': { status: 504, message: 'Upstream request timed out', retryable: true },
})

const ALLOWED_STATUSES = Object.freeze({
  'invalid-request': new Set([400, 403, 404, 405, 413, 415]),
})

export const toSafeDependencyError = error => {
  if (!(error instanceof OnlineComponentDependencyError)) {
    return new OnlineComponentDependencyError(
      'dependency-unavailable',
      503,
      SAFE_ERRORS['dependency-unavailable'].message,
      true,
    )
  }
  const policy = SAFE_ERRORS[error.code] ?? SAFE_ERRORS['dependency-unavailable']
  const statuses = ALLOWED_STATUSES[error.code]
  return new OnlineComponentDependencyError(
    Object.hasOwn(SAFE_ERRORS, error.code) ? error.code : 'dependency-unavailable',
    statuses?.has(error.status) ? error.status : policy.status,
    policy.message,
    policy.retryable,
  )
}

export const createDependencyErrorEnvelope = error => {
  const safe = toSafeDependencyError(error)
  return {
    status: safe.status,
    body: {
      schemaVersion: 1,
      error: { code: safe.code, message: safe.message, retryable: safe.retryable },
    },
  }
}
