# Agent Runtime Dashboard Phase 4: sessions, versions, grants, and workspace

## Status

This document freezes the Phase 4 implementation contract for
`G006-phase-4-sessions-versions-and-worksp`. The authoritative product and test
requirements remain:

- `.omx/plans/prd-agent-runtime-dashboard.md`
- `.omx/plans/test-spec-agent-runtime-dashboard.md`
- `.omx/plans/agent-runtime-dashboard-execution-handoff.md`

Phase 4 is complete only when the runtime, storage, editor integration, and
browser flow satisfy this document together. A green Phase 3 suite is necessary
but not sufficient.

## Non-negotiable boundaries

1. `packages/core` remains Agent-free.
2. The Worker owns model orchestration and its task state machine. Dashboard
   Host code owns editor semantics and never exposes `Engine`, `Document`, or
   callbacks to the Worker.
3. Generated code and model output never become an authority boundary.
4. Durable truth is committed before success is acknowledged.
5. All Dashboard persistence writes go through
   `ProjectPersistenceCoordinator`.
6. Core History, Agent Journal, and named Project Versions remain distinct
   concepts and records.
7. A named-version restore creates a new branch and a new session. It never
   rewinds or reuses the old runtime binding.
8. Local grants improve confirmation UX but never replace server-side provider
   authorization.
9. Feature flags can hide or disable the Phase 4 UI without deleting durable
   sessions, versions, grants, journals, receipts, or artifacts.

## Runtime projection and context

`AgentRuntimeSnapshot` is the finite UI projection of the Worker state. Each
task projection includes:

- immutable task identity and lineage (`parentTaskId`, `supersedesTaskId`);
- the submitted intent;
- current phase and timestamps;
- the latest accepted blueprint;
- the completion summary or typed failure/question;
- a deterministic session-context digest.

The context digest contains only bounded, JSON-safe excerpts. It records:

- included task ids in deterministic order;
- source journal start/end positions;
- a deterministic source hash;
- omitted task count;
- unresolved constraints that must survive compaction.

Budgets are explicit and deterministic. Compaction must produce the same DTO for
the same persisted task sequence and budget. Telemetry must not log raw prompts,
business payloads, credentials, or artifact source.

## Session lifecycle

The durable runtime binding is `projectId + branchId + sessionId`.

- Every submit creates a task.
- A submit after a completed task creates a follow-up task with
  `parentTaskId`.
- A submit while a task is active waits for the current atomic call or safe
  yield, cancels only future work, and creates a task with
  `supersedesTaskId`. Already committed calls are not rolled back.
- `respond` is valid only in `WAITING_USER`.
- Reloading the same project branch resolves the active session, or otherwise
  the most recently updated non-closed session, and restores its ancestry.
- A session record has explicit status, timestamps, persistence generation,
  and optional `forkedFrom` metadata.

## Named versions and restore protocol

A named version is an immutable, full restore point containing:

- version id, name, project id, source branch id, and creation timestamp;
- canonical full schema and its hash;
- active document id;
- artifact references;
- optional source session/task/checkpoint ids.

Creating the same version id on the same source branch with different content
is rejected. The Workspace and command boundary identify a version by the
composite `(sourceBranchId, versionId)` key; a project-wide list may legitimately
contain the same version id on different branches. Listing is stable by creation
time, source branch id, and version id.

Restore is a branch fork, not an in-place write:

1. serialize restore submissions and detach editor autosave/listeners;
2. flush or explicitly surface an unsaved failure for the old branch;
3. dispose the old Agent Runtime;
4. resolve the immutable version by its exact composite identity, then durably
   prepare an exact restore request plus source and target fences before the
   target branch can be committed;
5. commit the restored draft, new branch record, new session record, and
   artifact roots through the coordinator;
6. record `forkedFrom { sessionId, taskId, versionId }` and flush the target;
7. write and verify the legacy snapshot payload, then update the compatibility
   marker and active-project identity in that order;
8. mark the prepared transition complete;
9. rebuild persistence, Host, Worker, and Agent Runtime with the new binding;
10. reattach listeners and resume the editor.

Old receipts, pending calls, receipt intents, compensation cursors, and context
cursors are branch-scoped and must not be copied. A pre-commit failure may abort
the prepared transition only while the exact target is absent and the source is
still active. Once the target exists, the pending transition remains durable and
startup recovery replays the stored exact request and ids before completing the
legacy switch; it never scans for a plausible branch. Retrying the same restore
request after completion is idempotent even when the target is already active.

## Grants

Supported local grant scopes are finite:

- `project.write`
- `data.read`
- `online-code.author`
- `dependency.resolve`
- `material.promote.local`

The logical key is user + project + scope + policy version. The record also
captures provider identity/fingerprint. A matching, non-revoked grant suppresses
repeat local confirmation. A new scope, provider, provider fingerprint, or
policy version requires confirmation. Revocation is durable and effective for
the next authorization check.

The grant service returns only a local decision. A Gateway/provider operation
still performs its own authentication and authorization.

## Artifact roots

Phase 4 establishes root bookkeeping without implementing the Phase 6 artifact
runtime. The root projection covers:

- current working drafts;
- named versions;
- verified checkpoints;
- active task journals;
- receipts and pending receipt intents;
- in-progress compensation;
- promotion sagas.

Root enumeration is deterministic and supports a dry-run plan. Later sweeping
must use a generation fence so a concurrent commit cannot cause live artifact
deletion.

## Agent Workspace

The Workspace is a right-side operational rail layered beside, not inside, the
Core editor model. Its visual language is a restrained control-room timeline:

- neutral Dashboard surfaces and existing typography;
- indigo for active Agent work, amber for a safe pause, red for unresolved
  durability/conflict failures, and green only for durable completion;
- the task lineage rail is the signature element and encodes actual task order,
  supersession, and checkpoints rather than decorative numbering.

The rail exposes:

- intent input and task controls;
- blueprint and current phase;
- question/response UI;
- follow-up and refinement lineage;
- named versions and explicit restore;
- local grants and revoke controls;
- unsaved, applied-undurable, and compensation-conflict recovery actions.

Recovery actions preserve the same authority boundaries as normal execution.
An `applied-undurable` task is a non-dismissible Runtime recovery lock. Ordinary
resume, cancel, supersede/new submit, or compensation cannot clear or bypass it.
Only the Runtime's own exact pending-call check against terminal durable receipt
evidence unlocks execution. Missing or indeterminate evidence remains paused
for manual reconciliation; the UI must never expose generic task controls or
turn reconciliation into a blind Core replay.

`completed-with-conflicts` is a terminal compensation outcome, not a retryable
failure. The Workspace projects its conflict report from session-scoped durable
compensation runs and may refresh or inspect that report. It must not offer a
second compensation attempt for the occupied target. A future automated repair
must be a separately authorized ordinary task, not a disguised compensation
retry.

The run head keeps two distinct authorities: `recordId` plus
`value.outerCallId` identify the owned compensation run, while the envelope
`callId` identifies the latest durable writer. State-only writes use the outer
call and no writer checkpoint; inverse writes point to the exact atomic cursor
checkpoint and terminal receipt lineage. New schema-version-1 records persist
that checkpoint pointer. Older schema-version-1 inverse records remain readable
by deriving the same canonical cursor-checkpoint key and applying the identical
checkpoint and lineage validation; no backend scan or relaxed authority check is
allowed.

The canvas active-target overlay portals into the existing
`data-easy-editor-surface-overlay-mount="editor"` element. It is
`pointer-events: none`, uses Host-projected target rectangles, and never reads
private renderer state.

Compensating a task and restoring a named version are separate, explicitly
labelled actions. The UI must not present them as equivalent undo operations.

## Feature flags and composition

The production Dashboard may compose the Runtime only when the runtime flag is
enabled and a ModelAdapter/Worker factory is available. Without a production
Gateway (Phase 8), the Workspace may present a typed unavailable state; it must
not silently substitute a scripted model outside tests. The scripted E2E model,
worker, loader, probe keys, and control hooks are compile-time gated behind the
E2E build and excluded from normal production bundles. The production build
fails when its post-build scan finds any of those markers.

Disabling the runtime flag disposes the runtime and hides the Workspace while
retaining all durable records.

## Verification gate

Phase 4 requires all of the following:

1. Agent Runtime unit and type tests for task projection, deterministic context
   compaction, follow-up, refinement, recovery, and session isolation.
2. Memory and IndexedDB parity tests for sessions, versions, grants, restore
   idempotency, and artifact-root enumeration.
3. Dashboard unit tests for the Workspace view model, recovery states, and
   target overlay projection.
4. Browser coverage for Workspace open/submit/blueprint, named version creation,
   completed follow-up, active refinement, reload recovery, grant reuse/revoke,
   compensation conflict, and named-version branch fork.
5. Assertions on journal, revision, call, receipt, branch, and session identity;
   screenshots alone are not proof.
6. Root lint, types, tests, build, public API, and Chromium gates after
   integration.

## Rollback

Rollback disables Phase 4 feature flags and disposes the UI/runtime composition.
It does not delete durable data. Sessions, versions, grants, journals, receipts,
and artifacts remain readable and exportable for recovery.
