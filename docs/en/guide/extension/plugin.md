---
title: Plugin Extension
description: Developing trusted, lifecycle-bound plugins for EasyEditor
---

# Plugin Extension

Plugins are EasyEditor's host-extension mechanism. A stable host creates an engine from `@easy-editor/core/instance` and registers plugins through the finite `PluginManager`; a plugin definition never receives `PluginRuntime`, engine lifecycle orchestration, or the manager's internal registries.

## Lifecycle

A plugin participates in the engine lifecycle in this order:

1. **Register**: validate its unique name, dependencies, and registration options.
2. **Extend**: apply compatibility prototype extensions before initialization when `extend` is present.
3. **Initialize**: call `init(ctx)` and await a returned Promise.
4. **Run**: operate through Context capabilities bound to the current generation.
5. **Destroy**: call and await `destroy(ctx)`, then run Context disposers.

```ts
interface Plugin {
  name: string
  deps?: string[]
  eventPrefix?: string
  extensionFingerprint?: string
  init(ctx: PluginContext): Promise<void> | void
  extend?(ctx: PluginExtend): Promise<void> | void
  destroy?(ctx: PluginContext): Promise<void> | void
  exports?(): Record<string, unknown>
}
```

Plugin lifecycle hooks must not call the same engine's `init()` or `destroy()`. Direct synchronous re-entry throws `LifecycleReentrancyError`; a restricted PluginContext does not expose either method.

A plugin must also not capture a raw engine reference and issue a lifecycle call after a lifecycle hook suspends. Without AsyncContext-like causal tracking or Realm/process isolation, same-realm JavaScript cannot reliably distinguish that call from an external host call. This is an extension-protocol rule, not a sandbox guarantee.

## Basic plugin

```ts
import type { PluginCreator } from '@easy-editor/core/instance'

interface Options {
  debug?: boolean
}

const MyPlugin: PluginCreator<Options> = (options = {}) => ({
  name: 'MyPlugin',
  eventPrefix: 'my-plugin',

  init(ctx) {
    if (options.debug) ctx.logger.info('MyPlugin initialized')

    const disposeEvent = ctx.event.on('common:document-open', documentId => {
      ctx.logger.info('Document opened:', documentId)
    })
    ctx.onDispose(disposeEvent)

    const handleDuplicate = (event: KeyboardEvent) => {
      event.preventDefault()
      ctx.event.emit('shortcut', { command: 'duplicate' })
    }
    ctx.hotkey.bind('ctrl+d', handleDuplicate)
    ctx.onDispose(() => ctx.hotkey.unbind('ctrl+d', handleDuplicate))
  },

  async destroy(ctx) {
    ctx.logger.info('MyPlugin destroyed')
  },
})

export default MyPlugin
```

Prefer `ctx.onDispose()` for listeners, hotkeys, timers, and other resource cleanup. The engine owns Context disposal even when the plugin does not define `destroy`.

## Register plugins

```ts
import { createEngine } from '@easy-editor/core/instance'
import MyPlugin from './my-plugin'

const engine = createEngine({
  trustPolicy: 'agentRestricted',
  hostWindow: window,
})

await engine.plugins.register(MyPlugin({ debug: true }))
await engine.init({ designMode: 'design' })

// An ordinary plugin registered after readiness needs explicit autoInit.
await engine.plugins.register(AnotherPlugin(), { autoInit: true })
```

Registration and deletion are asynchronous and must be awaited:

- `register(plugin, { autoInit?, override? })`
- `registerPlugins(plugins, options?)`
- `delete(name)`

`get()` and `getAll()` return only frozen `PluginRuntimeSnapshot` values. `getExports()` returns a readonly export facade bound to the current generation. Neither hosts nor plugins receive raw `PluginRuntime` objects or their lifecycle methods.

## Plugin communication

### Events

`ctx.event.emit(name, payload)` prefixes the event with the current plugin's `eventPrefix`. Use the complete name when listening across plugins:

```ts
const Producer = (): Plugin => ({
  name: 'Producer',
  eventPrefix: 'producer',
  init(ctx) {
    ctx.event.emit('ready', { version: 1 })
  },
})

const Consumer = (): Plugin => ({
  name: 'Consumer',
  init(ctx) {
    ctx.onDispose(
      ctx.event.on('producer:ready', payload => {
        ctx.logger.info('Producer ready:', payload.version)
      }),
    )
  },
})
```

Under the restricted policy, callback arguments also cross the current generation's capability membrane. Do not treat them as raw kernel objects that can be retained across generations.

### Readonly exports

Use explicit plugin exports for a shared API instead of attaching global values to Context:

```ts
interface CounterApi {
  read(): number
}

const Counter = (): Plugin => {
  let value = 0
  return {
    name: 'Counter',
    init() {
      value += 1
    },
    exports: () => ({ read: () => value }),
  }
}

const Reader = (): Plugin => ({
  name: 'Reader',
  deps: ['Counter'],
  init(ctx) {
    const counter = ctx.plugins.getExports<CounterApi>('Counter')
    ctx.logger.info('Counter:', counter?.read())
  },
})
```

An export reference is revoked when its generation is disposed. Do not cache it for the next `init()`.

## PluginContext boundary

Context provides these categories of capability:

- `project`: project reads and finite policy-gated project operations;
- `materials` / `setters`: reviewed registration and read APIs;
- `plugins`: readonly `PluginRegistry`;
- `event`: prefix-scoped shared-engine events; `pluginEvent`: the current plugin's private event bus;
- `hotkey` / `clipboard`: interaction capabilities;
- `config` / `logger` / `trustPolicy`: configuration, logging, and policy information; and
- `onDispose(disposer)`: returns resource cleanup to engine ownership.

The default `agentRestricted` Context uses finite, null-prototype root facades and a generation membrane for returned values and callback arguments. It omits engine lifecycle, internal registries, the shared engine's raw event bus, teardown methods, and known reverse-authority fields; `pluginEvent` belongs only to the current plugin. Its `plugins` capability cannot register, override, or delete peers.

This is an **API, input, and model-mutation authority boundary**, not a malicious-code sandbox. Plugins and host-provided `RemoteAdapter` implementations execute in the same JavaScript realm and must be treated as trusted extension code; they can still use their own closures, imports, and globals. Run untrusted code in a Worker, iframe, isolated Realm, or separate process.

Context and its derived capabilities are generation-bound. After instance disposal, retained Context, callback values, material metadata, and plugin exports do not revive in the next generation.

A legacy plugin that must access raw host services such as `Project.designer` or `Project.simulator` must assert that compatibility boundary explicitly, and the host must select `legacyTrusted`:

```ts
import {
  assertLegacyTrustedPluginContext,
  type PluginCreator,
} from '@easy-editor/core/instance'

const LegacyPlugin: PluginCreator = () => ({
  name: 'LegacyPlugin',
  init(ctx) {
    assertLegacyTrustedPluginContext(ctx)
    ctx.project.designer.onEvent('legacy-event', () => {})
  },
})
```

The assertion fails immediately under `agentRestricted`; it cannot widen a finite Context. Use it only to mark migration-period plugins that still require direct host authority. New plugins should continue to target finite capabilities.

## Prototype-extension compatibility mode

A plugin with `extend` mutates class prototypes shared by the Realm. It must:

1. register before engine initialization;
2. use explicit `legacyTrusted`;
3. provide a stable `extensionFingerprint` for the process-wide extension; and
4. accept that script removal and instance disposal cannot undo process-level prototype effects.

```ts
import { createEngine, type Node, type Plugin } from '@easy-editor/core/instance'

const ExtendPlugin = (): Plugin => ({
  name: 'ExtendPlugin',
  extensionFingerprint: 'extend-plugin@1',
  init() {},
  extend({ extend }) {
    extend('Node', {
      getPluginLabel: {
        value(this: Node) {
          return `${this.componentName}:${this.id}`
        },
      },
    })
  },
})

const engine = createEngine({ trustPolicy: 'legacyTrusted' })
await engine.plugins.register(ExtendPlugin())
await engine.init()
```

A prototype-extension plugin cannot be appended with `autoInit` after readiness. `legacyTrusted` is also a trusted compatibility mode, not a sandbox. New plugins should prefer composition, events, exports, and explicit host APIs over prototype mutation.

The current extension classes are Simulator, Viewport, Designer, Dragon, Detecting, Selection, DropLocation, OffsetObserver, Project, Document, History, Node, NodeChildren, Props, Prop, Materials, Setters, and ComponentMeta.

## Registration options

- `autoInit: true`: only for ordinary plugins registered after the engine is ready.
- `override: true`: initialize the candidate first, then atomically replace the same-name runtime; keep the previous plugin if initialization fails.

Same-name registration, override, and deletion are serialized by manager reservations. Do not bypass `engine.plugins` to mutate internal registries.

See [Plugin API](/en/reference/plugin/) for types and [Architecture Overview](/en/design/overview) for framework ownership and trust boundaries.
