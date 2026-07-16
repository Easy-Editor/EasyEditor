import { defaultEngine } from '../src/index.js'
import {
  type BoundTransactionOptions,
  CURRENT_PROJECT_SCHEMA_VERSION,
  DocumentMutationVersionConflictError,
  type EditorCommand,
  type EngineInstance,
  InvalidDocumentMutationVersionError,
  PolicyViolation,
  type SchemaPreparationResult,
  SchemaValidationError,
  SchemaValidator,
  type UpdatePropsCommand,
  createEngine,
  resolveTrustPolicy,
} from '../src/instance.js'

const engine: EngineInstance = createEngine()
engine.loadProject({ version: '0.0.1', componentsMap: [], componentsTree: [] }, true)
engine.unloadProject()
engine.undo()
engine.undo('document-id')
engine.redo(engine.project.currentDocument)

const command: EditorCommand = {
  type: 'updateProps',
  nodeId: 'node-id',
  props: { title: 'typed' },
}
const extrasOnlyCommand: EditorCommand = {
  type: 'updateProps',
  nodeId: 'node-id',
  extras: { $dashboard: { layout: 'grid' } },
}
const unsetCommand: UpdatePropsCommand = {
  type: 'updateProps',
  nodeId: 'node-id',
  unsetPropPaths: ['style.color'],
  unsetExtraPaths: ['$dashboard.rect.x'],
}
const guardedOptions: BoundTransactionOptions = { expectedMutationVersion: 0 }

engine.commands.execute(command)
engine.commands.execute(unsetCommand)
engine.transactions.run([command])
engine.transactions.runOnDocument('document-id', [extrasOnlyCommand], guardedOptions)

const mutationConflict = new DocumentMutationVersionConflictError('document-id', 1, 2)
const invalidMutationVersion = new InvalidDocumentMutationVersionError(null, 'must-be-a-non-negative-safe-integer')
const invalidCombinedGuard = new InvalidDocumentMutationVersionError(0, 'cannot-combine-with-executable-condition')

// @ts-expect-error expectedMutationVersion is declarative numeric data, not null
const invalidGuard: BoundTransactionOptions = { expectedMutationVersion: null }
// @ts-expect-error unset paths are a readonly string array, not a deletion sentinel
const invalidUnset: UpdatePropsCommand = { type: 'updateProps', nodeId: 'node-id', unsetPropPaths: null }

const currentSchemaVersion: '1.0.0' = CURRENT_PROJECT_SCHEMA_VERSION
const schemaPreparation: SchemaPreparationResult = new SchemaValidator(
  resolveTrustPolicy('legacyTrusted'),
).prepareWithReport({ version: currentSchemaVersion, componentsTree: [] })
const migrated: boolean = schemaPreparation.report.migrated
void migrated
void defaultEngine
void PolicyViolation
void SchemaValidationError
void mutationConflict
void invalidMutationVersion
void invalidCombinedGuard
void invalidGuard
void invalidUnset
