export const DEFAULT_DASHBOARD_DATA_LIMITS = Object.freeze({
  maxArrayLength: 2_000,
  maxBytes: 256 * 1024,
  maxDepth: 24,
  maxFields: 128,
  maxNodes: 20_000,
  maxPathSegments: 16,
  maxRows: 500,
  maxSources: 100,
  maxStringLength: 16_384,
  timeoutMs: 5_000,
})

const LIMIT_KEYS = Object.freeze(Object.keys(DEFAULT_DASHBOARD_DATA_LIMITS))
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u
const DATA_KINDS = Object.freeze(['credentialed-http-json', 'mock', 'public-http-json', 'static'])
const HTTP_METHODS = Object.freeze(['GET', 'POST'])
const TRANSFORM_OPERATIONS = Object.freeze(['filter', 'limit', 'project', 'select', 'sort', 'take'])
const NON_PUBLIC_HOSTNAME_SUFFIXES = Object.freeze([
  '.home.arpa',
  '.internal',
  '.lan',
  '.local',
  '.localdomain',
  '.localhost',
])

export class DashboardDataCapabilityError extends TypeError {
  constructor(code, reason, path = 'data') {
    super(`${path}: ${reason}`)
    this.name = 'DashboardDataCapabilityError'
    this.code = code
    this.reason = reason
    this.path = path
  }

  toJSON() {
    return { schemaVersion: 1, code: this.code, reason: this.reason, path: this.path }
  }
}

const fail = (reason, path, code = 'INVALID_DATA_DESCRIPTOR') => {
  throw new DashboardDataCapabilityError(code, reason, path)
}

const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  let prototype
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    return false
  }
  return prototype === Object.prototype || prototype === null
}

const descriptorsFor = (value, path) => {
  try {
    return Object.getOwnPropertyDescriptors(value)
  } catch {
    return fail('object-could-not-be-inspected-safely', path)
  }
}

const assertExactRecord = (value, required, optional, path) => {
  if (!isPlainRecord(value)) return fail('must-be-a-plain-object', path)
  const descriptors = descriptorsFor(value, path)
  let symbols
  try {
    symbols = Object.getOwnPropertySymbols(value)
  } catch {
    return fail('object-could-not-be-inspected-safely', path)
  }
  if (symbols.length > 0) return fail('symbol-properties-are-not-allowed', path)
  const allowed = new Set([...required, ...optional])
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      return fail('properties-must-be-enumerable-data-properties', `${path}.${key}`)
    }
    if (!allowed.has(key)) return fail('fields-must-match-contract', `${path}.${key}`)
  }
  for (const key of required) {
    if (!Object.hasOwn(descriptors, key)) return fail(`missing-${key}`, path)
  }
  return descriptors
}

const ownValue = (value, key, path, optional = false) => {
  let descriptor
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('object-could-not-be-inspected-safely', path)
  }
  if (!descriptor) {
    if (optional) return undefined
    return fail(`missing-${String(key)}`, path)
  }
  if (!descriptor.enumerable || !('value' in descriptor)) {
    return fail('properties-must-be-enumerable-data-properties', `${path}.${String(key)}`)
  }
  return descriptor.value
}

const requireString = (value, path, limits, { maximum = limits.maxStringLength } = {}) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    return fail('must-be-a-bounded-non-empty-string', path)
  }
  return value
}

const requireSafeIdentifier = (value, path, limits, options) => {
  const normalized = requireString(value, path, limits, options)
  if (DANGEROUS_KEYS.has(normalized) || !SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    return fail('must-be-a-bounded-safe-identifier', path)
  }
  return normalized
}

const normalizeLimits = options => {
  if (options === undefined) return DEFAULT_DASHBOARD_DATA_LIMITS
  const limitsValue =
    isPlainRecord(options) && Object.hasOwn(options, 'limits')
      ? ownValue(options, 'limits', 'options')
      : isPlainRecord(options) && Object.keys(options).some(key => !LIMIT_KEYS.includes(key))
        ? DEFAULT_DASHBOARD_DATA_LIMITS
        : options
  if (!isPlainRecord(limitsValue)) throw new TypeError('data limits must be a plain object')
  const descriptors = descriptorsFor(limitsValue, 'limits')
  const normalized = { ...DEFAULT_DASHBOARD_DATA_LIMITS }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor) || !LIMIT_KEYS.includes(key)) {
      throw new TypeError(`Unsupported data limit: ${key}`)
    }
    if (!Number.isSafeInteger(descriptor.value) || descriptor.value <= 0) {
      throw new TypeError(`Data limit ${key} must be a positive safe integer`)
    }
    normalized[key] = descriptor.value
  }
  return Object.freeze(normalized)
}

const cloneJsonInternal = (value, path, state, depth) => {
  state.nodes += 1
  if (state.nodes > state.limits.maxNodes) return fail('json-node-budget-exceeded', path, 'DATA_BUDGET_EXCEEDED')
  if (depth > state.limits.maxDepth) return fail('json-depth-budget-exceeded', path, 'DATA_BUDGET_EXCEEDED')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail('numbers-must-be-finite', path)
    return value
  }
  if (typeof value === 'string') {
    if (value.length > state.limits.maxStringLength) {
      return fail('json-string-budget-exceeded', path, 'DATA_BUDGET_EXCEEDED')
    }
    return value
  }
  if (typeof value !== 'object' || value === null) return fail('must-be-json-data', path)
  if (state.ancestors.has(value)) return fail('cyclic-json-is-not-allowed', path)
  state.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > state.limits.maxArrayLength) {
        return fail('array-budget-exceeded', path, 'DATA_BUDGET_EXCEEDED')
      }
      let keys
      try {
        keys = Reflect.ownKeys(value)
      } catch {
        return fail('array-could-not-be-inspected-safely', path)
      }
      const expected = Array.from({ length: value.length }, (_, index) => String(index))
      const actual = keys.filter(key => key !== 'length')
      if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        return fail('must-be-a-dense-json-array', path)
      }
      return expected.map((key, index) =>
        cloneJsonInternal(ownValue(value, key, `${path}[${index}]`), `${path}[${index}]`, state, depth + 1),
      )
    }
    if (!isPlainRecord(value)) return fail('must-be-json-data-with-a-plain-prototype', path)
    const descriptors = descriptorsFor(value, path)
    const keys = Object.keys(descriptors).sort(compareCodeUnits)
    const output = {}
    for (const key of keys) {
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return fail('json-fields-must-be-enumerable-data-properties', `${path}.${key}`)
      }
      if (DANGEROUS_KEYS.has(key)) return fail('dangerous-property-is-not-allowed', `${path}.${key}`)
      if (key.length > state.limits.maxStringLength) {
        return fail('json-key-budget-exceeded', `${path}.${key}`, 'DATA_BUDGET_EXCEEDED')
      }
      output[key] = cloneJsonInternal(descriptor.value, `${path}.${key}`, state, depth + 1)
    }
    return output
  } finally {
    state.ancestors.delete(value)
  }
}

const cloneJson = (value, path, limits) => {
  const cloned = cloneJsonInternal(value, path, { ancestors: new Set(), limits, nodes: 0 }, 0)
  if (new TextEncoder().encode(JSON.stringify(cloned)).byteLength > limits.maxBytes) {
    return fail('json-byte-budget-exceeded', path, 'DATA_BUDGET_EXCEEDED')
  }
  return cloned
}

const assertNestedRowBudget = (value, path, limits, state = { rows: 0 }) => {
  if (Array.isArray(value)) {
    state.rows += value.length
    if (state.rows > limits.maxRows) return fail('row-budget-exceeded', path, 'DATA_BUDGET_EXCEEDED')
    for (let index = 0; index < value.length; index += 1) {
      assertNestedRowBudget(value[index], `${path}[${index}]`, limits, state)
    }
    return value
  }
  if (isPlainRecord(value)) {
    for (const key of Object.keys(value)) assertNestedRowBudget(value[key], `${path}.${key}`, limits, state)
  }
  return value
}

const cloneDataJson = (value, path, limits) => assertNestedRowBudget(cloneJson(value, path, limits), path, limits)

const freezeJson = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezeJson(child)
  return Object.freeze(value)
}

const parsePath = (value, path, limits) => {
  if (!Array.isArray(value) || value.length > limits.maxPathSegments) return fail('must-be-a-bounded-path', path)
  return value.map((segment, index) => {
    const normalized = requireString(segment, `${path}[${index}]`, limits, { maximum: 128 })
    if (DANGEROUS_KEYS.has(normalized)) return fail('dangerous-path-segment-is-not-allowed', `${path}[${index}]`)
    return normalized
  })
}

const parsePrimitive = (value, path) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fail('must-be-a-json-primitive', path)
}

const parseTransformStep = (value, index, limits) => {
  const path = `descriptor.transform[${index}]`
  const op = ownValue(value, 'op', path)
  if (!TRANSFORM_OPERATIONS.includes(op)) return fail('unsupported-transform-operation', `${path}.op`)
  if (op === 'select') {
    assertExactRecord(value, ['op', 'path'], [], path)
    return { op, path: parsePath(ownValue(value, 'path', path), `${path}.path`, limits) }
  }
  if (op === 'project') {
    assertExactRecord(value, ['op', 'fields'], [], path)
    const fields = ownValue(value, 'fields', path)
    if (!isPlainRecord(fields)) return fail('project-fields-must-be-a-plain-object', `${path}.fields`)
    const descriptors = descriptorsFor(fields, `${path}.fields`)
    const keys = Object.keys(descriptors).sort(compareCodeUnits)
    if (keys.length === 0 || keys.length > limits.maxFields)
      return fail('project-field-budget-exceeded', `${path}.fields`)
    const normalized = {}
    for (const key of keys) {
      if (DANGEROUS_KEYS.has(key) || !key || key.length > 128)
        return fail('project-field-name-is-invalid', `${path}.fields`)
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return fail('project-fields-must-be-enumerable-data-properties', `${path}.fields.${key}`)
      }
      normalized[key] = parsePath(descriptor.value, `${path}.fields.${key}`, limits)
    }
    return { op, fields: normalized }
  }
  if (op === 'filter') {
    assertExactRecord(value, ['op', 'path', 'operator', 'value'], [], path)
    const operator = ownValue(value, 'operator', path)
    if (!['eq', 'gte', 'gt', 'lte', 'lt', 'ne'].includes(operator)) {
      return fail('unsupported-filter-operator', `${path}.operator`)
    }
    return {
      op,
      path: parsePath(ownValue(value, 'path', path), `${path}.path`, limits),
      operator,
      value: parsePrimitive(ownValue(value, 'value', path), `${path}.value`),
    }
  }
  if (op === 'sort') {
    assertExactRecord(value, ['op', 'path'], ['direction'], path)
    const direction = ownValue(value, 'direction', path, true) ?? 'asc'
    if (direction !== 'asc' && direction !== 'desc') return fail('sort-direction-is-invalid', `${path}.direction`)
    return { op, path: parsePath(ownValue(value, 'path', path), `${path}.path`, limits), direction }
  }
  assertExactRecord(value, ['op', 'count'], [], path)
  const count = ownValue(value, 'count', path)
  if (!Number.isSafeInteger(count) || count < 0 || count > limits.maxRows) {
    return fail('transform-count-is-out-of-range', `${path}.count`)
  }
  return { op, count }
}

export const parseSafeDataTransform = (value, options) => {
  if (value === undefined) return undefined
  const limits = normalizeLimits(options)
  if (!Array.isArray(value) || value.length > 32)
    return fail('transform-must-be-a-bounded-array', 'descriptor.transform')
  const normalized = value.map((step, index) => parseTransformStep(step, index, limits))
  return freezeJson(cloneJson(normalized, 'descriptor.transform', limits))
}

const normalizeRequestUrl = (value, path, limits) => {
  const url = requireString(value, path, limits, { maximum: 2_048 })
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return fail('request-url-is-invalid', path)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    return fail('request-url-is-not-an-authorized-http-destination-shape', path)
  }
  return parsed
}

const assertPublicHttpDestination = (parsed, path) => {
  if (parsed.protocol !== 'https:') return fail('public-request-must-use-https', path)
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
  const isIpv4Literal = /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname)
  const isIpv6Literal = hostname.includes(':')
  const isLocalName =
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    hostname === 'metadata' ||
    hostname === 'instance-data' ||
    NON_PUBLIC_HOSTNAME_SUFFIXES.some(suffix => hostname.endsWith(suffix))
  // Browser fetch does not expose DNS answers, so this lexical guard cannot pin a public hostname to an IP.
  // Credentialed requests use the same-origin server proxy, where DNS pinning and redirect checks are enforceable.
  if (isIpv4Literal || isIpv6Literal || isLocalName) {
    return fail('public-request-destination-is-not-public', path)
  }
}

const parseCredentialedRequest = (value, path, limits) => {
  assertExactRecord(value, ['url', 'method'], ['body'], path)
  const parsed = normalizeRequestUrl(ownValue(value, 'url', path), `${path}.url`, limits)
  const method = ownValue(value, 'method', path)
  if (!HTTP_METHODS.includes(method)) return fail('request-method-is-not-allowed', `${path}.method`)
  const bodyValue = ownValue(value, 'body', path, true)
  if (method === 'GET' && bodyValue !== undefined) return fail('get-request-forbids-a-body', `${path}.body`)
  return {
    url: parsed.href,
    method,
    ...(bodyValue === undefined ? {} : { body: cloneJson(bodyValue, `${path}.body`, limits) }),
  }
}

const parsePublicRequest = (value, path, limits) => {
  assertExactRecord(value, ['url', 'method'], [], path)
  const parsed = normalizeRequestUrl(ownValue(value, 'url', path), `${path}.url`, limits)
  assertPublicHttpDestination(parsed, `${path}.url`)
  if (ownValue(value, 'method', path) !== 'GET') {
    return fail('public-request-method-must-be-get', `${path}.method`)
  }
  return { url: parsed.href, method: 'GET' }
}

export const parseSafeDataDescriptor = (value, options) => {
  const limits = normalizeLimits(options)
  assertExactRecord(
    value,
    ['schemaVersion', 'id', 'kind'],
    ['credentialRef', 'fixture', 'providerId', 'request', 'transform', 'value'],
    'descriptor',
  )
  if (ownValue(value, 'schemaVersion', 'descriptor') !== 1)
    return fail('unsupported-schema-version', 'descriptor.schemaVersion')
  const id = requireSafeIdentifier(ownValue(value, 'id', 'descriptor'), 'descriptor.id', limits, { maximum: 128 })
  const kind = ownValue(value, 'kind', 'descriptor')
  if (!DATA_KINDS.includes(kind)) return fail('unsupported-data-kind', 'descriptor.kind')
  const transformValue = ownValue(value, 'transform', 'descriptor', true)
  const common = {
    schemaVersion: 1,
    id,
    kind,
    ...(transformValue === undefined ? {} : { transform: parseSafeDataTransform(transformValue, { limits }) }),
  }
  let normalized
  if (kind === 'static') {
    assertExactRecord(value, ['schemaVersion', 'id', 'kind', 'value'], ['transform'], 'descriptor')
    normalized = { ...common, value: cloneDataJson(ownValue(value, 'value', 'descriptor'), 'descriptor.value', limits) }
  } else if (kind === 'mock') {
    assertExactRecord(value, ['schemaVersion', 'id', 'kind', 'fixture'], ['transform'], 'descriptor')
    normalized = {
      ...common,
      fixture: cloneDataJson(ownValue(value, 'fixture', 'descriptor'), 'descriptor.fixture', limits),
    }
  } else if (kind === 'public-http-json') {
    assertExactRecord(value, ['schemaVersion', 'id', 'kind', 'request'], ['transform'], 'descriptor')
    normalized = {
      ...common,
      request: parsePublicRequest(ownValue(value, 'request', 'descriptor'), 'descriptor.request', limits),
    }
  } else {
    assertExactRecord(
      value,
      ['schemaVersion', 'id', 'kind', 'providerId', 'credentialRef', 'request'],
      ['transform'],
      'descriptor',
    )
    normalized = {
      ...common,
      providerId: requireSafeIdentifier(ownValue(value, 'providerId', 'descriptor'), 'descriptor.providerId', limits, {
        maximum: 128,
      }),
      credentialRef: requireSafeIdentifier(
        ownValue(value, 'credentialRef', 'descriptor'),
        'descriptor.credentialRef',
        limits,
        { maximum: 256 },
      ),
      request: parseCredentialedRequest(ownValue(value, 'request', 'descriptor'), 'descriptor.request', limits),
    }
  }
  return freezeJson(cloneJson(normalized, 'descriptor', limits))
}

export const parseSafeDataCatalog = (value, options) => {
  const limits = normalizeLimits(options)
  if (value === undefined) return Object.freeze({ schemaVersion: 1, sources: Object.freeze([]) })
  assertExactRecord(value, ['schemaVersion', 'sources'], [], 'dataSources')
  if (ownValue(value, 'schemaVersion', 'dataSources') !== 1)
    return fail('unsupported-schema-version', 'dataSources.schemaVersion')
  const sources = ownValue(value, 'sources', 'dataSources')
  if (!Array.isArray(sources) || sources.length > limits.maxSources)
    return fail('source-count-budget-exceeded', 'dataSources.sources')
  const normalized = sources.map((descriptor, index) => parseSafeDataDescriptor(descriptor, { limits }))
  normalized.sort((left, right) => compareCodeUnits(left.id, right.id))
  if (normalized.some((descriptor, index) => index > 0 && descriptor.id === normalized[index - 1].id)) {
    return fail('source-ids-must-be-unique', 'dataSources.sources')
  }
  return freezeJson(cloneJson({ schemaVersion: 1, sources: normalized }, 'dataSources', limits))
}

export const parseSafeDataBinding = (value, options) => {
  const limits = normalizeLimits(options)
  assertExactRecord(value, ['sourceId'], ['transform'], 'binding')
  const transformValue = ownValue(value, 'transform', 'binding', true)
  return freezeJson({
    sourceId: requireSafeIdentifier(ownValue(value, 'sourceId', 'binding'), 'binding.sourceId', limits, {
      maximum: 128,
    }),
    ...(transformValue === undefined ? {} : { transform: parseSafeDataTransform(transformValue, { limits }) }),
  })
}

export const parseSafeDataBindings = (value, options) => {
  const limits = normalizeLimits(options)
  assertExactRecord(value, ['schemaVersion', 'fields'], [], 'dataBindings')
  if (ownValue(value, 'schemaVersion', 'dataBindings') !== 1) {
    return fail('unsupported-schema-version', 'dataBindings.schemaVersion')
  }
  const fieldsValue = ownValue(value, 'fields', 'dataBindings')
  if (!isPlainRecord(fieldsValue)) return fail('fields-must-be-a-plain-object', 'dataBindings.fields')
  const descriptors = descriptorsFor(fieldsValue, 'dataBindings.fields')
  const fields = {}
  for (const [field, descriptor] of Object.entries(descriptors).sort(([left], [right]) =>
    compareCodeUnits(left, right),
  )) {
    if (field !== 'text' && field !== 'data') return fail('fields-must-match-contract', `dataBindings.fields.${field}`)
    if (!descriptor.enumerable || !('value' in descriptor)) {
      return fail('fields-must-be-enumerable-data-properties', `dataBindings.fields.${field}`)
    }
    fields[field] = parseSafeDataBinding(descriptor.value, { limits })
  }
  return freezeJson(cloneJson({ schemaVersion: 1, fields }, 'dataBindings', limits))
}

const valueAtPath = (value, path) => {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current) && /^(?:0|[1-9]\d*)$/u.test(segment)) {
      const index = Number(segment)
      if (index >= current.length) return undefined
      current = current[index]
      continue
    }
    if (!isPlainRecord(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

const comparePrimitive = (left, right) => {
  if (Object.is(left, right)) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  if (left === null) return -1
  if (right === null) return 1
  if (typeof left !== typeof right) return compareCodeUnits(typeof left, typeof right)
  return left < right ? -1 : 1
}

const matchesFilter = (actual, operator, expected) => {
  if (operator === 'eq') return Object.is(actual, expected)
  if (operator === 'ne') return !Object.is(actual, expected)
  const comparison = comparePrimitive(actual, expected)
  if (operator === 'gt') return comparison > 0
  if (operator === 'gte') return comparison >= 0
  if (operator === 'lt') return comparison < 0
  return comparison <= 0
}

const requireRows = (value, path, limits) => {
  if (!Array.isArray(value)) return fail('transform-operation-requires-an-array', path, 'DATA_TRANSFORM_REJECTED')
  if (value.length > limits.maxRows) return fail('row-budget-exceeded', path, 'DATA_BUDGET_EXCEEDED')
  return value
}

export const applySafeDataTransform = (value, transform, options) => {
  const limits = normalizeLimits(options)
  const normalizedTransform = parseSafeDataTransform(transform, { limits }) ?? Object.freeze([])
  const now = typeof options?.now === 'function' ? options.now : Date.now
  const startedAt = now()
  let current = cloneDataJson(value, 'resolvedData', limits)
  for (let index = 0; index < normalizedTransform.length; index += 1) {
    if (now() - startedAt > limits.timeoutMs)
      return fail('transform-time-budget-exceeded', `transform[${index}]`, 'DATA_BUDGET_EXCEEDED')
    const step = normalizedTransform[index]
    if (step.op === 'select') current = valueAtPath(current, step.path)
    else if (step.op === 'project') {
      current = requireRows(current, `transform[${index}]`, limits).map(row =>
        Object.fromEntries(Object.entries(step.fields).map(([field, path]) => [field, valueAtPath(row, path) ?? null])),
      )
    } else if (step.op === 'filter') {
      current = requireRows(current, `transform[${index}]`, limits).filter(row =>
        matchesFilter(valueAtPath(row, step.path), step.operator, step.value),
      )
    } else if (step.op === 'sort') {
      current = requireRows(current, `transform[${index}]`, limits)
        .map((row, originalIndex) => ({ row, originalIndex }))
        .sort((left, right) => {
          const compared = comparePrimitive(valueAtPath(left.row, step.path), valueAtPath(right.row, step.path))
          return (step.direction === 'desc' ? -compared : compared) || left.originalIndex - right.originalIndex
        })
        .map(entry => entry.row)
    } else current = requireRows(current, `transform[${index}]`, limits).slice(0, step.count)
  }
  return freezeJson(cloneDataJson(current, 'transformedData', limits))
}

export const summarizeSafeDataDescriptor = descriptorValue => {
  const descriptor = parseSafeDataDescriptor(descriptorValue)
  return freezeJson({
    schemaVersion: 1,
    id: descriptor.id,
    kind: descriptor.kind,
    hasTransform: Array.isArray(descriptor.transform) && descriptor.transform.length > 0,
    ...(descriptor.providerId === undefined ? {} : { providerId: descriptor.providerId }),
    ...(descriptor.request === undefined
      ? {}
      : { destination: { url: descriptor.request.url, method: descriptor.request.method } }),
  })
}

const readResponseText = async (response, limits) => {
  const contentLengthValue = response.headers?.get?.('content-length')
  if (contentLengthValue !== null && contentLengthValue !== undefined && contentLengthValue !== '') {
    const normalizedLength = String(contentLengthValue).trim()
    if (!/^(?:0|[1-9]\d*)$/u.test(normalizedLength) || !Number.isSafeInteger(Number(normalizedLength))) {
      return fail('resolver-content-length-is-invalid', 'resolver', 'DATA_RESOLUTION_FAILED')
    }
    if (Number(normalizedLength) > limits.maxBytes) {
      return fail('resolver-response-byte-budget-exceeded', 'resolver', 'DATA_BUDGET_EXCEEDED')
    }
  }

  const reader = response.body?.getReader?.()
  if (!reader) {
    if (typeof response.text !== 'function') {
      return fail('resolver-response-body-is-invalid', 'resolver', 'DATA_RESOLUTION_FAILED')
    }
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > limits.maxBytes) {
      return fail('resolver-response-byte-budget-exceeded', 'resolver', 'DATA_BUDGET_EXCEEDED')
    }
    return text
  }

  const chunks = []
  let byteLength = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      if (!(result.value instanceof Uint8Array)) {
        await reader.cancel?.('resolver-response-chunk-is-invalid').catch?.(() => undefined)
        return fail('resolver-response-chunk-is-invalid', 'resolver', 'DATA_RESOLUTION_FAILED')
      }
      byteLength += result.value.byteLength
      if (byteLength > limits.maxBytes) {
        await reader.cancel?.('resolver-response-byte-budget-exceeded').catch?.(() => undefined)
        return fail('resolver-response-byte-budget-exceeded', 'resolver', 'DATA_BUDGET_EXCEEDED')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock?.()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return fail('resolver-response-is-not-valid-utf8', 'resolver', 'DATA_RESOLUTION_FAILED')
  }
}

const readJsonResponse = async (response, limits) => {
  if (!response || typeof response !== 'object')
    return fail('resolver-response-is-invalid', 'resolver', 'DATA_RESOLUTION_FAILED')
  if (response.ok !== true) return fail('resolver-request-failed', 'resolver', 'DATA_RESOLUTION_FAILED')
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/iu.test(contentType)) {
    return fail('resolver-response-must-be-json', 'resolver', 'DATA_RESOLUTION_FAILED')
  }
  const text = await readResponseText(response, limits)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail('resolver-response-is-not-valid-json', 'resolver', 'DATA_RESOLUTION_FAILED')
  }
  return cloneJson(parsed, 'resolver.response', limits)
}

const parseCredentialedSuccessEnvelope = (value, descriptor, limits) => {
  try {
    const descriptors = assertExactRecord(value, ['schemaVersion', 'data', 'diagnostics'], [], 'resolver.response')
    if (descriptors.schemaVersion.value !== 1) {
      return fail('unsupported-schema-version', 'resolver.response.schemaVersion', 'DATA_RESOLUTION_FAILED')
    }
    const diagnosticDescriptors = assertExactRecord(
      descriptors.diagnostics.value,
      ['status', 'rows', 'bytes', 'durationMs', 'providerId'],
      [],
      'resolver.response.diagnostics',
    )
    const status = diagnosticDescriptors.status.value
    if (!Number.isSafeInteger(status) || status < 200 || status > 299) {
      return fail('resolver-status-is-invalid', 'resolver.response.diagnostics.status', 'DATA_RESOLUTION_FAILED')
    }
    for (const key of ['rows', 'bytes', 'durationMs']) {
      const diagnostic = diagnosticDescriptors[key].value
      if (!Number.isSafeInteger(diagnostic) || diagnostic < 0) {
        return fail(`resolver-${key}-is-invalid`, `resolver.response.diagnostics.${key}`, 'DATA_RESOLUTION_FAILED')
      }
    }
    if (diagnosticDescriptors.providerId.value !== descriptor.providerId) {
      return fail(
        'resolver-provider-does-not-match-request',
        'resolver.response.diagnostics.providerId',
        'DATA_RESOLUTION_FAILED',
      )
    }
    return cloneJson(descriptors.data.value, 'resolver.response.data', limits)
  } catch (error) {
    if (!(error instanceof DashboardDataCapabilityError) || error.code === 'DATA_RESOLUTION_FAILED') throw error
    throw new DashboardDataCapabilityError('DATA_RESOLUTION_FAILED', error.reason, error.path)
  }
}

export const createDashboardSameOriginDataResolver = ({
  endpoint = '/api/data/credentialed-json',
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function')
  return Object.freeze({
    async resolve(descriptorValue, context = {}) {
      const limits = normalizeLimits(context)
      const descriptor = parseSafeDataDescriptor(descriptorValue, { limits })
      if (descriptor.kind === 'static') {
        return applySafeDataTransform(descriptor.value, descriptor.transform, { limits })
      }
      if (descriptor.kind === 'mock') {
        return applySafeDataTransform(descriptor.fixture, descriptor.transform, { limits })
      }
      const controller = new AbortController()
      const externalSignal = context.signal
      const abort = () => controller.abort(externalSignal?.reason)
      if (externalSignal?.aborted) abort()
      else externalSignal?.addEventListener?.('abort', abort, { once: true })
      const timeout = setTimeout(() => controller.abort(new Error('data-resolution-timeout')), limits.timeoutMs)
      try {
        if (descriptor.kind === 'public-http-json') {
          const response = await fetchImpl(descriptor.request.url, {
            method: 'GET',
            credentials: 'omit',
            redirect: 'error',
            signal: controller.signal,
          })
          const data = await readJsonResponse(response, limits)
          return applySafeDataTransform(data, descriptor.transform, { limits })
        }
        const projectId = requireString(context.projectId, 'resolver.projectId', limits, { maximum: 256 })
        const body = {
          schemaVersion: 1,
          projectId,
          providerId: descriptor.providerId,
          credentialRef: descriptor.credentialRef,
          url: descriptor.request.url,
          method: descriptor.request.method,
          ...(descriptor.request.body === undefined ? {} : { body: descriptor.request.body }),
        }
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const envelope = await readJsonResponse(response, limits)
        const data = parseCredentialedSuccessEnvelope(envelope, descriptor, limits)
        return applySafeDataTransform(data, descriptor.transform, { limits })
      } catch (error) {
        if (error instanceof DashboardDataCapabilityError) throw error
        return fail('resolver-request-failed', 'resolver', 'DATA_RESOLUTION_FAILED')
      } finally {
        clearTimeout(timeout)
        externalSignal?.removeEventListener?.('abort', abort)
      }
    },
  })
}
