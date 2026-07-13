# @easy-editor/core

The stateful kernel for EasyEditor: isolated engine instances, versioned Schema loading, transactional edit commands, lifecycle ownership, and Agent capability boundaries.

## Recommended entry: explicit instance

```ts
import { createEngine, type EngineInstance } from '@easy-editor/core/instance'

const engine: EngineInstance = createEngine({
  trustPolicy: 'agentRestricted',
  hostWindow: window,
})

await engine.init({ designMode: 'design' })
engine.loadProject(schema, true)

// Always await teardown. Failed cleanup remains retryable.
await engine.destroy()
```

`@easy-editor/core/instance` does not create the legacy default engine. Each instance owns its Project, Designer, plugins, materials, setters, event bus, hotkeys, command manager, Agent capabilities, and remote resource state.

## Compatibility entry

The root `@easy-editor/core` entry still exports `defaultEngine`, `init`, `destroy`, `project`, `plugins`, `materials`, and `setters` for existing applications. Those values are one process-wide compatibility facade; new applications should prefer the explicit instance entry.

## Kernel contracts

- **Lifecycle**: `init()` and `destroy()` are awaitable and concurrency-safe; failed disposal can be retried. Runtime-private lifecycle state is exposed through a non-configurable read-only accessor, terminal instances reject new mutations/listeners, and asynchronous plugin work is generation-checked before commit. Engine-owned services can only be torn down through `EngineInstance.destroy()`.
- **Generation ownership**: a generation begins when initialization starts and ends when disposal starts or initialization rolls back. Reusable root services reactivate only through `init()`; retained `Document`, `History`, Simulator, material registry/meta, and plugin-context references from a disposed generation stay permanently revoked. Plugin contexts receive generation-bound capability views rather than reusable raw engine services.
- **Schema**: the current version is `1.0.0`; legacy `0.0.1` input migrates explicitly and invalid input fails before the current project unloads.
- **Transactions**: command batches commit as one undo/redo unit or roll back model, history, selection, complete material entry/meta state, and deferred events. Restricted public transactions reject executable validators; Agent validation uses a package-private capability instead of a mutable public method.
- **Commands**: `insertNode`, `updateProps`, `removeNode`, `moveNode`, `replace`, `insertBefore`, `insertAfter`, `wrap`, and `unwrap` share one runtime/type catalog.
- **Agent boundary**: grants independently restrict documents, component types, prop values, extra-field values, commands, and budgets. Prop/extra policies fail closed and recursively accept only bounded strings, finite ranged numbers, or exact objects; Worker transport exposes structured-clone DTOs rather than engine objects. Port sessions may opt into `executionAuthority: 'host'`, which lets the peer preview while the trusted host reads the authoritative record through `getPreparedPlanPreview(planId)` and reserves commit for `approveAndExecute(planId)`. Receipts, audit records, and committed events from that entry carry `approvalSource: 'host'`; this proves the trusted host invoked the approval entry, not the identity of a human approver.
- **Trust boundary**: `agentRestricted` fails closed for raw mutation, executable input, plugin prototype extensions, and remote access. Host mutation authority is suspended before event, material, and component callbacks execute. `legacyTrusted` preserves compatibility but is not a security sandbox.
- **Outbound state**: mutable registries and raw event emitters are not lent to observers; loading-state notifications use detached maps, frozen state records, and cloned frozen errors. `MaterialRegistry.getSnapshot()` exposes deterministic frozen diagnostics without a rollback token or mutable entry.

See the [architecture overview](../../docs/en/design/overview.md) for the ownership and trust model.
