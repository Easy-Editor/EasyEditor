# @easy-editor/core

The stateful framework kernel for EasyEditor: isolated engine instances, versioned Schema loading, transactional edit commands, lifecycle ownership, and explicit trust boundaries.

## Public contract levels

| Level | Surface | Promise |
| --- | --- | --- |
| **Stable** | `@easy-editor/core/instance` | Factory-owned engine lifecycle, Schema validation, commands, transactions, and host registration APIs |
| **Compatibility (Web adapter)** | Designer, Project, Document, Node, Event, and DOM-oriented Simulator types | Available for existing Web renderers and read integration; raw model mutation methods are not stable v2 write APIs |
| **Deferred / Internal** | Future Agent Runtime and concrete engine internals | No Agent subpath is published in this framework baseline; concrete construction and mutable service injection are not public APIs |

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

`@easy-editor/core/instance` does not create the legacy default engine. Each instance owns its Project, Designer, plugins, materials, setters, event bus, hotkeys, command manager, and remote resource state.

The entry has an explicit finite export list. Hosts obtain instances only from `createEngine()`; the concrete engine class, mutable service injection, and lifecycle internals are not exported.

## Compatibility entry

The root `@easy-editor/core` entry still exports `defaultEngine`, `init`, `destroy`, `project`, `plugins`, `materials`, and `setters` for existing applications. Those values are one process-wide compatibility facade; new applications should prefer the explicit instance entry.

## Kernel contracts

- **Lifecycle**: `init()` and `destroy()` are awaitable but an in-flight lifecycle operation is exclusively owned by its original caller. A second lifecycle call rejects immediately with `LifecycleReentrancyError`; it never joins or waits for the active operation. Await the original Promise, then retry explicitly. `init()` on `ready` and `destroy()` on `disposed` are no-ops. Failed disposal remains retryable. Plugin and `RemoteAdapter` lifecycle callbacks must not call the same engine's `init()` or `destroy()`. Runtime-private lifecycle state is exposed through a non-configurable read-only accessor, terminal instances reject new mutations/listeners, and asynchronous plugin work is generation-checked before commit. Engine-owned services can only be torn down through `EngineInstance.destroy()`.
- **Generation ownership**: a generation begins when initialization starts and ends when disposal starts or initialization rolls back. Reusable root services reactivate only through `init()`; retained `Document`, `History`, Simulator, material registry/meta, and plugin-context references from a disposed generation stay permanently revoked. Plugin contexts receive generation-bound capability views rather than reusable raw engine services.
- **Schema**: the current version is `1.0.0`; legacy `0.0.1` input migrates explicitly and invalid input fails before the current project unloads.
- **Transactions**: command batches commit as one undo/redo unit or roll back model, history, selection, complete material entry/meta state, and deferred events. Restricted public transactions reject executable validators.
- **Commands**: `insertNode`, `updateProps`, `removeNode`, `moveNode`, `replace`, `insertBefore`, `insertAfter`, `wrap`, and `unwrap` share one runtime/type catalog.
- **Trust boundary**: `agentRestricted` is a capability, input-validation, and model-mutation policy. Its finite plugin Context facades omit engine lifecycle methods and known reverse-authority fields; its peer registry is readonly, while the host plugin manager returns frozen runtime snapshots and generation-bound exports instead of raw `PluginRuntime` objects. It also rejects executable input, prototype extensions, and remote access through the restricted framework surface. It does **not** make same-realm code safe to distrust: plugins and `RemoteAdapter` implementations remain trusted host extensions. `legacyTrusted` preserves broader compatibility; neither policy is a malicious-code sandbox.
- **Outbound state**: mutable registries and raw event emitters are not lent to observers; loading-state notifications use detached maps, frozen state records, and cloned frozen errors. `MaterialRegistry.getSnapshot()` exposes deterministic frozen diagnostics without a rollback token or mutable entry.

Same-realm JavaScript cannot reliably distinguish a lifecycle call made by an external host from one made through a raw engine closure retained across an `await` without an AsyncContext-like mechanism or realm/process isolation. Capturing the engine in a plugin or adapter lifecycle callback and calling its lifecycle after suspension is therefore a host-protocol violation, not an isolation guarantee.

Agent Runtime design is intentionally deferred until this framework contract is stable. Previous experiments are isolated from this release line: `@easy-editor/core` publishes neither `./agent` nor `./agent-channel`.

## Lifecycle operation matrix

| State | `init()` | `destroy()` | Other public work |
| --- | --- | --- | --- |
| `created` | Starts initialization | Disposes the uninitialized instance | Setup and registration are supported; application model work should wait for `ready` |
| `initializing` | Rejects; await the original `init()` and retry if still needed | Rejects; await the original `init()`, then call `destroy()` | Not a supported host-operation window |
| `ready` | Resolved no-op; new options are not applied | Starts disposal | Allowed subject to trust, ownership, and transaction rules |
| `disposing` | Rejects; await the original `destroy()`, then retry | Rejects; await the original `destroy()` | New writes and subscriptions are rejected |
| `disposed` | Starts a new generation | Resolved no-op | Rejected until a successful `init()` |
| `failed` | Rejects | Retries retained cleanup; success moves to `disposed` | Rejected until cleanup succeeds and the engine is initialized again |

Initialization failure returns to `created` when rollback succeeds and enters `failed` when rollback is incomplete. Lifecycle methods must also not run from an active transaction or an engine-owned lifecycle/model callback.

## Support matrix

| Surface | Supported contract | Verification status |
| --- | --- | --- |
| Framework runtime packages and repository tooling | Node.js `>=18.20.8` | Exact floor is a CI quality-gate lane; Node 20 is the primary strict-engine lane |
| `@easy-editor/easypack` | Node.js `>=20.0.0` | Verified only in the Node 20 lane |
| Repository package manager | pnpm `>=9.12.2`; CI and lockfile use pnpm `10.25.0` | Frozen-lockfile install in CI |
| Renderer | React renderer is delivered | Other framework adapters are extension targets, not shipped support |
| Browser | Dashboard development smoke through `pnpm example:dashboard` | Chromium lifecycle, reload, persistence, preview, and console-error E2E are release-gated |
| Operating system | Platform-neutral packages | Full suite on Ubuntu; generator and packed-template smoke are release-gated on macOS and Windows |

See the [architecture overview](https://github.com/Easy-Editor/EasyEditor/blob/main/docs/en/design/overview.md) for the ownership and trust model.
