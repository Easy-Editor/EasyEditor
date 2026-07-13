export type TrustPolicyPreset = 'legacyTrusted' | 'agentRestricted'

export type TrustCapability = 'schema.executable' | 'command.executable' | 'remote' | 'plugin.extension'

export interface TrustPolicy {
  readonly name: TrustPolicyPreset
  readonly allowExecutableCommands: boolean
  readonly allowExecutableSchema: boolean
  readonly allowPluginExtensions: boolean
  readonly allowRemoteAccess: boolean
}

export interface PolicyViolationOptions {
  capability: TrustCapability
  origin: string
  rule: string
  message: string
  path?: string
  details?: unknown
}

export class PolicyViolation extends Error {
  readonly name = 'PolicyViolation'

  readonly capability: TrustCapability

  readonly origin: string

  readonly rule: string

  readonly path?: string

  readonly details?: unknown

  constructor(options: PolicyViolationOptions) {
    super(options.message)
    this.capability = options.capability
    this.origin = options.origin
    this.rule = options.rule
    this.path = options.path
    this.details = options.details
  }
}

const PRESETS: Record<TrustPolicyPreset, TrustPolicy> = {
  legacyTrusted: {
    name: 'legacyTrusted',
    allowExecutableCommands: true,
    allowExecutableSchema: true,
    allowPluginExtensions: true,
    allowRemoteAccess: true,
  },
  agentRestricted: {
    name: 'agentRestricted',
    allowExecutableCommands: false,
    allowExecutableSchema: false,
    allowPluginExtensions: false,
    allowRemoteAccess: false,
  },
}

export const resolveTrustPolicy = (policy: TrustPolicyPreset | TrustPolicy = 'agentRestricted'): TrustPolicy => {
  if (typeof policy === 'string') {
    const preset = PRESETS[policy]
    if (!preset) {
      throw new Error(`Unknown trust policy: ${policy}`)
    }
    return Object.freeze({ ...preset })
  }
  return Object.freeze({ ...policy })
}

export const assertTrustCapability = (
  policy: TrustPolicy,
  capability: TrustCapability,
  allowed: boolean,
  origin: string,
  message: string,
  details?: Pick<PolicyViolationOptions, 'details' | 'path'>,
): void => {
  if (allowed) return
  throw new PolicyViolation({
    capability,
    details: details?.details,
    message,
    origin,
    path: details?.path,
    rule: `${policy.name}.${capability}.deny`,
  })
}
