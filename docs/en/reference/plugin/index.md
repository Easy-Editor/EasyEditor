# Plugin API

Plugin is the core extension mechanism of EasyEditor, used to extend editor functionality and behavior.

## Overview

```ts
interface Plugin {
  name: string;
  deps?: string[];
  eventPrefix?: string;
  init(ctx: PluginContext): void | void;
  extend?(ctx: PluginExtend): void;
  destroy?(ctx: PluginContext): void | void;
}
```

## name

- Type: `string`

Unique name identifier for the plugin

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin'
    // ...
  };
};
```

## deps

- Type: `string[]`

Names of other plugins that this plugin depends on

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    deps: ['OtherPlugin'] // Declare dependency, OtherPlugin will be loaded first
    // ...
  };
};
```

## eventPrefix

- Type: `string`
- Default: Plugin's `name`

Plugin event prefix for plugin event namespace

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    eventPrefix: 'myPrefix'
    // ...
  };
};
```

## init

- Type: `init(ctx: PluginContext): void`
- Parameters:
  - `ctx`: Plugin context that provides access to editor core modules

Plugin initialization method, called when the editor loads the plugin

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    init(ctx) {
      const { designer, logger, hotkey } = ctx;

      // Register hotkey
      hotkey.bind('ctrl+d', e => {
        e.preventDefault();
        logger.log('Hotkey triggered');
      });

      // Listen to designer events
      designer.on(DESIGNER_EVENT.SELECTION_CHANGE, selectedIds => {
        logger.log('Selection changed:', selectedIds);
      });
    }
  };
};
```

## extend

- Type: `extend(ctx: PluginExtend): void`
- Parameters:
  - `ctx`: Plugin extension context that provides the ability to extend core classes

Method to extend core classes, allowing plugins to extend functionality of editor core modules

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    extend({ extend }) {
      // Extend Designer class
      extend('Designer', {
        // Add new method
        selectParent: {
          value() {
            const selected = this.getSelected();
            if (selected.length > 0) {
              const node = this.project.getCurrentDocument().getNode(selected[0]);
              const parent = node?.getParent();
              if (parent && parent.getId() !== 'root') {
                this.select(parent.getId());
              }
            }
          }
        }
      });
    }
  };
};
```

## destroy

- Type: `destroy(ctx: PluginContext): void`
- Parameters:
  - `ctx`: Plugin context

Plugin destruction method, called when the editor unloads the plugin, used for cleaning up resources

```ts
const MyPlugin: PluginCreator<Options> = () => {
  const disposers = [];

  return {
    name: 'MyPlugin',
    init(ctx) {
      const { designer } = ctx;

      // Store listeners that need cleanup
      disposers.push(
        designer.on(DESIGNER_EVENT.SELECTION_CHANGE, () => {})
      );
    },
    destroy(ctx) {
      // Clean up resources
      disposers.forEach(dispose => dispose());

      ctx.logger.log('Plugin destroyed');
    }
  };
};
```

## PluginContext

Plugin context provides access to editor core modules:

```ts
interface PluginContext {
  editor: Editor;
  designer: Designer;
  project: Project;
  simulator: Simulator;
  setterManager: SetterManager;
  componentMetaManager: ComponentMetaManager;
  event: EventBus;
  pluginEvent: EventBus;
  hotkey: Hotkey;
  logger: Logger;
}
```

## PluginExtend

Plugin extension interface for extending core class functionality:

```ts
interface PluginExtend {
  extendClass: PluginExtendClass;
  extend: <T extends keyof PluginExtendClass>(
    extendClass: T,
    properties: Record<PropertyKey, () => any> | (PropertyDescriptorMap & ThisType<InstanceType<PluginExtendClass[T]>>)
  ) => void;
}
```

## PluginExtendClass

List of core classes that can be extended:

```ts
interface PluginExtendClass {
  Simulator: typeof Simulator;
  Viewport: typeof Viewport;
  Designer: typeof Designer;
  Dragon: typeof Dragon;
  Detecting: typeof Detecting;
  Selection: typeof Selection;
  DropLocation: typeof DropLocation;
  OffsetObserver: typeof OffsetObserver;
  Project: typeof Project;
  Document: typeof Document;
  History: typeof History;
  Node: typeof Node;
  NodeChildren: typeof NodeChildren;
  Props: typeof Props;
  Prop: typeof Prop;
  ComponentMetaManager: typeof ComponentMetaManager;
  SetterManager: typeof SetterManager;
  ComponentMeta: typeof ComponentMeta;
}
```

## PluginCreator

- Type: `<O = any>(options?: O) => Plugin`

Function type for creating plugins

```ts
import type { PluginCreator } from '@easy-editor/core';

interface MyPluginOptions {
  option1?: string;
}

const MyPlugin: PluginCreator<MyPluginOptions> = (options = {}) => {
  return {
    name: 'MyPlugin',
    init(ctx) {
      console.log(options.option1);
    }
  };
};

export default MyPlugin;
```
