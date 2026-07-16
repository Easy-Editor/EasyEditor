# Agent Runtime Dashboard Phase 3A Durable Storage

**Status:** Accepted for implementation\
**Scope:** Phase 3A only\
**Source of truth:** the approved Agent Runtime Dashboard PRD, test specification, and Phase 0 contracts

Phase 3A establishes one durable project writer before any writable Agent capability is enabled. It adds no semantic mutation tool and does not move Agent metadata into `@easy-editor/core`.

## Invariants

1. `ProjectPersistenceCoordinator` is the only writer for a project/branch working draft, manual save, autosave, Agent durable commit, named version, and storage migration.
2. The canonical project clock is `draftGeneration`. Worker session checkpoints use a separate `persistenceGeneration`; the two clocks share serialization infrastructure but never share compare-and-swap state.
3. Core memory and IndexedDB are separate atomic domains. `AgentHost.invoke()` may return `applied` only after the coordinator commits the canonical draft and its receipt lineage in one IndexedDB transaction.
4. A pending receipt intent is not proof of an applied effect. Historical recovery requires a matching immutable durable receipt and Apply/Failure witness. It never compares that historical outcome with the mutable current draft head or current provenance.
5. Storage rollout is Bridge-first. Disabling Agent feature flags never transfers canonical authority back to a legacy writer.
6. Migration and downgrade are marker-last. An interrupted operation leaves the previous canonical backend authoritative and never deletes source localStorage values.
7. Phase 3A registers no writable Agent capability and changes no Core mutation behavior.

## Canonical working draft

```ts
interface CanonicalWorkingDraftV1 {
  schemaVersion: 1
  projectId: string
  branchId: string
  draftGeneration: number
  activeDocument: {
    documentId: string
    fileName: string
    index: number
  } | null
  projectSchema: JsonObject
  projectHash: `sha256:${string}`
  commitKind: 'migration' | 'autosave' | 'manual-save' | 'agent-batch' | 'version-restore'
  updatedAt: number
}
```

`projectId` is persisted once. A missing schema id must not create a new identity on each load. The initial branch is the stable literal `main`. `projectHash` is SHA-256 over a full canonical JSON serialization: object keys sorted lexicographically, array order preserved, and non-JSON/cyclic/non-finite values rejected. The snapshot projection hash is not reused because it is intentionally filtered and bounded.

## Generation separation

- `draftGeneration` is scoped to `{projectId, branchId}` and advances only with a canonical project commit.
- `persistenceGeneration` is scoped to `{projectId, branchId, sessionId}` and advances only with a Worker session-record commit.
- Runtime persistence batches are idempotent by `{session key, batchId, requestHash}`. Reusing a `batchId` with different bytes is rejected.
- Runtime records are upserted by `recordId`; one task checkpoint cannot erase unrelated task/session records.
- A stale expected generation performs no writes.

The Dashboard `AgentPersistencePort` delegates to narrow coordinator methods over an atomic `agentSessions` + `taskJournals` + `agentCheckpoints` transaction. `agentCheckpoints` stores the canonical request hash and original commit result so ACK-loss retry remains idempotent across page/Worker restart. A generation-conflict result is durable for that batch identity and never advances either clock.

The serialized DTO boundary may retain versioned compatibility readers, but new writes use the explicit `persistenceGeneration` name. No runtime session generation is treated as proof of a canonical project generation.

## IndexedDB schema

Database: `easy-editor-dashboard-storage`\
Schema version: `1`

| Store | Key path |
| --- | --- |
| `projects` | `projectId` |
| `workingDrafts` | `[projectId, branchId]` |
| `projectVersions` | `[projectId, branchId, versionId]` |
| `agentSessions` | `[projectId, branchId, sessionId]` |
| `taskJournals` | `[projectId, branchId, sessionId, recordId]` |
| `toolReceipts` | `[projectId, branchId, callId]` |
| `receiptIntents` | `[projectId, branchId, callId]` |
| `applyWitnesses` | `[projectId, branchId, callId]` |
| `failureWitnesses` | `[projectId, branchId, callId]` |
| `mutationProvenance` | `[projectId, branchId, slotKey]` |
| `agentCheckpoints` | `[projectId, branchId, checkpointId]` |
| `artifacts` | `[projectId, artifactId, sourceRevision]` |
| `artifactRefs` | `[projectId, branchId, ownerType, ownerId, artifactId, sourceRevision]` |
| `grants` | `[userId, projectId, scope, policyVersion]` |
| `migrationState` | `[projectId, branchId]` |

All upgrade work is local and resumable. No network request runs from `onupgradeneeded`.

Schema version `1` is the first released Dashboard IndexedDB schema, so this phase has no real `N-1` or `N-2` release to model. The executable upgrade baseline therefore uses IndexedDB `oldVersion = 0` plus a partial-v1 interruption/resume fixture; it does not invent negative or fictional schema versions. The first future schema bump must retain the real v1 fixture as `N-1` and add older fixtures only when those versions actually existed.

## Durable batch

The coordinator serializes requests per project/branch and performs compare-and-swap inside the same read-write transaction that commits the next draft. One Agent durable batch contains:

- the complete canonical working draft;
- the committed or failed tool receipt;
- its Apply or Failure witness;
- affected provenance slot updates;
- journal head and minimal verified-step checkpoint;
- artifact-reference deltas when present;
- the next `draftGeneration`.

Any store error aborts the whole batch. A successful IDB transaction is the only durable commit point. The stable error codes are `generation-conflict`, `validation-failed`, `read-only-compatibility`, `storage-unavailable`, `database-blocked`, `quota-exceeded`, `transaction-aborted`, `integrity-mismatch`, `migration-failed`, and `disposed`.

## Receipt and provenance lineage

`ReceiptIntent` is written before a future Core mutation but remains `pending`. It cannot be promoted by comparing values.

- A durable receipt whose embedded witness reference exactly matches the immutable ApplyWitness returns the original committed receipt after ACK loss.
- A durable failed receipt whose embedded witness reference exactly matches the immutable FailureWitness returns the original failed/not-applied result.
- Missing, malformed, ambiguous, authority-mismatched, or byte-mismatched receipt/witness evidence is `indeterminate`.
- A later manual save, autosave, version restore, or Agent commit does not revoke an already terminal historical receipt. Current draft generation and current provenance are not historical recovery evidence.
- `mutationProvenance` is mutable current-last-writer evidence used for compensation safety. An Agent commit writes exact `agent:<callId>` slots at its committed generation. A schema-changing ordinary non-Agent commit (manual save, autosave, or version restore) with no trusted provenance plan atomically rewrites every current in-scope `agent:*` slot to `unknown` at the next `draftGeneration`; a same-hash ordinary save preserves current provenance. Every migration that actually advances the canonical generation also invalidates current Agent provenance because the legacy interval is provenance-blind and may have changed away from and back to the same bytes. Only an equal-generation same-hash migration no-op preserves provenance. The coordinator-controlled invalidation runs before any same-batch trusted provenance puts, so an exact plan may replace the conservative fallback.
- Generation conflict, quota failure, or transaction abort changes neither the working draft nor its provenance records.
- A human independently producing the same value remains `human`; it is never attributed to the Agent.
- Ambiguous paths, missed listeners, restart gaps, or unclassified plugins write `unknown`, never a stale Agent token.

Canonical slot keys cover field paths plus structural node-existence, parent, and sibling-order aliases. Ancestor/descendant writes invalidate each other's provenance for later compensation. Compensation may rely on current exact Agent provenance; `unknown` is intentionally insufficient and blocks an unsafe rollback without changing the historical receipt classification.

## Bridge, migration, and downgrade

The identity pointer key is `easy-editor:storage:active:v1`; once created it keeps a stable `projectId` and initial branch `main`. The compatibility marker key is `easy-editor:storage:compatibility:v1`:

```ts
interface StorageCompatibilityMarkerV1 {
  schemaVersion: 1
  writerVersion: 1
  canonicalBackend: 'legacy-local-storage' | 'indexeddb'
  minReaderVersion: 1
  projectId: string
  branchId: string
  draftGeneration: number
  projectHash: `sha256:${string}`
  updatedAt: number
}
```

Rollout policy is independent from `VITE_DASHBOARD_AGENT_*` flags:

1. `bridge`: legacy remains canonical, but loaders/writers understand the marker and reject unsupported readers.
2. `indexeddb`: migrate to IndexedDB, keep a rollback-window compatibility snapshot, and keep IndexedDB canonical.

Migration precedence is a valid complete `projectSchema`, then page fragments only when the complete value is absent or malformed. Fragment reconstruction preserves multi-page data and available project-level metadata, records diagnostics for malformed/partial/duplicate input, and never deletes source values on failure. The marker changes to `indexeddb` only after the canonical draft is durable.

Migration diagnostics are durable records in `migrationState`, never console-only evidence. Successful migration writes its `draft-committed` state in the same transaction as the canonical draft. Invalid or partial legacy input, where no draft may be created, is recorded through a narrow coordinator-owned migration-state transaction before the typed migration failure is returned. Bridge code never writes an IndexedDB store directly.

Forward migration carries the source marker generation as `sourceDraftGeneration`. A source older than the current IndexedDB draft is rejected; equal generations with different hashes are divergent and require recovery. When a newer Bridge-managed legacy source re-enters IndexedDB, the migrated draft advances from the greater source generation rather than resetting to the older backend generation. Migration is the only commit kind allowed to make such a generation jump; ordinary commits still advance exactly once.

The first active project pointer is claimed under one fixed origin-wide identity lock. After identity exists, every migration, compatibility refresh, explicit downgrade, bootstrap marker seed, and ordinary project commit for that project/branch is linearized by the same origin-wide authority lock. Migration re-reads the compatibility marker and legacy candidate inside that lock; its IndexedDB commit or reconciliation and marker finalize remain in the same critical section. Lock order is always identity lock first and project/branch authority lock second, with no nested reacquisition.

`materializeLegacyFromCanonical` writes the complete project key and page keys, reads them back, verifies hash/generation, and changes the marker to `legacy` last. A crash at any earlier point leaves the marker on `indexeddb`. Forward re-entry compares generation and hash; stale legacy bytes never overwrite a newer IndexedDB draft.

During the rollback window, each successful canonical commit queues a best-effort full legacy compatibility snapshot after the IndexedDB transaction. Snapshot writes are ordered by the same project/branch save queue and origin authority lock, fenced by a persistent monotonic generation/hash record, verified by read-back, and finish by refreshing an `indexeddb` marker; they never transfer canonical authority. Failure may leave an older compatibility snapshot, but the marker remains on IndexedDB and explicit downgrade must rematerialize from the latest canonical draft. A stale runtime cannot overwrite newer compatibility bytes even when the newer runtime crashed before its marker finalize.

## Dashboard save behavior

- Manual save awaits coordinator flush and reports success only after durable completion.
- Preview opens an empty same-origin window synchronously from the click, awaits the durable flush, then navigates that window to `/preview`. Failure leaves an explicit unsaved error rather than navigating stale data.
- Autosave is debounced but enters the same project/branch queue.
- `pagehide` may request a best-effort flush. `beforeunload` can warn about pending work but must not claim it can await IndexedDB reliably.
- Preview and editor load the same canonical full project and active-page metadata.

## Phase 3A stop condition

Phase 3A is complete only when Memory and real-browser IndexedDB backends pass the same coordinator contract; writer races, quota/abort, ACK loss, page/Worker crash, migration precedence, interrupted downgrade, and forward re-entry are covered; direct storage-writer scans allow only the coordinator and legacy compatibility adapter; and Dashboard, Agent Runtime, Core, public API, type, lint, build, and browser gates are green.
