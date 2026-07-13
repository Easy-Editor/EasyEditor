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
import { type MobxExtendDescriptor, addMobxExtendProperty, isMobxExtendProperty } from './plugin-extend-mobx'

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
  origins: Set<string>
  prototype: object
}

const recordsByPrototype = new WeakMap<object, Map<PropertyKey, PrototypeExtensionRecord>>()
const processExtensionRecords = new Set<PrototypeExtensionRecord>()
let activeRestrictedPluginBoundaries = 0

const keyLabel = (key: PropertyKey): string => (typeof key === 'symbol' ? key.toString() : String(key))

const functionFingerprint = (value: unknown): string => Function.prototype.toString.call(value)

const valueFingerprint = (value: unknown, seen = new WeakSet<object>()): string => {
  if (typeof value === 'function') return `function:${functionFingerprint(value)}`
  if (typeof value === 'symbol') return `symbol:${String(value.description)}`
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`
  if (seen.has(value)) return 'object:[circular]'
  seen.add(value)
  const entries = Reflect.ownKeys(value)
    .sort((left, right) => keyLabel(left).localeCompare(keyLabel(right)))
    .map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return `${keyLabel(key)}=${descriptorFingerprint(descriptor, seen)}`
    })
  return `object:{${entries.join(',')}}`
}

const descriptorFingerprint = (descriptor: PropertyDescriptor | undefined, seen?: WeakSet<object>): string => {
  if (!descriptor) return 'descriptor:missing'
  return [
    `configurable:${Boolean(descriptor.configurable)}`,
    `enumerable:${Boolean(descriptor.enumerable)}`,
    `writable:${Boolean(descriptor.writable)}`,
    `value:${valueFingerprint(descriptor.value, seen)}`,
    `get:${valueFingerprint(descriptor.get, seen)}`,
    `set:${valueFingerprint(descriptor.set, seen)}`,
  ].join('|')
}

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

const extensionPropertyFingerprint = (property: unknown, registration: PrototypeExtensionRegistration): string =>
  `${registration.fingerprint}|${valueFingerprint(property)}`

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
        origins: [...record.origins],
      })
    }
  }
  return issues
}

/**
 * Acquires a fail-closed lease for a restricted engine. Prototype extensions are
 * process-wide and non-unloadable, so a restricted engine cannot share a realm
 * with any registered extension. While the lease is active legacy engines also
 * cannot add a new extension to the realm.
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

const applyProperty = (prototype: object, key: PropertyKey, property: unknown): void => {
  if (isMobxExtendProperty(property)) {
    if (typeof key !== 'string') {
      throw new TypeError('MobX prototype extension keys must be strings')
    }
    addMobxExtendProperty(prototype, key, property.config)
    return
  }
  const descriptor: PropertyDescriptor =
    typeof property === 'function'
      ? {
          value: property,
        }
      : (property as PropertyDescriptor)
  Object.defineProperty(prototype, key, descriptor)
}

const assertPropertyCanBeApplied = (key: PropertyKey, property: unknown): void => {
  if (isMobxExtendProperty(property)) {
    if (typeof key !== 'string') {
      throw new TypeError('MobX prototype extension keys must be strings')
    }
    if (!property.config || typeof property.config.type !== 'string') {
      throw new TypeError(`Invalid MobX prototype extension descriptor for ${keyLabel(key)}`)
    }
    return
  }
  const descriptor: PropertyDescriptor =
    typeof property === 'function' ? { value: property } : (property as PropertyDescriptor)
  Object.defineProperty({}, key, descriptor)
}

/**
 * Registers a process-wide legacy prototype extension. Every target/key is
 * fingerprinted, identical registrations are idempotent, and conflicts are
 * rejected before any property in the current call is mutated.
 */
export const applyPrototypeExtensionBatch = (operations: readonly PrototypeExtensionOperation[]): void => {
  if (operations.length > 0) assertProcessPrototypeExtensionsAllowed()
  const pending = new WeakMap<object, Map<PropertyKey, string>>()
  const prepared = operations.flatMap(operation => {
    const { extendClass, extendMap, properties, registration } = operation
    const prototype = extendMap[extendClass].prototype
    const className = String(extendClass)
    const registry = recordsByPrototype.get(prototype) || new Map<PropertyKey, PrototypeExtensionRecord>()
    const pendingForPrototype = pending.get(prototype) || new Map<PropertyKey, string>()
    pending.set(prototype, pendingForPrototype)

    return Reflect.ownKeys(properties).map(key => {
      const property = properties[key]
      assertPropertyCanBeApplied(key, property)
      const extensionFingerprint = extensionPropertyFingerprint(property, registration)
      const existing = registry.get(key)
      if (existing) {
        const current = Object.getOwnPropertyDescriptor(prototype, key)
        if (!descriptorMatches(existing.descriptor, current)) {
          throw new PrototypeExtensionConflictError(
            `Prototype extension integrity violation at ${className}.${keyLabel(key)}`,
            { className, key: keyLabel(key), origins: [...existing.origins] },
          )
        }
        if (existing.extensionFingerprint !== extensionFingerprint) {
          throw new PrototypeExtensionConflictError(
            `Prototype extension fingerprint conflict at ${className}.${keyLabel(key)}`,
            { className, key: keyLabel(key), origins: [...existing.origins] },
          )
        }
      } else {
        const pendingFingerprint = pendingForPrototype.get(key)
        if (pendingFingerprint && pendingFingerprint !== extensionFingerprint) {
          throw new PrototypeExtensionConflictError(
            `Prototype extension batch conflict at ${className}.${keyLabel(key)}`,
            { className, key: keyLabel(key) },
          )
        }
        if (!pendingFingerprint) {
          const currentDescriptor = Object.getOwnPropertyDescriptor(prototype, key)
          if (currentDescriptor && !currentDescriptor.configurable) {
            throw new PrototypeExtensionConflictError(
              `Prototype extension cannot replace non-configurable property ${className}.${keyLabel(key)}`,
              { className, key: keyLabel(key) },
            )
          }
          pendingForPrototype.set(key, extensionFingerprint)
        }
      }
      return { className, extensionFingerprint, key, property, prototype, registration }
    })
  })

  for (const item of prepared) {
    const registry = recordsByPrototype.get(item.prototype) || new Map<PropertyKey, PrototypeExtensionRecord>()
    recordsByPrototype.set(item.prototype, registry)
    const existing = registry.get(item.key)
    if (existing) {
      existing.origins.add(item.registration.pluginName)
      continue
    }
    applyProperty(item.prototype, item.key, item.property)
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
      origins: new Set([item.registration.pluginName]),
      prototype: item.prototype,
    }
    registry.set(item.key, record)
    processExtensionRecords.add(record)
  }
}

export const extend = <T extends keyof PluginExtendClass>(
  extendMap: Record<T, PluginExtendClass[T]>,
  extendClass: T,
  properties: Record<PropertyKey, any> | (PropertyDescriptorMap & ThisType<InstanceType<PluginExtendClass[T]>>),
  registration: PrototypeExtensionRegistration,
) => applyPrototypeExtensionBatch([{ extendClass, extendMap, properties, registration } as PrototypeExtensionOperation])
