# Agent Runtime Dashboard Phase 0 Contracts

**Status:** Accepted  
**Scope:** Phase 0 only  
**Source of truth:** the approved Agent Runtime Dashboard PRD, test specification, and execution handoff under `.omx/plans/`

This document freezes the repository-native decisions that must be true before any Agent runtime implementation starts. Phase 0 adds no writable Agent capability, no runtime package, no generated-component host, and no Core behavior change.

## Invariants

1. Core remains Agent-free. Agent task metadata, receipts, provenance, model transport, and generated-code authority stay outside `@easy-editor/core`.
2. The Worker owns model and orchestration work. The Dashboard Host owns observation, authorization, semantic execution, and persistence composition.
3. Worker/Host boundaries exchange versioned, validated, structured-clone-safe DTOs only. Engine, Document, History, callbacks, credentials, React components, and raw Core commands never cross that boundary.
4. Generated code never runs in the Dashboard realm. A surface-local sandbox provides authority containment, not hard synchronous CPU containment.
5. Core memory and IndexedDB remain separate atomic domains. Only the coordinator's durable batch may be acknowledged as committed.
6. A generated node always keeps the trusted `GeneratedMaterialHost` Core `componentName`; promotion changes only its discriminated `ArtifactRef` target.
7. Default runtime behavior remains unchanged until explicit feature flags and later phase gates are enabled.

## ADR-AR-001 — Worker composition and public entries

**Decision:** Accepted.

The pilot uses a main-thread facade backed by a real module Worker. The planned public package has exactly three reviewed entries:

- `@easy-editor/agent-runtime`: `createAgentRuntime`, the `AgentRuntime` facade, `AgentWorkerEndpoint`, `AgentHost`, `AgentPersistencePort`, and shared DTOs.
- `@easy-editor/agent-runtime/worker`: Worker-local `ModelAdapter` and `startAgentWorker` bootstrap.
- `@easy-editor/agent-runtime/testing`: `ScriptedModelAdapter`, `MemoryAgentPersistence`, `FakeAgentHost`, deterministic clock, and deterministic id fixtures.

Context builders, journal reducers, protocol parsers, phase classes, retry schedulers, capability registries, Engine, Document, raw prompts, raw Core commands, and mutable task objects are package-private. `ModelAdapter` is not exported from the root entry because it must be constructed inside the Worker profile.

The stable composition DTO is:

```ts
interface AgentRuntimeBinding {
  projectId: string
  branchId: string
  sessionId?: string
}

interface AgentRuntimeOptions {
  binding: AgentRuntimeBinding
  worker: AgentWorkerEndpoint | (() => AgentWorkerEndpoint)
  host: AgentHost
  persistence: AgentPersistencePort
}
```

The facade mirrors immutable snapshots and routes Host/Persistence RPC. Model streaming, planning, recovery, and protocol parsing remain Worker-owned.

## ADR-AR-002 — Core-neutral mutation boundary

**Decision:** Accepted for later implementation; no Core source change is part of Phase 0.

The only approved Core additions are general-purpose transaction semantics:

- `BoundTransactionOptions.expectedMutationVersion?: number`, checked synchronously after binding/preflight and before the first visible effect or History entry.
- `UpdatePropsCommand.unsetPropPaths?: readonly string[]` and `unsetExtraPaths?: readonly string[]`, with bounded normalized paths and set/unset overlap rejection.

These additions must remain free of Agent names, `callId`, receipts, provenance, or a second History stack. A rejected or net-zero ChangeSet is History-transparent; one effective ChangeSet produces one History unit. The existing `packages/core/test/framework-entry.test.mjs`, `packages/core/test/instance-entry.test-d.ts`, and reviewed instance API fixture remain the Core public gates.

## ADR-AR-003 — Durable commit and migration authority

**Decision:** Accepted for later implementation; Phase 0 freezes the ordering only.

`ProjectPersistenceCoordinator` is the sole writer for working drafts, manual saves, Agent commits, named versions, and migrations. The durable commit sequence is:

1. validate authorization, manifest, node existence, value constraints, and base revision;
2. durably write a pending `ReceiptIntent`;
3. execute one Core ChangeSet guarded by `expectedMutationVersion`;
4. classify the Core result without blind retry;
5. construct an Apply/Failure witness and provenance updates outside Core;
6. atomically commit the canonical project draft, receipt, witness, provenance, journal head, checkpoint/artifact deltas, and next `draftGeneration` in IndexedDB;
7. acknowledge `committed` only after step 6;
8. re-observe affected projections during verify.

Value equality is diagnostic only. Without a matching durable witness, draft generation, transaction fingerprint, and provenance lineage, an unknown result stays `indeterminate`.

Storage rollout is Bridge-first. A compatibility marker must land before IndexedDB becomes canonical. During rollback, `materializeLegacyFromCanonical` writes and verifies legacy bytes before the marker changes; interrupted downgrade keeps IndexedDB authoritative. Full `projectSchema` takes precedence over page fragments during initial migration, and source localStorage values are not deleted on failure.

## ADR-AR-004 — ArtifactRef trusted-proxy identity

**Decision:** Accepted.

```ts
interface ArtifactSourceRevision {
  artifactId: string
  sourceRevision: string
  logicalComponentId: string
  sourceIntegrity: string
}

type ArtifactRef =
  | (ArtifactSourceRevision & { target: { kind: 'online' } })
  | (ArtifactSourceRevision & {
      target: {
        kind: 'local-material'
        materialId: string
        materialVersion: string
        buildIntegrity: string
      }
      rollbackTo: ArtifactSourceRevision
    })
```

The Project stores only a versioned, namespaced `ArtifactRef`; source, CSS, dependency locks, safe manifest, diagnostics, provenance, and immutable revisions belong to the Artifact Store. `logicalComponentId` is product identity across revisions and targets. `materialId`/`materialVersion` is durable registry identity. Promotion switches the `ArtifactRef` target without changing node id, layout, props, bindings, or the trusted proxy `componentName`.

## ADR-AR-005 — Configure annotation boundary

**Decision:** Accepted.

The Dashboard compiles existing material metadata plus a pure JSON annotation overlay into a `SafeMaterialManifest`.

```ts
interface ConfigureFieldAnnotation {
  fieldId: string
  access: 'read-only' | 'read-write' | 'unsupported'
  readPath?: ProjectionPath
  writeTargets?: readonly WriteTarget[]
  unsetTargets?: readonly WriteTarget[]
  valueSchema?: JsonValueSchema
  verifyPaths?: readonly ProjectionPath[]
}
```

Callbacks and dynamic semantics do not cross the boundary. Callback-backed fields require an explicit safe mapping. Missing or ambiguous mappings compile as `unsupported`; the compiler never guesses. Baseline fixtures cover id, title, rect, visibility/condition, root-image rename, and Image multi-write behavior.

## ADR-AR-006 — Surface-local generated overlay plane

**Decision:** Accepted subject to the Phase 0 browser spike.

Each mounted editor or standalone preview surface owns one iframe, coordinator, overlay plane, MessagePort set, and lifecycle. Coordinates are canvas-local within a stable surface viewport mount; integration must not query private CSS selectors.

Generated visuals occupy one plane above normal materials. Arbitrary per-instance interleaving with normal materials is not promised. The iframe is `pointer-events: none`; trusted editor shells own selection/drag and controlled events, while preview shells bridge only allowlisted normalized runtime events. Native focus and arbitrary keyboard/input/drag-drop behavior are outside the pilot.

The spike must prove zoom, scroll, resize, root clipping, device scale, BemTools order, click-through, surface cleanup, and a safe-boot marker. Requiring arbitrary interleave or hard CPU containment reopens this ADR.

## Feature flags and rollback

Phase 0 freezes four independent environment inputs:

| Capability | Environment variable | Default |
|---|---|---|
| runtime composition | `VITE_DASHBOARD_AGENT_RUNTIME` | off |
| data capabilities | `VITE_DASHBOARD_AGENT_DATA` | off |
| online components | `VITE_DASHBOARD_AGENT_ONLINE` | off |
| local promotion | `VITE_DASHBOARD_AGENT_PROMOTION` | off |

The resolver is pure, side-effect free, and accepts only boolean `true`, string `"true"`, or string `"1"` as enabled. The four resolved values remain independent policy inputs; later composition requires the runtime flag plus the relevant capability flag before mounting or granting authority. Disabling flags must not delete durable data or silently hand canonical storage authority back to a legacy writer.

## Deterministic fixtures and performance boundaries

The Golden project fixture is a 1920×1080 city operations dashboard with a fixed title, map, chart, mock/HTTP endpoints, a missing KPI material, and deterministic ids, artifact hashes, timestamps, clock, and model script.

Performance evidence uses a fixed browser, viewport, CPU profile, and runner with at least five warmed runs:

- 200 nodes and 20 online instances per surface;
- drag/resize median FPS at least 55, with P95 frame interval, long-task count, and raw trace;
- Core ChangeSet commit P95 below 50 ms, measured from host atomic-commit entry to `TransactionResult`, excluding model, network, and IndexedDB work;
- one iframe update batch per animation frame;
- no growth in registrations, MessagePorts, listeners, or artifact object URLs.

## Non-goals for the pilot

- Agent-specific Core APIs, raw schema/command access, or a second History implementation.
- Generated code in the host realm, direct network/storage/navigation authority, or secrets in the browser.
- Hard preemption of a synchronous infinite loop inside a same-tab iframe.
- Arbitrary generated/normal material interleaving.
- Cross-step task atomicity or Core/IndexedDB exactly-once claims.
- Inferring Agent authorship from matching values.
- Generic material-authoring, artifact-store, or provider packages before a second real host exists.

## Phase 0 acceptance and rollback

Phase 0 is complete when current baselines pass, the Core public surface remains Agent-free, this ADR anchor test and the four-flag resolver tests pass, the overlay and ArtifactRef/configure spikes report evidence, and default application behavior is unchanged.

Rollback removes this document, the isolated spikes, the default-off flag resolver, their tests, and the deferred release note. No data migration or production cleanup is required because Phase 0 grants no authority and changes no runtime boot path.
