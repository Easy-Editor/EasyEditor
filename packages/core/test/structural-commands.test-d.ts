import { EDITOR_COMMAND_TYPES, type EditorCommand, type EditorCommandType } from '../src/instance.js'

const structuralCommands: EditorCommand[] = [
  { type: 'replace', documentId: 'document', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'insertBefore', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'insertAfter', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'wrap', nodeId: 'target', node: { componentName: 'Container', children: [] } },
  { type: 'unwrap', nodeId: 'wrapper' },
]

const runtimeTypes: readonly EditorCommandType[] = EDITOR_COMMAND_TYPES

// @ts-expect-error wrap requires a node schema.
structuralCommands.push({ type: 'wrap', nodeId: 'target' })
// @ts-expect-error unsupported command literals cannot drift into the catalog.
const unsupported: EditorCommandType = 'clone'

void runtimeTypes
void unsupported
