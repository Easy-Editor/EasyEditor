import { resolveDashboardMaterialBindingValue } from '../../editor/data/binding-runtime.mjs'

const MAX_ARRAY_LENGTH = 512
const MAX_BYTES = 48 * 1024
const MAX_DEPTH = 12
const MAX_ENTRIES = 2_048
const MAX_OBJECT_KEYS = 128
const MAX_STRING_BYTES = 16 * 1024
const OMIT = Symbol('omit-online-component-context-value')
const INTERNAL_PROP_KEYS = new Set([
  'assets',
  'children',
  'data',
  'dataBindings',
  'ref',
  'theme',
  '__appHelper',
  '__components',
  '__dataSource',
  '__id',
  '__schema',
])
const ROOT_HOST_AUTHORITY_KEYS = new Set([
  'accesstoken',
  'authorization',
  'credentialref',
  'datasourceengine',
  'document',
  'engine',
  'refreshtoken',
  'window',
])
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const textEncoder = new TextEncoder()

const isRootHostAuthorityKey = key => ROOT_HOST_AUTHORITY_KEYS.has(key.toLowerCase().replaceAll(/[-_.]/gu, ''))

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

const ownDescriptors = value => {
  try {
    return Object.getOwnPropertyDescriptors(value)
  } catch {
    return undefined
  }
}

const hasEnumerableSymbols = value => {
  try {
    return Object.getOwnPropertySymbols(value).some(
      symbol => Object.getOwnPropertyDescriptor(value, symbol)?.enumerable,
    )
  } catch {
    return true
  }
}

const readOwnDataProperty = (descriptors, key) => {
  const descriptor = descriptors?.[key]
  return descriptor?.enumerable === true && 'value' in descriptor ? descriptor.value : undefined
}

const consumeText = (value, state) => {
  const bytes = textEncoder.encode(value).byteLength
  if (bytes > MAX_STRING_BYTES || state.bytes + bytes > MAX_BYTES) return false
  state.bytes += bytes
  return true
}

const cloneStrictJson = (value, state, depth) => {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : OMIT
  if (typeof value === 'string') return consumeText(value, state) ? value : OMIT
  if (typeof value !== 'object' || depth > MAX_DEPTH || state.seen.has(value)) return OMIT
  if (state.entries >= MAX_ENTRIES || hasEnumerableSymbols(value)) return OMIT

  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) return OMIT
      const descriptors = ownDescriptors(value)
      if (!descriptors) return OMIT
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === 'length' || !descriptor.enumerable) continue
        if (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) return OMIT
      }
      const cloned = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[index]
        if (!descriptor?.enumerable || !('value' in descriptor)) return OMIT
        state.entries += 1
        if (state.entries > MAX_ENTRIES) return OMIT
        const child = cloneStrictJson(descriptor.value, state, depth + 1)
        if (child === OMIT) return OMIT
        cloned.push(child)
      }
      return Object.freeze(cloned)
    }

    if (!isPlainRecord(value)) return OMIT
    const descriptors = ownDescriptors(value)
    if (!descriptors) return OMIT
    const entries = Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable)
    if (entries.length > MAX_OBJECT_KEYS) return OMIT
    const cloned = {}
    for (const [key, descriptor] of entries) {
      if (!('value' in descriptor) || UNSAFE_JSON_KEYS.has(key)) return OMIT
      state.entries += 1
      if (state.entries > MAX_ENTRIES || !consumeText(key, state)) return OMIT
      const child = cloneStrictJson(descriptor.value, state, depth + 1)
      if (child === OMIT) return OMIT
      cloned[key] = child
    }
    return Object.freeze(cloned)
  } finally {
    state.seen.delete(value)
  }
}

const sanitizeContextField = (value, fallback) => {
  const cloned = cloneStrictJson(value, { bytes: 0, entries: 0, seen: new Set() }, 0)
  if (cloned === OMIT) return fallback
  try {
    return textEncoder.encode(JSON.stringify(cloned)).byteLength <= MAX_BYTES ? cloned : fallback
  } catch {
    return fallback
  }
}

const assertProps = props => {
  if (!isPlainRecord(props)) throw new TypeError('online component props must be a plain object')
  return props
}

export const sanitizeDashboardOnlineComponentProps = props => {
  const value = assertProps(props)
  const descriptors = ownDescriptors(value)
  if (!descriptors) throw new TypeError('online component props could not be inspected safely')
  if (hasEnumerableSymbols(value)) return Object.freeze({})
  const projected = {}
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue
    if (INTERNAL_PROP_KEYS.has(key) || key.startsWith('__') || isRootHostAuthorityKey(key)) continue
    if (!('value' in descriptor)) return Object.freeze({})
    if (UNSAFE_JSON_KEYS.has(key)) continue
    const child = descriptor.value
    if (child === undefined || typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint')
      continue
    if (typeof child === 'object' && child !== null && !Array.isArray(child) && !isPlainRecord(child)) continue
    projected[key] = child
  }
  return sanitizeContextField(projected, Object.freeze({}))
}

export const resolveDashboardOnlineComponentContext = props => {
  const value = assertProps(props)
  const descriptors = ownDescriptors(value)
  if (!descriptors) throw new TypeError('online component props could not be inspected safely')
  const manualData = readOwnDataProperty(descriptors, 'data') ?? null
  const resolvedData = resolveDashboardMaterialBindingValue({
    bindingField: 'data',
    dataBindings: readOwnDataProperty(descriptors, 'dataBindings'),
    dataSource: readOwnDataProperty(descriptors, '__dataSource'),
    fallback: manualData,
  })
  const theme = sanitizeContextField(readOwnDataProperty(descriptors, 'theme'), Object.freeze({}))
  const assets = sanitizeContextField(readOwnDataProperty(descriptors, 'assets'), Object.freeze([]))
  return Object.freeze({
    props: sanitizeDashboardOnlineComponentProps(value),
    data: sanitizeContextField(resolvedData, null),
    theme: isPlainRecord(theme) ? theme : Object.freeze({}),
    assets: Array.isArray(assets) ? assets : Object.freeze([]),
  })
}
