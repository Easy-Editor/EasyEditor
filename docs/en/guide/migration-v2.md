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

The lifecycle is `created -> initializing -> ready -> disposing -> disposed`, with `failed` representing incomplete initialization rollback or disposal. Concurrent `init()` and `destroy()` calls join the operation already in progress. A failed disposal can be retried with another `destroy()` call.

Only `engine.destroy()` may tear down engine-owned child services. Await it during application unmount, non-persisted `pagehide`, or HMR:

```ts
export function destroyEditor(): Promise<void> {
  // EngineInstance joins concurrent destroy calls. Do not retain a settled
  // Promise: it would suppress disposal retries or cleanup after a restart.
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

`createEngine()` defaults to `agentRestricted`. It denies executable Schema, callback transactions, direct model mutation, plugin prototype extensions, and remote access. Use it for new constrained hosts and Agent capability endpoints.

Existing Dashboard integrations currently require explicit compatibility mode because `DashboardPlugin` extends prototypes in the shared realm:

```ts
const engine = createEngine({
  trustPolicy: 'legacyTrusted',
  hostWindow: window,
})
```

`legacyTrusted` is not a sandbox. Legacy UMD and prototype extensions can leave process-wide effects that removing a script element cannot reverse. Run restricted engines in a different Worker, iframe, or Realm from that code.

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

## Keep Agent and remote boundaries explicit

An Agent must not receive `Project`, `Document`, or `Node` references. Issue the smallest possible grant. Execution authority depends on how the capability is delivered:

- `engine.agentCapabilities.issue(grant)` returns a same-realm capability whose holder can call `execute(planId)` directly.
- `issuePort(grant, port, { signal })` defaults `executionAuthority` to `'peer'`, so the connected peer can also call `execute(planId)`.
- Only `issuePort(..., { executionAuthority: 'host' })` denies peer execution and requires the trusted host to inspect Core's authoritative preview before calling `approveAndExecute(planId)`.

Create a Worker channel that requires host approval explicitly:

```ts
import type {
  AgentCapabilityGrantInput,
  EngineInstance,
} from '@easy-editor/core/instance'

export function openHostApprovedAgentSession(
  engine: EngineInstance,
  worker: Worker,
  grant: AgentCapabilityGrantInput,
) {
  const channel = new MessageChannel()
  const controller = new AbortController()
  const session = engine.agentCapabilities.issuePort(grant, channel.port1, {
    executionAuthority: 'host',
    signal: controller.signal,
  })

  worker.postMessage(
    { type: 'easy-editor-agent-port', port: channel.port2 },
    [channel.port2],
  )

  return {
    inspect(planId: string) {
      return session.getPreparedPlanPreview(planId)
    },
    approve(planId: string) {
      return session.approveAndExecute(planId)
    },
    close() {
      session.close()
      controller.abort()
    },
  }
}
```

The Worker receives only the structured-clone object capability:

```ts
import { connectAgentPort } from '@easy-editor/core/agent-channel'

export async function connectAgentCapability(port: MessagePort) {
  return connectAgentPort(port)
}
```

In host-authority mode the Worker may call `snapshot()` and `preview()`, but `execute()` fails closed. The host must authorize the immutable preview returned by `session.getPreparedPlanPreview(planId)`, not effects echoed by the Agent. `approveAndExecute()` proves only that the trusted host entry point approved execution; it does not identify a human approver or eliminate prompt-injection risk. Combine capability policy with Worker isolation.

Remote access requires both trust-policy permission and a host `RemoteAdapter` allowlist. The remote registry records readonly resource envelopes; its `data` field remains an opaque capability owned by the adapter. `engine.destroy()` disposes the adapter, loading state, and registry.

## Root facade compatibility

The root entry still exports a process-wide `legacyTrusted` default instance for gradual migration:

```ts
import { defaultEngine, destroy, init, project } from '@easy-editor/core'
```

It does not provide instance isolation and should not be the default for new applications or Agent hosts. Do not mix its modules with an explicit instance, and always await `destroy()` when using it.

See [Getting Started](/en/guide/getting-started), [Core API](/en/reference/core/), and [Engine ownership and trust boundaries](/en/design/overview).
