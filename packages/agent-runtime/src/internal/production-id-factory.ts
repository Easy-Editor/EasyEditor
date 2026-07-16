import type { IdFactory } from '../contracts.js'

const REALM_ENTROPY_BYTES = 16

let realmEntropy: string | undefined
let sequence = 0

const createRealmEntropy = (): string => {
  const cryptography = globalThis.crypto
  if (!cryptography?.getRandomValues) {
    throw new Error('Agent Runtime requires cryptographically secure random values for production IDs')
  }
  const bytes = cryptography.getRandomValues(new Uint8Array(REALM_ENTROPY_BYTES))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

const nextProductionId = (kind: Parameters<IdFactory['next']>[0]): string => {
  realmEntropy ??= createRealmEntropy()
  sequence += 1
  if (!Number.isSafeInteger(sequence)) {
    realmEntropy = createRealmEntropy()
    sequence = 1
  }
  return `${kind}-${realmEntropy}-${sequence.toString(36)}`
}

/**
 * Creates the production ID facade over a realm-wide unique sequence.
 *
 * Entropy separates independent Runtime and Worker realms, including reloads,
 * while the shared monotonic suffix prevents collisions between factory
 * instances in the same realm. IDs are correlation values, not bearer secrets.
 */
export const createProductionIdFactory = (): IdFactory => Object.freeze({ next: nextProductionId })
