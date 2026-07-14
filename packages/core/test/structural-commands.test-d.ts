import type { AgentCommandType, AgentEditorCommand } from '../src/agent.js'
import { EDITOR_COMMAND_TYPES, type EditorCommand, type EditorCommandType } from '../src/instance.js'

const structuralCommands: EditorCommand[] = [
  { type: 'replace', documentId: 'document', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'insertBefore', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'insertAfter', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'wrap', nodeId: 'target', node: { componentName: 'Container', children: [] } },
  { type: 'unwrap', nodeId: 'wrapper' },
]

const agentStructuralCommands: AgentEditorCommand[] = [
  { type: 'replace', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'insertBefore', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'insertAfter', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'wrap', nodeId: 'target', node: { componentName: 'Container', children: [] } },
  { type: 'unwrap', nodeId: 'wrapper' },
]

const runtimeTypes: readonly EditorCommandType[] = EDITOR_COMMAND_TYPES
const agentTypes: readonly AgentCommandType[] = runtimeTypes

// @ts-expect-error Agent commands cannot select a document outside their capability.
agentStructuralCommands.push({ type: 'unwrap', documentId: 'foreign', nodeId: 'wrapper' })
// @ts-expect-error wrap requires a node schema.
structuralCommands.push({ type: 'wrap', nodeId: 'target' })
// @ts-expect-error unsupported command literals cannot drift into the catalog.
const unsupported: EditorCommandType = 'clone'

void agentTypes
void unsupported
