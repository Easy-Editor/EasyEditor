# Plugin API

Plugin is the core extension mechanism of EasyEditor, used to extend editor functionality and behavior.

## Overview

```ts
interface Plugin {
  name: string;
  deps?: string[];
  eventPrefix?: string;
  extensionFingerprint?: string;
  init(ctx: PluginContext): Promise<void> | void;
  extend?(ctx: PluginExtend): Promise<void> | void;
  destroy?(ctx: PluginContext): Promise<void> | void;
  exports?(): Record<string, unknown>;
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
- Default: `common`

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

- Type: `init(ctx: PluginContext): Promise<void> | void`
- Parameters:
  - `ctx`: Plugin context that provides access to editor core modules

Plugin initialization method, called when the editor loads the plugin. When it returns a Promise, the engine waits for it to settle before initialization completes.

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    init(ctx) {
      const { logger, hotkey } = ctx;

      // Register hotkey
      const handleDuplicate = (e: KeyboardEvent) => {
        e.preventDefault();
        logger.log('Hotkey triggered');
      };
      hotkey.bind('ctrl+d', handleDuplicate);
      ctx.onDispose(() => hotkey.unbind('ctrl+d', handleDuplicate));
    }
  };
};
```

## extend

- Type: `extend(ctx: PluginExtend): Promise<void> | void`
- Parameters:
  - `ctx`: Plugin extension context that provides the ability to extend core classes

Method to extend core classes for compatibility plugins. When it returns a Promise, the engine waits for extension to complete. Prototype extension is available only to `legacyTrusted` plugins registered before initialization; `agentRestricted` rejects it.

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

- Type: `destroy(ctx: PluginContext): Promise<void> | void`
- Parameters:
  - `ctx`: Plugin context

Plugin destruction method, called when the editor unloads the plugin. When it returns a Promise, the engine waits for cleanup; failure remains part of the retryable engine-disposal flow.

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    init(ctx) {
      const dispose = ctx.event.on('common:selection-change', selectedIds => {
        ctx.logger.log('Selection changed:', selectedIds);
      });
      ctx.onDispose(dispose);
    },
    async destroy(ctx) {
      ctx.logger.log('Plugin destroyed');
    }
  };
};
```

## PluginContext

Plugin context provides engine-owned capabilities bound to the current runtime generation:

```ts
interface PluginContext {
  project: PluginProjectCapability;
  plugins: PluginRegistry;
  setters: PluginSettersCapability;
  materials: PluginMaterialsCapability;
  event: PluginEventCapability;
  pluginEvent: EventBus;
  hotkey: PluginHotkeyCapability;
  clipboard?: PluginClipboardCapability;
  config: PluginConfigCapability;
  logger: PluginLoggerCapability;
  trustPolicy?: TrustPolicy;
  onDispose(disposer: Disposable): Disposable;
}
```

Under the default `agentRestricted` policy these roots are finite facades, not raw service objects:

- they omit `engine.init()` / `engine.destroy()` and known reverse-authority fields;
- `plugins` is a readonly `PluginRegistry` and cannot register or delete peers;
- `event` is the prefix-scoped shared-engine event capability, while `pluginEvent` is a plugin-private event bus and does not expose the shared engine's raw event bus;
- Context and callback values are generation-bound, so retained references are revoked after disposal; and
- the facades narrow the supported API, inputs, and model-mutation authority; they are not a malicious-code sandbox.

Plugins and `RemoteAdapter` implementations execute in the host JavaScript realm and must be treated as trusted extension code. Plugin lifecycle hooks must not call the same engine's `init()` or `destroy()`; direct synchronous re-entry throws `LifecycleReentrancyError`. If a plugin captures a raw engine and issues such a call after an `await`, a same-realm kernel cannot reliably attribute that call without AsyncContext-like causal tracking or Realm/process isolation. That behavior violates the host-extension protocol.

A compatibility plugin that still needs raw host services such as `Project`, `Designer`, or `Simulator` must call `assertLegacyTrustedPluginContext(ctx)` in `init()`, and its host must select `legacyTrusted`. The assertion only verifies the explicit policy; it cannot widen an `agentRestricted` Context. New plugins should not depend on this interface.

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
  Materials: typeof Materials;
  Setters: typeof Setters;
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
