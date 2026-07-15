---
title: Migrate from v1 to the v2 engine kernel
description: Replace global singleton state with an explicit, disposable, verifiable EasyEditor engine instance
---

# Migrate from v1 to the v2 engine kernel

EasyEditor v2 moves runtime ownership from module-level global singletons to a host-created `EngineInstance`. Each instance owns its Project, plugins, materials, setters, events, hotkeys, and remote resources. The host initializes and destroys that instance explicitly.

## Migration summary

| v1 | v2 |
| --- | --- |
| Import `init`, `project`, and other globals from `@easy-editor/core` | Import `createEngine` from `@easy-editor/core/instance` |
| Share state created during module evaluation | Create one instance at the host mount boundary |
| Call `project.load()` or mutate Nodes directly | Use `engine.loadProject()`, typed commands, or transactions |
| Rely on page reload for cleanup | Await `engine.destroy()` during unmount, `pagehide`, and HMR |
| Share mutable registry maps | Read stable readonly facades and frozen snapshots |
| Implicitly trust legacy plugins and remote code | Select `agentRestricted` or `legacyTrusted` explicitly |

## Replace the root singleton

```ts
import { createEngine } from '@easy-editor/core/instance'
import { componentMetas } from './materials'
import { pluginList } from './plugins'
import { setterMap } from './setters'

export const engine = createEngine({
  trustPolicy: 'agentRestricted',
  hostWindow: window,
})

await engine.plugins.registerPlugins(pluginList)
engine.materials.buildComponentMetasMap(componentMetas)
engine.setters.registerSetter(setterMap)
await engine.init()

export const project = engine.project
```

Do not mix the root `project` facade with `engine.project` in one runtime path. They belong to different ownership boundaries.

## Own the lifecycle

The lifecycle is `created -> initializing -> ready -> disposing -> disposed`, with `failed` representing incomplete initialization rollback or disposal. While any lifecycle operation is in flight, a new `init()` or `destroy()` fails immediately with `LifecycleReentrancyError`; wait for settlement and retry explicitly. `ready.init()` and `disposed.destroy()` are no-ops. A failed disposal can be retried with another `destroy()` call.

Plugin and `RemoteAdapter` lifecycle callbacks must not call the same engine's `init()` or `destroy()`. Direct synchronous re-entry throws `LifecycleReentrancyError`. Issuing the call after an `await` through a previously captured raw engine closure also violates the host-extension protocol; without AsyncContext-like tracking or Realm/process isolation, a same-realm kernel cannot reliably attribute that call.

Only `engine.destroy()` may tear down engine-owned child services. Await it during application unmount, non-persisted `pagehide`, or HMR:

```ts
export function destroyEditor(): Promise<void> {
  // The host must serialize lifecycle calls. Do not retain a settled Promise:
  // it would suppress disposal retries or cleanup after a restart.
  return engine.destroy()
}

window.addEventListener('pagehide', event => {
  if (!event.persisted) void destroyEditor()
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => destroyEditor())
}
```

Dispose partially created resources when startup fails. If startup and cleanup both fail, preserve both causes:

```ts
try {
  await engine.init()
} catch (startupError) {
  try {
    await engine.destroy()
  } catch (cleanupError) {
    throw new AggregateError(
      [startupError, cleanupError],
      'Editor startup and cleanup both failed',
    )
  }
  throw startupError
}
```

## Select a trust policy

`createEngine()` defaults to `agentRestricted`. It rejects executable Schema, callback transactions, direct model mutation, plugin prototype extensions, and remote access through the restricted framework surface. Use it for new constrained hosts.

Existing Dashboard integrations currently require explicit compatibility mode because `DashboardPlugin` extends prototypes in the shared realm:

```ts
const engine = createEngine({
  trustPolicy: 'legacyTrusted',
  hostWindow: window,
})
```

`agentRestricted` is a capability, input-validation, and model-mutation policy, not a malicious-code sandbox. Same-realm plugins and host `RemoteAdapter` implementations are trusted extension code and can still use their own closures, imports, and globals. `legacyTrusted` is the broader compatibility mode; legacy UMD and prototype extensions can leave process-wide effects that removing a script element cannot reverse. Isolate untrusted code in another Worker, iframe, Realm, or process.

## Use owned mutation boundaries

Validate and load host Schema through the engine boundary:

```ts
import { validateProjectSchema } from '@easy-editor/core/instance'

const validated = validateProjectSchema(projectSchema, engine.trustPolicy)
engine.loadProject(validated, true)
```

Use typed commands for auditable edits. A batch commits as one undo unit or rolls back:

```ts
const document = engine.project.currentDocument
if (!document) throw new Error('No active document')
const root = document.root
if (!root) throw new Error('The active document has no root node')

const result = engine.transactions.runOnDocument(document, [
  {
    type: 'updateProps',
    nodeId: root.id,
    props: { title: 'Updated' },
  },
])
```

`agentRestricted` rejects callback transactions such as `runSync(() => ...)`. If a post-commit observer fails, Core reports `TransactionCommittedError` with `committed === true`; do not automatically retry it as an uncommitted operation.

## Build verification from readonly signals

v2 does not currently expose one `getHealth()` method. Compose a host health check from readonly signals:

```ts
const health = Object.freeze({
  lifecycle: engine.lifecycleState,
  materials: engine.materials.registry.getSnapshot(),
  setterCount: engine.setters.getSettersMap().size,
  remoteMaterialCount: engine.remote.registry.materialCount,
  remoteSetterCount: engine.remote.registry.setterCount,
})
```

`lifecycleState` is readonly. The material snapshot is detached, sorted, and frozen. The setter map is a stable `ReadonlyMap`; `set`, `delete`, and `clear` are rejected. Write through the registration APIs instead.

## Tighten remote resources; defer Agent

Agent Runtime, transport, authorization, and approval protocols are outside this framework migration. Complete the `@easy-editor/core/instance` ownership, lifecycle, transaction, and trust-boundary migration first; Agent contracts will be designed separately after the framework stabilizes.

Remote access requires both trust-policy permission and a host `RemoteAdapter` allowlist. The remote registry records readonly resource envelopes; its `data` field remains an opaque capability owned by the adapter. `engine.destroy()` disposes the adapter, loading state, and registry. A `RemoteAdapter` is a trusted host extension, and its `init()` / `dispose()` hooks must not call the same engine lifecycle.

## Root facade compatibility

The root entry still exports a process-wide `legacyTrusted` default instance for gradual migration:

```ts
import { defaultEngine, destroy, init, project } from '@easy-editor/core'
```

It does not provide instance isolation and should not be the default for new applications. Do not mix its modules with an explicit instance, and always await `destroy()` when using it.

See [Getting Started](/en/guide/getting-started), [Core API](/en/reference/core/), and [Engine ownership and trust boundaries](/en/design/overview).
