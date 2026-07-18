import { createScreenApplyChangeSetHandler } from './apply.mjs'
import { DEFAULT_SCREEN_CHANGESET_LIMITS, cloneJsonValue, compareCodeUnits, freezeDto } from './contract.mjs'
import { compileScreenChangeSet } from './index.mjs'

const fail = reason => {
  throw new TypeError(`Dashboard screen runtime adapter: ${reason}`)
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
  return method
}

const requireNonEmptyString = (value, path) => {
  if (typeof value !== 'string' || value.length === 0) return fail(`${path} must be a non-empty string`)
  return value
}

const requireNonNegativeInteger = (value, path) => {
  if (!Number.isSafeInteger(value) || value < 0) return fail(`${path} must be a non-negative safe integer`)
  return value
}

const optionalOwnDataValue = (value, key, path) => {
  let descriptor
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(`${path}.${String(key)} could not be inspected`)
  }
  if (!descriptor) return undefined
  if (!('value' in descriptor)) return fail(`${path}.${String(key)} must be a data property`)
  return descriptor.value
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

const cloneJson = (value, path) => freezeDto(cloneJsonValue(value, path, DEFAULT_SCREEN_CHANGESET_LIMITS))

const sameStrings = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index])

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
  const schema = cloneJson(exportRaw.call(document), 'engine.project.currentDocument.exportRaw()')
  const currentDocument = engine.project.currentDocument
  if (!currentDocument || currentDocument.id !== id || currentDocument.mutationVersion !== mutationVersion) {
    return fail('current document changed while it was being captured')
  }
  // The Core document is an opaque authority-bearing handle. Never clone,
  // enumerate, or recursively freeze it as part of the serializable DTO.
  return Object.freeze({ documentHandle: document, document: freezeDto({ id, mutationVersion, schema }) })
}

const registeredMaterialNames = engine => {
  const entries = engine.materials.getComponentMetasMap()
  if (!(entries instanceof Map)) return fail('engine.materials.getComponentMetasMap() must return a Map')
  const names = [...entries.keys()]
  for (const name of names) requireNonEmptyString(name, 'registered material componentName')
  return names.sort(compareCodeUnits)
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
  const currentVersion = requireRegistryVersion(engine.materials.version)
  const currentNames = registeredMaterialNames(engine)
  if (!Object.is(currentVersion, materialRegistryVersion) || !sameStrings(currentNames, componentNames)) {
    return fail('material registry changed while manifests were being captured')
  }
  return freezeDto({ materialRegistryVersion, manifests: freezeDto(manifests) })
}

const compileReadyScreenChangeSet = input =>
  compileScreenChangeSet({
    ...input,
    manifests: input.manifests.filter(manifest => manifest.readiness?.status === 'ready'),
  })

const createFence = ({ snapshot, activityGeneration, document, manifestCapture }) =>
  cloneJson(
    {
      schemaVersion: 1,
      snapshot: {
        revision: snapshot.revision,
        providerGenerations: snapshot.providerGenerations,
      },
      activityGeneration,
      document: { id: document.id, mutationVersion: document.mutationVersion },
      materialRegistry: {
        version: manifestCapture.materialRegistryVersion,
        manifests: manifestCapture.manifests,
      },
    },
    'screenApply.runtimeFence',
  )

const capturePrepareState = async ({ engine, manifestCache, snapshot, activityLease }) => {
  const manifestCapture = await captureManifests(engine, manifestCache)
  const documentCapture = captureDocument(engine)
  const activityGeneration = requireNonNegativeInteger(activityLease.generation, 'activityLease.generation')
  // Keep the opaque Core handle outside recursive DTO freezing.
  return Object.freeze({
    ...documentCapture,
    ...manifestCapture,
    fence: createFence({
      snapshot,
      activityGeneration,
      document: documentCapture.document,
      manifestCapture,
    }),
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
  const matchingIndexes = []
  for (let index = 0; index < documents.length; index += 1) {
    if (documents[index]?.id === documentId) matchingIndexes.push(index)
  }
  if (matchingIndexes.length !== 1) {
    return fail('current document id must appear exactly once in engine.project.documents')
  }
  const [index] = matchingIndexes
  const fileName = requireNonEmptyString(document.fileName, 'engine.project.currentDocument.fileName')
  const currentDocument = engine.project.currentDocument
  if (!currentDocument || currentDocument.id !== documentId || currentDocument.mutationVersion !== mutationVersion) {
    return fail('current document changed while the project was being captured')
  }
  return freezeDto({
    activeDocument: freezeDto({ documentId, fileName, index }),
    projectSchema,
  })
}

export const createDashboardScreenApplyChangeSetHandler = options => {
  const input = requireObject(options, 'options')
  const engine = requireObject(input.engine, 'options.engine')
  requireObject(engine.project, 'options.engine.project')
  requireMethod(engine.project, 'export', 'options.engine.project')
  requireObject(engine.materials, 'options.engine.materials')
  requireMethod(engine.materials, 'getComponentMetasMap', 'options.engine.materials')
  requireObject(engine.transactions, 'options.engine.transactions')
  requireMethod(engine.transactions, 'runOnDocument', 'options.engine.transactions')
  const manifestCache = requireObject(input.manifestCache, 'options.manifestCache')
  requireMethod(manifestCache, 'get', 'options.manifestCache')
  const captureFullSnapshot = requireMethod(input, 'captureFullSnapshot', 'options')
  const isTransactionCommittedError = requireMethod(input, 'isTransactionCommittedError', 'options')
  const isTransactionRollbackIncompleteError = requireMethod(input, 'isTransactionRollbackIncompleteError', 'options')
  const admitMaterialRefsUnderSharedMutation = optionalOwnDataValue(
    input,
    'admitMaterialRefsUnderSharedMutation',
    'options',
  )
  const runAgentMutation =
    typeof input.persistence?.runAgentMutation === 'function'
      ? input.persistence.runAgentMutation.bind(input.persistence)
      : (_callId, operation) => operation()

  const captureSnapshot = () => captureSnapshotFence(captureFullSnapshot)

  return createScreenApplyChangeSetHandler({
    authority: input.authority,
    activityLease: input.activityLease,
    persistence: input.persistence,
    ...(admitMaterialRefsUnderSharedMutation === undefined ? {} : { admitMaterialRefsUnderSharedMutation }),
    captureFullSnapshot: captureSnapshot,
    capturePrepareContext: async ({ snapshot }) => {
      const normalizedSnapshot = freezeDto({
        revision: requireNonEmptyString(snapshot.revision, 'snapshot.revision'),
        providerGenerations: cloneJson(snapshot.providerGenerations, 'snapshot.providerGenerations'),
      })
      return capturePrepareState({
        engine,
        manifestCache,
        snapshot: normalizedSnapshot,
        activityLease: input.activityLease,
      })
    },
    captureCurrentFence: async () => {
      const snapshot = await captureSnapshot()
      const current = await capturePrepareState({ engine, manifestCache, snapshot, activityLease: input.activityLease })
      return current.fence
    },
    captureDocumentState: handle => {
      const boundId = requireNonEmptyString(handle?.id, 'bound document.id')
      const currentDocument = engine.project.currentDocument
      if (!currentDocument || currentDocument.id !== boundId) return fail('bound document is no longer current')
      const captured = captureDocument(engine)
      if (captured.document.id !== boundId) return fail('bound document identity changed')
      return captured.document
    },
    captureProject: () => captureProject(engine),
    // Keep every captured manifest in the runtime fence, but expose only ready
    // manifests to the pure compiler and its semantic fingerprints. A targeted
    // not-ready material is therefore absent and fails closed as UNKNOWN_MATERIAL.
    compileChangeSet: compileReadyScreenChangeSet,
    hashCanonicalJson: input.hashCanonicalJson,
    runOnDocument: (handle, commands, transactionOptions) => {
      const { agentCallId, ...coreOptions } = transactionOptions
      return runAgentMutation(agentCallId, () => engine.transactions.runOnDocument(handle, commands, coreOptions))
    },
    isTransactionCommittedError,
    isTransactionRollbackIncompleteError,
    now: input.now,
  })
}
