import { AgentCapabilityError } from './errors'

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_NODES = 65_536
const DEFAULT_MAX_DEPTH = 256

const utf8Size = (value: string): number => new TextEncoder().encode(value).byteLength

const appendPath = (path: string, key: string | number): string => {
  if (typeof key === 'number') return `${path}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

const invalid = (path: string, reason: string): never => {
  throw new AgentCapabilityError({
    action: 'validate',
    code: 'agent.data.invalid',
    message: `Agent data is not safe at ${path}: ${reason}`,
  })
}

export interface AgentDataBudget {
  /** Maximum UTF-8 bytes of the resulting JSON representation. */
  readonly maxBytes?: number
  /** Maximum number of primitive/container values visited. */
  readonly maxNodes?: number
  /** Maximum structural nesting depth, with the root at depth zero. */
  readonly maxDepth?: number
  /** Stable public error code used when any resource budget is exceeded. */
  readonly limitCode?: string
  /** Stable public error message used when any resource budget is exceeded. */
  readonly limitMessage?: string
}

interface CloneAgentDataOptions {
  readonly forbidExecutableDiscriminators: boolean
  readonly jsonSnapshotSemantics: boolean
}

interface ValidationContext {
  readonly budget: Required<Pick<AgentDataBudget, 'maxBytes' | 'maxNodes' | 'maxDepth'>> &
    Pick<AgentDataBudget, 'limitCode' | 'limitMessage'>
  readonly seen: WeakSet<object>
  bytes: number
  nodes: number
}

const normalizePositiveBudget = (value: number | undefined, fallback: number): number =>
  Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fallback

const createValidationContext = (budget: AgentDataBudget = {}): ValidationContext => ({
  budget: {
    limitCode: budget.limitCode,
    limitMessage: budget.limitMessage,
    maxBytes: normalizePositiveBudget(budget.maxBytes, DEFAULT_MAX_BYTES),
    maxDepth: normalizePositiveBudget(budget.maxDepth, DEFAULT_MAX_DEPTH),
    maxNodes: normalizePositiveBudget(budget.maxNodes, DEFAULT_MAX_NODES),
  },
  bytes: 0,
  nodes: 0,
  seen: new WeakSet(),
})

const limitExceeded = (context: ValidationContext, path: string, resource: string): never => {
  throw new AgentCapabilityError({
    action: 'validate',
    code: context.budget.limitCode ?? 'agent.data.limitExceeded',
    message: context.budget.limitMessage ?? `Agent data exceeded its ${resource} budget while validating ${path}`,
  })
}

const consumeBytes = (context: ValidationContext, path: string, bytes: number): void => {
  if (bytes > context.budget.maxBytes - context.bytes) limitExceeded(context, path, 'byte')
  context.bytes += bytes
}

const consumeNode = (context: ValidationContext, path: string, depth: number): void => {
  if (depth > context.budget.maxDepth) limitExceeded(context, path, 'depth')
  if (context.nodes >= context.budget.maxNodes) limitExceeded(context, path, 'node')
  context.nodes += 1
}

/**
 * Counts JSON's well-formed UTF-8 string encoding without first allocating a
 * quoted/escaped copy. This lets a huge hostile string fail as soon as the
 * configured byte budget is exhausted.
 */
const consumeJsonString = (context: ValidationContext, path: string, value: string): void => {
  consumeBytes(context, path, 2)
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      consumeBytes(context, path, 2)
    } else if (code <= 0x1f) {
      consumeBytes(
        context,
        path,
        code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6,
      )
    } else if (code <= 0x7f) {
      consumeBytes(context, path, 1)
    } else if (code <= 0x7ff) {
      consumeBytes(context, path, 2)
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        consumeBytes(context, path, 4)
        index += 1
      } else {
        consumeBytes(context, path, 6)
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      consumeBytes(context, path, 6)
    } else {
      consumeBytes(context, path, 3)
    }
  }
}

const isCanonicalArrayIndex = (key: string, length: number): boolean => {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key
}

const cloneAgentData = (
  value: unknown,
  path: string,
  depth: number,
  options: CloneAgentDataOptions,
  context: ValidationContext,
): unknown => {
  consumeNode(context, path, depth)

  if (value === null) {
    consumeBytes(context, path, 4)
    return value
  }
  if (typeof value === 'string') {
    consumeJsonString(context, path, value)
    return value
  }
  if (typeof value === 'boolean') {
    consumeBytes(context, path, value ? 4 : 5)
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, 'numbers must be finite')
    consumeBytes(context, path, String(Object.is(value, -0) ? 0 : value).length)
    return value
  }
  if (typeof value === 'function') invalid(path, 'functions are forbidden')
  if (typeof value === 'undefined') invalid(path, 'undefined is not JSON data')
  if (typeof value === 'bigint') invalid(path, 'bigint is not JSON data')
  if (typeof value === 'symbol') invalid(path, 'symbols are forbidden')
  if (typeof value !== 'object') invalid(path, `unsupported ${typeof value} value`)
  const objectValue = value as object

  if (context.seen.has(objectValue)) {
    invalid(path, 'shared or circular object references are forbidden')
  }
  context.seen.add(objectValue)

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value)
    for (const key of ownKeys) {
      if (key === 'length') continue
      if (typeof key === 'symbol' || !isCanonicalArrayIndex(key, value.length)) {
        invalid(appendPath(path, typeof key === 'symbol' ? key.toString() : key), 'array properties are forbidden')
      }
    }
    consumeBytes(context, path, 2 + Math.max(0, value.length - 1))
    const clone: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        invalid(appendPath(path, index), 'sparse arrays are forbidden')
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || descriptor.get || descriptor.set) {
        invalid(appendPath(path, index), 'accessors are forbidden')
      }
      const descriptorValue = (descriptor as PropertyDescriptor).value
      const item = descriptorValue === undefined && options.jsonSnapshotSemantics ? null : descriptorValue
      clone.push(cloneAgentData(item, appendPath(path, index), depth + 1, options, context))
    }
    return clone
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, 'only plain objects and arrays are allowed')
  }

  consumeBytes(context, path, 2)
  const clone: Record<string, unknown> = {}
  let includedKeys = 0
  for (const key of Reflect.ownKeys(objectValue)) {
    if (typeof key === 'symbol') invalid(appendPath(path, key.toString()), 'symbol keys are forbidden')
    const stringKey = key as string
    if (DANGEROUS_KEYS.has(stringKey)) {
      invalid(appendPath(path, stringKey), 'prototype mutation keys are forbidden')
    }
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, stringKey)
    const childPath = appendPath(path, stringKey)
    if (!descriptor || descriptor.get || descriptor.set) invalid(childPath, 'accessors are forbidden')
    const descriptorValue = (descriptor as PropertyDescriptor).value
    if (descriptorValue === undefined && options.jsonSnapshotSemantics) continue
    if (includedKeys > 0) consumeBytes(context, childPath, 1)
    consumeJsonString(context, childPath, stringKey)
    consumeBytes(context, childPath, 1)
    clone[stringKey] = cloneAgentData(descriptorValue, childPath, depth + 1, options, context)
    includedKeys += 1
  }

  const discriminator = clone.type
  if (options.forbidExecutableDiscriminators && (discriminator === 'JSExpression' || discriminator === 'JSFunction')) {
    invalid(appendPath(path, 'type'), `${discriminator} values are forbidden`)
  }
  return clone
}

export const deepFreezeAgentData = <T>(value: T): Readonly<T> => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  const objectValue = value as object
  for (const key of Reflect.ownKeys(objectValue)) {
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key)
    if (descriptor && 'value' in descriptor) deepFreezeAgentData(descriptor.value)
  }
  return Object.freeze(value)
}

export interface PreparedAgentData<T> {
  readonly value: Readonly<T>
  readonly bytes: number
  readonly serialized: string
}

const prepareData = <T>(
  value: T,
  path: string,
  options: CloneAgentDataOptions,
  budget?: AgentDataBudget,
): PreparedAgentData<T> => {
  const context = createValidationContext(budget)
  const clone = cloneAgentData(value, path, 0, options, context) as T
  const serialized = JSON.stringify(clone)
  if (serialized === undefined) invalid(path, 'value cannot be serialized as JSON')
  const bytes = utf8Size(serialized)
  if (bytes > context.budget.maxBytes) limitExceeded(context, path, 'byte')
  return {
    bytes,
    serialized,
    value: deepFreezeAgentData(clone),
  }
}

/** Strict inbound validator for grants, requests, and Agent-authored commands. */
export const prepareAgentData = <T>(value: T, path = '$', budget?: AgentDataBudget): PreparedAgentData<T> =>
  prepareData(value, path, { forbidExecutableDiscriminators: true, jsonSnapshotSemantics: false }, budget)

/**
 * Outbound document snapshots may contain legacy expression descriptors. They
 * remain inert frozen data; actual functions, accessors, prototypes, aliases
 * and cycles are still rejected.
 */
export const prepareAgentSnapshotData = <T>(value: T, path = '$', budget?: AgentDataBudget): PreparedAgentData<T> =>
  prepareData(value, path, { forbidExecutableDiscriminators: false, jsonSnapshotSemantics: true }, budget)

const sortAgentObjectKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortAgentObjectKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortAgentObjectKeys((value as Record<string, unknown>)[key])]),
  )
}

export const serializeCanonicalAgentSnapshotData = (value: unknown, path = '$', budget?: AgentDataBudget): string => {
  const prepared = prepareAgentSnapshotData(value, path, budget)
  return JSON.stringify(sortAgentObjectKeys(prepared.value))
}
