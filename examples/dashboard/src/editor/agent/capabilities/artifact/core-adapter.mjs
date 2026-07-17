import {
  readCanonicalNodeArtifactRef,
  writeCanonicalNodeArtifactRef,
} from '../../online-components/artifact-contracts.mjs'
import { jsonDataEqual } from '../../persistence/contract.mjs'
import {
  createChildrenOrderSlotKey,
  createFieldSlotAliases,
  createNodeStructuralSlotKeys,
} from '../../persistence/provenance.mjs'
import { createCoreProjectionProvider, createHostRevision } from '../../snapshot/index.mjs'
import { GENERATED_MATERIAL_HOST_COMPONENT_NAME } from './contract.mjs'
import { OnlineArtifactCoreOutcomeError } from './service.mjs'

const cloneJson = value => structuredClone(value)

const requireCurrentDocument = engine => {
  const document = engine.project.currentDocument
  if (!document) throw new Error('Online artifact mutation requires an active document')
  return document
}

const createProjectionAdapter = (engine, adapterGeneration) => ({
  readAdapterGeneration: () => adapterGeneration,
  readDocument: () => {
    const document = engine.project.currentDocument
    return document
      ? { id: document.id, mutationVersion: document.mutationVersion, schema: document.exportRaw() }
      : null
  },
  readMaterials: () => ({
    version: engine.materials.version,
    entries: engine.materials.getComponentMetasMap(),
    resolveEntry: entry => entry.getMetadata(),
  }),
})

const currentRevision = provider =>
  createHostRevision({
    ...provider.readFence(),
    providerVersions: { 'dashboard.core': provider.getVersion() },
  })

const captureProject = (engine, provider) => {
  const document = requireCurrentDocument(engine)
  const projectSchema = cloneJson(engine.project.export())
  const documents = engine.project.documents
  const index = documents.findIndex(candidate => candidate.id === document.id)
  if (index < 0) throw new Error('Active document is not present in the project document list')
  const fileName = typeof document.fileName === 'string' && document.fileName ? document.fileName : document.id
  return Object.freeze({
    schemaVersion: 1,
    revision: currentRevision(provider),
    documentId: document.id,
    coreMutationVersion: document.mutationVersion,
    activeDocument: Object.freeze({ documentId: document.id, fileName, index }),
    projectSchema,
  })
}

const assertExpectedRevision = (provider, expectedRevision) => {
  const actual = currentRevision(provider)
  if (actual !== expectedRevision) throw new Error('Online artifact expectedRevision is stale')
  return actual
}

const resolveInsertionIndex = (document, parentId, position) => {
  const parent = document.getNode(parentId)
  if (!parent || parent.isPurged) throw new Error('Online artifact parent node does not exist')
  const children = parent.childrenNodes
  if (position.place === 'first') return 0
  if (position.place === 'last') return children.length
  const siblingIndex = children.findIndex(child => child.id === position.siblingId)
  if (siblingIndex < 0) throw new Error('Online artifact sibling must be a child of the selected parent')
  return position.place === 'before' ? siblingIndex : siblingIndex + 1
}

const assertDocument = (document, documentId) => {
  if (document.id !== documentId) throw new Error('Online artifact document identity is stale')
}

const assertCommittedResult = (result, nodeId) => {
  if (
    !result ||
    result.ok !== true ||
    result.commandCount !== 1 ||
    !Array.isArray(result.affectedNodeIds) ||
    !result.affectedNodeIds.includes(nodeId)
  ) {
    throw new OnlineArtifactCoreOutcomeError(
      'applied',
      'Core reported a committed observer failure without a valid transaction result',
    )
  }
}

const executeMutation = ({
  engine,
  document,
  command,
  callId,
  nodeId,
  expectedMutationVersion,
  runAgentMutation,
  isTransactionCommittedError,
  isTransactionRollbackIncompleteError,
}) => {
  try {
    return runAgentMutation(callId, () =>
      engine.transactions.runOnDocument(document, [command], { expectedMutationVersion }),
    )
  } catch (error) {
    if (isTransactionCommittedError(error)) {
      assertCommittedResult(error.result, nodeId)
      return error.result
    }
    if (isTransactionRollbackIncompleteError(error)) {
      throw new OnlineArtifactCoreOutcomeError('indeterminate', 'Core transaction rollback was incomplete', {
        cause: error,
      })
    }
    throw error
  }
}

const canonicalAgentSlot = ({ projectId, branchId, nodeId }) =>
  createFieldSlotAliases({ projectId, branchId, nodeId, root: 'extras', path: ['$agent'] })

const legacyArtifactSlots = ({ projectId, branchId, nodeId }) => [
  ...createFieldSlotAliases({ projectId, branchId, nodeId, root: 'extras', path: ['artifactRef'] }),
  ...createFieldSlotAliases({ projectId, branchId, nodeId, root: 'extras', path: ['extra', 'artifactRef'] }),
]

const createResult = ({ engine, provider, input, affectedSlotKeys }) => {
  try {
    const capture = captureProject(engine, provider)
    const node = requireCurrentDocument(engine).getNode(input.nodeId)
    if (!node || node.componentName !== GENERATED_MATERIAL_HOST_COMPONENT_NAME) {
      throw new Error('Generated material node is absent after Core commit')
    }
    const raw = node.exportRaw()
    const actualRef = readCanonicalNodeArtifactRef(raw)
    if (!actualRef || !jsonDataEqual(actualRef, input.artifactRef)) {
      throw new Error('Generated material node has an invalid canonical artifact ref')
    }
    if (Object.hasOwn(raw, 'artifactRef') || Object.hasOwn(raw.extra ?? {}, 'artifactRef')) {
      throw new Error('Generated material node retained a legacy artifact ref')
    }
    return Object.freeze({
      ...capture,
      nodeId: input.nodeId,
      componentName: GENERATED_MATERIAL_HOST_COMPONENT_NAME,
      affectedSlotKeys: Object.freeze([...new Set(affectedSlotKeys)].sort()),
    })
  } catch (error) {
    if (error instanceof OnlineArtifactCoreOutcomeError) throw error
    throw new OnlineArtifactCoreOutcomeError('applied', 'Core committed but canonical post-state capture failed', {
      cause: error,
    })
  }
}

export const createDashboardOnlineArtifactCoreAdapter = options => {
  const {
    engine,
    projectId,
    branchId,
    adapterGeneration = 1,
    runAgentMutation = (_callId, operation) => operation(),
    isTransactionCommittedError = error => error?.name === 'TransactionCommittedError' && error?.committed === true,
    isTransactionRollbackIncompleteError = error =>
      error?.name === 'TransactionRollbackIncompleteError' && error?.rollbackComplete === false,
  } = options
  if (!engine?.project || !engine?.materials || !engine?.transactions) throw new TypeError('engine is required')
  if (typeof projectId !== 'string' || !projectId || typeof branchId !== 'string' || !branchId) {
    throw new TypeError('projectId and branchId are required')
  }
  if (!Number.isSafeInteger(adapterGeneration) || adapterGeneration < 1) {
    throw new TypeError('adapterGeneration must be a positive safe integer')
  }
  if (typeof runAgentMutation !== 'function') throw new TypeError('runAgentMutation must be a function')
  const provider = createCoreProjectionProvider(createProjectionAdapter(engine, adapterGeneration))

  const prepareCreate = async input => {
    if (input.projectId !== projectId || input.branchId !== branchId) throw new Error('Online artifact scope mismatch')
    const document = requireCurrentDocument(engine)
    assertDocument(document, input.documentId)
    const baseRevision = assertExpectedRevision(provider, input.expectedRevision)
    resolveInsertionIndex(document, input.parentId, input.position)
    if (document.getNode(input.nodeId)) throw new Error('Online artifact node identity already exists')
    return Object.freeze({
      schemaVersion: 1,
      baseRevision,
      documentId: document.id,
      nodeId: input.nodeId,
      baseMutationVersion: document.mutationVersion,
      previousArtifactRef: null,
    })
  }

  const prepareRevise = async input => {
    if (input.projectId !== projectId || input.branchId !== branchId) throw new Error('Online artifact scope mismatch')
    const document = requireCurrentDocument(engine)
    const baseRevision = assertExpectedRevision(provider, input.expectedRevision)
    const node = document.getNode(input.nodeId)
    if (!node || node.isPurged || node.componentName !== GENERATED_MATERIAL_HOST_COMPONENT_NAME) {
      throw new Error('Online artifact revision requires a GeneratedMaterialHost node')
    }
    const previousArtifactRef = readCanonicalNodeArtifactRef(node.exportRaw())
    if (previousArtifactRef?.target?.kind !== 'online') {
      throw new Error('Online artifact revision requires a canonical online artifact ref')
    }
    return Object.freeze({
      schemaVersion: 1,
      baseRevision,
      documentId: document.id,
      nodeId: input.nodeId,
      baseMutationVersion: document.mutationVersion,
      previousArtifactRef,
    })
  }

  const createOnline = async input => {
    if (input.projectId !== projectId || input.branchId !== branchId) throw new Error('Online artifact scope mismatch')
    const document = requireCurrentDocument(engine)
    assertDocument(document, input.documentId)
    const at = resolveInsertionIndex(document, input.parentId, input.position)
    const node = writeCanonicalNodeArtifactRef(
      {
        componentName: GENERATED_MATERIAL_HOST_COMPONENT_NAME,
        id: input.nodeId,
        props: input.props ?? {},
        ...(input.rect ? { $dashboard: { rect: input.rect } } : {}),
      },
      input.artifactRef,
    )
    executeMutation({
      engine,
      document,
      command: { type: 'insertNode', documentId: document.id, parentId: input.parentId, node, at },
      callId: input.callId,
      nodeId: input.nodeId,
      expectedMutationVersion: input.expectedMutationVersion,
      runAgentMutation,
      isTransactionCommittedError,
      isTransactionRollbackIncompleteError,
    })
    return createResult({
      engine,
      provider,
      input,
      affectedSlotKeys: [
        ...createNodeStructuralSlotKeys({ projectId, branchId, nodeId: input.nodeId }),
        createChildrenOrderSlotKey({ projectId, branchId, parentId: input.parentId }),
        ...canonicalAgentSlot({ projectId, branchId, nodeId: input.nodeId }),
      ],
    })
  }

  const reviseOnline = async input => {
    if (input.projectId !== projectId || input.branchId !== branchId) throw new Error('Online artifact scope mismatch')
    const document = requireCurrentDocument(engine)
    assertDocument(document, input.documentId)
    const node = document.getNode(input.nodeId)
    if (!node || node.componentName !== GENERATED_MATERIAL_HOST_COMPONENT_NAME) {
      throw new Error('Online artifact revision target does not exist')
    }
    const previousArtifactRef = readCanonicalNodeArtifactRef(node.exportRaw())
    if (!jsonDataEqual(previousArtifactRef, input.previousArtifactRef)) {
      throw new Error('Online artifact revision pre-image is stale')
    }
    executeMutation({
      engine,
      document,
      command: {
        type: 'updateProps',
        documentId: document.id,
        nodeId: input.nodeId,
        extras: { $agent: { schemaVersion: 1, artifactRef: input.artifactRef } },
        unsetExtraPaths: ['artifactRef', 'extra.artifactRef'],
      },
      callId: input.callId,
      nodeId: input.nodeId,
      expectedMutationVersion: input.expectedMutationVersion,
      runAgentMutation,
      isTransactionCommittedError,
      isTransactionRollbackIncompleteError,
    })
    return createResult({
      engine,
      provider,
      input,
      affectedSlotKeys: [
        ...canonicalAgentSlot({ projectId, branchId, nodeId: input.nodeId }),
        ...legacyArtifactSlots({ projectId, branchId, nodeId: input.nodeId }),
      ],
    })
  }

  return Object.freeze({
    prepareCreate,
    prepareRevise,
    createOnline,
    reviseOnline,
    captureProject: async () => captureProject(engine, provider),
  })
}
