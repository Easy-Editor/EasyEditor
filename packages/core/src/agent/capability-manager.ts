import {
  TransactionCommittedError,
  type TransactionManager,
  type TransactionResult,
  TransactionRollbackIncompleteError,
  isEditorCommandType,
} from '../commands'
import type { Document } from '../document'
import type { Project } from '../project'
import type { TrustPolicy } from '../trust'
import { uniqueId } from '../utils/unique-id'
import { AgentPortHostSession } from './channel'
import { planAgentCommands } from './command-planner'
import { type AgentDocumentBaseline, AgentDocumentBaselineRegistry } from './document-baseline'
import { AgentDomainEventPublisher } from './domain-events'
import { AgentCapabilityError, AgentPlanStaleError, toAgentCapabilityError } from './errors'
import { isSafeAgentExtraKey, isSafeAgentPropKey } from './policy'
import { deepFreezeAgentData, prepareAgentData, serializeCanonicalAgentSnapshotData } from './strict-data-validator'
import type {
  AgentAuditAction,
  AgentAuditListener,
  AgentAuditOutcome,
  AgentAuditRecord,
  AgentCapability,
  AgentCapabilityAssurance,
  AgentCapabilityDescriptor,
  AgentCapabilityGrant,
  AgentCapabilityGrantInput,
  AgentCapabilityLimits,
  AgentCommandAuditSummary,
  AgentDocumentSnapshot,
  AgentDomainEventListener,
  AgentExecutionReceipt,
  AgentExtraValuePolicies,
  AgentMessagePort,
  AgentPlanPreview,
  AgentPlanRequest,
  AgentPortSession,
  AgentPortSessionOptions,
  AgentValuePolicy,
} from './types'

const HARD_LIMITS: AgentCapabilityLimits = Object.freeze({
  maxCommands: 32,
  maxInsertedNodes: 200,
  maxPayloadBytes: 256 * 1024,
  maxSnapshotBytes: 2 * 1024 * 1024,
  maxTreeDepth: 64,
})

const MAX_AUDIT_RECORDS = 1024
const MAX_AUDIT_BYTES = 2 * 1024 * 1024
const MAX_AUDIT_SUMMARY_ITEMS = 64
const MAX_AUDIT_SUMMARY_VALUE_LENGTH = 128
const MAX_GRANT_BYTES = 64 * 1024
const MAX_GRANT_LIST_ITEMS = 256
const MAX_IDENTIFIER_LENGTH = 256
const MAX_SUBJECT_ID_LENGTH = 128
const MAX_STRING_VALUE_BYTES = HARD_LIMITS.maxPayloadBytes

export interface AgentCapabilityHost {
  readonly lifecycleState: string
  readonly project: Project
  readonly transactions: TransactionManager
  readonly trustPolicy: TrustPolicy
  readonly logger?: {
    warn(...args: unknown[]): void
  }
}

interface CapabilityRevision {
  readonly document: Document
  readonly epoch: number
  readonly revision: string
  readonly serialized: string
}

interface CapabilityHandle {
  manager?: AgentCapabilityManager
}

interface AuditSubscription {
  listener?: AgentAuditListener
  readonly startSequence: number
}

interface AuditDelivery {
  readonly bytes: number
  readonly record: AgentAuditRecord
  readonly sequence: number
}

interface AuditDeliveryState {
  bytes: number
  readonly listeners: Set<AuditSubscription>
  nextSequence: number
  readonly queue: AuditDelivery[]
  scheduled: boolean
}

const createAuditDeliveryState = (): AuditDeliveryState => ({
  bytes: 0,
  listeners: new Set(),
  nextSequence: 0,
  queue: [],
  scheduled: false,
})

const clearAuditDeliveryState = (state: AuditDeliveryState): void => {
  for (const subscription of state.listeners) subscription.listener = undefined
  state.listeners.clear()
  state.queue.length = 0
  state.bytes = 0
}

const flushAuditDeliveryState = (state: AuditDeliveryState): void => {
  state.scheduled = false
  const deliveries = state.queue.splice(0)
  state.bytes = 0
  for (const delivery of deliveries) {
    for (const subscription of [...state.listeners]) {
      if (subscription.startSequence > delivery.sequence) continue
      const listener = subscription.listener
      if (!listener) continue
      try {
        listener(delivery.record)
      } catch {
        // Audit observers are deliberately isolated from capability operations.
      }
    }
  }
}

const enqueueAuditDelivery = (state: AuditDeliveryState, record: AgentAuditRecord, bytes: number): void => {
  state.nextSequence += 1
  if (state.listeners.size === 0) return
  state.queue.push({ bytes, record, sequence: state.nextSequence })
  state.bytes += bytes
  while (state.queue.length > MAX_AUDIT_RECORDS || state.bytes > MAX_AUDIT_BYTES) {
    state.bytes -= state.queue.shift()?.bytes ?? 0
  }
  if (state.scheduled) return
  state.scheduled = true
  try {
    queueMicrotask(() => flushAuditDeliveryState(state))
  } catch {
    state.scheduled = false
    state.queue.length = 0
    state.bytes = 0
  }
}

interface CapabilityState {
  readonly descriptor: AgentCapabilityDescriptor
  readonly generation: number
  readonly handle: CapabilityHandle
  readonly revisions: Map<string, CapabilityRevision>
  active: boolean
  outstandingPlanId?: string
  terminalPlanId?: string
}

type PlanStateValue =
  | 'prepared'
  | 'executing'
  | 'committed'
  | 'committed_with_observer_errors'
  | 'rolled_back'
  | 'rollback_incomplete'
  | 'stale'
  | 'superseded'
  | 'revoked'

interface PreparedPlanState {
  readonly planId: string
  readonly capabilityId: string
  readonly generation: number
  readonly document: Document
  readonly documentId: string
  readonly baseRevision: string
  readonly epoch: number
  readonly serialized: string
  readonly commands: ReturnType<typeof planAgentCommands>['commands']
  readonly effects: ReturnType<typeof planAgentCommands>['effects']
  readonly expectedSerialized: string
  readonly summary: AgentCommandAuditSummary
  state: PlanStateValue
}

interface TerminalPlanState {
  readonly planId: string
  readonly capabilityId: string
  readonly baseRevision: string
  readonly documentId: string
  readonly summary: AgentCommandAuditSummary
  readonly state: Exclude<PlanStateValue, 'prepared'>
}

interface AuditInput {
  capabilityId: string
  subjectId: string
  assurance: AgentCapabilityAssurance
  action: AgentAuditAction
  decision: 'allowed' | 'denied'
  outcome: AgentAuditOutcome
  documentId?: string
  planId?: string
  baseRevision?: string
  currentRevision?: string
  commands?: AgentCommandAuditSummary
  error?: unknown
  errorCode?: string
  committed?: boolean
}

const normalizeStringList = (value: unknown, path: string): readonly string[] => {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) {
    throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `${path} must be an array` })
  }
  if (value.length > MAX_GRANT_LIST_ITEMS) {
    throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `${path} has too many entries` })
  }
  const result = new Set<string>()
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0 || item.length > MAX_IDENTIFIER_LENGTH || item === '*') {
      throw new AgentCapabilityError({
        code: 'agent.grant.invalid',
        message: `${path}[${index}] must be a non-empty explicit string`,
      })
    }
    result.add(item)
  })
  return Object.freeze([...result])
}

const normalizeLimits = (value: unknown): AgentCapabilityLimits => {
  const input = value === undefined ? {} : value
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: 'limits must be a plain object' })
  }
  const unknownKeys = Object.keys(input).filter(key => !(key in HARD_LIMITS))
  if (unknownKeys.length) {
    throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `Unknown limit: ${unknownKeys[0]}` })
  }
  const normalized = Object.fromEntries(
    Object.entries(HARD_LIMITS).map(([key, hardLimit]) => {
      const requested = (input as Record<string, unknown>)[key]
      if (requested === undefined) return [key, hardLimit]
      if (!Number.isInteger(requested) || (requested as number) < 1) {
        throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `${key} must be a positive integer` })
      }
      return [key, Math.min(requested as number, hardLimit)]
    }),
  ) as unknown as AgentCapabilityLimits
  return deepFreezeAgentData(normalized)
}

const assertExactPolicyKeys = (policy: Record<string, unknown>, allowedKeys: readonly string[], path: string): void => {
  const allowed = new Set(allowedKeys)
  const unknownKey = Object.keys(policy).find(key => !allowed.has(key))
  if (unknownKey) {
    throw new AgentCapabilityError({
      code: 'agent.grant.invalid',
      message: `Unknown value policy field at ${path}: ${unknownKey}`,
    })
  }
}

const normalizeValuePolicy = (value: unknown, path: string): AgentValuePolicy => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `${path} must be a policy object` })
  }
  const policy = value as Record<string, unknown>
  if (policy.type === 'string') {
    assertExactPolicyKeys(policy, ['type', 'maxBytes'], path)
    if (!Number.isSafeInteger(policy.maxBytes) || (policy.maxBytes as number) < 1) {
      throw new AgentCapabilityError({
        code: 'agent.grant.invalid',
        message: `${path}.maxBytes must be a positive integer`,
      })
    }
    if ((policy.maxBytes as number) > MAX_STRING_VALUE_BYTES) {
      throw new AgentCapabilityError({
        code: 'agent.grant.invalid',
        message: `${path}.maxBytes cannot exceed ${MAX_STRING_VALUE_BYTES}`,
      })
    }
    return Object.freeze({ maxBytes: policy.maxBytes as number, type: 'string' })
  }
  if (policy.type === 'number') {
    assertExactPolicyKeys(policy, ['type', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'], path)
    const minimum = policy.minimum
    const maximum = policy.maximum
    if (typeof minimum !== 'number' || !Number.isFinite(minimum)) {
      throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `${path}.minimum must be finite` })
    }
    if (typeof maximum !== 'number' || !Number.isFinite(maximum)) {
      throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `${path}.maximum must be finite` })
    }
    if (minimum > maximum) {
      throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `${path} has an empty numeric range` })
    }
    if (policy.exclusiveMinimum !== undefined && typeof policy.exclusiveMinimum !== 'boolean') {
      throw new AgentCapabilityError({
        code: 'agent.grant.invalid',
        message: `${path}.exclusiveMinimum must be boolean`,
      })
    }
    if (policy.exclusiveMaximum !== undefined && typeof policy.exclusiveMaximum !== 'boolean') {
      throw new AgentCapabilityError({
        code: 'agent.grant.invalid',
        message: `${path}.exclusiveMaximum must be boolean`,
      })
    }
    if (minimum === maximum && (policy.exclusiveMinimum === true || policy.exclusiveMaximum === true)) {
      throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `${path} has an empty numeric range` })
    }
    return deepFreezeAgentData({
      ...(policy.exclusiveMaximum === true ? { exclusiveMaximum: true } : {}),
      ...(policy.exclusiveMinimum === true ? { exclusiveMinimum: true } : {}),
      maximum,
      minimum,
      type: 'number' as const,
    })
  }
  if (policy.type === 'object') {
    assertExactPolicyKeys(policy, ['type', 'properties', 'required', 'additionalProperties'], path)
    if (!policy.properties || typeof policy.properties !== 'object' || Array.isArray(policy.properties)) {
      throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `${path}.properties must be an object` })
    }
    if (policy.additionalProperties !== false) {
      throw new AgentCapabilityError({
        code: 'agent.grant.invalid',
        message: `${path}.additionalProperties must be false`,
      })
    }
    const propertyKeys = normalizeStringList(Object.keys(policy.properties), `${path}.properties`)
    for (const key of propertyKeys) {
      if (!isSafeAgentPropKey(key)) {
        throw new AgentCapabilityError({
          code: 'agent.grant.invalid',
          message: `${path}.properties must use direct canonical keys`,
        })
      }
    }
    const required = normalizeStringList(policy.required, `${path}.required`)
    for (const key of required) {
      if (!propertyKeys.includes(key)) {
        throw new AgentCapabilityError({
          code: 'agent.grant.invalid',
          message: `${path}.required contains an undeclared property`,
        })
      }
    }
    const properties = Object.fromEntries(
      propertyKeys.map(key => [
        key,
        normalizeValuePolicy((policy.properties as Record<string, unknown>)[key], `${path}.properties.${key}`),
      ]),
    )
    return deepFreezeAgentData({
      additionalProperties: false as const,
      properties,
      required,
      type: 'object' as const,
    })
  }
  throw new AgentCapabilityError({
    code: 'agent.grant.invalid',
    message: `${path}.type must be "string", "number", or "object"`,
  })
}

const normalizeExtraValues = (value: unknown, extraKeys: readonly string[]): AgentExtraValuePolicies => {
  if (value === undefined) {
    if (extraKeys.length === 0) return Object.freeze({})
    throw new AgentCapabilityError({
      code: 'agent.grant.invalid',
      message: 'Every granted extra key requires an extraValues policy',
    })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: 'extraValues must be a plain object' })
  }
  const policyKeys = normalizeStringList(Object.keys(value), '$.grant.extraValues')
  if (
    policyKeys.length !== extraKeys.length ||
    policyKeys.some(key => !extraKeys.includes(key)) ||
    extraKeys.some(key => !policyKeys.includes(key))
  ) {
    throw new AgentCapabilityError({
      code: 'agent.grant.invalid',
      message: 'extraKeys and extraValues must declare exactly the same keys',
    })
  }
  const normalized = Object.fromEntries(
    policyKeys.map(key => {
      const entry = (value as Record<string, unknown>)[key]
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new AgentCapabilityError({
          code: 'agent.grant.invalid',
          message: `$.grant.extraValues.${key} must be a policy object`,
        })
      }
      const preparedEntry = entry as Record<string, unknown>
      assertExactPolicyKeys(preparedEntry, ['requiredOnInsert', 'policy'], `$.grant.extraValues.${key}`)
      if (typeof preparedEntry.requiredOnInsert !== 'boolean') {
        throw new AgentCapabilityError({
          code: 'agent.grant.invalid',
          message: `$.grant.extraValues.${key}.requiredOnInsert must be boolean`,
        })
      }
      return [
        key,
        {
          policy: normalizeValuePolicy(preparedEntry.policy, `$.grant.extraValues.${key}.policy`),
          requiredOnInsert: preparedEntry.requiredOnInsert,
        },
      ]
    }),
  )
  return deepFreezeAgentData(normalized)
}

const normalizeComponentProps = (value: unknown): AgentCapabilityGrant['componentProps'] => {
  if (value === undefined) return Object.freeze({})
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: 'componentProps must be a plain object' })
  }
  const componentNames = normalizeStringList(Object.keys(value), '$.grant.componentProps')
  const normalized = Object.fromEntries(
    componentNames.map(componentName => {
      const componentPolicy = (value as Record<string, unknown>)[componentName]
      if (!componentPolicy || typeof componentPolicy !== 'object' || Array.isArray(componentPolicy)) {
        throw new AgentCapabilityError({
          code: 'agent.grant.invalid',
          message: `$.grant.componentProps.${componentName} must be a prop policy object`,
        })
      }
      const propKeys = normalizeStringList(Object.keys(componentPolicy), `$.grant.componentProps.${componentName}`)
      for (const key of propKeys) {
        if (!isSafeAgentPropKey(key)) {
          throw new AgentCapabilityError({
            code: 'agent.grant.invalid',
            message: 'Agent component props must be direct canonical property keys',
          })
        }
      }
      const policies = Object.fromEntries(
        propKeys.map(key => [
          key,
          normalizeValuePolicy(
            (componentPolicy as Record<string, unknown>)[key],
            `$.grant.componentProps.${componentName}.${key}`,
          ),
        ]),
      )
      return [componentName, policies]
    }),
  )
  return deepFreezeAgentData(normalized)
}

const normalizeGrant = (input: AgentCapabilityGrantInput): { subjectId: string; grant: AgentCapabilityGrant } => {
  const grantData = prepareAgentData(input, '$.grant', {
    limitCode: 'agent.grant.invalid',
    limitMessage: 'Agent grant exceeds its resource limits',
    maxBytes: MAX_GRANT_BYTES,
    maxDepth: 16,
    maxNodes: 4096,
  })
  const preparedValue = grantData.value as unknown
  if (!preparedValue || typeof preparedValue !== 'object' || Array.isArray(preparedValue)) {
    throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: 'Agent grant must be a plain object' })
  }
  const prepared = preparedValue as Record<string, unknown>
  const allowedKeys = new Set([
    'subjectId',
    'documentIds',
    'commandTypes',
    'componentNames',
    'componentProps',
    'extraKeys',
    'extraValues',
    'limits',
  ])
  for (const key of Object.keys(prepared)) {
    if (!allowedKeys.has(key)) {
      throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `Unknown grant field: ${key}` })
    }
  }
  if (
    typeof prepared.subjectId !== 'string' ||
    prepared.subjectId.trim().length === 0 ||
    prepared.subjectId.length > MAX_SUBJECT_ID_LENGTH
  ) {
    throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: 'subjectId must be a non-empty string' })
  }
  const commandTypes = normalizeStringList(prepared.commandTypes, '$.grant.commandTypes')
  for (const type of commandTypes) {
    if (!isEditorCommandType(type)) {
      throw new AgentCapabilityError({ code: 'agent.grant.invalid', message: `Unsupported command type: ${type}` })
    }
  }
  const extraKeys = normalizeStringList(prepared.extraKeys, '$.grant.extraKeys')
  for (const key of extraKeys) {
    if (!isSafeAgentExtraKey(key)) {
      throw new AgentCapabilityError({
        code: 'agent.grant.invalid',
        message: 'Agent extra keys must be direct, canonical, non-structural node fields',
      })
    }
  }
  return {
    grant: deepFreezeAgentData({
      commandTypes,
      componentNames: normalizeStringList(prepared.componentNames, '$.grant.componentNames'),
      componentProps: normalizeComponentProps(prepared.componentProps),
      documentIds: normalizeStringList(prepared.documentIds, '$.grant.documentIds'),
      extraKeys,
      extraValues: normalizeExtraValues(prepared.extraValues, extraKeys),
      limits: normalizeLimits(prepared.limits),
    }) as AgentCapabilityGrant,
    subjectId: prepared.subjectId.trim(),
  }
}

const safeAuditIdentifier = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH ? value : undefined

const sanitizeAuditList = (values: readonly string[]): readonly string[] => {
  const sanitized = values
    .slice(0, MAX_AUDIT_SUMMARY_ITEMS)
    .map(value => (value.length <= MAX_AUDIT_SUMMARY_VALUE_LENGTH ? value : '<oversized>'))
  if (values.length > MAX_AUDIT_SUMMARY_ITEMS) sanitized.push('<truncated>')
  return Object.freeze(sanitized)
}

const sanitizeAuditSummary = (summary: AgentCommandAuditSummary | undefined): AgentCommandAuditSummary | undefined =>
  summary
    ? deepFreezeAgentData({
        componentNames: sanitizeAuditList(summary.componentNames),
        count: summary.count,
        extraKeys: sanitizeAuditList(summary.extraKeys),
        nodeIds: sanitizeAuditList(summary.nodeIds),
        propKeys: sanitizeAuditList(summary.propKeys),
        types: sanitizeAuditList(summary.types),
      })
    : undefined

const errorMetadata = (
  error: unknown,
  errorCode?: string,
  committed = false,
): NonNullable<AgentAuditRecord['error']> => {
  const name = error instanceof Error ? error.name : 'Error'
  const code = errorCode ?? (error instanceof AgentCapabilityError ? error.code : 'agent.internal')
  const rollbackComplete = error instanceof AgentCapabilityError ? error.rollbackComplete : undefined
  const terminal = error instanceof AgentCapabilityError ? error.terminal : false
  return deepFreezeAgentData({ committed, code, name, rollbackComplete, terminal })
}

export class AgentCapabilityManager {
  private readonly baselines = new AgentDocumentBaselineRegistry()

  private readonly capabilities = new Map<string, CapabilityState>()

  private readonly plans = new Map<string, PreparedPlanState>()

  private readonly terminalPlans = new Map<string, TerminalPlanState>()

  private readonly auditRecords: AgentAuditRecord[] = []

  private readonly auditRecordBytes: number[] = []

  private auditBytes = 0

  private auditDelivery = createAuditDeliveryState()

  private readonly domainEvents = new AgentDomainEventPublisher()

  private readonly portSessions = new Set<AgentPortHostSession>()

  private active = false

  private generation = 0

  constructor(private readonly host: AgentCapabilityHost) {}

  activate(): void {
    if (this.active && this.host.lifecycleState === 'ready') return
    if (this.host.lifecycleState !== 'ready') {
      throw new AgentCapabilityError({
        code: 'agent.lifecycle.notReady',
        message: `Agent capabilities require a ready engine; current state is ${this.host.lifecycleState}`,
      })
    }
    this.generation += 1
    this.active = true
  }

  issue(input: AgentCapabilityGrantInput): AgentCapability {
    this.assertManagerReady()
    const capabilityId = uniqueId('capability')
    const assurance = this.assurance
    let normalized: ReturnType<typeof normalizeGrant>
    try {
      normalized = normalizeGrant(input)
    } catch (error) {
      this.audit({
        action: 'issue',
        assurance,
        capabilityId,
        decision: 'denied',
        error,
        outcome: 'rejected',
        subjectId: '<invalid>',
      })
      throw error
    }

    const descriptor = deepFreezeAgentData({
      assurance,
      capabilityId,
      grant: normalized.grant,
      subjectId: normalized.subjectId,
    }) as AgentCapabilityDescriptor
    const handle: CapabilityHandle = { manager: this }
    const state: CapabilityState = {
      active: true,
      descriptor,
      generation: this.generation,
      handle,
      revisions: new Map(),
    }
    this.capabilities.set(capabilityId, state)
    this.audit({
      action: 'issue',
      assurance,
      capabilityId,
      decision: 'allowed',
      outcome: 'issued',
      subjectId: descriptor.subjectId,
    })

    const requireManager = (): AgentCapabilityManager => {
      const manager = handle.manager
      if (!manager) {
        throw new AgentCapabilityError({
          code: 'agent.capability.revoked',
          message: 'The agent capability is revoked or the engine is not ready',
        })
      }
      return manager
    }
    return Object.freeze({
      close: () => handle.manager?.revoke(capabilityId, 'capability.close'),
      descriptor,
      execute: (planId: string) => requireManager().execute(capabilityId, planId),
      preview: (request: AgentPlanRequest) => requireManager().preview(capabilityId, request),
      snapshot: (documentId: string) => requireManager().snapshot(capabilityId, documentId),
    })
  }

  issuePort(
    input: AgentCapabilityGrantInput,
    port: AgentMessagePort,
    options: AgentPortSessionOptions,
  ): AgentPortSession {
    this.assertManagerReady()
    if (
      !port ||
      typeof port.postMessage !== 'function' ||
      typeof port.close !== 'function' ||
      !options?.signal ||
      typeof options.signal.addEventListener !== 'function' ||
      typeof options.signal.removeEventListener !== 'function'
    ) {
      throw new AgentCapabilityError({
        code: 'agent.transport.invalidOptions',
        message: 'Agent MessagePort sessions require a dedicated port and AbortSignal',
      })
    }
    if (options.signal.aborted) {
      throw new AgentCapabilityError({
        code: 'agent.transport.aborted',
        message: 'Cannot issue an Agent MessagePort session with an aborted signal',
      })
    }

    const capability = this.issue(input)
    try {
      const session = new AgentPortHostSession({
        capability,
        onClose: closed => this.portSessions.delete(closed),
        options,
        port,
        subscribeEvents: listener => this.subscribeDomainEvents(listener),
      })
      if (session.state !== 'open') {
        throw new AgentCapabilityError({
          code: 'agent.transport.closed',
          message: 'The Agent MessagePort session closed during initialization',
        })
      }
      this.portSessions.add(session)
      return session
    } catch (error) {
      capability.close()
      throw error
    }
  }

  getAuditRecords(): readonly AgentAuditRecord[] {
    return Object.freeze([...this.auditRecords])
  }

  subscribeAudit(listener: AgentAuditListener): () => void {
    this.assertManagerReady()
    if (typeof listener !== 'function') {
      throw new AgentCapabilityError({
        code: 'agent.audit.listenerInvalid',
        message: 'Audit listener must be a function',
      })
    }
    const delivery = this.auditDelivery
    const subscription: AuditSubscription = { listener, startSequence: delivery.nextSequence + 1 }
    delivery.listeners.add(subscription)
    return () => {
      subscription.listener = undefined
      delivery.listeners.delete(subscription)
    }
  }

  subscribeDomainEvents(listener: AgentDomainEventListener): () => void {
    this.assertManagerReady()
    if (typeof listener !== 'function') {
      throw new AgentCapabilityError({
        code: 'agent.event.listenerInvalid',
        message: 'Agent domain event listener must be a function',
      })
    }
    return this.domainEvents.subscribe(listener)
  }

  revokeAll(reason = 'engine.lifecycle'): void {
    const failures: unknown[] = []
    for (const session of [...this.portSessions]) {
      try {
        session.terminate(reason)
      } catch (error) {
        failures.push(error)
      }
    }
    this.portSessions.clear()
    for (const capabilityId of [...this.capabilities.keys()]) {
      try {
        this.revoke(capabilityId, reason)
      } catch (error) {
        failures.push(error)
      }
    }
    for (const plan of this.plans.values()) {
      if (plan.state === 'prepared' || plan.state === 'executing') plan.state = 'revoked'
    }
    for (const capability of this.capabilities.values()) {
      capability.active = false
      capability.handle.manager = undefined
      capability.revisions.clear()
    }
    this.capabilities.clear()
    this.plans.clear()
    this.terminalPlans.clear()
    this.baselines.clear()
    clearAuditDeliveryState(this.auditDelivery)
    this.auditDelivery = createAuditDeliveryState()
    this.domainEvents.clear()
    this.active = false
    this.generation += 1
    if (failures.length) throw new AggregateError(failures, 'One or more Agent capabilities failed to revoke cleanly')
  }

  private snapshot(capabilityId: string, documentId: string): AgentDocumentSnapshot {
    const capability = this.requireCapability(capabilityId)
    let auditDocumentId: string | undefined
    try {
      this.assertDocumentGranted(capability, documentId)
      const document = this.requireDocument(documentId)
      auditDocumentId = document.id
      const baseline = this.captureWithinLimit(capability, document)
      capability.revisions.clear()
      capability.revisions.set(baseline.revision, {
        document,
        epoch: baseline.epoch,
        revision: baseline.revision,
        serialized: baseline.serialized,
      })
      const snapshot = deepFreezeAgentData({
        documentId,
        revision: baseline.revision,
        schema: baseline.schema,
      }) as AgentDocumentSnapshot
      this.auditFor(capability, {
        action: 'snapshot',
        decision: 'allowed',
        documentId: auditDocumentId,
        outcome: 'snapshot',
        currentRevision: baseline.revision,
      })
      return snapshot
    } catch (error) {
      this.auditFor(capability, {
        action: 'snapshot',
        decision: 'denied',
        documentId: auditDocumentId,
        error,
        outcome: 'rejected',
      })
      throw error
    }
  }

  private preview(capabilityId: string, requestInput: AgentPlanRequest): AgentPlanPreview {
    const capability = this.requireCapability(capabilityId)
    let request: AgentPlanRequest | undefined
    let auditBaseRevision: string | undefined
    let auditDocumentId: string | undefined
    let summary: AgentCommandAuditSummary | undefined
    try {
      const { limits } = capability.descriptor.grant
      const requestData = prepareAgentData(requestInput, '$.request', {
        limitCode: 'agent.limit.payloadBytes',
        limitMessage: `Agent request exceeds limit ${limits.maxPayloadBytes}`,
        maxBytes: limits.maxPayloadBytes,
        maxDepth: Math.max(16, limits.maxTreeDepth + 8),
        maxNodes: Math.min(65_536, limits.maxPayloadBytes),
      })
      const preparedValue = requestData.value as unknown
      if (!preparedValue || typeof preparedValue !== 'object' || Array.isArray(preparedValue)) {
        throw new AgentCapabilityError({
          action: 'preview',
          code: 'agent.request.invalid',
          message: 'Agent preview request must be a plain object',
        })
      }
      const prepared = preparedValue as Record<string, unknown>
      for (const key of Object.keys(prepared)) {
        if (!['documentId', 'baseRevision', 'commands'].includes(key)) {
          throw new AgentCapabilityError({
            action: 'preview',
            code: 'agent.request.invalid',
            message: `Unknown preview field: ${key}`,
          })
        }
      }
      request = prepared as unknown as AgentPlanRequest
      if (typeof request.documentId !== 'string' || typeof request.baseRevision !== 'string') {
        throw new AgentCapabilityError({
          action: 'preview',
          code: 'agent.request.invalid',
          message: 'documentId and baseRevision must be strings',
        })
      }
      this.assertDocumentGranted(capability, request.documentId)
      const document = this.requireDocument(request.documentId)
      auditDocumentId = document.id
      const revision = capability.revisions.get(request.baseRevision)
      if (!revision || revision.document !== document) {
        throw new AgentCapabilityError({
          action: 'preview',
          code: 'agent.revision.invalid',
          message: 'The base revision was not issued to this capability and document',
        })
      }
      auditBaseRevision = revision.revision
      const before = this.captureWithinLimit(capability, document)
      this.assertRevision(revision, before, 'preview')
      const planned = planAgentCommands(
        before.schema,
        request.commands,
        request.documentId,
        capability.descriptor.grant,
      )
      summary = planned.summary
      const after = this.captureWithinLimit(capability, document)
      this.assertRevision(revision, after, 'preview')

      if (capability.outstandingPlanId) {
        const outstanding = this.plans.get(capability.outstandingPlanId)
        if (outstanding?.state === 'prepared') this.retirePlan(capability, outstanding, 'superseded')
      }
      const planId = uniqueId('plan')
      const plan: PreparedPlanState = {
        baseRevision: request.baseRevision,
        capabilityId,
        commands: planned.commands,
        document,
        documentId: request.documentId,
        effects: planned.effects,
        expectedSerialized: planned.expectedSerialized,
        epoch: revision.epoch,
        generation: capability.generation,
        planId,
        serialized: revision.serialized,
        state: 'prepared',
        summary: planned.summary,
      }
      this.plans.set(planId, plan)
      capability.outstandingPlanId = planId
      const preview = deepFreezeAgentData({
        baseRevision: request.baseRevision,
        commandCount: planned.commands.length,
        documentId: request.documentId,
        effects: planned.effects,
        planId,
        state: 'prepared',
      }) as AgentPlanPreview
      this.auditFor(capability, {
        action: 'preview',
        baseRevision: auditBaseRevision,
        commands: summary,
        decision: 'allowed',
        documentId: auditDocumentId,
        outcome: 'prepared',
        planId,
      })
      return preview
    } catch (error) {
      this.auditFor(capability, {
        action: 'preview',
        baseRevision: auditBaseRevision,
        commands: summary,
        decision: 'denied',
        documentId: auditDocumentId,
        error,
        outcome: error instanceof AgentPlanStaleError ? 'stale' : 'rejected',
      })
      throw error
    }
  }

  private execute(capabilityId: string, planId: string): AgentExecutionReceipt {
    const capability = this.requireCapability(capabilityId)
    if (typeof planId !== 'string' || planId.length === 0) {
      const error = new AgentCapabilityError({
        action: 'execute',
        code: 'agent.plan.invalid',
        message: 'planId is required',
      })
      this.auditFor(capability, { action: 'execute', decision: 'denied', error, outcome: 'rejected' })
      throw error
    }
    const plan = this.plans.get(planId)
    if (!plan || plan.capabilityId !== capabilityId) {
      const terminal = this.terminalPlans.get(planId)
      if (terminal?.capabilityId === capabilityId) {
        const error = new AgentCapabilityError({
          action: 'execute',
          code: 'agent.plan.terminal',
          message: `The agent plan cannot execute from state ${terminal.state}`,
        })
        this.auditFor(capability, {
          action: 'execute',
          baseRevision: terminal.baseRevision,
          commands: terminal.summary,
          decision: 'denied',
          documentId: terminal.documentId,
          error,
          outcome: terminal.state === 'stale' ? 'stale' : 'rejected',
          planId,
        })
        throw error
      }
      const error = new AgentCapabilityError({
        action: 'execute',
        code: 'agent.plan.notFound',
        message: 'The agent plan does not belong to this capability',
      })
      this.auditFor(capability, {
        action: 'execute',
        decision: 'denied',
        error,
        outcome: 'rejected',
        planId,
      })
      throw error
    }
    if (plan.state !== 'prepared') {
      const error = new AgentCapabilityError({
        action: 'execute',
        code: 'agent.plan.terminal',
        message: `The agent plan cannot execute from state ${plan.state}`,
      })
      this.auditFor(capability, {
        action: 'execute',
        baseRevision: plan.baseRevision,
        commands: plan.summary,
        decision: 'denied',
        documentId: plan.documentId,
        error,
        outcome: plan.state === 'stale' ? 'stale' : 'rejected',
        planId,
      })
      throw error
    }

    let result: TransactionResult
    let committedStatus: AgentExecutionReceipt['status'] = 'committed'
    let observerErrorCount = 0
    try {
      this.assertPlanOwnership(capability, plan)
      const before = this.captureWithinLimit(capability, plan.document)
      this.assertPlanCurrent(capability, plan, before)
      plan.state = 'executing'
      const verifyExpectedDocument = (boundDocument: Document, path: string) => {
        if (this.host.project.getDocument(plan.documentId) !== boundDocument) {
          throw new AgentCapabilityError({
            action: 'execute',
            code: 'agent.execution.documentDetached',
            message: 'The plan document was detached from its engine project during execution',
          })
        }
        const actual = serializeCanonicalAgentSnapshotData(boundDocument.exportRaw(), path, {
          limitCode: 'agent.limit.snapshotBytes',
          limitMessage: 'Agent postcondition exceeded the hard verification budget',
          maxBytes: HARD_LIMITS.maxSnapshotBytes + HARD_LIMITS.maxPayloadBytes,
          maxDepth: 256,
          maxNodes: 262_144,
        })
        if (actual !== plan.expectedSerialized) {
          throw new AgentCapabilityError({
            action: 'execute',
            code: 'agent.execution.postconditionFailed',
            message: 'The actual document delta exceeded the prepared Agent plan',
          })
        }
      }
      result = this.host.transactions.runOnDocument(plan.document, plan.commands, {
        invokeNodeCallbacks: false,
        postcondition: boundDocument => verifyExpectedDocument(boundDocument, '$.postcondition'),
        precondition: boundDocument => {
          if (boundDocument !== plan.document) throw new AgentPlanStaleError('The plan document identity changed')
          const current = this.captureWithinLimit(capability, boundDocument)
          this.assertPlanCurrent(capability, plan, current)
        },
        publishEvents: false,
        settledPostcondition: boundDocument => verifyExpectedDocument(boundDocument, '$.settledPostcondition'),
      })
    } catch (error) {
      if (error instanceof TransactionCommittedError) {
        result = error.result as TransactionResult
        committedStatus = 'committed_with_observer_errors'
        observerErrorCount = error.errors.length
      } else if (error instanceof AgentPlanStaleError) {
        this.retirePlan(capability, plan, 'stale')
        this.auditFor(capability, {
          action: 'execute',
          baseRevision: plan.baseRevision,
          commands: plan.summary,
          currentRevision: error.currentRevision,
          decision: 'denied',
          documentId: plan.documentId,
          error,
          outcome: 'stale',
          planId,
        })
        throw error
      } else if (error instanceof TransactionRollbackIncompleteError) {
        this.retirePlan(capability, plan, 'rollback_incomplete')
        const safeError = new AgentCapabilityError({
          action: 'execute',
          code: 'agent.execution.rollbackIncomplete',
          committed: false,
          message: 'Agent plan failed and the engine could not prove a complete rollback',
          rollbackComplete: false,
          terminal: true,
        })
        this.auditFor(capability, {
          action: 'execute',
          baseRevision: plan.baseRevision,
          commands: plan.summary,
          decision: 'denied',
          documentId: plan.documentId,
          error: safeError,
          outcome: 'rollback_incomplete',
          planId,
        })
        throw safeError
      } else {
        this.retirePlan(capability, plan, 'rolled_back')
        const safeError = toAgentCapabilityError(error, {
          action: 'execute',
          code: 'agent.execution.failed',
          message: 'Agent plan execution failed and was rolled back',
        })
        this.auditFor(capability, {
          action: 'execute',
          baseRevision: plan.baseRevision,
          commands: plan.summary,
          decision: 'denied',
          documentId: plan.documentId,
          error: safeError,
          outcome: 'rolled_back',
          planId,
        })
        throw safeError
      }
    }
    return this.finishCommitted(capability, plan, result, committedStatus, observerErrorCount)
  }

  private finishCommitted(
    capability: CapabilityState,
    plan: PreparedPlanState,
    result: TransactionResult,
    status: AgentExecutionReceipt['status'],
    observerErrorCount: number,
  ): AgentExecutionReceipt {
    let revision: string | undefined
    let verificationError: unknown
    capability.revisions.clear()
    try {
      if (this.host.project.getDocument(plan.documentId) !== plan.document) {
        throw new AgentCapabilityError({
          action: 'execute',
          code: 'agent.postCommit.documentDetached',
          committed: true,
          message: 'The committed plan document is no longer owned by its engine project',
        })
      }
      const after = this.baselines.capture(plan.document, capability.descriptor.grant.limits.maxSnapshotBytes)
      revision = after.revision
      capability.revisions.set(after.revision, {
        document: after.document,
        epoch: after.epoch,
        revision: after.revision,
        serialized: after.serialized,
      })
    } catch (error) {
      verificationError = error
      status = 'committed_with_observer_errors'
      observerErrorCount += 1
    }
    this.retirePlan(capability, plan, status)
    const committedError = verificationError
      ? verificationError
      : observerErrorCount > 0
        ? new AgentCapabilityError({
            code: 'agent.observer.failed',
            committed: true,
            message: 'The model committed, but one or more post-commit observers failed',
          })
        : undefined
    const receipt = deepFreezeAgentData({
      affectedNodeIds: [...result.affectedNodeIds],
      commandCount: result.commandCount,
      committed: true,
      documentId: plan.documentId,
      observerErrorCount,
      planId: plan.planId,
      revision,
      status,
    }) as AgentExecutionReceipt
    this.auditFor(capability, {
      action: 'execute',
      baseRevision: plan.baseRevision,
      commands: plan.summary,
      committed: true,
      currentRevision: revision,
      decision: 'allowed',
      documentId: plan.documentId,
      error: committedError,
      errorCode: verificationError ? 'agent.postCommit.verificationFailed' : undefined,
      outcome: status,
      planId: plan.planId,
    })
    this.domainEvents.publishCommitted({
      affectedNodeIds: [...receipt.affectedNodeIds],
      baseRevision: plan.baseRevision,
      capabilityId: capability.descriptor.capabilityId,
      commandCount: receipt.commandCount,
      commandTypes: plan.commands.map(command => command.type),
      documentId: plan.documentId,
      observerErrorCount: receipt.observerErrorCount,
      planId: plan.planId,
      revision: receipt.revision,
      status: receipt.status,
      subjectId: capability.descriptor.subjectId,
    })
    return receipt
  }

  private retirePlan(
    capability: CapabilityState,
    plan: PreparedPlanState,
    state: Exclude<PlanStateValue, 'prepared'>,
  ): void {
    plan.state = state
    this.plans.delete(plan.planId)
    if (capability.terminalPlanId) this.terminalPlans.delete(capability.terminalPlanId)
    this.terminalPlans.set(plan.planId, {
      baseRevision: plan.baseRevision,
      capabilityId: plan.capabilityId,
      documentId: plan.documentId,
      planId: plan.planId,
      state,
      summary: plan.summary,
    })
    capability.terminalPlanId = plan.planId
    if (capability.outstandingPlanId === plan.planId) capability.outstandingPlanId = undefined
  }

  private captureWithinLimit(capability: CapabilityState, document: Document): AgentDocumentBaseline {
    return this.baselines.capture(document, capability.descriptor.grant.limits.maxSnapshotBytes)
  }

  private assertPlanCurrent(
    capability: CapabilityState,
    plan: PreparedPlanState,
    current: AgentDocumentBaseline,
  ): void {
    this.assertPlanOwnership(capability, plan, current.revision)
    this.assertRevision(
      {
        document: plan.document,
        epoch: plan.epoch,
        revision: plan.baseRevision,
        serialized: plan.serialized,
      },
      current,
      'execute',
    )
  }

  private assertPlanOwnership(capability: CapabilityState, plan: PreparedPlanState, currentRevision?: string): void {
    if (
      !this.active ||
      this.host.lifecycleState !== 'ready' ||
      capability.generation !== this.generation ||
      plan.generation !== this.generation ||
      this.host.project.getDocument(plan.documentId) !== plan.document
    ) {
      throw new AgentPlanStaleError('The engine or document lifecycle changed', currentRevision)
    }
  }

  private assertRevision(expected: CapabilityRevision, current: AgentDocumentBaseline, action: string): void {
    if (
      expected.document !== current.document ||
      expected.epoch !== current.epoch ||
      expected.revision !== current.revision ||
      expected.serialized !== current.serialized
    ) {
      throw new AgentPlanStaleError(`The agent ${action} revision is stale`, current.revision)
    }
  }

  private assertDocumentGranted(capability: CapabilityState, documentId: string): void {
    if (typeof documentId !== 'string' || !capability.descriptor.grant.documentIds.includes(documentId)) {
      throw new AgentCapabilityError({
        code: 'agent.grant.documentDenied',
        message: 'The requested document is not granted to this capability',
      })
    }
  }

  private requireDocument(documentId: string): Document {
    const document = this.host.project.getDocument(documentId)
    if (!document?.root) {
      throw new AgentCapabilityError({
        code: 'agent.document.notFound',
        message: 'The granted document is unavailable',
      })
    }
    return document
  }

  private requireCapability(capabilityId: string): CapabilityState {
    const capability = this.capabilities.get(capabilityId)
    if (
      !capability?.active ||
      !this.active ||
      capability.generation !== this.generation ||
      this.host.lifecycleState !== 'ready'
    ) {
      throw new AgentCapabilityError({
        code: 'agent.capability.revoked',
        message: 'The agent capability is revoked or the engine is not ready',
      })
    }
    return capability
  }

  private assertManagerReady(): void {
    if (!this.active || this.host.lifecycleState !== 'ready') {
      throw new AgentCapabilityError({
        code: 'agent.lifecycle.notReady',
        message: `Agent capabilities require a ready engine; current state is ${this.host.lifecycleState}`,
      })
    }
  }

  private revoke(capabilityId: string, _reason: string): void {
    const capability = this.capabilities.get(capabilityId)
    if (!capability) return
    if (!capability.active) {
      capability.handle.manager = undefined
      this.capabilities.delete(capabilityId)
      return
    }
    capability.active = false
    for (const [planId, plan] of this.plans) {
      if (plan.capabilityId === capabilityId && (plan.state === 'prepared' || plan.state === 'executing')) {
        plan.state = 'revoked'
      }
      if (plan.capabilityId === capabilityId) this.plans.delete(planId)
    }
    capability.revisions.clear()
    capability.outstandingPlanId = undefined
    if (capability.terminalPlanId) this.terminalPlans.delete(capability.terminalPlanId)
    capability.terminalPlanId = undefined
    try {
      this.auditFor(capability, {
        action: 'revoke',
        decision: 'allowed',
        outcome: 'revoked',
      })
    } finally {
      capability.handle.manager = undefined
      this.capabilities.delete(capabilityId)
    }
  }

  private get assurance(): AgentCapabilityAssurance {
    return this.host.trustPolicy.name === 'agentRestricted' ? 'policy-restricted-co-realm' : 'legacy-co-realm'
  }

  private auditFor(capability: CapabilityState, input: Omit<AuditInput, 'assurance' | 'capabilityId' | 'subjectId'>) {
    this.audit({
      ...input,
      assurance: capability.descriptor.assurance,
      capabilityId: capability.descriptor.capabilityId,
      subjectId: capability.descriptor.subjectId,
    })
  }

  private audit(input: AuditInput): void {
    const record = deepFreezeAgentData({
      action: input.action,
      assurance: input.assurance,
      auditId: uniqueId('audit'),
      baseRevision: safeAuditIdentifier(input.baseRevision),
      capabilityId: safeAuditIdentifier(input.capabilityId) ?? '<redacted>',
      commands: sanitizeAuditSummary(input.commands),
      currentRevision: safeAuditIdentifier(input.currentRevision),
      decision: input.decision,
      documentId: safeAuditIdentifier(input.documentId),
      engineState: this.host.lifecycleState,
      error: input.error ? errorMetadata(input.error, input.errorCode, input.committed) : undefined,
      hostTrust: this.host.trustPolicy.name,
      outcome: input.outcome,
      planId: safeAuditIdentifier(input.planId),
      subjectId: safeAuditIdentifier(input.subjectId) ?? '<redacted>',
      timestamp: Date.now(),
      version: 1 as const,
    }) as AgentAuditRecord
    const recordBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength
    this.auditRecords.push(record)
    this.auditRecordBytes.push(recordBytes)
    this.auditBytes += recordBytes
    while (this.auditRecords.length > MAX_AUDIT_RECORDS || this.auditBytes > MAX_AUDIT_BYTES) {
      this.auditRecords.shift()
      this.auditBytes -= this.auditRecordBytes.shift() ?? 0
    }
    enqueueAuditDelivery(this.auditDelivery, record, recordBytes)
  }
}
