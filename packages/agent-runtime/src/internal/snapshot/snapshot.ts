import type {
  HostSnapshot,
  HostSnapshotDelta,
  HostSnapshotDeltaChange,
  JsonObject,
  JsonValue,
} from '../../contracts.js'
import { ProtocolValidationError, assertExactFields, assertJsonValue } from '../protocol/index.js'

const unsafePathSegments = new Set(['__proto__', 'constructor', 'prototype'])

const fail = (message: string): never => {
  throw new ProtocolValidationError('invalid-field', message)
}

const nonEmptyString = (value: unknown, field: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fail(`${field} must be a non-empty string`)

const nonNegativeInteger = (value: unknown, field: string): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fail(`${field} must be a non-negative integer`)

const jsonObject = (value: unknown, field: string): JsonObject => {
  assertJsonValue(value, field)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${field} must be an object`)
  }
  return value as JsonObject
}

const parsePath = (value: unknown, field: string): readonly [string, ...string[]] => {
  if (!Array.isArray(value) || value.length === 0) return fail(`${field} must be a non-empty array`)
  const path = value.map((segment, index) => {
    const parsed = nonEmptyString(segment, `${field}[${index}]`)
    if (unsafePathSegments.has(parsed)) fail(`${field}[${index}] contains an unsafe path segment`)
    return parsed
  })
  return path as [string, ...string[]]
}

const samePath = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((segment, index) => segment === right[index])

const isAncestorPath = (left: readonly string[], right: readonly string[]) =>
  left.length < right.length && left.every((segment, index) => segment === right[index])

export const parseHostSnapshotChanges = (value: unknown, field = 'HostSnapshotDelta.changes') => {
  if (!Array.isArray(value)) return fail(`${field} must be an array`)
  const paths: (readonly string[])[] = []
  const changes = value.map((entry, index): HostSnapshotDeltaChange => {
    const label = `${field}[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) fail(`${label} must be an object`)
    const op = (entry as { op?: unknown }).op
    if (op === 'set') {
      assertExactFields(entry, ['op', 'path', 'value'], [], label)
      const path = parsePath(entry.path, `${label}.path`)
      assertJsonValue(entry.value, `${label}.value`)
      return { op, path, value: entry.value }
    }
    if (op === 'remove') {
      assertExactFields(entry, ['op', 'path'], [], label)
      return { op, path: parsePath(entry.path, `${label}.path`) }
    }
    return fail(`${label}.op must be set or remove`)
  })

  for (const [index, change] of changes.entries()) {
    if (
      paths.some(
        path => samePath(path, change.path) || isAncestorPath(path, change.path) || isAncestorPath(change.path, path),
      )
    ) {
      fail(`${field}[${index}].path duplicates or overlaps another change`)
    }
    paths.push(change.path)
  }
  return changes
}

export const parseHostSnapshot = (value: unknown): HostSnapshot => {
  assertExactFields(value, ['schemaVersion', 'revision', 'projection'], ['cursor'], 'HostSnapshot')
  if (value.schemaVersion !== 1) fail('HostSnapshot.schemaVersion must equal 1')
  nonEmptyString(value.revision, 'HostSnapshot.revision')
  if (value.cursor !== undefined) nonEmptyString(value.cursor, 'HostSnapshot.cursor')
  jsonObject(value.projection, 'HostSnapshot.projection')
  return value as unknown as HostSnapshot
}

export const parseHostSnapshotDelta = (value: unknown): HostSnapshotDelta => {
  assertExactFields(
    value,
    [
      'schemaVersion',
      'baseRevision',
      'newRevision',
      'providerId',
      'providerGeneration',
      'baseCursor',
      'newCursor',
      'changes',
    ],
    [],
    'HostSnapshotDelta',
  )
  if (value.schemaVersion !== 1) fail('HostSnapshotDelta.schemaVersion must equal 1')
  for (const field of ['baseRevision', 'newRevision', 'providerId', 'baseCursor', 'newCursor'] as const) {
    nonEmptyString(value[field], `HostSnapshotDelta.${field}`)
  }
  if (unsafePathSegments.has(value.providerId as string)) {
    fail('HostSnapshotDelta.providerId contains an unsafe key')
  }
  nonNegativeInteger(value.providerGeneration, 'HostSnapshotDelta.providerGeneration')
  parseHostSnapshotChanges(value.changes)
  return value as unknown as HostSnapshotDelta
}

export type HostSnapshotDeltaApplyErrorCode =
  | 'base-revision-mismatch'
  | 'base-cursor-mismatch'
  | 'missing-provider'
  | 'invalid-path'
  | 'missing-remove-target'

export class HostSnapshotDeltaApplyError extends Error {
  readonly code: HostSnapshotDeltaApplyErrorCode

  constructor(code: HostSnapshotDeltaApplyErrorCode, message: string) {
    super(message)
    this.name = 'HostSnapshotDeltaApplyError'
    this.code = code
  }
}

type MutableJsonObject = Record<string, JsonValue>

const isJsonObject = (value: unknown): value is MutableJsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreeze(entry)
  return Object.freeze(value)
}

export const cloneFrozenHostSnapshot = (value: unknown): HostSnapshot =>
  deepFreeze(structuredClone(parseHostSnapshot(value)))

export const applyHostSnapshotDelta = (current: HostSnapshot, candidate: HostSnapshotDelta): HostSnapshot => {
  const base = parseHostSnapshot(current)
  const delta = parseHostSnapshotDelta(candidate)
  if (base.revision !== delta.baseRevision) {
    throw new HostSnapshotDeltaApplyError(
      'base-revision-mismatch',
      `expected base revision ${base.revision}, received ${delta.baseRevision}`,
    )
  }
  if (!base.cursor || base.cursor !== delta.baseCursor) {
    throw new HostSnapshotDeltaApplyError(
      'base-cursor-mismatch',
      `expected base cursor ${base.cursor ?? '<none>'}, received ${delta.baseCursor}`,
    )
  }

  const projection = structuredClone(base.projection) as MutableJsonObject
  if (!Object.hasOwn(projection, delta.providerId)) {
    throw new HostSnapshotDeltaApplyError('missing-provider', `provider ${delta.providerId} is not in the mirror`)
  }
  const provider = projection[delta.providerId]
  if (!isJsonObject(provider)) {
    throw new HostSnapshotDeltaApplyError('missing-provider', `provider ${delta.providerId} is not in the mirror`)
  }

  for (const change of delta.changes) {
    let target: MutableJsonObject = provider
    for (const segment of change.path.slice(0, -1)) {
      if (!Object.hasOwn(target, segment) || !isJsonObject(target[segment])) {
        throw new HostSnapshotDeltaApplyError('invalid-path', `path ${change.path.join('.')} cannot be traversed`)
      }
      target = target[segment]
    }
    const leaf = change.path.at(-1)
    if (!leaf) throw new HostSnapshotDeltaApplyError('invalid-path', 'delta paths cannot be empty')
    if (change.op === 'remove') {
      if (!Object.hasOwn(target, leaf)) {
        throw new HostSnapshotDeltaApplyError(
          'missing-remove-target',
          `remove path ${change.path.join('.')} does not exist`,
        )
      }
      delete target[leaf]
      continue
    }
    target[leaf] = structuredClone(change.value)
  }

  return deepFreeze({
    schemaVersion: 1,
    revision: delta.newRevision,
    cursor: delta.newCursor,
    projection,
  })
}
