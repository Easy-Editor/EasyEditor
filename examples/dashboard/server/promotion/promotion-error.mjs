export class MaterialPromotionError extends Error {
  constructor(code, status, message, retryable = false) {
    super(message)
    this.name = 'MaterialPromotionError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

export const promotionError = (code, status, message, retryable = false) =>
  new MaterialPromotionError(code, status, message, retryable)

export const invalidPromotionRequest = (status = 400) => promotionError('invalid-request', status, 'Request is invalid')

export const unavailablePromotion = () =>
  promotionError('promotion-unavailable', 503, 'Local material promotion is unavailable')

export const abortedPromotion = () =>
  promotionError('promotion-aborted', 408, 'Local material promotion was aborted', true)

export const throwIfPromotionAborted = signal => {
  if (signal?.aborted) throw abortedPromotion()
}

export const runPromotionPhase = (operation, signal) => {
  throwIfPromotionAborted(signal)
  if (!signal) return Promise.resolve().then(operation)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortedPromotion())
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export const normalizePromotionError = error => {
  if (
    error &&
    typeof error === 'object' &&
    typeof error.code === 'string' &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599 &&
    typeof error.message === 'string'
  ) {
    return promotionError(error.code, error.status, error.message, error.retryable === true)
  }
  return promotionError('promotion-failed', 503, 'Local material promotion failed', true)
}

export const createPromotionErrorEnvelope = error => {
  const failure = normalizePromotionError(error)
  return {
    status: failure.status,
    body: {
      schemaVersion: 1,
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
      },
    },
  }
}
