import {
  createChildrenOrderSlotKey,
  createFieldSlotAliases,
  createFieldSlotKey,
  createNodeStructuralSlotKeys,
  createNodeSubtreeSlotKey,
} from '../../persistence/provenance.mjs'
import {
  DEFAULT_SCREEN_CHANGESET_LIMITS,
  SCREEN_CHANGESET_SCHEMA_VERSION,
  ScreenChangeSetCompileError,
  assertExactRecord,
  cloneJsonValue,
  compareCodeUnits,
  fail,
  freezeDto,
  isPlainRecord,
  jsonEqual,
  normalizeLimits,
  optionalOwnDataValue,
  ownDataValue,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireSchemaVersion,
  validateValueSchema,
} from './contract.mjs'

export { DEFAULT_SCREEN_CHANGESET_LIMITS, SCREEN_CHANGESET_SCHEMA_VERSION, ScreenChangeSetCompileError }

const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const CORE_PATH_UNSUPPORTED = /[.\s[\]]/u
const CORE_MAX_PROPERTY_PATH_LENGTH = 256
const CORE_MAX_UNSET_PATHS = 100
const CORE_MAX_UNSET_TOTAL_LENGTH = 8192
const RESERVED_NODE_EXTRA_KEYS = new Set(['children', 'componentName', 'id', 'props'])
const RESERVED_ARTIFACT_BINDING_EXTRA_PATHS = Object.freeze([
  Object.freeze(['$agent']),
  Object.freeze(['artifactRef']),
  Object.freeze(['extra', 'artifactRef']),
])
const MANIFEST_FIELD_KEYS = Object.freeze([
  'access',
  'fieldId',
  'readPath',
  'required',
  'title',
  'unsetTargets',
  'valueSchema',
  'verifyPaths',
  'writeTargets',
])

const stableDigest = value => {
  const input = JSON.stringify(value)
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  let third = 0x85ebca6b
  let fourth = 0xc2b2ae35
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ (code + index), 0x85ebca6b)
    third = Math.imul(third ^ (code + first), 0xc2b2ae35)
    fourth = Math.imul(fourth ^ (code + second), 0x27d4eb2f)
  }
  return [first, second, third, fourth].map(part => (part >>> 0).toString(16).padStart(8, '0')).join('')
}

export const deriveInsertedScreenNodeId = (callId, opId) => {
  const trustedCallId = requireNonEmptyString(callId, 'callId', { maxLength: 256 })
  const operationId = requireNonEmptyString(opId, 'opId', { maxLength: 256 })
  return `agent-node-v1-${stableDigest([trustedCallId, operationId])}`
}

const pathEquals = (left, right) =>
  left.length === right.length && left.every((segment, index) => segment === right[index])

const pathIsPrefix = (prefix, path) =>
  prefix.length <= path.length && prefix.every((segment, index) => segment === path[index])

const pathsOverlap = (left, right) => pathIsPrefix(left, right) || pathIsPrefix(right, left)

const assertAgentJsonValue = (value, path) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertAgentJsonValue(item, `${path}[${index}]`))
    return value
  }
  if (!isPlainRecord(value)) return value
  if (value.type === 'JSExpression' || value.type === 'JSFunction') {
    return fail('INVALID_JSON', 'executable-core-value-shapes-are-not-allowed', path)
  }
  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS_PATH_SEGMENTS.has(key)) {
      return fail('INVALID_JSON', 'dangerous-json-key-is-not-allowed', `${path}.${key}`)
    }
    assertAgentJsonValue(item, `${path}.${key}`)
  }
  return value
}

const requireArray = (value, path, limit, code = 'INVALID_CHANGESET') => {
  if (!Array.isArray(value)) return fail(code, 'must-be-an-array', path)
  if (value.length > limit) return fail('BUDGET_EXCEEDED', 'array-budget-exceeded', path)
  return value
}

const requirePathSegments = (value, path, limits, { allowEmpty = false, corePath = false } = {}) => {
  const segments = requireArray(value, path, limits.maxPathSegments, 'INVALID_MANIFEST')
  if (!allowEmpty && segments.length === 0) return fail('INVALID_MANIFEST', 'path-must-not-be-empty', path)
  return segments.map((segment, index) => {
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment.length > limits.maxPathSegmentLength ||
      DANGEROUS_PATH_SEGMENTS.has(segment) ||
      segment.normalize('NFC') !== segment ||
      (corePath && CORE_PATH_UNSUPPORTED.test(segment))
    ) {
      return fail('INVALID_MANIFEST', 'path-segment-is-not-supported-by-core', `${path}[${index}]`)
    }
    return segment
  })
}

const normalizeManifestTarget = (value, path, limits) => {
  assertExactRecord(value, ['path'], ['valuePath'], path, 'INVALID_MANIFEST')
  const projectionPath = requirePathSegments(
    ownDataValue(value, 'path', path, 'INVALID_MANIFEST'),
    `${path}.path`,
    limits,
    { corePath: true },
  )
  const manifestRoot = projectionPath[0]
  if (manifestRoot !== 'props' && manifestRoot !== 'extra') {
    return fail('INVALID_MANIFEST', 'write-target-root-must-be-props-or-extra', `${path}.path[0]`)
  }
  const relativePath = projectionPath.slice(1)
  if (relativePath.length === 0) return fail('INVALID_MANIFEST', 'write-target-must-address-a-field', `${path}.path`)
  if (manifestRoot === 'extra' && RESERVED_NODE_EXTRA_KEYS.has(relativePath[0])) {
    return fail('INVALID_MANIFEST', 'write-target-cannot-address-node-structure', `${path}.path[1]`)
  }
  if (
    manifestRoot === 'extra' &&
    RESERVED_ARTIFACT_BINDING_EXTRA_PATHS.some(reservedPath => pathsOverlap(relativePath, reservedPath))
  ) {
    return fail('INVALID_MANIFEST', 'write-target-cannot-address-artifact-binding', `${path}.path`)
  }
  const rawValuePath = optionalOwnDataValue(value, 'valuePath', path, 'INVALID_MANIFEST')
  const valuePath =
    rawValuePath === undefined
      ? undefined
      : requirePathSegments(rawValuePath, `${path}.valuePath`, limits, { allowEmpty: true })
  return {
    root: manifestRoot === 'props' ? 'props' : 'extras',
    path: relativePath,
    ...(valuePath === undefined ? {} : { valuePath }),
  }
}

const normalizeManifestTargets = (value, path, limits) => {
  if (value === undefined) return []
  const targets = requireArray(value, path, limits.maxFieldsPerManifest, 'INVALID_MANIFEST').map((target, index) =>
    normalizeManifestTarget(target, `${path}[${index}]`, limits),
  )
  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
      const left = targets[leftIndex]
      const right = targets[rightIndex]
      if (left.root === right.root && pathsOverlap(left.path, right.path)) {
        return fail('INVALID_MANIFEST', 'manifest-field-has-overlapping-targets', path)
      }
    }
  }
  return targets.sort((left, right) => compareCodeUnits(targetKey(left), targetKey(right)))
}

const normalizeManifestField = (value, path, limits) => {
  assertExactRecord(
    value,
    ['access', 'fieldId'],
    MANIFEST_FIELD_KEYS.filter(key => !['access', 'fieldId'].includes(key)),
    path,
    'INVALID_MANIFEST',
  )
  const fieldId = requireNonEmptyString(ownDataValue(value, 'fieldId', path, 'INVALID_MANIFEST'), `${path}.fieldId`, {
    code: 'INVALID_MANIFEST',
    maxLength: limits.maxStringLength,
  })
  const access = ownDataValue(value, 'access', path, 'INVALID_MANIFEST')
  if (!['read-only', 'read-write', 'unsupported'].includes(access)) {
    return fail('INVALID_MANIFEST', 'field-access-is-invalid', `${path}.access`)
  }
  const writeTargets = normalizeManifestTargets(
    optionalOwnDataValue(value, 'writeTargets', path, 'INVALID_MANIFEST'),
    `${path}.writeTargets`,
    limits,
  )
  const unsetTargets = normalizeManifestTargets(
    optionalOwnDataValue(value, 'unsetTargets', path, 'INVALID_MANIFEST'),
    `${path}.unsetTargets`,
    limits,
  )
  if (access === 'read-write' && writeTargets.length === 0) {
    return fail('INVALID_MANIFEST', 'writable-field-requires-write-targets', path)
  }
  return {
    access,
    fieldId,
    writeTargets,
    unsetTargets,
    valueSchema: optionalOwnDataValue(value, 'valueSchema', path, 'INVALID_MANIFEST'),
  }
}

const normalizeRegistryVersion = (value, path) => {
  if (typeof value === 'string' && value.length > 0 && value.length <= 256) return value
  if (Number.isSafeInteger(value) && value >= 0) return value
  return fail('INVALID_MANIFEST', 'material-registry-version-is-invalid', path)
}

const normalizeReadinessIds = (value, path, limits) => {
  const ids = requireArray(value, path, limits.maxFieldsPerManifest, 'INVALID_MANIFEST').map((item, index) =>
    requireNonEmptyString(item, `${path}[${index}]`, {
      code: 'INVALID_MANIFEST',
      maxLength: limits.maxStringLength,
    }),
  )
  const unique = new Set(ids)
  if (unique.size !== ids.length) return fail('INVALID_MANIFEST', 'readiness-field-ids-must-be-unique', path)
  return [...unique].sort(compareCodeUnits)
}

const normalizeManifestReadiness = (value, path, limits) => {
  assertExactRecord(value, ['missingFieldIds', 'status', 'unsupportedFieldIds'], [], path, 'INVALID_MANIFEST')
  const status = ownDataValue(value, 'status', path, 'INVALID_MANIFEST')
  if (status !== 'ready' && status !== 'not-ready') {
    return fail('INVALID_MANIFEST', 'manifest-readiness-status-is-invalid', `${path}.status`)
  }
  const missingFieldIds = normalizeReadinessIds(
    ownDataValue(value, 'missingFieldIds', path, 'INVALID_MANIFEST'),
    `${path}.missingFieldIds`,
    limits,
  )
  const unsupportedFieldIds = normalizeReadinessIds(
    ownDataValue(value, 'unsupportedFieldIds', path, 'INVALID_MANIFEST'),
    `${path}.unsupportedFieldIds`,
    limits,
  )
  if (status !== 'ready' || missingFieldIds.length > 0 || unsupportedFieldIds.length > 0) {
    return fail('INVALID_MANIFEST', 'material-manifest-is-not-ready', path)
  }
  return { status, missingFieldIds, unsupportedFieldIds }
}

const manifestFieldSemantics = field => ({
  access: field.access,
  fieldId: field.fieldId,
  unsetTargets: field.unsetTargets,
  ...(field.valueSchema === undefined ? {} : { valueSchema: field.valueSchema }),
  writeTargets: field.writeTargets,
})

const normalizeManifests = (values, limits, expectedRegistryVersion) => {
  const manifests = requireArray(values, 'compileInput.manifests', limits.maxManifests, 'INVALID_MANIFEST')
  const byComponent = new Map()
  const fingerprints = []
  manifests.forEach((manifest, manifestIndex) => {
    const path = `compileInput.manifests[${manifestIndex}]`
    assertExactRecord(
      manifest,
      ['componentName', 'diagnostics', 'fields', 'materialRegistryVersion', 'readiness', 'schemaVersion'],
      ['category', 'group', 'title'],
      path,
      'INVALID_MANIFEST',
    )
    if (ownDataValue(manifest, 'schemaVersion', path, 'INVALID_MANIFEST') !== 1) {
      return fail('INVALID_MANIFEST', 'unsupported-manifest-schema-version', `${path}.schemaVersion`)
    }
    const materialRegistryVersion = normalizeRegistryVersion(
      ownDataValue(manifest, 'materialRegistryVersion', path, 'INVALID_MANIFEST'),
      `${path}.materialRegistryVersion`,
    )
    if (materialRegistryVersion !== expectedRegistryVersion) {
      return fail('INVALID_MANIFEST', 'stale-or-mixed-material-registry-version', `${path}.materialRegistryVersion`)
    }
    const readiness = normalizeManifestReadiness(
      ownDataValue(manifest, 'readiness', path, 'INVALID_MANIFEST'),
      `${path}.readiness`,
      limits,
    )
    const componentName = requireNonEmptyString(
      ownDataValue(manifest, 'componentName', path, 'INVALID_MANIFEST'),
      `${path}.componentName`,
      { code: 'INVALID_MANIFEST', maxLength: limits.maxStringLength },
    )
    if (byComponent.has(componentName)) return fail('INVALID_MANIFEST', 'duplicate-component-manifest', path)
    const rawFields = requireArray(
      ownDataValue(manifest, 'fields', path, 'INVALID_MANIFEST'),
      `${path}.fields`,
      limits.maxFieldsPerManifest,
      'INVALID_MANIFEST',
    )
    const fields = new Map()
    rawFields.forEach((field, fieldIndex) => {
      const normalized = normalizeManifestField(field, `${path}.fields[${fieldIndex}]`, limits)
      if (fields.has(normalized.fieldId)) {
        return fail('INVALID_MANIFEST', 'duplicate-field-id', `${path}.fields[${fieldIndex}].fieldId`)
      }
      fields.set(normalized.fieldId, normalized)
    })
    const semanticFields = [...fields.values()]
      .map(manifestFieldSemantics)
      .sort((left, right) => compareCodeUnits(left.fieldId, right.fieldId))
    const semanticManifest = {
      schemaVersion: 1,
      materialRegistryVersion,
      componentName,
      readiness,
      fields: semanticFields,
    }
    const semanticDigest = `manifest-v1-${stableDigest(semanticManifest)}`
    byComponent.set(componentName, { componentName, fields, materialRegistryVersion, readiness, semanticDigest })
    fingerprints.push({
      componentName,
      materialRegistryVersion,
      readiness,
      semanticDescriptor: semanticManifest,
      semanticDigest,
    })
  })
  fingerprints.sort((left, right) => compareCodeUnits(left.componentName, right.componentName))
  return { byComponent, fingerprints }
}

const requireNodeIdentity = (schema, path, limits) => {
  if (!isPlainRecord(schema)) return fail('AMBIGUOUS_STRUCTURE', 'node-must-be-a-plain-object', path)
  const id = requireNonEmptyString(schema.id, `${path}.id`, {
    code: 'AMBIGUOUS_STRUCTURE',
    maxLength: Math.min(256, limits.maxStringLength),
  })
  const componentName = requireNonEmptyString(schema.componentName, `${path}.componentName`, {
    code: 'AMBIGUOUS_STRUCTURE',
    maxLength: limits.maxStringLength,
  })
  if (schema.props !== undefined && !isPlainRecord(schema.props)) {
    return fail('AMBIGUOUS_STRUCTURE', 'node-props-must-be-a-plain-object', `${path}.props`)
  }
  return { componentName, id }
}

const buildDocumentGraph = (schema, limits) => {
  const nodes = new Map()
  const visit = (nodeSchema, parentId, path) => {
    if (nodes.size >= limits.maxDocumentNodes) return fail('BUDGET_EXCEEDED', 'document-node-budget-exceeded', path)
    const { componentName, id } = requireNodeIdentity(nodeSchema, path, limits)
    if (nodes.has(id)) return fail('AMBIGUOUS_STRUCTURE', 'duplicate-node-id', `${path}.id`)
    const children =
      nodeSchema.children === undefined
        ? []
        : requireArray(nodeSchema.children, `${path}.children`, limits.maxArrayLength)
    const record = {
      componentName,
      id,
      locked: nodeSchema.locked === true,
      parentId,
      schema: nodeSchema,
      children: [],
    }
    nodes.set(id, record)
    children.forEach((child, index) => {
      const childRecord = visit(child, id, `${path}.children[${index}]`)
      record.children.push(childRecord.id)
    })
    return record
  }
  const root = visit(schema, null, 'compileInput.document.schema')
  return { nodes, rootId: root.id }
}

const syncChildrenSchema = (graph, parent) => {
  if (parent.children.length === 0) Reflect.deleteProperty(parent.schema, 'children')
  else parent.schema.children = parent.children.map(id => graph.nodes.get(id).schema)
}

const requireNode = (graph, nodeId, path) => {
  const node = graph.nodes.get(nodeId)
  if (!node) return fail('UNKNOWN_NODE', 'node-does-not-exist', path)
  return node
}

const requireUnlocked = (node, path) => {
  if (node.locked) return fail('AMBIGUOUS_STRUCTURE', 'locked-node-cannot-be-mutated', path)
}

const getPlacement = (graph, nodeId, operationIndex, existed = true) => {
  if (!existed) {
    return {
      operationIndex,
      kind: 'placement',
      nodeId,
      existed: false,
      parentId: null,
      index: null,
      beforeId: null,
      afterId: null,
    }
  }
  const node = requireNode(graph, nodeId, `operations[${operationIndex}].nodeId`)
  if (node.parentId === null)
    return fail('AMBIGUOUS_STRUCTURE', 'root-node-has-no-placement', `operations[${operationIndex}]`)
  const parent = requireNode(graph, node.parentId, `operations[${operationIndex}].parentId`)
  const index = parent.children.indexOf(nodeId)
  if (index < 0)
    return fail('AMBIGUOUS_STRUCTURE', 'parent-child-identity-is-inconsistent', `operations[${operationIndex}]`)
  return {
    operationIndex,
    kind: 'placement',
    nodeId,
    existed: true,
    parentId: parent.id,
    index,
    beforeId: index > 0 ? parent.children[index - 1] : null,
    afterId: index + 1 < parent.children.length ? parent.children[index + 1] : null,
  }
}

const getNodeImage = (nodeId, operationIndex, existed, node = null) => ({
  operationIndex,
  kind: 'node',
  nodeId,
  existed,
  node: existed ? node : null,
})

const getAtPath = (root, path) => {
  let current = root
  for (const segment of path) {
    if (!isPlainRecord(current) || !Object.hasOwn(current, segment)) return { existed: false, value: null }
    current = current[segment]
  }
  return { existed: true, value: current }
}

const readNodeTarget = (node, target) => {
  if (target.root === 'props') {
    if (!isPlainRecord(node.schema.props)) return { existed: false, value: null }
    return getAtPath(node.schema.props, target.path)
  }
  return getAtPath(node.schema, target.path)
}

const ensurePathContainer = (root, path, errorPath) => {
  let current = root
  for (const segment of path) {
    if (!Object.hasOwn(current, segment)) current[segment] = {}
    else if (!isPlainRecord(current[segment])) {
      return fail('AMBIGUOUS_STRUCTURE', 'write-path-crosses-a-non-object-value', errorPath)
    }
    current = current[segment]
  }
  return current
}

const setAtPath = (root, path, value, errorPath) => {
  const parent = ensurePathContainer(root, path.slice(0, -1), errorPath)
  parent[path.at(-1)] = value
}

const deleteAtPath = (root, path) => {
  let current = root
  for (const segment of path.slice(0, -1)) {
    if (!isPlainRecord(current) || !Object.hasOwn(current, segment)) return
    current = current[segment]
  }
  if (isPlainRecord(current)) delete current[path.at(-1)]
}

const writeNodeTarget = (node, target, value, errorPath) => {
  if (target.root === 'props') {
    if (node.schema.props === undefined) node.schema.props = {}
    if (!isPlainRecord(node.schema.props)) {
      return fail('AMBIGUOUS_STRUCTURE', 'node-props-must-be-a-plain-object', errorPath)
    }
    setAtPath(node.schema.props, target.path, value, errorPath)
  } else {
    setAtPath(node.schema, target.path, value, errorPath)
  }
}

const unsetNodeTarget = (node, target) => {
  if (target.root === 'props') {
    if (isPlainRecord(node.schema.props)) deleteAtPath(node.schema.props, target.path)
  } else deleteAtPath(node.schema, target.path)
}

const extractValuePath = (value, path) => {
  if (path === undefined || path.length === 0) return { found: true, value }
  let current = value
  for (const segment of path) {
    if (!isPlainRecord(current) || !Object.hasOwn(current, segment)) return { found: false, value: null }
    current = current[segment]
  }
  return { found: true, value: current }
}

const toDottedPath = target => {
  const path = target.path.join('.')
  if (path.length > CORE_MAX_PROPERTY_PATH_LENGTH) {
    return fail('INVALID_MANIFEST', 'core-property-path-is-too-long', 'compileInput.manifests')
  }
  return path
}

const fieldImage = ({ operationIndex, nodeId, fieldId, target, image }) => ({
  operationIndex,
  kind: 'field',
  nodeId,
  fieldId,
  root: target.root,
  path: target.path,
  existed: image.existed,
  value: image.existed ? image.value : null,
})

const resolveField = (context, componentName, fieldId, path) => {
  const manifest = context.manifests.get(componentName)
  if (!manifest) return fail('UNKNOWN_MATERIAL', 'material-manifest-is-unavailable', path)
  const field = manifest.fields.get(fieldId)
  if (!field) return fail('UNKNOWN_FIELD', 'field-is-not-in-the-safe-manifest', path)
  if (field.access !== 'read-write') return fail('UNSUPPORTED_FIELD', 'field-is-not-writable', path)
  return field
}

const claimFieldTarget = (context, nodeId, fieldId, target, operationIndex) => {
  for (const claim of context.fieldClaims) {
    if (claim.nodeId === nodeId && claim.root === target.root && pathsOverlap(claim.path, target.path)) {
      return fail(
        'WRITE_CONFLICT',
        `field-write-overlaps-operation-${claim.operationIndex}`,
        `compileInput.changeSet.operations[${operationIndex}]`,
      )
    }
  }
  context.fieldClaims.push({ nodeId, root: target.root, path: target.path, operationIndex })
  const aliases = createFieldSlotAliases({
    projectId: context.projectId,
    branchId: context.branchId,
    nodeId,
    root: target.root,
    path: target.path,
  })
  const slotKey = aliases.at(-1)
  context.fieldSlots.set(slotKey, {
    nodeId,
    fieldId,
    root: target.root,
    path: target.path,
    slotKey,
    aliases: [...aliases],
  })
  for (const alias of aliases) context.affectedSlotKeys.add(alias)
}

const collectDescendantPaths = (basePath, value, result) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const path = [...basePath, String(index)]
      result.set(JSON.stringify(path), path)
      collectDescendantPaths(path, item, result)
    })
    return
  }
  if (!isPlainRecord(value)) return
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    const path = [...basePath, key]
    result.set(JSON.stringify(path), path)
    collectDescendantPaths(path, value[key], result)
  }
}

const extendFieldSlotDescendants = (context, nodeId, target, images) => {
  const exactAliases = createFieldSlotAliases({
    projectId: context.projectId,
    branchId: context.branchId,
    nodeId,
    root: target.root,
    path: target.path,
  })
  const slotKey = exactAliases.at(-1)
  const slot = context.fieldSlots.get(slotKey)
  const descendants = new Map()
  for (const image of images) {
    if (image.existed) collectDescendantPaths(target.path, image.value, descendants)
  }
  const aliases = new Set(slot.aliases)
  for (const path of descendants.values()) {
    aliases.add(
      createFieldSlotKey({
        projectId: context.projectId,
        branchId: context.branchId,
        nodeId,
        root: target.root,
        path,
      }),
    )
  }
  const sortedAliases = [...aliases].sort(compareCodeUnits)
  context.fieldSlots.set(slotKey, { ...slot, aliases: sortedAliases })
  for (const alias of sortedAliases) context.affectedSlotKeys.add(alias)
}

const structuralKindFor = slotKey => {
  if (slotKey.endsWith('/existence')) return 'node-existence'
  if (slotKey.endsWith('/parent')) return 'node-parent'
  if (slotKey.endsWith('/subtree')) return 'node-subtree'
  return 'children-order'
}

const claimStructuralSlot = (context, slotKey, identity) => {
  if (!context.structuralSlots.has(slotKey)) {
    context.structuralSlots.set(slotKey, {
      kind: structuralKindFor(slotKey),
      ...identity,
      slotKey,
    })
  }
  context.affectedSlotKeys.add(slotKey)
}

const claimAncestorSubtrees = (context, startNodeId, operationIndex) => {
  let node = requireNode(context.graph, startNodeId, `compileInput.changeSet.operations[${operationIndex}]`)
  const visited = new Set()
  while (node) {
    if (visited.has(node.id)) {
      return fail(
        'AMBIGUOUS_STRUCTURE',
        'ancestor-chain-contains-a-cycle',
        `compileInput.changeSet.operations[${operationIndex}]`,
      )
    }
    visited.add(node.id)
    const slotKey = createNodeSubtreeSlotKey({
      projectId: context.projectId,
      branchId: context.branchId,
      nodeId: node.id,
    })
    claimStructuralSlot(context, slotKey, { nodeId: node.id })
    node = node.parentId === null ? null : requireNode(context.graph, node.parentId, 'ancestor.parentId')
  }
}

const claimNodeStructure = (context, nodeId) => {
  for (const slotKey of createNodeStructuralSlotKeys({
    projectId: context.projectId,
    branchId: context.branchId,
    nodeId,
  })) {
    claimStructuralSlot(context, slotKey, { nodeId })
  }
}

const claimChildrenOrder = (context, parentId) => {
  const slotKey = createChildrenOrderSlotKey({
    projectId: context.projectId,
    branchId: context.branchId,
    parentId,
  })
  claimStructuralSlot(context, slotKey, { parentId })
}

const createUpdateCommand = (context, nodeId, mutations) => {
  const props = Object.fromEntries(
    [...mutations.props.entries()].sort(([left], [right]) => compareCodeUnits(left, right)),
  )
  const extras = Object.fromEntries(
    [...mutations.extras.entries()].sort(([left], [right]) => compareCodeUnits(left, right)),
  )
  const unsetPropPaths = [...mutations.unsetPropPaths].sort(compareCodeUnits)
  const unsetExtraPaths = [...mutations.unsetExtraPaths].sort(compareCodeUnits)
  const unsetPaths = [...unsetPropPaths, ...unsetExtraPaths]
  if (unsetPaths.length > CORE_MAX_UNSET_PATHS) {
    return fail('INVALID_MANIFEST', 'core-unset-path-count-is-too-large', 'compileInput.manifests')
  }
  if (unsetPaths.reduce((total, path) => total + path.length, 0) > CORE_MAX_UNSET_TOTAL_LENGTH) {
    return fail('INVALID_MANIFEST', 'core-unset-path-budget-is-too-large', 'compileInput.manifests')
  }
  return {
    type: 'updateProps',
    documentId: context.documentId,
    nodeId,
    ...(Object.keys(props).length ? { props } : {}),
    ...(Object.keys(extras).length ? { extras } : {}),
    ...(unsetPropPaths.length ? { unsetPropPaths } : {}),
    ...(unsetExtraPaths.length ? { unsetExtraPaths } : {}),
  }
}

const targetKey = target =>
  `${target.root}:${JSON.stringify(target.path)}:${JSON.stringify(target.valuePath === undefined ? null : target.valuePath)}`

const coreTargetKey = target => `${target.root}:${JSON.stringify(target.path)}`

const targetSetsMatch = (targets, touched) => {
  const touchedKeys = new Set(touched.map(item => coreTargetKey(item.target)))
  return (
    targets.every(target => touchedKeys.has(coreTargetKey(target))) &&
    touched.every(item => targets.some(target => coreTargetKey(target) === coreTargetKey(item.target)))
  )
}

const targetMappingsAreSymmetric = (left, right) => {
  const leftKeys = [...left].map(targetKey).sort(compareCodeUnits)
  const rightKeys = [...right].map(targetKey).sort(compareCodeUnits)
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index])
}

const setNestedValue = (root, path, value, errorPath) => {
  if (path.length === 0) return value
  const result = root === undefined ? {} : root
  if (!isPlainRecord(result))
    return fail('INVERSE_UNREPRESENTABLE', 'inverse-value-paths-have-incompatible-roots', errorPath)
  setAtPath(result, path, value, errorPath)
  return result
}

const buildInverseFieldOperation = (context, { field, fieldId, kind, nodeId, opId, operationIndex, touched }) => {
  const errorPath = `compileInput.changeSet.operations[${operationIndex}]`
  const existed = touched.filter(item => item.pre.existed)
  if (existed.length === 0) {
    if (!targetSetsMatch(field.unsetTargets, touched)) {
      return fail('INVERSE_UNREPRESENTABLE', 'field-does-not-have-an-exact-unset-inverse', errorPath)
    }
    return { opId: `inverse:${opId}`, type: 'unset', nodeId, fieldId }
  }

  if (kind !== 'unset' && existed.length !== touched.length) {
    return fail('INVERSE_UNREPRESENTABLE', 'field-set-created-a-target-that-cannot-be-removed-exactly', errorPath)
  }

  let inverseValue
  let hasWholeValue = false
  for (const item of touched) {
    if (!item.pre.existed) {
      if (item.target.valuePath === undefined || item.target.valuePath.length === 0) {
        return fail('INVERSE_UNREPRESENTABLE', 'mixed-field-pre-image-cannot-be-restored', errorPath)
      }
      continue
    }
    if (item.target.valuePath === undefined || item.target.valuePath.length === 0) {
      if (inverseValue !== undefined && !jsonEqual(inverseValue, item.pre.value, context.limits)) {
        return fail('INVERSE_UNREPRESENTABLE', 'multi-target-field-pre-images-disagree', errorPath)
      }
      inverseValue = item.pre.value
      hasWholeValue = true
    } else {
      if (hasWholeValue)
        return fail('INVERSE_UNREPRESENTABLE', 'inverse-value-paths-have-incompatible-roots', errorPath)
      inverseValue = setNestedValue(inverseValue, item.target.valuePath, item.pre.value, errorPath)
    }
  }
  if (inverseValue === undefined) return fail('INVERSE_UNREPRESENTABLE', 'inverse-value-is-unavailable', errorPath)

  try {
    validateValueSchema(inverseValue, field.valueSchema, `${errorPath}.inverseValue`, context.limits)
  } catch (error) {
    if (error instanceof ScreenChangeSetCompileError) {
      return fail('INVERSE_UNREPRESENTABLE', 'field-pre-image-does-not-satisfy-current-manifest', errorPath)
    }
    throw error
  }

  const touchedByKey = new Map(touched.map(item => [targetKey(item.target), item]))
  for (const writeTarget of field.writeTargets) {
    const extracted = extractValuePath(inverseValue, writeTarget.valuePath)
    const original = touchedByKey.get(targetKey(writeTarget))
    if (!extracted.found) {
      if (original?.pre.existed)
        return fail('INVERSE_UNREPRESENTABLE', 'inverse-value-omits-an-existing-target', errorPath)
      continue
    }
    if (!original || !original.pre.existed || !jsonEqual(extracted.value, original.pre.value, context.limits)) {
      return fail('INVERSE_UNREPRESENTABLE', 'inverse-value-would-write-an-untracked-target', errorPath)
    }
  }

  if (kind === 'resize') return { opId: `inverse:${opId}`, type: 'resize', nodeId, rect: inverseValue }
  return { opId: `inverse:${opId}`, type: 'set', nodeId, fieldId, value: inverseValue }
}

const compileFieldMutation = (context, operation, operationIndex, node, { initial = false } = {}) => {
  const fieldId = operation.kind === 'resize' ? 'shared.rect' : operation.fieldId
  const field = resolveField(
    context,
    node.componentName,
    fieldId,
    `compileInput.changeSet.operations[${operationIndex}].fieldId`,
  )
  const isUnset = operation.kind === 'unset'
  const targets = isUnset ? field.unsetTargets : field.writeTargets
  if (isUnset && targets.length === 0) {
    return fail(
      'UNSUPPORTED_FIELD',
      'field-does-not-have-safe-unset-semantics',
      `compileInput.changeSet.operations[${operationIndex}]`,
    )
  }
  if (isUnset && !targetMappingsAreSymmetric(field.writeTargets, field.unsetTargets)) {
    return fail(
      'INVERSE_UNREPRESENTABLE',
      'field-write-and-unset-targets-are-not-symmetric',
      `compileInput.changeSet.operations[${operationIndex}]`,
    )
  }
  if (!isUnset) {
    validateValueSchema(
      operation.value,
      field.valueSchema,
      `compileInput.changeSet.operations[${operationIndex}].value`,
      context.limits,
    )
  }

  const mutations = {
    props: new Map(),
    extras: new Map(),
    unsetPropPaths: [],
    unsetExtraPaths: [],
  }
  const touched = []
  for (const target of targets) {
    const extracted = isUnset ? { found: true, value: null } : extractValuePath(operation.value, target.valuePath)
    if (!extracted.found) continue
    claimFieldTarget(context, node.id, fieldId, target, operationIndex)
    const pre = readNodeTarget(node, target)
    const preImage = fieldImage({ operationIndex, nodeId: node.id, fieldId, target, image: pre })
    context.preImages.push(preImage)
    if (isUnset) {
      unsetNodeTarget(node, target)
      const dotted = toDottedPath(target)
      if (target.root === 'props') mutations.unsetPropPaths.push(dotted)
      else mutations.unsetExtraPaths.push(dotted)
    } else {
      writeNodeTarget(node, target, extracted.value, `compileInput.changeSet.operations[${operationIndex}].value`)
      if (target.root === 'props') mutations.props.set(toDottedPath(target), extracted.value)
      else mutations.extras.set(toDottedPath(target), extracted.value)
    }
    const post = readNodeTarget(node, target)
    context.expectedPostImages.push(fieldImage({ operationIndex, nodeId: node.id, fieldId, target, image: post }))
    extendFieldSlotDescendants(context, node.id, target, [pre, post])
    touched.push({ target, pre, post })
  }
  if (touched.length === 0) {
    return fail(
      'UNSUPPORTED_FIELD',
      'field-value-does-not-resolve-to-any-safe-write-target',
      `compileInput.changeSet.operations[${operationIndex}]`,
    )
  }

  if (!initial) {
    context.commands.push(createUpdateCommand(context, node.id, mutations))
    const inverse = buildInverseFieldOperation(context, {
      field,
      fieldId,
      kind: operation.kind,
      nodeId: node.id,
      opId: operation.opId,
      operationIndex,
      touched,
    })
    context.inverses.push({
      sourceOperationId: operation.opId,
      sourceOperationIndex: operationIndex,
      operation: inverse,
    })
  }
  return { field, touched }
}

const normalizeRelativePosition = (value, path, limits) => {
  assertExactRecord(value, ['place'], ['siblingId'], path)
  const place = ownDataValue(value, 'place', path)
  if (place === 'first' || place === 'last') {
    if (Object.hasOwn(value, 'siblingId')) {
      return fail('INVALID_CHANGESET', 'absolute-relative-position-cannot-name-a-sibling', `${path}.siblingId`)
    }
    return { place }
  }
  if (place === 'before' || place === 'after') {
    const siblingId = requireNonEmptyString(ownDataValue(value, 'siblingId', path), `${path}.siblingId`, {
      maxLength: Math.min(256, limits.maxStringLength),
    })
    return { place, siblingId }
  }
  return fail('INVALID_CHANGESET', 'relative-position-place-is-invalid', `${path}.place`)
}

const normalizeInsertFields = (value, operationIndex, limits) => {
  const path = `compileInput.changeSet.operations[${operationIndex}].fields`
  if (value === undefined) return {}
  if (!isPlainRecord(value)) return fail('INVALID_CHANGESET', 'insert-fields-must-be-a-plain-object', path)
  const entries = Object.entries(value)
  if (entries.length > limits.maxFieldsPerManifest) {
    return fail('BUDGET_EXCEEDED', 'insert-field-budget-exceeded', path)
  }
  return Object.fromEntries(
    entries
      .map(([fieldId, fieldValue]) => [
        requireNonEmptyString(fieldId, `${path}.${fieldId}`, { maxLength: limits.maxStringLength }),
        assertAgentJsonValue(fieldValue, `${path}.${fieldId}`),
      ])
      .sort(([left], [right]) => compareCodeUnits(left, right)),
  )
}

const normalizeOperation = (value, operationIndex, limits) => {
  const path = `compileInput.changeSet.operations[${operationIndex}]`
  if (!isPlainRecord(value)) return fail('INVALID_CHANGESET', 'operation-must-be-a-plain-object', path)
  const type = ownDataValue(value, 'type', path)
  const opId = requireNonEmptyString(ownDataValue(value, 'opId', path), `${path}.opId`, {
    maxLength: Math.min(256, limits.maxStringLength),
  })
  switch (type) {
    case 'set':
      assertExactRecord(value, ['fieldId', 'nodeId', 'opId', 'type', 'value'], [], path)
      return {
        kind: 'set',
        type,
        opId,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        fieldId: requireNonEmptyString(value.fieldId, `${path}.fieldId`),
        value: assertAgentJsonValue(value.value, `${path}.value`),
      }
    case 'unset':
      assertExactRecord(value, ['fieldId', 'nodeId', 'opId', 'type'], [], path)
      return {
        kind: 'unset',
        type,
        opId,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        fieldId: requireNonEmptyString(value.fieldId, `${path}.fieldId`),
      }
    case 'resize': {
      assertExactRecord(value, ['nodeId', 'opId', 'rect', 'type'], [], path)
      assertExactRecord(value.rect, ['height', 'width', 'x', 'y'], [], `${path}.rect`)
      return {
        kind: 'resize',
        type,
        opId,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        value: assertAgentJsonValue(value.rect, `${path}.rect`),
      }
    }
    case 'insert': {
      assertExactRecord(value, ['componentName', 'opId', 'parentId', 'type'], ['fields', 'position'], path)
      const position = optionalOwnDataValue(value, 'position', path)
      return {
        kind: 'insert',
        type,
        opId,
        parentId: requireNonEmptyString(value.parentId, `${path}.parentId`),
        componentName: requireNonEmptyString(value.componentName, `${path}.componentName`),
        fields: normalizeInsertFields(optionalOwnDataValue(value, 'fields', path), operationIndex, limits),
        ...(position === undefined
          ? {}
          : { position: normalizeRelativePosition(position, `${path}.position`, limits) }),
      }
    }
    case 'move': {
      assertExactRecord(value, ['nodeId', 'opId', 'parentId', 'type'], ['position'], path)
      const position = optionalOwnDataValue(value, 'position', path)
      return {
        kind: 'move',
        type,
        opId,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        parentId: requireNonEmptyString(value.parentId, `${path}.parentId`),
        ...(position === undefined
          ? {}
          : { position: normalizeRelativePosition(position, `${path}.position`, limits) }),
      }
    }
    case 'reorder':
      assertExactRecord(value, ['nodeId', 'opId', 'position', 'type'], [], path)
      return {
        kind: 'reorder',
        type,
        opId,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        position: normalizeRelativePosition(value.position, `${path}.position`, limits),
      }
    case 'remove':
      assertExactRecord(value, ['nodeId', 'opId', 'type'], [], path)
      return {
        kind: 'remove',
        type,
        opId,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
      }
    default:
      return fail('INVALID_CHANGESET', 'operation-is-not-supported', `${path}.type`)
  }
}

const publicOperation = operation => {
  switch (operation.kind) {
    case 'set':
      return {
        opId: operation.opId,
        type: 'set',
        nodeId: operation.nodeId,
        fieldId: operation.fieldId,
        value: operation.value,
      }
    case 'unset':
      return { opId: operation.opId, type: 'unset', nodeId: operation.nodeId, fieldId: operation.fieldId }
    case 'resize':
      return { opId: operation.opId, type: 'resize', nodeId: operation.nodeId, rect: operation.value }
    case 'insert':
      return {
        opId: operation.opId,
        type: 'insert',
        parentId: operation.parentId,
        componentName: operation.componentName,
        ...(operation.position === undefined ? {} : { position: operation.position }),
        ...(Object.keys(operation.fields).length === 0 ? {} : { fields: operation.fields }),
      }
    case 'move':
      return {
        opId: operation.opId,
        type: 'move',
        nodeId: operation.nodeId,
        parentId: operation.parentId,
        ...(operation.position === undefined ? {} : { position: operation.position }),
      }
    case 'reorder':
      return {
        opId: operation.opId,
        type: 'reorder',
        nodeId: operation.nodeId,
        position: operation.position,
      }
    case 'remove':
      return { opId: operation.opId, type: 'remove', nodeId: operation.nodeId }
  }
}

const resolveRelativeIndex = (graph, parent, movingNodeId, position, path) => {
  const children = parent.children.filter(childId => childId !== movingNodeId)
  if (position === undefined || position.place === 'last') return children.length
  if (position.place === 'first') return 0
  if (position.siblingId === movingNodeId) {
    return fail('AMBIGUOUS_STRUCTURE', 'relative-position-cannot-anchor-to-the-moving-node', `${path}.siblingId`)
  }
  const sibling = requireNode(graph, position.siblingId, `${path}.siblingId`)
  if (sibling.parentId !== parent.id) {
    return fail('AMBIGUOUS_STRUCTURE', 'relative-position-sibling-is-not-in-the-target-parent', `${path}.siblingId`)
  }
  const siblingIndex = children.indexOf(sibling.id)
  if (siblingIndex < 0) {
    return fail('AMBIGUOUS_STRUCTURE', 'relative-position-sibling-is-not-in-the-target-order', `${path}.siblingId`)
  }
  return position.place === 'before' ? siblingIndex : siblingIndex + 1
}

const positionFromPlacement = placement => {
  if (placement.beforeId !== null) return { place: 'after', siblingId: placement.beforeId }
  if (placement.afterId !== null) return { place: 'before', siblingId: placement.afterId }
  return { place: 'last' }
}

const inverseOperationId = operation => `inverse:${operation.opId}`

const compileInsert = (context, operation, operationIndex) => {
  const path = `compileInput.changeSet.operations[${operationIndex}]`
  const parent = requireNode(context.graph, operation.parentId, `${path}.parentId`)
  requireUnlocked(parent, `${path}.parentId`)
  const nodeId = deriveInsertedScreenNodeId(context.callId, operation.opId)
  if (context.graph.nodes.has(nodeId)) {
    return fail('AMBIGUOUS_STRUCTURE', 'derived-insert-node-id-already-exists', `${path}.opId`)
  }
  if (!context.manifests.has(operation.componentName)) {
    return fail('UNKNOWN_MATERIAL', 'material-manifest-is-unavailable', `${path}.componentName`)
  }
  const at = resolveRelativeIndex(context.graph, parent, null, operation.position, `${path}.position`)
  const nodeSchema = { componentName: operation.componentName, id: nodeId, props: {} }
  const node = {
    componentName: operation.componentName,
    id: nodeId,
    locked: false,
    parentId: parent.id,
    schema: nodeSchema,
    children: [],
  }

  context.preImages.push(getNodeImage(node.id, operationIndex, false))
  context.preImages.push(getPlacement(context.graph, node.id, operationIndex, false))
  for (const [fieldId, value] of Object.entries(operation.fields)) {
    compileFieldMutation(context, { kind: 'set', fieldId, value }, operationIndex, node, { initial: true })
  }

  context.graph.nodes.set(node.id, node)
  parent.children.splice(at, 0, node.id)
  syncChildrenSchema(context.graph, parent)
  context.commands.push({
    type: 'insertNode',
    documentId: context.documentId,
    parentId: parent.id,
    at,
    node: node.schema,
  })
  context.expectedPostImages.push(getNodeImage(node.id, operationIndex, true, node.schema))
  context.expectedPostImages.push(getPlacement(context.graph, node.id, operationIndex))
  context.inverses.push({
    sourceOperationId: operation.opId,
    sourceOperationIndex: operationIndex,
    operation: { opId: inverseOperationId(operation), type: 'remove', nodeId: node.id },
  })
  context.insertedNodeIdentities.push({ opId: operation.opId, nodeId: node.id })
  claimNodeStructure(context, node.id)
  claimChildrenOrder(context, parent.id)
  claimAncestorSubtrees(context, parent.id, operationIndex)
}

const collectSubtreeIds = (graph, nodeId, result = []) => {
  const node = requireNode(graph, nodeId, 'subtree')
  result.push(node.id)
  node.children.forEach(childId => collectSubtreeIds(graph, childId, result))
  return result
}

const compileRemove = (context, operation, operationIndex) => {
  const path = `compileInput.changeSet.operations[${operationIndex}]`
  const node = requireNode(context.graph, operation.nodeId, `${path}.nodeId`)
  if (node.id === context.graph.rootId || node.parentId === null) {
    return fail('AMBIGUOUS_STRUCTURE', 'root-node-cannot-be-removed', `${path}.nodeId`)
  }
  requireUnlocked(node, `${path}.nodeId`)
  const parent = requireNode(context.graph, node.parentId, `${path}.nodeId`)
  requireUnlocked(parent, `${path}.nodeId`)
  const placement = getPlacement(context.graph, node.id, operationIndex)
  const subtree = node.schema
  const subtreeIds = collectSubtreeIds(context.graph, node.id)

  context.preImages.push(getNodeImage(node.id, operationIndex, true, subtree))
  context.preImages.push(placement)
  subtreeIds.forEach(id => claimNodeStructure(context, id))
  claimChildrenOrder(context, parent.id)
  claimAncestorSubtrees(context, parent.id, operationIndex)
  subtreeIds.forEach(id => {
    const child = context.graph.nodes.get(id)
    if (child.children.length > 0) claimChildrenOrder(context, id)
  })

  parent.children.splice(placement.index, 1)
  syncChildrenSchema(context.graph, parent)
  subtreeIds.forEach(id => context.graph.nodes.delete(id))
  context.commands.push({ type: 'removeNode', documentId: context.documentId, nodeId: node.id })
  context.expectedPostImages.push(getNodeImage(node.id, operationIndex, false))
  context.expectedPostImages.push(getPlacement(context.graph, node.id, operationIndex, false))
  context.inverses.push({
    sourceOperationId: operation.opId,
    sourceOperationIndex: operationIndex,
    anchors: { beforeId: placement.beforeId, afterId: placement.afterId },
    operation: {
      opId: inverseOperationId(operation),
      type: 'insert',
      parentId: placement.parentId,
      position: positionFromPlacement(placement),
      node: subtree,
    },
  })
}

const containsNode = (graph, ancestorId, possibleDescendantId) => {
  let cursor = graph.nodes.get(possibleDescendantId)
  const visited = new Set()
  while (cursor) {
    if (cursor.id === ancestorId) return true
    if (visited.has(cursor.id)) return true
    visited.add(cursor.id)
    cursor = cursor.parentId === null ? null : graph.nodes.get(cursor.parentId)
  }
  return false
}

const compileMove = (context, operation, operationIndex) => {
  const path = `compileInput.changeSet.operations[${operationIndex}]`
  const node = requireNode(context.graph, operation.nodeId, `${path}.nodeId`)
  if (node.id === context.graph.rootId || node.parentId === null) {
    return fail('AMBIGUOUS_STRUCTURE', 'root-node-cannot-be-moved', `${path}.nodeId`)
  }
  const targetParent =
    operation.kind === 'reorder'
      ? requireNode(context.graph, node.parentId, `${path}.nodeId`)
      : requireNode(context.graph, operation.parentId, `${path}.parentId`)
  requireUnlocked(node, `${path}.nodeId`)
  requireUnlocked(targetParent, `${path}.parentId`)
  if (containsNode(context.graph, node.id, targetParent.id)) {
    return fail('AMBIGUOUS_STRUCTURE', 'node-cannot-move-into-its-subtree', `${path}.parentId`)
  }
  const oldPlacement = getPlacement(context.graph, node.id, operationIndex)
  const oldParent = requireNode(context.graph, oldPlacement.parentId, `${path}.nodeId`)
  requireUnlocked(oldParent, `${path}.nodeId`)
  const requestedAt = resolveRelativeIndex(context.graph, targetParent, node.id, operation.position, `${path}.position`)

  claimNodeStructure(context, node.id)
  claimChildrenOrder(context, oldParent.id)
  claimChildrenOrder(context, targetParent.id)
  claimAncestorSubtrees(context, oldParent.id, operationIndex)
  claimAncestorSubtrees(context, targetParent.id, operationIndex)
  oldParent.children.splice(oldPlacement.index, 1)
  syncChildrenSchema(context.graph, oldParent)
  targetParent.children.splice(requestedAt, 0, node.id)
  node.parentId = targetParent.id
  syncChildrenSchema(context.graph, targetParent)
  const newPlacement = getPlacement(context.graph, node.id, operationIndex)

  context.preImages.push(oldPlacement)
  context.expectedPostImages.push(newPlacement)
  context.commands.push({
    type: 'moveNode',
    documentId: context.documentId,
    nodeId: node.id,
    parentId: targetParent.id,
    at: requestedAt,
  })
  context.inverses.push({
    sourceOperationId: operation.opId,
    sourceOperationIndex: operationIndex,
    anchors: { beforeId: oldPlacement.beforeId, afterId: oldPlacement.afterId },
    operation: {
      opId: inverseOperationId(operation),
      type: operation.kind,
      nodeId: node.id,
      ...(operation.kind === 'move' ? { parentId: oldPlacement.parentId } : {}),
      position: positionFromPlacement(oldPlacement),
    },
  })
}

const normalizeCompileInput = (input, limits) => {
  const value = cloneJsonValue(input, 'compileInput', limits)
  const inputBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (inputBytes > limits.maxInputBytes) {
    return fail('BUDGET_EXCEEDED', 'compile-input-is-too-large', 'compileInput')
  }
  assertExactRecord(
    value,
    [
      'branchId',
      'callId',
      'changeSet',
      'document',
      'expectedMutationVersion',
      'manifests',
      'materialRegistryVersion',
      'projectId',
      'schemaVersion',
    ],
    [],
    'compileInput',
  )
  requireSchemaVersion(value.schemaVersion, 'compileInput.schemaVersion')
  const projectId = requireNonEmptyString(value.projectId, 'compileInput.projectId')
  const branchId = requireNonEmptyString(value.branchId, 'compileInput.branchId')
  const callId = requireNonEmptyString(value.callId, 'compileInput.callId', {
    maxLength: Math.min(256, limits.maxStringLength),
  })
  const materialRegistryVersion = normalizeRegistryVersion(
    value.materialRegistryVersion,
    'compileInput.materialRegistryVersion',
  )
  const expectedMutationVersion = requireNonNegativeInteger(
    value.expectedMutationVersion,
    'compileInput.expectedMutationVersion',
  )
  assertExactRecord(value.document, ['id', 'mutationVersion', 'schema'], [], 'compileInput.document')
  const documentId = requireNonEmptyString(value.document.id, 'compileInput.document.id')
  const mutationVersion = requireNonNegativeInteger(
    value.document.mutationVersion,
    'compileInput.document.mutationVersion',
  )
  if (expectedMutationVersion !== mutationVersion) {
    return fail(
      'STALE_MUTATION_VERSION',
      'expected-mutation-version-does-not-match-captured-document',
      'compileInput.expectedMutationVersion',
    )
  }
  assertExactRecord(value.changeSet, ['documentId', 'operations', 'schemaVersion'], [], 'compileInput.changeSet')
  requireSchemaVersion(value.changeSet.schemaVersion, 'compileInput.changeSet.schemaVersion')
  if (value.changeSet.documentId !== documentId) {
    return fail(
      'INVALID_CHANGESET',
      'change-set-document-does-not-match-captured-document',
      'compileInput.changeSet.documentId',
    )
  }
  const rawOperations = requireArray(
    value.changeSet.operations,
    'compileInput.changeSet.operations',
    limits.maxOperations,
  )
  if (rawOperations.length === 0)
    return fail('INVALID_CHANGESET', 'change-set-must-have-an-operation', 'compileInput.changeSet.operations')
  const operations = rawOperations.map((operation, index) => normalizeOperation(operation, index, limits))
  const operationIds = new Set()
  operations.forEach((operation, index) => {
    if (operationIds.has(operation.opId)) {
      return fail(
        'INVALID_CHANGESET',
        'operation-ids-must-be-unique',
        `compileInput.changeSet.operations[${index}].opId`,
      )
    }
    operationIds.add(operation.opId)
  })
  const manifests = normalizeManifests(value.manifests, limits, materialRegistryVersion)
  return {
    branchId,
    callId,
    documentId,
    documentSchema: value.document.schema,
    expectedMutationVersion,
    manifestFingerprints: manifests.fingerprints,
    manifests: manifests.byComponent,
    materialRegistryVersion,
    operations,
    projectId,
  }
}

const finalizeOutput = context => {
  const operations = context.operations.map(publicOperation)
  const commands = context.commands
  const preImages = context.preImages
  const expectedPostImages = context.expectedPostImages
  const inverseOperations = [...context.inverses].reverse()
  const affectedFieldSlots = [...context.fieldSlots.values()].sort((left, right) =>
    compareCodeUnits(left.slotKey, right.slotKey),
  )
  const affectedStructuralSlots = [...context.structuralSlots.values()].sort((left, right) =>
    compareCodeUnits(left.slotKey, right.slotKey),
  )
  const affectedSlotKeys = [...context.affectedSlotKeys].sort(compareCodeUnits)
  const transactionFingerprint = {
    schemaVersion: SCREEN_CHANGESET_SCHEMA_VERSION,
    callId: context.callId,
    documentId: context.documentId,
    baseMutationVersion: context.baseMutationVersion,
    materialRegistryVersion: context.materialRegistryVersion,
    manifestFingerprints: context.manifestFingerprints,
    insertedNodeIdentities: context.insertedNodeIdentities,
    commands,
  }
  const preparedHash = {
    schemaVersion: SCREEN_CHANGESET_SCHEMA_VERSION,
    projectId: context.projectId,
    branchId: context.branchId,
    callId: context.callId,
    documentId: context.documentId,
    baseMutationVersion: context.baseMutationVersion,
    materialRegistryVersion: context.materialRegistryVersion,
    manifestFingerprints: context.manifestFingerprints,
    insertedNodeIdentities: context.insertedNodeIdentities,
    operations,
    transactionFingerprint,
    preImages,
    expectedPostImages,
    inverseOperations,
    affectedFieldSlots,
    affectedStructuralSlots,
    affectedSlotKeys,
  }
  const output = cloneJsonValue(
    {
      schemaVersion: SCREEN_CHANGESET_SCHEMA_VERSION,
      projectId: context.projectId,
      branchId: context.branchId,
      callId: context.callId,
      documentId: context.documentId,
      baseMutationVersion: context.baseMutationVersion,
      materialRegistryVersion: context.materialRegistryVersion,
      manifestFingerprints: context.manifestFingerprints,
      insertedNodeIdentities: context.insertedNodeIdentities,
      operations,
      commands,
      preImages,
      expectedPostImages,
      inverseOperations,
      affectedFieldSlots,
      affectedStructuralSlots,
      affectedSlotKeys,
      fingerprintInputs: { preparedHash, transactionFingerprint },
    },
    'compiledChangeSet',
    context.limits,
  )
  const outputBytes = new TextEncoder().encode(JSON.stringify(output)).byteLength
  if (outputBytes > context.limits.maxOutputBytes) {
    return fail('BUDGET_EXCEEDED', 'compiled-change-set-output-is-too-large', 'compiledChangeSet')
  }
  return freezeDto(output)
}

export const compileScreenChangeSet = (input, options) => {
  const limits = normalizeLimits(options)
  try {
    const normalized = normalizeCompileInput(input, limits)
    const context = {
      affectedSlotKeys: new Set(),
      baseMutationVersion: normalized.expectedMutationVersion,
      branchId: normalized.branchId,
      callId: normalized.callId,
      commands: [],
      documentId: normalized.documentId,
      expectedPostImages: [],
      fieldClaims: [],
      fieldSlots: new Map(),
      graph: buildDocumentGraph(normalized.documentSchema, limits),
      inverses: [],
      insertedNodeIdentities: [],
      limits,
      manifests: normalized.manifests,
      manifestFingerprints: normalized.manifestFingerprints,
      materialRegistryVersion: normalized.materialRegistryVersion,
      operations: normalized.operations,
      preImages: [],
      projectId: normalized.projectId,
      structuralSlots: new Map(),
    }

    normalized.operations.forEach((operation, operationIndex) => {
      switch (operation.kind) {
        case 'set':
        case 'unset':
        case 'resize': {
          const node = requireNode(
            context.graph,
            operation.nodeId,
            `compileInput.changeSet.operations[${operationIndex}].nodeId`,
          )
          requireUnlocked(node, `compileInput.changeSet.operations[${operationIndex}].nodeId`)
          compileFieldMutation(context, operation, operationIndex, node)
          break
        }
        case 'insert':
          compileInsert(context, operation, operationIndex)
          break
        case 'move':
        case 'reorder':
          compileMove(context, operation, operationIndex)
          break
        case 'remove':
          compileRemove(context, operation, operationIndex)
          break
      }
    })
    return finalizeOutput(context)
  } catch (error) {
    if (error instanceof ScreenChangeSetCompileError) throw error
    throw new ScreenChangeSetCompileError('INVALID_CHANGESET', 'compiler-rejected-unsafe-or-ambiguous-input')
  }
}

export {
  SCREEN_APPLY_CHANGESET_FAILURE_CODE,
  ScreenApplyChangeSetError,
  createScreenApplyChangeSetHandler,
} from './apply.mjs'
export { createDashboardScreenApplyChangeSetHandler } from './runtime-adapter.mjs'
export * from './receipt-intent.mjs'
