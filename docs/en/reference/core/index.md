# Core API

Engine is the core engine of EasyEditor, responsible for managing the entire editor's lifecycle, plugin system, event handling, and coordination of core modules. It provides a complete context management mechanism that enables effective communication and collaboration between various modules.

## Overview

```ts
import {
  init,
  materials,
  plugins,
  project,
  setters,
} from '@easy-editor/core';

// Register plugins
plugins.registerPlugins([
  DashboardPlugin(),
  DataSourcePlugin(),
]);

// Build component metadata
materials.buildComponentMetasMap(componentMetas);

// Register setters
setters.registerSetter(setterMap);

// Initialize engine
await init({
  designMode: 'design',
  appHelper: {
    utils: {
      // Custom utility functions
    },
  },
});
```

## Core Modules

### init()

Engine initialization function used to start the EasyEditor engine.

**Type:** `(options?: ConfigOptions) => Promise<void>`

**Parameters:**
- `options` - Optional configuration options

```ts
import { init } from '@easy-editor/core'

await init({
  designMode: 'design',
  appHelper: {
    utils: {
      formatDate: (date) => date.toLocaleDateString(),
    },
  },
})
```

**Configuration Options:**

- `designMode` - Design mode, possible values: `'design'` | `'preview'`
- `appHelper` - Application helper, providing utility functions and context

### plugins

Plugin management module for registering and managing plugins.

```ts
import { plugins } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'

// Register plugins
plugins.registerPlugins([
  DashboardPlugin({
    group: {
      meta: groupMeta,
      initSchema: {
        componentName: 'Group',
        title: 'Group',
        isGroup: true,
      },
    },
  }),
])
```

**Main Methods:**

- `registerPlugins(pluginList: Plugin[])` - Register plugin list

### materials

Material management module for managing component materials and metadata.

```ts
import { materials } from '@easy-editor/core'

// Build component metadata mapping
materials.buildComponentMetasMap(Object.values(componentMetaMap))

// Get component metadata
const buttonMeta = materials.getComponentMeta('Button')
```

**Main Methods:**

- `buildComponentMetasMap(metas: ComponentMetadata[])` - Build component metadata mapping
- `getComponentMeta(componentName: string)` - Get metadata for specified component
- `registerComponentMeta(meta: ComponentMetadata)` - Register single component metadata

### setters

Setter management module for managing property setters.

```ts
import { setters } from '@easy-editor/core'

// Register setters
setters.registerSetter({
  StringSetter: StringSetterComponent,
  NumberSetter: NumberSetterComponent,
  BooleanSetter: BooleanSetterComponent,
})

// Get setter
const stringSetter = setters.getSetter('StringSetter')
```

**Main Methods:**

- `registerSetter(setterMap: Record<string, Setter>)` - Register setter mapping
- `getSetter(name: string)` - Get specified setter
- `getSettersMap()` - Get all setter mappings

### project

Project management module responsible for document and resource management.

```ts
import { project } from '@easy-editor/core'

// Get designer instance
const { designer } = project

// Listen for simulator ready
project.onSimulatorReady((simulator) => {
  simulator.set('deviceStyle', {
    viewport: { width: 1920, height: 1080 }
  })

  // Load project data
  project.load(projectSchema, true)
})

// Get current document
const currentDocument = project.currentDocument

// Export project schema
const schema = project.exportSchema()
```

**Main Properties:**

- `designer` - Designer instance
- `simulator` - Simulator instance
- `currentDocument` - Current active document

**Main Methods:**

- `onSimulatorReady(callback: (simulator: Simulator) => void)` - Listen for simulator ready
- `load(schema: ProjectSchema, autoOpen?: boolean)` - Load project data
- `exportSchema()` - Export project schema
- `openDocument(doc: DocumentModel)` - Open specified document
- `removeDocument(doc: DocumentModel)` - Remove document

## Designer API

The designer is the core module for users to perform visual editing, accessed through `project.designer`.

```ts
import { project } from '@easy-editor/core'

const { designer } = project

// Listen for selection changes
designer.onEvent('selection.change', (nodeIds) => {
  console.log('Selected components:', nodeIds)
})

// Get currently selected nodes
const selectedNodes = designer.selection.selected

// Select specified node
designer.selection.select('node_id')
```

### Selection API

The selection module handles component selection and focus states.

**Main Properties:**

- `selected` - Currently selected nodes
- `first` - First selected node
- `length` - Number of selected nodes

**Main Methods:**

- `select(id: string | string[])` - Select nodes
- `remove(id: string | string[])` - Remove from selection
- `clear()` - Clear selection
- `has(id: string)` - Check if node is selected

### Document API

The document represents a complete page structure containing all component nodes.

```ts
const document = project.currentDocument

// Get root node
const rootNode = document.rootNode

// Find node by ID
const node = document.getNodeById('node_id')

// Create new node
const newNode = document.createNode({
  componentName: 'Button',
  props: { text: 'Click me' }
})

// Insert node
document.insertNode(targetNode, newNode, 0)
```

### Node API

Nodes represent individual components in the page, containing component information and property data.

```ts
// Get node properties
const props = node.props

// Set node properties
node.setProp('text', 'New text')

// Get child nodes
const children = node.children

// Insert child node
node.insertChild(childNode, 0)

// Remove child node
node.removeChild(childNode)
```

## Event System

EasyEditor provides a comprehensive event system for listening to various state changes and user interactions.

```ts
// Listen for node selection changes
designer.onEvent('selection.change', (nodeIds) => {
  console.log('Selection changed:', nodeIds)
})

// Listen for node property changes
designer.onEvent('node.prop.change', ({ node, key, newValue, oldValue }) => {
  console.log(`Property ${key} changed from ${oldValue} to ${newValue}`)
})

// Listen for document structure changes
designer.onEvent('document.change', () => {
  console.log('Document structure changed')
})
```

## Simulator API

The simulator provides page rendering and preview capabilities.

```ts
project.onSimulatorReady((simulator) => {
  // Set device type
  simulator.set('device', 'desktop')

  // Set viewport size
  simulator.set('deviceStyle', {
    viewport: { width: 1920, height: 1080 }
  })

  // Get current device info
  const device = simulator.get('device')

  // Refresh renderer
  simulator.rerender()
})
```

**Main Methods:**

- `set(key: string, value: any)` - Set simulator configuration
- `get(key: string)` - Get simulator configuration
- `rerender()` - Re-render page
- `getContentWindow()` - Get content window object
