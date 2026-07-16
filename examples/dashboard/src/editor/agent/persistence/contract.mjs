export const PERSISTENCE_LINEAGE_SCHEMA_VERSION = 1

export class PersistenceLineageContractError extends TypeError {
  constructor(reason, path = 'lineage') {
    super(`${path}: ${reason}`)
    this.name = 'PersistenceLineageContractError'
    this.code = 'INVALID_LINEAGE_DTO'
    this.reason = reason
    this.path = path
  }

  toJSON() {
    return {
      schemaVersion: PERSISTENCE_LINEAGE_SCHEMA_VERSION,
      code: this.code,
      reason: this.reason,
      path: this.path,
    }
  }
}

export const failContract = (reason, path) => {
  throw new PersistenceLineageContractError(reason, path)
}

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const ownDataValue = (value, key, path) => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return failContract('must-be-an-object', path)
  }
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !('value' in descriptor)) return failContract(`missing-${String(key)}`, path)
  return descriptor.value
}

export const optionalOwnDataValue = (value, key, path) => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor)) return failContract('accessor-properties-are-not-allowed', `${path}.${String(key)}`)
  return descriptor.value
}

export const assertExactRecord = (value, required, optional, path) => {
  if (!isPlainRecord(value)) return failContract('must-be-a-plain-object', path)

  const descriptors = Object.getOwnPropertyDescriptors(value)
  const symbolKeys = Object.getOwnPropertySymbols(value)
  if (symbolKeys.length > 0) return failContract('symbol-fields-are-not-allowed', path)

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      return failContract('fields-must-be-enumerable-data-properties', `${path}.${key}`)
    }
  }

  const actual = Object.keys(descriptors).sort(compareCodeUnits)
  const allowed = [...required, ...optional].sort(compareCodeUnits)
  for (const key of required) {
    if (!actual.includes(key)) return failContract(`missing-${key}`, path)
  }
  if (actual.length !== new Set(actual).size || actual.some(key => !allowed.includes(key))) {
    return failContract('fields-must-match-contract', path)
  }
  return value
}

export const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

export const requireSchemaVersion = (value, path) => {
  if (value !== PERSISTENCE_LINEAGE_SCHEMA_VERSION) return failContract('unsupported-schema-version', path)
  return value
}

export const requireNonEmptyString = (value, path) => {
  if (typeof value !== 'string' || value.length === 0) return failContract('must-be-a-non-empty-string', path)
  return value
}

export const requireNonNegativeInteger = (value, path) => {
  if (!Number.isSafeInteger(value) || value < 0) return failContract('must-be-a-non-negative-safe-integer', path)
  return value
}

export const requireSha256 = (value, path) => {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    return failContract('must-be-a-lowercase-sha256-digest', path)
  }
  return value
}

export const requireLiteral = (value, allowed, path) => {
  if (!allowed.includes(value)) return failContract(`must-be-one-of-${allowed.join('-')}`, path)
  return value
}

const cloneJsonArray = (value, path, ancestors) => {
  const keys = Reflect.ownKeys(value)
  const expectedKeys = Array.from({ length: value.length }, (_, index) => String(index))
  const dataKeys = keys.filter(key => key !== 'length')
  if (
    dataKeys.some(key => typeof key !== 'string') ||
    dataKeys.length !== expectedKeys.length ||
    dataKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return failContract('must-be-a-dense-json-array', path)
  }
  return expectedKeys.map((key, index) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return failContract('array-items-must-be-data-properties', `${path}[${index}]`)
    }
    return cloneJsonValueInternal(descriptor.value, `${path}[${index}]`, ancestors)
  })
}

const cloneJsonRecord = (value, path, ancestors) => {
  if (!isPlainRecord(value)) return failContract('must-be-json-data', path)
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string')) return failContract('symbol-fields-are-not-json', path)
  const entries = keys.sort(compareCodeUnits).map(key => {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return failContract('json-fields-must-be-enumerable-data-properties', `${path}.${key}`)
    }
    return [key, cloneJsonValueInternal(descriptor.value, `${path}.${key}`, ancestors)]
  })
  return Object.fromEntries(entries)
}

const cloneJsonValueInternal = (value, path, ancestors) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return failContract('numbers-must-be-finite', path)
    return value
  }
  if (typeof value !== 'object') return failContract('must-be-json-data', path)
  if (ancestors.has(value)) return failContract('cyclic-json-is-not-allowed', path)

  ancestors.add(value)
  try {
    return Array.isArray(value) ? cloneJsonArray(value, path, ancestors) : cloneJsonRecord(value, path, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

export const cloneJsonValue = (value, path = 'value') => cloneJsonValueInternal(value, path, new Set())

export const cloneJsonObject = (value, path = 'value') => {
  const cloned = cloneJsonValue(value, path)
  if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned)) {
    return failContract('must-be-a-json-object', path)
  }
  return cloned
}

export const canonicalJsonString = value => JSON.stringify(cloneJsonValue(value))

export const jsonDataEqual = (left, right) => {
  try {
    return canonicalJsonString(left) === canonicalJsonString(right)
  } catch {
    return false
  }
}

export const freezeDto = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const entry of Object.values(value)) freezeDto(entry)
  }
  return value
}
