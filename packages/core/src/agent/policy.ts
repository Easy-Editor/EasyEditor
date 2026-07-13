export const AGENT_NODE_STANDARD_KEYS = Object.freeze([
  'id',
  'componentName',
  'props',
  'children',
  'title',
  'hidden',
  'locked',
  'condition',
  'loop',
] as const)

export const AGENT_RESERVED_EXTRA_KEYS = new Set<string>(['id', 'componentName', 'props', 'children', 'docId'])

export const isSafeAgentExtraKey = (key: string): boolean =>
  !AGENT_RESERVED_EXTRA_KEYS.has(key) && !key.includes('.') && !key.includes('[') && !key.includes('___')

export const isSafeAgentPropKey = (key: string): boolean =>
  !key.includes('.') && !key.includes('[') && !key.includes('___')
