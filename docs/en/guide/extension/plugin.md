---
title: Plugin Extension
description: Developing custom plugins for EasyEditor
---

# Plugin Extension

Plugins are the functionality extension mechanism of EasyEditor. Through plugins, you can extend editor functionality and enhance core capabilities. This guide will help you understand how to develop and integrate custom plugins.

## Overview

Plugins are extension units of EasyEditor, used to enhance editor functionality. Plugins can:

- Add new features and material components
- Extend methods and properties of existing classes
- Listen to and respond to editor events
- Collaborate and communicate with other plugins
- Integrate third-party libraries and services

EasyEditor adopts a "microkernel + plugin" architecture design, where most functionality is implemented through plugins, making the editor very flexible and extensible.

## Lifecycle

Plugins follow the following lifecycle:

1. **Registration Phase**: Plugin registers with the editor, setting basic information like plugin name and dependencies
2. **Extension Phase**: If an `extend` method exists, call it to extend core classes
3. **Initialization Phase**: Call the plugin's `init` method, set up event listeners, initialize resources
4. **Runtime Phase**: Plugin operates normally, responds to events, provides functionality
5. **Destruction Phase**: Call the plugin's `destroy` method, clean up resources, remove event listeners

The editor ensures plugins are initialized in the correct dependency order and destroys plugins at appropriate times.

## Directory Structure

A complete plugin typically contains the following file structure:

```bash
my-plugin/
├── index.ts               # Plugin entry
└── types.ts               # Type definitions
```

The simplest plugin can have just one entry file.

## Usage

### Basic Plugin

Most basic plugin example:

```ts
import type { PluginCreator } from '@easy-editor/core'

// Plugin factory function, can accept configuration parameters
const MyPlugin: PluginCreator<Option> = (options = {}) => {
  // Return plugin definition
  return {
    name: 'MyPlugin',              // Plugin name, must be unique
    deps: [],                      // Dependencies on other plugins
    init(ctx) {                    // Initialization method
      ctx.logger.info('MyPlugin initialized')

      // Register global variables, accessible by other plugins
      ctx.set('myPluginData', {
        version: '1.0.0',
        ...options
      })

      // Register event listeners
      ctx.event.on('document.open', (doc) => {
        ctx.logger.info('Document opened:', doc.id)
      })
    },
    destroy(ctx) {                 // Destruction method
      ctx.logger.info('MyPlugin destroyed')

      // Remove event listeners to avoid memory leaks
      ctx.event.off('document.open')
    }
  }
}

export default MyPlugin
```

### Event Handling Plugin

Plugin example that handles editor events:

```ts
import { type PluginCreator, DESIGNER_EVENT } from '@easy-editor/core'

const EventHandlerPlugin: PluginCreator = () => {
  return {
    name: 'EventHandlerPlugin',
    deps: [],
    init(ctx) {
      const { designer } = ctx

      // Listen to component selection events
      designer.onEvent(DESIGNER_EVENT.SELECTION_CHANGE, (nodeIds) => {
        const node = designer.currentDocument?.getNode(nodeIds[0])
        if (node) {
          ctx.logger.info('Selected component:', node.componentName)
        }
      })

      // Listen to property change events
      designer.onEvent(DESIGNER_EVENT.NODE_PROPS_CHANGE, ({ node, prop, newvalue }) => {
        ctx.logger.info(`Property ${prop} of ${node.id} changed to:`, newvalue)
      })

      // Listen to drag events
      designer.onEvent(DESIGNER_EVENT.DRAG_END, (e) => {
        ctx.logger.info('Component dropped:', e)
      })
    }
  }
}

export default EventHandlerPlugin
```

### Functionality Extension Plugin

Plugin example that extends editor core classes:

```ts
import type { Plugin } from '@easy-editor/core'

const ExtendPlugin = (): Plugin => {
  return {
    name: 'ExtendPlugin',
    deps: [],
    init(ctx) {
      ctx.logger.info('ExtendPlugin initialized')
    },
    // Extend core classes
    extend({ extendClass, extend }) {
      const { Node, Document } = extendClass

      // Extend Node class
      extend('Node', {
        // Add custom method
        duplicate: {
          value(this: Node) {
            const parent = this.parent
            if (!parent) return null

            const index = parent.children.indexOf(this)
            const schema = this.export()

            // Create duplicate
            return parent.document.createNode({
              ...schema,
              id: undefined,  // Let system generate new ID
              props: {
                ...schema.props,
                label: `${schema.props?.label || 'Component'} Copy`
              }
            }, parent, { index: index + 1 })
          }
        },
        // Add custom property
        isContainer: {
          get(this: Node) {
            // Check if node is container type
            return this.componentMeta?.configure?.component?.isContainer || false
          }
        }
      })
    }
  }
}

export default ExtendPlugin
```

### Registering Plugins

Register plugins when initializing the engine:

```ts
import {
  init,
  plugins,
} from '@easy-editor/core'
import MyPlugin from './plugins/my-plugin'
import EventHandlerPlugin from './plugins/event-handler-plugin'
import ExtendPlugin from './plugins/extend-plugin'

// Register plugins
plugins.registerPlugins([
  MyPlugin({ debug: true }),
  EventHandlerPlugin(),
  ExtendPlugin()
])

// Initialize engine
await init({
  designMode: 'design',
})

// Can also dynamically register plugins after initialization
plugins.registerPlugins([
  MyNewPlugin()
])
```

## Communication Patterns

Plugins can communicate with each other in the following ways:

### Event Communication

Communicate through the editor's event system:

```ts
// Plugin A
init(ctx) {
  // Trigger custom event
  ctx.event.emit('pluginA.dataChanged', { someData: 'value' })
}

// Plugin B
init(ctx) {
  // Listen to Plugin A's event
  ctx.event.on('pluginA.dataChanged', (data) => {
    console.log('Received data from Plugin A:', data)
  })
}
```

### Shared Context

Share data and methods through plugin context:

```ts
// Plugin A
init(ctx) {
  // Register shared service
  ctx.set('dataService', {
    getData: () => ({ value: 42 }),
    setData: (data) => console.log('Data set:', data)
  })
}

// Plugin B
init(ctx) {
  // Get service registered by Plugin A
  const dataService = ctx.get('dataService')
  if (dataService) {
    const data = dataService.getData()
    console.log('Got data:', data)
    dataService.setData({ newValue: 100 })
  }
}
```

### Accessing Extended Methods

Communicate through extended methods:

```ts
// Plugin A extended Node class
extend({ extend }) {
  extend('Node', {
    pluginAMethod: {
      value(this: Node, param: string) {
        return `Plugin A method: ${param}`
      }
    }
  })
}

// Plugin B uses Plugin A's extended method
init(ctx) {
  ctx.event.on('node.select', (nodeId) => {
    const node = ctx.designer.currentDocument?.getNode(nodeId)
    if (node && typeof node['pluginAMethod'] === 'function') {
      const result = node['pluginAMethod']('test')
      console.log(result)  // Output: "Plugin A method: test"
    }
  })
}
```

## Configuration Options

### Core Properties

#### `name` (Required)

Defines the unique name of the plugin, used for identifying the plugin and handling dependencies.

```ts
{
  name: 'MyPlugin'
}
```

#### `deps` (Optional)

Defines the list of other plugins this plugin depends on. EasyEditor ensures dependent plugins are loaded and initialized before the current plugin.

```ts
{
  deps: ['CorePlugin', 'UIPlugin']  // Depends on CorePlugin and UIPlugin
}
```

#### `eventPrefix` (Optional)

Defines the event prefix for the plugin, used to distinguish events from different plugins. If not set, 'common' is used as the prefix.

```ts
{
  eventPrefix: 'my-plugin'  // Event names become 'my-plugin.eventName'
}
```

### Core Methods

#### `init` (Required)

Plugin initialization method, executed when the editor starts. Can be synchronous or asynchronous.

```ts
{
  init(ctx) {
    // Initialization logic
    ctx.logger.info('Plugin initialized')

    // Subscribe to events
    ctx.event.on('document.open', (doc) => {
      // Handle event
    })

    // Async initialization example
    // return new Promise((resolve) => {
    //   setTimeout(() => {
    //     // Async operation completed
    //     resolve()
    //   }, 1000)
    // })
  }
}
```

#### `destroy` (Optional)

Plugin destruction method, executed when the plugin is removed, used for resource cleanup.

```ts
{
  destroy(ctx) {
    // Clean up resources
    ctx.logger.info('Plugin destroyed')

    // Unsubscribe from events
    ctx.event.off('document.open')

    // Clear timers
    clearInterval(this.timer)

    // Destroy DOM elements
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element)
    }
  }
}
```

#### `extend` (Optional)

Method for extending editor core classes, can add new methods or properties, modify existing behavior.

```ts
{
  extend({ extendClass, extend }) {
    const { Node, Document } = extendClass

    // Extend Node class
    extend('Node', {
      // Add method
      customMethod: {
        value(this: Node, param: string) {
          return `Custom method with param: ${param}`
        }
      },

      // Add property
      customProperty: {
        get(this: Node) {
          return this.getExtraPropValue('customProp')
        },
        set(this: Node, value) {
          this.setExtraPropValue('customProp', value)
        }
      }
    })

    // Extend Document class
    extend('Document', {
      // Add method
      customDocumentMethod: {
        value(this: Document) {
          return 'Custom document method'
        }
      }
    })
  }
}
```

## Context

The plugin context `ctx` is an object containing editor core functionality, providing the ability to access and manipulate various parts of the editor. It mainly includes:

### Core Module Access

```ts
// Get editor instance
const editor = ctx.editor
// Get designer instance
const designer = ctx.designer
// Get project management instance
const project = ctx.project
// Get simulator instance
const simulator = ctx.simulator
// Get setter manager instance
const setterManager = ctx.setterManager
// Get component metadata manager instance
const componentMetaManager = ctx.componentMetaManager
// Get hotkey management
const hotkey = ctx.hotkey
```

### Logging System

```ts
// Record logs
ctx.logger.debug('Debug message')
ctx.logger.info('Info message')
ctx.logger.warn('Warning message')
ctx.logger.error('Error message')
```

### Event System

The plugin context provides two event systems: global event system `event` and plugin-specific event system `pluginEvent`.

```ts
// Global event system
// Subscribe to events
ctx.event.on('eventName', (data) => {
  // Handle event
})

// Unsubscribe from events
ctx.event.off('eventName')

// Trigger events
ctx.event.emit('eventName', eventData)

// Plugin-specific event system
// Use plugin name as event prefix
ctx.pluginEvent.emit('dataChanged', { value: 100 })
ctx.pluginEvent.on('dataChanged', (data) => {
  console.log('Plugin event received:', data)
})
```

### Data Sharing

```ts
// Store shared data
ctx.set('key', value)

// Get shared data
const value = ctx.get('key')

// Delete shared data
ctx.delete('key')
```

## Core Class Extension

The `extend` method allows you to extend the following core classes:

### Designer Related Classes

- **Designer**: Main designer class
- **Dragon**: Drag management
- **Detecting**: Detection management
- **Selection**: Selection management
- **DropLocation**: Drop location
- **OffsetObserver**: Offset observer

### Simulator Related Classes

- **Simulator**: Main simulator class
- **Viewport**: Viewport management

### Project Related Classes

- **Project**: Project management
- **Document**: Document management
- **History**: History records
- **Node**: Node
- **NodeChildren**: Node children
- **Props**: Property collection
- **Prop**: Single property

### Component Related Classes

- **ComponentMetaManager**: Component metadata manager
- **SetterManager**: Setter manager
- **ComponentMeta**: Component metadata

## Type Extension

Utilize the type extension mechanism with `declare` to extend and customize core type definitions. Here's an example showing how to extend the NodeSchema interface:

```ts
declare module '@easy-editor/core' {
  interface NodeSchema {
    /**
     * Whether it's a root node
     */
    isRoot?: boolean

    /**
     * Whether it's a group
     */
    isGroup?: boolean

    /**
     * Dashboard additional information
     */
    $dashboard?: {
      /**
       * Position information
       */
      rect?: DashboardRect
    }
  }
}
```

## Registration Options

When registering plugins, you can provide additional options:

### `autoInit` (Optional)

Whether to auto-initialize the plugin. If set to `true`, the plugin will be initialized immediately after registration, without waiting for the plugin manager to uniformly initialize all plugins.

```ts
// Register and immediately initialize plugin
await pluginManager.register(MyPlugin(), { autoInit: true })
```

### `override` (Optional)

Whether to allow overriding plugins with the same name. If set to `true`, when the registered plugin has the same name as an existing plugin, the existing plugin will be destroyed first, then the new plugin will be registered.

```ts
// Register and override plugin with same name
await pluginManager.register(MyPlugin(), { override: true })
```
