# Agent Runtime Dashboard Phase 3B Semantic Writes

**Status:** Review revision 7; implementation in progress\
**Scope:** Phase 3B only\
**Source of truth:** the approved Agent Runtime Dashboard PRD, test specification, Phase 0 contracts, and accepted Phase 3A durable-storage design

Phase 3B enables the first writable Dashboard Agent capability. It adds a Core-neutral atomic mutation guard and exact unset semantics, compiles high-level Dashboard operations into the existing closed Core command set, and joins the Core transaction outcome to the Phase 3A durable receipt lineage. It also defines human-priority yielding and task-scoped conditional compensation. It does not add session UX, data capabilities, online components, local promotion, or the Gateway.

## Invariants

1. `@easy-editor/core` remains Agent-free. Core may know a document mutation version, typed version conflict, exact property removal, typed commands, and History; it never knows `callId`, task/session metadata, receipts, witnesses, provenance, compensation, or persistence.
2. The authoritative stale-write guard runs inside `runOnDocument`: after document binding and command preflight, but before History/resource acquisition and the first mutation. A Host snapshot comparison is useful prepare validation, not the atomic correctness boundary.
3. One semantic ChangeSet is compiled into one closed typed-command batch. A rejected or net-zero batch is History-transparent; a schema-changing batch creates exactly one normal Core History unit.
4. The write order is fixed: prepare, durable pending intent, Core provisional outcome, one durable coordinator batch, then Worker acknowledgement. No success acknowledgement is emitted before the Phase 3A batch commits.
5. A Core commit followed by a failed durable batch is `applied-undurable`. The Runtime pauses, performs a full observation, and never proceeds to the next step or blindly retries that semantic effect.
6. Historical receipt recovery and compensation safety use different evidence. Immutable receipt plus Apply/Failure witness classifies a historical terminal outcome. Mutable current provenance is used only to decide whether compensation is still safe; later ordinary edits do not revoke an already terminal historical receipt.
7. A stable `{projectId, branchId, callId}` produces at most one durable accepted effect. Unknown results query the durable lineage before any recovery decision. A pending intent or value equality alone never proves authorship.
8. Human pointer or keyboard activity has priority. The Host waits for the short activity lease to clear, captures a fresh revision, and still relies on the Core mutation-version guard. A stale write yields, re-observes, and can schedule at most one replacement commit for that plan step.
9. Task compensation is conditional, receipt-driven, reverse ordered, resumable, and provenance-safe. It preserves later human/external work even when the user changed a value away and back to the Agent post-image.
10. A compensation cursor advances in the same durable coordinator batch as the inverse receipt, witness, provenance, working draft, journal, and checkpoint. Cursor-only or receipt-only progress is forbidden.
11. Each inverse ChangeSet is a normal Core History unit. Phase 3B does not add a second undo stack and does not claim that an entire task compensation is one History unit.
12. Forced restoration belongs to a named Project Version and remains outside task compensation.
13. A terminal Screen receipt is usable only when its immutable `ReceiptIntent` is present and both the capability-domain prepared hash and transaction fingerprint can be recomputed from that persisted intent. A terminal receipt/witness without reconstructible prepared evidence is indeterminate, not grandfathered.

## Core-neutral transaction seam

`BoundTransactionOptions` gains one declarative option:

```ts
interface BoundTransactionOptions {
  readonly expectedMutationVersion?: number
  // existing callback options remain unchanged
}
```

- Omitted or `undefined` means no check.
- `null`, negative values, fractions, `NaN`, and infinities fail with a typed validation error before any visible effect.
- A mismatch throws `DocumentMutationVersionConflictError` with public `documentId`, `expected`, and `actual` fields. Host code checks the error type, never its message.
- `expectedMutationVersion` cannot be combined with any executable `precondition`, `postcondition`, or `settledPostcondition`. Declarative version guarding remains available under both `legacyTrusted` and `agentRestricted`; executable callback policy is not relaxed.
- The version comparison happens after command preflight. Therefore malformed commands still fail as command validation errors and neither failure path acquires History, material, mutation-boundary, or event resources.
- The document mutation version is monotonic across rollback. Returning to the same raw schema does not make an old version valid again.

`UpdatePropsCommand` gains exact deletion fields:

```ts
interface UpdatePropsCommand {
  readonly unsetPropPaths?: readonly string[]
  readonly unsetExtraPaths?: readonly string[]
}
```

Each entry is a canonical property path relative to `props` or `extras`. The Core string form uses its existing unescaped dot/bracket grammar; the Dashboard compiler keeps paths as segment arrays and converts only at the Core boundary. Phase 3B therefore rejects any Dashboard path segment that is empty/whitespace-only, dangerous, non-canonical, or contains `.`, `[` or `]`. A material field requiring one of those reserved characters is unsupported and is omitted from the writable manifest instead of being encoded lossy. Provenance remains segment-based and uses the existing RFC 6901 escaping. Paths are bounded by segment count, segment length, and total encoded length and are canonicalized before comparison. The validator rejects duplicates, ancestor/descendant overlap within an unset list, and overlap between a set patch and an unset path. An absent valid path is an idempotent no-op. A successful unset means that the key is absent from `exportRaw()`; explicit `null` and `undefined` values are never deletion signals and remain exportable values. `Prop.unset()` emits the same generic property/designer invalidation events as an equivalent `setValue()` mutation.

## Dashboard semantic ChangeSet contract

The Worker sees semantic Dashboard operations, never Core command class names or raw callback-bearing material configuration.

```ts
interface ScreenChangeSetV1 {
  readonly schemaVersion: 1
  readonly documentId: string
  readonly operations: readonly ScreenOperationV1[]
}

type ScreenOperationV1 =
  | { readonly opId: string; readonly type: 'insert'; readonly parentId: string; readonly componentName: string; readonly position?: RelativePositionV1; readonly fields?: Readonly<Record<string, JsonValue>> }
  | { readonly opId: string; readonly type: 'move'; readonly nodeId: string; readonly parentId: string; readonly position?: RelativePositionV1 }
  | { readonly opId: string; readonly type: 'resize'; readonly nodeId: string; readonly rect: RectV1 }
  | { readonly opId: string; readonly type: 'set'; readonly nodeId: string; readonly fieldId: string; readonly value: JsonValue }
  | { readonly opId: string; readonly type: 'unset'; readonly nodeId: string; readonly fieldId: string }
  | { readonly opId: string; readonly type: 'reorder'; readonly nodeId: string; readonly position: RelativePositionV1 }
  | { readonly opId: string; readonly type: 'remove'; readonly nodeId: string }

type RelativePositionV1 =
  | { readonly place: 'first' }
  | { readonly place: 'last' }
  | { readonly place: 'before'; readonly siblingId: string }
  | { readonly place: 'after'; readonly siblingId: string }

interface RectV1 {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}
```

Contract rules:

- A ChangeSet has a bounded operation count and byte/JSON-node budget. DTOs are dense, plain, exact-key, accessor-free, finite JSON data.
- `opId` is unique inside the ChangeSet. The Host derives inserted node identity deterministically from the stable `callId` and `opId`, validates collision absence, and persists the prepared identity in the receipt intent. The model cannot inject a raw `NodeSchema` or callback.
- `set` and `unset` use stable safe-manifest `fieldId` values. The compiler expands manifest `writeTargets`/`unsetTargets`, validates the declared value schema, and rejects unsupported/read-only/ambiguous fields. `resize` is the explicit semantic form of the safe `shared.rect` field.
- `insert.fields` uses the inserted material's safe manifest. Inserts are one node at a time; larger trees are expressed as multiple ordered operations, preserving per-node validation and deterministic identity.
- `move` may change parent. `reorder` stays in the current parent. An omitted insert/move position means `last`. Relative anchors are resolved during prepare and recorded; the public operation never relies on an unstable raw array index.
- Operations are compiled against one captured full projection and one bound Core document. Unknown document/material/node/parent/sibling, duplicate identity, illegal ancestry, unsafe value, ambiguous mapping, or stale manifest fails closed before an intent is written.
- Compilation is sequential over a pure shadow document. A later operation may address a node inserted earlier in the same ChangeSet. A removed node cannot be addressed later. Overlapping writes to the same field/alias, structural cycles, and order-dependent ambiguous operations reject the whole ChangeSet instead of being guessed or partially applied.
- The compiler returns immutable Core-command-shaped data plus pre-images, expected post-images, inverse semantic operations, affected canonical provenance slots/aliases, structural anchors, and deterministic prepared/fingerprint inputs. It performs no mutation and no persistence.

## Prepare and commit protocol

For `screen.applyChangeSet`, the trusted Host performs these steps:

1. Validate semantic-call shape and authority; query an existing durable receipt for the same call first.
2. Wait for the human activity lease to be idle, capture its activity generation plus a full snapshot, and require `expectedRevision` to match it.
3. Bind the active document, capture its `mutationVersion`, load the exact material-registry manifests, and compile the pure ChangeSet. Recheck activity generation and provider/manifest generations immediately before the intent write.
4. Persist one immutable pending `ReceiptIntent`. The existing Phase 3A exact DTO is retained: `baseRevision` stays top-level, while `preImages` and `expectedPostImages` hold versioned prepared payloads containing base mutation version, inverse plan, aliases, deterministic inserted identities, and structural anchors. Phase 3B does not add unrecognized top-level fields to `ReceiptIntentV1`.
5. Execute the compiled commands once through `runOnDocument(document, commands, { expectedMutationVersion })`.
6. Classify the Core outcome by comparing the canonical raw schema captured before and after the transaction:
   - normal `TransactionResult` with a raw-schema change: provisional applied;
   - normal `TransactionResult` with identical raw schema: no change;
   - `TransactionCommittedError`: compare the canonical raw schema again; a changed schema is provisional applied with observer error and is never retried, while an unchanged schema is `NO_CHANGE`;
   - ordinary rollback-complete error: not applied;
   - `TransactionRollbackIncompleteError`: indeterminate, full observe, pause.
7. For a provisional apply, export the complete project, build the immutable ApplyWitness and exact `agent:<callId>` provenance updates. For a rollback-complete failure, build a FailureWitness and no Agent provenance.
8. Commit the canonical working draft, terminal receipt, witness, provenance, journal/checkpoint, artifact-reference deltas, and next `draftGeneration` through one `commitDurableAgentBatch` transaction.
9. Only a successful coordinator transaction returns a durable `applied` or `not-applied` outcome to the Worker. `InvocationStatus` is not extended. Stale/activity outcomes use `not-applied` plus `failure.code = STALE_REVISION | HUMAN_ACTIVITY`. A post-Core durable failure has no terminal receipt because the durable batch failed: the current `InvocationResult` is synthetic `indeterminate/APPLIED_UNDURABLE`, `retryable: false`, with a required-pause detail, while later `queryReceipt` sees intent-only lineage and returns synthetic indeterminate recovery evidence.
10. Runtime verification obtains a new observation and checks the affected projection; the tool return value alone is not verification.

The two opaque `ReceiptIntentV1` image fields use these exact Dashboard-owned payloads. They are strict, accessor-free JSON DTOs; unknown or missing keys make the lineage indeterminate instead of being guessed:

```ts
interface ScreenChangeSetPreImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'screen-change-set-pre-images'
  readonly documentId: string
  readonly baseMutationVersion: number
  readonly materialRegistryVersion: string | number
  readonly manifestFingerprints: readonly ScreenManifestFingerprint[]
  readonly insertedNodeIdentities: readonly ScreenInsertedNodeIdentity[]
  readonly operations: readonly ScreenOperationV1[]
  readonly commands: readonly CompiledScreenCommand[]
  readonly images: readonly ScreenChangeImage[]
  readonly inverseOperations: readonly ScreenInverseOperationRecord[]
  readonly affectedFieldSlots: readonly AffectedScreenFieldSlot[]
  readonly affectedStructuralSlots: readonly AffectedScreenStructuralSlot[]
  readonly affectedSlotKeys: readonly string[]
}

interface ScreenChangeSetPostImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'screen-change-set-post-images'
  readonly documentId: string
  readonly images: readonly ScreenChangeImage[]
  readonly affectedFieldSlots: readonly AffectedScreenFieldSlot[]
  readonly affectedStructuralSlots: readonly AffectedScreenStructuralSlot[]
  readonly affectedSlotKeys: readonly string[]
}
```

Relative restore anchors stay inside each `ScreenInverseOperationRecord`; manifest fingerprints, inserted identities, the original semantic operations, the exact compiled command data, and the registry fence remain in the pre-image payload. The persisted data is deliberately sufficient to reconstruct both integrity inputs after restart:

- `preparedHash` hashes an exact versioned envelope containing the `screen.applyChangeSet` capability domain, project, branch, call ID, base revision, pre-images, and expected post-images;
- the transaction fingerprint hashes a separate exact versioned envelope containing the capability domain, call/document identity, base mutation version, registry version, manifest fingerprints, inserted identities, and compiled commands.

Recovery clones and hashes the raw persisted payload before normalization, then applies the strict exact-key, accessor-free, dense, bounded, canonical-order parser. A prepared-hash mismatch, transaction-fingerprint mismatch, malformed/legacy payload, missing intent, or receipt/intent mix-and-match produces an indeterminate result. It never projects a terminal Screen result.

No-op ChangeSets are valid only when the compiled batch is semantically well formed. They produce no Core History unit. They receive a terminal durable `not-applied` receipt with `failure.code = NO_CHANGE`, a FailureWitness, empty Agent provenance, the unchanged schema, and the next durable draft generation so ACK-loss recovery cannot cause a later replay. Direct and recovered `NO_CHANGE` results mean “step already satisfied”: Runtime verifies/checkpoints without consuming repair budget.

## Core outcome and receipt recovery

`queryReceipt({projectId, branchId, callId})` first checks the constant-key compensation-run record and otherwise delegates to `recoverDurableAgentReceipt`:

- `committed` returns the original immutable applied receipt together with its immutable receipt intent;
- `failed` returns the original rejected/not-applied receipt together with its immutable receipt intent;
- `missing` returns `null` only when no intent and no terminal lineage exists;
- intent-only, missing-intent terminal, malformed, incomplete, authority-mismatched, or witness-mismatched lineage returns an indeterminate synthetic receipt. It never becomes a terminal outcome by comparing the current draft value.

The generic persistence seam validates the shared receipt/intent/witness linkage. Before exposing a terminal `screen.applyChangeSet` result, the Dashboard Host additionally performs the capability-specific prepared-hash and transaction-fingerprint verification above. Dashboard-private intent payloads are not exposed to the Worker.

`ToolReceipt` gains a generic `failure: AgentRuntimeFailure` field with status-bound integrity. An `applied` receipt forbids `failure`. A durable `not-applied` or `rejected` receipt requires `failure`, and `failure.code` must exactly equal both the immutable `FailureWitness.failureCode` and the failure witness reference embedded in the receipt. Synthetic indeterminate receipts also require a failure that explains why no terminal outcome can be proven. Dashboard persists the field on terminal failure/no-change/stale receipts and returns it unchanged after ACK loss. `APPLIED_UNDURABLE` is never a persisted receipt code because its durable batch did not commit. Runtime never parses a Dashboard-private witness body to choose control flow.

Phase 3A's accepted rule is authoritative: later current-provenance changes do not invalidate an immutable historical receipt/witness pair. Current provenance is deliberately excluded from historical outcome classification and is read separately by compensation.

## Human-priority activity lease

The Dashboard main thread owns a short-lived project/document activity lease. Pointer and keyboard edits renew it; passive pointer movement does not. The lease exposes only `waitUntilIdle()`, `isActive()`, and a monotonic activity generation to the Host.

- Prepare may wait for an active lease, but never holds storage or Core transaction resources while waiting.
- After the lease clears, Host captures the full revision, mutation version, provider generations, and activity generation again.
- Host compares activity, provider, material-registry, and manifest semantic generations before the intent and immediately before Core execution. If one changes before the intent, no durable record is needed. If activity changes after the intent, Host atomically terminalizes that call as `not-applied/HUMAN_ACTIVITY`; if provider/registry/manifest generation changes or the Core version guard conflicts, it terminalizes as `not-applied/STALE_REVISION` with a typed reason in `failure.details`. Every terminal stale/activity outcome has a FailureWitness; an intent-only poison record is forbidden.
- The Runtime persists a `YIELDED` transition, performs one full observation, and returns to planning. `YIELDED` is a Runtime phase, not a new invocation status.
- Repeated lease renewal coalesces into the same yield episode. Release schedules at most one replan/commit attempt for the current step; continuous dragging cannot create a retry loop.

## Mutation attribution and autosave ordering

The Dashboard persistence runtime owns mutation attribution. The Screen and compensation adapters enter a synchronous `agent:<callId>` scope only around the bound Core transaction. Designer/project listeners suppress ordinary autosave attribution while that scope is active, so an Agent transaction cannot be relabeled as a human or external edit by its own synchronous events.

Outside that scope, a listener observed while the activity lease is active records `human`; a programmatic/plugin mutation observed without the lease records `external`. Missing event identity, project/document replacement, cyclic or array-backed values, and any path/structure that cannot be mapped exactly record `unknown` and force conservative retirement of current Agent provenance. Field attribution covers the exact path, every ancestor, and observed descendants. Structural attribution covers node existence, parent, subtree, and affected parent children order, including away-and-back moves and identity reuse.

Attribution is sequence-stamped and consumed only by the exact successful canonical save that persisted it. A newer event arriving while an older save is in flight remains pending. Before an Agent or compensation durable write enters the single-writer queue, any scheduled human/external autosave is captured synchronously and committed first; a failed autosave blocks the Agent write and retains its attribution for recovery. Same-byte ABA changes therefore still retire the old Agent token instead of inheriting authorship from hash equality.

## Conditional task compensation

The public orchestration argument is intentionally small:

```ts
interface TaskCompensateArgumentsV1 {
  readonly schemaVersion: 1
  readonly targetTaskId: string
}

interface RuntimeTaskCallIndexEntryV1 {
  readonly callId: string
  readonly capability: string
}

interface RuntimeTaskCompensationTargetV1 {
  readonly schemaVersion: 1
  readonly taskId: string
  readonly sessionId: string
  readonly phase: 'COMPLETED' | 'CANCELLED'
  readonly callIndexComplete: true
  readonly callIndex: readonly RuntimeTaskCallIndexEntryV1[]
}

interface HostInvocationContextV1 {
  readonly schemaVersion: 1
  readonly compensationTarget?: RuntimeTaskCompensationTargetV1
}

interface HostInvokeRequestV1 {
  readonly schemaVersion: 1
  readonly call: SemanticCall
  readonly context: HostInvocationContextV1
}
```

The target must resolve to a durable Runtime-owned `task:<targetTaskId>` record in the same project, branch, and authorized session as the outer call. Only `COMPLETED` or `CANCELLED` tasks may be selected. The current running task, a foreign-session task, an unknown task, and a task already owned by a different active compensation run reject before a run head is created. `AgentHost.invoke` has the exact signature `invoke(call: SemanticCall, context: HostInvocationContextV1)`; the `host.invoke` RPC request is the exact-key `HostInvokeRequestV1` envelope above. Runtime constructs `context` only after strict model-event validation. The RPC parser and Host reject unknown/accessor fields, a compensation target on any other capability, a missing target on `task.compensate`, target/call session mismatch, target ID mismatch, incomplete/duplicate call indexes, and an index containing `task.compensate`. The compensation follow-up task owns its own append-only call index; original task receipts are never rewritten or re-parented.

The compensation planner reads only terminal applied receipts listed by the selected task's durable task-call index and walks them in reverse durable order. Each original receipt derives a stable inverse call ID from `{projectId, branchId, outerCompensationCallId, originalCallId}`.

Before each inverse, the planner re-observes and reads current provenance. Every affected field/structure must satisfy both:

1. the current post-image/fingerprint still matches the original Agent post-image; and
2. every exact and alias slot still carries the durable token `agent:<originalCallId>`.

Missing, `unknown`, `human`, `external`, different Agent tokens, ambiguous paths, id reuse, or incomplete aliases produce a conflict and no mutation. Equality after an away-and-back human edit remains a conflict because the token is no longer the original Agent token.

Field aliases include exact path, all ancestors, and the prepared affected descendant set. Structural aliases include node existence/subtree/parent and old/new parent children order. Relative sibling anchors, not raw indices, decide whether a deleted node can be restored. A created node is removed only if its subtree and all relevant aliases remain untouched. A later human move is preserved.

```ts
interface CompensationRunBaseV1 {
  readonly schemaVersion: 1
  readonly compensationRunId: string
  readonly outerCallId: string
  readonly sessionId: string
  readonly taskId: string
  readonly cursor: number
  readonly originalCallIds: readonly string[]
  readonly conflicts: readonly CompensationConflictV1[]
}

type CompensationRunV1 = CompensationRunBaseV1 & (
  | { readonly status: 'running' | 'completed' | 'completed-with-conflicts'; readonly pause?: never }
  | {
      readonly status: 'paused'
      readonly pause: {
        readonly code: 'APPLIED_UNDURABLE' | 'AMBIGUOUS_RECEIPT' | 'PROVENANCE_UNCERTAIN' | 'PERSISTENCE_FAILURE'
        readonly resumeSafe: false
        readonly failure: AgentRuntimeFailure
      }
    }
)

interface CompensationConflictV1 {
  readonly originalCallId: string
  readonly inverseCallId: string
  readonly code: 'POST_IMAGE_CHANGED' | 'PROVENANCE_CHANGED' | 'ANCHOR_INVALID' | 'IDENTITY_REUSED' | 'AMBIGUOUS'
  readonly slotKeys: readonly string[]
}

interface CompensationTargetClaimV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly targetTaskId: string
  readonly outerCallId: string
  readonly status: 'active'
}
```

`task.compensate` uses a two-level causal protocol:

1. The Runtime call ID is the stable outer orchestration ID. The Host derives `compensationRunId` from it and creates or resumes exactly one `compensation-run:<outerCallId>` journal head. The same initial coordinator transaction atomically adds `compensation-target:<targetTaskId>` as a `CompensationTargetClaimV1`. An existing claim for the same outer call is an idempotent resume; an existing claim for another outer call rejects before any inverse. The outer call does not create a mutation ReceiptIntent and is not itself a Core effect.
2. Every original applied receipt has one stable inverse call ID. That inverse uses the normal intent -> Core/failure -> receipt/witness pipeline. Its terminal receipt, witness, provenance, next working draft, run cursor, conflicts, journal head, and unique cursor checkpoint commit in one Agent durable batch. The journal head is the batch's single `journal` record; no second run record is required.
3. A conflict is a normal derived inverse call with a terminal `not-applied/COMPENSATION_CONFLICT` FailureWitness and the advanced cursor in the same batch. A task with no applied receipts uses one stable empty-run derived call and terminalizes the run without a Core mutation.
4. The last inverse batch writes the run head status `completed` or `completed-with-conflicts` and deletes `compensation-target:<targetTaskId>` in the same transaction. A paused run retains its claim until an explicit operator resolution terminalizes it; a page/Worker crash leaves a running claim attached to the same resumable outer call. Every `queryReceipt` performs one constant-key lookup for `compensation-run:<callId>` under the Host's already-bound `{projectId, branchId, sessionId}` authority before ordinary receipt recovery. A missing run head falls through to `recoverDurableAgentReceipt`; no capability discriminator and no backend scan are required. A `running` run projects a synthetic `indeterminate/COMPENSATION_IN_PROGRESS` receipt with `details.resumeSafe = true`. A `paused` run projects its persisted typed pause failure with `details.resumeSafe = false`. A completed run projects a synthetic `applied` receipt with a compensation-run witness. The inverse receipts, not the outer synthetic receipt, are the accepted project effects.
5. Re-invoking the same outer call is allowed only while its durable run is `running` and the projected failure explicitly has `resumeSafe = true`. A paused run is operator-visible and never auto-resumes. Host resumes from the first cursor whose derived receipt is not durably terminal and queries that receipt before execution. This is cursor- and receipt-driven recovery, not blind replay.

No new IndexedDB store is required. Run heads and target claims use exact keys in the existing `taskJournals` store. The coordinator exposes scoped `readCompensationRun({projectId, branchId, sessionId, outerCallId})` and `readCompensationTargetClaim({projectId, branchId, sessionId, targetTaskId})` seams, plus a coordinator-owned `commitCompensationRunState(...)` seam for atomically acquiring the claim with the run head, pausing while retaining the claim, or terminalizing and releasing it before/without an inverse effect. `ReceiptQueryRequest` remains the generic `{projectId, branchId, callId}` contract: Dashboard Host supplies its immutable bound `sessionId` when calling the scoped coordinator seam, so the Worker cannot choose a foreign session. Normal inverse progress continues to use `commitDurableAgentBatch`: the inverse receipt/witness, complete working draft, provenance, run-head journal value, cursor checkpoint, target-claim release when terminal, and artifact deltas commit atomically through the existing coordinator operations. Host code never scans a backend or writes a journal store directly. A crash before an inverse batch repeats only observation/planning; a crash after it resumes at the next cursor.

## Runtime orchestration

Before invoke, Runtime persists a versioned `PendingInvocationV1` inside the task record. The task record shape contains an append-only `callIds` array, a matching append-only `callIndex` of `{callId, capability}`, plus optional `pendingInvocation`; the pending value contains the full structured-clone-safe SemanticCall, state `invoked`, and whether terminal satisfaction completes the task. `pendingInvocation.call.callId` must already occur exactly once in both indexes. Clearing pending state never removes or rewrites either index. On ACK-loss recovery Runtime follows pending call -> exact receipt query -> verification, then fills/persists a provable legacy pending entry before clearing pending. A legacy terminal task whose complete capability index cannot be proven is not eligible for compensation.

Runtime restores every valid task record for the bound session, while the existing deterministic ordering still selects the newest recoverable task for active recovery. For `task.compensate`, Runtime validates the model-facing `{schemaVersion: 1, targetTaskId}` argument, resolves the exact target from its own restored task map, and passes the exact structured-clone-safe `HostInvocationContextV1` above. The `RuntimeTaskCompensationTargetV1` projection contains only the target task ID, session ID, terminal phase, an explicit completeness proof, and complete `{callId, capability}` index. Worker bootstrap serializes `{schemaVersion: 1, call, context}`; the main-thread boundary parser validates that envelope before calling `host.invoke(call, context)`. It is never part of model-controlled arguments. Host requires the projected ID to equal `targetTaskId` and rejects a missing, foreign-session, current, non-terminal, or incomplete projection before creating a run head.

Phase 3B explicitly forbids compensation of a task whose call index contains `task.compensate`. Derived inverse calls are Host-owned saga effects and are intentionally absent from the Runtime task index; forbidding compensation-of-compensation avoids presenting an incomplete lineage as a reversible task. Forced or nested restoration remains a named Project Version workflow outside this phase.

Record ownership is fixed and non-overlapping: Runtime owns `task:<taskId>` through `AgentPersistencePort` and sends only the trusted immutable target projection for the current invoke; Host owns the per-effect coordinator journal `call:<callId>`; compensation owns `compensation-run:<outerCallId>`. Neither Host nor compensation reads, scans, or rewrites Runtime task records, and Runtime never scans or mutates Host receipt/journal stores.

On restart, pending-invocation recovery first queries the same stable call ID. A missing lineage is safe to invoke because the Host protocol cannot reach Core before its intent is durable. An applied or `NO_CHANGE` terminal receipt proceeds to verification. An ordinary indeterminate result pauses. Only `COMPENSATION_IN_PROGRESS` with `resumeSafe = true` may re-invoke the same outer compensation call.

Repair accounting is itself durable. Before the Runtime asks the model for a repair turn, it increments and persists `repairAttempts` together with the `REPAIR` phase and any pending-invocation clear. If the configured budget is already exhausted, it persists `PAUSED` plus `repair-budget-exhausted` in that same transition. A Worker/page crash therefore cannot recover an uncounted repair turn or reset the repair budget.

Result handling is explicit:

- `applied` -> `VERIFY`;
- `not-applied/NO_CHANGE` -> `VERIFY` without repair;
- terminal `not-applied`/`rejected` -> deterministic repair or step failure according to failure code;
- stale/activity conflict -> durable `YIELDED`, full observe, at most one replan;
- timeout/transport fault -> `QUERY_RECEIPT` before any retry decision;
- intent-only, rollback-incomplete, applied-undurable, or ambiguous lineage -> full observe then `PAUSED` with operator-visible failure; never generic blind repair.

Worker replacement preserves the stable pending call ID. Page restart reconstructs it from the durable journal/checkpoint. Compensation uses the same semantic invoke/receipt query path rather than a second mutation transport.

## Phase 3B stop condition

Phase 3B is complete only when:

- Core API/type/framework gates prove version guard, exact unset, event parity, ABA protection, and one-unit/net-zero History behavior under both trust policies;
- `screen.applyChangeSet` compiles every supported semantic operation through safe manifests and never exposes raw Core commands or callbacks;
- the Host passes normal, committed-with-observer-error, rollback-complete, rollback-incomplete, durable-abort, ACK-loss, intent-only, manual/autosave race, page crash, and Worker crash tests;
- the human R1/R2 stale race and continuous-lease scenario preserve user work and produce at most one replan commit;
- compensation passes set/create/move/delete, away-and-back, alias, id-reuse, relative-anchor, inverse crash, and restart matrices while preserving later human/external work;
- Dashboard, Agent Runtime, Core, public API, type, lint, build, browser, Agent-free scans, and the `<50ms` fixed-runner Core commit gate are green;
- independent code review and architecture review report no unresolved P0/P1/P2 findings.
