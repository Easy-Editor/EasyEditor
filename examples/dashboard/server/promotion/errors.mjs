export class MaterialRegistryError extends Error {
  constructor(code, status, message, retryable = false, details = undefined) {
    super(message)
    this.name = 'MaterialRegistryError'
    this.code = code
    this.status = status
    this.retryable = retryable
    if (details !== undefined) this.details = details
  }
}

export const registryError = (code, message, options = {}) =>
  new MaterialRegistryError(code, options.status ?? 500, message, options.retryable ?? false, options.details)

export const normalizeRegistryError = error => {
  if (error instanceof MaterialRegistryError) return error
  if (error?.code === 'EXDEV') {
    return registryError('registry-cross-device', 'Registry staging and publication must use the same filesystem', {
      status: 409,
    })
  }
  if (error?.code === 'ELOOP') {
    return registryError('registry-symlink-disallowed', 'Symbolic links are not allowed in registry inputs', {
      status: 400,
    })
  }
  if (error?.code === 'ENOENT') {
    return registryError('registry-record-not-found', 'Registry record was not found', { status: 404 })
  }
  return registryError('registry-unavailable', 'Material registry operation failed', {
    status: 503,
    retryable: true,
    details: error instanceof Error ? { cause: error.message } : undefined,
  })
}
