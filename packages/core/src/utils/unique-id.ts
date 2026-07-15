const ID_ALPHABET = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'
const REALM_ENTROPY_BYTES = 12

let realmEntropy: string | undefined
let sequence = 0

const createRealmEntropy = (): string => {
  try {
    const cryptography = globalThis.crypto
    if (cryptography?.getRandomValues) {
      const bytes = cryptography.getRandomValues(new Uint8Array(REALM_ENTROPY_BYTES))
      return Array.from(bytes, byte => ID_ALPHABET[byte & 63]).join('')
    }
  } catch {
    // Hosts may expose an unusable crypto shim. Realm-local sequencing still preserves uniqueness below.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/**
 * Generates a realm-unique correlation ID.
 *
 * These IDs are not bearer secrets: runtime authority is held by closures and
 * host-side state. Entropy separates realms while the monotonic suffix
 * guarantees uniqueness within one realm, including Node 18 without global
 * Web Crypto.
 *
 * @param prefix an identifier prefix
 */
export const uniqueId = (prefix = '') => {
  realmEntropy ??= createRealmEntropy()
  sequence += 1
  if (!Number.isSafeInteger(sequence)) {
    realmEntropy = createRealmEntropy()
    sequence = 1
  }
  return `${prefix}-${realmEntropy}-${sequence.toString(36)}`
}
