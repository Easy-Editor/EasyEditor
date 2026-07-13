import {
  type EditorCommand,
  type EngineInstance,
  PolicyViolation,
  SchemaValidationError,
  createEngine,
  defaultEngine,
} from '../src/index.js'

const engine: EngineInstance = createEngine()
const command: EditorCommand = {
  type: 'updateProps',
  nodeId: 'node-id',
  props: { title: 'typed' },
}

engine.commands.execute(command)
engine.transactions.run([command])
void defaultEngine
void PolicyViolation
void SchemaValidationError
