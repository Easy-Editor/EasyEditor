import {
  PersistenceLineageContractError,
  assertExactRecord,
  cloneJsonValue,
  compareCodeUnits,
  failContract,
  freezeDto,
  optionalOwnDataValue,
  ownDataValue,
  requireLiteral,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireSchemaVersion,
} from './contract.mjs'

export { PersistenceLineageContractError }

export const HUMAN_PROVENANCE_TOKEN = 'human'
export const EXTERNAL_PROVENANCE_TOKEN = 'external'
export const UNKNOWN_PROVENANCE_TOKEN = 'unknown'

const escapeRfc6901Segment = segment => segment.replaceAll('~', '~0').replaceAll('/', '~1')

const requirePath = (path, label) => {
  if (!Array.isArray(path)) return failContract('must-be-an-array', label)
  return cloneJsonValue(path, label).map((segment, index) => {
    if (typeof segment !== 'string') return failContract('segments-must-be-strings', `${label}[${index}]`)
    return segment
  })
}

const authorityPrefix = ({ projectId, branchId }, label) => {
  const project = escapeRfc6901Segment(requireNonEmptyString(projectId, `${label}.projectId`))
  const branch = escapeRfc6901Segment(requireNonEmptyString(branchId, `${label}.branchId`))
  return `${project}/${branch}`
}

const parseFieldSlotInput = input => {
  assertExactRecord(input, ['projectId', 'branchId', 'nodeId', 'root', 'path'], [], 'FieldSlotInput')
  const projectId = requireNonEmptyString(
    ownDataValue(input, 'projectId', 'FieldSlotInput'),
    'FieldSlotInput.projectId',
  )
  const branchId = requireNonEmptyString(ownDataValue(input, 'branchId', 'FieldSlotInput'), 'FieldSlotInput.branchId')
  const nodeId = requireNonEmptyString(ownDataValue(input, 'nodeId', 'FieldSlotInput'), 'FieldSlotInput.nodeId')
  const root = requireLiteral(ownDataValue(input, 'root', 'FieldSlotInput'), ['props', 'extras'], 'FieldSlotInput.root')
  const path = requirePath(ownDataValue(input, 'path', 'FieldSlotInput'), 'FieldSlotInput.path')
  return { projectId, branchId, nodeId, root, path }
}

const parseNodeSlotInput = input => {
  assertExactRecord(input, ['projectId', 'branchId', 'nodeId'], [], 'NodeSlotInput')
  return {
    projectId: requireNonEmptyString(ownDataValue(input, 'projectId', 'NodeSlotInput'), 'NodeSlotInput.projectId'),
    branchId: requireNonEmptyString(ownDataValue(input, 'branchId', 'NodeSlotInput'), 'NodeSlotInput.branchId'),
    nodeId: requireNonEmptyString(ownDataValue(input, 'nodeId', 'NodeSlotInput'), 'NodeSlotInput.nodeId'),
  }
}

const nodeSlotKey = (input, alias) => {
  const parsed = parseNodeSlotInput(input)
  return `${authorityPrefix(parsed, 'NodeSlotInput')}/node/${escapeRfc6901Segment(parsed.nodeId)}/${alias}`
}

export const toRfc6901Pointer = path =>
  requirePath(path, 'JsonPointerPath')
    .map(segment => `/${escapeRfc6901Segment(segment)}`)
    .join('')

export const createFieldSlotKey = input => {
  const parsed = parseFieldSlotInput(input)
  return `${authorityPrefix(parsed, 'FieldSlotInput')}/${escapeRfc6901Segment(parsed.nodeId)}/${parsed.root}${toRfc6901Pointer(parsed.path)}`
}

export const createFieldSlotAliases = input => {
  const parsed = parseFieldSlotInput(input)
  return Object.freeze(
    Array.from({ length: parsed.path.length + 1 }, (_, length) =>
      createFieldSlotKey({ ...parsed, path: parsed.path.slice(0, length) }),
    ),
  )
}

export const createNodeExistenceSlotKey = input => nodeSlotKey(input, 'existence')

export const createNodeParentSlotKey = input => nodeSlotKey(input, 'parent')

export const createNodeSubtreeSlotKey = input => nodeSlotKey(input, 'subtree')

export const createNodeStructuralSlotKeys = input =>
  Object.freeze([createNodeExistenceSlotKey(input), createNodeParentSlotKey(input), createNodeSubtreeSlotKey(input)])

export const createChildrenOrderSlotKey = input => {
  assertExactRecord(input, ['projectId', 'branchId', 'parentId'], [], 'ChildrenOrderSlotInput')
  const parsed = {
    projectId: requireNonEmptyString(
      ownDataValue(input, 'projectId', 'ChildrenOrderSlotInput'),
      'ChildrenOrderSlotInput.projectId',
    ),
    branchId: requireNonEmptyString(
      ownDataValue(input, 'branchId', 'ChildrenOrderSlotInput'),
      'ChildrenOrderSlotInput.branchId',
    ),
    parentId: requireNonEmptyString(
      ownDataValue(input, 'parentId', 'ChildrenOrderSlotInput'),
      'ChildrenOrderSlotInput.parentId',
    ),
  }
  return `${authorityPrefix(parsed, 'ChildrenOrderSlotInput')}/parent/${escapeRfc6901Segment(parsed.parentId)}/children-order`
}

export const createAgentProvenanceToken = callId =>
  `agent:${requireNonEmptyString(callId, 'AgentProvenanceToken.callId')}`

export const parseProvenanceToken = token => {
  requireNonEmptyString(token, 'ProvenanceToken')
  if (token === HUMAN_PROVENANCE_TOKEN) return freezeDto({ source: 'human' })
  if (token === EXTERNAL_PROVENANCE_TOKEN) return freezeDto({ source: 'external' })
  if (token === UNKNOWN_PROVENANCE_TOKEN) return freezeDto({ source: 'unknown' })
  if (token.startsWith('agent:') && token.length > 'agent:'.length) {
    return freezeDto({ source: 'agent', callId: token.slice('agent:'.length) })
  }
  return failContract('must-be-a-canonical-provenance-token', 'ProvenanceToken')
}

const safeOwnData = (value, key) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

export const resolveProvenanceToken = evidence => {
  const source = safeOwnData(evidence, 'source')
  if (
    safeOwnData(evidence, 'ambiguous') === true ||
    safeOwnData(evidence, 'listenerGap') === true ||
    safeOwnData(evidence, 'restartGap') === true
  ) {
    return UNKNOWN_PROVENANCE_TOKEN
  }
  if (source === 'human') return HUMAN_PROVENANCE_TOKEN
  if (source === 'external') return EXTERNAL_PROVENANCE_TOKEN
  if (source === 'unknown') return UNKNOWN_PROVENANCE_TOKEN
  if (source === 'agent') {
    const callId = safeOwnData(evidence, 'callId')
    return typeof callId === 'string' && callId.length > 0
      ? createAgentProvenanceToken(callId)
      : UNKNOWN_PROVENANCE_TOKEN
  }
  return UNKNOWN_PROVENANCE_TOKEN
}

const validateSlotScope = (slotKey, projectId, branchId, path) => {
  requireNonEmptyString(slotKey, path)
  const prefix = `${authorityPrefix({ projectId, branchId }, path)}/`
  if (!slotKey.startsWith(prefix)) return failContract('slot-key-must-match-project-branch-scope', path)
  return slotKey
}

export const parseMutationProvenance = value => {
  assertExactRecord(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'slotKey', 'draftGeneration', 'token'],
    [],
    'MutationProvenance',
  )
  const schemaVersion = requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'MutationProvenance'),
    'MutationProvenance.schemaVersion',
  )
  const projectId = requireNonEmptyString(
    ownDataValue(value, 'projectId', 'MutationProvenance'),
    'MutationProvenance.projectId',
  )
  const branchId = requireNonEmptyString(
    ownDataValue(value, 'branchId', 'MutationProvenance'),
    'MutationProvenance.branchId',
  )
  const slotKey = validateSlotScope(
    ownDataValue(value, 'slotKey', 'MutationProvenance'),
    projectId,
    branchId,
    'MutationProvenance.slotKey',
  )
  const draftGeneration = requireNonNegativeInteger(
    ownDataValue(value, 'draftGeneration', 'MutationProvenance'),
    'MutationProvenance.draftGeneration',
  )
  const token = ownDataValue(value, 'token', 'MutationProvenance')
  parseProvenanceToken(token)
  return freezeDto({ schemaVersion, projectId, branchId, slotKey, draftGeneration, token })
}

export const createMutationProvenance = parseMutationProvenance

export const createMutationProvenanceBatch = input => {
  assertExactRecord(
    input,
    ['projectId', 'branchId', 'draftGeneration', 'slotKeys', 'source'],
    ['callId', 'ambiguous', 'listenerGap', 'restartGap'],
    'MutationProvenanceBatchInput',
  )
  const projectId = requireNonEmptyString(
    ownDataValue(input, 'projectId', 'MutationProvenanceBatchInput'),
    'MutationProvenanceBatchInput.projectId',
  )
  const branchId = requireNonEmptyString(
    ownDataValue(input, 'branchId', 'MutationProvenanceBatchInput'),
    'MutationProvenanceBatchInput.branchId',
  )
  const draftGeneration = requireNonNegativeInteger(
    ownDataValue(input, 'draftGeneration', 'MutationProvenanceBatchInput'),
    'MutationProvenanceBatchInput.draftGeneration',
  )
  const slotKeys = ownDataValue(input, 'slotKeys', 'MutationProvenanceBatchInput')
  if (!Array.isArray(slotKeys)) return failContract('must-be-an-array', 'MutationProvenanceBatchInput.slotKeys')
  const parsedSlotKeys = cloneJsonValue(slotKeys, 'MutationProvenanceBatchInput.slotKeys')
  for (const [index, slotKey] of parsedSlotKeys.entries()) {
    requireNonEmptyString(slotKey, `MutationProvenanceBatchInput.slotKeys[${index}]`)
  }

  const evidence = {
    source: ownDataValue(input, 'source', 'MutationProvenanceBatchInput'),
    callId: optionalOwnDataValue(input, 'callId', 'MutationProvenanceBatchInput'),
    ambiguous: optionalOwnDataValue(input, 'ambiguous', 'MutationProvenanceBatchInput'),
    listenerGap: optionalOwnDataValue(input, 'listenerGap', 'MutationProvenanceBatchInput'),
    restartGap: optionalOwnDataValue(input, 'restartGap', 'MutationProvenanceBatchInput'),
  }
  const token = resolveProvenanceToken(evidence)
  const canonicalSlotKeys = [...new Set(parsedSlotKeys)].sort(compareCodeUnits)
  for (const slotKey of canonicalSlotKeys) {
    validateSlotScope(slotKey, projectId, branchId, 'MutationProvenanceBatchInput.slotKeys')
  }

  return freezeDto(
    canonicalSlotKeys.map(slotKey =>
      createMutationProvenance({
        schemaVersion: 1,
        projectId,
        branchId,
        slotKey,
        draftGeneration,
        token,
      }),
    ),
  )
}
