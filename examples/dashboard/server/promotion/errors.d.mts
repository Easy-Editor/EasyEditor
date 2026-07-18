export class MaterialRegistryError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly details?: unknown
  constructor(code: string, status: number, message: string, retryable?: boolean, details?: unknown)
}

export function registryError(
  code: string,
  message: string,
  options?: { status?: number; retryable?: boolean; details?: unknown },
): MaterialRegistryError
export function normalizeRegistryError(error: unknown): MaterialRegistryError
