import { DASHBOARD_AGENT_HOST_ERROR_CODE, DashboardAgentHostError } from './index.mjs'

const SESSION_AUTHORITY_FIELDS = Object.freeze(['branchId', 'projectId', 'sessionId'])
const DESCRIPTOR_TASK_ID = 'dashboard-capability-schema'
const DEFAULT_MAX_TASK_HOSTS = 4
const MAX_TASK_HOSTS_LIMIT = 32

const isObjectLike = value => (typeof value === 'object' && value !== null) || typeof value === 'function'

const readOwnDataValue = (value, key, fallback) => {
  if (!isObjectLike(value)) return fallback
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : fallback
}

const assertPlainRecord = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest, `${label}-must-be-an-object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest, `${label}-must-be-a-plain-object`)
  }
}

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      `${label}-must-be-a-non-empty-string`,
    )
  }
  return value
}

const normalizeAuthority = authority => {
  assertPlainRecord(authority, 'session-host-authority')
  const keys = Reflect.ownKeys(authority)
  if (
    keys.length !== SESSION_AUTHORITY_FIELDS.length ||
    keys.some(key => typeof key !== 'string' || !SESSION_AUTHORITY_FIELDS.includes(key))
  ) {
    throw new DashboardAgentHostError(
      DASHBOARD_AGENT_HOST_ERROR_CODE.invalidRequest,
      'session-host-authority-fields-must-match-contract',
    )
  }
  return Object.freeze(
    Object.fromEntries(
      SESSION_AUTHORITY_FIELDS.map(field => [
        field,
        requireNonEmptyString(readOwnDataValue(authority, field), `session-host-authority.${field}`),
      ]),
    ),
  )
}

const normalizeMaxTaskHosts = value => {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TASK_HOSTS_LIMIT) {
    throw new TypeError(`maxTaskHosts must be a safe integer between 1 and ${MAX_TASK_HOSTS_LIMIT}`)
  }
  return value
}

const assertManagedHost = host => {
  if (
    typeof host?.observe !== 'function' ||
    typeof host?.describeCapability !== 'function' ||
    typeof host?.invoke !== 'function' ||
    typeof host?.queryReceipt !== 'function' ||
    typeof host?.dispose !== 'function'
  ) {
    throw new TypeError('createHost must return a disposable AgentHost')
  }
  return host
}

export class DashboardAgentSessionHost {
  #authority
  #createHost
  #descriptorHost = null
  #disposed = false
  #maxTaskHosts
  #taskHosts = new Map()

  constructor({ authority, createHost, maxTaskHosts = DEFAULT_MAX_TASK_HOSTS }) {
    if (typeof createHost !== 'function') throw new TypeError('createHost must be a function')
    this.#authority = normalizeAuthority(authority)
    this.#createHost = createHost
    this.#maxTaskHosts = normalizeMaxTaskHosts(maxTaskHosts)
  }

  #assertActive() {
    if (this.#disposed) {
      throw new DashboardAgentHostError(DASHBOARD_AGENT_HOST_ERROR_CODE.hostDisposed, 'session-host-is-disposed')
    }
  }

  #assertAuthority(value, label, includeSession) {
    assertPlainRecord(value, label)
    const fields = includeSession ? SESSION_AUTHORITY_FIELDS : ['branchId', 'projectId']
    for (const field of fields) {
      const actual = readOwnDataValue(value, field)
      requireNonEmptyString(actual, `${label}.${field}`)
      if (actual !== this.#authority[field]) {
        throw new DashboardAgentHostError(
          DASHBOARD_AGENT_HOST_ERROR_CODE.authorityMismatch,
          `${field}-does-not-match-session-host-authority`,
          { field },
        )
      }
    }
  }

  #createBoundHost(taskId) {
    return assertManagedHost(
      this.#createHost(
        Object.freeze({
          projectId: this.#authority.projectId,
          branchId: this.#authority.branchId,
          sessionId: this.#authority.sessionId,
          taskId,
        }),
      ),
    )
  }

  #trimIdleHosts() {
    while (this.#taskHosts.size > this.#maxTaskHosts) {
      let evicted = false
      for (const [taskId, entry] of this.#taskHosts) {
        if (entry.active !== 0) continue
        this.#taskHosts.delete(taskId)
        entry.host.dispose()
        evicted = true
        break
      }
      if (!evicted) return
    }
  }

  #acquire(taskId) {
    const existing = this.#taskHosts.get(taskId)
    if (existing) {
      existing.active += 1
      this.#taskHosts.delete(taskId)
      this.#taskHosts.set(taskId, existing)
      return existing
    }
    const entry = { active: 1, host: this.#createBoundHost(taskId) }
    this.#taskHosts.set(taskId, entry)
    this.#trimIdleHosts()
    return entry
  }

  #release(taskId, entry) {
    entry.active -= 1
    if (entry.active < 0) throw new Error('session host task reference count underflow')
    if (this.#taskHosts.get(taskId) === entry) {
      this.#taskHosts.delete(taskId)
      this.#taskHosts.set(taskId, entry)
    }
    this.#trimIdleHosts()
  }

  async #withTaskHost(value, label, operation) {
    this.#assertActive()
    this.#assertAuthority(value, label, true)
    const taskId = requireNonEmptyString(readOwnDataValue(value, 'taskId'), `${label}.taskId`)
    const entry = this.#acquire(taskId)
    try {
      return await operation(entry.host)
    } finally {
      this.#release(taskId, entry)
    }
  }

  observe(request) {
    return this.#withTaskHost(request, 'observe-request', host => host.observe(request))
  }

  async describeCapability(request) {
    this.#assertActive()
    this.#assertAuthority(request, 'capability-request', false)
    this.#descriptorHost ??= this.#createBoundHost(DESCRIPTOR_TASK_ID)
    return this.#descriptorHost.describeCapability(request)
  }

  invoke(call, context) {
    return this.#withTaskHost(call, 'semantic-call', host => host.invoke(call, context))
  }

  queryReceipt(request) {
    return this.#withTaskHost(request, 'receipt-query', host => host.queryReceipt(request))
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#descriptorHost?.dispose()
    this.#descriptorHost = null
    for (const entry of this.#taskHosts.values()) entry.host.dispose()
    this.#taskHosts.clear()
  }

  get disposed() {
    return this.#disposed
  }
}

export const createDashboardAgentSessionHost = (options = {}) => {
  if (readOwnDataValue(options, 'enabled', false) !== true) return null
  return new DashboardAgentSessionHost({
    authority: readOwnDataValue(options, 'authority'),
    createHost: readOwnDataValue(options, 'createHost'),
    maxTaskHosts: readOwnDataValue(options, 'maxTaskHosts', DEFAULT_MAX_TASK_HOSTS),
  })
}
