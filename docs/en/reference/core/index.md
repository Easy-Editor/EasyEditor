# Core API

The stable EasyEditor v2 runtime boundary is a host-owned `EngineInstance`. One instance owns lifecycle, plugins, materials, setters, project replacement, command transactions, Agent capabilities, and remote resources.

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

`ConfigOptions.designMode` accepts only `'design' | 'live'`. A successful initialization leaves `lifecycleState` at `ready`. Concurrent `init()` calls join the same attempt. Calling `init()` on a ready instance first disposes the current generation and then initializes a new one.

### `engine.destroy()`

**Type:** `() => Promise<void>`

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export function destroyEngine(engine: EngineInstance): Promise<void> {
  return engine.destroy()
}
```

`destroy()` stops new writes and disposes Agent capabilities, plugins, listeners, the Designer, Project, hotkeys, materials, setters, the remote adapter/registry, and events. Concurrent calls join one disposal attempt. A cleanup failure sets the state to `failed`; call `destroy()` again to retry.

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

## Instance modules

| Module | Responsibility |
| --- | --- |
| `plugins` | Asynchronous plugin registration, ordering, initialization, and disposal |
| `materials` | Component metadata registration and verifiable registry snapshots |
| `setters` | Setter registration and a stable readonly Map facade |
| `project` / `designer` | Renderer integration and legacy model reads, not the new stable raw-write boundary |
| `commands` / `transactions` | Verifiable, rollback-safe, auditable model writes |
| `agentCapabilities` | Least-privilege Agent capabilities, previews, execution, and audit records |
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

`createEngine()` defaults to `agentRestricted`, which denies executable Schema, callback transactions, raw model writes, plugin prototype extensions, and remote access. `legacyTrusted` is compatibility for trusted hosts that depend on legacy plugins or UMD resources; it is not a sandbox.

The current `DashboardPlugin` extends prototypes in its shared realm, so a compatible Dashboard host must select `legacyTrusted` explicitly. Put a restricted engine in a different Worker, iframe, or Realm from such code.

### Agent execution authority

A same-realm capability returned by `issue()` can execute. `issuePort()` defaults to `executionAuthority: 'peer'`, so the connected peer can also execute. Only explicit `'host'` authority retains execution in the host:

```ts
import type {
  AgentCapabilityGrantInput,
  AgentPortSession,
  EngineInstance,
} from '@easy-editor/core/instance'

export function issueHostApprovedPort(
  engine: EngineInstance,
  port: MessagePort,
  signal: AbortSignal,
  grant: AgentCapabilityGrantInput,
): AgentPortSession {
  return engine.agentCapabilities.issuePort(grant, port, {
    executionAuthority: 'host',
    signal,
  })
}
```

The peer can still call `snapshot()` and `preview()`, but its `execute()` fails closed. The host must inspect Core's authoritative `session.getPreparedPlanPreview(planId)`, apply its own policy or user-confirmation step, and only then call `session.approveAndExecute(planId)`. That call proves only that the host entry point approved execution; it does not identify a human approver.

### Remote resources

Remote access must pass both:

1. the trust policy's remote capability; and
2. the host `RemoteAdapter` allowlist for resource name, type, URL, and version.

`engine.remote.registry` exposes readonly resource envelopes. Each `data` value remains an opaque adapter-owned capability. Engine disposal clears the adapter, loading state, and registry together.

## Compatibility status of the raw model API

The package still exports Designer, Project, Document, Node, Selection, Event, and Simulator types for existing renderers and `legacyTrusted` applications. Public availability does not make every method on those objects a stable v2 write API. This reference intentionally does not promise a legacy method inventory. Keep reads inside renderer adapters and route application writes through `EngineInstance`.

## Root facade

The `@easy-editor/core` root entry still exports the v1 `defaultEngine`, `init`, `destroy`, `project`, and related globals. They refer to one process-wide `legacyTrusted` instance for gradual migration:

- they do not provide multi-instance isolation;
- their modules must not be mixed with explicit-instance modules;
- teardown must still be awaited; and
- new applications and Agent hosts should create instances from `@easy-editor/core/instance`.

See [Migrate from v1 to v2](/en/guide/migration-v2) and [Engine ownership and trust boundaries](/en/design/overview).
