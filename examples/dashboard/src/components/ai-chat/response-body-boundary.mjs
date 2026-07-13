const textDecoder = new TextDecoder('utf-8', { fatal: true })

export class ResponseBodyBudgetError extends Error {
  constructor(maxBytes) {
    super(`Response body exceeds the ${maxBytes}-byte budget`)
    this.name = 'ResponseBodyBudgetError'
    this.code = 'dashboard.agent.responseTooLarge'
  }
}

const assertBudget = maxBytes => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('maxBytes must be a positive safe integer')
}

const exceedsDeclaredLength = (response, maxBytes) => {
  const value = response.headers.get('content-length')
  if (value === null || !/^\d+$/.test(value)) return false
  return Number(value) > maxBytes
}

export const readResponseTextWithinBudget = async (response, maxBytes) => {
  assertBudget(maxBytes)
  if (!response.body) return ''

  const reader = response.body.getReader()
  try {
    if (exceedsDeclaredLength(response, maxBytes)) {
      try {
        await reader.cancel('response body budget exceeded')
      } catch {
        // Cancellation is best-effort; the trust boundary still rejects.
      }
      throw new ResponseBodyBudgetError(maxBytes)
    }

    const chunks = []
    let totalBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel('response body budget exceeded')
        } catch {
          // Cancellation is best-effort; the trust boundary still rejects.
        }
        throw new ResponseBodyBudgetError(maxBytes)
      }
      chunks.push(value)
    }

    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return textDecoder.decode(body)
  } finally {
    reader.releaseLock()
  }
}
