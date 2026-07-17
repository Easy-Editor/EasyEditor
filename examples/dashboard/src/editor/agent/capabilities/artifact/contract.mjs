import { readCanonicalNodeArtifactRef, validateArtifactRef } from '../../online-components/artifact-contracts.mjs'
import {
  assertExactRecord,
  cloneJsonObject,
  cloneJsonValue,
  compareCodeUnits,
  failContract,
  freezeDto,
  jsonDataEqual,
  optionalOwnDataValue,
  ownDataValue,
  requireLiteral,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireSchemaVersion,
} from '../../persistence/contract.mjs'

export const ONLINE_ARTIFACT_CAPABILITIES = Object.freeze(['artifact.createOnline', 'artifact.reviseOnline'])
export const isDashboardOnlineArtifactCapability = capability => ONLINE_ARTIFACT_CAPABILITIES.includes(capability)
export const GENERATED_MATERIAL_HOST_COMPONENT_NAME = 'GeneratedMaterialHost'

const CALL_FIELDS = Object.freeze([
  'arguments',
  'branchId',
  'callId',
  'capability',
  'expectedRevision',
  'projectId',
  'schemaVersion',
  'sessionId',
  'stepId',
  'taskId',
])
const AUTHORITY_FIELDS = Object.freeze(['branchId', 'projectId', 'sessionId', 'taskId'])

const requireBoundedString = (value, path, maximum) => {
  const result = requireNonEmptyString(value, path)
  if (new TextEncoder().encode(result).byteLength > maximum) return failContract('exceeds-byte-budget', path)
  return result
}

const normalizeAuthority = value => {
  assertExactRecord(value, AUTHORITY_FIELDS, [], 'OnlineArtifact.authority')
  return freezeDto(
    Object.fromEntries(
      AUTHORITY_FIELDS.map(field => [
        field,
        requireBoundedString(
          ownDataValue(value, field, 'OnlineArtifact.authority'),
          `OnlineArtifact.authority.${field}`,
          256,
        ),
      ]),
    ),
  )
}

const normalizePosition = value => {
  assertExactRecord(value, ['place'], ['siblingId'], 'OnlineArtifact.position')
  const place = requireLiteral(
    ownDataValue(value, 'place', 'OnlineArtifact.position'),
    ['first', 'last', 'before', 'after'],
    'OnlineArtifact.position.place',
  )
  const siblingId = optionalOwnDataValue(value, 'siblingId', 'OnlineArtifact.position')
  if (place === 'before' || place === 'after') {
    return freezeDto({
      place,
      siblingId: requireBoundedString(siblingId, 'OnlineArtifact.position.siblingId', 256),
    })
  }
  if (siblingId !== undefined) return failContract('siblingId-is-forbidden', 'OnlineArtifact.position')
  return freezeDto({ place })
}

const normalizeRect = value => {
  assertExactRecord(value, ['x', 'y', 'width', 'height'], [], 'OnlineArtifact.rect')
  const result = {}
  for (const field of ['x', 'y', 'width', 'height']) {
    const entry = ownDataValue(value, field, 'OnlineArtifact.rect')
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      return failContract('must-be-a-finite-number', `OnlineArtifact.rect.${field}`)
    }
    if ((field === 'width' || field === 'height') && entry < 0) {
      return failContract('must-be-non-negative', `OnlineArtifact.rect.${field}`)
    }
    result[field] = entry
  }
  return freezeDto(result)
}

const normalizeDependencyRequests = value => {
  if (!Array.isArray(value)) return failContract('must-be-an-array', 'OnlineArtifact.dependencies')
  const requests = cloneJsonValue(value, 'OnlineArtifact.dependencies').map((entry, index) => {
    const label = `OnlineArtifact.dependencies[${index}]`
    assertExactRecord(entry, ['package', 'range'], [], label)
    return {
      package: requireBoundedString(ownDataValue(entry, 'package', label), `${label}.package`, 256),
      range: requireBoundedString(ownDataValue(entry, 'range', label), `${label}.range`, 128),
    }
  })
  if (requests.length > 64) return failContract('exceeds-count-budget', 'OnlineArtifact.dependencies')
  requests.sort((left, right) => compareCodeUnits(left.package, right.package))
  if (requests.some((request, index) => index > 0 && request.package === requests[index - 1].package)) {
    return failContract('duplicate-package', 'OnlineArtifact.dependencies')
  }
  return freezeDto(requests)
}

const normalizeSourceFields = (value, required, optional, label) => {
  assertExactRecord(value, required, optional, label)
  requireSchemaVersion(ownDataValue(value, 'schemaVersion', label), `${label}.schemaVersion`)
  const source = requireBoundedString(ownDataValue(value, 'source', label), `${label}.source`, 256 * 1024)
  const cssValue = ownDataValue(value, 'css', label)
  if (typeof cssValue !== 'string') return failContract('must-be-a-string', `${label}.css`)
  if (new TextEncoder().encode(cssValue).byteLength > 128 * 1024) {
    return failContract('exceeds-byte-budget', `${label}.css`)
  }
  const safeManifest = cloneJsonObject(ownDataValue(value, 'safeManifest', label), `${label}.safeManifest`)
  if (safeManifest.schemaVersion !== 1) return failContract('unsupported-schema-version', `${label}.safeManifest`)
  return {
    schemaVersion: 1,
    source,
    css: cssValue,
    safeManifest,
    dependencies: normalizeDependencyRequests(ownDataValue(value, 'dependencies', label)),
  }
}

const normalizeCreateArguments = value => {
  const base = normalizeSourceFields(
    value,
    ['schemaVersion', 'documentId', 'parentId', 'position', 'source', 'css', 'safeManifest', 'dependencies'],
    ['props', 'rect'],
    'OnlineArtifact.create.arguments',
  )
  const props = optionalOwnDataValue(value, 'props', 'OnlineArtifact.create.arguments')
  const rect = optionalOwnDataValue(value, 'rect', 'OnlineArtifact.create.arguments')
  return freezeDto({
    ...base,
    documentId: requireBoundedString(
      ownDataValue(value, 'documentId', 'OnlineArtifact.create.arguments'),
      'OnlineArtifact.create.arguments.documentId',
      256,
    ),
    parentId: requireBoundedString(
      ownDataValue(value, 'parentId', 'OnlineArtifact.create.arguments'),
      'OnlineArtifact.create.arguments.parentId',
      256,
    ),
    position: normalizePosition(ownDataValue(value, 'position', 'OnlineArtifact.create.arguments')),
    ...(props === undefined
      ? {}
      : { props: freezeDto(cloneJsonObject(props, 'OnlineArtifact.create.arguments.props')) }),
    ...(rect === undefined ? {} : { rect: normalizeRect(rect) }),
  })
}

const normalizeReviseArguments = value => {
  const base = normalizeSourceFields(
    value,
    ['schemaVersion', 'nodeId', 'source', 'css', 'safeManifest', 'dependencies'],
    [],
    'OnlineArtifact.revise.arguments',
  )
  return freezeDto({
    ...base,
    nodeId: requireBoundedString(
      ownDataValue(value, 'nodeId', 'OnlineArtifact.revise.arguments'),
      'OnlineArtifact.revise.arguments.nodeId',
      256,
    ),
  })
}

export const normalizeOnlineArtifactCall = (value, boundAuthority, expectedCapability) => {
  const authority = normalizeAuthority(boundAuthority)
  assertExactRecord(value, CALL_FIELDS, [], 'OnlineArtifact.call')
  requireSchemaVersion(ownDataValue(value, 'schemaVersion', 'OnlineArtifact.call'), 'OnlineArtifact.call.schemaVersion')
  const capability = requireLiteral(
    ownDataValue(value, 'capability', 'OnlineArtifact.call'),
    ONLINE_ARTIFACT_CAPABILITIES,
    'OnlineArtifact.call.capability',
  )
  if (capability !== expectedCapability) return failContract('capability-does-not-match-handler', 'OnlineArtifact.call')
  const normalized = {
    schemaVersion: 1,
    projectId: requireBoundedString(
      ownDataValue(value, 'projectId', 'OnlineArtifact.call'),
      'OnlineArtifact.call.projectId',
      256,
    ),
    branchId: requireBoundedString(
      ownDataValue(value, 'branchId', 'OnlineArtifact.call'),
      'OnlineArtifact.call.branchId',
      256,
    ),
    sessionId: requireBoundedString(
      ownDataValue(value, 'sessionId', 'OnlineArtifact.call'),
      'OnlineArtifact.call.sessionId',
      256,
    ),
    taskId: requireBoundedString(
      ownDataValue(value, 'taskId', 'OnlineArtifact.call'),
      'OnlineArtifact.call.taskId',
      256,
    ),
    stepId: requireBoundedString(
      ownDataValue(value, 'stepId', 'OnlineArtifact.call'),
      'OnlineArtifact.call.stepId',
      256,
    ),
    callId: requireBoundedString(
      ownDataValue(value, 'callId', 'OnlineArtifact.call'),
      'OnlineArtifact.call.callId',
      256,
    ),
    capability,
    expectedRevision: requireBoundedString(
      ownDataValue(value, 'expectedRevision', 'OnlineArtifact.call'),
      'OnlineArtifact.call.expectedRevision',
      512,
    ),
    arguments:
      capability === 'artifact.createOnline'
        ? normalizeCreateArguments(ownDataValue(value, 'arguments', 'OnlineArtifact.call'))
        : normalizeReviseArguments(ownDataValue(value, 'arguments', 'OnlineArtifact.call')),
  }
  for (const field of AUTHORITY_FIELDS) {
    if (normalized[field] !== authority[field])
      return failContract('authority-mismatch', `OnlineArtifact.call.${field}`)
  }
  return freezeDto(normalized)
}

export const normalizeOnlineArtifactPrepareResult = (value, expected) => {
  assertExactRecord(
    value,
    ['schemaVersion', 'baseRevision', 'documentId', 'nodeId', 'baseMutationVersion', 'previousArtifactRef'],
    [],
    'OnlineArtifact.prepareResult',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'OnlineArtifact.prepareResult'),
    'OnlineArtifact.prepareResult.schemaVersion',
  )
  const result = {
    schemaVersion: 1,
    baseRevision: requireNonEmptyString(
      ownDataValue(value, 'baseRevision', 'OnlineArtifact.prepareResult'),
      'OnlineArtifact.prepareResult.baseRevision',
    ),
    documentId: requireNonEmptyString(
      ownDataValue(value, 'documentId', 'OnlineArtifact.prepareResult'),
      'OnlineArtifact.prepareResult.documentId',
    ),
    nodeId: requireNonEmptyString(
      ownDataValue(value, 'nodeId', 'OnlineArtifact.prepareResult'),
      'OnlineArtifact.prepareResult.nodeId',
    ),
    baseMutationVersion: requireNonNegativeInteger(
      ownDataValue(value, 'baseMutationVersion', 'OnlineArtifact.prepareResult'),
      'OnlineArtifact.prepareResult.baseMutationVersion',
    ),
    previousArtifactRef:
      ownDataValue(value, 'previousArtifactRef', 'OnlineArtifact.prepareResult') === null
        ? null
        : validateArtifactRef(ownDataValue(value, 'previousArtifactRef', 'OnlineArtifact.prepareResult')),
  }
  if (result.baseRevision !== expected.expectedRevision)
    return failContract('stale-revision', 'OnlineArtifact.prepareResult')
  if (result.nodeId !== expected.nodeId) return failContract('node-identity-mismatch', 'OnlineArtifact.prepareResult')
  if (expected.documentId !== undefined && result.documentId !== expected.documentId) {
    return failContract('document-identity-mismatch', 'OnlineArtifact.prepareResult')
  }
  if (expected.capability === 'artifact.createOnline' && result.previousArtifactRef !== null) {
    return failContract('create-must-not-have-a-previous-artifact-ref', 'OnlineArtifact.prepareResult')
  }
  if (expected.capability === 'artifact.reviseOnline') {
    if (result.previousArtifactRef?.target?.kind !== 'online') {
      return failContract('revise-requires-an-online-artifact-ref', 'OnlineArtifact.prepareResult')
    }
  }
  return freezeDto(result)
}

const normalizeActiveDocument = value => {
  if (value === null) return null
  assertExactRecord(value, ['documentId', 'fileName', 'index'], [], 'OnlineArtifact.activeDocument')
  return freezeDto({
    documentId: requireNonEmptyString(
      ownDataValue(value, 'documentId', 'OnlineArtifact.activeDocument'),
      'OnlineArtifact.activeDocument.documentId',
    ),
    fileName: requireNonEmptyString(
      ownDataValue(value, 'fileName', 'OnlineArtifact.activeDocument'),
      'OnlineArtifact.activeDocument.fileName',
    ),
    index: requireNonNegativeInteger(
      ownDataValue(value, 'index', 'OnlineArtifact.activeDocument'),
      'OnlineArtifact.activeDocument.index',
    ),
  })
}

const normalizeAffectedSlotKeys = value => {
  if (!Array.isArray(value)) return failContract('must-be-an-array', 'OnlineArtifact.coreResult.affectedSlotKeys')
  const keys = cloneJsonValue(value, 'OnlineArtifact.coreResult.affectedSlotKeys').map((entry, index) =>
    requireNonEmptyString(entry, `OnlineArtifact.coreResult.affectedSlotKeys[${index}]`),
  )
  keys.sort(compareCodeUnits)
  if (keys.length === 0) return failContract('must-be-non-empty', 'OnlineArtifact.coreResult.affectedSlotKeys')
  if (keys.some((entry, index) => index > 0 && entry === keys[index - 1])) {
    return failContract('must-not-contain-duplicates', 'OnlineArtifact.coreResult.affectedSlotKeys')
  }
  return freezeDto(keys)
}

const findCanonicalGeneratedNode = (projectSchema, nodeId) => {
  const roots = projectSchema.componentsTree
  if (!Array.isArray(roots)) {
    return failContract('componentsTree-must-be-an-array', 'OnlineArtifact.coreResult.projectSchema')
  }
  const matches = []
  const stack = [...roots]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return failContract('node-must-be-an-object', 'OnlineArtifact.coreResult.projectSchema')
    }
    if (node.id === nodeId) matches.push(node)
    if (Object.hasOwn(node, 'children')) {
      if (!Array.isArray(node.children)) {
        return failContract('node-children-must-be-an-array', 'OnlineArtifact.coreResult.projectSchema')
      }
      stack.push(...node.children)
    }
  }
  if (matches.length !== 1) {
    return failContract('generated-node-must-exist-exactly-once', 'OnlineArtifact.coreResult.projectSchema')
  }
  return matches[0]
}

export const normalizeOnlineArtifactCoreResult = (value, expected) => {
  assertExactRecord(
    value,
    [
      'schemaVersion',
      'revision',
      'documentId',
      'nodeId',
      'componentName',
      'coreMutationVersion',
      'activeDocument',
      'projectSchema',
      'affectedSlotKeys',
    ],
    [],
    'OnlineArtifact.coreResult',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'OnlineArtifact.coreResult'),
    'OnlineArtifact.coreResult.schemaVersion',
  )
  const result = {
    schemaVersion: 1,
    revision: requireNonEmptyString(
      ownDataValue(value, 'revision', 'OnlineArtifact.coreResult'),
      'OnlineArtifact.coreResult.revision',
    ),
    documentId: requireNonEmptyString(
      ownDataValue(value, 'documentId', 'OnlineArtifact.coreResult'),
      'OnlineArtifact.coreResult.documentId',
    ),
    nodeId: requireNonEmptyString(
      ownDataValue(value, 'nodeId', 'OnlineArtifact.coreResult'),
      'OnlineArtifact.coreResult.nodeId',
    ),
    componentName: requireLiteral(
      ownDataValue(value, 'componentName', 'OnlineArtifact.coreResult'),
      [GENERATED_MATERIAL_HOST_COMPONENT_NAME],
      'OnlineArtifact.coreResult.componentName',
    ),
    coreMutationVersion: requireNonNegativeInteger(
      ownDataValue(value, 'coreMutationVersion', 'OnlineArtifact.coreResult'),
      'OnlineArtifact.coreResult.coreMutationVersion',
    ),
    activeDocument: normalizeActiveDocument(ownDataValue(value, 'activeDocument', 'OnlineArtifact.coreResult')),
    projectSchema: cloneJsonObject(
      ownDataValue(value, 'projectSchema', 'OnlineArtifact.coreResult'),
      'OnlineArtifact.coreResult.projectSchema',
    ),
    affectedSlotKeys: normalizeAffectedSlotKeys(ownDataValue(value, 'affectedSlotKeys', 'OnlineArtifact.coreResult')),
  }
  if (result.nodeId !== expected.nodeId || result.documentId !== expected.documentId) {
    return failContract('identity-mismatch', 'OnlineArtifact.coreResult')
  }
  if (result.revision === expected.baseRevision) {
    return failContract('revision-must-advance', 'OnlineArtifact.coreResult.revision')
  }
  if (result.coreMutationVersion <= expected.baseMutationVersion) {
    return failContract('mutation-version-must-advance', 'OnlineArtifact.coreResult.coreMutationVersion')
  }
  const node = findCanonicalGeneratedNode(result.projectSchema, expected.nodeId)
  if (node.componentName !== GENERATED_MATERIAL_HOST_COMPONENT_NAME) {
    return failContract('generated-node-component-mismatch', 'OnlineArtifact.coreResult.projectSchema')
  }
  if (!Object.hasOwn(node, '$agent')) {
    return failContract('generated-node-canonical-agent-extra-is-required', 'OnlineArtifact.coreResult.projectSchema')
  }
  if (
    Object.hasOwn(node, 'artifactRef') ||
    (node.extra && typeof node.extra === 'object' && Object.hasOwn(node.extra, 'artifactRef'))
  ) {
    return failContract('generated-node-legacy-artifact-ref-is-forbidden', 'OnlineArtifact.coreResult.projectSchema')
  }
  const actualArtifactRef = readCanonicalNodeArtifactRef(node)
  if (!jsonDataEqual(actualArtifactRef, expected.artifactRef)) {
    return failContract('generated-node-artifact-ref-mismatch', 'OnlineArtifact.coreResult.projectSchema')
  }
  return freezeDto(result)
}

export const normalizeOnlineArtifactProjectCapture = value => {
  assertExactRecord(
    value,
    ['schemaVersion', 'revision', 'documentId', 'coreMutationVersion', 'activeDocument', 'projectSchema'],
    [],
    'OnlineArtifact.projectCapture',
  )
  requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'OnlineArtifact.projectCapture'),
    'OnlineArtifact.projectCapture.schemaVersion',
  )
  return freezeDto({
    schemaVersion: 1,
    revision: requireNonEmptyString(
      ownDataValue(value, 'revision', 'OnlineArtifact.projectCapture'),
      'OnlineArtifact.projectCapture.revision',
    ),
    documentId: requireNonEmptyString(
      ownDataValue(value, 'documentId', 'OnlineArtifact.projectCapture'),
      'OnlineArtifact.projectCapture.documentId',
    ),
    coreMutationVersion: requireNonNegativeInteger(
      ownDataValue(value, 'coreMutationVersion', 'OnlineArtifact.projectCapture'),
      'OnlineArtifact.projectCapture.coreMutationVersion',
    ),
    activeDocument: normalizeActiveDocument(ownDataValue(value, 'activeDocument', 'OnlineArtifact.projectCapture')),
    projectSchema: cloneJsonObject(
      ownDataValue(value, 'projectSchema', 'OnlineArtifact.projectCapture'),
      'OnlineArtifact.projectCapture.projectSchema',
    ),
  })
}
