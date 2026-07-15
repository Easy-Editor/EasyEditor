import type { Designer } from '../designer/designer'
import type { Detecting } from '../designer/detecting'
import type { Dragon } from '../designer/dragon'
import type { DropLocation } from '../designer/location'
import type { OffsetObserver } from '../designer/offset-observer'
import type { Selection } from '../designer/selection'
import type { Document } from '../document/document'
import type { History } from '../document/history'
import type { Node } from '../document/node/node'
import type { NodeChildren } from '../document/node/node-children'
import type { Prop } from '../document/prop/prop'
import type { Props } from '../document/prop/props'
import type { ComponentMeta } from '../materials/component-meta'
import type { Materials } from '../materials/materials'
import type { Project } from '../project/project'
import type { Setters } from '../setters/setters'
import type { Simulator } from '../simulator/simulator'
import type { Viewport } from '../simulator/viewport'
import {
  type ActionConfig,
  type ComputedConfig,
  type MobxConfig,
  type MobxExtendDescriptor,
  MobxExtendType,
  type ObservableConfig,
  addMobxExtendProperty,
  assertMobxExtendConfig,
  isMobxExtendProperty,
} from './plugin-extend-mobx'

export interface PrototypeExtensionRegistration {
  fingerprint: string
  pluginName: string
}

export interface PrototypeExtensionOperation<T extends keyof PluginExtendClass = keyof PluginExtendClass> {
  extendClass: T
  extendMap: Record<T, PluginExtendClass[T]>
  properties: Record<PropertyKey, any> | (PropertyDescriptorMap & ThisType<InstanceType<PluginExtendClass[T]>>)
  registration: PrototypeExtensionRegistration
}

interface PrototypeExtensionRecord {
  className: string
  descriptor: PropertyDescriptor
  extensionFingerprint: string
  key: PropertyKey
  originalDescriptor: PropertyDescriptor | undefined
  owners: Map<object, Set<string>>
  propertyPlan: PrototypeExtensionPropertyPlan
  prototype: object
}

interface DescriptorPropertyPlan {
  descriptor: PropertyDescriptor
  kind: 'descriptor'
}

interface MobxPropertyPlan {
  config: MobxConfig
  kind: 'mobx'
}

type PrototypeExtensionPropertyPlan = DescriptorPropertyPlan | MobxPropertyPlan

const recordsByPrototype = new WeakMap<object, Map<PropertyKey, PrototypeExtensionRecord>>()
const processExtensionRecords = new Set<PrototypeExtensionRecord>()
const permanentPrototypeExtensionOwner = Object.freeze({})
let activeRestrictedPluginBoundaries = 0

const getRecordOrigins = (record: PrototypeExtensionRecord): string[] => [
  ...new Set([...record.owners.values()].flatMap(origins => [...origins])),
]

const keyLabel = (key: PropertyKey): string => (typeof key === 'symbol' ? key.toString() : String(key))

const descriptorMatches = (expected: PropertyDescriptor, actual: PropertyDescriptor | undefined): boolean => {
  if (!actual) return false
  return (
    expected.configurable === actual.configurable &&
    expected.enumerable === actual.enumerable &&
    expected.writable === actual.writable &&
    Object.is(expected.value, actual.value) &&
    Object.is(expected.get, actual.get) &&
    Object.is(expected.set, actual.set)
  )
}

export class PrototypeExtensionConflictError extends Error {
  readonly name = 'PrototypeExtensionConflictError'

  constructor(
    message: string,
    readonly details: { className: string; key: string; origins?: string[] },
  ) {
    super(message)
  }
}

export const getProcessPrototypeExtensionIntegrityIssues = (): Array<{
  className: string
  key: string
  origins: string[]
}> => {
  const issues: Array<{ className: string; key: string; origins: string[] }> = []
  for (const record of processExtensionRecords) {
    const current = Object.getOwnPropertyDescriptor(record.prototype, record.key)
    if (!descriptorMatches(record.descriptor, current)) {
      issues.push({
        className: record.className,
        key: keyLabel(record.key),
        origins: getRecordOrigins(record),
      })
    }
  }
  return issues
}

/**
 * Acquires a fail-closed lease for a restricted engine. Active legacy prototype
 * descriptors are Realm-wide, so restricted and legacy extension leases cannot
 * overlap. Plugin-manager leases are restored after their final owner is
 * destroyed; unmanaged compatibility calls may intentionally remain permanent.
 */
export const establishRestrictedPluginBoundary = (): (() => void) | undefined => {
  if (processExtensionRecords.size > 0 || getProcessPrototypeExtensionIntegrityIssues().length > 0) {
    return undefined
  }
  activeRestrictedPluginBoundaries += 1
  let active = true
  return () => {
    if (!active) return
    active = false
    activeRestrictedPluginBoundaries -= 1
  }
}

export const hasProcessPrototypeExtensions = (): boolean => processExtensionRecords.size > 0

export const assertProcessPrototypeExtensionsAllowed = (): void => {
  if (activeRestrictedPluginBoundaries < 1) return
  throw new PrototypeExtensionConflictError(
    'Cannot apply process-wide prototype extensions while an agentRestricted engine boundary is active',
    { className: 'Process', key: 'prototype', origins: [] },
  )
}

export interface PluginExtend {
  extendClass: PluginExtendClass
  extend: <T extends keyof PluginExtendClass>(
    extendClass: T,
    properties:
      | Record<PropertyKey, () => any>
      | (PropertyDescriptorMap & ThisType<InstanceType<PluginExtendClass[T]>>)
      | Record<PropertyKey, MobxExtendDescriptor>,
  ) => void
}

export interface PluginExtendClass {
  Simulator: typeof Simulator
  Viewport: typeof Viewport

  Designer: typeof Designer
  Dragon: typeof Dragon
  Detecting: typeof Detecting
  Selection: typeof Selection
  DropLocation: typeof DropLocation
  OffsetObserver: typeof OffsetObserver

  Project: typeof Project
  Document: typeof Document
  History: typeof History
  Node: typeof Node
  NodeChildren: typeof NodeChildren
  Props: typeof Props
  Prop: typeof Prop

  Materials: typeof Materials
  Setters: typeof Setters
  ComponentMeta: typeof ComponentMeta
}

const snapshotMobxConfig = (config: MobxConfig): MobxConfig => {
  switch (config.type) {
    case MobxExtendType.OBSERVABLE:
    case MobxExtendType.OBSERVABLE_REF:
    case MobxExtendType.OBSERVABLE_SHALLOW: {
      const { type, initialValue, getter, setter } = config as ObservableConfig
      return { type, initialValue, getter, setter }
    }
    case MobxExtendType.COMPUTED: {
      const { type, getter, setter } = config as ComputedConfig
      return { type, getter, setter }
    }
    case MobxExtendType.ACTION: {
      const { type, method, name } = config as ActionConfig
      return { type, method, name }
    }
  }
}

const prepareProperty = (key: PropertyKey, property: unknown): PrototypeExtensionPropertyPlan => {
  if (isMobxExtendProperty(property)) {
    if (typeof key !== 'string') {
      throw new TypeError('MobX prototype extension keys must be strings')
    }
    assertMobxExtendConfig(property.config)
    return { kind: 'mobx', config: snapshotMobxConfig(property.config) }
  }
  if (typeof property !== 'function' && (!property || typeof property !== 'object')) {
    throw new TypeError(`Invalid prototype extension descriptor for ${keyLabel(key)}`)
  }
  const descriptor: PropertyDescriptor =
    typeof property === 'function'
      ? { configurable: true, value: property }
      : { ...(property as PropertyDescriptor), configurable: true }
  const validationTarget = {}
  Object.defineProperty(validationTarget, key, descriptor)
  return {
    kind: 'descriptor',
    descriptor: Object.getOwnPropertyDescriptor(validationTarget, key) as PropertyDescriptor,
  }
}

const propertyPlansMatch = (
  expected: PrototypeExtensionPropertyPlan,
  actual: PrototypeExtensionPropertyPlan,
): boolean => {
  if (expected.kind !== actual.kind) return false
  if (expected.kind === 'descriptor' && actual.kind === 'descriptor') {
    return descriptorMatches(expected.descriptor, actual.descriptor)
  }
  if (expected.kind !== 'mobx' || actual.kind !== 'mobx') return false
  const left = expected.config as unknown as Record<string, unknown>
  const right = actual.config as unknown as Record<string, unknown>
  return (
    left.type === right.type &&
    Object.is(left.initialValue, right.initialValue) &&
    Object.is(left.getter, right.getter) &&
    Object.is(left.setter, right.setter) &&
    Object.is(left.method, right.method) &&
    Object.is(left.name, right.name)
  )
}

const applyProperty = (prototype: object, key: PropertyKey, propertyPlan: PrototypeExtensionPropertyPlan): void => {
  if (propertyPlan.kind === 'mobx') {
    addMobxExtendProperty(prototype, key as string, propertyPlan.config)
    return
  }
  Object.defineProperty(prototype, key, propertyPlan.descriptor)
}

const restoreOriginalDescriptor = (record: PrototypeExtensionRecord): void => {
  if (record.originalDescriptor) {
    Object.defineProperty(record.prototype, record.key, record.originalDescriptor)
    return
  }
  if (!Reflect.deleteProperty(record.prototype, record.key)) {
    throw new PrototypeExtensionConflictError(
      `Prototype extension could not be removed from ${record.className}.${keyLabel(record.key)}`,
      { className: record.className, key: keyLabel(record.key), origins: getRecordOrigins(record) },
    )
  }
}

const addExtensionOwner = (record: PrototypeExtensionRecord, owner: object, pluginName: string): void => {
  const origins = record.owners.get(owner) || new Set<string>()
  origins.add(pluginName)
  record.owners.set(owner, origins)
}

/**
 * Releases every prototype descriptor leased by one plugin manager generation.
 * The release is preflighted before mutation so either the whole owner lease is
 * restored or a tamper/configurability error leaves it available for retry.
 */
export const releasePrototypeExtensionOwner = (owner: object): void => {
  const ownedRecords = [...processExtensionRecords].filter(record => record.owners.has(owner))
  for (const record of ownedRecords) {
    const current = Object.getOwnPropertyDescriptor(record.prototype, record.key)
    if (!descriptorMatches(record.descriptor, current)) {
      throw new PrototypeExtensionConflictError(
        `Prototype extension integrity violation while releasing ${record.className}.${keyLabel(record.key)}`,
        { className: record.className, key: keyLabel(record.key), origins: getRecordOrigins(record) },
      )
    }
    if (record.owners.size === 1 && current?.configurable !== true) {
      throw new PrototypeExtensionConflictError(
        `Prototype extension cannot be released from ${record.className}.${keyLabel(record.key)}`,
        { className: record.className, key: keyLabel(record.key), origins: getRecordOrigins(record) },
      )
    }
  }

  const released: Array<{
    record: PrototypeExtensionRecord
    removedRecord: boolean
    origins: Set<string>
  }> = []
  try {
    for (const record of ownedRecords) {
      const origins = new Set(record.owners.get(owner) as Set<string>)
      if (record.owners.size > 1) {
        record.owners.delete(owner)
        released.push({ record, removedRecord: false, origins })
        continue
      }

      restoreOriginalDescriptor(record)
      record.owners.delete(owner)
      recordsByPrototype.get(record.prototype)?.delete(record.key)
      processExtensionRecords.delete(record)
      released.push({ record, removedRecord: true, origins })
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const mutation of released.reverse()) {
      try {
        if (mutation.removedRecord) {
          Object.defineProperty(mutation.record.prototype, mutation.record.key, mutation.record.descriptor)
          const registry = recordsByPrototype.get(mutation.record.prototype) || new Map()
          registry.set(mutation.record.key, mutation.record)
          recordsByPrototype.set(mutation.record.prototype, registry)
          processExtensionRecords.add(mutation.record)
        }
        mutation.record.owners.set(owner, mutation.origins)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Prototype extension release failed and rollback was incomplete',
      )
    }
    throw error
  }
}

/**
 * Acquires an owner-scoped Realm-wide prototype-extension lease. Registrations
 * are shareable only when both their declared fingerprint and runtime property
 * identities match; function source text is never treated as closure identity.
 * Every mutation in the batch is rolled back if commit cannot complete.
 * @internal
 */
export const acquirePrototypeExtensionBatch = (
  operations: readonly PrototypeExtensionOperation[],
  owner: object,
): (() => void) => {
  if (operations.length > 0) assertProcessPrototypeExtensionsAllowed()
  const pending = new WeakMap<
    object,
    Map<PropertyKey, { extensionFingerprint: string; propertyPlan: PrototypeExtensionPropertyPlan }>
  >()
  const prepared = operations.flatMap(operation => {
    const { extendClass, extendMap, properties, registration } = operation
    const prototype = extendMap[extendClass].prototype
    const className = String(extendClass)
    const registry = recordsByPrototype.get(prototype) || new Map<PropertyKey, PrototypeExtensionRecord>()
    const pendingForPrototype =
      pending.get(prototype) ||
      new Map<PropertyKey, { extensionFingerprint: string; propertyPlan: PrototypeExtensionPropertyPlan }>()
    pending.set(prototype, pendingForPrototype)

    return Reflect.ownKeys(properties).map(key => {
      const property = properties[key]
      const propertyPlan = prepareProperty(key, property)
      const extensionFingerprint = registration.fingerprint
      const existing = registry.get(key)
      if (existing) {
        const current = Object.getOwnPropertyDescriptor(prototype, key)
        if (!descriptorMatches(existing.descriptor, current)) {
          throw new PrototypeExtensionConflictError(
            `Prototype extension integrity violation at ${className}.${keyLabel(key)}`,
            { className, key: keyLabel(key), origins: getRecordOrigins(existing) },
          )
        }
        if (
          existing.extensionFingerprint !== extensionFingerprint ||
          !propertyPlansMatch(existing.propertyPlan, propertyPlan)
        ) {
          throw new PrototypeExtensionConflictError(
            `Prototype extension identity conflict at ${className}.${keyLabel(key)}`,
            { className, key: keyLabel(key), origins: getRecordOrigins(existing) },
          )
        }
      } else {
        const pendingRegistration = pendingForPrototype.get(key)
        if (
          pendingRegistration &&
          (pendingRegistration.extensionFingerprint !== extensionFingerprint ||
            !propertyPlansMatch(pendingRegistration.propertyPlan, propertyPlan))
        ) {
          throw new PrototypeExtensionConflictError(
            `Prototype extension batch identity conflict at ${className}.${keyLabel(key)}`,
            { className, key: keyLabel(key) },
          )
        }
        if (!pendingRegistration) {
          const currentDescriptor = Object.getOwnPropertyDescriptor(prototype, key)
          if (currentDescriptor && !currentDescriptor.configurable) {
            throw new PrototypeExtensionConflictError(
              `Prototype extension cannot replace non-configurable property ${className}.${keyLabel(key)}`,
              { className, key: keyLabel(key) },
            )
          }
          pendingForPrototype.set(key, { extensionFingerprint, propertyPlan })
        }
      }
      return {
        className,
        extensionFingerprint,
        key,
        originalDescriptor: Object.getOwnPropertyDescriptor(prototype, key),
        propertyPlan,
        prototype,
        registration,
      }
    })
  })

  const committed: Array<
    | { kind: 'created'; record: PrototypeExtensionRecord; registry: Map<PropertyKey, PrototypeExtensionRecord> }
    | { kind: 'owner'; owner: object; previousOrigins: Set<string> | undefined; record: PrototypeExtensionRecord }
  > = []
  try {
    for (const item of prepared) {
      const registry = recordsByPrototype.get(item.prototype) || new Map<PropertyKey, PrototypeExtensionRecord>()
      recordsByPrototype.set(item.prototype, registry)
      const existing = registry.get(item.key)
      if (existing) {
        const previousOrigins = existing.owners.get(owner)
        committed.push({
          kind: 'owner',
          owner,
          previousOrigins: previousOrigins ? new Set(previousOrigins) : undefined,
          record: existing,
        })
        addExtensionOwner(existing, owner, item.registration.pluginName)
        continue
      }

      applyProperty(item.prototype, item.key, item.propertyPlan)
      const appliedDescriptor = Object.getOwnPropertyDescriptor(item.prototype, item.key)
      if (!appliedDescriptor) {
        throw new PrototypeExtensionConflictError(
          `Prototype extension did not define ${item.className}.${keyLabel(item.key)}`,
          { className: item.className, key: keyLabel(item.key) },
        )
      }
      const record: PrototypeExtensionRecord = {
        className: item.className,
        descriptor: appliedDescriptor,
        extensionFingerprint: item.extensionFingerprint,
        key: item.key,
        originalDescriptor: item.originalDescriptor,
        owners: new Map(),
        propertyPlan: item.propertyPlan,
        prototype: item.prototype,
      }
      addExtensionOwner(record, owner, item.registration.pluginName)
      registry.set(item.key, record)
      processExtensionRecords.add(record)
      committed.push({ kind: 'created', record, registry })
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const mutation of committed.reverse()) {
      try {
        if (mutation.kind === 'owner') {
          if (mutation.previousOrigins) {
            mutation.record.owners.set(mutation.owner, mutation.previousOrigins)
          } else {
            mutation.record.owners.delete(mutation.owner)
          }
          continue
        }
        const current = Object.getOwnPropertyDescriptor(mutation.record.prototype, mutation.record.key)
        if (!descriptorMatches(mutation.record.descriptor, current)) {
          throw new PrototypeExtensionConflictError(
            `Prototype extension integrity violation while rolling back ${mutation.record.className}.${keyLabel(
              mutation.record.key,
            )}`,
            {
              className: mutation.record.className,
              key: keyLabel(mutation.record.key),
              origins: getRecordOrigins(mutation.record),
            },
          )
        }
        restoreOriginalDescriptor(mutation.record)
        mutation.registry.delete(mutation.record.key)
        processExtensionRecords.delete(mutation.record)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Prototype extension batch failed and rollback was incomplete',
      )
    }
    throw error
  }

  let active = true
  return () => {
    if (!active) return
    releasePrototypeExtensionOwner(owner)
    active = false
  }
}

/**
 * Legacy root compatibility API. Calls are intentionally permanent for the
 * lifetime of the Realm and therefore never expose teardown authority.
 */
export const applyPrototypeExtensionBatch = (operations: readonly PrototypeExtensionOperation[]): void => {
  acquirePrototypeExtensionBatch(operations, permanentPrototypeExtensionOwner)
}

export const extend = <T extends keyof PluginExtendClass>(
  extendMap: Record<T, PluginExtendClass[T]>,
  extendClass: T,
  properties: Record<PropertyKey, any> | (PropertyDescriptorMap & ThisType<InstanceType<PluginExtendClass[T]>>),
  registration: PrototypeExtensionRegistration,
): void => {
  applyPrototypeExtensionBatch([{ extendClass, extendMap, properties, registration } as PrototypeExtensionOperation])
}
