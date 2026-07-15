# Core API

The stable EasyEditor v2 framework boundary is a host-owned `EngineInstance`. One instance owns lifecycle, plugins, materials, setters, project replacement, command transactions, and remote resources.

## Public contract levels

| Level | Entry or surface | Promise |
| --- | --- | --- |
| **Stable** | `@easy-editor/core/instance` | Factory-owned engine lifecycle, Schema validation, commands, transactions, and host registration APIs |
| **Compatibility (Web adapter)** | Designer, Project, Document, Node, Event, and DOM-oriented Simulator types | Available for existing Web renderers and read integration; raw model mutation methods are not stable v2 write APIs |
| **Deferred / Internal** | Agent experiments and concrete engine internals | Agent Runtime is outside this framework-convergence phase; concrete construction and mutable service injection are not public APIs |

The root `@easy-editor/core` entry is a v1 migration facade, not part of the Stable instance contract.

`@easy-editor/core/instance` has an explicit finite export list. Hosts obtain an `EngineInstance` only through `createEngine()`; the concrete engine class, mutable service injection, and lifecycle internals are not exported.

::: warning v2 write boundary
`engine.project`, `engine.designer`, and the exported Document and Node types remain available for renderer integration and legacy compatibility. Raw model mutation methods are not the stable v2 application write boundary. New code should use `engine.loadProject()`, `engine.unloadProject()`, `engine.commands`, `engine.transactions`, `engine.undo()`, and `engine.redo()`.
:::

## Create an instance

```ts
import {
  type EngineInstance,
  createEngine,
} from '@easy-editor/core/instance'

export const engine: EngineInstance = createEngine({
  trustPolicy: 'agentRestricted',
  hostWindow: window,
})
```

Every `createEngine()` call returns an independent instance. Do not mix Project, Document, Node, plugin-context, or registry values across instances.

### EngineInstanceOptions

| Option | Meaning |
| --- | --- |
| `trustPolicy` | A preset or custom trust policy. Defaults to `agentRestricted` |
| `hostWindow` | The Window that owns browser capabilities such as hotkeys; pass `null` to disable global Window resolution |
| `remoteAdapter` | A host-owned remote-resource adapter; the trust policy still decides whether access is allowed |

## Lifecycle

### `engine.init(options?)`

**Type:** `(options?: ConfigOptions) => Promise<void>`

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export async function startEngine(engine: EngineInstance): Promise<void> {
  await engine.init({
    designMode: 'design',
    locale: 'en-US',
  })
}
```

`ConfigOptions.designMode` accepts only `'design' | 'live'`. A successful initialization leaves `lifecycleState` at `ready`. Calling `init()` while initialization or disposal is in progress rejects immediately with `LifecycleReentrancyError`; it neither joins the Promise nor waits automatically. The host must await the original operation and retry explicitly. Calling `init()` on a `ready` instance is a resolved no-op and does not apply new options; explicitly `destroy()` first when a new generation is required.

### `engine.destroy()`

**Type:** `() => Promise<void>`

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export function destroyEngine(engine: EngineInstance): Promise<void> {
  return engine.destroy()
}
```

`destroy()` stops new writes and disposes plugins, listeners, the Designer, Project, hotkeys, materials, setters, the remote adapter/registry, events, and internal resources. Calling `destroy()` while initialization or disposal is in progress rejects immediately with `LifecycleReentrancyError`; it neither joins nor waits automatically. The host must await the original operation and retry explicitly. A cleanup failure sets the state to `failed`; call `destroy()` again to retry retained unfinished cleanup. Calling `destroy()` on a `disposed` instance is a resolved no-op.

Do not retain a settled destroy Promise permanently, and do not dispose engine-owned child services such as materials, setters, or Project independently.

### `engine.lifecycleState`

```ts
type EngineLifecycleState =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'disposing'
  | 'disposed'
  | 'failed'
```

This is a readonly state source. A host may reject requests while the engine is not ready, but cannot assign a lifecycle state.

### Lifecycle state × public operation matrix

| State | `init()` | `destroy()` | Other public work |
| --- | --- | --- | --- |
| `created` | Starts initialization | Disposes the uninitialized instance | Host setup and registration are supported; application model work should wait for `ready` |
| `initializing` | Rejects; await the original `init()` and retry if still needed | Rejects; await the original `init()`, then destroy explicitly | Not a supported host-operation window |
| `ready` | Resolved no-op; new options are not applied | Starts disposal | Allowed subject to trust, ownership, and transaction rules |
| `disposing` | Rejects; await the original `destroy()`, then retry | Rejects; await the original `destroy()` | New writes and subscriptions are rejected |
| `disposed` | Starts a new generation | Resolved no-op | Rejected until a successful `init()` |
| `failed` | Rejects | Retries retained cleanup; success moves to `disposed` | Rejected until cleanup succeeds and the engine is initialized again |

Initialization failure returns to `created` when rollback succeeds and enters `failed` when rollback is incomplete. Lifecycle methods must also not run from an active transaction or an engine-owned lifecycle/model callback.

### Lifecycle callback rule

Plugin `init`, `extend`, and `destroy` hooks and `RemoteAdapter.init()` / `dispose()` are engine-owned lifecycle callbacks. They **must not** call the same engine's `init()` or `destroy()`; direct synchronous re-entry throws `LifecycleReentrancyError`. A restricted PluginContext does not expose engine lifecycle methods.

Without AsyncContext-like causal tracking or Realm/process isolation, same-realm JavaScript cannot reliably distinguish an external host call from one issued through a previously captured raw engine closure after a callback suspends. Plugins and adapters must therefore not issue lifecycle calls that way after an `await`. This is a host-extension protocol rule, not a sandbox guarantee.

## Instance modules

| Module | Responsibility |
| --- | --- |
| `plugins` | Host-side async registration/deletion and frozen status reads; the engine owns ordering, initialization, and disposal |
| `materials` | Component metadata registration and verifiable registry snapshots |
| `setters` | Setter registration and a stable readonly Map facade |
| `project` / `designer` | Renderer integration and legacy model reads, not the new stable raw-write boundary |
| `commands` / `transactions` | Verifiable, rollback-safe, auditable model writes |
| `remote` | Remote access gated by both trust policy and a host adapter |
| `config` / `event` / `eventBus` / `hotkey` | Instance-owned configuration and interaction infrastructure |

## Register plugins, materials, and setters

Plugin registration is asynchronous and must be awaited:

```ts
import type { EngineInstance, Plugin } from '@easy-editor/core/instance'

export async function installPlugins(
  engine: EngineInstance,
  pluginList: Plugin[],
): Promise<void> {
  await engine.plugins.registerPlugins(pluginList)
}
```

Write materials and setters through the instance registration APIs:

```ts
import type {
  ComponentMetadata,
  EngineInstance,
  Setter,
} from '@easy-editor/core/instance'

export function registerMetadata(
  engine: EngineInstance,
  componentMetas: ComponentMetadata[],
  setterMap: Record<string, Setter>,
): void {
  engine.materials.buildComponentMetasMap(componentMetas)
  engine.setters.registerSetter(setterMap)
}
```

- `engine.materials.registry.getSnapshot()` returns detached, sorted, frozen deterministic data.
- `engine.materials.registry.getAll()` returns readonly Entry views rather than the backing Map.
- `engine.setters.getSettersMap()` returns a stable `ReadonlyMap` facade; `set`, `delete`, and `clear` are rejected.
- `engine.plugins.get()` / `getAll()` return frozen status only; they do not expose `PluginRuntime`, Context, or lifecycle methods.
- `engine.plugins.getExports(name)` returns a generation-bound readonly exports facade; retained callable exports are revoked after disposal.
- Under the restricted policy, a plugin Context is built from finite root facades that omit engine lifecycle and known reverse-authority fields. Its `PluginRegistry` is readonly and cannot register or delete peers. This describes the Context surface, not isolation from arbitrary same-realm code.

## Validate and replace a project

Validate host input under the instance policy, then replace the Project through the engine-owned boundary:

```ts
import {
  type EngineInstance,
  type ProjectSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'

export function replaceProject(
  engine: EngineInstance,
  schema: ProjectSchema,
): void {
  const validated = validateProjectSchema(schema, engine.trustPolicy)
  engine.loadProject(validated, true)
}

export function clearProject(engine: EngineInstance): void {
  engine.unloadProject()
}
```

Validation covers structure, current version, migration output, trust policy, and Schema invariants. Successful `validateProjectSchema()` is not proof that executable code is safe; restricted policy still rejects executable Schema.

## Commands, transactions, and history

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export function updateRootTitle(
  engine: EngineInstance,
  title: string,
) {
  const document = engine.project.currentDocument
  if (!document) throw new Error('No active document')
  const root = document.root
  if (!root) throw new Error('The active document has no root node')

  return engine.transactions.runOnDocument(document, [
    {
      type: 'updateProps',
      nodeId: root.id,
      props: { title },
    },
  ])
}
```

- `engine.commands.execute(command)` executes one typed command.
- `engine.transactions.run(commands)` executes a batch on the current document.
- `engine.transactions.runOnDocument(documentOrId, commands, options?)` binds the batch to a document owned by this instance.
- A successful batch creates one undo unit. Failure restores model state, history, selection, material accounting, and deferred events.
- `engine.undo(documentOrId?)` / `engine.redo(documentOrId?)` mutate history through the engine boundary.
- `agentRestricted` rejects callback transactions and public executable pre/post conditions.
- `TransactionCommittedError.committed === true` means the model committed but a post-commit observer failed. Do not retry it as an uncommitted operation.

## Readonly verification signals

Core does not currently expose one `getHealth()` method. Compose a host check from readonly signals:

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export function getEngineHealth(engine: EngineInstance) {
  return Object.freeze({
    lifecycle: engine.lifecycleState,
    materials: engine.materials.registry.getSnapshot(),
    setterCount: engine.setters.getSettersMap().size,
    remoteMaterialCount: engine.remote.registry.materialCount,
    remoteSetterCount: engine.remote.registry.setterCount,
  })
}
```

These values support invariant checks and tests without granting registry mutation or rollback authority.

## Trust boundaries

### Policy

`createEngine()` defaults to `agentRestricted`. It is a capability, input-validation, and model-mutation policy: through the restricted framework surface it rejects executable Schema, callback transactions, direct raw-model writes, plugin prototype extensions, and remote access, and supplies finite plugin root facades. It is not a security sandbox for malicious plugins.

Same-realm plugins and host-provided `RemoteAdapter` implementations are trusted extension code; they can still use their own captured closures, imports, and globals. `legacyTrusted` provides a broader compatibility surface for trusted hosts that depend on legacy plugins or UMD resources. Neither policy provides process, iframe, Realm, or SES isolation.

The current `DashboardPlugin` extends prototypes in its shared Realm, so a compatible Dashboard host must select `legacyTrusted` explicitly. Isolate a restricted engine in another Worker, iframe, or Realm while a prototype lease is active; the Realm can be reused sequentially only after the final compatible engine destroys successfully and restores the descriptors.

### Agent phase deferred

Agent Runtime, transport, authorization, and approval protocols are outside this phase's Stable framework contract and receive no stability promise from `EngineInstance`. Existing experiments will be reviewed separately during the Agent phase after the framework contract is stable.

### Remote resources

Remote access must pass both:

1. the trust policy's remote capability; and
2. the host `RemoteAdapter` allowlist for resource name, type, URL, and version.

`engine.remote.registry` exposes readonly resource envelopes. Each `data` value remains an opaque adapter-owned capability. Engine disposal clears the adapter, loading state, and registry together.

A `RemoteAdapter` is a trusted host extension. Its `init()` and `dispose()` hooks must not call the same engine lifecycle, including through a raw engine closure after an `await`.

## Compatibility status of the raw model API

The package still exports Designer, Project, Document, Node, Selection, Event, and Simulator types for existing renderers and `legacyTrusted` applications. Public availability does not make every method on those objects a stable v2 write API. This reference intentionally does not promise a legacy method inventory. Keep reads inside renderer adapters and route application writes through `EngineInstance`.

## Support and verification matrix

| Surface | Supported contract | Current verification status |
| --- | --- | --- |
| Framework runtime packages and repository tooling | Node.js `>=18.20.8` | CI runs quality gates at the exact floor; Node 20 is the primary strict-engine lane |
| `@easy-editor/easypack` | Node.js `>=20.0.0` | Verified only in the Node 20 lane |
| Repository package manager | pnpm `>=9.12.2`; CI and lockfile use pnpm `10.25.0` | Frozen-lockfile install in CI |
| Renderer | React renderer is delivered | Other framework adapters are extension targets, not shipped support |
| Browser | Dashboard development smoke through `pnpm example:dashboard` | Chromium manual smoke; automated browser E2E is not yet a release gate |
| Operating system | Packages should remain platform-neutral | Full suite on Ubuntu; generator and packed-template release smoke on macOS and Windows |

## Root facade

The `@easy-editor/core` root entry still exports the v1 `defaultEngine`, `init`, `destroy`, `project`, and related globals. They refer to one process-wide `legacyTrusted` instance for gradual migration:

- they do not provide multi-instance isolation;
- their modules must not be mixed with explicit-instance modules;
- teardown must still be awaited; and
- new applications should create instances from `@easy-editor/core/instance`; Agent contracts are deferred to a separate design phase.

See [Migrate from v1 to v2](/en/guide/migration-v2) and [Engine ownership and trust boundaries](/en/design/overview).
