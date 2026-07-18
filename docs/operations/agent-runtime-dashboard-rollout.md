# Agent Runtime Dashboard rollout and rollback

This runbook covers the production Gateway and the independently staged Dashboard Agent capabilities. It does not authorize a deployment: external-provider smoke tests, trace capture, secret rotation, and production cutover remain manual operator actions.

## Invariants

- Every Agent capability is default-off. Only the exact enabled values accepted by its resolver should be used during a staged rollout.
- The ordinary Dashboard must remain usable with all `VITE_DASHBOARD_AGENT_*` flags disabled and every Agent-side server route disabled.
- Deploy and verify a server route before enabling its browser surface. Enable the browser flag last; during a planned rollback, disable the browser surface before removing its server route.
- A security rollback takes precedence over graceful ordering: revoke the authoritative session and disable the Gateway immediately, then turn off the UI.
- Durable storage, activation markers, generated artifacts, and catalog records are evidence. Do not delete them during an emergency rollback.

## Flags and rollback controls

| Layer | Browser build-time control | Server runtime control | Default-off rollback |
|---|---|---|---|
| Agent UI and Worker | `VITE_DASHBOARD_AGENT_RUNTIME` | none | Rebuild/redeploy with the browser flag off. The normal editor remains available. |
| Model Gateway | provider id/model/path only: `VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID`, `VITE_DASHBOARD_AGENT_MODEL`, `VITE_DASHBOARD_AGENT_MODEL_PATH` | `EASY_EDITOR_AGENT_GATEWAY_ENABLED` plus `EASY_EDITOR_AGENT_GATEWAY_CONFIG_JSON` | Disable/revoke server access, then remove the browser runtime flag and safe routing metadata. |
| Safe data path | `VITE_DASHBOARD_AGENT_DATA` | `EASY_EDITOR_DATA_PROXY_ENABLED` | Materialize and verify the legacy compatibility copy before transferring storage authority; then disable the browser surface and finally the server route. |
| Online components | `VITE_DASHBOARD_AGENT_ONLINE` | `EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_ENABLED` | Disable the browser surface first. Preserve immutable artifacts and activation/quarantine markers, then disable dependency resolution. |
| Local promotion | `VITE_DASHBOARD_AGENT_PROMOTION` | `EASY_EDITOR_MATERIAL_PROMOTION_ENABLED`, `EASY_EDITOR_MATERIAL_GC_ENABLED` | Disable browser promotion, server promotion, and garbage collection. Preserve catalog and artifact evidence. |

Do not couple these controls into one switch. Stage data, online components, and promotion separately after the Gateway/UI path is healthy.

## Secrets and session authorization

`EASY_EDITOR_AGENT_GATEWAY_CONFIG_JSON` is server-only configuration. Inject it from the deployment secret manager into the server process. Its provider `apiKey`, bearer principals, and session data must never appear in:

- a `VITE_*` variable or browser bundle;
- source control, build arguments, client logs, browser storage, or IndexedDB;
- request/response diagnostics, Playwright artifacts, screenshots, or traces.

The browser may receive only provider identity, model identity, and a same-origin Gateway path. Prefer an authoritative HttpOnly session integration for production. An IndexedDB local grant is a Dashboard UX decision only; it is never evidence of server authorization.

For immediate revocation:

1. Invalidate the authoritative server session or remove the bearer principal. Cancel active streams when the session backend supports it.
2. If static environment configuration backs the authorizer, replace the configuration and restart/reload every Gateway instance before treating revocation as complete.
3. Rotate the provider API key immediately if exposure is suspected, update the server-only secret, and revoke the old key at the provider.
4. Confirm that the next request is rejected before provider dispatch. Revoke the matching local Dashboard grant separately so the UI no longer offers reuse.

## Rollout sequence

1. With every Agent flag off, smoke the ordinary editor, save, reload, and preview paths.
2. Deploy Gateway, data, dependency, and promotion routes disabled. Confirm that disabled routes grant no authority.
3. Provision the Gateway provider and server session configuration from the secret manager. Verify an unauthenticated request is rejected without contacting the provider.
4. Enable the Gateway route for a canary session. Keep `VITE_DASHBOARD_AGENT_RUNTIME` off until the server health and authorization checks pass.
5. Deploy the browser bundle with only the runtime flag enabled for the canary. Add data, online, and promotion flags one at a time, verifying their matching server route first.
6. Perform the manual real-provider smoke below. Review a sanitized trace, budget, and provider audit record before any broader cutover.
7. Record the exact bundle, server revision, flag values, provider/model identity, and rollback owner. The actual deployment/cutover decision remains manual.

## Manual real-provider smoke

CI is credential-free and uses deterministic/scripted model behavior. It must not contain a real provider key and does not replace this smoke test.

Use a canary account and one disposable project with a low-risk, reversible instruction:

1. Verify the browser request contains the expected project/branch/session/task/model-request correlation and only the configured provider id, model, and same-origin path. Inspect the built assets, browser storage, request, logs, and trace for absence of provider secrets.
2. Confirm one authenticated request produces ordered `started`, `delta`, and `completed` frames and a terminal Runtime result. Confirm telemetry keeps correlation ids and contains no raw prompt or provider secret.
3. Start a second request, cancel it, and confirm no late host write is committed.
4. Exercise or inject a rate-limit and provider-unavailable response. Confirm stable public error codes are shown without raw upstream payloads.
5. Revoke the server session while the browser remains open. Confirm the next request is rejected before provider dispatch; then revoke the local grant.
6. Turn all Agent flags off and recheck ordinary Dashboard edit/save/reload/preview behavior.

Sanitize the resulting trace before attaching it to a release record. Real-provider traces and deploy cutover are manual artifacts, not CI gates.

## IndexedDB downgrade and safe boot

Storage rollback is Bridge-first. Before disabling `VITE_DASHBOARD_AGENT_DATA` or deploying a legacy writer:

1. Stop new Agent writes and wait for the project/branch persistence queue to flush.
2. Through the Bridge release's supported operator path, call `ProjectPersistenceCoordinator.downgradeToLegacy(...)`; it uses `materializeLegacyFromCanonical` on the latest canonical IndexedDB draft.
3. Require successful read-back of the complete legacy project and page keys with the expected generation and hash. The compatibility marker must change to `legacy` last.
4. Only after that verification, deploy the browser data flag off and then disable `EASY_EDITOR_DATA_PROXY_ENABLED` when no enabled clients remain.

If materialization is interrupted or verification fails, the marker remains `indexeddb`; do not edit it manually and do not let a stale legacy writer become authoritative. Forward re-entry compares generation and hash so stale legacy bytes cannot replace a newer IndexedDB draft. A release older than the Bridge contract is not a direct downgrade target; use the reviewed export/recovery path instead.

For an online-component incident, open the editor or preview with `?easy-editor-online-safe-boot=1`. Safe boot skips generated activation before DOM effects. Keep the failed revision quarantined and preserve its immutable artifact and activation marker while the ordinary editor remains available. Disable the online browser flag before removing dependency/promotion routes; do not run material GC until recovery evidence is secured.

## Stop conditions

Proceed only when the credential-free CI gates are green, the manual real-provider smoke is recorded, server authorization can be revoked, the rollback owner has verified the current compatibility marker, and the all-flags-off Dashboard smoke passes. Otherwise keep the rollout at its current canary stage or execute the rollback above.
