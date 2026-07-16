import { EDITOR_COMMAND_TYPES, type EditorCommand, type EditorCommandType } from '../src/instance.js'

const structuralCommands: EditorCommand[] = [
  { type: 'replace', documentId: 'document', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'insertBefore', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'insertAfter', nodeId: 'target', node: { componentName: 'Text' } },
  { type: 'wrap', nodeId: 'target', node: { componentName: 'Container', children: [] } },
  { type: 'unwrap', nodeId: 'wrapper' },
  {
    type: 'updateProps',
    nodeId: 'target',
    unsetPropPaths: ['style.color'],
    unsetExtraPaths: ['$dashboard.rect.x'],
  },
]

const runtimeTypes: readonly EditorCommandType[] = EDITOR_COMMAND_TYPES

// @ts-expect-error wrap requires a node schema.
structuralCommands.push({ type: 'wrap', nodeId: 'target' })
// @ts-expect-error unsupported command literals cannot drift into the catalog.
const unsupported: EditorCommandType = 'clone'
// @ts-expect-error unsetPropPaths is an explicit path list, not a sentinel value.
structuralCommands.push({ type: 'updateProps', nodeId: 'target', unsetPropPaths: null })

void runtimeTypes
void unsupported
