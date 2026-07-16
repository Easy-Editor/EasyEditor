import {
  DEFAULT_SCREEN_CHANGESET_LIMITS,
  cloneJsonValue,
  compareCodeUnits,
  freezeDto,
  isPlainRecord,
} from '../capabilities/screen/contract.mjs'
import { compileScreenChangeSet } from '../capabilities/screen/index.mjs'
import { verifyScreenReceiptIntentRecovery } from '../capabilities/screen/receipt-intent.mjs'
import { createMutationProvenanceBatch } from '../persistence/provenance.mjs'
import {
  PersistenceLineageContractError,
  classifyReceiptRecovery,
  createApplyWitness,
  createFailureWitness,
  createReceiptIntent,
  createToolReceipt,
  createToolReceiptWitness,
} from '../persistence/receipt-ledger.mjs'
import { createTaskCompensationService, parseScreenCompensationPlan } from './index.mjs'

const fail = reason => {
  throw new TypeError(`Dashboard compensation runtime adapter: ${reason}`)
}

const failLineage = reason => {
  throw new PersistenceLineageContractError(reason, 'DashboardCompensationRuntimeAdapter.lineage')
}

const requireObject = (value, path) => {
  if (typeof value !== 'object' || value === null) return fail(`${path} is required`)
  return value
}

const requireMethod = (value, key, path) => {
  const owner = requireObject(value, path)
  let method
  try {
    method = owner[key]
  } catch {
    return fail(`${path}.${key} could not be inspected`)
  }
  if (typeof method !== 'function') return fail(`${path}.${key} must be a function`)
  return method.bind(owner)
}

const requireNonEmptyString = (value, path) => {
  if (typeof value !== 'string' || value.length === 0) return fail(`${path} must be a non-empty string`)
  return value
}

const requireNonNegativeInteger = (value, path) => {
  if (!Number.isSafeInteger(value) || value < 0) return fail(`${path} must be a non-negative safe integer`)
  return value
}

const requireRegistryVersion = value => {
  if ((typeof value === 'string' && value.length > 0) || (Number.isSafeInteger(value) && value >= 0)) return value
  return fail('engine.materials.version must be a non-empty string or non-negative safe integer')
}

const ownDataValue = (value, key, path) => {
  let descriptor
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(`${path} could not be inspected`)
  }
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    return fail(`${path}.${String(key)} must be an enumerable data property`)
  }
  return descriptor.value
}

const cloneMutableJson = (value, path) => cloneJsonValue(value, path, DEFAULT_SCREEN_CHANGESET_LIMITS)

const cloneJson = (value, path) => freezeDto(cloneMutableJson(value, path))

const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareCodeUnits)
      .map(key => [key, canonicalize(value[key])]),
  )
}

const jsonEqual = (left, right) => {
  try {
    return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  } catch {
    return false
  }
}

const sameStrings = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index])

const normalizeAuthority = value => {
  const authority = requireObject(value, 'options.authority')
  return freezeDto({
    projectId: requireNonEmptyString(authority.projectId, 'options.authority.projectId'),
    branchId: requireNonEmptyString(authority.branchId, 'options.authority.branchId'),
    sessionId: requireNonEmptyString(authority.sessionId, 'options.authority.sessionId'),
  })
}

const captureSnapshotFence = async captureFullSnapshot => {
  const snapshot = requireObject(await captureFullSnapshot(), 'captureFullSnapshot result')
  const revision = requireNonEmptyString(ownDataValue(snapshot, 'revision', 'snapshot'), 'snapshot.revision')
  const rawGenerations = requireObject(
    ownDataValue(snapshot, 'providerGenerations', 'snapshot'),
    'snapshot.providerGenerations',
  )
  let keys
  try {
    if (Object.getPrototypeOf(rawGenerations) !== Object.prototype && Object.getPrototypeOf(rawGenerations) !== null) {
      return fail('snapshot.providerGenerations must be a plain object')
    }
    if (Object.getOwnPropertySymbols(rawGenerations).length > 0) {
      return fail('snapshot.providerGenerations must not contain symbol fields')
    }
    keys = Object.keys(rawGenerations).sort(compareCodeUnits)
  } catch {
    return fail('snapshot.providerGenerations could not be inspected')
  }
  const providerGenerations = Object.fromEntries(
    keys.map(providerId => [
      requireNonEmptyString(providerId, 'snapshot.providerGenerations key'),
      requireNonNegativeInteger(
        ownDataValue(rawGenerations, providerId, 'snapshot.providerGenerations'),
        `snapshot.providerGenerations.${providerId}`,
      ),
    ]),
  )
  return freezeDto({ revision, providerGenerations: freezeDto(providerGenerations) })
}

const captureDocument = engine => {
  const document = engine.project.currentDocument
  if (!document) return fail('engine.project.currentDocument is unavailable')
  const exportRaw = requireMethod(document, 'exportRaw', 'engine.project.currentDocument')
  const id = requireNonEmptyString(document.id, 'engine.project.currentDocument.id')
  const mutationVersion = requireNonNegativeInteger(
    document.mutationVersion,
    'engine.project.currentDocument.mutationVersion',
  )
  const schema = cloneJson(exportRaw(), 'engine.project.currentDocument.exportRaw()')
  const current = engine.project.currentDocument
  if (!current || current.id !== id || current.mutationVersion !== mutationVersion) {
    return fail('current document changed while it was being captured')
  }
  return Object.freeze({ documentHandle: document, document: freezeDto({ id, mutationVersion, schema }) })
}

const registeredMaterialNames = engine => {
  const entries = engine.materials.getComponentMetasMap()
  if (!(entries instanceof Map)) return fail('engine.materials.getComponentMetasMap() must return a Map')
  return [...entries.keys()]
    .map(name => requireNonEmptyString(name, 'registered material componentName'))
    .sort(compareCodeUnits)
}

const captureManifests = async (engine, manifestCache) => {
  const materialRegistryVersion = requireRegistryVersion(engine.materials.version)
  const componentNames = registeredMaterialNames(engine)
  const manifests = await Promise.all(
    componentNames.map(async componentName => {
      const manifest = cloneJson(
        await manifestCache.get(componentName, materialRegistryVersion),
        `manifestCache.get(${JSON.stringify(componentName)})`,
      )
      if (manifest.componentName !== componentName)
        return fail('manifest componentName does not match its registry key')
      if (!Object.is(manifest.materialRegistryVersion, materialRegistryVersion)) {
        return fail('manifest materialRegistryVersion does not match the captured registry version')
      }
      return manifest
    }),
  )
  if (
    !Object.is(requireRegistryVersion(engine.materials.version), materialRegistryVersion) ||
    !sameStrings(registeredMaterialNames(engine), componentNames)
  ) {
    return fail('material registry changed while manifests were being captured')
  }
  return freezeDto({
    materialRegistryVersion,
    manifests: freezeDto(manifests),
    compilerManifests: freezeDto(manifests.filter(manifest => manifest.readiness?.status === 'ready')),
  })
}

const captureProject = engine => {
  const document = engine.project.currentDocument
  if (!document) return fail('engine.project.currentDocument is unavailable while capturing the project')
  const documentId = requireNonEmptyString(document.id, 'engine.project.currentDocument.id')
  const mutationVersion = requireNonNegativeInteger(
    document.mutationVersion,
    'engine.project.currentDocument.mutationVersion',
  )
  const projectSchema = cloneJson(engine.project.export(), 'engine.project.export()')
  const documents = engine.project.documents
  if (!Array.isArray(documents)) return fail('engine.project.documents must be an array')
  const matchingIndexes = documents.flatMap((candidate, index) => (candidate?.id === documentId ? [index] : []))
  if (matchingIndexes.length !== 1)
    return fail('current document identity is missing or ambiguous in engine.project.documents')
  const index = matchingIndexes[0]
  const fileName = requireNonEmptyString(document.fileName, 'engine.project.currentDocument.fileName')
  const current = engine.project.currentDocument
  if (!current || current.id !== documentId || current.mutationVersion !== mutationVersion) {
    return fail('current document changed while the project was being captured')
  }
  return freezeDto({ activeDocument: freezeDto({ documentId, fileName, index }), projectSchema })
}

const projectScreenPayloads = payloads =>
  freezeDto({
    preImages: {
      schemaVersion: 1,
      kind: 'screen-change-set-pre-images',
      documentId: payloads.preImages.documentId,
      baseMutationVersion: payloads.preImages.baseMutationVersion,
      materialRegistryVersion: payloads.preImages.materialRegistryVersion,
      insertedNodeIdentities: payloads.preImages.insertedNodeIdentities,
      images: payloads.preImages.images,
      inverseOperations: payloads.preImages.inverseOperations,
      affectedFieldSlots: payloads.preImages.affectedFieldSlots,
      affectedStructuralSlots: payloads.preImages.affectedStructuralSlots,
      affectedSlotKeys: payloads.preImages.affectedSlotKeys,
    },
    expectedPostImages: {
      schemaVersion: 1,
      kind: 'screen-change-set-post-images',
      documentId: payloads.expectedPostImages.documentId,
      images: payloads.expectedPostImages.images,
      affectedFieldSlots: payloads.expectedPostImages.affectedFieldSlots,
      affectedStructuralSlots: payloads.expectedPostImages.affectedStructuralSlots,
      affectedSlotKeys: payloads.expectedPostImages.affectedSlotKeys,
    },
  })

const screenIntentKind = recovery => {
  try {
    return recovery?.receiptIntent?.preImages?.kind
  } catch {
    return undefined
  }
}

const verifyRecoveredScreen = async ({ recovery, authority, callId, hashCanonicalJson }) => {
  if (recovery.classification !== 'committed') {
    return failLineage('original Screen call is not a committed durable effect')
  }
  const receipt = createToolReceipt(recovery.receipt)
  if (
    receipt.status !== 'applied' ||
    receipt.projectId !== authority.projectId ||
    receipt.branchId !== authority.branchId ||
    receipt.callId !== callId
  ) {
    return failLineage('original Screen receipt authority or status does not match')
  }
  const verification = await verifyScreenReceiptIntentRecovery({
    receiptIntent: recovery.receiptIntent,
    receipt,
    hashCanonicalJson,
  })
  if (verification.classification !== 'verified') {
    return failLineage(verification.reason)
  }
  if (
    verification.receiptIntent.projectId !== authority.projectId ||
    verification.receiptIntent.branchId !== authority.branchId ||
    verification.receiptIntent.callId !== callId
  ) {
    return failLineage('original Screen ReceiptIntent authority does not match')
  }
  return verification
}

const buildGraph = (rawSchema, { tolerant = false } = {}) => {
  const schema = cloneMutableJson(rawSchema, 'screenCompensation.document.schema')
  const nodes = new Map()
  let ambiguous = false
  const visit = (node, parentId, path) => {
    if (!isPlainRecord(node)) {
      if (tolerant) {
        ambiguous = true
        return null
      }
      return fail(`${path} must be a plain node object`)
    }
    const id = typeof node.id === 'string' && node.id.length > 0 ? node.id : null
    const componentName =
      typeof node.componentName === 'string' && node.componentName.length > 0 ? node.componentName : null
    if (id === null || componentName === null || nodes.has(id)) {
      if (tolerant) {
        ambiguous = true
        return null
      }
      return fail(`${path} has a missing or duplicate node identity`)
    }
    const rawChildren = node.children === undefined ? [] : node.children
    if (!Array.isArray(rawChildren)) {
      if (tolerant) {
        ambiguous = true
        return null
      }
      return fail(`${path}.children must be an array`)
    }
    const record = { id, componentName, parentId, schema: node, children: [] }
    nodes.set(id, record)
    rawChildren.forEach((child, index) => {
      const result = visit(child, id, `${path}.children[${index}]`)
      if (result) record.children.push(result.id)
    })
    return record
  }
  const root = visit(schema, null, 'screenCompensation.document.schema')
  if (root === null) ambiguous = true
  return { schema, nodes, rootId: root?.id ?? null, ambiguous }
}

const syncChildren = (graph, parent) => {
  if (parent.children.length === 0) {
    Reflect.deleteProperty(parent.schema, 'children')
  } else parent.schema.children = parent.children.map(id => graph.nodes.get(id).schema)
}

const removeSubtree = (graph, nodeId) => {
  const node = graph.nodes.get(nodeId)
  if (!node) return fail(`inverse command references missing node ${nodeId}`)
  for (const childId of [...node.children]) removeSubtree(graph, childId)
  graph.nodes.delete(nodeId)
}

const setPath = (root, path, value) => {
  let cursor = root
  for (const segment of path.slice(0, -1)) {
    if (!isPlainRecord(cursor[segment])) cursor[segment] = {}
    cursor = cursor[segment]
  }
  cursor[path.at(-1)] = cloneMutableJson(value, 'screenCompensation.field.value')
}

const unsetPath = (root, path) => {
  let cursor = root
  for (const segment of path.slice(0, -1)) {
    if (!isPlainRecord(cursor?.[segment])) return
    cursor = cursor[segment]
  }
  if (isPlainRecord(cursor)) delete cursor[path.at(-1)]
}

const applyExpectedImages = (graph, images) => {
  for (const image of images) {
    if (image.kind === 'field') {
      const node = graph.nodes.get(image.nodeId)
      if (!node) return fail(`compiled inverse lost field node ${image.nodeId}`)
      const root = image.root === 'props' ? (node.schema.props ??= {}) : node.schema
      if (!isPlainRecord(root)) return fail(`compiled inverse field root for ${image.nodeId} is not an object`)
      if (image.existed) setPath(root, image.path, image.value)
      else unsetPath(root, image.path)
      continue
    }
    if (image.kind === 'node') {
      if (!image.existed && graph.nodes.has(image.nodeId)) {
        const node = graph.nodes.get(image.nodeId)
        if (node.parentId !== null) {
          const parent = graph.nodes.get(node.parentId)
          parent.children = parent.children.filter(id => id !== node.id)
          syncChildren(graph, parent)
        }
        removeSubtree(graph, image.nodeId)
      }
      continue
    }
    if (!image.existed) continue
    const node = graph.nodes.get(image.nodeId)
    const targetParent = graph.nodes.get(image.parentId)
    if (!node || !targetParent || node.parentId === null) return fail('compiled inverse placement is not representable')
    const oldParent = graph.nodes.get(node.parentId)
    oldParent.children = oldParent.children.filter(id => id !== node.id)
    syncChildren(graph, oldParent)
    targetParent.children = targetParent.children.filter(id => id !== node.id)
    targetParent.children.splice(image.index, 0, node.id)
    node.parentId = targetParent.id
    syncChildren(graph, targetParent)
  }
}

// Core persists these built-in Node props even when the semantic insert command
// omitted them. Compensation still requires every caller-authored byte to
// match; only the exact Core defaults may be projected back to the immutable
// pre-Core ReceiptIntent image.
const CORE_NODE_DEFAULTS = Object.freeze({
  condition: true,
  hidden: false,
  locked: false,
  title: '',
})

const matchesCanonicalCoreNode = (current, expected) => {
  if (jsonEqual(current, expected)) return true
  if (!isPlainRecord(current) || !isPlainRecord(expected)) return false
  const projected = cloneMutableJson(current, 'screenCompensation.observation.node')
  for (const [key, defaultValue] of Object.entries(CORE_NODE_DEFAULTS)) {
    if (!Object.hasOwn(expected, key) && Object.is(projected[key], defaultValue)) {
      Reflect.deleteProperty(projected, key)
    }
  }
  return jsonEqual(projected, expected)
}

const observeImage = (template, graph) => {
  const node = graph.nodes.get(template.nodeId)
  if (template.kind === 'field') {
    let cursor = template.root === 'props' ? node?.schema?.props : node?.schema
    let existed = node !== undefined
    for (const segment of template.path) {
      if (!isPlainRecord(cursor) || !Object.hasOwn(cursor, segment)) {
        existed = false
        break
      }
      cursor = cursor[segment]
    }
    return freezeDto({
      operationIndex: template.operationIndex,
      kind: 'field',
      nodeId: template.nodeId,
      fieldId: template.fieldId,
      root: template.root,
      path: template.path,
      existed,
      value: existed ? cloneJson(cursor, 'screenCompensation.observation.field') : null,
    })
  }
  if (template.kind === 'node') {
    const observedNode =
      node !== undefined && template.existed && matchesCanonicalCoreNode(node.schema, template.node)
        ? template.node
        : node?.schema
    return freezeDto({
      operationIndex: template.operationIndex,
      kind: 'node',
      nodeId: template.nodeId,
      existed: node !== undefined,
      node: observedNode === undefined ? null : cloneJson(observedNode, 'screenCompensation.observation.node'),
    })
  }
  if (!node || node.parentId === null) {
    return freezeDto({
      operationIndex: template.operationIndex,
      kind: 'placement',
      nodeId: template.nodeId,
      existed: false,
      parentId: null,
      index: null,
      beforeId: null,
      afterId: null,
    })
  }
  const parent = graph.nodes.get(node.parentId)
  const index = parent?.children.indexOf(node.id) ?? -1
  if (!parent || index < 0) {
    return freezeDto({
      operationIndex: template.operationIndex,
      kind: 'placement',
      nodeId: template.nodeId,
      existed: false,
      parentId: null,
      index: null,
      beforeId: null,
      afterId: null,
    })
  }
  return freezeDto({
    operationIndex: template.operationIndex,
    kind: 'placement',
    nodeId: template.nodeId,
    existed: true,
    parentId: parent.id,
    index,
    beforeId: index === 0 ? null : parent.children[index - 1],
    afterId: index + 1 === parent.children.length ? null : parent.children[index + 1],
  })
}

const observeImages = (templates, graph) => freezeDto(templates.map(template => observeImage(template, graph)))

const restoredImagesMatch = (expectedImages, observedImages) =>
  expectedImages.length === observedImages.length &&
  expectedImages.every((expected, index) => {
    const observed = observedImages[index]
    if (
      expected.operationIndex !== observed?.operationIndex ||
      expected.kind !== observed.kind ||
      expected.nodeId !== observed.nodeId
    ) {
      return false
    }
    if (expected.kind !== 'placement') return jsonEqual(expected, observed)
    if (expected.existed !== observed.existed) return false
    if (!expected.existed) return jsonEqual(expected, observed)
    if (expected.parentId !== observed.parentId) return false
    if (expected.beforeId !== null) return observed.beforeId === expected.beforeId
    if (expected.afterId !== null) return observed.afterId === expected.afterId
    return observed.afterId === null
  })

const collectSubtreeIds = rawNode => {
  const graph = buildGraph(rawNode)
  const bytes = new TextEncoder().encode(JSON.stringify(graph.schema)).byteLength
  if (bytes > DEFAULT_SCREEN_CHANGESET_LIMITS.maxInputBytes) return fail('trusted restore subtree exceeds JSON budget')
  return { node: graph.schema, ids: [...graph.nodes.keys()] }
}

const targetParentId = (record, graph, plan) => {
  const operation = record.operation
  if (operation.type === 'insert' || operation.type === 'move') return operation.parentId
  if (operation.type !== 'reorder') return null
  const prePlacement = plan.preImages.find(
    image =>
      image.kind === 'placement' &&
      image.operationIndex === record.sourceOperationIndex &&
      image.nodeId === operation.nodeId &&
      image.existed,
  )
  return prePlacement?.parentId ?? graph.nodes.get(operation.nodeId)?.parentId ?? null
}

const inspectAnchor = (record, graph, plan) => {
  const parentId = targetParentId(record, graph, plan)
  const parent = parentId === null ? null : graph.nodes.get(parentId)
  if (!parent) return 'invalid'
  const { anchors, operation } = record
  const expectedPosition =
    anchors.beforeId !== null
      ? { place: 'after', siblingId: anchors.beforeId }
      : anchors.afterId !== null
        ? { place: 'before', siblingId: anchors.afterId }
        : { place: 'last' }
  if (!jsonEqual(operation.position, expectedPosition)) return 'ambiguous'
  if (expectedPosition.place === 'last') return 'valid'
  if (expectedPosition.siblingId === operation.nodeId) return 'ambiguous'
  const sibling = graph.nodes.get(expectedPosition.siblingId)
  return sibling?.parentId === parent.id && parent.children.includes(sibling.id) ? 'valid' : 'invalid'
}

const resolveRelativeIndex = (graph, parent, movingNodeId, position) => {
  const children = parent.children.filter(id => id !== movingNodeId)
  if (position.place === 'last') return children.length
  if (position.place === 'first') return 0
  if (position.siblingId === movingNodeId) return fail('relative anchor cannot reference the moving node')
  const sibling = graph.nodes.get(position.siblingId)
  const index = children.indexOf(position.siblingId)
  if (!sibling || sibling.parentId !== parent.id || index < 0) return fail('relative anchor is missing or foreign')
  return position.place === 'before' ? index : index + 1
}

const compileTrustedRestore = ({ graph, operation, documentId }) => {
  const parent = graph.nodes.get(operation.parentId)
  if (!parent || parent.schema.locked === true) return fail('trusted restore parent is missing or locked')
  const restored = collectSubtreeIds(operation.node)
  if (restored.ids.some(id => graph.nodes.has(id)))
    return fail('trusted restore subtree identity collides with current document')
  const at = resolveRelativeIndex(graph, parent, null, operation.position)
  const restoredGraph = buildGraph(restored.node)
  const attach = (nodeId, parentId) => {
    const source = restoredGraph.nodes.get(nodeId)
    graph.nodes.set(nodeId, {
      id: source.id,
      componentName: source.componentName,
      parentId,
      schema: source.schema,
      children: [...source.children],
    })
    source.children.forEach(childId => attach(childId, source.id))
  }
  attach(restoredGraph.rootId, parent.id)
  parent.children.splice(at, 0, restoredGraph.rootId)
  syncChildren(graph, parent)
  return freezeDto({ type: 'insertNode', documentId, parentId: parent.id, at, node: restored.node })
}

const compileInverseCommands = ({ authority, inverseCallId, plan, verified, document, manifestCapture }) => {
  if (document.id !== plan.documentId || document.id !== verified.payloads.preImages.documentId) {
    return fail('inverse document binding does not match the verified original receipt')
  }
  const graph = buildGraph(document.schema)
  const commands = []
  for (const record of verified.payloads.preImages.inverseOperations) {
    const operation = record.operation
    if (operation.type === 'insert' && Object.hasOwn(operation, 'node')) {
      commands.push(compileTrustedRestore({ graph, operation, documentId: document.id }))
      continue
    }
    const compiled = compileScreenChangeSet({
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      callId: verified.receiptIntent.callId,
      materialRegistryVersion: manifestCapture.materialRegistryVersion,
      expectedMutationVersion: document.mutationVersion,
      document: { id: document.id, mutationVersion: document.mutationVersion, schema: graph.schema },
      manifests: manifestCapture.compilerManifests,
      changeSet: { schemaVersion: 1, documentId: document.id, operations: [operation] },
    })
    if (
      !Object.is(compiled.materialRegistryVersion, verified.payloads.preImages.materialRegistryVersion) ||
      !jsonEqual(compiled.manifestFingerprints, verified.payloads.preImages.manifestFingerprints)
    ) {
      return fail('current material manifest semantics differ from the verified original receipt')
    }
    commands.push(...compiled.commands)
    applyExpectedImages(graph, compiled.expectedPostImages)
  }
  const restoredImages = observeImages(plan.preImages, graph)
  if (!restoredImagesMatch(plan.preImages, restoredImages))
    return fail('semantic inverse does not reconstruct the retained pre-images')
  return freezeDto({ commands: freezeDto(commands), restoredImages })
}

const failure = (code, message, details) =>
  freezeDto({ code, message, retryable: false, ...(details === undefined ? {} : { details }) })

export const createDashboardTaskCompensationService = options => {
  const input = requireObject(options, 'options')
  const authority = normalizeAuthority(input.authority)
  const engine = requireObject(input.engine, 'options.engine')
  requireObject(engine.project, 'options.engine.project')
  requireMethod(engine.project, 'export', 'options.engine.project')
  requireObject(engine.materials, 'options.engine.materials')
  requireMethod(engine.materials, 'getComponentMetasMap', 'options.engine.materials')
  requireObject(engine.transactions, 'options.engine.transactions')
  const runOnDocument = requireMethod(engine.transactions, 'runOnDocument', 'options.engine.transactions')
  const persistence = requireObject(input.persistence, 'options.persistence')
  const recoverReceipt = requireMethod(persistence, 'recoverDurableAgentReceipt', 'options.persistence')
  const runWrite = requireMethod(persistence, 'runDurableAgentWrite', 'options.persistence')
  const runAgentMutation =
    typeof persistence.runAgentMutation === 'function'
      ? persistence.runAgentMutation.bind(persistence)
      : (_callId, operation) => operation()
  const activityLease = requireObject(input.activityLease, 'options.activityLease')
  const waitUntilIdle = requireMethod(activityLease, 'waitUntilIdle', 'options.activityLease')
  const isActive = requireMethod(activityLease, 'isActive', 'options.activityLease')
  const captureFullSnapshot = requireMethod(input, 'captureFullSnapshot', 'options')
  const manifestCache = requireObject(input.manifestCache, 'options.manifestCache')
  requireMethod(manifestCache, 'get', 'options.manifestCache')
  const hashCanonicalJson = requireMethod(input, 'hashCanonicalJson', 'options')
  const now = requireMethod(input, 'now', 'options')
  const isTransactionCommittedError = requireMethod(input, 'isTransactionCommittedError', 'options')
  const isTransactionRollbackIncompleteError = requireMethod(input, 'isTransactionRollbackIncompleteError', 'options')

  const permits = new Map()
  const verifiedLineages = new Map()

  const verifyRecovery = (recovery, callId) => verifyRecoveredScreen({ recovery, authority, callId, hashCanonicalJson })

  const recoverVerifiedCached = async (originalCallId, inverseCallId) => {
    const cached = verifiedLineages.get(originalCallId)
    if (!cached || cached.inverseCallId !== inverseCallId)
      return failLineage('verified original lineage is unavailable')
    const verified = await verifyRecovery(cached.recovery, originalCallId)
    if (!jsonEqual(verified.payloads, cached.verified.payloads)) {
      return failLineage('original Screen lineage changed during compensation')
    }
    return verified
  }

  const wrappedPersistence = freezeDto({
    readCompensationRun: requireMethod(persistence, 'readCompensationRun', 'options.persistence'),
    readCompensationTargetClaim: requireMethod(persistence, 'readCompensationTargetClaim', 'options.persistence'),
    commitCompensationRunState: requireMethod(persistence, 'commitCompensationRunState', 'options.persistence'),
    async recoverDurableAgentReceipt(request) {
      const recovery = await recoverReceipt(request)
      if (
        (recovery.classification === 'committed' || recovery.classification === 'failed') &&
        screenIntentKind(recovery) === 'screen-change-set-pre-images'
      ) {
        try {
          await verifyRecovery(recovery, request.callId)
        } catch (error) {
          return freezeDto({
            classification: 'indeterminate',
            reason: error instanceof Error ? error.message : 'invalid-screen-receipt-lineage',
          })
        }
      }
      return recovery
    },
    async runDurableAgentWrite(operation) {
      return runWrite(async session =>
        operation(
          freezeDto({
            draft: session.draft,
            recordIntent: session.recordIntent.bind(session),
            readMutationProvenance: session.readMutationProvenance.bind(session),
            commitBatch: session.commitBatch.bind(session),
            async readReceiptLineage(request) {
              const raw = await session.readReceiptLineage(request)
              const recovery = classifyReceiptRecovery({
                projectId: request.projectId,
                branchId: request.branchId,
                callId: request.callId,
                receiptIntent: raw.receiptIntent,
                receipt: raw.receipt,
                applyWitness: raw.applyWitness,
                failureWitness: raw.failureWitness,
              })
              const verified = await verifyRecovery(recovery, request.callId)
              const inverseCallId = [...permits.entries()].find(
                ([, permit]) => permit.originalCallId === request.callId,
              )?.[0]
              if (inverseCallId === undefined) return failLineage('inverse permit is unavailable for original lineage')
              verifiedLineages.set(request.callId, { inverseCallId, recovery, verified })
              const projected = projectScreenPayloads(verified.payloads)
              return freezeDto({
                ...raw,
                receiptIntent: {
                  ...verified.receiptIntent,
                  preImages: projected.preImages,
                  expectedPostImages: projected.expectedPostImages,
                },
              })
            },
          }),
        ),
      )
    },
  })

  const beforeInverse = async value => {
    const idle = await waitUntilIdle()
    const generation = requireNonNegativeInteger(idle?.generation, 'compensation.idle.generation')
    const snapshot = await captureSnapshotFence(captureFullSnapshot)
    permits.set(value.inverseCallId, freezeDto({ generation, snapshot, originalCallId: value.originalCallId }))
  }

  const observer = freezeDto({
    async observe(value) {
      const verified = await recoverVerifiedCached(value.originalCallId, value.inverseCallId)
      const projectedPlan = parseScreenCompensationPlan(projectScreenPayloads(verified.payloads))
      if (!jsonEqual(projectedPlan, value.plan))
        return failLineage('verified Screen plan does not match compensation input')
      const permit = permits.get(value.inverseCallId)
      if (!permit) return failLineage('inverse permit is unavailable during observation')
      let ambiguous = activityLease.generation !== permit.generation || isActive()
      let capture
      try {
        const snapshot = await captureSnapshotFence(captureFullSnapshot)
        if (!jsonEqual(snapshot, permit.snapshot)) ambiguous = true
        capture = captureDocument(engine)
        if (capture.document.id !== value.plan.documentId) ambiguous = true
      } catch {
        ambiguous = true
      }
      const graph = capture ? buildGraph(capture.document.schema, { tolerant: true }) : null
      if (graph?.ambiguous) ambiguous = true
      const images = graph ? observeImages(value.plan.expectedPostImages, graph) : value.plan.expectedPostImages
      const identityStates = value.plan.insertedNodeIdentities.map(({ nodeId }) => {
        const current = graph?.nodes.get(nodeId)
        if (!graph || graph.ambiguous) return { nodeId, state: 'ambiguous' }
        if (!current) return { nodeId, state: 'missing' }
        const expected = value.plan.expectedPostImages.find(image => image.kind === 'node' && image.nodeId === nodeId)
        return {
          nodeId,
          state: expected?.node && matchesCanonicalCoreNode(current.schema, expected.node) ? 'matches' : 'reused',
        }
      })
      const rawRestoreCollision = verified.payloads.preImages.inverseOperations.some(record => {
        if (record.operation.type !== 'insert' || !Object.hasOwn(record.operation, 'node') || !graph) return false
        try {
          return collectSubtreeIds(record.operation.node).ids.some(id => graph.nodes.has(id))
        } catch {
          return true
        }
      })
      if (rawRestoreCollision) ambiguous = true
      const anchorStates = value.plan.inverseOperations
        .filter(record => record.anchors !== undefined)
        .map(record => ({
          sourceOperationId: record.sourceOperationId,
          state: graph ? inspectAnchor(record, graph, value.plan) : 'ambiguous',
        }))
      return freezeDto({
        schemaVersion: 1,
        documentId: value.plan.documentId,
        images,
        identityStates,
        anchorStates,
        ambiguous,
      })
    },
  })

  const inverseExecutor = freezeDto({
    async prepare(value) {
      const isEmpty = value.kind === 'empty'
      const verified = isEmpty ? null : await recoverVerifiedCached(value.originalCallId, value.inverseCallId)
      if (!isEmpty) {
        const projectedPlan = parseScreenCompensationPlan(projectScreenPayloads(verified.payloads))
        if (!jsonEqual(projectedPlan, value.plan))
          return failLineage('verified Screen plan changed before inverse prepare')
      }
      const permit = permits.get(value.inverseCallId)
      const snapshot = permit?.snapshot ?? (await captureSnapshotFence(captureFullSnapshot))
      let guardFailure = null
      if (!isEmpty && (!permit || activityLease.generation !== permit.generation || isActive())) {
        guardFailure = 'HUMAN_ACTIVITY'
      }
      const currentSnapshot = await captureSnapshotFence(captureFullSnapshot)
      if (!jsonEqual(currentSnapshot, snapshot)) guardFailure ??= 'STALE_REVISION'
      const documentCapture = captureDocument(engine)
      const projectBefore = captureProject(engine)
      if (!jsonEqual(projectBefore.projectSchema, value.draft.projectSchema)) guardFailure ??= 'STALE_REVISION'
      if (value.plan && documentCapture.document.id !== value.plan.documentId) guardFailure ??= 'STALE_REVISION'
      const manifestCapture = await captureManifests(engine, manifestCache)
      let compiled = null
      if (value.kind === 'inverse' && guardFailure === null) {
        try {
          compiled = compileInverseCommands({
            authority,
            inverseCallId: value.inverseCallId,
            plan: value.plan,
            verified,
            document: documentCapture.document,
            manifestCapture,
          })
        } catch {
          guardFailure = 'STALE_REVISION'
        }
      }
      const commands = compiled?.commands ?? []
      const transactionFingerprint = await hashCanonicalJson({
        schemaVersion: 1,
        kind: 'screen-compensation-transaction',
        originalCallId: value.originalCallId,
        inverseCallId: value.inverseCallId,
        documentId: documentCapture.document.id,
        baseMutationVersion: documentCapture.document.mutationVersion,
        originalTransactionFingerprint: verified?.transactionFingerprint ?? null,
        commands,
      })
      const preImages = freezeDto({
        schemaVersion: 1,
        kind: 'screen-compensation-pre-images',
        originalCallId: value.originalCallId,
        documentId: documentCapture.document.id,
        baseMutationVersion: documentCapture.document.mutationVersion,
        originalTransactionFingerprint: verified?.transactionFingerprint ?? null,
        images: value.observation?.images ?? [],
        inverseOperations: verified?.payloads.preImages.inverseOperations ?? [],
        commands,
        affectedSlotKeys: value.plan?.affectedSlotKeys ?? [],
      })
      const expectedPostImages = freezeDto({
        schemaVersion: 1,
        kind: 'screen-compensation-post-images',
        documentId: documentCapture.document.id,
        images: compiled?.restoredImages ?? value.plan?.preImages ?? [],
        affectedSlotKeys: value.plan?.affectedSlotKeys ?? [],
      })
      const preparedHash = await hashCanonicalJson({
        schemaVersion: 1,
        kind: 'screen-compensation-prepared',
        projectId: authority.projectId,
        branchId: authority.branchId,
        callId: value.inverseCallId,
        baseRevision: snapshot.revision,
        transactionFingerprint,
        preImages,
        expectedPostImages,
      })
      const receiptIntent = createReceiptIntent({
        schemaVersion: 1,
        projectId: authority.projectId,
        branchId: authority.branchId,
        callId: value.inverseCallId,
        preparedHash,
        baseRevision: snapshot.revision,
        preImages,
        expectedPostImages,
        status: 'pending',
      })

      const terminalFailure = async (code, message, details) => {
        const postSnapshot = await captureSnapshotFence(captureFullSnapshot)
        const project = captureProject(engine)
        const draftGeneration = value.draft.draftGeneration + 1
        const witness = createFailureWitness({
          schemaVersion: 1,
          projectId: authority.projectId,
          branchId: authority.branchId,
          callId: value.inverseCallId,
          draftGeneration,
          transactionFingerprint,
          receiptStatus: 'not-applied',
          failureCode: code,
        })
        return freezeDto({
          activeDocument: project.activeDocument,
          projectSchema: project.projectSchema,
          receipt: createToolReceipt({
            schemaVersion: 1,
            projectId: authority.projectId,
            branchId: authority.branchId,
            callId: value.inverseCallId,
            status: 'not-applied',
            revision: postSnapshot.revision,
            witness: createToolReceiptWitness(witness),
            failure: failure(code, message, details),
          }),
          witness,
          provenance: [],
          updatedAt: requireNonNegativeInteger(now(), 'compensation.updatedAt'),
        })
      }

      return freezeDto({
        receiptIntent,
        async execute() {
          try {
            if (!isEmpty) await recoverVerifiedCached(value.originalCallId, value.inverseCallId)
            if (value.kind === 'empty')
              return terminalFailure('NO_CHANGE', 'The target task has no applied Screen effects')
            if (value.kind === 'conflict') {
              return terminalFailure(
                'COMPENSATION_CONFLICT',
                'The original Screen effect is no longer safe to invert',
                {
                  conflictCode: value.conflict.code,
                  slotKeys: value.conflict.slotKeys,
                },
              )
            }
            if (guardFailure !== null) {
              return terminalFailure(guardFailure, 'The compensation inverse lost its human/revision fence', {
                stage: 'prepare',
              })
            }
            if (!permit || activityLease.generation !== permit.generation || isActive()) {
              return terminalFailure(
                'HUMAN_ACTIVITY',
                'Human activity took priority before compensation Core execution',
                {
                  stage: 'before-core',
                },
              )
            }
            const currentSnapshot = await captureSnapshotFence(captureFullSnapshot)
            const currentDocument = captureDocument(engine)
            const currentManifests = await captureManifests(engine, manifestCache)
            if (
              !jsonEqual(currentSnapshot, snapshot) ||
              currentDocument.document.id !== documentCapture.document.id ||
              currentDocument.document.mutationVersion !== documentCapture.document.mutationVersion ||
              !Object.is(currentManifests.materialRegistryVersion, manifestCapture.materialRegistryVersion) ||
              !jsonEqual(currentManifests.manifests, manifestCapture.manifests)
            ) {
              return terminalFailure('STALE_REVISION', 'The compensation inverse fence changed before Core execution', {
                stage: 'before-core',
              })
            }
            if (activityLease.generation !== permit.generation || isActive()) {
              return terminalFailure(
                'HUMAN_ACTIVITY',
                'Human activity took priority immediately before compensation Core execution',
                {
                  stage: 'after-fence',
                },
              )
            }
            let transactionError = null
            let transactionReturned = false
            try {
              await runAgentMutation(value.inverseCallId, () =>
                runOnDocument(documentCapture.documentHandle, commands, {
                  expectedMutationVersion: documentCapture.document.mutationVersion,
                }),
              )
              transactionReturned = true
            } catch (error) {
              transactionError = error
            }
            if (transactionError !== null && isTransactionRollbackIncompleteError(transactionError)) {
              throw transactionError
            }
            const committedError = transactionError !== null && isTransactionCommittedError(transactionError)
            const postDocument = captureDocument(engine)
            const schemaChanged = !jsonEqual(documentCapture.document.schema, postDocument.document.schema)
            if (transactionError !== null && !committedError) {
              if (schemaChanged) throw transactionError
              return terminalFailure('CORE_TRANSACTION_FAILED', 'The compensation Core transaction rolled back', {
                stage: 'core',
              })
            }
            if (!transactionReturned && !committedError) throw new Error('compensation Core outcome is indeterminate')
            if (!schemaChanged)
              return terminalFailure('NO_CHANGE', 'The compensation inverse produced no schema change')
            const restoredGraph = buildGraph(postDocument.document.schema, { tolerant: true })
            const restoredImages = restoredGraph.ambiguous ? [] : observeImages(value.plan.preImages, restoredGraph)
            if (
              restoredGraph.ambiguous ||
              !restoredImagesMatch(value.plan.preImages, restoredImages) ||
              !jsonEqual(restoredImages, compiled.restoredImages)
            ) {
              throw new Error('compensation Core post-state does not match retained pre-images')
            }
            const postSnapshot = await captureSnapshotFence(captureFullSnapshot)
            const project = captureProject(engine)
            const draftGeneration = value.draft.draftGeneration + 1
            const provenance = createMutationProvenanceBatch({
              projectId: authority.projectId,
              branchId: authority.branchId,
              draftGeneration,
              slotKeys: value.plan.affectedSlotKeys,
              source: 'agent',
              callId: value.inverseCallId,
            })
            const witness = createApplyWitness({
              schemaVersion: 1,
              projectId: authority.projectId,
              branchId: authority.branchId,
              callId: value.inverseCallId,
              draftGeneration,
              coreMutationVersion: postDocument.document.mutationVersion,
              transactionFingerprint,
              affectedSlotTokens: provenance.map(({ slotKey, token }) => ({ slotKey, token })),
            })
            return freezeDto({
              activeDocument: project.activeDocument,
              projectSchema: project.projectSchema,
              receipt: createToolReceipt({
                schemaVersion: 1,
                projectId: authority.projectId,
                branchId: authority.branchId,
                callId: value.inverseCallId,
                status: 'applied',
                revision: postSnapshot.revision,
                witness: createToolReceiptWitness(witness),
              }),
              witness,
              provenance,
              updatedAt: requireNonNegativeInteger(now(), 'compensation.updatedAt'),
            })
          } finally {
            permits.delete(value.inverseCallId)
            if (!isEmpty) verifiedLineages.delete(value.originalCallId)
          }
        },
      })
    },
  })

  return createTaskCompensationService({
    ...authority,
    persistence: wrappedPersistence,
    observer,
    inverseExecutor,
    beforeInverse,
    now,
  })
}
