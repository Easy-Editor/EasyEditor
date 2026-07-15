import { defaultEngine } from '../src/index.js'
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type EditorCommand,
  type EngineInstance,
  PolicyViolation,
  type SchemaPreparationResult,
  SchemaValidationError,
  SchemaValidator,
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

engine.commands.execute(command)
engine.transactions.run([command])
engine.transactions.runOnDocument('document-id', [extrasOnlyCommand], document => {
  void document.id
})

const currentSchemaVersion: '1.0.0' = CURRENT_PROJECT_SCHEMA_VERSION
const schemaPreparation: SchemaPreparationResult = new SchemaValidator(
  resolveTrustPolicy('legacyTrusted'),
).prepareWithReport({ version: currentSchemaVersion, componentsTree: [] })
const migrated: boolean = schemaPreparation.report.migrated
void migrated
void defaultEngine
void PolicyViolation
void SchemaValidationError
