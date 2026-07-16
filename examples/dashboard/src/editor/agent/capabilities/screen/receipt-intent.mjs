import { PersistenceLineageContractError, parseReceiptIntent } from '../../persistence/receipt-ledger.mjs'
import {
  DEFAULT_SCREEN_CHANGESET_LIMITS,
  ScreenChangeSetCompileError,
  assertExactRecord,
  cloneJsonValue,
  compareCodeUnits,
  freezeDto,
  jsonEqual,
  optionalOwnDataValue,
  ownDataValue,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireSchemaVersion,
} from './contract.mjs'

const CAPABILITY = 'screen.applyChangeSet'
const PRE_KIND = 'screen-change-set-pre-images'
const POST_KIND = 'screen-change-set-post-images'
const PREPARED_KIND = 'screen-apply-change-set-prepared'
const TRANSACTION_KIND = 'screen-apply-change-set-transaction'
const clone = (value, path) => cloneJsonValue(value, path, DEFAULT_SCREEN_CHANGESET_LIMITS)

const fail = (reason, path = 'ScreenReceiptIntent') => {
  throw new ScreenChangeSetCompileError('INVALID_CHANGESET', reason, path)
}

const literal = (value, expected, path) => (value === expected ? value : fail(`must-equal-${expected}`, path))
const boolean = (value, path) => (typeof value === 'boolean' ? value : fail('must-be-a-boolean', path))
const nullableString = (value, path) =>
  value === null
    ? null
    : requireNonEmptyString(value, path, { maxLength: DEFAULT_SCREEN_CHANGESET_LIMITS.maxStringLength })
const array = (value, path, maximum = DEFAULT_SCREEN_CHANGESET_LIMITS.maxArrayLength) => {
  if (!Array.isArray(value) || value.length > maximum) return fail('must-be-a-bounded-dense-array', path)
  return value
}
const stringArray = (value, path) =>
  array(value, path).map((entry, index) =>
    requireNonEmptyString(entry, `${path}[${index}]`, { maxLength: DEFAULT_SCREEN_CHANGESET_LIMITS.maxStringLength }),
  )
const assertStrictOrder = (value, select, path) => {
  for (let index = 1; index < value.length; index += 1) {
    if (compareCodeUnits(select(value[index - 1]), select(value[index])) >= 0) {
      return fail('must-already-be-in-unique-canonical-order', path)
    }
  }
  return value
}

const parsePosition = (value, path) => {
  assertExactRecord(value, ['place'], ['siblingId'], path)
  const place = ownDataValue(value, 'place', path)
  if (!['first', 'last', 'before', 'after'].includes(place)) return fail('invalid-relative-position', `${path}.place`)
  const siblingId = optionalOwnDataValue(value, 'siblingId', path)
  if ((place === 'before' || place === 'after') !== (siblingId !== undefined)) {
    return fail('siblingId-must-match-relative-position', path)
  }
  return freezeDto({
    place,
    ...(siblingId === undefined ? {} : { siblingId: requireNonEmptyString(siblingId, `${path}.siblingId`) }),
  })
}

const parseOperation = (value, path, { inverse = false } = {}) => {
  assertExactRecord(
    value,
    ['opId', 'type'],
    ['nodeId', 'parentId', 'componentName', 'position', 'fields', 'fieldId', 'value', 'rect', 'node'],
    path,
  )
  const opId = requireNonEmptyString(ownDataValue(value, 'opId', path), `${path}.opId`)
  const type = ownDataValue(value, 'type', path)
  const common = { opId, type }
  const exact = (required, optional = []) => assertExactRecord(value, ['opId', 'type', ...required], optional, path)
  switch (type) {
    case 'set':
      exact(['nodeId', 'fieldId', 'value'])
      return freezeDto({
        ...common,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        fieldId: requireNonEmptyString(value.fieldId, `${path}.fieldId`),
        value: clone(value.value, `${path}.value`),
      })
    case 'unset':
      exact(['nodeId', 'fieldId'])
      return freezeDto({
        ...common,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        fieldId: requireNonEmptyString(value.fieldId, `${path}.fieldId`),
      })
    case 'resize':
      exact(['nodeId', 'rect'])
      assertExactRecord(value.rect, ['x', 'y', 'width', 'height'], [], `${path}.rect`)
      for (const key of ['x', 'y', 'width', 'height'])
        if (!Number.isFinite(value.rect[key])) fail('must-be-finite', `${path}.rect.${key}`)
      return freezeDto({
        ...common,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        rect: clone(value.rect, `${path}.rect`),
      })
    case 'insert': {
      if (inverse && Object.hasOwn(value, 'node')) {
        exact(['parentId', 'position', 'node'])
        return freezeDto({
          ...common,
          parentId: requireNonEmptyString(value.parentId, `${path}.parentId`),
          position: parsePosition(value.position, `${path}.position`),
          node: clone(value.node, `${path}.node`),
        })
      }
      exact(['parentId', 'componentName'], ['position', 'fields'])
      const position = optionalOwnDataValue(value, 'position', path)
      const fields = optionalOwnDataValue(value, 'fields', path)
      return freezeDto({
        ...common,
        parentId: requireNonEmptyString(value.parentId, `${path}.parentId`),
        componentName: requireNonEmptyString(value.componentName, `${path}.componentName`),
        ...(position === undefined ? {} : { position: parsePosition(position, `${path}.position`) }),
        ...(fields === undefined ? {} : { fields: clone(fields, `${path}.fields`) }),
      })
    }
    case 'move':
      exact(['nodeId', 'parentId'], ['position'])
      return freezeDto({
        ...common,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        parentId: requireNonEmptyString(value.parentId, `${path}.parentId`),
        ...(value.position === undefined ? {} : { position: parsePosition(value.position, `${path}.position`) }),
      })
    case 'reorder':
      exact(['nodeId', 'position'])
      return freezeDto({
        ...common,
        nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
        position: parsePosition(value.position, `${path}.position`),
      })
    case 'remove':
      exact(['nodeId'])
      return freezeDto({ ...common, nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`) })
    default:
      return fail('unsupported-operation-type', `${path}.type`)
  }
}

const parseCommand = (value, path) => {
  assertExactRecord(
    value,
    ['type', 'documentId'],
    ['nodeId', 'parentId', 'at', 'node', 'props', 'extras', 'unsetPropPaths', 'unsetExtraPaths'],
    path,
  )
  const type = ownDataValue(value, 'type', path)
  const documentId = requireNonEmptyString(value.documentId, `${path}.documentId`)
  if (type === 'insertNode') {
    assertExactRecord(value, ['type', 'documentId', 'parentId', 'at', 'node'], [], path)
    return freezeDto({
      type,
      documentId,
      parentId: requireNonEmptyString(value.parentId, `${path}.parentId`),
      at: requireNonNegativeInteger(value.at, `${path}.at`),
      node: clone(value.node, `${path}.node`),
    })
  }
  if (type === 'removeNode') {
    assertExactRecord(value, ['type', 'documentId', 'nodeId'], [], path)
    return freezeDto({ type, documentId, nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`) })
  }
  if (type === 'moveNode') {
    assertExactRecord(value, ['type', 'documentId', 'nodeId', 'parentId', 'at'], [], path)
    return freezeDto({
      type,
      documentId,
      nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
      parentId: requireNonEmptyString(value.parentId, `${path}.parentId`),
      at: requireNonNegativeInteger(value.at, `${path}.at`),
    })
  }
  if (type === 'updateProps') {
    assertExactRecord(
      value,
      ['type', 'documentId', 'nodeId'],
      ['props', 'extras', 'unsetPropPaths', 'unsetExtraPaths'],
      path,
    )
    const output = { type, documentId, nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`) }
    for (const key of ['props', 'extras'])
      if (value[key] !== undefined) output[key] = clone(value[key], `${path}.${key}`)
    for (const key of ['unsetPropPaths', 'unsetExtraPaths'])
      if (value[key] !== undefined) output[key] = stringArray(value[key], `${path}.${key}`)
    if (Object.keys(output).length === 3) return fail('update-command-must-have-a-mutation', path)
    return freezeDto(output)
  }
  return fail('unsupported-command-type', `${path}.type`)
}

const parseImage = (value, path, operationCount) => {
  assertExactRecord(
    value,
    ['operationIndex', 'kind', 'nodeId', 'existed'],
    ['fieldId', 'root', 'path', 'value', 'node', 'parentId', 'index', 'beforeId', 'afterId'],
    path,
  )
  const operationIndex = requireNonNegativeInteger(value.operationIndex, `${path}.operationIndex`)
  if (operationIndex >= operationCount) return fail('operation-index-is-out-of-range', `${path}.operationIndex`)
  const nodeId = requireNonEmptyString(value.nodeId, `${path}.nodeId`)
  const existed = boolean(value.existed, `${path}.existed`)
  if (value.kind === 'field') {
    assertExactRecord(
      value,
      ['operationIndex', 'kind', 'nodeId', 'fieldId', 'root', 'path', 'existed', 'value'],
      [],
      path,
    )
    if (!['props', 'extras'].includes(value.root)) fail('invalid-field-root', `${path}.root`)
    return freezeDto({
      operationIndex,
      kind: value.kind,
      nodeId,
      fieldId: requireNonEmptyString(value.fieldId, `${path}.fieldId`),
      root: value.root,
      path: stringArray(value.path, `${path}.path`),
      existed,
      value: clone(value.value, `${path}.value`),
    })
  }
  if (value.kind === 'node') {
    assertExactRecord(value, ['operationIndex', 'kind', 'nodeId', 'existed', 'node'], [], path)
    if (value.node !== null && (typeof value.node !== 'object' || Array.isArray(value.node)))
      fail('node-must-be-an-object-or-null', `${path}.node`)
    return freezeDto({ operationIndex, kind: value.kind, nodeId, existed, node: clone(value.node, `${path}.node`) })
  }
  if (value.kind === 'placement') {
    assertExactRecord(
      value,
      ['operationIndex', 'kind', 'nodeId', 'existed', 'parentId', 'index', 'beforeId', 'afterId'],
      [],
      path,
    )
    const index = value.index === null ? null : requireNonNegativeInteger(value.index, `${path}.index`)
    return freezeDto({
      operationIndex,
      kind: value.kind,
      nodeId,
      existed,
      parentId: nullableString(value.parentId, `${path}.parentId`),
      index,
      beforeId: nullableString(value.beforeId, `${path}.beforeId`),
      afterId: nullableString(value.afterId, `${path}.afterId`),
    })
  }
  return fail('unsupported-image-kind', `${path}.kind`)
}

const parseFieldSlot = (value, path) => {
  assertExactRecord(value, ['nodeId', 'fieldId', 'root', 'path', 'slotKey', 'aliases'], [], path)
  if (!['props', 'extras'].includes(value.root)) fail('invalid-field-root', `${path}.root`)
  const aliases = assertStrictOrder(stringArray(value.aliases, `${path}.aliases`), entry => entry, `${path}.aliases`)
  const slotKey = requireNonEmptyString(value.slotKey, `${path}.slotKey`)
  if (!aliases.includes(slotKey)) fail('aliases-must-contain-slotKey', `${path}.aliases`)
  return freezeDto({
    nodeId: requireNonEmptyString(value.nodeId, `${path}.nodeId`),
    fieldId: requireNonEmptyString(value.fieldId, `${path}.fieldId`),
    root: value.root,
    path: stringArray(value.path, `${path}.path`),
    slotKey,
    aliases,
  })
}

const parseStructuralSlot = (value, path) => {
  assertExactRecord(value, ['kind', 'slotKey'], ['nodeId', 'parentId'], path)
  if (!['children-order', 'node-existence', 'node-parent', 'node-subtree'].includes(value.kind))
    fail('invalid-structural-slot-kind', `${path}.kind`)
  const nodeId = optionalOwnDataValue(value, 'nodeId', path)
  const parentId = optionalOwnDataValue(value, 'parentId', path)
  return freezeDto({
    kind: value.kind,
    ...(nodeId === undefined ? {} : { nodeId: requireNonEmptyString(nodeId, `${path}.nodeId`) }),
    ...(parentId === undefined ? {} : { parentId: requireNonEmptyString(parentId, `${path}.parentId`) }),
    slotKey: requireNonEmptyString(value.slotKey, `${path}.slotKey`),
  })
}

const parseManifest = (value, path) => {
  assertExactRecord(
    value,
    ['componentName', 'materialRegistryVersion', 'readiness', 'semanticDescriptor', 'semanticDigest'],
    [],
    path,
  )
  assertExactRecord(value.readiness, ['status', 'missingFieldIds', 'unsupportedFieldIds'], [], `${path}.readiness`)
  literal(value.readiness.status, 'ready', `${path}.readiness.status`)
  return freezeDto({
    componentName: requireNonEmptyString(value.componentName, `${path}.componentName`),
    materialRegistryVersion:
      typeof value.materialRegistryVersion === 'string'
        ? requireNonEmptyString(value.materialRegistryVersion, `${path}.materialRegistryVersion`)
        : requireNonNegativeInteger(value.materialRegistryVersion, `${path}.materialRegistryVersion`),
    readiness: {
      status: 'ready',
      missingFieldIds: assertStrictOrder(
        stringArray(value.readiness.missingFieldIds, `${path}.readiness.missingFieldIds`),
        entry => entry,
        `${path}.readiness.missingFieldIds`,
      ),
      unsupportedFieldIds: assertStrictOrder(
        stringArray(value.readiness.unsupportedFieldIds, `${path}.readiness.unsupportedFieldIds`),
        entry => entry,
        `${path}.readiness.unsupportedFieldIds`,
      ),
    },
    semanticDescriptor: clone(value.semanticDescriptor, `${path}.semanticDescriptor`),
    semanticDigest: requireNonEmptyString(value.semanticDigest, `${path}.semanticDigest`, {
      maxLength: DEFAULT_SCREEN_CHANGESET_LIMITS.maxStringLength,
    }),
  })
}

const parseCommonSlots = (value, label) => {
  const affectedFieldSlots = assertStrictOrder(
    array(value.affectedFieldSlots, `${label}.affectedFieldSlots`).map((entry, index) =>
      parseFieldSlot(entry, `${label}.affectedFieldSlots[${index}]`),
    ),
    entry => entry.slotKey,
    `${label}.affectedFieldSlots`,
  )
  const affectedStructuralSlots = assertStrictOrder(
    array(value.affectedStructuralSlots, `${label}.affectedStructuralSlots`).map((entry, index) =>
      parseStructuralSlot(entry, `${label}.affectedStructuralSlots[${index}]`),
    ),
    entry => entry.slotKey,
    `${label}.affectedStructuralSlots`,
  )
  const affectedSlotKeys = assertStrictOrder(
    stringArray(value.affectedSlotKeys, `${label}.affectedSlotKeys`),
    entry => entry,
    `${label}.affectedSlotKeys`,
  )
  const expectedKeys = [
    ...new Set([
      ...affectedFieldSlots.flatMap(entry => entry.aliases),
      ...affectedStructuralSlots.map(entry => entry.slotKey),
    ]),
  ].sort(compareCodeUnits)
  if (!jsonEqual(affectedSlotKeys, expectedKeys))
    fail('affected-slot-keys-do-not-match-slots', `${label}.affectedSlotKeys`)
  return { affectedFieldSlots, affectedStructuralSlots, affectedSlotKeys }
}

export const parseScreenChangeSetReceiptPayloads = value => {
  assertExactRecord(value, ['preImages', 'expectedPostImages'], [], 'ScreenReceiptPayloads')
  const pre = ownDataValue(value, 'preImages', 'ScreenReceiptPayloads')
  const post = ownDataValue(value, 'expectedPostImages', 'ScreenReceiptPayloads')
  assertExactRecord(
    pre,
    [
      'schemaVersion',
      'kind',
      'documentId',
      'baseMutationVersion',
      'materialRegistryVersion',
      'manifestFingerprints',
      'insertedNodeIdentities',
      'operations',
      'commands',
      'images',
      'inverseOperations',
      'affectedFieldSlots',
      'affectedStructuralSlots',
      'affectedSlotKeys',
    ],
    [],
    'ScreenReceiptPreImages',
  )
  assertExactRecord(
    post,
    [
      'schemaVersion',
      'kind',
      'documentId',
      'images',
      'affectedFieldSlots',
      'affectedStructuralSlots',
      'affectedSlotKeys',
    ],
    [],
    'ScreenReceiptPostImages',
  )
  requireSchemaVersion(pre.schemaVersion, 'ScreenReceiptPreImages.schemaVersion')
  requireSchemaVersion(post.schemaVersion, 'ScreenReceiptPostImages.schemaVersion')
  literal(pre.kind, PRE_KIND, 'ScreenReceiptPreImages.kind')
  literal(post.kind, POST_KIND, 'ScreenReceiptPostImages.kind')
  const documentId = requireNonEmptyString(pre.documentId, 'ScreenReceiptPreImages.documentId')
  if (post.documentId !== documentId) fail('document-identities-must-match', 'ScreenReceiptPostImages.documentId')
  const operations = array(
    pre.operations,
    'ScreenReceiptPreImages.operations',
    DEFAULT_SCREEN_CHANGESET_LIMITS.maxOperations,
  ).map((entry, index) => parseOperation(entry, `ScreenReceiptPreImages.operations[${index}]`))
  if (operations.length === 0) fail('operations-must-not-be-empty', 'ScreenReceiptPreImages.operations')
  const operationIds = new Set()
  for (const operation of operations) {
    if (operationIds.has(operation.opId)) fail('operation-ids-must-be-unique', 'ScreenReceiptPreImages.operations')
    operationIds.add(operation.opId)
  }
  const commands = array(pre.commands, 'ScreenReceiptPreImages.commands').map((entry, index) =>
    parseCommand(entry, `ScreenReceiptPreImages.commands[${index}]`),
  )
  if (commands.some(command => command.documentId !== documentId))
    fail('command-document-must-match', 'ScreenReceiptPreImages.commands')
  const manifestFingerprints = assertStrictOrder(
    array(
      pre.manifestFingerprints,
      'ScreenReceiptPreImages.manifestFingerprints',
      DEFAULT_SCREEN_CHANGESET_LIMITS.maxManifests,
    ).map((entry, index) => parseManifest(entry, `ScreenReceiptPreImages.manifestFingerprints[${index}]`)),
    entry => entry.componentName,
    'ScreenReceiptPreImages.manifestFingerprints',
  )
  const insertedNodeIdentities = array(
    pre.insertedNodeIdentities,
    'ScreenReceiptPreImages.insertedNodeIdentities',
    DEFAULT_SCREEN_CHANGESET_LIMITS.maxOperations,
  ).map((entry, index) => {
    const path = `ScreenReceiptPreImages.insertedNodeIdentities[${index}]`
    assertExactRecord(entry, ['opId', 'nodeId'], [], path)
    return freezeDto({
      opId: requireNonEmptyString(entry.opId, `${path}.opId`),
      nodeId: requireNonEmptyString(entry.nodeId, `${path}.nodeId`),
    })
  })
  const identities = new Set()
  for (const identity of insertedNodeIdentities) {
    if (!operationIds.has(identity.opId) || identities.has(identity.opId) || identities.has(identity.nodeId))
      fail(
        'inserted-identities-must-be-unique-and-reference-an-operation',
        'ScreenReceiptPreImages.insertedNodeIdentities',
      )
    identities.add(identity.opId)
    identities.add(identity.nodeId)
  }
  const inverseOperations = array(
    pre.inverseOperations,
    'ScreenReceiptPreImages.inverseOperations',
    DEFAULT_SCREEN_CHANGESET_LIMITS.maxOperations,
  ).map((entry, index) => {
    const path = `ScreenReceiptPreImages.inverseOperations[${index}]`
    assertExactRecord(entry, ['sourceOperationId', 'sourceOperationIndex', 'operation'], ['anchors'], path)
    const sourceOperationIndex = requireNonNegativeInteger(entry.sourceOperationIndex, `${path}.sourceOperationIndex`)
    if (sourceOperationIndex >= operations.length || operations[sourceOperationIndex].opId !== entry.sourceOperationId)
      fail('inverse-source-must-match-operation', path)
    const anchors = optionalOwnDataValue(entry, 'anchors', path)
    if (anchors !== undefined) assertExactRecord(anchors, ['beforeId', 'afterId'], [], `${path}.anchors`)
    return freezeDto({
      sourceOperationId: requireNonEmptyString(entry.sourceOperationId, `${path}.sourceOperationId`),
      sourceOperationIndex,
      ...(anchors === undefined
        ? {}
        : {
            anchors: {
              beforeId: nullableString(anchors.beforeId, `${path}.anchors.beforeId`),
              afterId: nullableString(anchors.afterId, `${path}.anchors.afterId`),
            },
          }),
      operation: parseOperation(entry.operation, `${path}.operation`, { inverse: true }),
    })
  })
  const preSlots = parseCommonSlots(pre, 'ScreenReceiptPreImages')
  const postSlots = parseCommonSlots(post, 'ScreenReceiptPostImages')
  if (!jsonEqual(preSlots, postSlots)) fail('pre-and-post-slots-must-match', 'ScreenReceiptPostImages')
  const images = array(pre.images, 'ScreenReceiptPreImages.images').map((entry, index) =>
    parseImage(entry, `ScreenReceiptPreImages.images[${index}]`, operations.length),
  )
  const expectedImages = array(post.images, 'ScreenReceiptPostImages.images').map((entry, index) =>
    parseImage(entry, `ScreenReceiptPostImages.images[${index}]`, operations.length),
  )
  const materialRegistryVersion =
    typeof pre.materialRegistryVersion === 'string'
      ? requireNonEmptyString(pre.materialRegistryVersion, 'ScreenReceiptPreImages.materialRegistryVersion')
      : requireNonNegativeInteger(pre.materialRegistryVersion, 'ScreenReceiptPreImages.materialRegistryVersion')
  if (manifestFingerprints.some(entry => entry.materialRegistryVersion !== materialRegistryVersion))
    fail('manifest-registry-version-must-match', 'ScreenReceiptPreImages.manifestFingerprints')
  return freezeDto({
    preImages: {
      schemaVersion: 1,
      kind: PRE_KIND,
      documentId,
      baseMutationVersion: requireNonNegativeInteger(
        pre.baseMutationVersion,
        'ScreenReceiptPreImages.baseMutationVersion',
      ),
      materialRegistryVersion,
      manifestFingerprints,
      insertedNodeIdentities,
      operations,
      commands,
      images,
      inverseOperations,
      ...preSlots,
    },
    expectedPostImages: { schemaVersion: 1, kind: POST_KIND, documentId, images: expectedImages, ...postSlots },
  })
}

export const createScreenPreparedHashInput = value =>
  freezeDto(
    clone(
      {
        schemaVersion: 1,
        kind: PREPARED_KIND,
        capability: CAPABILITY,
        projectId: value.projectId,
        branchId: value.branchId,
        callId: value.callId,
        baseRevision: value.baseRevision,
        preImages: value.preImages,
        expectedPostImages: value.expectedPostImages,
      },
      'ScreenPreparedHashInput',
    ),
  )

export const createScreenTransactionFingerprintInput = preImages =>
  freezeDto(
    clone(
      {
        schemaVersion: 1,
        kind: TRANSACTION_KIND,
        capability: CAPABILITY,
        callId: preImages.callId,
        documentId: preImages.documentId,
        baseMutationVersion: preImages.baseMutationVersion,
        materialRegistryVersion: preImages.materialRegistryVersion,
        manifestFingerprints: preImages.manifestFingerprints,
        insertedNodeIdentities: preImages.insertedNodeIdentities,
        commands: preImages.commands,
      },
      'ScreenTransactionFingerprintInput',
    ),
  )

export const verifyScreenReceiptIntentRecovery = async ({ receiptIntent, receipt, hashCanonicalJson }) => {
  if (typeof hashCanonicalJson !== 'function') throw new TypeError('hashCanonicalJson is required')
  let intent
  let rawPre
  let rawPost
  try {
    intent = parseReceiptIntent(receiptIntent)
    rawPre = clone(intent.preImages, 'ScreenReceiptIntent.preImages')
    rawPost = clone(intent.expectedPostImages, 'ScreenReceiptIntent.expectedPostImages')
  } catch (error) {
    if (error instanceof PersistenceLineageContractError || error instanceof ScreenChangeSetCompileError) {
      return freezeDto({ classification: 'indeterminate', reason: 'invalid-screen-receipt-intent' })
    }
    throw error
  }
  const preparedHash = await hashCanonicalJson(
    createScreenPreparedHashInput({ ...intent, preImages: rawPre, expectedPostImages: rawPost }),
  )
  if (preparedHash !== intent.preparedHash)
    return freezeDto({ classification: 'indeterminate', reason: 'screen-prepared-hash-mismatch' })
  let rawTransactionInput
  try {
    rawTransactionInput = createScreenTransactionFingerprintInput({
      callId: intent.callId,
      documentId: ownDataValue(rawPre, 'documentId', 'ScreenReceiptIntent.preImages'),
      baseMutationVersion: ownDataValue(rawPre, 'baseMutationVersion', 'ScreenReceiptIntent.preImages'),
      materialRegistryVersion: ownDataValue(rawPre, 'materialRegistryVersion', 'ScreenReceiptIntent.preImages'),
      manifestFingerprints: ownDataValue(rawPre, 'manifestFingerprints', 'ScreenReceiptIntent.preImages'),
      insertedNodeIdentities: ownDataValue(rawPre, 'insertedNodeIdentities', 'ScreenReceiptIntent.preImages'),
      commands: ownDataValue(rawPre, 'commands', 'ScreenReceiptIntent.preImages'),
    })
  } catch {
    return freezeDto({ classification: 'indeterminate', reason: 'invalid-screen-receipt-intent' })
  }
  const transactionFingerprint = await hashCanonicalJson(rawTransactionInput)
  if (receipt?.witness?.transactionFingerprint !== transactionFingerprint)
    return freezeDto({ classification: 'indeterminate', reason: 'screen-transaction-fingerprint-mismatch' })
  try {
    const payloads = parseScreenChangeSetReceiptPayloads({ preImages: rawPre, expectedPostImages: rawPost })
    return freezeDto({ classification: 'verified', receiptIntent: intent, payloads, transactionFingerprint })
  } catch (error) {
    if (error instanceof ScreenChangeSetCompileError)
      return freezeDto({ classification: 'indeterminate', reason: 'invalid-screen-receipt-intent' })
    throw error
  }
}
